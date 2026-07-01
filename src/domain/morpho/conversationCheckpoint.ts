import type {
  AiMessage,
  AiTaskMode,
  AiWorkIntent,
  ConversationCheckpoint,
  MorphoObjectId,
  MorphoWorkspace,
  ProjectFocusArea,
  VisualBranchId
} from "./types";
import {
  extractStructuredJsonBlock,
  sanitizeStructuredStreamForDisplay,
  stripStructuredBlocksContainingMarkers
} from "./structuredBlocks";

export type ConversationCheckpointTaskKind = ConversationCheckpoint["taskKind"];

export type ConversationCheckpointPayload = Pick<
  ConversationCheckpoint,
  "threadGoal" | "progress" | "openThreads" | "nextTurnAnchor"
>;

export type ParseConversationCheckpointResult =
  | { status: "ok"; checkpoint: ConversationCheckpointPayload }
  | { status: "empty"; reason: string }
  | { status: "blockedByProposal"; reason: string }
  | { status: "failed"; reason: string };

export type ValidateConversationCheckpointResult =
  | { status: "ok"; checkpoint: ConversationCheckpointPayload }
  | { status: "failed"; reason: string };

export type BuildConversationLaneKeyInput = {
  currentFocus: Pick<ConversationCheckpoint, "focusArea" | "focusUpdatedAt"> | {
    area: ProjectFocusArea;
    updatedAt: string;
  };
  taskKind: ConversationCheckpointTaskKind;
  anchorObjectIds: MorphoObjectId[];
  targetDirectionIds: MorphoObjectId[];
  visualBranchId?: VisualBranchId;
  uiState?: unknown;
};

export type ConversationContextForRequest = {
  laneKey: string;
  checkpoint?: ConversationCheckpoint;
  recentMessages: Array<{ role: "user" | "assistant"; body: string }>;
  rawMessageCount: number;
  omittedMessageCount: number;
  checkpointRequested: boolean;
};

export type ConversationLaneAnchors = Pick<
  BuildConversationLaneKeyInput,
  "anchorObjectIds" | "targetDirectionIds" | "visualBranchId"
>;

export type ApplyConversationCheckpointInput = {
  laneKey: string;
  currentFocus: {
    area: ProjectFocusArea;
    updatedAt: string;
  };
  taskKind: ConversationCheckpointTaskKind;
  anchorObjectIds: MorphoObjectId[];
  targetDirectionIds: MorphoObjectId[];
  visualBranchId?: VisualBranchId;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceMessageCount: number;
  assistantMessageId: string;
  checkpoint: ConversationCheckpointPayload;
  hasPendingProposal: boolean;
  now?: string;
};

export type ApplyConversationCheckpointResult =
  | { status: "applied"; workspace: MorphoWorkspace; checkpoint: ConversationCheckpoint }
  | { status: "skipped"; workspace: MorphoWorkspace; reason: string };

export const CONVERSATION_CHECKPOINT_LIMITS = {
  minThreadGoalChars: 12,
  maxThreadGoalChars: 180,
  maxItemsPerList: 3,
  minListItemChars: 8,
  maxListItemChars: 180,
  minNextTurnAnchorChars: 8,
  maxNextTurnAnchorChars: 180,
  maxTotalChars: 900,
  minMessagesForCheckpoint: 8,
  minUserMessagesForCheckpoint: 3,
  minCharsForCheckpoint: 5200,
  minUserMessagesForCharCheckpoint: 2,
  maxRecentMessagesWithCheckpoint: 6,
  maxRecentMessagesWithoutCheckpoint: 8,
  maxRecentMessageChars: 700,
  maxRecentTotalChars: 2600,
  maxStoredCheckpoints: 10
} as const;

const CHECKPOINT_MARKER = "morphoConversationCheckpoint";
const TECHNICAL_MARKERS = ["morphoProjectContinuityPatch", CHECKPOINT_MARKER] as const;
const CHECKPOINT_SUPPRESSING_PROPOSAL_KEYS = ["morphoDesignDefinitionProposal", "morphoConceptDirectionProposal"] as const;

export function parseConversationCheckpointPayload(text: string): ParseConversationCheckpointResult {
  if (CHECKPOINT_SUPPRESSING_PROPOSAL_KEYS.some((key) => Boolean(extractStructuredJsonBlock(text, key)))) {
    return { status: "blockedByProposal", reason: "Conversation checkpoint is blocked when the same reply contains a pending Proposal." };
  }

  const jsonText = extractStructuredJsonBlock(text, CHECKPOINT_MARKER);
  if (!jsonText) {
    return { status: "empty", reason: "No morphoConversationCheckpoint block was returned." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { status: "failed", reason: "The morphoConversationCheckpoint block was not valid JSON." };
  }

  if (!isRecord(parsed) || !isRecord(parsed.morphoConversationCheckpoint)) {
    return { status: "failed", reason: "The JSON block did not contain morphoConversationCheckpoint." };
  }
  if (!hasOnlyAllowedKeys(parsed, [CHECKPOINT_MARKER])) {
    return { status: "failed", reason: "Conversation checkpoint JSON contains unexpected top-level fields." };
  }

  const checkpoint = parseCheckpointPayload(parsed.morphoConversationCheckpoint);
  if (!checkpoint) {
    return { status: "failed", reason: "morphoConversationCheckpoint has an invalid schema." };
  }

  const validation = validateConversationCheckpoint(checkpoint);
  return validation.status === "ok" ? { status: "ok", checkpoint: validation.checkpoint } : validation;
}

export function validateConversationCheckpoint(value: unknown): ValidateConversationCheckpointResult {
  const checkpoint = parseCheckpointPayload(value);
  if (!checkpoint) {
    return { status: "failed", reason: "morphoConversationCheckpoint has an invalid schema." };
  }

  const threadGoal = checkpoint.threadGoal.trim();
  if (
    threadGoal.length < CONVERSATION_CHECKPOINT_LIMITS.minThreadGoalChars ||
    threadGoal.length > CONVERSATION_CHECKPOINT_LIMITS.maxThreadGoalChars
  ) {
    return { status: "failed", reason: "threadGoal length is outside allowed bounds." };
  }

  const progress = normalizeTextList(checkpoint.progress);
  const openThreads = normalizeTextList(checkpoint.openThreads);
  if (progress.length > CONVERSATION_CHECKPOINT_LIMITS.maxItemsPerList) {
    return { status: "failed", reason: "progress has too many items." };
  }
  if (openThreads.length > CONVERSATION_CHECKPOINT_LIMITS.maxItemsPerList) {
    return { status: "failed", reason: "openThreads has too many items." };
  }
  const invalidListItem = [...progress, ...openThreads].find(
    (item) => item.length < CONVERSATION_CHECKPOINT_LIMITS.minListItemChars || item.length > CONVERSATION_CHECKPOINT_LIMITS.maxListItemChars
  );
  if (invalidListItem) {
    return { status: "failed", reason: "checkpoint list item length is outside allowed bounds." };
  }

  const nextTurnAnchor = checkpoint.nextTurnAnchor?.trim();
  if (
    nextTurnAnchor !== undefined &&
    (nextTurnAnchor.length < CONVERSATION_CHECKPOINT_LIMITS.minNextTurnAnchorChars ||
      nextTurnAnchor.length > CONVERSATION_CHECKPOINT_LIMITS.maxNextTurnAnchorChars)
  ) {
    return { status: "failed", reason: "nextTurnAnchor length is outside allowed bounds." };
  }

  const allText = [threadGoal, ...progress, ...openThreads, nextTurnAnchor ?? ""].filter(Boolean).join("\n");
  if (!progress.length && !openThreads.length && !nextTurnAnchor) {
    return { status: "failed", reason: "checkpoint must contain at least one progress, open thread, or next-turn anchor." };
  }
  if (allText.length > CONVERSATION_CHECKPOINT_LIMITS.maxTotalChars) {
    return { status: "failed", reason: "checkpoint exceeds the total text limit." };
  }
  if (looksUnsafeForCheckpoint(allText)) {
    return { status: "failed", reason: "checkpoint contains content that cannot be stored." };
  }

  return {
    status: "ok",
    checkpoint: {
      threadGoal,
      progress,
      openThreads,
      nextTurnAnchor
    }
  };
}

export function buildConversationLaneKey(input: BuildConversationLaneKeyInput): string {
  const focusArea = "area" in input.currentFocus ? input.currentFocus.area : input.currentFocus.focusArea;
  const focusUpdatedAt = "updatedAt" in input.currentFocus ? input.currentFocus.updatedAt : input.currentFocus.focusUpdatedAt;
  return [
    "conversation",
    `focus=${focusArea}`,
    `epoch=${focusUpdatedAt}`,
    `task=${input.taskKind}`,
    `objects=${stableIds(input.anchorObjectIds).join(",") || "none"}`,
    `directions=${stableIds(input.targetDirectionIds).join(",") || "none"}`,
    `branch=${input.visualBranchId ?? "none"}`
  ].join("|");
}

export function resolveConversationLaneAnchors(
  workspace: MorphoWorkspace,
  selectedObjectIds: MorphoObjectId[]
): ConversationLaneAnchors {
  const anchorObjectIds: MorphoObjectId[] = [];
  const targetDirectionIds = new Set<MorphoObjectId>();
  const visualBranchIds = new Set<VisualBranchId>();

  for (const objectId of stableIds(selectedObjectIds)) {
    const object = workspace.objects[objectId];
    if (!object || object.visibility !== "active") {
      continue;
    }
    anchorObjectIds.push(object.id);
    if (object.type === "conceptDirection") {
      targetDirectionIds.add(object.id);
    }
    if (object.type === "image") {
      if (object.directionId) {
        targetDirectionIds.add(object.directionId);
      }
      if (object.visualBranchId) {
        visualBranchIds.add(object.visualBranchId);
      }
    }
  }

  return {
    anchorObjectIds,
    targetDirectionIds: stableIds([...targetDirectionIds]),
    visualBranchId: visualBranchIds.size === 1 ? [...visualBranchIds][0] : undefined
  };
}

export function shouldRequestConversationCheckpoint(input: {
  taskMode: AiTaskMode;
  workIntent: AiWorkIntent;
  laneKey: string;
  messages: AiMessage[];
  hasPendingProposal: boolean;
  afterMessageId?: string;
}): boolean {
  if (
    input.taskMode !== "chatAnalysis" ||
    (input.workIntent !== "discussion" && input.workIntent !== "comparison") ||
    input.hasPendingProposal
  ) {
    return false;
  }

  const messages = getCompressibleLaneMessages(input.messages, input.laneKey, input.afterMessageId);
  const userCount = messages.filter((message) => message.role === "user").length;
  const charCount = messages.reduce((sum, message) => sum + message.body.length, 0);

  return (
    (messages.length >= CONVERSATION_CHECKPOINT_LIMITS.minMessagesForCheckpoint &&
      userCount >= CONVERSATION_CHECKPOINT_LIMITS.minUserMessagesForCheckpoint) ||
    (charCount >= CONVERSATION_CHECKPOINT_LIMITS.minCharsForCheckpoint &&
      userCount >= CONVERSATION_CHECKPOINT_LIMITS.minUserMessagesForCharCheckpoint)
  );
}

export function buildConversationContextForRequest(input: {
  workspace: MorphoWorkspace;
  laneKey: string;
  taskMode: AiTaskMode;
  workIntent: AiWorkIntent;
  draft: string;
  hasPendingProposal: boolean;
}): ConversationContextForRequest {
  const checkpoint = getUsableConversationCheckpoint(input.workspace, input.laneKey);
  const rawMessages = checkpoint
    ? getConversationHistoryForLane(input.workspace.ai.messages, input.laneKey, checkpoint.sourceEndMessageId)
    : getFallbackConversationHistory(input.workspace.ai.messages, input.laneKey);
  const recentLimit = checkpoint
    ? CONVERSATION_CHECKPOINT_LIMITS.maxRecentMessagesWithCheckpoint
    : CONVERSATION_CHECKPOINT_LIMITS.maxRecentMessagesWithoutCheckpoint;
  const recentMessages = limitRecentMessages(rawMessages, recentLimit);

  return {
    laneKey: input.laneKey,
    checkpoint,
    recentMessages,
    rawMessageCount: rawMessages.length,
    omittedMessageCount: Math.max(0, rawMessages.length - recentMessages.length),
    checkpointRequested: shouldRequestConversationCheckpoint({
      taskMode: input.taskMode,
      workIntent: input.workIntent,
      laneKey: input.laneKey,
      messages: input.workspace.ai.messages,
      hasPendingProposal: input.hasPendingProposal,
      afterMessageId: checkpoint?.sourceEndMessageId
    })
  };
}

export function getUsableConversationCheckpoint(workspace: MorphoWorkspace, laneKey: string): ConversationCheckpoint | undefined {
  const checkpoint = [...workspace.ai.conversationCheckpoints]
    .filter((item) => item.laneKey === laneKey)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (!checkpoint) {
    return undefined;
  }

  const hasStart = workspace.ai.messages.some((message) => message.id === checkpoint.sourceStartMessageId);
  const hasEnd = workspace.ai.messages.some((message) => message.id === checkpoint.sourceEndMessageId);
  if (!hasStart || !hasEnd) {
    return undefined;
  }

  return validateConversationCheckpoint(extractCheckpointPayload(checkpoint)).status === "ok" ? checkpoint : undefined;
}

export function applyConversationCheckpoint(
  workspace: MorphoWorkspace,
  input: ApplyConversationCheckpointInput
): ApplyConversationCheckpointResult {
  const validation = validateConversationCheckpoint(input.checkpoint);
  if (validation.status !== "ok") {
    return { status: "skipped", workspace, reason: validation.reason };
  }
  if (input.hasPendingProposal) {
    return { status: "skipped", workspace, reason: "Conversation checkpoint is blocked while a pending proposal exists." };
  }
  const assistantMessage = workspace.ai.messages.find((message) => message.id === input.assistantMessageId);
  if (!assistantMessage || assistantMessage.role !== "assistant") {
    return { status: "skipped", workspace, reason: "assistant message must be persisted before checkpoint write." };
  }
  if (assistantMessage.conversationLaneKey && assistantMessage.conversationLaneKey !== input.laneKey) {
    return { status: "skipped", workspace, reason: "assistant message lane does not match checkpoint lane." };
  }
  if (input.sourceEndMessageId !== input.assistantMessageId) {
    return { status: "skipped", workspace, reason: "sourceEndMessageId must be the current completed assistant message." };
  }

  const sourceStartMessage = workspace.ai.messages.find((message) => message.id === input.sourceStartMessageId);
  if (!sourceStartMessage) {
    return { status: "skipped", workspace, reason: "sourceStartMessageId is missing." };
  }
  if (sourceStartMessage.conversationLaneKey !== input.laneKey) {
    return { status: "skipped", workspace, reason: "sourceStartMessageId must belong to the checkpoint lane." };
  }

  const sourceEndMessage = workspace.ai.messages.find((message) => message.id === input.sourceEndMessageId);
  if (!sourceEndMessage) {
    return { status: "skipped", workspace, reason: "sourceEndMessageId is missing." };
  }
  if (sourceEndMessage.conversationLaneKey !== input.laneKey) {
    return { status: "skipped", workspace, reason: "sourceEndMessageId must belong to the checkpoint lane." };
  }

  const laneMessages = workspace.ai.messages.filter((message) => isUsableConversationMessage(message, input.laneKey));
  const sourceStartIndex = laneMessages.findIndex((message) => message.id === input.sourceStartMessageId);
  if (sourceStartIndex < 0) {
    return { status: "skipped", workspace, reason: "sourceStartMessageId is missing." };
  }
  const sourceEndIndex = laneMessages.findIndex((message) => message.id === input.sourceEndMessageId);
  if (sourceEndIndex < 0) {
    return { status: "skipped", workspace, reason: "sourceEndMessageId is missing." };
  }
  if (sourceEndIndex < sourceStartIndex) {
    return { status: "skipped", workspace, reason: "sourceStartMessageId must not be after sourceEndMessageId." };
  }

  const sourceRange = laneMessages.slice(sourceStartIndex, sourceEndIndex + 1);
  if (sourceRange.some((message) => !isUsableConversationMessage(message, input.laneKey))) {
    return { status: "skipped", workspace, reason: "source range must contain only compressible chatAnalysis messages from the same lane." };
  }
  if (sourceRange.length !== input.sourceMessageCount) {
    return { status: "skipped", workspace, reason: "sourceMessageCount must match the stored source range." };
  }

  const now = input.now ?? new Date().toISOString();
  const existing = workspace.ai.conversationCheckpoints.find((checkpoint) => checkpoint.laneKey === input.laneKey);
  const checkpoint: ConversationCheckpoint = {
    id: existing?.id ?? makeConversationCheckpointId(input.laneKey, now),
    laneKey: input.laneKey,
    focusArea: input.currentFocus.area,
    focusUpdatedAt: input.currentFocus.updatedAt,
    taskKind: input.taskKind,
    anchorObjectIds: stableIds(input.anchorObjectIds),
    targetDirectionIds: stableIds(input.targetDirectionIds),
    visualBranchId: input.visualBranchId,
    sourceStartMessageId: existing?.sourceStartMessageId ?? input.sourceStartMessageId,
    sourceEndMessageId: input.sourceEndMessageId,
    sourceMessageCount: input.sourceMessageCount,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...validation.checkpoint
  };
  const conversationCheckpoints = applyCheckpointRetention([
    ...workspace.ai.conversationCheckpoints.filter((item) => item.laneKey !== input.laneKey),
    checkpoint
  ]);

  return {
    status: "applied",
    checkpoint,
    workspace: {
      ...workspace,
      ai: {
        ...workspace.ai,
        conversationCheckpoints,
        messages: workspace.ai.messages.map((message) =>
          message.id === input.assistantMessageId
            ? {
                ...message,
                conversationLaneKey: input.laneKey,
                conversationCheckpointId: checkpoint.id
              }
            : message
        )
      }
    }
  };
}

export function stripConversationCheckpointBlock(text: string): string {
  return stripStructuredBlocksContainingMarkers(text, [CHECKPOINT_MARKER]);
}

export function stripAssistantTechnicalBlocks(text: string): string {
  return stripStructuredBlocksContainingMarkers(text, TECHNICAL_MARKERS);
}

export function sanitizeConversationAssistantStreamForDisplay(rawText: string): string {
  return sanitizeStructuredStreamForDisplay(rawText, TECHNICAL_MARKERS);
}

function parseCheckpointPayload(value: unknown): ConversationCheckpointPayload | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (!hasOnlyAllowedKeys(value, ["threadGoal", "progress", "openThreads", "nextTurnAnchor"])) {
    return undefined;
  }
  if (typeof value.threadGoal !== "string" || !Array.isArray(value.progress) || !Array.isArray(value.openThreads)) {
    return undefined;
  }
  if (value.nextTurnAnchor !== undefined && typeof value.nextTurnAnchor !== "string") {
    return undefined;
  }
  if (!value.progress.every((item) => typeof item === "string") || !value.openThreads.every((item) => typeof item === "string")) {
    return undefined;
  }
  return {
    threadGoal: value.threadGoal,
    progress: [...value.progress],
    openThreads: [...value.openThreads],
    nextTurnAnchor: value.nextTurnAnchor
  };
}

function extractCheckpointPayload(value: ConversationCheckpoint): ConversationCheckpointPayload {
  return {
    threadGoal: value.threadGoal,
    progress: value.progress,
    openThreads: value.openThreads,
    nextTurnAnchor: value.nextTurnAnchor
  };
}

function getCompressibleLaneMessages(messages: AiMessage[], laneKey: string, afterMessageId?: string): AiMessage[] {
  const laneMessages = messages.filter((message) => isUsableConversationMessage(message, laneKey));
  if (!afterMessageId) {
    return laneMessages;
  }
  const index = laneMessages.findIndex((message) => message.id === afterMessageId);
  return index < 0 ? laneMessages : laneMessages.slice(index + 1);
}

function getConversationHistoryForLane(messages: AiMessage[], laneKey: string, afterMessageId?: string): AiMessage[] {
  return getCompressibleLaneMessages(messages, laneKey, afterMessageId);
}

function getFallbackConversationHistory(messages: AiMessage[], laneKey: string): AiMessage[] {
  const laneMessages = getCompressibleLaneMessages(messages, laneKey);
  if (laneMessages.length > 0) {
    return laneMessages;
  }

  return messages.filter(
    (message) =>
      !message.conversationLaneKey &&
      (message.role === "user" || message.role === "assistant") &&
      message.status !== "failed" &&
      message.status !== "streaming" &&
      message.taskMode === "chatAnalysis" &&
      !message.error
  );
}

function isUsableConversationMessage(message: AiMessage, laneKey: string): boolean {
  return (
    message.conversationLaneKey === laneKey &&
    (message.role === "user" || message.role === "assistant") &&
    message.status !== "failed" &&
    message.status !== "streaming" &&
    message.taskMode === "chatAnalysis" &&
    !message.error
  );
}

function limitRecentMessages(messages: AiMessage[], limit: number): ConversationContextForRequest["recentMessages"] {
  const recent: ConversationContextForRequest["recentMessages"] = [];
  let totalChars = 0;
  for (const message of [...messages].slice(-limit)) {
    const body = truncateText(message.body, CONVERSATION_CHECKPOINT_LIMITS.maxRecentMessageChars);
    if (totalChars + body.length > CONVERSATION_CHECKPOINT_LIMITS.maxRecentTotalChars && recent.length > 0) {
      continue;
    }
    totalChars += body.length;
    recent.push({ role: message.role, body });
  }
  return recent;
}

function normalizeTextList(items: string[]): string[] {
  return items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function applyCheckpointRetention(checkpoints: ConversationCheckpoint[]): ConversationCheckpoint[] {
  return [...checkpoints]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, CONVERSATION_CHECKPOINT_LIMITS.maxStoredCheckpoints)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}

function makeConversationCheckpointId(laneKey: string, now: string): string {
  return `conversation-checkpoint-${slugify(laneKey)}-${now.replace(/[^0-9]/g, "").slice(0, 14)}`;
}

function looksUnsafeForCheckpoint(value: string): boolean {
  return (
    /https?:\/\//i.test(value) ||
    /data:[^\s]+;base64,|[A-Za-z0-9+/]{120,}={0,2}/.test(value) ||
    /```/.test(value) ||
    /system prompt|developer message|provider raw payload|raw provider payload|ignore previous instructions/i.test(value) ||
    /\b(?:object|revision|decision|direction|image|message)-[A-Za-z0-9_-]+\b/.test(value) ||
    /setDirectionPrimary|setDefaultReference|hideObject|deleteObject|updateDesignDefinition|conversationCheckpointId|continuityEntryIds/i.test(value)
  );
}

function stableIds(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "lane";
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
