export const AGENT_TURN_EXTERNAL_ACTION_KINDS = ["webSearch", "image", "compaction"] as const;
export type AgentTurnExternalActionKind = (typeof AGENT_TURN_EXTERNAL_ACTION_KINDS)[number];

export const AGENT_TURN_EXTERNAL_ACTION_STATUSES = [
  "running",
  "externallyCompleted",
  "externallyCancelled",
  "externallyFailed"
] as const;
export type AgentTurnExternalActionStatus =
  (typeof AGENT_TURN_EXTERNAL_ACTION_STATUSES)[number];

export type AgentTurnExternalActionSnapshot = Readonly<{
  serverTurnId: string;
  requestId: string;
  stepSequence: number;
  actionId: string;
  actionKind: AgentTurnExternalActionKind;
  status: AgentTurnExternalActionStatus;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
  failureCode?: string;
  resultReceipt?: unknown;
}>;

export function isAgentTurnExternalActionSnapshot(
  value: unknown
): value is AgentTurnExternalActionSnapshot {
  if (!isRecord(value)) return false;
  return isIdentifier(value.serverTurnId) &&
    isIdentifier(value.requestId) &&
    Number.isSafeInteger(value.stepSequence) &&
    (value.stepSequence as number) >= 1 &&
    (value.stepSequence as number) <= 10_000 &&
    isIdentifier(value.actionId) &&
    AGENT_TURN_EXTERNAL_ACTION_KINDS.includes(value.actionKind as AgentTurnExternalActionKind) &&
    AGENT_TURN_EXTERNAL_ACTION_STATUSES.includes(value.status as AgentTurnExternalActionStatus) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.terminalAt === null || typeof value.terminalAt === "string") &&
    (value.failureCode === undefined || isFailureCode(value.failureCode));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function isFailureCode(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 80 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
