import { encodeAgentRouteSse, type AgentRouteStreamEvent } from "@/shared/agentStreamProtocol";

/**
 * Mock Agent responses for the acceptance suite.
 *
 * The frames are produced by the production encoder, so a change to the stream
 * protocol breaks these fixtures loudly instead of leaving the suite asserting
 * against a stale hand-written format. No provider is ever contacted.
 */

export type MockAgentScript = {
  /** Concatenated SSE frames, ready to be served as the response body. */
  body: string;
  /** Frame boundaries, so a test can serve the stream in pieces and observe streaming. */
  chunks: string[];
};

const decoder = new TextDecoder();

function frame(event: AgentRouteStreamEvent): string {
  return decoder.decode(encodeAgentRouteSse(event));
}

function script(events: AgentRouteStreamEvent[]): MockAgentScript {
  const chunks = events.map(frame);
  return { body: chunks.join(""), chunks };
}

const STARTED_AT = "2026-07-01T00:00:00.000Z";

/** A plain text answer with no tool calls and no workspace writes. */
export function textAnswerScript(options: { text?: string; partId?: string } = {}): MockAgentScript {
  const text = options.text ?? "这是验收用的模拟回答。";
  const partId = options.partId ?? "part-final-1";
  return script([
    { type: "turn-start", agentTurnId: "turn-e2e-1", startedAt: STARTED_AT, providerCallCount: 1, nextProviderSequence: 2 },
    { type: "final-start", partId },
    { type: "final-delta", partId, delta: text.slice(0, Math.ceil(text.length / 2)) },
    { type: "final-delta", partId, delta: text.slice(Math.ceil(text.length / 2)) },
    { type: "final-end", partId },
    {
      type: "turn-complete",
      result: {
        responseId: "response-e2e-1",
        outputText: text,
        functionCalls: [],
        citations: [],
        webSearchCallCount: 0,
        outputItems: []
      }
    }
  ]);
}

/** A stream that never terminates, so a test can exercise cancellation. */
export function openEndedScript(): MockAgentScript {
  return script([
    { type: "turn-start", agentTurnId: "turn-e2e-cancel", startedAt: STARTED_AT, providerCallCount: 1, nextProviderSequence: 2 },
    { type: "reasoning-start", partId: "part-reasoning-1" },
    { type: "reasoning-delta", partId: "part-reasoning-1", delta: "正在分析…" },
    { type: "heartbeat" }
  ]);
}

/** A turn the server ends with an error event rather than an HTTP error. */
export function turnErrorScript(message = "模型返回异常，本轮未完成。"): MockAgentScript {
  return script([
    { type: "turn-start", agentTurnId: "turn-e2e-error", startedAt: STARTED_AT, providerCallCount: 1, nextProviderSequence: 2 },
    { type: "final-start", partId: "part-final-err" },
    { type: "final-delta", partId: "part-final-err", delta: "开始处理…" },
    { type: "turn-error", error: message }
  ]);
}
