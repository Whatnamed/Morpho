import type { AiMessage, MorphoWorkspace } from "./types";

export type ConversationSearchMode = "earliest" | "latest" | "keyword";
export type ConversationSearchRole = "any" | "user" | "assistant";

export type ConversationSearchQuery = {
  mode: ConversationSearchMode;
  keyword?: string;
  role?: ConversationSearchRole;
  from?: string;
  to?: string;
  limit?: number;
  neighborCount?: number;
  includeDiagnostics?: boolean;
};

export type ConversationSearchMessage = {
  messageId: string;
  role: AiMessage["role"];
  body: string;
  createdAt?: string;
  status?: AiMessage["status"];
  conversationLaneKey?: string;
};

export type ConversationSearchMatch = {
  message: ConversationSearchMessage;
  before: ConversationSearchMessage[];
  after: ConversationSearchMessage[];
};

export type ConversationSearchResult = {
  query: Required<Pick<ConversationSearchQuery, "mode">> & Omit<ConversationSearchQuery, "mode">;
  matches: ConversationSearchMatch[];
  totalMatched: number;
  truncated: boolean;
};

const MAX_RESULTS = 20;
const MAX_NEIGHBORS = 3;

export function searchProjectConversation(
  workspace: Pick<MorphoWorkspace, "ai">,
  query: ConversationSearchQuery
): ConversationSearchResult {
  const role = query.role ?? (query.mode === "earliest" ? "user" : "any");
  const limit = clampInteger(query.limit, 1, MAX_RESULTS, query.mode === "keyword" ? 8 : 1);
  const neighborCount = clampInteger(query.neighborCount, 0, MAX_NEIGHBORS, 1);
  const keyword = query.keyword?.replace(/\s+/g, " ").trim();
  const fromTime = parseTime(query.from);
  const toTime = parseTime(query.to);
  const includeDiagnostics = query.includeDiagnostics === true;
  const timeline = workspace.ai.messages.filter((message) => isSearchableMessage(message, includeDiagnostics));
  const matchingIndexes = timeline.flatMap((message, index) => {
    if (role !== "any" && message.role !== role) {
      return [];
    }
    const timestamp = parseTime(message.createdAt);
    if (fromTime !== undefined && (timestamp === undefined || timestamp < fromTime)) {
      return [];
    }
    if (toTime !== undefined && (timestamp === undefined || timestamp > toTime)) {
      return [];
    }
    if (query.mode === "keyword" && (!keyword || !normalize(message.body).includes(normalize(keyword)))) {
      return [];
    }
    return [index];
  });

  const orderedIndexes =
    query.mode === "latest" ? [...matchingIndexes].reverse() : matchingIndexes;
  const selectedIndexes = orderedIndexes.slice(0, limit);
  return {
    query: {
      mode: query.mode,
      keyword,
      role,
      from: query.from,
      to: query.to,
      limit,
      neighborCount,
      includeDiagnostics
    },
    matches: selectedIndexes.map((index) => ({
      message: toSearchMessage(timeline[index]!),
      before: timeline.slice(Math.max(0, index - neighborCount), index).map(toSearchMessage),
      after: timeline.slice(index + 1, index + 1 + neighborCount).map(toSearchMessage)
    })),
    totalMatched: matchingIndexes.length,
    truncated: matchingIndexes.length > selectedIndexes.length
  };
}

function isSearchableMessage(message: AiMessage, includeDiagnostics: boolean): boolean {
  return (
    (message.role === "user" || message.role === "assistant") &&
    message.body.trim().length > 0 &&
    message.status !== "streaming" &&
    (includeDiagnostics ||
      (message.contextVisibility !== "uiOnly" &&
        message.status !== "failed" &&
        message.status !== "cancelled" &&
        !message.error))
  );
}

function toSearchMessage(message: AiMessage): ConversationSearchMessage {
  return {
    messageId: message.id,
    role: message.role,
    body: message.body,
    createdAt: message.createdAt,
    status: message.status,
    conversationLaneKey: message.conversationLaneKey
  };
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function parseTime(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}
