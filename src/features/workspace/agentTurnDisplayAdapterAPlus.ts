import { sanitizeConversationAssistantStreamForDisplay } from "@/domain/morpho/conversationCheckpoint";
import type { AgentTurnRequestStreamEvent } from "@/shared/agentTurnJournalProtocol";
import { isAgentRouteStreamEvent } from "@/shared/agentStreamProtocol";
import { updateAiMessage } from "./aiConversationMessages";
import { applyAgentStreamEventToTrace } from "./agentMessageTrace";
import type { AgentTurnHost } from "./agentTurnHost";
import type { PreparedAgentTurnAPlus } from "./agentTurnProductPreparationAPlus";

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
        ? sanitizeConversationAssistantStreamForDisplay(`${message.body}${activity.delta}`)
        : message.body;
      return {
        workspace: updateAiMessage(current, message.id, body, "streaming", { agentTrace: nextTrace }),
        value: undefined
      };
    });
  };
}

function updateAssistant(
  input: Readonly<{ host: AgentTurnHost; prepared: PreparedAgentTurnAPlus }>,
  body: string
): void {
  const visible = sanitizeConversationAssistantStreamForDisplay(body);
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
