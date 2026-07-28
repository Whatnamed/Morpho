import type { Page } from "@playwright/test";

/**
 * Replaces `window.fetch` for the Agent endpoints only.
 *
 * Intercepting at fetch rather than at the network lets the mock hand back a real
 * `ReadableStream` that emits SSE frames over time, so streaming and cancellation
 * are exercised for real instead of being simulated by a single whole-body reply.
 * Everything above fetch — stream reader, attempt guard, trace assembly, workspace
 * writes, lease completion — is the production code path.
 *
 * The frames themselves come from the production SSE encoder (see
 * `e2e/support/agentSse.ts`), so a protocol change fails the suite loudly.
 */

export type AgentMockResponse =
  | {
      kind: "stream";
      chunks: string[];
      chunkDelayMs?: number;
      /**
       * Emit this many frames and then hold the stream open until
       * `releaseAgentStream` is called. Without it, assertions about the
       * in-flight state race the stream finishing: the stop control appears and
       * disappears again, and a slow poll can miss the window entirely.
       */
      holdAfterChunks?: number;
    }
  | { kind: "hang" }
  | { kind: "httpError"; status: number; error: string };

export type AgentMockCall = {
  url: string;
  method: string;
  body: unknown;
};

declare global {
  interface Window {
    __morphoAgentMock?: {
      response: AgentMockResponse;
      calls: AgentMockCall[];
      held: boolean;
    };
  }
}

export async function installAgentMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: NonNullable<Window["__morphoAgentMock"]> = {
      response: { kind: "httpError", status: 503, error: "验收 Mock 尚未配置本轮响应。" },
      calls: [],
      held: false
    };
    window.__morphoAgentMock = state;

    const realFetch = window.fetch.bind(window);
    const sseHeaders = { "content-type": "text/event-stream; charset=utf-8" };

    function abortError(): DOMException {
      return new DOMException("The operation was aborted.", "AbortError");
    }

    function stableJson(value: unknown): string {
      if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(",")}]`;
      }
      if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
          .join(",")}}`;
      }
      return JSON.stringify(value);
    }

    async function hashOutcomeItem(value: unknown): Promise<string> {
      const bytes = new TextEncoder().encode(
        `morpho-agent-turn-outcome-v1\u0000${stableJson(value)}`
      );
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/api/ai/agent")) {
        return realFetch(input, init);
      }

      let body: unknown;
      try {
        body = init?.body ? JSON.parse(String(init.body)) : undefined;
      } catch {
        body = undefined;
      }
      state.calls.push({ url, method: init?.method ?? "GET", body });

      if (url.includes("/api/ai/agent/lease/tool")) {
        return new Response(JSON.stringify({ status: "marked" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/api/ai/agent/lease/summary")) {
        return new Response(JSON.stringify({ status: "success" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/api/ai/agent/lease")) {
        const closure = body && typeof body === "object"
          ? body as Record<string, unknown>
          : {};
        if (typeof closure.projectId !== "string") {
          return new Response(JSON.stringify({ status: closure.outcome }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        const providerSnapshot = closure.providerOutputSnapshot &&
          typeof closure.providerOutputSnapshot === "object"
          ? closure.providerOutputSnapshot as Record<string, unknown>
          : {};
        const outcome = String(closure.outcome);
        const text = outcome === "success"
          ? String(providerSnapshot.text ?? "")
          : outcome === "partialSuccess"
            ? "本轮仅部分完成。已完成结果已保留，未完成步骤需要后续重试。"
            : "本轮停在待确认状态。确认前不把相关动作视为已完成。";
        const unsignedOutcome = {
          type: "morpho_turn_outcome",
          agentTurnId: String(closure.agentTurnId),
          userMessageId: String(closure.userMessageId),
          assistantMessageId: String(closure.assistantMessageId),
          outcome,
          text
        };
        const outcomeItem = {
          ...unsignedOutcome,
          contentHash: await hashOutcomeItem(unsignedOutcome)
        };
        return new Response(JSON.stringify({
          status: outcome,
          outcomeItem,
          transcriptSnapshotToken: "snapshot-token-e2e-final",
          transcriptManifestHash: "c".repeat(64),
          expiresAt: Date.now() + 60_000
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      const signal = init?.signal ?? undefined;
      const response = state.response;

      if (signal?.aborted) {
        throw abortError();
      }

      if (response.kind === "httpError") {
        return new Response(JSON.stringify({ error: response.error }), {
          status: response.status,
          headers: { "content-type": "application/json" }
        });
      }

      if (response.kind === "hang") {
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(abortError()), { once: true });
        });
      }

      const encoder = new TextEncoder();
      const chunks = [...response.chunks];
      const delay = response.chunkDelayMs ?? 30;
      const holdAfter = response.holdAfterChunks;
      let emitted = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = chunks.shift();
          if (next === undefined) {
            controller.close();
            return;
          }
          if (holdAfter !== undefined && emitted === holdAfter) {
            while (state.held) {
              if (signal?.aborted) {
                controller.close();
                return;
              }
              await new Promise((resolve) => window.setTimeout(resolve, 25));
            }
          }
          await new Promise((resolve) => window.setTimeout(resolve, delay));
          if (signal?.aborted) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(next));
          emitted += 1;
        },
        cancel() {
          chunks.length = 0;
        }
      });

      return new Response(stream, { status: 200, headers: sseHeaders });
    };
  });
}

export async function setAgentResponse(page: Page, response: AgentMockResponse): Promise<void> {
  await page.evaluate((next: AgentMockResponse) => {
    if (!window.__morphoAgentMock) {
      throw new Error("Agent mock was not installed before navigation.");
    }
    window.__morphoAgentMock.response = next;
    window.__morphoAgentMock.held = next.kind === "stream" && next.holdAfterChunks !== undefined;
  }, response);
}

/** Lets a held stream finish. */
export async function releaseAgentStream(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.__morphoAgentMock) {
      window.__morphoAgentMock.held = false;
    }
  });
}

export async function agentCalls(page: Page): Promise<AgentMockCall[]> {
  return page.evaluate(() => window.__morphoAgentMock?.calls ?? []);
}

export async function agentTurnCallCount(page: Page): Promise<number> {
  const calls = await agentCalls(page);
  return calls.filter((call) => !call.url.includes("/lease")).length;
}
