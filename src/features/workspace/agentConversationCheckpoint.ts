import {
  applyConversationCheckpoint,
  getUsableConversationCheckpoint,
  parseConversationCheckpointPayload,
  sanitizeConversationAssistantStreamForDisplay,
  type ConversationCheckpointTaskKind
} from "@/domain/morpho/conversationCheckpoint";
import type { MorphoObjectId, MorphoWorkspace, ProjectFocusArea, VisualBranchId } from "@/domain/morpho/types";

type ApplyAgentConversationCheckpointInput = {
  laneKey: string;
  currentFocus: {
    area: ProjectFocusArea;
    updatedAt: string;
  };
  taskKind: ConversationCheckpointTaskKind;
  anchorObjectIds: MorphoObjectId[];
  targetDirectionIds: MorphoObjectId[];
  visualBranchId?: VisualBranchId;
  assistantMessageId: string;
  replyText: string;
  requested: boolean;
  hasPendingProposal: boolean;
  now?: string;
};

export type ApplyAgentConversationCheckpointResult = {
  workspace: MorphoWorkspace;
  visibleText: string;
  status: "applied" | "notRequested" | "missing" | "invalid" | "skipped";
};

export function applyAgentConversationCheckpointFromReply(
  workspace: MorphoWorkspace,
  input: ApplyAgentConversationCheckpointInput
): ApplyAgentConversationCheckpointResult {
  const visibleText = sanitizeConversationAssistantStreamForDisplay(input.replyText);
  if (!input.requested) {
    return {
      workspace,
      visibleText,
      status: "notRequested"
    };
  }

  const parsed = parseConversationCheckpointPayload(input.replyText);
  if (parsed.status === "empty") {
    return {
      workspace,
      visibleText,
      status: "missing"
    };
  }
  if (parsed.status !== "ok") {
    return {
      workspace,
      visibleText,
      status: "invalid"
    };
  }

  const sourceMessages = workspace.ai.messages.filter(
    (message) =>
      message.conversationLaneKey === input.laneKey &&
      message.taskMode === "chatAnalysis" &&
      message.status !== "failed" &&
      message.status !== "streaming" &&
      !message.error &&
      (message.role === "user" || message.role === "assistant")
  );
  const currentCheckpoint = getUsableConversationCheckpoint(workspace, input.laneKey);
  const sourceStartMessageId =
    currentCheckpoint?.sourceStartMessageId ?? sourceMessages[0]?.id ?? input.assistantMessageId;
  const laneTimeline = workspace.ai.messages.filter(
    (message) => message.conversationLaneKey === input.laneKey
  );
  const sourceStartIndex = laneTimeline.findIndex((message) => message.id === sourceStartMessageId);
  const sourceEndIndex = laneTimeline.findIndex((message) => message.id === input.assistantMessageId);
  const sourceMessageCount =
    sourceStartIndex >= 0 && sourceEndIndex >= sourceStartIndex
      ? sourceEndIndex - sourceStartIndex + 1
      : sourceMessages.length;
  const applied = applyConversationCheckpoint(workspace, {
    laneKey: input.laneKey,
    currentFocus: input.currentFocus,
    taskKind: input.taskKind,
    anchorObjectIds: input.anchorObjectIds,
    targetDirectionIds: input.targetDirectionIds,
    visualBranchId: input.visualBranchId,
    sourceStartMessageId,
    sourceEndMessageId: input.assistantMessageId,
    sourceMessageCount,
    assistantMessageId: input.assistantMessageId,
    checkpoint: parsed.checkpoint,
    hasPendingProposal: input.hasPendingProposal,
    now: input.now
  });

  return {
    workspace: applied.workspace,
    visibleText,
    status: applied.status === "applied" ? "applied" : "skipped"
  };
}
