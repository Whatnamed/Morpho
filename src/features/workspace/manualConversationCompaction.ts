import type { ConversationCheckpointPayload } from "@/domain/morpho/conversationCheckpoint";
import type { AiMessage, ConversationCheckpoint } from "@/domain/morpho/types";

export type ManualCompactCommandResult =
  | { matched: true }
  | { matched: false };

export type ManualCompactionMessage = {
  role: "user" | "assistant";
  body: string;
};

export type ManualConversationCompactionChunk = {
  messages: ManualCompactionMessage[];
  sourceMessageIds: string[];
  estimatedTokens: number;
};

export type ManualConversationCompactionPlan = {
  chunks: ManualConversationCompactionChunk[];
  sourceMessageIds: string[];
};

export type ManualConversationCompactionExecutionResult =
  | {
      status: "completed";
      checkpoint: ConversationCheckpointPayload;
      rawReply: string;
      processedChunkCount: number;
    }
  | {
      status: "failed";
      retainedCheckpoint?: ConversationCheckpoint;
      processedChunkCount: number;
      error: unknown;
    };

const DEFAULT_MANUAL_COMPACTION_CHUNK_TOKENS = 12_000;
const MESSAGE_ENVELOPE_TOKENS = 12;

export function parseManualCompactCommand(draft: string): ManualCompactCommandResult {
  return draft.trim().toLowerCase() === "/compact"
    ? { matched: true }
    : { matched: false };
}

export function buildManualConversationCompactionPlan(input: {
  messages: AiMessage[];
  /** Retained for call-site compatibility; manual compaction is project-wide. */
  laneKey: string;
  checkpoint?: ConversationCheckpoint;
  maxChunkTokens?: number;
}): ManualConversationCompactionPlan {
  const maxChunkTokens = Math.max(32, input.maxChunkTokens ?? DEFAULT_MANUAL_COMPACTION_CHUNK_TOKENS);
  // `/compact` summarizes the continuous project conversation. Lane keys are
  // UI routing metadata and must not hide eligible history from the model.
  const candidateMessages = input.messages.filter(isCompressibleChatMessage);
  const checkpointEndIndex = input.checkpoint
    ? candidateMessages.findIndex((message) => message.id === input.checkpoint?.sourceEndMessageId)
    : -1;
  const sourceMessages =
    checkpointEndIndex >= 0 ? candidateMessages.slice(checkpointEndIndex + 1) : candidateMessages;
  const chunks: ManualConversationCompactionChunk[] = [];
  let currentMessages: ManualCompactionMessage[] = [];
  let currentSourceMessageIds: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (currentMessages.length === 0) {
      return;
    }
    chunks.push({
      messages: currentMessages,
      sourceMessageIds: [...new Set(currentSourceMessageIds)],
      estimatedTokens: currentTokens
    });
    currentMessages = [];
    currentSourceMessageIds = [];
    currentTokens = 0;
  };

  for (const message of sourceMessages) {
    const parts = splitTextToTokenBudget(message.body, maxChunkTokens - MESSAGE_ENVELOPE_TOKENS);
    for (const part of parts) {
      const partTokens = estimateTextTokens(part) + MESSAGE_ENVELOPE_TOKENS;
      if (currentMessages.length > 0 && currentTokens + partTokens > maxChunkTokens) {
        flush();
      }
      currentMessages.push({
        role: message.role,
        body: part
      });
      currentSourceMessageIds.push(message.id);
      currentTokens += partTokens;
    }
  }
  flush();

  return {
    chunks,
    sourceMessageIds: sourceMessages.map((message) => message.id)
  };
}

export async function executeManualConversationCompactionPlan(
  plan: ManualConversationCompactionPlan,
  input: {
    initialCheckpoint?: ConversationCheckpoint;
    compactChunk: (input: {
      checkpoint?: ConversationCheckpointPayload;
      chunk: ManualConversationCompactionChunk;
      chunkIndex: number;
      chunkCount: number;
    }) => Promise<{
      checkpoint: ConversationCheckpointPayload;
      rawReply: string;
    }>;
  }
): Promise<ManualConversationCompactionExecutionResult> {
  let checkpoint = input.initialCheckpoint ? extractCheckpointPayload(input.initialCheckpoint) : undefined;
  let rawReply = "";
  let processedChunkCount = 0;

  try {
    for (const [chunkIndex, chunk] of plan.chunks.entries()) {
      const result = await input.compactChunk({
        checkpoint,
        chunk,
        chunkIndex,
        chunkCount: plan.chunks.length
      });
      checkpoint = result.checkpoint;
      rawReply = result.rawReply;
      processedChunkCount += 1;
    }
  } catch (error) {
    return {
      status: "failed",
      retainedCheckpoint: input.initialCheckpoint,
      processedChunkCount,
      error
    };
  }

  if (!checkpoint || !rawReply) {
    return {
      status: "failed",
      retainedCheckpoint: input.initialCheckpoint,
      processedChunkCount,
      error: new Error("Manual compaction did not produce a checkpoint.")
    };
  }

  return {
    status: "completed",
    checkpoint,
    rawReply,
    processedChunkCount
  };
}

export function getManualCompactionStatusText(
  status: "running" | "completed" | "notNeeded" | "failed"
): string {
  switch (status) {
    case "running":
      return "正在压缩当前上下文…";
    case "completed":
      return "上下文压缩完成。已保留当前项目状态、选中对象、待继续问题和最近讨论。";
    case "notNeeded":
      return "当前讨论还很短，无需压缩。";
    case "failed":
      return "上下文压缩未完成：模型没有返回可用的讨论摘要，请稍后重试。";
  }
}

function splitTextToTokenBudget(value: string, maxTokens: number): string[] {
  const text = value.trim();
  if (!text) {
    return [""];
  }
  if (estimateTextTokens(text) <= maxTokens) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;
  while (remaining) {
    let low = 1;
    let high = remaining.length;
    let fit = 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = safeSubstring(remaining, middle);
      if (estimateTextTokens(candidate) <= maxTokens) {
        fit = candidate.length;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const part = safeSubstring(remaining, fit);
    parts.push(part);
    remaining = remaining.slice(part.length);
  }
  return parts;
}

function safeSubstring(value: string, length: number): string {
  let safeLength = Math.min(length, value.length);
  if (safeLength > 0) {
    const lastCodeUnit = value.charCodeAt(safeLength - 1);
    if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
      safeLength -= 1;
    }
  }
  return value.slice(0, Math.max(1, safeLength));
}

function estimateTextTokens(value: string): number {
  return Math.max(1, Math.ceil(new TextEncoder().encode(value).length / 3));
}

function extractCheckpointPayload(checkpoint: ConversationCheckpoint): ConversationCheckpointPayload {
  return {
    threadGoal: checkpoint.threadGoal,
    progress: checkpoint.progress,
    openThreads: checkpoint.openThreads,
    nextTurnAnchor: checkpoint.nextTurnAnchor
  };
}

function isCompressibleChatMessage(message: AiMessage): boolean {
  return (
    (message.role === "user" || message.role === "assistant") &&
    message.contextVisibility !== "uiOnly" &&
    message.taskMode === "chatAnalysis" &&
    message.status !== "failed" &&
    message.status !== "cancelled" &&
    message.status !== "streaming" &&
    !message.error
  );
}
