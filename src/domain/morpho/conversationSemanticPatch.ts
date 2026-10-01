import type {
  AiTaskMode,
  ContinuitySourceRef,
  MorphoWorkspace,
  ProjectFocusArea
} from "./types";
import {
  extractStructuredJsonBlock,
  sanitizeStructuredStreamForDisplay,
  stripStructuredBlocksContainingMarkers
} from "./structuredBlocks";

export type SemanticPatchKind =
  | "preference"
  | "constraint"
  | "avoidance"
  | "openQuestion"
  | "decisionReason"
  | "rejectionReason";

export type SemanticPatchScope = "project" | "designDefinition" | "direction" | "visual";

export type ParsedConversationSemanticPatchItem = {
  action?: "assert" | "supersede" | "retract" | "resolve";
  targetEntryId?: string;
  kind: SemanticPatchKind;
  scope: SemanticPatchScope;
  evidenceQuote: string;
  relatedObjectIds: string[];
  relatedRevisionIds: string[];
  relatedDecisionIds: string[];
};

export type ParseProjectContinuityPatchResult =
  | {
      status: "ok";
      items: ParsedConversationSemanticPatchItem[];
    }
  | {
      status: "empty";
      reason: string;
    }
  | {
      status: "blockedByProposal";
      reason: string;
    }
  | {
      status: "failed";
      reason: string;
    };

export type SemanticPatchAuthorization = {
  allowedEntryIds: Set<string>;
  taskMode: Extract<AiTaskMode, "chatAnalysis" | "researchOperation">;
  draft: string;
  normalizedDraft: string;
  userMessageId: string;
  userMessageCreatedAt: string;
  currentFocusArea: ProjectFocusArea;
  allowedObjectIds: Set<string>;
  allowedRevisionIds: Set<string>;
  allowedDecisionIds: Set<string>;
};

export type BuildSemanticPatchAuthorizationInput = {
  entryIds?: string[];
  taskMode: AiTaskMode;
  draft: string;
  userMessageId: string;
  userMessageCreatedAt: string;
  currentFocusArea: ProjectFocusArea;
  objectIds: string[];
  revisionIds: string[];
  decisionIds: string[];
};

export type ValidateConversationSemanticPatchResult =
  | {
      status: "ok";
      item: ParsedConversationSemanticPatchItem;
      summary: string;
    }
  | {
      status: "failed";
      reason: string;
    };

export function hasSemanticLifecycleRequest(draft: string): boolean {
  return /(?:撤回|取消|替代|取代|改为|改成|不再沿用).{0,40}(?:偏好|约束|预算|上限|避免|问题)|(?:偏好|约束|预算|上限|避免|问题).{0,40}(?:撤回|取消|替代|取代|改为|改成|已解决|解决了|已确认)|(?:retract|withdraw|replace|supersede|resolved|answered).{0,40}(?:preference|constraint|question)|(?:preference|constraint|question).{0,40}(?:retracted|withdrawn|replaced|superseded|resolved|answered)/i.test(draft);
}

export function buildSemanticPatchAuthorization(input: BuildSemanticPatchAuthorizationInput): SemanticPatchAuthorization {
  if (input.taskMode !== "chatAnalysis" && input.taskMode !== "researchOperation") {
    throw new Error("Semantic patches are only authorized for chatAnalysis and researchOperation.");
  }

  return {
    allowedEntryIds: new Set(input.entryIds ?? []),
    taskMode: input.taskMode,
    draft: input.draft,
    normalizedDraft: normalizeForQuoteMatch(input.draft),
    userMessageId: input.userMessageId,
    userMessageCreatedAt: input.userMessageCreatedAt,
    currentFocusArea: input.currentFocusArea,
    allowedObjectIds: new Set(input.objectIds),
    allowedRevisionIds: new Set(input.revisionIds),
    allowedDecisionIds: new Set(input.decisionIds)
  };
}

export function parseProjectContinuityPatchPayload(text: string): ParseProjectContinuityPatchResult {
  if (containsPendingProposalBlock(text)) {
    return { status: "blockedByProposal", reason: "Semantic patch is blocked when the same reply contains a pending Proposal." };
  }

  const jsonText = extractJsonBlock(text, "morphoProjectContinuityPatch");
  if (!jsonText) {
    return { status: "empty", reason: "No morphoProjectContinuityPatch block was returned." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { status: "failed", reason: "The morphoProjectContinuityPatch block was not valid JSON." };
  }

  if (!isRecord(parsed) || !isRecord(parsed.morphoProjectContinuityPatch)) {
    return { status: "failed", reason: "The JSON block did not contain morphoProjectContinuityPatch." };
  }
  if (!hasOnlyAllowedKeys(parsed.morphoProjectContinuityPatch, ["items"])) {
    return { status: "failed", reason: "morphoProjectContinuityPatch contains unexpected top-level fields." };
  }

  const rawItems = parsed.morphoProjectContinuityPatch.items;
  if (!Array.isArray(rawItems)) {
    return { status: "failed", reason: "morphoProjectContinuityPatch.items must be an array." };
  }
  if (rawItems.length > SEMANTIC_PATCH_LIMITS.maxItems) {
    return { status: "failed", reason: `morphoProjectContinuityPatch.items exceeds ${SEMANTIC_PATCH_LIMITS.maxItems}.` };
  }

  const items: ParsedConversationSemanticPatchItem[] = [];
  for (const rawItem of rawItems) {
    const item = parsePatchItem(rawItem);
    if (!item) {
      return { status: "failed", reason: "morphoProjectContinuityPatch contains an invalid semantic patch item." };
    }
    items.push(item);
  }
  if (items.length === 0) {
    return { status: "failed", reason: "No valid semantic patch items were present." };
  }

  return { status: "ok", items };
}

export function validateConversationSemanticPatch(
  item: ParsedConversationSemanticPatchItem,
  authorization: SemanticPatchAuthorization,
  workspace?: MorphoWorkspace
): ValidateConversationSemanticPatchResult {
  if (!isSemanticPatchKind(item.kind)) {
    return { status: "failed", reason: "Invalid semantic patch kind." };
  }
  if (!isSemanticPatchScope(item.scope)) {
    return { status: "failed", reason: "Invalid semantic patch scope." };
  }
  if (!item.evidenceQuote.trim()) {
    return { status: "failed", reason: "evidenceQuote is required." };
  }
  if (item.evidenceQuote.length > SEMANTIC_PATCH_LIMITS.maxEvidenceQuoteChars) {
    return { status: "failed", reason: "evidenceQuote exceeds the maximum length." };
  }
  if (!authorization.normalizedDraft.includes(normalizeForQuoteMatch(item.evidenceQuote))) {
    return { status: "failed", reason: "evidenceQuote must be a substring of the current user message." };
  }
  if (looksUnsafeForContinuity(item.evidenceQuote)) {
    return { status: "failed", reason: "evidenceQuote contains content that cannot be stored in continuity records." };
  }
  if (item.action && item.action !== "assert") {
    if (!item.targetEntryId || !authorization.allowedEntryIds.has(item.targetEntryId)) {
      return { status: "failed", reason: "Semantic lifecycle requires an authorized targetEntryId." };
    }
    const explicit = item.action === "supersede" ? /替代|取代|改为|改成|调整为|不再沿用|replace|supersede/i
      : item.action === "retract" ? /撤回|取消|不再|retract|withdraw/i : /已解决|解决了|已确认|已经确认|resolved|answered/i;
    if (!explicit.test(item.evidenceQuote)) return { status: "failed", reason: "Semantic lifecycle requires explicit user evidence for the requested action." };
  } else if (item.targetEntryId) {
    return { status: "failed", reason: "An assertion cannot silently modify a target entry." };
  }

  const sourceIds = [...item.relatedObjectIds, ...item.relatedRevisionIds, ...item.relatedDecisionIds];
  if (sourceIds.length === 0 && item.scope !== "project") {
    return { status: "failed", reason: "Non-project semantic patches require an authorized direct source." };
  }

  // Retracting/resolving an authorized fact does not consume its old sources as new evidence.
  // The use case checks exact target scope; historical missing sources need not be re-authorized.
  const retiresFact = item.action === "retract" || item.action === "resolve";
  const unauthorizedObject = !retiresFact && item.relatedObjectIds.find((id) => !authorization.allowedObjectIds.has(id));
  if (unauthorizedObject) {
    return { status: "failed", reason: `unauthorized object source: ${unauthorizedObject}` };
  }
  const unauthorizedRevision = !retiresFact && item.relatedRevisionIds.find((id) => !authorization.allowedRevisionIds.has(id));
  if (unauthorizedRevision) {
    return { status: "failed", reason: `unauthorized revision source: ${unauthorizedRevision}` };
  }
  const unauthorizedDecision = !retiresFact && item.relatedDecisionIds.find((id) => !authorization.allowedDecisionIds.has(id));
  if (unauthorizedDecision) {
    return { status: "failed", reason: `unauthorized decision source: ${unauthorizedDecision}` };
  }
  if ((item.kind === "decisionReason" || item.kind === "rejectionReason") && item.relatedDecisionIds.length === 0) {
    return { status: "failed", reason: `${item.kind} requires an authorized decision source.` };
  }

  if (!retiresFact && (item.scope === "designDefinition" || item.scope === "direction")) {
    if (!workspace) return { status: "failed", reason: "Owner-scoped semantic writes require Workspace owner resolution." };
    const owner = resolveSemanticScopeOwner(workspace, item.scope, [
      ...item.relatedObjectIds.map((id) => ({ kind: "object" as const, id })),
      ...item.relatedRevisionIds.map((id) => ({ kind: "revision" as const, id }))
    ]);
    if (owner.status !== "bound") {
      return { status: "failed", reason: `${item.scope} scope requires exactly one explicit authorized owner object / owned revision; scope owner is ${owner.status}. Incidental evidence cannot replace the owner.` };
    }
    const object = workspace.objects[owner.objectId];
    if (object?.type !== "designDefinition" && object?.type !== "conceptDirection") {
      return { status: "failed", reason: "Semantic scope owner is unavailable." };
    }
    const current = object.type === "designDefinition" ? workspace.designDefinitionRevisions[object.currentRevisionId] : workspace.directionRevisions[object.currentRevisionId];
    if (object.visibility !== "active" || !current ||
      ("designDefinitionId" in current ? current.designDefinitionId : current.directionId) !== object.id) {
      return { status: "failed", reason: "Semantic scope owner must have an available owned current revision." };
    }
    if (item.relatedRevisionIds.some((id) => {
      const revision = item.scope === "designDefinition" ? workspace.designDefinitionRevisions[id] : workspace.directionRevisions[id];
      return revision && id !== object.currentRevisionId;
    })) return { status: "failed", reason: "Semantic scope binding must use its owner's current revision." };
  }

  return { status: "ok", item, summary: buildSemanticPatchSummary(item) };
}

/** Resolve explicit bindings only; never infer a fact's owner from incidental evidence or current focus. */
export function resolveSemanticScopeOwner(
  workspace: Pick<MorphoWorkspace, "objects" | "designDefinitionRevisions" | "directionRevisions">,
  scope: "designDefinition" | "direction",
  refs: readonly Pick<ContinuitySourceRef, "kind" | "id">[]
): { status: "bound"; objectId: string } | { status: "unbound" | "ambiguous" } {
  const owners = new Set<string>();
  const type = scope === "designDefinition" ? "designDefinition" : "conceptDirection";
  for (const ref of refs) {
    const revision = ref.kind === "revision" ? (scope === "designDefinition" ? workspace.designDefinitionRevisions[ref.id] : workspace.directionRevisions[ref.id]) : undefined;
    const objectId = ref.kind === "object" ? ref.id : revision ? ("designDefinitionId" in revision ? revision.designDefinitionId : revision.directionId) : undefined;
    if (objectId && workspace.objects[objectId]?.type === type) owners.add(objectId);
  }
  return owners.size === 1 ? { status: "bound", objectId: [...owners][0]! } : { status: owners.size === 0 ? "unbound" : "ambiguous" };
}

export function buildSemanticPatchSummary(item: Pick<ParsedConversationSemanticPatchItem, "kind" | "evidenceQuote">): string {
  return `${semanticKindSummaryPrefix(item.kind)}：${truncateText(item.evidenceQuote, SEMANTIC_PATCH_LIMITS.maxSummaryQuoteChars)}`;
}

export function stripProjectContinuityPatchBlock(text: string): string {
  return stripFencedBlocksContainingMarker(text, "morphoProjectContinuityPatch").trim();
}

export function sanitizeAssistantStreamForDisplay(rawText: string): string {
  return sanitizeStructuredStreamForDisplay(rawText, ["morphoProjectContinuityPatch"]);
}

const SEMANTIC_PATCH_LIMITS = {
  maxItems: 3,
  maxEvidenceQuoteChars: 180,
  maxSummaryQuoteChars: 96
} as const;

const PENDING_PROPOSAL_KEYS = [
  "morphoDesignDefinitionProposal",
  "morphoConceptDirectionProposal"
] as const;

function containsPendingProposalBlock(text: string): boolean {
  return PENDING_PROPOSAL_KEYS.some((key) => Boolean(extractStructuredJsonBlock(text, key)));
}

function extractJsonBlock(text: string, topLevelKey: string): string | undefined {
  return extractStructuredJsonBlock(text, topLevelKey);
}

function stripFencedBlocksContainingMarker(text: string, marker: string): string {
  return stripStructuredBlocksContainingMarkers(text, [marker]);
}

function parsePatchItem(value: unknown): ParsedConversationSemanticPatchItem | undefined {
  if (!isRecord(value) || !isSemanticPatchKind(value.kind) || !isSemanticPatchScope(value.scope) || typeof value.evidenceQuote !== "string") {
    return undefined;
  }

  if (value.action !== undefined && !["assert", "supersede", "retract", "resolve"].includes(String(value.action))) return undefined;
  if (value.targetEntryId !== undefined && typeof value.targetEntryId !== "string") return undefined;
  const allowedKeys = ["kind", "scope", "evidenceQuote", "relatedObjectIds", "relatedRevisionIds", "relatedDecisionIds", "summary", "action", "targetEntryId"];
  if (!hasOnlyAllowedKeys(value, allowedKeys)) {
    return undefined;
  }

  const illegalKeys = ["setDirectionPrimary", "setDefaultReference", "hideObject", "deleteObject", "updateDesignDefinition"];
  if (illegalKeys.some((key) => key in value)) {
    return undefined;
  }

  return {
    ...(value.action === undefined ? {} : { action: value.action as ParsedConversationSemanticPatchItem["action"] }),
    ...(typeof value.targetEntryId === "string" ? { targetEntryId: value.targetEntryId } : {}),
    kind: value.kind,
    scope: value.scope,
    evidenceQuote: value.evidenceQuote.trim(),
    relatedObjectIds: stringArray(value.relatedObjectIds),
    relatedRevisionIds: stringArray(value.relatedRevisionIds),
    relatedDecisionIds: stringArray(value.relatedDecisionIds)
  };
}

function semanticKindSummaryPrefix(kind: SemanticPatchKind): string {
  switch (kind) {
    case "preference":
      return "明确偏好";
    case "constraint":
      return "明确约束";
    case "avoidance":
      return "明确避免项";
    case "openQuestion":
      return "待确认问题";
    case "decisionReason":
      return "决策理由";
    case "rejectionReason":
      return "淘汰理由";
  }
}

function normalizeForQuoteMatch(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function looksUnsafeForContinuity(value: string): boolean {
  return /data:[^\s]+;base64,|provider raw payload|https?:\/\//i.test(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))] : [];
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function isSemanticPatchKind(value: unknown): value is SemanticPatchKind {
  return value === "preference" || value === "constraint" || value === "avoidance" || value === "openQuestion" || value === "decisionReason" || value === "rejectionReason";
}

function isSemanticPatchScope(value: unknown): value is SemanticPatchScope {
  return value === "project" || value === "designDefinition" || value === "direction" || value === "visual";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}
