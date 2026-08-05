import { extractStructuredJsonBlock, sanitizeStructuredStreamForDisplay, stripStructuredBlocksContainingMarkers } from "./structuredBlocks";

export type ParsedDeliverySectionDraftPayload = {
  title?: string;
  narrative: string;
  captions: Array<{
    referenceId: string;
    caption: string;
  }>;
  suggestedGaps: Array<{
    label: string;
  }>;
};

export type ParseDeliverySectionDraftResult =
  | {
      status: "ok";
      draft: ParsedDeliverySectionDraftPayload;
    }
  | {
      status: "empty" | "failed" | "blockedByProposal";
      reason: string;
    };

export type ValidateDeliverySectionDraftResult =
  | { status: "ok" }
  | {
      status: "failed";
      reason: string;
    };

export type DeliverySectionDraftAuthorization = {
  deliveryObjectId: string;
  sectionId: string;
  referenceIds: string[];
};

const DELIVERY_DRAFT_MARKER = "morphoDeliverySectionDraft";
const BLOCKING_PROPOSAL_KEYS = [
  "morphoDesignDefinitionProposal",
  "morphoConceptDirectionProposal",
  "morphoComparisonAnalysis",
  "morphoProjectContinuityPatch",
  "morphoResearchProposal"
] as const;
const DELIVERY_TECHNICAL_MARKERS = [DELIVERY_DRAFT_MARKER, ...BLOCKING_PROPOSAL_KEYS] as const;

const MAX_NARRATIVE_LENGTH = 2_400;
const MAX_CAPTIONS = 24;
const MAX_GAPS = 8;
const MAX_TITLE_LENGTH = 160;
const MAX_CAPTION_LENGTH = 500;
const MAX_GAP_LABEL_LENGTH = 240;

export function parseDeliverySectionDraftPayload(text: string): ParseDeliverySectionDraftResult {
  if (BLOCKING_PROPOSAL_KEYS.some((key) => Boolean(extractStructuredJsonBlock(text, key)))) {
    return {
      status: "blockedByProposal",
      reason: "Delivery section draft is blocked when the same reply contains another Proposal block."
    };
  }

  const jsonText = extractStructuredJsonBlock(text, DELIVERY_DRAFT_MARKER);
  if (!jsonText) {
    return { status: "empty", reason: "No morphoDeliverySectionDraft block was returned." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { status: "failed", reason: "The morphoDeliverySectionDraft block was not valid JSON." };
  }

  if (!isRecord(parsed) || !isRecord(parsed.morphoDeliverySectionDraft)) {
    return { status: "failed", reason: "The JSON block did not contain morphoDeliverySectionDraft." };
  }
  if (!hasOnlyAllowedKeys(parsed, [DELIVERY_DRAFT_MARKER])) {
    return { status: "failed", reason: "Delivery draft JSON contains unexpected top-level fields." };
  }

  const draft = parseDraftPayload(parsed.morphoDeliverySectionDraft);
  if (!draft) {
    return { status: "failed", reason: "morphoDeliverySectionDraft has an invalid schema." };
  }

  return { status: "ok", draft };
}

export function validateDeliverySectionDraftPayload(
  draft: ParsedDeliverySectionDraftPayload,
  authorization: DeliverySectionDraftAuthorization
): ValidateDeliverySectionDraftResult {
  if (!draft.narrative.trim() || draft.narrative.length > MAX_NARRATIVE_LENGTH) {
    return { status: "failed", reason: "Delivery draft narrative is empty or exceeds the length limit." };
  }
  if (draft.captions.length > MAX_CAPTIONS) {
    return { status: "failed", reason: "Delivery draft contains too many captions." };
  }
  if (draft.suggestedGaps.length > MAX_GAPS) {
    return { status: "failed", reason: "Delivery draft contains too many suggested gaps." };
  }

  const allowedReferences = new Set(authorization.referenceIds);
  if (draft.captions.some((caption) => !allowedReferences.has(caption.referenceId))) {
    return { status: "failed", reason: "Delivery draft caption references must belong to the current section." };
  }
  if (new Set(draft.captions.map((caption) => caption.referenceId)).size !== draft.captions.length) {
    return { status: "failed", reason: "Delivery draft captions must not repeat the same reference." };
  }
  if (draft.captions.some((caption) => !caption.caption.trim())) {
    return { status: "failed", reason: "Delivery draft captions must not be empty." };
  }
  if (draft.suggestedGaps.some((gap) => !gap.label.trim())) {
    return { status: "failed", reason: "Delivery draft suggested gaps must not be empty." };
  }

  return { status: "ok" };
}

export function stripDeliverySectionDraftTechnicalBlocks(text: string): string {
  return stripStructuredBlocksContainingMarkers(text, DELIVERY_TECHNICAL_MARKERS);
}

export function sanitizeDeliverySectionDraftStreamForDisplay(rawText: string): string {
  return sanitizeStructuredStreamForDisplay(rawText, DELIVERY_TECHNICAL_MARKERS);
}

function parseDraftPayload(value: unknown): ParsedDeliverySectionDraftPayload | undefined {
  if (!isRecord(value) || typeof value.narrative !== "string") {
    return undefined;
  }
  if (
    !hasOnlyAllowedKeys(value, ["title", "narrative", "captions", "suggestedGaps"])
  ) {
    return undefined;
  }
  const narrative = value.narrative.trim();
  if (!narrative || narrative.length > MAX_NARRATIVE_LENGTH) {
    return undefined;
  }
  const title = typeof value.title === "string" ? value.title.trim() : undefined;
  if (value.title !== undefined && (typeof value.title !== "string" || !title || title.length > MAX_TITLE_LENGTH)) {
    return undefined;
  }
  if (value.captions !== undefined && !Array.isArray(value.captions)) {
    return undefined;
  }
  if (value.suggestedGaps !== undefined && !Array.isArray(value.suggestedGaps)) {
    return undefined;
  }
  const captions = value.captions ? value.captions.map(parseCaption) : [];
  const suggestedGaps = value.suggestedGaps ? value.suggestedGaps.map(parseSuggestedGap) : [];
  if (captions.some((caption) => caption === undefined) || suggestedGaps.some((gap) => gap === undefined)) {
    return undefined;
  }
  const parsedCaptions = captions.filter(isDefined);
  const parsedSuggestedGaps = suggestedGaps.filter(isDefined);
  return {
    title,
    narrative,
    captions: parsedCaptions,
    suggestedGaps: parsedSuggestedGaps
  };
}

function parseCaption(value: unknown): ParsedDeliverySectionDraftPayload["captions"][number] | undefined {
  if (!isRecord(value) || typeof value.referenceId !== "string" || typeof value.caption !== "string") {
    return undefined;
  }
  if (!hasOnlyAllowedKeys(value, ["referenceId", "caption"])) {
    return undefined;
  }
  const referenceId = value.referenceId.trim();
  const caption = value.caption.trim();
  if (!referenceId || referenceId.length > MAX_TITLE_LENGTH || !caption || caption.length > MAX_CAPTION_LENGTH) {
    return undefined;
  }
  return {
    referenceId,
    caption
  };
}

function parseSuggestedGap(value: unknown): ParsedDeliverySectionDraftPayload["suggestedGaps"][number] | undefined {
  if (!isRecord(value) || typeof value.label !== "string") {
    return undefined;
  }
  if (!hasOnlyAllowedKeys(value, ["label"])) {
    return undefined;
  }
  const label = value.label.trim();
  if (!label || label.length > MAX_GAP_LABEL_LENGTH) {
    return undefined;
  }
  return { label };
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
