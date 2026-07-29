import { encodeAgentTurnRequestSse, type AgentTurnRequestStreamEvent } from "@/shared/agentTurnJournalProtocol";
import type { AgentRouteStreamEvent } from "@/shared/agentStreamProtocol";

export type MockAgentScript = {
  body: string;
  chunks: string[];
};

const REQUEST_ID = "request-e2e-placeholder";
const STEP_SEQUENCE = 1;
const decoder = new TextDecoder();

export function textAnswerScript(options: { text?: string; partId?: string } = {}): MockAgentScript {
  const text = options.text ?? "这是验收用的模拟回答。";
  const partId = options.partId ?? "part-final-1";
  return script([
    status("providerRunning"),
    activity({ type: "final-start", partId }, 1),
    activity({ type: "final-delta", partId, delta: text.slice(0, Math.ceil(text.length / 2)) }, 2),
    activity({ type: "final-delta", partId, delta: text.slice(Math.ceil(text.length / 2)) }, 3),
    activity({ type: "final-end", partId }, 4),
    {
      type: "providerOutput",
      requestId: REQUEST_ID,
      stepSequence: STEP_SEQUENCE,
      outputText: text,
      producedUserVisibleEffect: true,
      toolCallIds: [],
      toolCalls: []
    },
    status("externallyCompleted")
  ]);
}

export function openEndedScript(): MockAgentScript {
  return script([
    status("providerRunning"),
    activity({ type: "reasoning-start", partId: "part-reasoning-1" }, 1),
    activity({ type: "reasoning-delta", partId: "part-reasoning-1", delta: "正在分析…" }, 2)
  ]);
}

export function turnErrorScript(message = "模型返回异常，本轮未完成。"): MockAgentScript {
  return script([
    status("providerRunning"),
    activity({ type: "final-start", partId: "part-final-err" }, 1),
    activity({ type: "final-delta", partId: "part-final-err", delta: "开始处理…" }, 2),
    {
      type: "externalError",
      requestId: REQUEST_ID,
      stepSequence: STEP_SEQUENCE,
      code: message
    },
    status("externallyFailed")
  ]);
}

function activity(event: AgentRouteStreamEvent, sequence: number): AgentTurnRequestStreamEvent {
  return {
    type: "streamActivity",
    requestId: REQUEST_ID,
    stepSequence: STEP_SEQUENCE,
    sequence,
    event
  };
}

function status(
  value: "providerRunning" | "externallyCompleted" | "externallyFailed"
): AgentTurnRequestStreamEvent {
  return {
    type: "serverStatus",
    requestId: REQUEST_ID,
    stepSequence: STEP_SEQUENCE,
    status: value
  };
}

function script(events: AgentTurnRequestStreamEvent[]): MockAgentScript {
  const chunks = events.map((event) => decoder.decode(encodeAgentTurnRequestSse(event)));
  return { chunks, body: chunks.join("") };
}
