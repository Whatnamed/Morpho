import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeAgentRouteSse, type AgentRouteStreamEvent, type AgentStreamResult } from "@/shared/agentStreamProtocol";
import {
  AgentTurnStreamError,
  consumeAgentTurnStream,
  createAgentAttemptGuard,
  createAgentStreamEventBatcher
} from "./agentStreamClient";

afterEach(() => {
  vi.useRealTimers();
});

describe("Agent stream client", () => {
  it("consumes compact-compatible SSE without calling response.json", async () => {
    const result = streamResult("摘要完成");
    const response = sseResponse([
      { type: "turn-start", attemptId: "attempt-a", startedAt: "2026-07-13T00:00:00.000Z" },
      { type: "reasoning-start", partId: "reasoning-a", attemptId: "attempt-a" },
      { type: "reasoning-delta", partId: "reasoning-a", delta: "整理语境", attemptId: "attempt-a" },
      { type: "heartbeat" },
      { type: "usage", usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 }, attemptId: "attempt-a" },
      { type: "turn-complete", result, attemptId: "attempt-a" }
    ]);
    const jsonSpy = vi.spyOn(response, "json");
    const seen: string[] = [];

    await expect(consumeAgentTurnStream(response, { onEvent: (event) => seen.push(event.type) })).resolves.toEqual(result);
    expect(seen).toContain("reasoning-delta");
    expect(seen).toContain("heartbeat");
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("turns a streamed turn-error into a readable failure", async () => {
    const response = sseResponse([
      { type: "turn-start", attemptId: "attempt-a", startedAt: "2026-07-13T00:00:00.000Z" },
      { type: "turn-error", attemptId: "attempt-a", error: "模型没有返回摘要。" }
    ]);

    await expect(consumeAgentTurnStream(response)).rejects.toEqual(
      expect.objectContaining<Partial<AgentTurnStreamError>>({
        name: "AgentTurnStreamError",
        message: "模型没有返回摘要。"
      })
    );
  });

  it("ignores late events and terminal results from a reset attempt", async () => {
    const result = streamResult("第二次成功", "response-b");
    const seenDeltas: string[] = [];
    const response = sseResponse([
      { type: "turn-start", attemptId: "attempt-a", startedAt: "2026-07-13T00:00:00.000Z" },
      { type: "final-delta", partId: "final-a", delta: "半截", attemptId: "attempt-a" },
      {
        type: "turn-attempt-reset",
        attemptId: "attempt-a",
        nextAttemptId: "attempt-b",
        message: "正在重新整理当前语境"
      },
      { type: "final-delta", partId: "late-a", delta: "迟到", attemptId: "attempt-a" },
      { type: "turn-complete", result: streamResult("错误结果", "response-a"), attemptId: "attempt-a" },
      { type: "final-delta", partId: "final-b", delta: "第二次成功", attemptId: "attempt-b" },
      { type: "turn-complete", result, attemptId: "attempt-b" }
    ]);

    const consumed = await consumeAgentTurnStream(response, {
      onEvent: (event) => {
        if (event.type === "final-delta") {
          seenDeltas.push(event.delta);
        }
      }
    });

    expect(consumed.responseId).toBe("response-b");
    expect(seenDeltas).toEqual(["半截", "第二次成功"]);
  });

  it("cancels the reader and surfaces AbortError when the client stops", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encodeAgentRouteSse({
            type: "turn-start",
            attemptId: "attempt-a",
            startedAt: "2026-07-13T00:00:00.000Z"
          })
        );
      },
      cancel
    });
    const controller = new AbortController();
    const consuming = consumeAgentTurnStream(new Response(stream), { signal: controller.signal });

    await Promise.resolve();
    controller.abort();

    await expect(consuming).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("Agent stream delta batching", () => {
  it("merges 100 high-frequency deltas into one commit without losing order", () => {
    vi.useFakeTimers();
    const commits: AgentRouteStreamEvent[][] = [];
    const batcher = createAgentStreamEventBatcher({ onFlush: (events) => commits.push(events) });

    for (let index = 0; index < 100; index += 1) {
      batcher.push({
        type: "reasoning-delta",
        partId: "reasoning-1",
        delta: String(index % 10),
        attemptId: "attempt-a"
      });
    }

    expect(commits).toHaveLength(0);
    vi.advanceTimersByTime(48);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual([
      expect.objectContaining({
        type: "reasoning-delta",
        delta: Array.from({ length: 100 }, (_, index) => String(index % 10)).join("")
      })
    ]);
  });

  it("flushes the last buffered delta before cancellation and preserves part order", () => {
    const commits: AgentRouteStreamEvent[][] = [];
    const batcher = createAgentStreamEventBatcher({ onFlush: (events) => commits.push(events) });
    batcher.push({ type: "reasoning-delta", partId: "r", delta: "先" });
    batcher.push({ type: "reasoning-delta", partId: "r", delta: "思考" });
    batcher.push({ type: "commentary-delta", partId: "c", delta: "再说明" });

    batcher.flush();
    batcher.cancel();

    expect(commits.flat()).toEqual([
      expect.objectContaining({ type: "reasoning-delta", delta: "先思考" }),
      expect.objectContaining({ type: "commentary-delta", delta: "再说明" })
    ]);
  });
});

describe("Agent attempt guard", () => {
  it("switches attempts on reset and rejects late provider events", () => {
    const guard = createAgentAttemptGuard();
    expect(
      guard.accept({
        type: "turn-start",
        attemptId: "attempt-a",
        startedAt: "2026-07-13T00:00:00.000Z"
      })
    ).toBe(true);
    expect(
      guard.accept({
        type: "turn-attempt-reset",
        attemptId: "attempt-a",
        nextAttemptId: "attempt-b",
        message: "正在重新整理当前语境"
      })
    ).toBe(true);
    expect(
      guard.accept({ type: "reasoning-delta", partId: "old", delta: "迟到", attemptId: "attempt-a" })
    ).toBe(false);
    expect(
      guard.accept({ type: "reasoning-delta", partId: "new", delta: "有效", attemptId: "attempt-b" })
    ).toBe(true);
  });
});

function sseResponse(events: AgentRouteStreamEvent[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        events.forEach((event) => controller.enqueue(encodeAgentRouteSse(event)));
        controller.close();
      }
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}

function streamResult(outputText: string, responseId = "response-a"): AgentStreamResult {
  return {
    responseId,
    outputText,
    functionCalls: [],
    citations: [],
    webSearchCallCount: 0,
    outputItems: [],
    usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 }
  };
}
