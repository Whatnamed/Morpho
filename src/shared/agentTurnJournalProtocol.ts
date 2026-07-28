import type {
  AgentCanonicalRuntimeItem,
  AgentRuntimeMode
} from "./agentRuntimeItem";

export const SERVER_EXTERNAL_EXECUTION_STATUSES = [
  "created",
  "providerRunning",
  "awaitingNextRequest",
  "externallyCompleted",
  "externallyCancelled",
  "externallyFailed"
] as const;

export type ServerExternalExecutionStatus =
  (typeof SERVER_EXTERNAL_EXECUTION_STATUSES)[number];

export type AgentTurnJournalCounters = Readonly<{
  provider: number;
  webSearch: number;
  image: number;
}>;

export type AgentTurnJournalSnapshot = Readonly<{
  serverTurnId: string;
  localProjectId: string;
  status: ServerExternalExecutionStatus;
  latestRequestId: string | null;
  latestStepSequence: number;
  counters: AgentTurnJournalCounters;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
  failureCode?: string;
}>;

export type APlusAgentTextPart = Readonly<{
  type: "input_text" | "output_text";
  text: string;
}>;

export type APlusAgentImagePart = Readonly<{
  type: "input_image";
  image_url: string;
}>;

export type APlusAgentProviderMessage = Readonly<{
  role: "user" | "assistant";
  content: readonly (APlusAgentTextPart | APlusAgentImagePart)[];
}>;

/**
 * Stage 2 intentionally accepts only bounded Provider messages. Local Tool
 * Results, Workspace objects, Memory, Summary revisions and confirmation state
 * are not fields in this transport contract.
 */
export type APlusAgentProviderRequest = Readonly<{
  input: readonly APlusAgentProviderMessage[];
  promptContractVersion: string;
  mode: AgentRuntimeMode;
  capabilityIntent: Readonly<{ comparisonAnalysis: boolean }>;
  previousRuntimeItem?: AgentCanonicalRuntimeItem;
}>;

export type AgentTurnRequestStreamEvent =
  | Readonly<{
      type: "streamActivity";
      requestId: string;
      stepSequence: number;
      sequence: number;
      event: unknown;
    }>
  | Readonly<{
      type: "providerOutput";
      requestId: string;
      stepSequence: number;
      outputText: string;
      producedUserVisibleEffect: boolean;
      toolCallIds: readonly string[];
    }>
  | Readonly<{
      type: "serverStatus";
      requestId: string;
      stepSequence: number;
      status: Exclude<ServerExternalExecutionStatus, "created">;
    }>
  | Readonly<{
      type: "externalError";
      requestId: string;
      stepSequence: number;
      code: string;
    }>;

export function isServerExternalExecutionStatus(
  value: unknown
): value is ServerExternalExecutionStatus {
  return typeof value === "string" &&
    SERVER_EXTERNAL_EXECUTION_STATUSES.some((status) => status === value);
}

export function isAgentTurnJournalSnapshot(value: unknown): value is AgentTurnJournalSnapshot {
  if (!isRecord(value) || !isRecord(value.counters)) return false;
  return typeof value.serverTurnId === "string" &&
    typeof value.localProjectId === "string" &&
    isServerExternalExecutionStatus(value.status) &&
    (value.latestRequestId === null || isBoundedIdentifier(value.latestRequestId)) &&
    isBoundedInteger(value.latestStepSequence, 0, 10_000) &&
    isBoundedInteger(value.counters.provider, 0, 32) &&
    isBoundedInteger(value.counters.webSearch, 0, 32) &&
    isBoundedInteger(value.counters.image, 0, 32) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.terminalAt === null || typeof value.terminalAt === "string") &&
    (value.failureCode === undefined || isBoundedFailureCode(value.failureCode));
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 160 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function isBoundedFailureCode(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 80 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
