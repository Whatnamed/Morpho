import type {
  AiMessage,
  AiTaskMode,
  AgentTrace,
  MorphoWorkspace,
  ProviderOutputSnapshot,
  ProjectMemoryKey,
  StageRecordKey
} from "@/domain/morpho/types";
import type { ProviderCitation } from "@/server/ai/types";

export type FailedAgentTurnDraft = Readonly<{
  draft: string;
  taskMode: AiTaskMode;
  userMessageId: string;
  assistantMessageId: string;
  agentTurnId?: string;
}>;

/** Restores saved local input without resuming or creating a Provider request. */
export function getLatestFailedAgentTurnDraft(workspace: MorphoWorkspace): FailedAgentTurnDraft | null {
  const failedAssistant = [...workspace.ai.messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.status === "failed");
  if (!failedAssistant) return null;

  const pairedUser = findPairedUserMessage(workspace.ai.messages, failedAssistant);
  if (!pairedUser?.body.trim()) return null;

  return {
    draft: pairedUser.body,
    taskMode: pairedUser.taskMode ?? failedAssistant.taskMode ?? "chatAnalysis",
    userMessageId: pairedUser.id,
    assistantMessageId: failedAssistant.id,
    ...(failedAssistant.agentTurnId ? { agentTurnId: failedAssistant.agentTurnId } : {})
  };
}

function findPairedUserMessage(messages: AiMessage[], assistant: AiMessage): AiMessage | undefined {
  const direct = assistant.pairedMessageId
    ? messages.find((message) => message.id === assistant.pairedMessageId && message.role === "user")
    : undefined;
  if (direct) return direct;
  if (!assistant.agentTurnId) return undefined;
  return messages.find((message) => message.role === "user" && message.agentTurnId === assistant.agentTurnId);
}

export function updateAiMessage(
  workspace: MorphoWorkspace,
  messageId: string,
  body: string,
  status: "streaming" | "done" | "failed" | "cancelled",
  options: {
    citationIds?: string[];
    continuityEntryIds?: string[];
    memoryUpdateKeys?: ProjectMemoryKey[];
    stageRecordUpdateKeys?: StageRecordKey[];
    agentTrace?: AgentTrace;
    providerOutputSnapshot?: ProviderOutputSnapshot;
  } = {}
): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: workspace.ai.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              body,
              status,
              citationIds: options.citationIds ?? message.citationIds,
              continuityEntryIds: options.continuityEntryIds ?? message.continuityEntryIds,
              memoryUpdateKeys: options.memoryUpdateKeys ?? message.memoryUpdateKeys,
              stageRecordUpdateKeys: options.stageRecordUpdateKeys ?? message.stageRecordUpdateKeys,
              agentTrace: options.agentTrace ?? message.agentTrace,
              providerOutputSnapshot: options.providerOutputSnapshot ?? message.providerOutputSnapshot,
              error: status === "failed" ? body : undefined
            }
          : message
      )
    }
  };
}

export function storeMessageCitations(
  workspace: MorphoWorkspace,
  input: {
    messageId: string;
    operationId: string;
    citations: ProviderCitation[];
  }
): MorphoWorkspace {
  const now = new Date().toISOString();
  const citationEntries = input.citations.map((citation, index) => {
    const id = getAvailableCitationId(workspace, `${input.messageId}-citation-${index + 1}`);
    return {
      id,
      operationId: input.operationId,
      title: citation.title,
      url: citation.url,
      domain: citation.domain ?? domainFromUrl(citation.url),
      snippet: citation.snippet,
      retrievedAt: now
    };
  });

  return updateAiMessage(
    {
      ...workspace,
      citationSnapshots: {
        ...workspace.citationSnapshots,
        ...Object.fromEntries(citationEntries.map((citation) => [citation.id, citation]))
      }
    },
    input.messageId,
    workspace.ai.messages.find((message) => message.id === input.messageId)?.body ?? "",
    "done",
    {
      citationIds: citationEntries.map((citation) => citation.id)
    }
  );
}

export function getAvailableCitationId(workspace: MorphoWorkspace, preferredId: string): string {
  if (!workspace.citationSnapshots[preferredId]) {
    return preferredId;
  }

  let suffix = 2;
  while (workspace.citationSnapshots[`${preferredId}-${suffix}`]) {
    suffix += 1;
  }
  return `${preferredId}-${suffix}`;
}

export function domainFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
