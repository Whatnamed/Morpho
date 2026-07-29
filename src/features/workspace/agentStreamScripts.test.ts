import { describe, expect, it } from "vitest";

import { readAgentRouteSse } from "@/shared/agentStreamProtocol";
import {
  functionCallScript,
  openEndedScript,
  textAnswerScript,
  turnErrorScript
} from "./agentStreamScripts";

describe("Agent stream scripts", () => {
  it("uses the production protocol encoder for a complete text response", async () => {
    const script = textAnswerScript({ text: "deterministic answer" });
    const decoded: string[] = [];

    await readAgentRouteSse(stream(script.chunks), {
      onEvent: (event) => decoded.push(event.type)
    });

    expect(decoded).toEqual(script.events.map((event) => event.type));
    expect(script.body).toBe(script.chunks.join(""));
  });

  it("builds deterministic function-call continuations", () => {
    const script = functionCallScript([
      {
        id: "item-read-1",
        callId: "call-read-1",
        name: "read_project_memory",
        argumentsText: JSON.stringify({ kind: "projectOverview" })
      }
    ]);

    expect(script.events.at(-1)).toMatchObject({
      type: "turn-complete",
      result: {
        responseId: "response-e2e-1",
        functionCalls: [{ callId: "call-read-1", name: "read_project_memory" }]
      }
    });
  });

  it("keeps cancellation and error scripts intentionally incomplete", () => {
    expect(openEndedScript().events.at(-1)).toEqual({ type: "heartbeat" });
    expect(turnErrorScript("expected failure").events.at(-1)).toEqual({
      type: "turn-error",
      error: "expected failure"
    });
  });
});

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  });
}
