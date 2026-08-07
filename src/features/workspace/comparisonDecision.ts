import type {
  AssignableKeyConclusionCategory,
  ComparisonDecisionMetadata,
  MorphoObjectId,
  MorphoWorkspace
} from "@/domain/morpho/types";
import { isAssignableKeyConclusionCategory } from "@/domain/morpho/types";
import {
  clearDefaultReference,
  createKeyConclusion,
  eliminateDirection,
  setConceptDirectionStatus,
  setDefaultReference
} from "@/domain/morpho/workspace";

import {
  validateComparisonActionTarget,
  validateComparisonKeyConclusionSources,
  type ComparisonActionKind
} from "./comparisonAction";

export type PendingKeyConclusionDraft = {
  title: string;
  body: string;
  summary: string;
  category: AssignableKeyConclusionCategory;
  confidence: "supported" | "partial" | "needsVerification";
  note?: string;
};

type PendingComparisonConfirmationBase = {
  targetObjectId: MorphoObjectId;
  targetTitle: string;
  comparisonAnalysisId: string;
  comparisonAssistantMessageId: string;
  comparisonSourceObjectIds: MorphoObjectId[];
  summary: string;
  userReason: string;
  reasonRequired: boolean;
};

export type PendingComparisonConfirmation =
  | (PendingComparisonConfirmationBase & { kind: "compareSetPrimary"; keyConclusionDraft?: PendingKeyConclusionDraft })
  | (PendingComparisonConfirmationBase & { kind: "compareSetAlternative"; keyConclusionDraft?: PendingKeyConclusionDraft })
  | (PendingComparisonConfirmationBase & { kind: "compareEliminate"; keyConclusionDraft?: PendingKeyConclusionDraft })
  | (PendingComparisonConfirmationBase & { kind: "compareRestoreAlternative"; keyConclusionDraft?: PendingKeyConclusionDraft })
  | (PendingComparisonConfirmationBase & { kind: "compareSetDefaultReference"; keyConclusionDraft?: PendingKeyConclusionDraft })
  | (PendingComparisonConfirmationBase & { kind: "compareClearDefaultReference"; keyConclusionDraft?: PendingKeyConclusionDraft })
  | ({
      kind: "compareCreateKeyConclusion";
      targetTitle: string;
      comparisonAnalysisId: string;
      comparisonAssistantMessageId: string;
      comparisonSourceObjectIds: MorphoObjectId[];
      keyConclusionSourceObjectIds: MorphoObjectId[];
      summary: string;
      userReason: string;
      reasonRequired: boolean;
      keyConclusionDraft: PendingKeyConclusionDraft;
    });

export type ComparisonActionRequest = ComparisonActionKind;

export type PrepareComparisonDecisionResult =
  | {
      status: "ready";
      confirmation: PendingComparisonConfirmation;
    }
  | {
      status: "blocked";
      reason: string;
    };

export type ApplyComparisonDecisionResult =
  | {
      status: "applied";
      workspace: MorphoWorkspace;
      notice: string;
      selectionObjectIds?: MorphoObjectId[];
      focusObjectId?: MorphoObjectId;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

const COMPARISON_CONFIRMATION_KINDS = new Set([
  "compareSetPrimary",
  "compareSetAlternative",
  "compareEliminate",
  "compareRestoreAlternative",
  "compareSetDefaultReference",
  "compareClearDefaultReference",
  "compareCreateKeyConclusion"
]);

export function isComparisonPendingConfirmation(
  confirmation: { kind?: string } | null | undefined
): confirmation is PendingComparisonConfirmation {
  return Boolean(confirmation && COMPARISON_CONFIRMATION_KINDS.has(confirmation.kind ?? ""));
}

export function isComparisonDecisionReasonRequired(action: ComparisonActionKind): boolean {
  return (
    action === "eliminate" ||
    action === "restoreAlternative" ||
    action === "setDefaultReference" ||
    action === "clearDefaultReference"
  );
}

export function comparisonActionFromPending(confirmation: PendingComparisonConfirmation): ComparisonActionKind {
  switch (confirmation.kind) {
    case "compareSetPrimary":
      return "setPrimary";
    case "compareSetAlternative":
      return "setAlternative";
    case "compareEliminate":
      return "eliminate";
    case "compareRestoreAlternative":
      return "restoreAlternative";
    case "compareSetDefaultReference":
      return "setDefaultReference";
    case "compareClearDefaultReference":
      return "clearDefaultReference";
    case "compareCreateKeyConclusion":
      return "createKeyConclusion";
  }
}

export function prepareComparisonDecision(
  workspace: MorphoWorkspace,
  analysisId: string,
  action: ComparisonActionKind,
  objectId?: MorphoObjectId
): PrepareComparisonDecisionResult {
  const validation = validateComparisonActionTarget(workspace, analysisId, action, objectId);
  if (validation.status !== "ok") {
    return validation;
  }

  const analysis = workspace.ai.comparisonAnalyses?.[analysisId];
  if (!analysis) {
    return { status: "blocked", reason: "Comparison analysis no longer exists." };
  }

  const summary = analysis.conclusionSummary.trim() || "用户将根据这份 Compare 分析做出决定。";
  const reasonRequired = isComparisonDecisionReasonRequired(action);

  if (action === "createKeyConclusion") {
    const candidate = analysis.keyConclusionCandidate;
    if (!candidate || !isAssignableKeyConclusionCategory(candidate.category)) {
      return { status: "blocked", reason: "Comparison analysis has no key conclusion candidate." };
    }

    const sourceCheck = validateComparisonKeyConclusionSources(workspace, analysisId, candidate.sourceObjectIds);
    if (sourceCheck.status !== "ok") {
      return sourceCheck;
    }

    return {
      status: "ready",
      confirmation: {
        kind: "compareCreateKeyConclusion",
        targetTitle: candidate.title,
        comparisonAnalysisId: analysis.id,
        comparisonAssistantMessageId: analysis.assistantMessageId,
        comparisonSourceObjectIds: [...analysis.sourceObjectIds],
        keyConclusionSourceObjectIds: [...candidate.sourceObjectIds],
        summary,
        userReason: "",
        reasonRequired,
        keyConclusionDraft: {
          title: candidate.title,
          body: candidate.body,
          summary: candidate.summary,
          category: candidate.category,
          confidence: candidate.confidence,
          note: candidate.note
        }
      }
    };
  }

  const targetObject = validation.targetObject;
  const targetObjectId = validation.targetObjectId;
  if (!targetObject || !targetObjectId) {
    return { status: "blocked", reason: "Comparison action target is unavailable." };
  }

  const confirmationBase = {
    targetObjectId,
    targetTitle: targetObject.title,
    comparisonAnalysisId: analysis.id,
    comparisonAssistantMessageId: analysis.assistantMessageId,
    comparisonSourceObjectIds: [...analysis.sourceObjectIds],
    summary,
    userReason: "",
    reasonRequired
  };

  switch (action) {
    case "setPrimary":
      return { status: "ready", confirmation: { ...confirmationBase, kind: "compareSetPrimary" } };
    case "setAlternative":
      return { status: "ready", confirmation: { ...confirmationBase, kind: "compareSetAlternative" } };
    case "eliminate":
      return { status: "ready", confirmation: { ...confirmationBase, kind: "compareEliminate" } };
    case "restoreAlternative":
      return { status: "ready", confirmation: { ...confirmationBase, kind: "compareRestoreAlternative" } };
    case "setDefaultReference":
      return { status: "ready", confirmation: { ...confirmationBase, kind: "compareSetDefaultReference" } };
    case "clearDefaultReference":
      return { status: "ready", confirmation: { ...confirmationBase, kind: "compareClearDefaultReference" } };
  }
}

export function applyConfirmedComparisonDecision(
  workspace: MorphoWorkspace,
  confirmation: PendingComparisonConfirmation
): ApplyComparisonDecisionResult {
  const action = comparisonActionFromPending(confirmation);
  if (confirmation.reasonRequired !== isComparisonDecisionReasonRequired(action)) {
    return blockedComparisonDecision(workspace, "Compare 决定的理由规则已发生变化，请重新发起确认。");
  }

  const userReason = confirmation.userReason.trim();
  if (confirmation.reasonRequired && !userReason) {
    return blockedComparisonDecision(workspace, "请先填写此 Compare 决定的理由。");
  }

  const validation = validateComparisonActionTarget(
    workspace,
    confirmation.comparisonAnalysisId,
    action,
    "targetObjectId" in confirmation ? confirmation.targetObjectId : undefined
  );
  if (validation.status !== "ok") {
    return blockedComparisonDecision(workspace, validation.reason);
  }

  const analysis = workspace.ai.comparisonAnalyses?.[confirmation.comparisonAnalysisId];
  if (!analysis) {
    return blockedComparisonDecision(workspace, "Comparison analysis no longer exists.");
  }
  if (
    analysis.assistantMessageId !== confirmation.comparisonAssistantMessageId ||
    !sameIdSet(analysis.sourceObjectIds, confirmation.comparisonSourceObjectIds)
  ) {
    return blockedComparisonDecision(workspace, "Compare 分析在确认前已发生变化，请重新发起决定。");
  }

  const comparison: ComparisonDecisionMetadata = {
    comparisonAnalysisId: analysis.id,
    comparisonAssistantMessageId: analysis.assistantMessageId,
    comparisonSourceObjectIds: [...analysis.sourceObjectIds],
    userReason: userReason || undefined
  };
  const reason = userReason || "用户已明确确认此 Compare 决定。";
  const targetObject = validation.targetObject;
  const targetTitle = targetObject?.title ?? confirmation.targetTitle;

  if (action === "createKeyConclusion") {
    const candidate = analysis.keyConclusionCandidate;
    if (
      !candidate ||
      !isAssignableKeyConclusionCategory(candidate.category) ||
      confirmation.kind !== "compareCreateKeyConclusion"
    ) {
      return blockedComparisonDecision(workspace, "Comparison analysis has no key conclusion candidate.");
    }

    const sourceCheck = validateComparisonKeyConclusionSources(
      workspace,
      analysis.id,
      confirmation.keyConclusionSourceObjectIds
    );
    if (sourceCheck.status !== "ok") {
      return blockedComparisonDecision(workspace, sourceCheck.reason);
    }

    const result = createKeyConclusion(workspace, {
      title: candidate.title,
      body: candidate.body,
      summary: candidate.summary,
      sourceObjectIds: [...candidate.sourceObjectIds],
      category: candidate.category,
      confidence: candidate.confidence,
      note: userReason || candidate.note,
      position: {
        x: workspace.canvas.view.x + 240,
        y: workspace.canvas.view.y + 180
      },
      comparison
    });

    return {
      status: "applied",
      workspace: result.workspace,
      notice: `已保存关键结论「${result.keyConclusion.title}」`,
      selectionObjectIds: [result.keyConclusion.id],
      focusObjectId: result.keyConclusion.id
    };
  }

  if (!targetObject) {
    return blockedComparisonDecision(workspace, "Comparison action target is unavailable.");
  }

  if (action === "setPrimary" || action === "setAlternative" || action === "restoreAlternative") {
    const status = action === "setPrimary" ? "primary" : "alternative";
    return {
      status: "applied",
      workspace: setConceptDirectionStatus(workspace, targetObject.id, status, reason, comparison),
      notice:
        action === "restoreAlternative"
          ? `已将「${targetTitle}」恢复为备选方向`
          : action === "setPrimary"
            ? `已将「${targetTitle}」设为主方向`
            : `已将「${targetTitle}」设为备选方向`
    };
  }

  if (action === "eliminate") {
    return {
      status: "applied",
      workspace: eliminateDirection(workspace, targetObject.id, { reason, comparison }),
      notice: `已淘汰方向「${targetTitle}」`
    };
  }

  if (action === "setDefaultReference") {
    return {
      status: "applied",
      workspace: setDefaultReference(workspace, targetObject.id, { reason, comparison }),
      notice: `已设「${targetTitle}」为后续默认参考`
    };
  }

  return {
    status: "applied",
    workspace: clearDefaultReference(workspace, targetObject.id, { reason, comparison }),
    notice: `已取消「${targetTitle}」的后续默认参考`
  };
}

export function resolveComparisonWritebackSourceObjectIds(confirmation: PendingComparisonConfirmation): string[] {
  return confirmation.kind === "compareCreateKeyConclusion"
    ? confirmation.keyConclusionSourceObjectIds
    : confirmation.comparisonSourceObjectIds;
}

function blockedComparisonDecision(workspace: MorphoWorkspace, reason: string): ApplyComparisonDecisionResult {
  return { status: "blocked", workspace, reason };
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length || new Set(left).size !== left.length || new Set(right).size !== right.length) {
    return false;
  }

  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}
