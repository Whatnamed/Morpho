import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
