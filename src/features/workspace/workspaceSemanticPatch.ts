import type { AiTaskMode, MorphoWorkspace } from "../../domain/morpho/types";
import {
  applyConversationSemanticPatch,
  type ApplyConversationSemanticPatchResult
} from "../../domain/morpho/projectContinuity";
import {
  buildSemanticPatchAuthorization,
  parseProjectContinuityPatchPayload,
  stripProjectContinuityPatchBlock,
  type BuildSemanticPatchAuthorizationInput,
  type ParsedConversationSemanticPatchItem
} from "../../domain/morpho/conversationSemanticPatch";

import type { TaskContextResult } from "./taskContext";

export type ConversationSemanticPatchClientResult =
  | {
      status: "applied";
      workspace: MorphoWorkspace;
      visibleBody: string;
      entryIds: string[];
      rejected: ApplyConversationSemanticPatchResult["rejected"];
    }
  | {
      status: "skipped";
      workspace: MorphoWorkspace;
      visibleBody: string;
      reason: string;
    };

export type ApplyConversationSemanticPatchFromReplyInput = {
  workspace: MorphoWorkspace;
  taskMode: AiTaskMode;
  context: TaskContextResult;
  draft: string;
  userMessageId: string;
  userMessageCreatedAt: string;
  assistantText: string;
  blockWhenProposalPresent?: boolean;
};

export function applyConversationSemanticPatchFromReply(
  input: ApplyConversationSemanticPatchFromReplyInput
): ConversationSemanticPatchClientResult {
  const visibleBody = stripProjectContinuityPatchBlock(input.assistantText);
  if (input.taskMode !== "chatAnalysis" && input.taskMode !== "researchOperation") {
    return { status: "skipped", workspace: input.workspace, visibleBody, reason: "taskMode" };
  }
  if (input.blockWhenProposalPresent) {
    return { status: "skipped", workspace: input.workspace, visibleBody, reason: "proposal" };
  }

  const parsed = parseProjectContinuityPatchPayload(input.assistantText);
  if (parsed.status !== "ok") {
    return { status: "skipped", workspace: input.workspace, visibleBody, reason: parsed.reason };
  }

  const authorization = buildSemanticPatchAuthorization(buildSemanticPatchAuthorizationInput(input));
  const applied = applyConversationSemanticPatch(input.workspace, authorization, parsed.items);
  const entryIds = applied.entries.map((entry) => entry.id);
  if (entryIds.length === 0) {
    return { status: "skipped", workspace: applied.workspace, visibleBody, reason: "no eligible entries" };
  }

  return {
    status: "applied",
    workspace: applied.workspace,
    visibleBody,
    entryIds,
    rejected: applied.rejected
  };
}

export function buildSemanticPatchAuthorizationInput(
  input: Pick<
    ApplyConversationSemanticPatchFromReplyInput,
    "taskMode" | "context" | "draft" | "userMessageId" | "userMessageCreatedAt" | "workspace"
  >
): BuildSemanticPatchAuthorizationInput {
  return {
    taskMode: input.taskMode,
    draft: input.draft,
    userMessageId: input.userMessageId,
    userMessageCreatedAt: input.userMessageCreatedAt,
    currentFocusArea: input.workspace.projectContinuity.currentFocus.area,
    objectIds: input.context.objectIds,
    revisionIds: collectAuthorizedRevisionIds(input.context),
    decisionIds: collectAuthorizedDecisionIds(input.context)
  };
}

function collectAuthorizedRevisionIds(context: TaskContextResult): string[] {
  return uniqueStrings([
    context.designDefinitionRevision?.id,
    ...context.directionRevisions.map((revision) => revision.id)
  ]);
}

function collectAuthorizedDecisionIds(context: TaskContextResult): string[] {
  return uniqueStrings(
    [
      ...context.projectContinuity.relevantStageRecords,
      ...context.projectContinuity.reviewRequiredItems,
      ...context.projectContinuity.relevantProjectMemoryViews.flatMap((view) => view.items)
    ].flatMap((item) => item.sourceRefs.filter((ref) => ref.kind === "decision").map((ref) => ref.id))
  );
}

export function hasSemanticPatchItems(items: ParsedConversationSemanticPatchItem[]): boolean {
  return items.length > 0;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
