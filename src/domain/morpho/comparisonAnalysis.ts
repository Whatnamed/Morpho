import type {
  ComparisonAnalysis,
  ComparisonKeyConclusionCandidate,
  ComparisonObjectEntry,
  ComparisonSourceRef,
  FileObject,
  MorphoObject,
  MorphoObjectId,
  MorphoObjectType,
  MorphoWorkspace
} from "./types";
import {
  extractStructuredJsonBlock,
  sanitizeStructuredStreamForDisplay,
  stripStructuredBlocksContainingMarkers
} from "./structuredBlocks";

const COMPARISON_MARKER = "morphoComparisonAnalysis";
const PROPOSAL_KEYS = ["morphoDesignDefinitionProposal", "morphoConceptDirectionProposal"] as const;
const ALLOWED_TYPES = new Set<MorphoObjectType>([
  "file",
  "image",
  "research",
  "keyConclusion",
  "documentFragment",
  "conceptDirection"
]);
const COMPARISON_GOAL_PATTERN = /目标|标准|维度|价值|风险|差异|取舍|继续|发展|契合|偏离|默认参考|主方向|备选|淘汰|结论|compare|comparison/i;

export type ComparisonAuthorization = {
  selectionObjectIds: MorphoObjectId[];
  sourceRefs: ComparisonSourceRef[];
  userMessageId: string;
  assistantMessageId: string;
  createdAt: string;
  comparisonGoal: string;
  allowsVisualEvidence: boolean;
  attachedImageObjectIds: Set<MorphoObjectId>;
  unavailableImageObjectIds: Set<MorphoObjectId>;
  attachedDocumentObjectIds: Set<MorphoObjectId>;
  allowedTextEvidenceObjectIds: Set<MorphoObjectId>;
};

export type ComparisonSelectionResult =
  | { status: "ready"; objectIds: MorphoObjectId[]; sourceRefs: ComparisonSourceRef[] }
  | { status: "blocked"; reason: string };

export type ParseComparisonAnalysisResult =
  | { status: "ok"; analysis: ParsedComparisonAnalysisPayload }
  | { status: "empty"; reason: string }
  | { status: "blockedByProposal"; reason: string }
  | { status: "failed"; reason: string };

export type ValidateComparisonAnalysisResult =
  | { status: "ok"; analysis: ComparisonAnalysis }
  | { status: "failed"; reason: string };

export type ParsedComparisonAnalysisPayload = {
  comparisonGoal: string;
  conclusionSummary: string;
  objectComparisons: ComparisonObjectEntry[];
  recommendedQuestions: string[];
  evidenceLimits: string[];
  keyConclusionCandidate?: ComparisonKeyConclusionCandidate;
};

export function resolveComparisonSelection(
  workspace: MorphoWorkspace,
  selectedObjectIds: MorphoObjectId[]
): ComparisonSelectionResult {
  const requestedIds = selectedObjectIds.filter(Boolean);
  if (requestedIds.length !== new Set(requestedIds).size) {
    return { status: "blocked", reason: "Compare selection must not contain duplicate objects." };
  }

  const stableIds = uniqueStrings(selectedObjectIds);
  if (stableIds.length < 2 || stableIds.length > 4) {
    return { status: "blocked", reason: "Compare selection must contain 2-4 active objects." };
  }

  const sourceRefs: ComparisonSourceRef[] = [];
  for (const objectId of stableIds) {
    const object = workspace.objects[objectId];
    if (!object) {
      return { status: "blocked", reason: `Compare source is missing: ${objectId}` };
    }
    if (object.visibility !== "active") {
      return { status: "blocked", reason: `Compare source must be active: ${objectId}` };
    }
    if (!ALLOWED_TYPES.has(object.type)) {
      return { status: "blocked", reason: `Object type is not allowed for Compare: ${object.type}` };
    }
    if (object.type === "file" && !hasUsableDocumentExtract(object)) {
      return { status: "blocked", reason: `File requires a usable document extract for Compare: ${objectId}` };
    }

    sourceRefs.push(snapshotSource(object, "active"));
  }

  return { status: "ready", objectIds: stableIds, sourceRefs };
}

export function buildComparisonAuthorization(input: {
  workspace: MorphoWorkspace;
  selectedObjectIds: MorphoObjectId[];
  userMessageId: string;
  assistantMessageId: string;
  createdAt: string;
  comparisonGoal: string;
  imageAttachmentObjectIds: MorphoObjectId[];
  documentExtractObjectIds?: MorphoObjectId[];
  documentFragmentExtractObjectIds?: MorphoObjectId[];
}): ComparisonSelectionResult | { status: "ready"; authorization: ComparisonAuthorization } {
  const selection = resolveComparisonSelection(input.workspace, input.selectedObjectIds);
  if (selection.status !== "ready") {
    return selection;
  }
  if (!hasSharedComparisonTarget(selection.sourceRefs, input.comparisonGoal)) {
    return { status: "blocked", reason: "Mixed Compare sources require an explicit shared comparison target." };
  }

  const imageAttachmentSet = new Set(input.imageAttachmentObjectIds);
  const documentExtractSet = new Set(input.documentExtractObjectIds ?? []);
  const documentFragmentExtractSet = new Set(input.documentFragmentExtractObjectIds ?? []);
  const selectedImageObjectIds = selection.objectIds.filter((objectId) => input.workspace.objects[objectId]?.type === "image");
  const allowsVisualEvidence = selectedImageObjectIds.every((objectId) => imageAttachmentSet.has(objectId));
  const allowedTextEvidenceObjectIds = new Set(
    selection.objectIds.filter((objectId) => {
      const object = input.workspace.objects[objectId];
      if (object?.type === "research" || object?.type === "keyConclusion") {
        return true;
      }
      if (object?.type === "documentFragment") {
        return documentFragmentExtractSet.has(objectId);
      }
      return object?.type === "file" && documentExtractSet.has(objectId) && hasUsableDocumentExtract(object);
    })
  );

  return {
    status: "ready",
    authorization: {
      selectionObjectIds: selection.objectIds,
      sourceRefs: selection.sourceRefs,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      createdAt: input.createdAt,
      comparisonGoal: input.comparisonGoal.trim(),
      allowsVisualEvidence,
      attachedImageObjectIds: imageAttachmentSet,
      unavailableImageObjectIds: new Set(selectedImageObjectIds.filter((objectId) => !imageAttachmentSet.has(objectId))),
      attachedDocumentObjectIds: documentExtractSet,
      allowedTextEvidenceObjectIds
    }
  };
}

export function parseComparisonAnalysisPayload(text: string): ParseComparisonAnalysisResult {
  if (PROPOSAL_KEYS.some((key) => Boolean(extractStructuredJsonBlock(text, key)))) {
    return { status: "blockedByProposal", reason: "Comparison analysis is blocked when the same reply contains a pending Proposal." };
  }

  const jsonText = extractStructuredJsonBlock(text, COMPARISON_MARKER);
  if (!jsonText) {
    return { status: "empty", reason: "No morphoComparisonAnalysis block was returned." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { status: "failed", reason: "The morphoComparisonAnalysis block was not valid JSON." };
  }

  if (!isRecord(parsed) || !isRecord(parsed.morphoComparisonAnalysis)) {
    return { status: "failed", reason: "The JSON block did not contain morphoComparisonAnalysis." };
  }
  if (!hasOnlyAllowedKeys(parsed, [COMPARISON_MARKER])) {
    return { status: "failed", reason: "Comparison analysis JSON contains unexpected top-level fields." };
  }

  const analysis = parseComparisonPayload(parsed.morphoComparisonAnalysis);
  if (!analysis) {
    return { status: "failed", reason: "morphoComparisonAnalysis has an invalid schema." };
  }

  return { status: "ok", analysis };
}

export function validateComparisonAnalysis(
  payload: ParsedComparisonAnalysisPayload,
  authorization: ComparisonAuthorization
): ValidateComparisonAnalysisResult {
  const selectedIds = authorization.selectionObjectIds;
  const comparisonIds = payload.objectComparisons.map((entry) => entry.objectId);
  if (!sameExactIdSet(selectedIds, comparisonIds)) {
    return { status: "failed", reason: "objectComparisons must cover exactly the selected Compare sources." };
  }

  const invalidImageEvidence = payload.objectComparisons.some((entry) => {
    const object = authorization.sourceRefs.find((source) => source.objectId === entry.objectId);
    if (object?.objectType !== "image") {
      return false;
    }
    const evidenceBasis = entry.evidenceBasis ?? "objectSummary";
    if (authorization.attachedImageObjectIds.has(entry.objectId)) {
      return false;
    }
    return evidenceBasis === "pixels" || entry.evidence.length > 0;
  });
  if (invalidImageEvidence) {
    return { status: "failed", reason: "Image comparisons cannot claim visual evidence without attached pixels or contact sheet." };
  }
  if (authorization.unavailableImageObjectIds.size > 0 && payload.evidenceLimits.length === 0) {
    return { status: "failed", reason: "Image comparisons with unavailable pixels must state evidenceLimits." };
  }

  const invalidEvidenceBasis = payload.objectComparisons.some((entry) => {
    const source = authorization.sourceRefs.find((item) => item.objectId === entry.objectId);
    if (!source) {
      return true;
    }
    const evidenceBasis = entry.evidenceBasis ?? inferLegacyEvidenceBasis(source);
    if (evidenceBasis === "pixels") {
      return source.objectType !== "image" || !authorization.attachedImageObjectIds.has(entry.objectId);
    }
    if (evidenceBasis === "documentExtract") {
      return source.objectType !== "file" || !authorization.attachedDocumentObjectIds.has(entry.objectId);
    }
    if (evidenceBasis === "documentFragment") {
      return source.objectType !== "documentFragment" || !authorization.allowedTextEvidenceObjectIds.has(entry.objectId);
    }
    return evidenceBasis !== "objectSummary";
  });
  if (invalidEvidenceBasis) {
    return { status: "failed", reason: "objectComparisons evidenceBasis must match the actual Compare inputs." };
  }

  if (payload.keyConclusionCandidate) {
    const candidateIds = payload.keyConclusionCandidate.sourceObjectIds;
    if (candidateIds.length === 0 || candidateIds.length !== new Set(candidateIds).size) {
      return { status: "failed", reason: "keyConclusionCandidate.sourceObjectIds must be non-empty and unique." };
    }
    if (!candidateIds.every((id) => selectedIds.includes(id))) {
      return { status: "failed", reason: "keyConclusionCandidate.sourceObjectIds must stay within the Compare selection." };
    }
    if (!candidateIds.every((id) => authorization.allowedTextEvidenceObjectIds.has(id))) {
      return { status: "failed", reason: "keyConclusionCandidate.sourceObjectIds must all be usable text evidence sources." };
    }
    const hasEvidence = payload.keyConclusionCandidate.evidence.length > 0;
    const evidenceMatchesSources = payload.keyConclusionCandidate.evidence.every(
      (entry) => candidateIds.includes(entry.objectId) && entry.evidence.trim().length > 0
    );
    if (!hasEvidence || !evidenceMatchesSources) {
      return { status: "failed", reason: "keyConclusionCandidate requires at least one valid text-based evidence source." };
    }
  }

  const now = authorization.createdAt;
  return {
    status: "ok",
    analysis: {
      id: `comparison-${authorization.assistantMessageId}`,
      assistantMessageId: authorization.assistantMessageId,
      userMessageId: authorization.userMessageId,
      createdAt: now,
      updatedAt: now,
      sourceObjectIds: [...selectedIds],
      sourceRefs: authorization.sourceRefs,
      comparisonGoal: payload.comparisonGoal,
      conclusionSummary: payload.conclusionSummary,
      objectComparisons: payload.objectComparisons.map(cloneObjectComparison),
      recommendedQuestions: [...payload.recommendedQuestions],
      evidenceLimits: [...payload.evidenceLimits],
      keyConclusionCandidate: payload.keyConclusionCandidate
        ? {
            ...payload.keyConclusionCandidate,
            sourceObjectIds: [...payload.keyConclusionCandidate.sourceObjectIds],
            evidence: payload.keyConclusionCandidate.evidence.map((entry) => ({ ...entry }))
          }
        : undefined
    }
  };
}

export function applyComparisonAnalysis(workspace: MorphoWorkspace, analysis: ComparisonAnalysis): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      comparisonAnalyses: {
        ...workspace.ai.comparisonAnalyses,
        [analysis.id]: analysis
      },
      messages: workspace.ai.messages.map((message) =>
        message.id === analysis.assistantMessageId
          ? {
              ...message,
              comparisonAnalysisId: analysis.id
            }
          : message
      )
    }
  };
}

export function stripComparisonAnalysisBlock(text: string): string {
  return stripStructuredBlocksContainingMarkers(text, [COMPARISON_MARKER]).trim();
}

export function sanitizeComparisonAssistantStreamForDisplay(rawText: string): string {
  return sanitizeStructuredStreamForDisplay(rawText, [COMPARISON_MARKER]);
}

export function resolveStoredComparisonSourceRefs(workspace: MorphoWorkspace, analysis: ComparisonAnalysis): ComparisonSourceRef[] {
  return analysis.sourceRefs.map((sourceRef) => {
    const object = workspace.objects[sourceRef.objectId];
    if (!object) {
      return { ...sourceRef, availability: "missing" };
    }
    if (object.visibility !== "active") {
      return { ...sourceRef, availability: "hidden" };
    }
    return snapshotSource(object, "active");
  });
}

function parseComparisonPayload(value: Record<string, unknown>): ParsedComparisonAnalysisPayload | undefined {
  if (
    typeof value.comparisonGoal !== "string" ||
    typeof value.conclusionSummary !== "string" ||
    !Array.isArray(value.objectComparisons) ||
    !Array.isArray(value.recommendedQuestions) ||
    !Array.isArray(value.evidenceLimits)
  ) {
    return undefined;
  }
  if (
    !hasOnlyAllowedKeys(value, [
      "comparisonGoal",
      "conclusionSummary",
      "objectComparisons",
      "recommendedQuestions",
      "evidenceLimits",
      "keyConclusionCandidate"
    ])
  ) {
    return undefined;
  }

  const objectComparisons = value.objectComparisons.map(parseObjectComparison);
  if (objectComparisons.some((entry) => !entry)) {
    return undefined;
  }
  const keyConclusionCandidate =
    value.keyConclusionCandidate === undefined ? undefined : parseKeyConclusionCandidate(value.keyConclusionCandidate);
  if (value.keyConclusionCandidate !== undefined && !keyConclusionCandidate) {
    return undefined;
  }

  return {
    comparisonGoal: value.comparisonGoal.trim(),
    conclusionSummary: value.conclusionSummary.trim(),
    objectComparisons: objectComparisons.filter(isDefined),
    recommendedQuestions: stringArray(value.recommendedQuestions, 3),
    evidenceLimits: stringArray(value.evidenceLimits, 4),
    keyConclusionCandidate
  };
}

function parseObjectComparison(value: unknown): ComparisonObjectEntry | undefined {
  if (!isRecord(value) || typeof value.objectId !== "string" || typeof value.title !== "string" || typeof value.summary !== "string") {
    return undefined;
  }
  if (!hasOnlyAllowedKeys(value, ["objectId", "title", "evidenceBasis", "summary", "strengths", "risks", "evidence"])) {
    return undefined;
  }
  if (!isEvidenceBasis(value.evidenceBasis)) {
    return undefined;
  }
  return {
    objectId: value.objectId,
    title: value.title.trim(),
    evidenceBasis: value.evidenceBasis,
    summary: value.summary.trim(),
    strengths: stringArray(value.strengths, 4),
    risks: stringArray(value.risks, 4),
    evidence: stringArray(value.evidence, 4)
  };
}

function parseKeyConclusionCandidate(value: unknown): ComparisonKeyConclusionCandidate | undefined {
  if (
    !isRecord(value) ||
    typeof value.title !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.body !== "string" ||
    !Array.isArray(value.sourceObjectIds) ||
    !Array.isArray(value.evidence) ||
    !isConfidence(value.confidence)
  ) {
    return undefined;
  }
  if (!hasOnlyAllowedKeys(value, ["title", "summary", "body", "sourceObjectIds", "evidence", "confidence", "note"])) {
    return undefined;
  }
  const evidence = value.evidence.map(parseCandidateEvidence);
  if (evidence.some((entry) => !entry)) {
    return undefined;
  }
  return {
    title: value.title.trim(),
    summary: value.summary.trim(),
    body: value.body.trim(),
    sourceObjectIds: uniqueStrings(value.sourceObjectIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)),
    evidence: evidence.filter(isDefined),
    confidence: value.confidence,
    note: typeof value.note === "string" ? value.note.trim() : undefined
  };
}

function parseCandidateEvidence(value: unknown): ComparisonKeyConclusionCandidate["evidence"][number] | undefined {
  if (!isRecord(value) || typeof value.objectId !== "string" || typeof value.label !== "string" || typeof value.evidence !== "string") {
    return undefined;
  }
  if (!hasOnlyAllowedKeys(value, ["objectId", "label", "evidence"])) {
    return undefined;
  }
  return {
    objectId: value.objectId,
    label: value.label.trim(),
    evidence: value.evidence.trim()
  };
}

function snapshotSource(object: MorphoObject, availability: ComparisonSourceRef["availability"]): ComparisonSourceRef {
  return {
    objectId: object.id,
    objectType: object.type,
    title: object.title,
    summary: object.summary,
    availability
  };
}

function cloneObjectComparison(entry: ComparisonObjectEntry): ComparisonObjectEntry {
  return {
    objectId: entry.objectId,
    title: entry.title,
    evidenceBasis: entry.evidenceBasis,
    summary: entry.summary,
    strengths: [...entry.strengths],
    risks: [...entry.risks],
    evidence: [...entry.evidence]
  };
}

function inferLegacyEvidenceBasis(source: ComparisonSourceRef): NonNullable<ComparisonObjectEntry["evidenceBasis"]> {
  if (source.objectType === "file") {
    return "documentExtract";
  }
  if (source.objectType === "documentFragment") {
    return "documentFragment";
  }
  return "objectSummary";
}

function isEvidenceBasis(value: unknown): value is NonNullable<ComparisonObjectEntry["evidenceBasis"]> {
  return value === "pixels" || value === "objectSummary" || value === "documentExtract" || value === "documentFragment";
}

function sameExactIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftStable = [...left].sort((a, b) => a.localeCompare(b));
  const rightStable = [...right].sort((a, b) => a.localeCompare(b));
  return leftStable.every((id, index) => id === rightStable[index]);
}

function hasSharedComparisonTarget(sourceRefs: ComparisonSourceRef[], comparisonGoal: string): boolean {
  const objectTypes = new Set(sourceRefs.map((sourceRef) => sourceRef.objectType));
  if (objectTypes.size === 1) {
    return true;
  }

  return COMPARISON_GOAL_PATTERN.test(comparisonGoal.trim());
}

function hasUsableDocumentExtract(object: FileObject): boolean {
  return object.parseStatus === "parsed" && typeof object.extractedAssetId === "string" && object.extractedAssetId.length > 0;
}

function stringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, maxItems)
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isConfidence(value: unknown): value is ComparisonKeyConclusionCandidate["confidence"] {
  return value === "supported" || value === "partial" || value === "needsVerification";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
