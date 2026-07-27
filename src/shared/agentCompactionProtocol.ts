import type {
  ConversationSummary,
  ProviderContextFrame,
  ProviderContextFrameKind,
  ProviderContextFramePlacement,
  ProviderContextFrameSourceRef
} from "@/domain/morpho/types";

export const AGENT_CONTEXT_STATE_MARKER_TYPE = "morpho_context_state" as const;
export const AGENT_COMPACTION_TRANSCRIPT_MARKER_TYPE = "morpho_compaction_transcript" as const;

export type AgentContextStateMarker = {
  type: typeof AGENT_CONTEXT_STATE_MARKER_TYPE;
  id: string;
  kind: ProviderContextFrameKind;
  sequence: number;
  placement: ProviderContextFramePlacement;
  contentHash: string;
  promptContractVersion: string;
  projectMemoryRevisionIds: string[];
  stageRecordRevisionIds: string[];
  designDefinitionRevisionId?: string;
  directionRevisionIds: string[];
  defaultReferenceObjectId?: string;
  selectedObjectIds: string[];
  relatedObjectIds: string[];
  sourceRefs: ProviderContextFrameSourceRef[];
  anchorMessageId?: string;
  summaryRevisionId?: string;
  supersedesFrameId?: string;
};

export type AgentCompactionDescriptor = {
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceMessageCount: number;
  sourceMessageIdsHash: string;
  retainedTailCount: number;
  retainedTailHash: string;
  previousSummaryHash?: string;
  previousSummaryRevisionId?: string;
  promptContractVersion: string;
};

export type AgentCompactionReceipt = AgentCompactionDescriptor & {
  summaryHash: string;
  summaryRevisionId: string;
  leaseId: string;
  agentTurnId: string;
  sequence: number;
  expiresAt: number;
};

export type AgentCompactionTranscriptMarker = {
  type: typeof AGENT_COMPACTION_TRANSCRIPT_MARKER_TYPE;
  promptContractVersion: string;
  summary: ConversationSummary;
  summaryHash: string;
  summaryRevisionId: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceMessageCount: number;
  sourceMessageIdsHash: string;
  retainedTailCount: number;
  retainedTailHash: string;
  retainedTail: unknown[];
  previousSummaryHash?: string;
  previousSummaryRevisionId?: string;
};

export function createAgentContextStateMarker(frame: ProviderContextFrame): AgentContextStateMarker {
  const marker = {
    type: AGENT_CONTEXT_STATE_MARKER_TYPE,
    id: frame.id,
    kind: frame.kind,
    sequence: frame.sequence,
    placement: frame.placement,
    promptContractVersion: frame.promptContractVersion,
    projectMemoryRevisionIds: [...frame.projectMemoryRevisionIds],
    stageRecordRevisionIds: [...frame.stageRecordRevisionIds],
    ...(frame.designDefinitionRevisionId ? { designDefinitionRevisionId: frame.designDefinitionRevisionId } : {}),
    directionRevisionIds: [...frame.directionRevisionIds],
    ...(frame.defaultReferenceObjectId ? { defaultReferenceObjectId: frame.defaultReferenceObjectId } : {}),
    selectedObjectIds: [...frame.selectedObjectIds],
    relatedObjectIds: [...frame.relatedObjectIds],
    sourceRefs: frame.sourceRefs.map((source) => ({
      kind: source.kind,
      id: source.id,
      ...(source.title ? { title: source.title } : {})
    })),
    ...(frame.anchorMessageId ? { anchorMessageId: frame.anchorMessageId } : {}),
    ...(frame.summaryRevisionId ? { summaryRevisionId: frame.summaryRevisionId } : {}),
    ...(frame.supersedesFrameId ? { supersedesFrameId: frame.supersedesFrameId } : {})
  } satisfies Omit<AgentContextStateMarker, "contentHash">;
  return { ...marker, contentHash: hashAgentProtocolValue(marker) };
}

export function hashConversationSummaryForReceipt(summary: ConversationSummary): string {
  return hashAgentProtocolValue(summary);
}

export function hashCompactionTail(tail: readonly unknown[]): string {
  return hashAgentProtocolValue(tail);
}

export function buildCompactionTranscriptMarker(input: {
  descriptor: AgentCompactionDescriptor;
  summary: ConversationSummary;
  summaryHash: string;
  summaryRevisionId: string;
  retainedTail: readonly unknown[];
}): AgentCompactionTranscriptMarker {
  return {
    type: AGENT_COMPACTION_TRANSCRIPT_MARKER_TYPE,
    promptContractVersion: input.descriptor.promptContractVersion,
    summary: input.summary,
    summaryHash: input.summaryHash,
    summaryRevisionId: input.summaryRevisionId,
    sourceStartMessageId: input.descriptor.sourceStartMessageId,
    sourceEndMessageId: input.descriptor.sourceEndMessageId,
    sourceMessageCount: input.descriptor.sourceMessageCount,
    sourceMessageIdsHash: input.descriptor.sourceMessageIdsHash,
    retainedTailCount: input.retainedTail.length,
    retainedTailHash: hashCompactionTail(input.retainedTail),
    retainedTail: [...input.retainedTail],
    ...(input.descriptor.previousSummaryHash
      ? { previousSummaryHash: input.descriptor.previousSummaryHash }
      : {}),
    ...(input.descriptor.previousSummaryRevisionId
      ? { previousSummaryRevisionId: input.descriptor.previousSummaryRevisionId }
      : {})
  };
}

export function buildAgentCompactionDescriptor(input: {
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceMessageCount: number;
  sourceMessageIdsHash: string;
  retainedTail: readonly unknown[];
  previousSummaryHash?: string;
  previousSummaryRevisionId?: string;
  promptContractVersion: string;
}): AgentCompactionDescriptor {
  return {
    sourceStartMessageId: input.sourceStartMessageId,
    sourceEndMessageId: input.sourceEndMessageId,
    sourceMessageCount: input.sourceMessageCount,
    sourceMessageIdsHash: input.sourceMessageIdsHash,
    retainedTailCount: input.retainedTail.length,
    retainedTailHash: hashCompactionTail(input.retainedTail),
    ...(input.previousSummaryHash ? { previousSummaryHash: input.previousSummaryHash } : {}),
    ...(input.previousSummaryRevisionId ? { previousSummaryRevisionId: input.previousSummaryRevisionId } : {}),
    promptContractVersion: input.promptContractVersion
  };
}

export function buildConversationSummaryRevisionId(input: {
  previousSummaryRevisionId?: string;
  sourceMessageIdsHash: string;
  summaryHash: string;
}): string {
  return `conversation-summary-${hashAgentProtocolValue({
    previousSummaryRevisionId: input.previousSummaryRevisionId ?? "root",
    sourceMessageIdsHash: input.sourceMessageIdsHash,
    summaryHash: input.summaryHash
  })}`;
}

export function hashAgentProtocolValue(value: unknown): string {
  const json = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
