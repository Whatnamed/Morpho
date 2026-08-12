import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  parseOpenAiResponsesStream
} from "./openaiCompatibleResponsesStream";

const fixtureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");

describe("OpenAI-compatible Responses SSE parser", () => {
  it("preserves reasoning followed by a function call when chunks split at arbitrary byte boundaries", async () => {
    const events: string[] = [];
    const result = await parseOpenAiResponsesStream(streamFixture("responses-reasoning-tool-stream.ndjson", [1, 7, 2, 19]), {
      onEvent: (event) => events.push(event.type)
    });

    expect(events).toContain("reasoning-start");
    expect(events).toContain("reasoning-delta");
    expect(events).toContain("function-call-ready");
    expect(result.functionCalls).toEqual([
      expect.objectContaining({
        callId: "<call-4>",
        name: "probe_lookup",
        argumentsText: "{\"query\":\"synthetic protocol probe\"}"
      })
    ]);
  });

  it("keeps commentary out of final text and exposes both phases in order", async () => {
    const events: string[] = [];
    const result = await parseOpenAiResponsesStream(streamFixture("responses-commentary-final-stream.ndjson", [31, 5, 11]), {
      onEvent: (event) => events.push(event.type)
    });

    expect(events.indexOf("commentary-start")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("final-start")).toBeGreaterThan(events.indexOf("commentary-end"));
    expect(result.outputText).not.toBe("");
    expect(result.outputText).not.toContain("I will keep this response");
  });

  it("does not invent commentary when the provider emits final text only", async () => {
    const events: string[] = [];
    const result = await parseOpenAiResponsesStream(streamFixture("responses-final-without-commentary-stream.ndjson", [5, 13]), {
      onEvent: (event) => events.push(event.type)
    });

    expect(events).not.toContain("commentary-start");
    expect(result.outputText).toContain("protocol probe complete");
  });

  it("buffers a message without phase and classifies it as commentary when a function call follows", async () => {
    const events: Array<{ type: string; delta?: string }> = [];
    const result = await parseOpenAiResponsesStream(
      responseFrames([
        {
          type: "response.output_item.added",
          item: { id: "message-1", type: "message", role: "assistant", content: [] }
        },
        { type: "response.output_text.delta", item_id: "message-1", delta: "我先读取当前选择。" },
        { type: "response.output_text.done", item_id: "message-1", text: "我先读取当前选择。" },
        {
          type: "response.output_item.done",
          item: {
            id: "message-1",
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "我先读取当前选择。" }]
          }
        },
        {
          type: "response.output_item.added",
          item: {
            id: "function-1",
            type: "function_call",
            call_id: "call-1",
            name: "read_selected_context",
            arguments: "{}"
          }
        },
        {
          type: "response.output_item.done",
          item: {
            id: "function-1",
            type: "function_call",
            call_id: "call-1",
            name: "read_selected_context",
            arguments: "{}"
          }
        },
        {
          type: "response.completed",
          response: {
            id: "response-1",
            usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 }
          }
        }
      ]),
      { onEvent: (event) => events.push(event) }
    );

    expect(events.map((event) => event.type)).toContain("commentary-start");
    expect(events.map((event) => event.type)).not.toContain("final-start");
    expect(events.filter((event) => event.type === "commentary-delta")).toEqual([
      expect.objectContaining({ delta: "我先读取当前选择。" })
    ]);
    expect(result.outputText).toBe("");
    expect(result.functionCalls).toHaveLength(1);
  });

  it("buffers a message without phase and classifies it as final when no function call follows", async () => {
    const eventTypes: string[] = [];
    const result = await parseOpenAiResponsesStream(
      responseFrames([
        {
          type: "response.output_item.added",
          item: { id: "message-1", type: "message", role: "assistant", content: [] }
        },
        { type: "response.output_text.delta", item_id: "message-1", delta: "这是最终答复。" },
        {
          type: "response.output_item.done",
          item: {
            id: "message-1",
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "这是最终答复。" }]
          }
        },
        {
          type: "response.completed",
          response: { id: "response-1", usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } }
        }
      ]),
      { onEvent: (event) => eventTypes.push(event.type) }
    );

    expect(eventTypes).toContain("final-start");
    expect(eventTypes).not.toContain("commentary-start");
    expect(result.outputText).toBe("这是最终答复。");
  });

  it("derives input usage and preserves reasoning-token details from the real provider fixture", async () => {
    const events: Array<{ type: string; usage?: { inputTokens: number; reasoningTokens?: number } }> = [];
    const result = await parseOpenAiResponsesStream(
      streamFixture("responses-reasoning-tool-stream.ndjson", [2, 17, 5]),
      { onEvent: (event) => events.push(event) }
    );

    expect(result.usage).toEqual({
      inputTokens: 4472,
      outputTokens: 42,
      totalTokens: 4514,
      reasoningTokens: 18
    });
    expect(events.find((event) => event.type === "usage")?.usage).toMatchObject({
      inputTokens: 4472,
      reasoningTokens: 18
    });
  });

  it("accepts CRLF, multiline data, unknown events, and [DONE]", async () => {
    const frame = [
      ": heartbeat\r\n",
      "event: response.output_item.added\r\n",
      'data: {"type":"response.output_item.added",\r\n',
      'data: "output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant","phase":"final_answer","content":[]}}\r\n\r\n',
      'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","item_id":"msg_1","delta":"hello"}\r\n\r\n',
      "event: provider.extension\r\ndata: {\"type\":\"provider.extension\"}\r\n\r\n",
      'event: response.output_item.done\r\ndata: {"type":"response.output_item.done","item":{"id":"msg_1","type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"hello"}]}}\r\n\r\n',
      'event: response.completed\r\ndata: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\r\n\r\n',
      "data: [DONE]\r\n\r\n"
    ].join("");
    const events: string[] = [];
    const result = await parseOpenAiResponsesStream(streamFromString(frame, [3, 2, 17]), {
      onEvent: (event) => events.push(event.type)
    });

    expect(events).toContain("unknown");
    expect(result.outputText).toBe("hello");
  });

  it("reports failed and prematurely closed streams without treating partial JSON as complete", async () => {
    await expect(
      parseOpenAiResponsesStream(streamFromString('data: {"type":"response.output_text.delta","item_id":"x","delta":"partial"}\n\n'))
    ).rejects.toMatchObject({ kind: "interrupted" });

    await expect(
      parseOpenAiResponsesStream(
        streamFromString('data: {"type":"response.failed","response":{"error":{"message":"nope"}}}\n\n')
      )
    ).rejects.toMatchObject({ kind: "failed" });
  });

  it("cancels a stream whose unfinished frame exceeds the pending-byte limit", async () => {
    const cancelled = vi.fn();
    const stream = cancellableStream(["data: " + "x".repeat(40)], cancelled);

    await expect(parseOpenAiResponsesStream(stream, { maxPendingBytes: 32 })).rejects.toMatchObject({
      code: "provider_response_too_large"
    });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("cancels multiple legal frames when cumulative SSE bytes exceed the total limit", async () => {
    const cancelled = vi.fn();
    const frame = 'data: {"type":"provider.extension"}\n\n';
    const stream = cancellableStream([frame, frame, frame], cancelled);

    await expect(parseOpenAiResponsesStream(stream, { maxPendingBytes: 128, maxTotalBytes: frame.length * 2 })).rejects.toMatchObject({
      code: "provider_response_too_large"
    });
    expect(cancelled).toHaveBeenCalledOnce();
  });
});

function streamFixture(filename: string, chunkSizes: number[]): ReadableStream<Uint8Array> {
  const ndjson = readFileSync(path.join(fixtureDirectory, filename), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as { event?: string; data: unknown })
    .map((event) => `${event.event ? `event: ${event.event}\n` : ""}data: ${JSON.stringify(event.data)}\n\n`)
    .join("");
  return streamFromString(ndjson, chunkSizes);
}

function streamFromString(value: string, chunkSizes = [value.length]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
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

function responseFrames(events: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  return streamFromString(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), [3, 11, 2]);
}

function cancellableStream(chunks: string[], cancelled: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
    },
    cancel: cancelled
  });
}
