import type {
  AiMessage,
  ConversationCompactionState,
  ConversationSummary,
  ConversationSummaryRevision,
  ProjectFocusArea
} from "./types";
import {
  getUsableConversationMessages,
  hashMessageIds,
  normalizeConversationCompactionState,
  normalizeConversationSummaryRevisions,
  validateConversationSummary
} from "./conversationCompaction";

export type LegacyConversationCheckpoint = {
  id: string;
  laneKey: string;
  focusArea: ProjectFocusArea;
  focusUpdatedAt: string;
  taskKind:
    | "research"
    | "general"
    | "directionPreview"
    | "visualDevelopment"
    | "designDefinition"
    | "conceptDirection"
    | "comparison";
  anchorObjectIds: string[];
  targetDirectionIds: string[];
  visualBranchId?: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceMessageCount: number;
  createdAt: string;
  updatedAt: string;
  threadGoal: string;
  progress: string[];
  openThreads: string[];
  nextTurnAnchor?: string;
};

export type LegacyConversationMessageMetadata = {
  id: string;
  conversationLaneKey?: string;
  conversationCheckpointId?: string;
};

export type LegacyImageCompatibilityInput = {
  imageVariant?: unknown;
};

export type LegacyConversationMigrationResult = {
  state: ConversationCompactionState;
  revisions: Record<string, ConversationSummaryRevision>;
};

/**
 * Removes retired fields at the schema boundary. This function deliberately
 * does not interpret a checkpoint when called for an already-current schema;
 * only the explicit v1-v16 migration path may use checkpoint contents.
 */
export function stripLegacyWorkspaceCompatibilityFields(value: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(value);
  if (!isRecord(cloned)) {
    return {};
  }

  const rawObjects = isRecord(cloned.objects) ? cloned.objects : undefined;
  const rawAi = isRecord(cloned.ai) ? cloned.ai : undefined;

  return {
    ...cloned,
    ...(rawObjects
      ? {
          objects: Object.fromEntries(
            Object.entries(rawObjects).map(([objectId, rawObject]) => [
              objectId,
              stripLegacyImageVariant(rawObject)
            ])
          )
        }
      : {}),
    ...(rawAi
      ? {
          ai: stripLegacyConversationState(rawAi)
        }
      : {})
  };
}

export function migrateLegacyConversationCheckpoint(input: {
  legacyMessages: unknown;
  legacyCheckpoints: unknown;
  currentMessages: AiMessage[];
  state: unknown;
  revisions: unknown;
}): LegacyConversationMigrationResult {
  const state = normalizeConversationCompactionState(input.state);
  const revisions = normalizeConversationSummaryRevisions(input.revisions);
  const usableMessages = getUsableConversationMessages(input.currentMessages);

  if (hasValidCurrentSummary({ state, revisions, usableMessages })) {
    return { state, revisions };
  }

  const legacyMessages = parseLegacyMessageMetadata(input.legacyMessages);
  const checkpoint = parseLegacyConversationCheckpoints(input.legacyCheckpoints)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .find((candidate) => isMigratableCheckpoint(candidate, usableMessages, legacyMessages));
  if (!checkpoint) {
    return { state, revisions };
  }

  const endIndex = usableMessages.findIndex((message) => message.id === checkpoint.sourceEndMessageId);
  const startIndex = usableMessages.findIndex((message) => message.id === checkpoint.sourceStartMessageId);
  if (startIndex < 0 || endIndex < startIndex) {
    return { state, revisions };
  }

  const sourceMessages = usableMessages.slice(startIndex, endIndex + 1);
  const sourceMessageIdsHash = hashMessageIds(sourceMessages.map((message) => message.id));
  const summary: ConversationSummary = {
    threadGoal: checkpoint.threadGoal,
    establishedContext: uniqueText(checkpoint.progress),
    decisionsAndReasons: [],
    activeWork: uniqueText(checkpoint.progress),
    unresolvedQuestions: uniqueText(checkpoint.openThreads),
    referencedObjects: uniqueText([
      ...checkpoint.anchorObjectIds,
      ...checkpoint.targetDirectionIds,
      ...(checkpoint.visualBranchId ? [checkpoint.visualBranchId] : [])
    ]),
    nextTurnAnchor: checkpoint.nextTurnAnchor
  };
  const validation = validateConversationSummary(summary);
  if (validation.status !== "ok") {
    return { state, revisions };
  }

  const id = `conversation-summary-migrated-${stableHash(`${checkpoint.id}|${sourceMessageIdsHash}`)}`;
  const revision: ConversationSummaryRevision = {
    id,
    summary: validation.summary,
    sourceStartMessageId: sourceMessages[0]!.id,
    sourceEndMessageId: sourceMessages.at(-1)!.id,
    sourceMessageCount: sourceMessages.length,
    sourceMessageIdsHash,
    createdAt: checkpoint.updatedAt
  };

  return {
    state: {
      summaryRevisionId: id,
      coveredThroughMessageId: revision.sourceEndMessageId,
      coveredMessageCount: endIndex + 1,
      updatedAt: checkpoint.updatedAt,
      sourceMessageIdsHash
    },
    revisions: { ...revisions, [id]: revision }
  };
}

function stripLegacyConversationState(value: Record<string, unknown>): Record<string, unknown> {
  const {
    conversationCheckpoints: _conversationCheckpoints,
    messages,
    ...withoutCheckpoints
  } = value;
  return {
    ...withoutCheckpoints,
    ...(Array.isArray(messages)
      ? { messages: messages.map(stripLegacyMessageFields) }
      : {})
  };
}

function stripLegacyMessageFields(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const {
    conversationLaneKey: _conversationLaneKey,
    conversationCheckpointId: _conversationCheckpointId,
    ...withoutLegacyFields
  } = value;
  return withoutLegacyFields;
}

function stripLegacyImageVariant(value: unknown): unknown {
  if (!isRecord(value) || value.type !== "image") {
    return value;
  }
  const { imageVariant: _imageVariant, ...withoutLegacyVariant } = value;
  return withoutLegacyVariant;
}

function parseLegacyConversationCheckpoints(value: unknown): LegacyConversationCheckpoint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || !isLegacyConversationCheckpoint(candidate)) {
      return [];
    }
    return [candidate];
  });
}

function isLegacyConversationCheckpoint(value: Record<string, unknown>): value is LegacyConversationCheckpoint {
  return (
    hasOnlyAllowedKeys(value, [
      "id",
      "laneKey",
      "focusArea",
      "focusUpdatedAt",
      "taskKind",
      "anchorObjectIds",
      "targetDirectionIds",
      "visualBranchId",
      "sourceStartMessageId",
      "sourceEndMessageId",
      "sourceMessageCount",
      "createdAt",
      "updatedAt",
      "threadGoal",
      "progress",
      "openThreads",
      "nextTurnAnchor"
    ]) &&
    stringFieldsPresent(value, [
      "id",
      "laneKey",
      "focusUpdatedAt",
      "sourceStartMessageId",
      "sourceEndMessageId",
      "createdAt",
      "updatedAt",
      "threadGoal"
    ]) &&
    isProjectFocusArea(value.focusArea) &&
    isLegacyTaskKind(value.taskKind) &&
    stringArray(value.anchorObjectIds) !== undefined &&
    stringArray(value.targetDirectionIds) !== undefined &&
    (value.visualBranchId === undefined || typeof value.visualBranchId === "string") &&
    isNonNegativeInteger(value.sourceMessageCount) &&
    stringArray(value.progress) !== undefined &&
    stringArray(value.openThreads) !== undefined &&
    (value.nextTurnAnchor === undefined || typeof value.nextTurnAnchor === "string")
  );
}

function parseLegacyMessageMetadata(value: unknown): Map<string, LegacyConversationMessageMetadata> {
  if (!Array.isArray(value)) {
    return new Map();
  }
  return new Map(
    value.flatMap((candidate) => {
      if (!isRecord(candidate) || typeof candidate.id !== "string") {
        return [];
      }
      return [[candidate.id, {
        id: candidate.id,
        ...(typeof candidate.conversationLaneKey === "string"
          ? { conversationLaneKey: candidate.conversationLaneKey }
          : {}),
        ...(typeof candidate.conversationCheckpointId === "string"
          ? { conversationCheckpointId: candidate.conversationCheckpointId }
          : {})
      }]];
    })
  );
}

function isMigratableCheckpoint(
  checkpoint: LegacyConversationCheckpoint,
  usableMessages: readonly AiMessage[],
  legacyMessages: ReadonlyMap<string, LegacyConversationMessageMetadata>
): boolean {
  const startIndex = usableMessages.findIndex((message) => message.id === checkpoint.sourceStartMessageId);
  const endIndex = usableMessages.findIndex((message) => message.id === checkpoint.sourceEndMessageId);
  if (
    startIndex < 0 ||
    endIndex < startIndex ||
    checkpoint.sourceMessageCount !== endIndex - startIndex + 1 ||
    usableMessages[endIndex]?.role !== "assistant"
  ) {
    return false;
  }

  return usableMessages.slice(startIndex, endIndex + 1).every((message) => {
    const metadata = legacyMessages.get(message.id);
    return !metadata?.conversationLaneKey || metadata.conversationLaneKey === checkpoint.laneKey;
  });
}

function hasValidCurrentSummary(input: {
  state: ConversationCompactionState;
  revisions: Record<string, ConversationSummaryRevision>;
  usableMessages: readonly AiMessage[];
}): boolean {
  const stateRevision = input.state.summaryRevisionId
    ? input.revisions[input.state.summaryRevisionId]
    : undefined;
  const candidates = stateRevision
    ? [stateRevision, ...Object.values(input.revisions).filter((revision) => revision.id !== stateRevision.id)]
    : Object.values(input.revisions);

  return candidates.some((revision) => {
    const startIndex = input.usableMessages.findIndex((message) => message.id === revision.sourceStartMessageId);
    const endIndex = input.usableMessages.findIndex((message) => message.id === revision.sourceEndMessageId);
    if (
      startIndex < 0 ||
      endIndex < startIndex ||
      revision.sourceMessageCount !== endIndex - startIndex + 1 ||
      input.usableMessages[endIndex]?.role !== "assistant"
    ) {
      return false;
    }
    const ids = input.usableMessages.slice(startIndex, endIndex + 1).map((message) => message.id);
    return hashMessageIds(ids) === revision.sourceMessageIdsHash || legacyHashMessageIds(ids) === revision.sourceMessageIdsHash;
  });
}

function uniqueText(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function legacyHashMessageIds(ids: readonly string[]): string {
  return stableHash(ids.join("\n"));
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function stringFieldsPresent(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === "string" && value[key].trim().length > 0);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isProjectFocusArea(value: unknown): value is ProjectFocusArea {
  return (
    value === "startAndInput" ||
    value === "exploration" ||
    value === "research" ||
    value === "designDefinition" ||
    value === "directionAndVisual" ||
    value === "deliveryPreparation"
  );
}

function isLegacyTaskKind(value: unknown): value is LegacyConversationCheckpoint["taskKind"] {
  return (
    value === "research" ||
    value === "general" ||
    value === "directionPreview" ||
    value === "visualDevelopment" ||
    value === "designDefinition" ||
    value === "conceptDirection" ||
    value === "comparison"
  );
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
