import type {
  AiTaskMode,
  ProjectFocusArea
} from "./types";

export type SemanticPatchKind =
  | "preference"
  | "constraint"
  | "avoidance"
  | "openQuestion"
  | "decisionReason"
  | "rejectionReason";

export type SemanticPatchScope = "project" | "designDefinition" | "direction" | "visual";

export type ParsedConversationSemanticPatchItem = {
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

export function buildSemanticPatchAuthorization(input: BuildSemanticPatchAuthorizationInput): SemanticPatchAuthorization {
  if (input.taskMode !== "chatAnalysis" && input.taskMode !== "researchOperation") {
    throw new Error("Semantic patches are only authorized for chatAnalysis and researchOperation.");
  }

  return {
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
  authorization: SemanticPatchAuthorization
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

  const sourceIds = [...item.relatedObjectIds, ...item.relatedRevisionIds, ...item.relatedDecisionIds];
  if (sourceIds.length === 0 && item.scope !== "project") {
    return { status: "failed", reason: "Non-project semantic patches require an authorized direct source." };
  }

  const unauthorizedObject = item.relatedObjectIds.find((id) => !authorization.allowedObjectIds.has(id));
  if (unauthorizedObject) {
    return { status: "failed", reason: `unauthorized object source: ${unauthorizedObject}` };
  }
  const unauthorizedRevision = item.relatedRevisionIds.find((id) => !authorization.allowedRevisionIds.has(id));
  if (unauthorizedRevision) {
    return { status: "failed", reason: `unauthorized revision source: ${unauthorizedRevision}` };
  }
  const unauthorizedDecision = item.relatedDecisionIds.find((id) => !authorization.allowedDecisionIds.has(id));
  if (unauthorizedDecision) {
    return { status: "failed", reason: `unauthorized decision source: ${unauthorizedDecision}` };
  }
  if ((item.kind === "decisionReason" || item.kind === "rejectionReason") && item.relatedDecisionIds.length === 0) {
    return { status: "failed", reason: `${item.kind} requires an authorized decision source.` };
  }

  return { status: "ok", item, summary: buildSemanticPatchSummary(item) };
}

export function buildSemanticPatchSummary(item: Pick<ParsedConversationSemanticPatchItem, "kind" | "evidenceQuote">): string {
  return `${semanticKindSummaryPrefix(item.kind)}：${truncateText(item.evidenceQuote, SEMANTIC_PATCH_LIMITS.maxSummaryQuoteChars)}`;
}

export function stripProjectContinuityPatchBlock(text: string): string {
  return stripJsonBlockWithTopLevelKey(text, "morphoProjectContinuityPatch").trim();
}

const SEMANTIC_PATCH_LIMITS = {
  maxItems: 3,
  maxEvidenceQuoteChars: 180,
  maxSummaryQuoteChars: 96
} as const;

const PENDING_PROPOSAL_KEYS = [
  "morphoResearchProposal",
  "morphoDesignDefinitionProposal",
  "morphoConceptDirectionProposal"
] as const;

function containsPendingProposalBlock(text: string): boolean {
  return PENDING_PROPOSAL_KEYS.some((key) => Boolean(extractJsonBlock(text, key)));
}

function extractJsonBlock(text: string, topLevelKey: string): string | undefined {
  const fencedBlocks = Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))
    .map((match) => match[1]?.trim())
    .filter(Boolean);
  return fencedBlocks.find((block) => Boolean(block && hasTopLevelKey(block, topLevelKey)));
}

function stripJsonBlockWithTopLevelKey(text: string, topLevelKey: string): string {
  return text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (block, body: string) => (hasTopLevelKey(body.trim(), topLevelKey) ? "" : block));
}

function hasTopLevelKey(jsonText: string, topLevelKey: string): boolean {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return isRecord(parsed) && isRecord(parsed[topLevelKey]);
  } catch {
    return false;
  }
}

function parsePatchItem(value: unknown): ParsedConversationSemanticPatchItem | undefined {
  if (!isRecord(value) || !isSemanticPatchKind(value.kind) || !isSemanticPatchScope(value.scope) || typeof value.evidenceQuote !== "string") {
    return undefined;
  }

  const allowedKeys = ["kind", "scope", "evidenceQuote", "relatedObjectIds", "relatedRevisionIds", "relatedDecisionIds", "summary"];
  if (!hasOnlyAllowedKeys(value, allowedKeys)) {
    return undefined;
  }

  const illegalKeys = ["setDirectionPrimary", "setDefaultReference", "hideObject", "deleteObject", "updateDesignDefinition"];
  if (illegalKeys.some((key) => key in value)) {
    return undefined;
  }

  return {
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
