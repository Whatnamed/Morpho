import { vi } from "vitest";

import type {
  AcquireAgentTurnRequestResult,
  ReadAgentTurnJournalResult,
  SettleAgentTurnRequestResult
} from "@/server/ai/agentTurnJournal";
import type { AgentTurnJournalSnapshot, ServerExternalExecutionStatus } from "@/shared/agentTurnJournalProtocol";

export class FakeAgentTurnJournal {
  snapshot: AgentTurnJournalSnapshot;
  private request:
    | { requestId: string; stepSequence: number; requestHash: string }
    | undefined;
  nextDenial: string | undefined;

  constructor(serverTurnId: string, localProjectId: string) {
    this.snapshot = {
      serverTurnId, localProjectId, status: "created", latestRequestId: null, latestStepSequence: 0,
      counters: { provider: 0, webSearch: 0, image: 0 },
      createdAt: "2026-07-29T01:00:00.000Z", updatedAt: "2026-07-29T01:00:00.000Z", terminalAt: null
    };
  }

  readonly acquire = vi.fn(async (input: {
    serverTurnId: string;
    localProjectId: string;
    requestId: string;
    stepSequence: number;
    requestHash: string;
  }): Promise<AcquireAgentTurnRequestResult> => {
    if (this.nextDenial) {
      const code = this.nextDenial;
      this.nextDenial = undefined;
      return denial(code, code === "quota_exceeded" ? 429 : 409);
    }
    if (input.serverTurnId !== this.snapshot.serverTurnId || input.localProjectId !== this.snapshot.localProjectId) {
      return denial("not_found", 404);
    }
    if (this.request) {
      if (
        this.request.requestId === input.requestId &&
        this.request.stepSequence === input.stepSequence &&
        this.request.requestHash === input.requestHash
      ) {
        return {
          status: "ok",
          executionGranted: false,
          replayed: true,
          snapshot: this.snapshot
        };
      }
    }
    if (this.request?.requestId === input.requestId) return denial("request_id_conflict", 409);
    if ((this.snapshot.status !== "created" && this.snapshot.status !== "awaitingNextRequest") ||
      input.stepSequence !== this.snapshot.latestStepSequence + 1) return denial("sequence_conflict", 409);
    this.request = {
      requestId: input.requestId,
      stepSequence: input.stepSequence,
      requestHash: input.requestHash
    };
    this.snapshot = {
      ...this.snapshot,
      status: "providerRunning",
      latestRequestId: input.requestId,
      latestStepSequence: input.stepSequence,
      counters: { ...this.snapshot.counters, provider: this.snapshot.counters.provider + 1 }
    };
    return { status: "ok", executionGranted: true, replayed: false, snapshot: this.snapshot };
  });

  readonly settle = vi.fn(async (input: {
    actorUserId: string;
    serverTurnId: string;
    localProjectId: string;
    requestId: string;
    stepSequence: number;
    status: Exclude<ServerExternalExecutionStatus, "created" | "providerRunning">;
    failureCode?: string;
    toolClaims?: readonly unknown[];
  }): Promise<SettleAgentTurnRequestResult> => {
    const terminal = input.status.startsWith("externally");
    this.snapshot = {
      ...this.snapshot,
      status: input.status,
      latestRequestId: input.requestId,
      latestStepSequence: input.stepSequence,
      terminalAt: terminal ? "2026-07-29T01:02:00.000Z" : null,
      ...(input.failureCode ? { failureCode: input.failureCode } : {})
    };
    return { status: "ok", replayed: false, snapshot: this.snapshot };
  });

  readonly read = vi.fn(async (input: {
    serverTurnId: string;
    localProjectId: string;
  }): Promise<ReadAgentTurnJournalResult> => {
    return input.serverTurnId === this.snapshot.serverTurnId && input.localProjectId === this.snapshot.localProjectId
      ? { status: "ok", snapshot: this.snapshot }
      : denial("not_found", 404);
  });
}

export function denial(
  code: string,
  httpStatus: 404 | 409 | 429
): Extract<AcquireAgentTurnRequestResult, { status: "denied" }> {
  return { status: "denied", httpStatus, code, error: code, recoverable: false };
}
