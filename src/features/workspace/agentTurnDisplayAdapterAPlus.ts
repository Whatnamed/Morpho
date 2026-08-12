import { sanitizeStructuredStreamForDisplay } from "@/domain/morpho/structuredBlocks";
import type { AgentTurnRequestStreamEvent } from "@/shared/agentTurnJournalProtocol";
import { isAgentRouteStreamEvent } from "@/shared/agentStreamProtocol";
import { updateAiMessage } from "./aiConversationMessages";
import { applyAgentStreamEventToTrace } from "./agentMessageTrace";
import type { AgentTurnHost } from "./agentTurnHost";
import type { PreparedAgentTurnAPlus } from "./agentTurnProductPreparationAPlus";

const AI_MESSAGE_TECHNICAL_MARKERS = [
  "morphoConversationSummary",
  "morphoProjectContinuityPatch",
  "morphoDesignDefinitionProposal",
  "morphoConceptDirectionProposal",
  "morphoComparisonAnalysis",
  "morphoDeliverySectionDraft",
  "morphoResearchProposal"
] as const;

export function createAgentTurnDisplayAdapterAPlus(input: Readonly<{
  host: AgentTurnHost;
  prepared: PreparedAgentTurnAPlus;
}>): (event: AgentTurnRequestStreamEvent) => void {
  return (event) => {
    if (event.type === "providerOutput") {
      if (event.outputText.trim()) {
        updateAssistant(input, event.outputText);
      }
      return;
    }
    if (event.type === "externalError") {
      const detail = externalErrorCopy(event.code);
      if (detail) appendAssistantFailureDetail(input, detail);
      return;
    }
    if (event.type !== "streamActivity" || !isAgentRouteStreamEvent(event.event)) return;
    const activity = event.event;
    if (activity.type === "citation") {
      const key = `${activity.citation.url ?? ""}\0${activity.citation.title}`;
      const existing = new Set(input.prepared.runtimeState.collectedCitations.map((citation) =>
        `${citation.url ?? ""}\0${citation.title}`
      ));
      if (!existing.has(key)) input.prepared.runtimeState.collectedCitations.push(activity.citation);
    }
    input.host.commitWorkspace((current) => {
      const message = current.ai.messages.find((candidate) => candidate.id === input.prepared.assistantMessageId);
      if (!message?.agentTrace) return { workspace: current, value: undefined };
      const nextTrace = applyAgentStreamEventToTrace(
        message.agentTrace,
        activity,
        new Date(input.host.now()).toISOString()
      );
      const body = activity.type === "final-delta"
        ? sanitizeStructuredStreamForDisplay(`${message.body}${activity.delta}`, AI_MESSAGE_TECHNICAL_MARKERS)
        : message.body;
      return {
        workspace: updateAiMessage(current, message.id, body, "streaming", { agentTrace: nextTrace }),
        value: undefined
      };
    });
  };
}

function appendAssistantFailureDetail(
  input: Readonly<{ host: AgentTurnHost; prepared: PreparedAgentTurnAPlus }>,
  detail: string
): void {
  input.host.commitWorkspace((current) => {
    const message = current.ai.messages.find(
      (candidate) => candidate.id === input.prepared.assistantMessageId
    );
    if (!message) return { workspace: current, value: undefined };
    const previous = message.body.trim();
    const body = previous.includes(detail)
      ? previous
      : [previous, detail].filter(Boolean).join("\n\n");
    return {
      workspace: updateAiMessage(current, message.id, body, "streaming", {
        ...(message.agentTrace ? { agentTrace: message.agentTrace } : {})
      }),
      value: undefined
    };
  });
}

function externalErrorCopy(code: string): string | undefined {
  const bounded = code.trim().slice(0, 100);
  if (!bounded || bounded === "provider_cancelled") return undefined;
  if (bounded === "provider_context_limit") return "模型上下文超出限制，本轮未完成。";
  if (bounded === "provider_function_call_limit") return "模型返回的工具调用过多，本轮未完成。";
  if (bounded === "provider_response_too_large") return "模型响应超过安全上限，本轮未完成。";
  if (bounded === "provider_deadline_exceeded") return "模型响应超时，本轮未完成。";
  if (bounded === "journal_settlement_failed") return "服务端状态暂未完成写入，请稍后再次检查。";
  const httpStatus = /^provider_http_(\d{3})$/.exec(bounded)?.[1];
  if (httpStatus) return `模型返回异常（HTTP ${httpStatus}），本轮未完成。`;
  return "模型返回异常，本轮未完成。";
}

function updateAssistant(
  input: Readonly<{ host: AgentTurnHost; prepared: PreparedAgentTurnAPlus }>,
  body: string
): void {
  const visible = sanitizeStructuredStreamForDisplay(body, AI_MESSAGE_TECHNICAL_MARKERS);
  input.host.commitWorkspace((current) => {
    const message = current.ai.messages.find((candidate) => candidate.id === input.prepared.assistantMessageId);
    if (!message) return { workspace: current, value: undefined };
    return {
      workspace: updateAiMessage(current, message.id, visible, "streaming", {
        ...(message.agentTrace ? { agentTrace: message.agentTrace } : {})
      }),
      value: undefined
    };
  });
}
