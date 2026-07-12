import { describe, expect, it } from "vitest";

import { encodeAgentRouteSse, readAgentRouteSse } from "./agentStreamProtocol";

describe("Agent route SSE protocol", () => {
  it("reads typed events across arbitrary byte boundaries and ignores heartbeats at the consumer boundary", async () => {
    const payload = new TextDecoder().decode(
      new Uint8Array([
        ...encodeAgentRouteSse({ type: "turn-start", agentTurnId: "turn-1", startedAt: "2026-07-13T00:00:00.000Z" }),
        ...encodeAgentRouteSse({ type: "reasoning-delta", partId: "reasoning-1", delta: "checking" }),
        ...encodeAgentRouteSse({ type: "heartbeat" }),
        ...encodeAgentRouteSse({
          type: "turn-complete",
          result: {
            responseId: "resp_1",
            outputText: "done",
            functionCalls: [],
            citations: [],
            webSearchCallCount: 0,
            outputItems: []
          }
        })
      ])
    );
    const events: string[] = [];

    await readAgentRouteSse(streamFromText(payload, [1, 3, 11]), {
      onEvent: (event) => events.push(event.type)
    });

    expect(events).toEqual(["turn-start", "reasoning-delta", "heartbeat", "turn-complete"]);
  });

  it("honors AbortSignal while the stream is active", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encodeAgentRouteSse({ type: "heartbeat" }));
      }
    });

    const reading = readAgentRouteSse(stream, {
      signal: controller.signal,
      onEvent: () => undefined
    });
    controller.abort();

    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
  });
});

function streamFromText(value: string, chunkSizes: number[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let offset = 0;
      let chunkIndex = 0;
      while (offset < bytes.length) {
        const size = chunkSizes[chunkIndex % chunkSizes.length] ?? bytes.length;
        controller.enqueue(bytes.slice(offset, Math.min(bytes.length, offset + size)));
        offset += size;
        chunkIndex += 1;
      }
      controller.close();
    }
  });
}
