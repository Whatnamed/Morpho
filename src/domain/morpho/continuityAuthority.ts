import type { ContinuityRecordEntry, ContinuitySourceRef, ContinuityValidity, CurrentProjectFocus, MorphoWorkspace } from "./types";
import { resolveSource } from "./sourceResolution";
import { classifyDecisionRecord } from "./decisionRecords";

export type SemanticEntryTaskScope = {
  taskKind: "general" | "research" | "designDefinition" | "conceptDirection" | "directionPreview" | "visualDevelopment" | "deliveryPreparation" | "comparison" | "historyAndMemory";
  directObjectIds: readonly string[];
  directRevisionIds: readonly string[];
  directBranchIds: readonly string[];
  directDecisionIds: readonly string[];
  targetDirectionIds: readonly string[];
  targetRevisionIds?: readonly string[];
};

export type ContinuityEntryEligibility = {
  canEnterMemory: boolean;
  canEnterDefaultContext: boolean;
  canEnterReviewList: boolean;
  uiLabel: string;
  reason: string;
};

export function resolveContinuityValidity(workspace: MorphoWorkspace): MorphoWorkspace {
  const recordEntries = workspace.projectContinuity.recordEntries.map((entry) => {
    const reasons = getInvalidationReasons(workspace, entry);
    const sourceRefs = entry.sourceRefs.map((ref) => resolveSourceRefAvailability(workspace, ref));
    const resolvedReasons = [
      ...reasons,
      ...(sourceRefs.some((ref) => ref.sourceAvailability === "missing") ? ["sourceDeleted:sourceRef"] : [])
    ];
    const validity = validityFromReasons(resolvedReasons);
    const resolved = {
      ...entry,
      summary: normalizeDeterministicEntrySummary(workspace, entry),
      validity,
      sourceRefs,
      invalidationReasons: resolvedReasons.length > 0 ? [...new Set(resolvedReasons)] : undefined
    };
    return JSON.stringify(resolved) === JSON.stringify(entry) ? entry : resolved;
  });
  const currentFocus = normalizeCurrentFocusSummary(workspace.projectContinuity.currentFocus, recordEntries);

  if (currentFocus === workspace.projectContinuity.currentFocus && recordEntries.every((entry, index) => entry === workspace.projectContinuity.recordEntries[index])) return workspace;
  return {
    ...workspace,
    projectContinuity: {
      ...workspace.projectContinuity,
      currentFocus,
      recordEntries
    }
  };
}

export function getContinuityEntryEligibility(entry: ContinuityRecordEntry): ContinuityEntryEligibility {
  if (entry.supersededByEntryId || entry.manualState === "resolved") return { canEnterMemory: false, canEnterDefaultContext: false, canEnterReviewList: false, uiLabel: entry.supersededByEntryId ? "已被替代" : "已解决", reason: entry.supersededByEntryId ? "semanticSuperseded" : "manualState=resolved" };
  if (entry.manualState === "withdrawn") {
    return {
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: false,
      uiLabel: "已撤回",
      reason: "manualState=withdrawn"
    };
  }
  if (entry.manualState === "notApplicable") {
    return {
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: false,
      uiLabel: "当前不适用",
      reason: "manualState=notApplicable"
    };
  }

  const hasHiddenSource = entry.sourceRefs.some((ref) => ref.sourceAvailability === "hidden");
  const hasMissingSource = entry.sourceRefs.some((ref) => ref.sourceAvailability === "missing");
  if (hasMissingSource || entry.validity === "sourceUnavailable") {
    return {
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: true,
      uiLabel: "来源不可用",
      reason: "sourceUnavailable"
    };
  }
  if (hasHiddenSource) {
    return {
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: false,
      uiLabel: entry.validity === "current" ? "当前有效 · 来源已隐藏" : `${validityUiLabel(entry.validity)} · 来源已隐藏`,
      reason: "sourceAvailability=hidden"
    };
  }
  if (entry.validity === "reviewRequired") {
    return {
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: true,
      uiLabel: "待复核",
      reason: "validity=reviewRequired"
    };
  }
  if (entry.validity === "superseded") {
    return {
      canEnterMemory: false,
      canEnterDefaultContext: false,
      canEnterReviewList: false,
      uiLabel: "已被更新替代",
      reason: "validity=superseded"
    };
  }

  return {
    canEnterMemory: true,
    canEnterDefaultContext: true,
    canEnterReviewList: false,
    uiLabel: "当前有效",
    reason: "eligible"
  };
}

function normalizeDeterministicEntrySummary(workspace: MorphoWorkspace, entry: ContinuityRecordEntry): string {
  if (entry.origin !== "deterministicEvent" || !entry.dedupeKey.startsWith("defaultReferenceChanged:")) {
    return entry.summary;
  }
  const decisionRef = entry.sourceRefs.find((ref) => ref.kind === "decision");
  const decision = decisionRef
    ? workspace.decisionRecords.find((record) => record.id === decisionRef.id)
    : undefined;
  if (decision?.kind !== "setDefaultReference") {
    return entry.summary;
  }
  const objectRef = entry.sourceRefs.find((ref) => ref.kind === "object");
  const title = objectRef?.snapshot?.title ?? (objectRef ? workspace.objects[objectRef.id]?.title : undefined);
  if (!title) {
    return entry.summary;
  }
  return decision.summary.startsWith("清除后续默认参考")
    ? `已清除「${title}」的后续默认参考。`
    : `已将「${title}」设为后续默认参考。`;
}

function normalizeCurrentFocusSummary(
  currentFocus: CurrentProjectFocus,
  entries: ContinuityRecordEntry[]
): CurrentProjectFocus {
  const sourceObjectIds = [...currentFocus.sourceObjectIds].sort();
  const matchingEntry = [...entries].reverse().find((entry) => {
    if (entry.stage !== currentFocus.area || entry.updatedAt !== currentFocus.updatedAt) {
      return false;
    }
    const entryObjectIds = entry.sourceRefs
      .filter((ref) => ref.kind === "object")
      .map((ref) => ref.id)
      .sort();
    return entryObjectIds.length === sourceObjectIds.length && entryObjectIds.every((id, index) => id === sourceObjectIds[index]);
  });
  return matchingEntry && matchingEntry.summary !== currentFocus.note
    ? { ...currentFocus, note: matchingEntry.summary }
    : currentFocus;
}

function getInvalidationReasons(workspace: MorphoWorkspace, entry: ContinuityRecordEntry): string[] {
  const reasons: string[] = entry.supersededByEntryId ? [`semanticSuperseded:${entry.supersededByEntryId}`] : [];

  for (const ref of entry.sourceRefs) {
    if (ref.kind === "decision") {
      const decision = workspace.decisionRecords.find((record) => record.id === ref.id);
      if (!decision) reasons.push(`sourceDeleted:${ref.id}`);
      else {
        const state = classifyDecisionRecord(workspace, decision).state;
        if (state === "superseded" || state === "historical") reasons.push(`decisionSuperseded:${ref.id}`);
        if (state === "reviewRequired") reasons.push(`decisionReviewRequired:${ref.id}`);
      }
      continue;
    }
    if (ref.kind === "object") {
      const object = workspace.objects[ref.id];
      if (!object) {
        reasons.push(`sourceDeleted:${ref.id}`);
      } else if (object.type === "image" && ref.snapshot?.status === "defaultReference" && !object.isDefaultReference) {
        reasons.push(`defaultReferenceSuperseded:${ref.id}`);
      }
      continue;
    }

    if (ref.kind === "revision") {
      const definitionRevision = workspace.designDefinitionRevisions[ref.id];
      if (definitionRevision) {
        const owner = workspace.objects[definitionRevision.designDefinitionId];
        if (owner?.type === "designDefinition" && owner.currentRevisionId !== ref.id) {
          reasons.push(`definitionRevisionSuperseded:${ref.id}`);
        }
        continue;
      }
      const directionRevision = workspace.directionRevisions[ref.id];
      if (directionRevision) {
        const owner = workspace.objects[directionRevision.directionId];
        if (owner?.type === "conceptDirection" && owner.currentRevisionId !== ref.id) {
          reasons.push(`directionRevisionSuperseded:${ref.id}`);
        }
        continue;
      }
      reasons.push(`sourceDeleted:${ref.id}`);
      continue;
    }

    if (ref.kind === "branch") {
      const branch = workspace.visualBranches[ref.id];
      if (!branch) {
        reasons.push(`sourceDeleted:${ref.id}`);
      } else if (branch.archivedAt) {
        reasons.push(`branchArchived:${ref.id}`);
      }
    }
  }

  return [...new Set(reasons)];
}

function validityFromReasons(reasons: string[]): ContinuityValidity {
  if (reasons.some((reason) => reason.startsWith("sourceDeleted:"))) {
    return "sourceUnavailable";
  }
  if (reasons.some((reason) => reason.includes("Superseded"))) {
    return "superseded";
  }
  if (reasons.length > 0) {
    return "reviewRequired";
  }
  return "current";
}

function resolveSourceRefAvailability(workspace: MorphoWorkspace, ref: ContinuitySourceRef): ContinuitySourceRef {
  if (ref.kind === "message") {
    return {
      ...ref,
      sourceAvailability: workspace.ai.messages.some((message) => message.id === ref.id) ? "active" : "missing"
    };
  }

  if (ref.kind === "object") {
    const source = resolveSource(workspace, ref.id);
    return { ...ref, sourceAvailability: source.existence === "missing" ? "missing" : source.visibility === "hidden" ? "hidden" : "active" };
  }

  if (ref.kind === "revision") {
    const definitionRevision = workspace.designDefinitionRevisions[ref.id];
    if (definitionRevision) {
      return { ...ref, sourceAvailability: workspace.objects[definitionRevision.designDefinitionId]?.visibility === "hidden" ? "hidden" : workspace.objects[definitionRevision.designDefinitionId] ? "active" : "missing" };
    }
    const directionRevision = workspace.directionRevisions[ref.id];
    if (directionRevision) {
      return { ...ref, sourceAvailability: workspace.objects[directionRevision.directionId]?.visibility === "hidden" ? "hidden" : workspace.objects[directionRevision.directionId] ? "active" : "missing" };
    }
    return { ...ref, sourceAvailability: "missing" };
  }

  if (ref.kind === "branch") {
    return { ...ref, sourceAvailability: workspace.visualBranches[ref.id] ? "active" : "missing" };
  }

  if (ref.kind === "deliveryReference") {
    return { ...ref, sourceAvailability: workspace.deliveryReferences[ref.id] ? "active" : "missing" };
  }

  return { ...ref, sourceAvailability: "active" };
}

function validityUiLabel(validity: ContinuityValidity): string {
  switch (validity) {
    case "current":
      return "当前有效";
    case "reviewRequired":
      return "待复核";
    case "superseded":
      return "已被更新替代";
    case "sourceUnavailable":
      return "来源不可用";
  }
}

export function isSemanticEntryScopeRelevantToTaskContext(
  entry: Pick<ContinuityRecordEntry, "origin" | "scope" | "sourceRefs">,
  taskScope: SemanticEntryTaskScope
): boolean {
  const scope = entry.scope ?? "project";
  if (scope === "project") {
    return true;
  }

  const hasDirectMatch = hasTypedDirectSourceMatch(entry, taskScope);
  if (scope === "designDefinition") {
    if (hasDirectMatch) {
      return true;
    }
    return taskScope.taskKind === "designDefinition" || taskScope.taskKind === "conceptDirection" || taskScope.taskKind === "directionPreview" || taskScope.taskKind === "visualDevelopment";
  }

  if (scope === "direction") {
    if (!isDirectionScopedTask(taskScope.taskKind)) {
      return false;
    }
    return taskScope.targetDirectionIds.length > 0
      ? entry.sourceRefs.some((ref) => (ref.kind === "object" && taskScope.targetDirectionIds.includes(ref.id)) || (ref.kind === "revision" && (taskScope.targetRevisionIds ?? []).includes(ref.id)))
      : hasDirectMatch;
  }

  if (scope === "visual") {
    if (!isVisualScopedTask(taskScope.taskKind)) {
      return false;
    }
    return hasDirectMatch;
  }

  return false;
}

function hasTypedDirectSourceMatch(entry: Pick<ContinuityRecordEntry, "sourceRefs">, taskScope: SemanticEntryTaskScope): boolean {
  const directObjectIds = new Set([...taskScope.directObjectIds, ...taskScope.targetDirectionIds]);
  const directRevisionIds = new Set(taskScope.directRevisionIds);
  const directBranchIds = new Set(taskScope.directBranchIds);
  const directDecisionIds = new Set(taskScope.directDecisionIds);

  return entry.sourceRefs.some((ref) => {
    if (ref.kind === "object") {
      return directObjectIds.has(ref.id);
    }
    if (ref.kind === "revision") {
      return directRevisionIds.has(ref.id);
    }
    if (ref.kind === "branch") {
      return directBranchIds.has(ref.id);
    }
    if (ref.kind === "decision") {
      return directDecisionIds.has(ref.id);
    }
    return false;
  });
}

function isDirectionScopedTask(taskKind: SemanticEntryTaskScope["taskKind"]): boolean {
  return taskKind === "conceptDirection" || taskKind === "directionPreview" || taskKind === "visualDevelopment" || taskKind === "general";
}

function isVisualScopedTask(taskKind: SemanticEntryTaskScope["taskKind"]): boolean {
  return taskKind === "directionPreview" || taskKind === "visualDevelopment" || taskKind === "general";
}

/** Scope query over existing targets; does not grant Tool or effect authority. */
export function createProjectionTaskScope(workspace: MorphoWorkspace, input: Partial<SemanticEntryTaskScope> & Pick<SemanticEntryTaskScope, "taskKind">): SemanticEntryTaskScope {
  const targetDirectionIds = input.targetDirectionIds ?? [];
  return { directObjectIds: [], directRevisionIds: [], directBranchIds: [], directDecisionIds: [], ...input, targetDirectionIds,
    targetRevisionIds: targetDirectionIds.flatMap((id) => {
      const object = workspace.objects[id];
      return object?.type === "conceptDirection" ? [object.currentRevisionId] : [];
    }) };
}
