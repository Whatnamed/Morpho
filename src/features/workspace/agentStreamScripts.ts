import {
  encodeAgentRouteSse,
  type AgentRouteStreamEvent,
  type AgentStreamFunctionCall,
  type AgentStreamResult
} from "@/shared/agentStreamProtocol";

/** Deterministic Agent response scripts shared by unit and browser tests. */
export type MockAgentScript = {
  body: string;
  chunks: string[];
  events: AgentRouteStreamEvent[];
};

const STARTED_AT = "2026-07-01T00:00:00.000Z";
const decoder = new TextDecoder();

function frame(event: AgentRouteStreamEvent): string {
  return decoder.decode(encodeAgentRouteSse(event));
}

export function agentStreamScript(events: AgentRouteStreamEvent[]): MockAgentScript {
  const chunks = events.map(frame);
  return { body: chunks.join(""), chunks, events };
}

export function textAnswerScript(options: { text?: string; partId?: string } = {}): MockAgentScript {
  const text = options.text ?? "这是验收用的模拟回答。";
  const partId = options.partId ?? "part-final-1";
  return agentStreamScript([
    {
      type: "turn-start",
      agentTurnId: "turn-e2e-1",
      startedAt: STARTED_AT,
      providerCallCount: 1,
      nextProviderSequence: 2
    },
    { type: "final-start", partId },
    { type: "final-delta", partId, delta: text.slice(0, Math.ceil(text.length / 2)) },
    { type: "final-delta", partId, delta: text.slice(Math.ceil(text.length / 2)) },
    { type: "final-end", partId },
    {
      type: "turn-complete",
      result: buildStreamResult({ outputText: text })
    }
  ]);
}

/** A response whose server keeps the connection open after these initial frames. */
export function openEndedScript(): MockAgentScript {
  return agentStreamScript([
    {
      type: "turn-start",
      agentTurnId: "turn-e2e-cancel",
      startedAt: STARTED_AT,
      providerCallCount: 1,
      nextProviderSequence: 2
    },
    { type: "reasoning-start", partId: "part-reasoning-1" },
    { type: "reasoning-delta", partId: "part-reasoning-1", delta: "正在分析…" },
    { type: "heartbeat" }
  ]);
}

export function turnErrorScript(message = "模型返回异常，本轮未完成。"): MockAgentScript {
  return agentStreamScript([
    {
      type: "turn-start",
      agentTurnId: "turn-e2e-error",
      startedAt: STARTED_AT,
      providerCallCount: 1,
      nextProviderSequence: 2
    },
    { type: "final-start", partId: "part-final-err" },
    { type: "final-delta", partId: "part-final-err", delta: "开始处理…" },
    { type: "turn-error", error: message }
  ]);
}

export function functionCallScript(
  functionCalls: AgentStreamFunctionCall[],
  options: { responseId?: string; outputText?: string } = {}
): MockAgentScript {
  const result = buildStreamResult({
    responseId: options.responseId,
    outputText: options.outputText,
    functionCalls
  });
  return agentStreamScript([
    {
      type: "turn-start",
      agentTurnId: "turn-unit-tools",
      attemptId: "attempt-unit-tools",
      startedAt: STARTED_AT,
      providerCallCount: 1,
      nextProviderSequence: 2
    },
    ...functionCalls.map(
      (functionCall): AgentRouteStreamEvent => ({
        type: "function-call-ready",
        functionCall,
        attemptId: "attempt-unit-tools"
      })
    ),
    {
      type: "turn-complete",
      result,
      attemptId: "attempt-unit-tools",
      continuationToken: "continuation-unit-tools"
    }
  ]);
}

function buildStreamResult(
  input: Partial<Pick<AgentStreamResult, "responseId" | "outputText" | "functionCalls">>
): AgentStreamResult {
  return {
    responseId: input.responseId ?? "response-e2e-1",
    outputText: input.outputText ?? "",
    functionCalls: input.functionCalls ?? [],
    citations: [],
    webSearchCallCount: 0,
    outputItems: []
  };
}
