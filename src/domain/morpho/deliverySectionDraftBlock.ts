import { extractStructuredJsonBlock } from "./structuredBlocks";

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
  "morphoComparisonAnalysis"
] as const;

const MAX_NARRATIVE_LENGTH = 2_400;
const MAX_CAPTIONS = 24;
const MAX_GAPS = 8;

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
  if (draft.captions.some((caption) => !caption.caption.trim())) {
    return { status: "failed", reason: "Delivery draft captions must not be empty." };
  }
  if (draft.suggestedGaps.some((gap) => !gap.label.trim())) {
    return { status: "failed", reason: "Delivery draft suggested gaps must not be empty." };
  }

  return { status: "ok" };
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
  const captions = Array.isArray(value.captions) ? value.captions.map(parseCaption).filter(isDefined).slice(0, MAX_CAPTIONS + 1) : [];
  const suggestedGaps = Array.isArray(value.suggestedGaps)
    ? value.suggestedGaps.map(parseSuggestedGap).filter(isDefined).slice(0, MAX_GAPS + 1)
    : [];
  return {
    title: typeof value.title === "string" && value.title.trim() ? trimString(value.title, 160) : undefined,
    narrative: trimString(value.narrative, MAX_NARRATIVE_LENGTH + 1),
    captions,
    suggestedGaps
  };
}

function parseCaption(value: unknown): ParsedDeliverySectionDraftPayload["captions"][number] | undefined {
  if (!isRecord(value) || typeof value.referenceId !== "string" || typeof value.caption !== "string") {
    return undefined;
  }
  if (!hasOnlyAllowedKeys(value, ["referenceId", "caption"])) {
    return undefined;
  }
  return {
    referenceId: trimString(value.referenceId, 160),
    caption: trimString(value.caption, 500)
  };
}

function parseSuggestedGap(value: unknown): ParsedDeliverySectionDraftPayload["suggestedGaps"][number] | undefined {
  if (!isRecord(value) || typeof value.label !== "string") {
    return undefined;
  }
  if (!hasOnlyAllowedKeys(value, ["label"])) {
    return undefined;
  }
  return { label: trimString(value.label, 240) };
}

function trimString(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
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
