import { reconcileWorkspaceDerivedState } from "./derivedState";
import { resolveContinuityValidity } from "./continuityAuthority";
import { applyProjectContinuityEvent, setConversationSemanticEntryManualState } from "./projectContinuity";
import type { DecisionEffect, DecisionRecord, MorphoObject, MorphoWorkspace } from "./types";

/** Complete a checked local inverse without removing historical authority records.
 * Effects use the existing P1B vocabulary and bind the restored object's identity.
 * Provider/Operation/Proposal state is never executed or written here.
 */
export function completeManualHistoryMutation(before: MorphoWorkspace, after: MorphoWorkspace, reason: string): MorphoWorkspace {
  const now = new Date().toISOString();
  const decisions: DecisionRecord[] = [];
  let next = after;
  for (const id of new Set([...Object.keys(before.objects), ...Object.keys(after.objects)])) {
    const previous = before.objects[id], object = after.objects[id];
    if (previous === object) continue;
    const effects: DecisionEffect[] = [];
    if (!object && previous) effects.push({ kind: "deleteObject", targetObjectId: id, targetIncarnationId: previous.incarnationId });
    if (object) {
      const target = { targetObjectId: id, targetIncarnationId: object.incarnationId };
      if (object.type === "conceptDirection") {
        if (previous?.type !== "conceptDirection" || previous.status !== object.status) effects.push({ ...target, kind: "setDirectionStatus", status: object.status });
        if (previous?.type !== "conceptDirection" || previous.currentRevisionId !== object.currentRevisionId) effects.push({ ...target, kind: "applyConceptDirection", revisionId: object.currentRevisionId });
      }
      if (object.type === "designDefinition" && object.isCurrentEffective && (previous?.type !== "designDefinition" || !previous.isCurrentEffective || previous.currentRevisionId !== object.currentRevisionId)) effects.push({ ...target, kind: "applyDesignDefinition", revisionId: object.currentRevisionId });
      if (object.type === "image") {
        if (previous?.type === "image" && previous.role !== object.role) effects.push({ ...target, kind: "setImageRole", role: object.role });
        if (object.isDefaultReference && (previous?.type !== "image" || !previous.isDefaultReference)) effects.push({ ...target, kind: "setDefaultReference", referenceObjectId: id });
      }
      if (object.type === "keyConclusion") {
        if (!previous) effects.push({ ...target, kind: "createKeyConclusion" });
        if (previous?.type === "keyConclusion" && previous.category !== object.category && object.category !== "unknown") effects.push({ ...target, kind: "setKeyConclusionCategory", category: object.category });
        if (previous?.type === "keyConclusion" && (previous.state !== object.state || previous.supersededById !== object.supersededById)) effects.push({ ...target, kind: "setKeyConclusionState", state: object.state, supersededById: object.supersededById });
      }
    }
    const targetObject = object ?? previous;
    if (targetObject) for (const effect of effects) decisions.push(decision(effect, targetObject, reason, now));
    // Only the changed object's old/new current revision flags are owned. All
    // revision payloads and independent objects' revision flags remain intact.
    if ((previous?.type === "conceptDirection" || object?.type === "conceptDirection") &&
        (previous?.type !== "conceptDirection" || object?.type !== "conceptDirection" || previous.currentRevisionId !== object.currentRevisionId)) {
      next = { ...next, directionRevisions: { ...next.directionRevisions } };
      if (previous?.type === "conceptDirection" && next.directionRevisions[previous.currentRevisionId]) next.directionRevisions[previous.currentRevisionId] = { ...next.directionRevisions[previous.currentRevisionId], isCurrent: false };
      if (object?.type === "conceptDirection" && next.directionRevisions[object.currentRevisionId]) next.directionRevisions[object.currentRevisionId] = { ...next.directionRevisions[object.currentRevisionId], isCurrent: true };
    }
    if ((previous?.type === "designDefinition" || object?.type === "designDefinition") &&
        (previous?.type !== "designDefinition" || object?.type !== "designDefinition" || previous.currentRevisionId !== object.currentRevisionId)) {
      next = { ...next, designDefinitionRevisions: { ...next.designDefinitionRevisions } };
      if (previous?.type === "designDefinition" && next.designDefinitionRevisions[previous.currentRevisionId]) next.designDefinitionRevisions[previous.currentRevisionId] = { ...next.designDefinitionRevisions[previous.currentRevisionId], isCurrent: false };
      if (object?.type === "designDefinition" && next.designDefinitionRevisions[object.currentRevisionId]) next.designDefinitionRevisions[object.currentRevisionId] = { ...next.designDefinitionRevisions[object.currentRevisionId], isCurrent: true };
    }
  }
  const oldReference = Object.values(before.objects).find((o) => o.type === "image" && o.isDefaultReference);
  if (oldReference && !Object.values(after.objects).some((o) => o.type === "image" && o.isDefaultReference)) decisions.push(decision({ kind: "setDefaultReference", targetObjectId: oldReference.id, targetIncarnationId: oldReference.incarnationId, referenceObjectId: null }, oldReference, reason, now));
  next = { ...next, decisionRecords: [...next.decisionRecords, ...decisions] };
  for (const record of decisions) {
    const effect = record.effect;
    if (effect?.kind === "setDirectionStatus") next = applyProjectContinuityEvent(next, { type: "directionStatusChanged", directionObjectId: effect.targetObjectId, status: effect.status, decisionId: record.id, createdAt: now });
  }
  for (const record of after.projectContinuity.recordEntries) {
    const previous = before.projectContinuity.recordEntries.find((item) => item.id === record.id);
    if (!previous || previous.manualState === record.manualState) continue;
    if (record.origin === "deterministicEvent") {
      // P1B permits deterministic withdrawal via manualState, but semantic
      // lifecycleEvidence/supersession is reserved for semantic facts.
      next = { ...next, projectContinuity: { ...next.projectContinuity,
        recordEntries: next.projectContinuity.recordEntries.map((item) => item.id === record.id ? { ...item, manualState: record.manualState, updatedAt: now } : item), updatedAt: now
      } };
      continue;
    }
    // Use the existing P1B lifecycle use case to record this new user action,
    // rather than attaching stale withdrawal/resolve evidence to restored state.
    next = setConversationSemanticEntryManualState({ ...next, projectContinuity: {
      ...next.projectContinuity, recordEntries: next.projectContinuity.recordEntries.map((item) => item.id === record.id ? { ...item, manualState: previous.manualState, lifecycleEvidence: previous.lifecycleEvidence } : item)
    } }, record.id, record.manualState, now);
  }
  // Compensation events must not take Current Focus from a later independent
  // writer. The history boundary already selected the owned inverse or current B.
  next = { ...next, projectContinuity: { ...next.projectContinuity, currentFocus: after.projectContinuity.currentFocus } };
  // Resolve qualification before rebuilding Memory/Stage projections.
  return reconcileWorkspaceDerivedState(resolveContinuityValidity(reconcileWorkspaceDerivedState(next, now)), now);
}
function decision(effect: DecisionEffect, object: MorphoObject, reason: string, createdAt: string): DecisionRecord {
  return { id: `decision-manual-history-${crypto.randomUUID()}`, kind: effect.kind, effect, createdAt, summary: effect.kind === "setDirectionStatus" ? `${object.title} -> ${effect.status}` : effect.kind === "applyConceptDirection" ? `采用方向修订：${object.title}` : `${reason} — ${object.title}`, reason, objectSnapshot: { id: object.id, type: object.type, title: object.title }, relatedObjectIds: [object.id] };
}
