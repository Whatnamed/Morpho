import type {
  AiMessage,
  ConversationCompactionState,
  ConversationSummary,
  ConversationSummaryRevision,
  MorphoWorkspace,
  ProviderInputSnapshot,
  ProviderOutputSnapshot,
  AgentTaskStrategyKind
} from "./types";
import { MORPHO_AGENT_CONTEXT_POLICY, type MorphoAgentContextPolicy } from "./agentContextPolicy";
import {
  extractStructuredJsonBlock,
  sanitizeStructuredStreamForDisplay,
  stripStructuredBlocksContainingMarkers
} from "./structuredBlocks";
import { providerInputSnapshotText } from "./providerInputSnapshot";
import type { ProviderInputTimelineBudget } from "@/shared/providerInputBudget";
import {
  buildConversationSummaryRevisionId,
  hashConversationSummaryForReceipt,
  hashSourceMessageIds
} from "@/shared/agentCompactionProtocol";

export const CONVERSATION_SUMMARY_MARKER = "morphoConversationSummary";

export const DEFAULT_CONVERSATION_TOKEN_LIMITS = MORPHO_AGENT_CONTEXT_POLICY;

export type ConversationTokenLimits = MorphoAgentContextPolicy;

export type ConversationPressure = "normal" | "prepare" | "compact" | "emergency";

export type ConversationMessageForContext = {
  id: string;
  role: "user" | "assistant";
  body: string;
  createdAt?: string;
  laneKey?: string;
  providerInputSnapshot?: ProviderInputSnapshot;
  providerOutputSnapshot?: ProviderOutputSnapshot;
  taskStrategy?: AgentTaskStrategyKind;
};

export type ContinuousConversationContext = {
  summaryRevision?: ConversationSummaryRevision;
  messages: ConversationMessageForContext[];
  totalUsableMessageCount: number;
  coveredMessageCount: number;
  estimatedInputTokens: number;
  estimatedOccupancyTokens: number;
  pressure: Exclude<ConversationPressure, "emergency">;
};

export type ConversationCompactionPlan = {
  previousSummaryRevision?: ConversationSummaryRevision;
  sourceMessages: ConversationMessageForContext[];
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceMessageCount: number;
  sourceMessageIdsHash: string;
  remainingMessages: ConversationMessageForContext[];
  estimatedInputTokens: number;
  pressure: "compact" | "emergency";
};

export type ParseConversationSummaryResult =
  | { status: "ok"; summary: ConversationSummary }
  | { status: "empty"; reason: string }
  | { status: "failed"; reason: string };

export type ApplyConversationSummaryResult =
  | { status: "applied"; workspace: MorphoWorkspace; revision: ConversationSummaryRevision }
  | { status: "skipped"; workspace: MorphoWorkspace; reason: string };

const SUMMARY_LIMITS = {
  minThreadGoalChars: 4,
  maxThreadGoalChars: 600,
  maxItemsPerList: 20,
  maxItemChars: 600,
  maxNextTurnAnchorChars: 600,
  maxTotalChars: 12_000
} as const;

const SUMMARY_DOCUMENT_ITEM_CHARS = 2_400;
const SUMMARY_DOCUMENT_TOTAL_CHARS = 8_000;
const SUMMARY_TEXT_PART_CHARS = 6_000;

export function createEmptyConversationCompactionState(): ConversationCompactionState {
  return { coveredMessageCount: 0 };
}

export function normalizeConversationCompactionState(value: unknown): ConversationCompactionState {
  if (!isRecord(value)) {
    return createEmptyConversationCompactionState();
  }
  return {
    summaryRevisionId: stringValue(value.summaryRevisionId),
    coveredThroughMessageId: stringValue(value.coveredThroughMessageId),
    coveredMessageCount: nonNegativeInteger(value.coveredMessageCount) ?? 0,
    updatedAt: stringValue(value.updatedAt),
    estimatedInputTokens: nonNegativeInteger(value.estimatedInputTokens),
    sourceMessageIdsHash: stringValue(value.sourceMessageIdsHash)
  };
}

export function normalizeConversationSummaryRevisions(value: unknown): Record<string, ConversationSummaryRevision> {
  if (!isRecord(value)) {
    return {};
  }
  const revisions: Record<string, ConversationSummaryRevision> = {};
  for (const [id, candidate] of Object.entries(value)) {
    const revision = parseSummaryRevision(candidate);
    if (revision && revision.id === id) {
      revisions[id] = revision;
    }
  }
  return revisions;
}

export function migrateLegacyCheckpointToConversationCompaction(input: {
  messages: AiMessage[];
  checkpoints: MorphoWorkspace["ai"]["conversationCheckpoints"];
  state: ConversationCompactionState;
  revisions: Record<string, ConversationSummaryRevision>;
}): {
  state: ConversationCompactionState;
  revisions: Record<string, ConversationSummaryRevision>;
} {
  if (input.state.summaryRevisionId || Object.keys(input.revisions).length > 0) {
    return { state: input.state, revisions: input.revisions };
  }

  const usableMessages = getUsableConversationMessages(input.messages);
  const checkpoint = [...input.checkpoints]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .find((candidate) => usableMessages.some((message) => message.id === candidate.sourceEndMessageId));
  if (!checkpoint) {
    return { state: input.state, revisions: input.revisions };
  }
  const endIndex = usableMessages.findIndex((message) => message.id === checkpoint.sourceEndMessageId);
  const startIndex = usableMessages.findIndex((message) => message.id === checkpoint.sourceStartMessageId);
  if (endIndex < 0) {
    return { state: input.state, revisions: input.revisions };
  }
  const sourceStartIndex = startIndex >= 0 && startIndex <= endIndex ? startIndex : 0;
  const sourceMessages = usableMessages.slice(sourceStartIndex, endIndex + 1);
  if (sourceMessages.length === 0) {
    return { state: input.state, revisions: input.revisions };
  }

  const sourceMessageIdsHash = hashMessageIds(sourceMessages.map((message) => message.id));
  const id = `conversation-summary-migrated-${stableHash(`${checkpoint.id}|${sourceMessageIdsHash}`)}`;
  const revision: ConversationSummaryRevision = {
    id,
    summary: {
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
    },
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
    revisions: { ...input.revisions, [id]: revision }
  };
}

export function parseConversationSummaryPayload(text: string): ParseConversationSummaryResult {
  const jsonText = extractStructuredJsonBlock(text, CONVERSATION_SUMMARY_MARKER);
  if (!jsonText) {
    return { status: "empty", reason: `No ${CONVERSATION_SUMMARY_MARKER} block was returned.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { status: "failed", reason: "Conversation summary block is not valid JSON." };
  }
  if (!isRecord(parsed) || !hasOnlyKeys(parsed, [CONVERSATION_SUMMARY_MARKER])) {
    return { status: "failed", reason: "Conversation summary has unexpected top-level fields." };
  }
  const summary = parseSummary(parsed[CONVERSATION_SUMMARY_MARKER]);
  if (!summary) {
    return { status: "failed", reason: "Conversation summary schema is invalid." };
  }
  return validateConversationSummary(summary);
}

export function validateConversationSummary(value: unknown): ParseConversationSummaryResult {
  const summary = parseSummary(value);
  if (!summary) {
    return { status: "failed", reason: "Conversation summary schema is invalid." };
  }
  if (summary.threadGoal.length < SUMMARY_LIMITS.minThreadGoalChars || summary.threadGoal.length > SUMMARY_LIMITS.maxThreadGoalChars) {
    return { status: "failed", reason: "Conversation summary threadGoal length is invalid." };
  }
  const lists = [
    summary.establishedContext,
    summary.decisionsAndReasons,
    summary.activeWork,
    summary.unresolvedQuestions,
    summary.referencedObjects
  ];
  if (lists.some((list) => list.length > SUMMARY_LIMITS.maxItemsPerList)) {
    return { status: "failed", reason: "Conversation summary contains too many list items." };
  }
  if (lists.flat().some((item) => item.length > SUMMARY_LIMITS.maxItemChars)) {
    return { status: "failed", reason: "Conversation summary contains an oversized list item." };
  }
  if ((summary.nextTurnAnchor?.length ?? 0) > SUMMARY_LIMITS.maxNextTurnAnchorChars) {
    return { status: "failed", reason: "Conversation summary nextTurnAnchor is too long." };
  }
  const total = [summary.threadGoal, ...lists.flat(), summary.nextTurnAnchor ?? ""].join("\n");
  if (total.length > SUMMARY_LIMITS.maxTotalChars || looksUnsafeForSummary(total)) {
    return { status: "failed", reason: "Conversation summary cannot be stored safely." };
  }
  return { status: "ok", summary };
}

export function buildContinuousConversationContext(input: {
  workspace: MorphoWorkspace;
  fixedContextTokenEstimate?: number;
  imageTokenReserve?: number;
  outputTokenReserve?: number;
  summaryAlreadyIncludedInFixedContext?: boolean;
  providerTimelineBudget?: ProviderInputTimelineBudget;
  limits?: ConversationTokenLimits;
}): ContinuousConversationContext {
  const limits = input.limits ?? DEFAULT_CONVERSATION_TOKEN_LIMITS;
  const usableMessages = getUsableConversationMessages(input.workspace.ai.messages);
  const summaryRevision = getUsableConversationSummaryRevision(input.workspace, usableMessages);
  const boundaryIndex = summaryRevision
    ? usableMessages.findIndex((message) => message.id === summaryRevision.sourceEndMessageId)
    : -1;
  const messages = usableMessages.slice(boundaryIndex + 1).map(toContextMessage);
  const legacyEstimatedInputTokens =
    (input.fixedContextTokenEstimate ?? 0) +
    (input.imageTokenReserve ?? 0) +
    (input.outputTokenReserve ?? limits.responseReserveTokens) +
    (input.summaryAlreadyIncludedInFixedContext ? 0 : estimateConversationSummaryTokens(summaryRevision?.summary)) +
    estimateConversationMessageTokens(messages);
  const estimatedInputTokens = input.providerTimelineBudget?.totalInputTokens ?? legacyEstimatedInputTokens;
  const estimatedOccupancyTokens = input.providerTimelineBudget?.estimatedOccupancyTokens ?? estimatedInputTokens;

  return {
    summaryRevision,
    messages,
    totalUsableMessageCount: usableMessages.length,
    coveredMessageCount: Math.max(0, boundaryIndex + 1),
    estimatedInputTokens,
    estimatedOccupancyTokens,
    pressure: classifyConversationPressure(
      estimatedOccupancyTokens,
      limits,
      input.providerTimelineBudget?.projectedInputItemCount
    )
  };
}

/**
 * Pressure is whichever bound is closer: estimated tokens or projected Provider
 * input items. Many short turns can hit the item ceiling while the token estimate
 * is still low, and the Provider rejects that request outright.
 */
export function classifyConversationPressure(
  estimatedInputTokens: number,
  limits: ConversationTokenLimits = DEFAULT_CONVERSATION_TOKEN_LIMITS,
  projectedInputItemCount?: number
): Exclude<ConversationPressure, "emergency"> {
  if (
    estimatedInputTokens >= limits.compactTokens ||
    (projectedInputItemCount !== undefined && projectedInputItemCount >= limits.compactItemCount)
  ) {
    return "compact";
  }
  if (
    estimatedInputTokens >= limits.prepareTokens ||
    (projectedInputItemCount !== undefined && projectedInputItemCount >= limits.prepareItemCount)
  ) {
    return "prepare";
  }
  return "normal";
}

export function buildConversationCompactionPlan(input: {
  workspace: MorphoWorkspace;
  fixedContextTokenEstimate?: number;
  imageTokenReserve?: number;
  outputTokenReserve?: number;
  summaryAlreadyIncludedInFixedContext?: boolean;
  providerTimelineBudget?: ProviderInputTimelineBudget;
  limits?: ConversationTokenLimits;
  force?: "compact" | "emergency";
}): ConversationCompactionPlan | undefined {
  const limits = input.limits ?? DEFAULT_CONVERSATION_TOKEN_LIMITS;
  const context = buildContinuousConversationContext({
    workspace: input.workspace,
    fixedContextTokenEstimate: input.fixedContextTokenEstimate,
    imageTokenReserve: input.imageTokenReserve,
    outputTokenReserve: input.outputTokenReserve,
    summaryAlreadyIncludedInFixedContext: input.summaryAlreadyIncludedInFixedContext,
    providerTimelineBudget: input.providerTimelineBudget,
    limits
  });
  const pressure = input.force ?? (context.pressure === "compact" ? "compact" : undefined);
  if (!pressure || context.messages.length < 2) {
    return undefined;
  }

  const targetTokens = pressure === "emergency" ? Math.floor(limits.targetUncompressedTokens / 2) : limits.targetUncompressedTokens;
  const latestAssistantIndex = findLastAssistantIndex(context.messages, context.messages.length - 1);
  const latestRetainedBoundary = findLastAssistantIndex(context.messages, latestAssistantIndex - 1);
  if (latestRetainedBoundary < 1) {
    return undefined;
  }
  let remainingTokens = estimateConversationMessageTokens(context.messages);
  let endIndex = -1;
  for (let index = 0; index <= latestRetainedBoundary; index += 1) {
    const message = context.messages[index]!;
    remainingTokens -= estimateConversationMessageTokens([message]);
    if (message.role === "assistant" && remainingTokens <= targetTokens) {
      endIndex = index;
      break;
    }
  }
  if (endIndex < 1) {
    endIndex = latestRetainedBoundary;
  }

  const sourceMessages = context.messages.slice(0, endIndex + 1);
  const sourceMessageIdsHash = hashMessageIds(sourceMessages.map((message) => message.id));
  return {
    previousSummaryRevision: context.summaryRevision,
    sourceMessages,
    sourceStartMessageId: sourceMessages[0]!.id,
    sourceEndMessageId: sourceMessages.at(-1)!.id,
    sourceMessageCount: sourceMessages.length,
    sourceMessageIdsHash,
    remainingMessages: context.messages.slice(endIndex + 1),
    estimatedInputTokens: context.estimatedInputTokens,
    pressure
  };
}

export function applyConversationSummaryRevision(
  workspace: MorphoWorkspace,
  input: {
    summary: ConversationSummary;
    sourceMessageIds: string[];
    expectedPreviousRevisionId?: string;
    estimatedInputTokens?: number;
    now?: string;
  }
): ApplyConversationSummaryResult {
  const validation = validateConversationSummary(input.summary);
  if (validation.status !== "ok") {
    return { status: "skipped", workspace, reason: validation.reason };
  }
  const currentRevisionId = workspace.ai.conversationCompaction.summaryRevisionId;
  if ((currentRevisionId ?? undefined) !== (input.expectedPreviousRevisionId ?? undefined)) {
    return { status: "skipped", workspace, reason: "Conversation summary base revision changed." };
  }
  if (input.sourceMessageIds.length < 2) {
    return { status: "skipped", workspace, reason: "Conversation summary requires at least one complete exchange." };
  }

  const usableMessages = getUsableConversationMessages(workspace.ai.messages);
  const previousRevision = currentRevisionId ? workspace.ai.conversationSummaryRevisions[currentRevisionId] : undefined;
  const previousEndIndex = previousRevision
    ? usableMessages.findIndex((message) => message.id === previousRevision.sourceEndMessageId)
    : -1;
  const expectedRange = usableMessages.slice(previousEndIndex + 1, previousEndIndex + 1 + input.sourceMessageIds.length);
  if (
    expectedRange.length !== input.sourceMessageIds.length ||
    expectedRange.some((message, index) => message.id !== input.sourceMessageIds[index])
  ) {
    return { status: "skipped", workspace, reason: "Conversation summary source range is no longer contiguous." };
  }
  if (expectedRange.at(-1)?.role !== "assistant") {
    return { status: "skipped", workspace, reason: "Conversation summary boundary must end on a completed assistant message." };
  }
  const sourceMessageIdsHash = hashMessageIds(input.sourceMessageIds);
  const now = input.now ?? new Date().toISOString();
  const revisionId = buildConversationSummaryRevisionId({
    previousSummaryRevisionId: currentRevisionId,
    sourceMessageIdsHash,
    summaryHash: hashConversationSummaryForReceipt(validation.summary)
  });
  if (workspace.ai.conversationSummaryRevisions[revisionId]) {
    return { status: "skipped", workspace, reason: "Conversation source range has already been summarized." };
  }

  const sourceStartMessageId = input.sourceMessageIds[0]!;
  const sourceEndMessageId = input.sourceMessageIds.at(-1)!;
  const revision: ConversationSummaryRevision = {
    id: revisionId,
    previousRevisionId: currentRevisionId,
    summary: validation.summary,
    sourceStartMessageId,
    sourceEndMessageId,
    sourceMessageCount: input.sourceMessageIds.length,
    sourceMessageIdsHash,
    estimatedInputTokens: input.estimatedInputTokens,
    createdAt: now
  };
  const coveredMessageCount = previousEndIndex + 1 + input.sourceMessageIds.length;
  return {
    status: "applied",
    revision,
    workspace: {
      ...workspace,
      ai: {
        ...workspace.ai,
        conversationCompaction: {
          summaryRevisionId: revisionId,
          coveredThroughMessageId: sourceEndMessageId,
          coveredMessageCount,
          updatedAt: now,
          estimatedInputTokens: input.estimatedInputTokens,
          sourceMessageIdsHash
        },
        conversationSummaryRevisions: {
          ...workspace.ai.conversationSummaryRevisions,
          [revisionId]: revision
        },
        messages: workspace.ai.messages.map((message) =>
          message.id === sourceEndMessageId
            ? { ...message, conversationSummaryRevisionId: revisionId }
            : message
        )
      }
    }
  };
}

export function getUsableConversationMessages(messages: readonly AiMessage[]): AiMessage[] {
  const excludedTurnIds = new Set(
    messages
      .filter((message) =>
        message.agentTurnId &&
        (message.agentTurnOutcome === "cancelledBeforeExecution" ||
          message.agentTurnOutcome === "failedBeforeExecution")
      )
      .map((message) => message.agentTurnId as string)
  );
  return messages.filter(
    (message) =>
      (!message.agentTurnId || !excludedTurnIds.has(message.agentTurnId)) &&
      message.contextVisibility !== "uiOnly" &&
      (message.role === "user" || message.role === "assistant") &&
      (message.role === "user"
        ? message.status !== "streaming" && message.status !== "failed" && message.status !== "cancelled"
        : message.status === undefined || message.status === "done") &&
      !message.error &&
      message.body.trim().length > 0
  ).map((message) => {
    if (
      message.role === "assistant" &&
      (message.agentTurnOutcome === "partialSuccess" || message.agentTurnOutcome === "pendingConfirmation")
    ) {
      return {
        ...message,
        body: message.agentTurnOutcomeSummary?.trim() ||
          (message.agentTurnOutcome === "partialSuccess"
            ? "本轮仅部分完成；已执行结果保留，未完成部分需要后续确认。"
            : "本轮停在待确认状态，尚未把待确认动作视为已完成。")
      };
    }
    return message;
  });
}

export function estimateConversationMessageTokens(
  messages: readonly Pick<ConversationMessageForContext, "role" | "body" | "providerInputSnapshot" | "providerOutputSnapshot">[]
): number {
  return messages.reduce((total, message) => {
    if (message.role === "user" && message.providerInputSnapshot) {
      return total + providerInputSnapshotText(message.providerInputSnapshot)
        .reduce((tokens, text) => tokens + estimateTextTokens(text) + 8, 0);
    }
    return total + estimateTextTokens(
      message.role === "assistant" && message.providerOutputSnapshot
        ? message.providerOutputSnapshot.text
        : message.body
    ) + 8;
  }, 0);
}

/**
 * Produces the source text for a summary from the immutable provider snapshot,
 * while keeping attachments as stable references rather than replaying pixels.
 */
export function buildConversationSummarySourceText(
  message: Pick<ConversationMessageForContext, "role" | "body" | "providerInputSnapshot" | "providerOutputSnapshot">
): string {
  if (message.role === "assistant") {
    return `助手最终回复：\n${sanitizeSummarySourceText(
      message.providerOutputSnapshot?.text ?? message.body,
      SUMMARY_TEXT_PART_CHARS
    )}`;
  }

  const snapshot = message.providerInputSnapshot;
  if (!snapshot) {
    return `用户消息：\n${sanitizeSummarySourceText(message.body, SUMMARY_TEXT_PART_CHARS)}`;
  }

  const directParts: string[] = [];
  const documentParts: string[] = [];
  let remainingDocumentChars = SUMMARY_DOCUMENT_TOTAL_CHARS;
  for (const part of snapshot.textParts) {
    const cleaned = sanitizeSummarySourceText(part.text, SUMMARY_TEXT_PART_CHARS);
    if (!cleaned) {
      continue;
    }
    if (part.kind === "documentExtract" || /本轮本地文档提取[:：]/.test(cleaned)) {
      if (remainingDocumentChars <= 0) {
        continue;
      }
      const clipped = clipSummarySourceText(
        cleaned,
        Math.min(SUMMARY_DOCUMENT_ITEM_CHARS, remainingDocumentChars)
      );
      documentParts.push(clipped);
      remainingDocumentChars -= clipped.length;
      continue;
    }
    const meaningful = stripMechanicalTurnContract(cleaned);
    if (meaningful) {
      directParts.push(meaningful);
    }
  }

  const attachmentRefs = [...new Set(snapshot.attachmentRefs.map((attachment) => attachment.objectId).filter(Boolean))].sort();
  return [
    "用户消息（Provider-visible）：",
    directParts.join("\n\n") || "无可重放的文本。",
    documentParts.length > 0
      ? `这是当时随该回合提供的资料快照：\n${documentParts.join("\n\n")}`
      : "",
    attachmentRefs.length > 0
      ? `当时附带图片资料（仅稳定引用，未重放像素）：${attachmentRefs.join("、")}`
      : ""
  ].filter(Boolean).join("\n\n");
}

export function estimateConversationSummaryTokens(summary: ConversationSummary | undefined): number {
  return summary ? estimateTextTokens(stableJson(summary)) + 64 : 0;
}

export function estimateTextTokens(value: string): number {
  return Math.ceil(new TextEncoder().encode(value).length / 3);
}

export function stripConversationSummaryBlock(text: string): string {
  return stripStructuredBlocksContainingMarkers(text, [CONVERSATION_SUMMARY_MARKER]);
}

export function sanitizeConversationSummaryStreamForDisplay(text: string): string {
  return sanitizeStructuredStreamForDisplay(text, [CONVERSATION_SUMMARY_MARKER]);
}

export function hashMessageIds(ids: readonly string[]): string {
  return hashSourceMessageIds(ids);
}

function getUsableConversationSummaryRevision(
  workspace: MorphoWorkspace,
  usableMessages: readonly AiMessage[]
): ConversationSummaryRevision | undefined {
  const revisionId = workspace.ai.conversationCompaction.summaryRevisionId;
  const revision = revisionId ? workspace.ai.conversationSummaryRevisions[revisionId] : undefined;
  if (!revision || workspace.ai.conversationCompaction.coveredThroughMessageId !== revision.sourceEndMessageId) {
    return undefined;
  }
  const startIndex = usableMessages.findIndex((message) => message.id === revision.sourceStartMessageId);
  const endIndex = usableMessages.findIndex((message) => message.id === revision.sourceEndMessageId);
  if (startIndex < 0 || endIndex < startIndex) {
    return undefined;
  }
  const sourceRange = usableMessages.slice(startIndex, endIndex + 1);
  if (
    sourceRange.length !== revision.sourceMessageCount ||
    !hashMessageIdsCompatible(sourceRange.map((message) => message.id), revision.sourceMessageIdsHash)
  ) {
    return undefined;
  }
  return revision;
}

function hashMessageIdsCompatible(ids: readonly string[], storedHash: string): boolean {
  return hashMessageIds(ids) === storedHash || legacyHashMessageIds(ids) === storedHash;
}

function toContextMessage(message: AiMessage): ConversationMessageForContext {
  return {
    id: message.id,
    role: message.role,
    body: message.body,
    createdAt: message.createdAt,
    laneKey: message.conversationLaneKey,
    ...(message.taskStrategy ? { taskStrategy: message.taskStrategy } : {}),
    ...(message.providerInputSnapshot ? { providerInputSnapshot: message.providerInputSnapshot } : {}),
    ...(message.providerOutputSnapshot ? { providerOutputSnapshot: message.providerOutputSnapshot } : {})
  };
}

function sanitizeSummarySourceText(value: string, limit: number): string {
  return clipSummarySourceText(
    value
      .replace(/data:[^\s]+;base64,[^\s]+/gi, "[已省略图片像素]")
      .replace(/[A-Za-z0-9+/]{240,}={0,2}/g, "[已省略二进制片段]")
      .replace(/\r\n/g, "\n")
      .trim(),
    limit
  );
}

function stripMechanicalTurnContract(value: string): string {
  return value
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(
        /^显式选择(?:对象|图片|文档)数：\d+/.test(trimmed) ||
        /^本轮界面数量选择：/.test(trimmed) ||
        /^如需更具体的对象摘要、方向、设计定义、默认参考或本地文档信息/.test(trimmed) ||
        /^本轮图片授权对象数：\d+/.test(trimmed)
      );
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clipSummarySourceText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  const suffix = "\n[资料快照按摘要预算截断]";
  return `${value.slice(0, Math.max(0, limit - suffix.length)).trimEnd()}${suffix}`;
}

function parseSummary(value: unknown): ConversationSummary | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "threadGoal",
    "establishedContext",
    "decisionsAndReasons",
    "activeWork",
    "unresolvedQuestions",
    "referencedObjects",
    "nextTurnAnchor"
  ])) {
    return undefined;
  }
  if (typeof value.threadGoal !== "string") {
    return undefined;
  }
  const establishedContext = stringArray(value.establishedContext);
  const decisionsAndReasons = stringArray(value.decisionsAndReasons);
  const activeWork = stringArray(value.activeWork);
  const unresolvedQuestions = stringArray(value.unresolvedQuestions);
  const referencedObjects = stringArray(value.referencedObjects);
  if (!establishedContext || !decisionsAndReasons || !activeWork || !unresolvedQuestions || !referencedObjects) {
    return undefined;
  }
  if (value.nextTurnAnchor !== undefined && typeof value.nextTurnAnchor !== "string") {
    return undefined;
  }
  return {
    threadGoal: value.threadGoal.replace(/\s+/g, " ").trim(),
    establishedContext: uniqueText(establishedContext),
    decisionsAndReasons: uniqueText(decisionsAndReasons),
    activeWork: uniqueText(activeWork),
    unresolvedQuestions: uniqueText(unresolvedQuestions),
    referencedObjects: uniqueText(referencedObjects),
    nextTurnAnchor: value.nextTurnAnchor?.replace(/\s+/g, " ").trim() || undefined
  };
}

function parseSummaryRevision(value: unknown): ConversationSummaryRevision | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const summaryResult = validateConversationSummary(value.summary);
  const sourceMessageCount = nonNegativeInteger(value.sourceMessageCount);
  if (
    summaryResult.status !== "ok" ||
    typeof value.id !== "string" ||
    typeof value.sourceStartMessageId !== "string" ||
    typeof value.sourceEndMessageId !== "string" ||
    sourceMessageCount === undefined ||
    typeof value.sourceMessageIdsHash !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    previousRevisionId: stringValue(value.previousRevisionId),
    summary: summaryResult.summary,
    sourceStartMessageId: value.sourceStartMessageId,
    sourceEndMessageId: value.sourceEndMessageId,
    sourceMessageCount,
    sourceMessageIdsHash: value.sourceMessageIdsHash,
    estimatedInputTokens: nonNegativeInteger(value.estimatedInputTokens),
    createdAt: value.createdAt
  };
}

function findLastAssistantIndex(messages: readonly ConversationMessageForContext[], start: number): number {
  for (let index = Math.min(start, messages.length - 1); index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return index;
    }
  }
  return -1;
}

function looksUnsafeForSummary(value: string): boolean {
  return (
    /data:[^\s]+;base64,|[A-Za-z0-9+/]{240,}={0,2}/.test(value) ||
    /system prompt|developer message|provider raw payload|raw provider payload|ignore previous instructions/i.test(value)
  );
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
