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

/**
 * A two-request tool-call turn: request 1 returns a `providerOutput` carrying one
 * local tool call (client executes it and issues the continuation), request 2 is a
 * normal text answer. Read tools (`read_project_memory`) are allowed by every
 * authority profile, so this exercises the real tool -> local effect ->
 * continuation path without authorization plumbing.
 */
export function toolCallTurnScript(options: {
  toolName?: string;
  argumentsText?: string;
  finalText?: string;
} = {}): { first: string[]; second: string[] } {
  const toolName = options.toolName ?? "read_project_memory";
  const argumentsText = options.argumentsText ?? "{}";
  const finalText = options.finalText ?? "工具结果已读取，这里是最终回答。";
  const callId = "call-e2e-tool-1";

  const first: AgentTurnRequestStreamEvent[] = [
    status("providerRunning"),
    activity(
      {
        type: "provider-tool-start",
        toolCallId: callId,
        toolName: toolName,
        activityKind: "contextRead",
        label: "读取项目记忆"
      },
      1
    ),
    {
      type: "providerOutput",
      requestId: REQUEST_ID,
      stepSequence: STEP_SEQUENCE,
      outputText: "",
      producedUserVisibleEffect: true,
      toolCallIds: [callId],
      toolCalls: [{ callId, name: toolName, argumentsText }]
    },
    {
      type: "serverStatus",
      requestId: REQUEST_ID,
      stepSequence: STEP_SEQUENCE,
      status: "awaitingNextRequest"
    }
  ];

  const second: AgentTurnRequestStreamEvent[] = [
    status("providerRunning"),
    activity({ type: "final-start", partId: "part-final-tool" }, 1),
    activity({ type: "final-delta", partId: "part-final-tool", delta: finalText.slice(0, Math.ceil(finalText.length / 2)) }, 2),
    activity({ type: "final-delta", partId: "part-final-tool", delta: finalText.slice(Math.ceil(finalText.length / 2)) }, 3),
    activity({ type: "final-end", partId: "part-final-tool" }, 4),
    {
      type: "providerOutput",
      requestId: REQUEST_ID,
      stepSequence: STEP_SEQUENCE,
      outputText: finalText,
      producedUserVisibleEffect: true,
      toolCallIds: [],
      toolCalls: []
    },
    status("externallyCompleted")
  ];

  return {
    first: first.map((event) => decoder.decode(encodeAgentTurnRequestSse(event))),
    second: second.map((event) => decoder.decode(encodeAgentTurnRequestSse(event)))
  };
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
      code: "provider_execution_failed",
      message,
      recoverable: true
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
