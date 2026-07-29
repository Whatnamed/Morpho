import { describe, expect, it } from "vitest";

import {
  acquireAgentTurnExternalActionForClient,
  hashAgentTurnExternalActionContract,
  type AgentTurnExternalActionJournalClient
} from "./agentTurnExternalActionJournal";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";

describe("A+ External Action Journal adapter", () => {
  it("binds a paid action to the server-observed Tool claim", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = fakeClient((name, args) => {
      calls.push({ name, args });
      return actionRow("acquired");
    });

    const result = await acquireAgentTurnExternalActionForClient(client, {
      serverTurnId: TURN_ID,
      localProjectId: "project-test",
      requestId: "request-1",
      stepSequence: 1,
      actionId: "call-search-1",
      actionKind: "webSearch",
      actionHash: "a".repeat(64),
      claimCallId: "call-search-1",
      claimHash: "b".repeat(64)
    });

    expect(result).toMatchObject({ status: "ok", executionGranted: true });
    expect(calls).toEqual([{
      name: "acquire_agent_turn_external_action",
      args: expect.objectContaining({
        p_claim_call_id: "call-search-1",
        p_claim_hash: "b".repeat(64)
      })
    }]);
  });

  it("rejects a Search/Image acquisition without a Tool claim before RPC", async () => {
    let rpcCalled = false;
    const client = fakeClient(() => {
      rpcCalled = true;
      return actionRow("denied");
    });

    const result = await acquireAgentTurnExternalActionForClient(client, {
      serverTurnId: TURN_ID,
      localProjectId: "project-test",
      requestId: "request-1",
      stepSequence: 1,
      actionId: "call-search-1",
      actionKind: "webSearch",
      actionHash: "a".repeat(64)
    });

    expect(result).toMatchObject({ status: "denied", code: "invalid_external_action" });
    expect(rpcCalled).toBe(false);
  });

  it("maps an Action Hash conflict to a non-retryable deterministic failure", async () => {
    const client = fakeClient(() => actionRow("denied", "external_action_hash_conflict"));

    const result = await acquireAgentTurnExternalActionForClient(client, {
      serverTurnId: TURN_ID,
      localProjectId: "project-test",
      requestId: "request-1",
      stepSequence: 1,
      actionId: "call-search-1",
      actionKind: "webSearch",
      actionHash: "a".repeat(64),
      claimCallId: "call-search-1",
      claimHash: "b".repeat(64)
    });

    expect(result).toMatchObject({
      status: "denied",
      httpStatus: 409,
      code: "external_action_hash_conflict",
      recoverable: false
    });
  });

  it("canonicalizes object key order but refuses undefined hash input", () => {
    expect(hashAgentTurnExternalActionContract({ b: 2, a: 1 })).toBe(
      hashAgentTurnExternalActionContract({ a: 1, b: 2 })
    );
    expect(() => hashAgentTurnExternalActionContract({ a: undefined })).toThrow(
      "not canonical JSON"
    );
  });

  it("keeps the forward-only SQL contract private, transactional and claim-bound", () => {
    const sql = readFileSync(resolve(
      process.cwd(),
      "supabase/migrations/20260729093000_add_agent_turn_external_actions.sql"
    ), "utf8").toLowerCase();

    expect(sql).toContain("create table if not exists private.agent_turn_external_action_claim");
    expect(sql).toContain("create table if not exists private.agent_turn_external_action_journal");
    expect(sql).toContain("settle_agent_turn_request_with_action_claims");
    expect(sql).toContain("for update");
    expect(sql).toContain("tool_action_not_claimed");
    expect(sql).toContain("receipt_expires_at <= now()");
    expect(sql.match(/security definer/g)).toHaveLength(4);
    expect(sql.match(/set search_path = ''/g)).toHaveLength(4);
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("revoke all on table private.agent_turn_external_action_claim from public, anon, authenticated");
    expect(sql).toContain("revoke all on table private.agent_turn_external_action_journal from public, anon, authenticated");
    expect(sql).not.toContain("auth.users");
    expect(sql).not.toContain("workspace json");
  });
});

function fakeClient(
  row: (name: string, args: Record<string, unknown>) => unknown
): AgentTurnExternalActionJournalClient {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-a" } } }) },
    rpc: (name, args) => ({
      single: async () => ({ data: row(name, args), error: null })
    })
  };
}

function actionRow(
  decision: "acquired" | "denied",
  denialReason = "tool_action_not_claimed"
) {
  return {
    decision,
    denial_reason: decision === "denied" ? denialReason : null,
    server_turn_id: TURN_ID,
    request_id: "request-1",
    step_sequence: 1,
    action_id: "call-search-1",
    action_kind: "web_search",
    status_name: "running",
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
    terminal_at: null,
    failure_code: null,
    result_receipt: null
  };
}
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
