import type { Page } from "@playwright/test";

/**
 * Replaces `window.fetch` only for the canonical Agent Turn Journal endpoints.
 * The mock returns real A+ SSE streams, so the production Coordinator, reducer,
 * display adapter, persistence, cancellation, and recovery paths stay in use.
 */

export type AgentMockResponse =
  | {
      kind: "stream";
      chunks: string[];
      chunkDelayMs?: number;
      holdAfterChunks?: number;
    }
  | { kind: "hang" }
  | { kind: "httpError"; status: number; error: string };

export type AgentMockCall = {
  url: string;
  method: string;
  body: unknown;
  /** performance.now() at fetch time, so a spec can time request boundaries. */
  at: number;
};

type MockJournal = {
  serverTurnId: string;
  localProjectId: string;
  status: "created" | "providerRunning" | "awaitingNextRequest" | "externallyCompleted" | "externallyCancelled" | "externallyFailed";
  latestRequestId: string | null;
  latestStepSequence: number;
  counters: { provider: number; webSearch: number; image: number };
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
  failureCode?: string;
};

declare global {
  interface Window {
    __morphoAgentMock?: {
      response: AgentMockResponse;
      calls: AgentMockCall[];
      held: boolean;
      journal?: MockJournal;
      turnCount: number;
      /**
       * Phase 5: per-POST `/requests` response queue. When set, each provider
       * request shifts the next entry; `response` is only the fallback. This is
       * what lets one mocked turn exercise tool call -> continuation.
       */
      requestScript?: AgentMockResponse[];
    };
  }
}

export async function installAgentMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: NonNullable<Window["__morphoAgentMock"]> = {
      response: { kind: "httpError", status: 503, error: "验收 Mock 尚未配置本轮响应。" },
      calls: [],
      held: false,
      turnCount: 0
    };
    window.__morphoAgentMock = state;

    const realFetch = window.fetch.bind(window);
    const jsonHeaders = { "content-type": "application/json" };
    const sseHeaders = { "content-type": "text/event-stream; charset=utf-8" };

    function abortError(): DOMException {
      return new DOMException("The operation was aborted.", "AbortError");
    }

    function json(body: unknown, status = 200): Response {
      return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
    }

    function requestPath(url: string): string {
      return new URL(url, window.location.origin).pathname;
    }

    function readBody(init?: RequestInit): unknown {
      try {
        return init?.body ? JSON.parse(String(init.body)) : undefined;
      } catch {
        return undefined;
      }
    }

    function record(url: string, init: RequestInit | undefined, body: unknown): void {
      state.calls.push({ url, method: init?.method ?? "GET", body, at: performance.now() });
    }

    function updateJournal(
      status: MockJournal["status"],
      patch: Partial<MockJournal> = {}
    ): MockJournal | undefined {
      if (!state.journal) return undefined;
      const terminal = status === "externallyCompleted" || status === "externallyCancelled" || status === "externallyFailed";
      state.journal = {
        ...state.journal,
        ...patch,
        status,
        updatedAt: new Date().toISOString(),
        terminalAt: terminal ? new Date().toISOString() : null
      };
      return state.journal;
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = requestPath(url);
      if (!path.startsWith("/api/ai/agent/turns")) {
        return realFetch(input, init);
      }

      const body = readBody(init);
      record(url, init, body);

      if (state.response.kind === "httpError" && !state.requestScript) {
        return json({ error: state.response.error }, state.response.status);
      }

      if (path === "/api/ai/agent/turns" && (init?.method ?? "GET") === "POST") {
        const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
        state.turnCount += 1;
        const now = new Date().toISOString();
        state.journal = {
          serverTurnId: `00000000-0000-4000-8000-${String(state.turnCount).padStart(12, "0")}`,
          localProjectId: String(value.localProjectId ?? "project-e2e"),
          status: "created",
          latestRequestId: null,
          latestStepSequence: 0,
          counters: { provider: 0, webSearch: 0, image: 0 },
          createdAt: now,
          updatedAt: now,
          terminalAt: null
        };
        return json({ ...state.journal, replayed: false });
      }

      if (!state.journal || !path.includes(state.journal.serverTurnId)) {
        return json({ error: "Server Turn Journal 不存在。", code: "turn_not_found" }, 404);
      }

      if (path.endsWith("/requests/cancel") && init?.method === "POST") {
        return json(updateJournal("externallyCancelled"));
      }

      if (path.endsWith("/requests") && init?.method === "POST") {
        const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
        const requestId = String(value.requestId ?? "request-e2e");
        const stepSequence = Number(value.stepSequence ?? 1);
        updateJournal("providerRunning", {
          latestRequestId: requestId,
          latestStepSequence: stepSequence,
          counters: { ...state.journal.counters, provider: state.journal.counters.provider + 1 }
        });

        const active = state.requestScript?.shift() ?? state.response;
        const signal = init.signal ?? undefined;
        if (signal?.aborted) throw abortError();
        if (active.kind === "httpError") {
          return json({ error: active.error }, active.status);
        }
        if (active.kind === "hang") {
          return new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(abortError()), { once: true });
          });
        }

        const encoder = new TextEncoder();
        // The client treats SSE status as display-only and queries the Journal when
        // the stream ends, so the journal status must reflect what the chunks said —
        // including `awaitingNextRequest`, which is what lets a tool-call turn
        // proceed to local execution and the continuation request.
        const terminalStatus: MockJournal["status"] = active.chunks.some((chunk) =>
          chunk.includes('"status":"externallyFailed"')
        )
          ? "externallyFailed"
          : active.chunks.some((chunk) => chunk.includes('"status":"awaitingNextRequest"'))
            ? "awaitingNextRequest"
            : "externallyCompleted";
        const chunks = active.chunks.map((chunk) => chunk
          .replace(/"requestId":"[^"]+"/g, `"requestId":${JSON.stringify(requestId)}`)
          .replace(/"stepSequence":\d+/g, `"stepSequence":${stepSequence}`));
        const delay = active.chunkDelayMs ?? 30;
        const holdAfter = active.holdAfterChunks;
        let emitted = 0;
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const next = chunks.shift();
            if (next === undefined) {
              updateJournal(terminalStatus, terminalStatus === "externallyFailed"
                ? { failureCode: "provider_execution_failed" }
                : {});
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
      }

      if ((init?.method ?? "GET") === "GET") {
        return json(state.journal);
      }

      return json({ error: `未配置的 A+ 验收路由：${path}` }, 501);
    };
  });
}

export async function setAgentResponse(page: Page, response: AgentMockResponse): Promise<void> {
  await page.evaluate((next: AgentMockResponse) => {
    if (!window.__morphoAgentMock) {
      throw new Error("Agent mock was not installed before navigation.");
    }
    window.__morphoAgentMock.response = next;
    window.__morphoAgentMock.requestScript = undefined;
    window.__morphoAgentMock.held = next.kind === "stream" && next.holdAfterChunks !== undefined;
  }, response);
}

/**
 * Queues one response per provider POST `/requests` (the last entry repeats if the
 * turn issues more requests than scripted). Used to exercise tool-call turns:
 * request 1 returns a `providerOutput` with tool calls, request 2 answers the
 * continuation.
 */
export async function setAgentRequestScript(
  page: Page,
  script: AgentMockResponse[]
): Promise<void> {
  await page.evaluate((next: AgentMockResponse[]) => {
    if (!window.__morphoAgentMock) {
      throw new Error("Agent mock was not installed before navigation.");
    }
    window.__morphoAgentMock.requestScript = next;
    window.__morphoAgentMock.held = next.some(
      (response) => response.kind === "stream" && response.holdAfterChunks !== undefined
    );
  }, script);
}

export async function releaseAgentStream(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.__morphoAgentMock) window.__morphoAgentMock.held = false;
  });
}

export async function agentCalls(page: Page): Promise<AgentMockCall[]> {
  return page.evaluate(() => window.__morphoAgentMock?.calls ?? []);
}

export async function agentTurnCallCount(page: Page): Promise<number> {
  const calls = await agentCalls(page);
  return calls.filter((call) =>
    new URL(call.url, "http://localhost").pathname.endsWith("/requests") && call.method === "POST"
  ).length;
}
