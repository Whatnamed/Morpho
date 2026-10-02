import { validateCurrentMorphoWorkspace } from "@/domain/morpho/currentWorkspaceValidation";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { completeManualHistoryMutation } from "@/domain/morpho/manualHistoryMutation";

export const MANUAL_HISTORY_LIMIT = 20;
type RecordValue = Record<string, unknown>;
type Change =
  | { kind: "value"; before: unknown; after: unknown }
  | { kind: "fields"; fields: Record<string, Change>; optionalEditorial?: boolean }
  | { kind: "items"; items: Record<string, Change>; beforeOrder: string[]; afterOrder: string[]; reorder: boolean; stringIds?: boolean };

/** Retains only one operation's delta, never a Workspace snapshot. */
export type ManualHistoryEntry = {
  label: string;
  projectId: string;
  changes: Change;
  identities: Record<string, { type: string; incarnationId?: string }>;
  revisions: Record<string, unknown>;
  semanticGuards: Record<string, { lifecycle: unknown; replacement?: string }>;
  canvasBindings: Record<string, string>;
  owners: { references: Record<string, string | undefined>; drafts: Record<string, string>; branches: Record<string, string | undefined> };
};
export type ManualHistory = { undo: ManualHistoryEntry[]; redo: ManualHistoryEntry[] };
export type ManualHistoryResult =
  | { status: "empty" }
  | { status: "blocked"; history: ManualHistory; conflicts: string[] }
  | { status: "restored"; history: ManualHistory; workspace: MorphoWorkspace; entry: ManualHistoryEntry };

export function createManualHistory(): ManualHistory { return { undo: [], redo: [] }; }
export function pushManualHistory(history: ManualHistory, entry: ManualHistoryEntry | null): ManualHistory {
  return entry ? { undo: [...history.undo.slice(-(MANUAL_HISTORY_LIMIT - 1)), entry], redo: [] } : history;
}
/** Capture the actual before/after of ONE successful explicit manual commit. */
export function captureManualHistory(label: string, before: MorphoWorkspace, after: MorphoWorkspace): ManualHistoryEntry | null {
  if (before.project.id !== after.project.id) return null;
  const addedObjects = new Set(Object.keys(after.objects).filter((id) => !before.objects[id]));
  // A region activates once when its first object joins. That rendering
  // bookkeeping is retained, just like auto-grow, rather than deactivating a
  // region which may now contain independent results on creation Undo.
  const automaticActivation = new Set((after.canvas.stageRegions ?? []).filter((region) => region.memberObjectIds.some((id) => addedObjects.has(id)))
    .map((region) => `.canvas.stageRegions.${region.id}.isActivated`));
  const changes = diff(manualState(before), manualState(after), "", automaticActivation);
  if (!changes) return null;
  const identities: ManualHistoryEntry["identities"] = {};
  const objectChanges = changes.kind === "fields" ? changes.fields.objects : undefined;
  for (const id of Object.keys(objectChanges?.kind === "fields" ? objectChanges.fields : {})) {
    const object = before.objects[id] ?? after.objects[id];
    if (object) identities[id] = { type: object.type, incarnationId: object.incarnationId };
  }
  const canvasBindings: Record<string, string> = {};
  for (const instance of [...before.canvas.instances, ...after.canvas.instances]) {
    const previous = before.canvas.instances.find((item) => item.id === instance.id);
    const next = after.canvas.instances.find((item) => item.id === instance.id);
    if (sameValue(previous, next)) continue;
    canvasBindings[instance.id] = instance.objectId;
    const object = before.objects[instance.objectId] ?? after.objects[instance.objectId];
    if (object) identities[object.id] = { type: object.type, incarnationId: object.incarnationId };
  }
  const owners: ManualHistoryEntry["owners"] = { references: {}, drafts: {}, branches: {} };
  const rememberOwner = (id: string) => {
    const object = before.objects[id] ?? after.objects[id];
    if (object) identities[id] = { type: object.type, incarnationId: object.incarnationId };
  };
  for (const record of [...Object.values(before.deliveryReferences), ...Object.values(after.deliveryReferences)]) {
    if (!diff(before.deliveryReferences[record.id], after.deliveryReferences[record.id])) continue;
    owners.references[record.id] = record.deliveryObjectId;
    if (record.deliveryObjectId) rememberOwner(record.deliveryObjectId);
  }
  for (const record of [...Object.values(before.deliverySectionDrafts), ...Object.values(after.deliverySectionDrafts)]) {
    if (!diff(before.deliverySectionDrafts[record.id], after.deliverySectionDrafts[record.id])) continue;
    owners.drafts[record.id] = record.deliveryObjectId; rememberOwner(record.deliveryObjectId);
  }
  for (const record of [...Object.values(before.visualBranches), ...Object.values(after.visualBranches)]) {
    if (!diff(before.visualBranches[record.id], after.visualBranches[record.id])) continue;
    owners.branches[record.id] = record.directionId;
    if (record.directionId) rememberOwner(record.directionId);
  }
  const revisions: Record<string, unknown> = {};
  for (const id of Object.keys(identities)) {
    for (const object of [before.objects[id], after.objects[id]]) {
      if (object?.type !== "conceptDirection" && object?.type !== "designDefinition") continue;
      const store = object.type === "conceptDirection" ? after.directionRevisions : after.designDefinitionRevisions;
      const revision = store[object.currentRevisionId];
      if (revision) {
        const { isCurrent: _isCurrent, ...payload } = revision;
        revisions[object.currentRevisionId] = structuredClone(payload);
      }
    }
  }
  const semanticGuards: ManualHistoryEntry["semanticGuards"] = {};
  for (const record of after.projectContinuity.recordEntries) {
    const previous = before.projectContinuity.recordEntries.find((item) => item.id === record.id);
    if (previous && previous.manualState !== record.manualState) semanticGuards[record.id] = { lifecycle: lifecycleIdentity(record.lifecycleEvidence), replacement: record.supersededByEntryId };
  }
  return { label, projectId: before.project.id, changes, identities, revisions, semanticGuards, canvasBindings, owners };
}
export function undoManualHistory(history: ManualHistory, current: MorphoWorkspace): ManualHistoryResult { return restore(history, current, "undo"); }
export function redoManualHistory(history: ManualHistory, current: MorphoWorkspace): ManualHistoryResult { return restore(history, current, "redo"); }

/** Renderer auto-grow completes a created/restored instance's display size. It
 * may update that lifecycle entry's present-side baseline only with an exact
 * prior match and an unchanged owned object. Manual resize and runtime content
 * writes never use this port and are still checked as conflicts.
 */
export function absorbCanvasMeasurements(history: ManualHistory, before: MorphoWorkspace, after: MorphoWorkspace): ManualHistory {
  const update = (entry: ManualHistoryEntry, side: "before" | "after") => {
    if (entry.projectId !== before.project.id) return entry;
    const root = entry.changes;
    if (root.kind !== "fields") return entry;
    const canvas = root.fields.canvas;
    const instances = canvas?.kind === "fields" ? canvas.fields.instances : undefined;
    const objects = root.fields.objects;
    if (canvas?.kind !== "fields" || instances?.kind !== "items" || objects?.kind !== "fields") return entry;
    let items = instances.items;
    for (const [id, change] of Object.entries(items)) {
      if (change.kind !== "value" || change[side === "before" ? "after" : "before"] !== undefined) continue;
      const previous = before.canvas.instances.find((item) => item.id === id), next = after.canvas.instances.find((item) => item.id === id);
      if (!previous || !next || sameValue(previous.size, next.size) || !sameValue(change[side], previous)) continue;
      if (!sameValue({ ...previous, size: next.size }, next)) continue;
      const objectChange = objects.fields[previous.objectId];
      if (objectChange?.kind !== "value" || !sameValue(objectChange[side], manualState(before).objects[previous.objectId]) || !sameValue(before.objects[previous.objectId], after.objects[previous.objectId])) continue;
      items = { ...items, [id]: { ...change, [side]: structuredClone(next) } };
    }
    return items === instances.items ? entry : {
      ...entry, changes: { ...root, fields: { ...root.fields,
        canvas: { ...canvas, fields: { ...canvas.fields, instances: { ...instances, items } } }
      } }
    };
  };
  return { undo: history.undo.map((entry) => update(entry, "after")), redo: history.redo.map((entry) => update(entry, "before")) };
}

function restore(history: ManualHistory, current: MorphoWorkspace, direction: "undo" | "redo"): ManualHistoryResult {
  const entry = history[direction].at(-1);
  if (!entry) return { status: "empty" };
  const conflicts: string[] = [];
  if (current.project.id !== entry.projectId) conflicts.push("project.id");
  for (const [id, identity] of Object.entries(entry.identities)) {
    const object = current.objects[id];
    if (object && (object.type !== identity.type || object.incarnationId !== identity.incarnationId)) conflicts.push(`objects.${id}.incarnationId`);
  }
  for (const [id, objectId] of Object.entries(entry.canvasBindings)) {
    const instance = current.canvas.instances.find((item) => item.id === id);
    if (instance && instance.objectId !== objectId) conflicts.push(`canvas.instances.${id}.objectId`);
  }
  for (const [id, owner] of Object.entries(entry.owners.references)) if (current.deliveryReferences[id] && current.deliveryReferences[id].deliveryObjectId !== owner) conflicts.push(`deliveryReferences.${id}.owner`);
  for (const [id, owner] of Object.entries(entry.owners.drafts)) if (current.deliverySectionDrafts[id] && current.deliverySectionDrafts[id].deliveryObjectId !== owner) conflicts.push(`deliverySectionDrafts.${id}.owner`);
  for (const [id, owner] of Object.entries(entry.owners.branches)) if (current.visualBranches[id] && current.visualBranches[id].directionId !== owner) conflicts.push(`visualBranches.${id}.owner`);
  for (const [id, payload] of Object.entries(entry.revisions)) {
    const revision = current.directionRevisions[id] ?? current.designDefinitionRevisions[id];
    if (!revision) { conflicts.push(`revisions.${id}`); continue; }
    const { isCurrent: _isCurrent, ...currentPayload } = revision;
    if (!sameValue(payload, currentPayload)) conflicts.push(`revisions.${id}`);
  }
  for (const [id, guard] of Object.entries(entry.semanticGuards)) {
    const record = current.projectContinuity.recordEntries.find((item) => item.id === id);
    if (!record || record.supersededByEntryId !== guard.replacement || !sameValue(lifecycleIdentity(record.lifecycleEvidence), guard.lifecycle)) conflicts.push(`projectContinuity.${id}.lifecycle`);
  }
  check(entry.changes, manualState(current), direction, "workspace", conflicts);
  if (conflicts.length) return { status: "blocked", history, conflicts };
  const changed = apply(entry.changes, current, direction) as MorphoWorkspace;
  // Runtime, revisions, Decisions and projection history come from CURRENT.
  let candidate: MorphoWorkspace = {
    ...current, ...changed,
    project: { ...current.project, ...changed.project },
    canvas: { ...current.canvas, ...changed.canvas },
    // Keep current navigation/selection, pruning only targets removed by this
    // inverse. A deleted target cannot remain a live persisted selection ref.
    ui: { ...current.ui, lastSelectionIds: current.ui.lastSelectionIds.filter((id) => changed.objects[id]?.visibility === "active") },
    projectContinuity: {
      ...current.projectContinuity,
      recordEntries: current.projectContinuity.recordEntries.map((record) => ({ ...record, ...changed.projectContinuity.recordEntries.find((item) => item.id === record.id) }))
    }
  };
  // Reconciliation must never demote an independent current owner to fix a collision.
  if (Object.values(candidate.objects).filter((o) => o.type === "conceptDirection" && o.status === "primary").length > 1) conflicts.push("primaryDirection");
  if (Object.values(candidate.objects).filter((o) => o.type === "designDefinition" && o.isCurrentEffective).length > 1) conflicts.push("currentDesignDefinition");
  if (Object.values(candidate.objects).filter((o) => o.type === "image" && o.isDefaultReference).length > 1) conflicts.push("defaultReference");
  if (conflicts.length) return { status: "blocked", history, conflicts };
  candidate = completeManualHistoryMutation(current, candidate, `${direction === "undo" ? "撤销" : "重做"}：${entry.label}`);
  // Independent dependencies may make an inverse invalid even if its fields match.
  const validation = validateCurrentMorphoWorkspace(candidate);
  if (validation.status === "failed") return { status: "blocked", history, conflicts: validation.issues.map((issue) => issue.path) };
  const inverse = direction === "undo" ? "redo" : "undo";
  const nextEntry = { ...entry, semanticGuards: { ...entry.semanticGuards } };
  for (const id of Object.keys(entry.semanticGuards)) {
    const record = candidate.projectContinuity.recordEntries.find((item) => item.id === id)!;
    nextEntry.semanticGuards[id] = { lifecycle: lifecycleIdentity(record.lifecycleEvidence), replacement: record.supersededByEntryId };
  }
  return { status: "restored", workspace: candidate, entry, history: {
    ...history, [direction]: history[direction].slice(0, -1), [inverse]: [...history[inverse].slice(-(MANUAL_HISTORY_LIMIT - 1)), nextEntry]
  } };
}
function lifecycleIdentity(value: MorphoWorkspace["projectContinuity"]["recordEntries"][number]["lifecycleEvidence"]): unknown {
  if (!value) return undefined;
  const { createdAt: _createdAt, ...identity } = value;
  return structuredClone(identity);
}

function manualState(workspace: MorphoWorkspace) {
  return {
    project: { title: workspace.project.title, subtitle: workspace.project.subtitle },
    // Evidence qualification is a P1B projection, not a manual write. Use stable
    // reported/basis values when computing and checking deltas, then requalify.
    objects: Object.fromEntries(Object.entries(workspace.objects).map(([id, object]) => [id,
      object.type === "keyConclusion" ? { ...object, confidence: "needsVerification" as const } :
        object.type === "research" ? { ...object, evidence: object.evidence?.map((item) => ({ ...item, confidence: item.basis?.confidence ?? item.reportedConfidence ?? "needsVerification" as const })) } : object
    ])), relations: workspace.relations,
    deliveryReferences: workspace.deliveryReferences, deliverySectionDrafts: workspace.deliverySectionDrafts,
    visualBranches: workspace.visualBranches,
    canvas: { instances: workspace.canvas.instances, stageRegions: workspace.canvas.stageRegions },
    // Event history is append-only; only an existing record's user-owned lifecycle is reversible.
    projectContinuity: { recordEntries: workspace.projectContinuity.recordEntries.map(({ id, manualState }) => ({ id, manualState })) }
  };
}
function diff(before: unknown, after: unknown, path = "", excluded = new Set<string>()): Change | null {
  if (sameValue(before, after) || path.endsWith(".updatedAt") || excluded.has(path)) return null;
  // Editorial starts absent. Creating its container owns the edited fields,
  // not a later independent caption/note written into that same container.
  if (/^\.deliveryReferences\..+\.editorial$/.test(path) &&
      (before === undefined || isRecord(before)) && (after === undefined || isRecord(after))) {
    const change = diff(before ?? {}, after ?? {}, `${path}#fields`, excluded);
    return change?.kind === "fields" ? { ...change, optionalEditorial: true } : change;
  }
  if (/\.(referenceIds|references|memberObjectIds|revisionIds|sourceObjectIds|citationIds)$/.test(path) &&
      Array.isArray(before) && Array.isArray(after) && [...before, ...after].every((id: unknown) => typeof id === "string") &&
      new Set(before).size === before.length && new Set(after).size === after.length) {
    const change = diff(before.map((id: string) => ({ id })), after.map((id: string) => ({ id })), `${path}#ids`, excluded);
    return change?.kind === "items" ? { ...change, stringIds: true } : change;
  }
  if (path === ".projectContinuity.recordEntries") {
    const previous = keyed(before), next = keyed(after), items: Record<string, Change> = {};
    for (const [id, record] of Object.entries(previous ?? {})) {
      if (!next?.[id]) continue;
      const change = diff(record, next[id], `${path}.${id}`, excluded);
      if (change) items[id] = change;
    }
    return Object.keys(items).length ? { kind: "items", items, beforeOrder: [], afterOrder: [], reorder: false } : null;
  }
  if (isRecord(before) && isRecord(after)) {
    const fields: Record<string, Change> = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const change = diff(before[key], after[key], `${path}.${key}`, excluded);
      if (change) fields[key] = change;
    }
    return Object.keys(fields).length ? { kind: "fields", fields } : null;
  }
  const left = keyed(before), right = keyed(after);
  if (left && right) {
    const items: Record<string, Change> = {};
    for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const change = diff(left[id], right[id], `${path}.${id}`, excluded);
      if (change) items[id] = change;
    }
    const beforeOrder = Object.keys(left), afterOrder = Object.keys(right);
    const common = new Set(beforeOrder.filter((id) => id in right));
    const reorder = !sameValue(beforeOrder.filter((id) => common.has(id)), afterOrder.filter((id) => common.has(id)));
    return Object.keys(items).length || reorder ? { kind: "items", items, beforeOrder, afterOrder, reorder } : null;
  }
  return { kind: "value", before: structuredClone(before), after: structuredClone(after) };
}
function check(change: Change, current: unknown, direction: "undo" | "redo", path: string, conflicts: string[]): void {
  if (change.kind === "value") {
    if (!sameValue(current, direction === "undo" ? change.after : change.before, true)) conflicts.push(path);
  } else if (change.kind === "fields") {
    if (change.optionalEditorial && current === undefined) current = {};
    if (!isRecord(current)) { conflicts.push(path); return; }
    for (const [key, child] of Object.entries(change.fields)) check(child, current[key], direction, `${path}.${key}`, conflicts);
  } else {
    const records = keyed(change.stringIds && Array.isArray(current) ? current.map((id: string) => ({ id })) : current);
    if (!records) { conflicts.push(path); return; }
    for (const [id, child] of Object.entries(change.items)) check(child, records[id], direction, `${path}.${id}`, conflicts);
    if (change.reorder) {
      const expected = direction === "undo" ? change.afterOrder : change.beforeOrder;
      const owned = new Set([...change.beforeOrder, ...change.afterOrder]);
      if (!sameValue(Object.keys(records).filter((id) => owned.has(id)), expected)) conflicts.push(`${path}.order`);
    }
  }
}
function apply(change: Change, current: unknown, direction: "undo" | "redo"): unknown {
  if (change.kind === "value") return structuredClone(direction === "undo" ? change.before : change.after);
  if (change.kind === "fields") {
    const record = { ...(current as RecordValue) };
    for (const [key, child] of Object.entries(change.fields)) {
      const value = apply(child, record[key], direction);
      if (value === undefined) delete record[key]; else record[key] = value;
    }
    return change.optionalEditorial && !Object.values(record).some((value) => value !== undefined) ? undefined : record;
  }
  const currentRecords = change.stringIds ? (current as string[]).map((id) => ({ id })) : current as RecordValue[];
  const records = { ...keyed(currentRecords) };
  for (const [id, child] of Object.entries(change.items)) {
    const value = apply(child, records[id], direction);
    if (value === undefined) delete records[id]; else records[id] = value as RecordValue;
  }
  const target = direction === "undo" ? change.beforeOrder : change.afterOrder;
  let order = currentRecords.map((record) => record.id as string).filter((id) => id in records);
  // Unowned records retain their values and relative order. Only owned slots reorder.
  if (change.reorder) {
    const owned = new Set([...change.beforeOrder, ...change.afterOrder]);
    const desired = target.filter((id) => order.includes(id));
    let index = 0;
    order = order.map((id) => owned.has(id) ? desired[index++] : id);
  }
  for (const id of target) {
    if (!(id in records) || order.includes(id)) continue;
    const previous = target.slice(0, target.indexOf(id)).reverse().find((item) => order.includes(item));
    const next = target.slice(target.indexOf(id) + 1).find((item) => order.includes(item));
    order.splice(previous ? order.indexOf(previous) + 1 : next ? order.indexOf(next) : order.length, 0, id);
  }
  return change.stringIds ? order : order.map((id) => records[id]);
}
function isRecord(value: unknown): value is RecordValue { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keyed(value: unknown): Record<string, RecordValue> | null {
  if (!Array.isArray(value) || !value.every((item: unknown) => isRecord(item) && typeof item.id === "string")) return null;
  const entries = value.map((item: RecordValue) => [item.id as string, item] as const);
  return new Set(entries.map(([id]) => id)).size === entries.length ? Object.fromEntries(entries) : null;
}
export function sameValue(left: unknown, right: unknown, ignoreUpdatedAt = false): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index], ignoreUpdatedAt));
  if (!isRecord(left) || !isRecord(right)) return false;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every((key) => (ignoreUpdatedAt && key === "updatedAt") || sameValue(left[key], right[key], ignoreUpdatedAt));
}
