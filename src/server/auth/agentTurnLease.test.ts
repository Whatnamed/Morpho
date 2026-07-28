import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  continueAgentTurnLeaseForClient,
  readAgentTurnLeaseStateForClient,
  startAgentTurnLeaseForClient
} from "./agentTurnLease";

function client(row: unknown, options: { user?: boolean; error?: unknown } = {}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: options.user === false ? null : { id: "user-a" } },
        error: undefined
      }))
    },
    rpc: vi.fn(() => ({ single: vi.fn(async () => ({ data: row, error: options.error })) }))
  };
}

/**
 * Migration text is asserted line by line, so it has to be read in the line
 * endings the assertions are written in. Git checks these files out with CRLF on
 * Windows, which would otherwise fail every multi-line expectation on a fresh
 * clone while passing in CI.
 */
function readMigration(name: string): string {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8");
  return sql.split("\r\n").join("\n");
}

describe("Agent Turn Lease access", () => {
  it("starts one lease through the atomic quota RPC", async () => {
    const mock = client({
      allowed: true,
      denial_reason: null,
      lease_id: "lease-a",
      expires_at: "2026-07-24T03:00:00.000Z",
      provider_call_count: 1,
      web_search_call_count: 0,
      next_provider_sequence: 1,
      text_request_count: 4
    });

    await expect(startAgentTurnLeaseForClient(mock, {
      agentTurnId: "agent-turn-a",
      initialRequestHash: "a".repeat(64),
      requestManifestHash: "b".repeat(64),
      runtimeItemId: "agent-runtime-a"
    })).resolves.toMatchObject({
      status: "allowed",
      lease: { id: "lease-a", providerCallCount: 1, webSearchCallCount: 0 }
    });
    expect(mock.rpc).toHaveBeenCalledWith("start_agent_turn_lease", {
      p_agent_turn_id: "agent-turn-a",
      p_initial_request_hash: "a".repeat(64),
      p_request_manifest_hash: "b".repeat(64),
      p_runtime_item_id: "agent-runtime-a"
    });
  });

  it("rejects forged, cross-user, expired and closed continuations without provider access", async () => {
    for (const reason of ["invalid_lease", "expired", "closed"] as const) {
      const mock = client({
        allowed: false,
        denial_reason: reason,
        lease_id: null,
        expires_at: null,
        provider_call_count: 1,
        web_search_call_count: 0,
        next_provider_sequence: 1
      });
      await expect(continueAgentTurnLeaseForClient(mock, {
        leaseId: "lease-forged",
        agentTurnId: "agent-turn-forged",
        continuationKind: "providerContinuation",
        expectedSequence: 1,
        requestHash: "c".repeat(64),
        requestManifestHash: "d".repeat(64),
        runtimeItemId: "agent-runtime-a"
      })).resolves.toMatchObject({ status: "denied", httpStatus: 403, reason });
    }
  });

  it("uses the same lease RPC for web search and enforces its call counter", async () => {
    const allowed = client({
      allowed: true,
      denial_reason: null,
      lease_id: "lease-a",
      expires_at: "2026-07-24T03:00:00.000Z",
      provider_call_count: 3,
      web_search_call_count: 2,
      next_provider_sequence: 3
    });
    await expect(continueAgentTurnLeaseForClient(allowed, {
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a",
      continuationKind: "webSearch",
      expectedSequence: 2,
      requestHash: "c".repeat(64),
      requestManifestHash: "d".repeat(64)
    })).resolves.toMatchObject({ status: "allowed", lease: { webSearchCallCount: 2 } });
    expect(allowed.rpc).toHaveBeenCalledWith("continue_agent_turn_lease", {
      p_lease_id: "lease-a",
      p_agent_turn_id: "agent-turn-a",
      p_continuation_kind: "webSearch",
      p_expected_sequence: 2,
      p_request_hash: "c".repeat(64),
      p_request_manifest_hash: "d".repeat(64),
      p_runtime_item_id: null
    });

    const limited = client({
      allowed: false,
      denial_reason: "web_search_limit",
      lease_id: "lease-a",
      expires_at: "2026-07-24T03:00:00.000Z",
      provider_call_count: 3,
      web_search_call_count: 32,
      next_provider_sequence: 32
    });
    await expect(continueAgentTurnLeaseForClient(limited, {
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a",
      continuationKind: "webSearch",
      expectedSequence: 32,
      requestHash: "e".repeat(64),
      requestManifestHash: "f".repeat(64)
    })).resolves.toMatchObject({ status: "denied", httpStatus: 429 });
  });

  it("reports a missing lease RPC as a deployment gap, not a transient outage", async () => {
    const mock = client(null, {
      error: { code: "PGRST202", message: "Could not find the function public.start_agent_turn_lease" }
    });

    await expect(startAgentTurnLeaseForClient(mock, {
      agentTurnId: "agent-turn-a",
      initialRequestHash: "a".repeat(64),
      requestManifestHash: "b".repeat(64),
      runtimeItemId: "agent-runtime-a"
    })).resolves.toMatchObject({
      status: "denied",
      httpStatus: 503,
      reason: "lease_contract_missing"
    });
  });

  it("returns the expected next sequence when a continuation is rejected out of order", async () => {
    const mock = client({
      allowed: false,
      denial_reason: "sequence_replay",
      lease_id: "lease-a",
      expires_at: "2026-07-24T03:00:00.000Z",
      provider_call_count: 3,
      web_search_call_count: 1,
      next_provider_sequence: 4
    });

    await expect(continueAgentTurnLeaseForClient(mock, {
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a",
      continuationKind: "webSearch",
      expectedSequence: 3,
      requestHash: "c".repeat(64),
      requestManifestHash: "d".repeat(64)
    })).resolves.toMatchObject({
      status: "denied",
      httpStatus: 409,
      reason: "sequence_replay",
      nextProviderSequence: 4
    });
  });

  it("accepts postCompaction as a distinct continuation kind", async () => {
    const mock = client({
      allowed: true,
      denial_reason: null,
      lease_id: "lease-a",
      expires_at: "2026-07-24T03:00:00.000Z",
      provider_call_count: 3,
      web_search_call_count: 0,
      next_provider_sequence: 4
    });

    await expect(continueAgentTurnLeaseForClient(mock, {
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a",
      continuationKind: "postCompaction",
      expectedSequence: 3,
      requestHash: "c".repeat(64),
      requestManifestHash: "d".repeat(64),
      runtimeItemId: "agent-runtime-a"
    })).resolves.toMatchObject({ status: "allowed" });
    expect(mock.rpc).toHaveBeenCalledWith(
      "continue_agent_turn_lease",
      expect.objectContaining({ p_continuation_kind: "postCompaction" })
    );
  });

  it("reads only the active lease sequence and counters for transport recovery", async () => {
    const mock = client({
      active: true,
      expires_at: "2026-07-24T03:00:00.000Z",
      provider_call_count: 4,
      web_search_call_count: 2,
      next_provider_sequence: 7
    });

    await expect(readAgentTurnLeaseStateForClient(mock, {
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a"
    })).resolves.toEqual({
      status: "allowed",
      state: {
        expiresAt: "2026-07-24T03:00:00.000Z",
        providerCallCount: 4,
        webSearchCallCount: 2,
        nextProviderSequence: 7
      }
    });
    expect(mock.rpc).toHaveBeenCalledWith("read_agent_turn_lease_state", {
      p_lease_id: "lease-a",
      p_agent_turn_id: "agent-turn-a"
    });
  });

  it("treats an inactive or missing state RPC as a safe recovery failure", async () => {
    const mock = client({
      active: false,
      expires_at: null,
      provider_call_count: 0,
      web_search_call_count: 0,
      next_provider_sequence: 0
    });

    await expect(readAgentTurnLeaseStateForClient(mock, {
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a"
    })).resolves.toMatchObject({ status: "denied", httpStatus: 403, reason: "inactive" });
  });

  it("reports a missing read-only state RPC as lease_state_contract_missing", async () => {
    const mock = client(null, {
      error: { code: "PGRST202", message: "Could not find the function public.read_agent_turn_lease_state" }
    });

    await expect(readAgentTurnLeaseStateForClient(mock, {
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a"
    })).resolves.toMatchObject({
      status: "denied",
      httpStatus: 503,
      reason: "lease_state_contract_missing"
    });
  });

  it("counts a repeated first request as a real provider execution in the SQL contract", () => {
    const sql = readMigration("20260726161500_bind_agent_turn_provider_execution.sql");

    // The idempotent retry branch must advance the execution counter and sequence.
    const retryBranch = sql.slice(
      sql.indexOf("existing_lease.initial_request_hash = p_initial_request_hash"),
      sql.indexOf("case when existing_lease.status = 'active'")
    );
    expect(retryBranch).toContain("existing_lease.provider_call_count >= 32");
    expect(retryBranch).toContain("'provider_limit'");
    expect(retryBranch).toContain("provider_call_count = lease.provider_call_count + 1");
    expect(retryBranch).toContain("next_provider_sequence = lease.next_provider_sequence + 1");
    // The daily quota is still charged once per turn, never on a retry.
    expect(retryBranch).not.toContain("text_request_count = daily_usage.text_request_count + 1");

    expect(sql).toContain(
      "p_continuation_kind not in (\n      'providerContinuation', 'conversationSummary', 'webSearch', 'postCompaction'\n    )"
    );
    expect(sql).toContain("'postCompaction'");
    expect(sql).toContain("p_continuation_kind <> 'webSearch' and lease_row.provider_call_count >= 32");
    expect(sql.match(/set search_path = ''/g)).toHaveLength(2);
    expect(sql).toContain("current_user_id uuid := auth.uid()");
    expect(sql).toContain("grant execute on function public.start_agent_turn_lease(text, text, text, text) to authenticated");
    expect(sql).not.toMatch(/prompt|workspace|request_body|body_text/i);
  });

  it("keeps ownership and counters atomic in the SQL contract", () => {
    const sql = readMigration("20260723200036_add_agent_turn_leases.sql");
    const correctionSql = readMigration("20260723200456_fix_agent_turn_lease_column_ambiguity.sql");
    expect(sql.match(/set search_path = ''/g)).toHaveLength(3);
    expect(sql).toContain("current_user_id uuid := auth.uid()");
    expect(sql).toContain("for update");
    expect(sql).toContain("provider_call_count = lease.provider_call_count + case");
    expect(sql).toContain("web_search_call_count = lease.web_search_call_count + case");
    expect(sql).toContain("lease_row.user_id <> current_user_id");
    expect(sql).toContain("lease_row.expires_at <= now()");
    expect(sql).toContain("revoke all on table private.ai_agent_turn_leases from public, anon, authenticated");
    expect(sql).toContain(
      "revoke all on function public.start_agent_turn_lease(text) from public, anon, authenticated"
    );
    expect(sql).toContain("where lease.user_id = current_user_id");
    expect(correctionSql).toContain("create or replace function public.start_agent_turn_lease");
    expect(correctionSql).toContain("create or replace function public.continue_agent_turn_lease");
    expect(correctionSql).toContain("where lease.user_id = current_user_id");
    expect(correctionSql).toContain("provider_call_count = lease.provider_call_count");
  });

  it("ships a read-only authenticated Lease state RPC with no transcript fields", () => {
    const sql = readMigration("20260727180000_read_agent_turn_lease_state.sql");
    expect(sql).toContain("create or replace function public.read_agent_turn_lease_state(");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("current_user_id uuid := auth.uid()");
    expect(sql).toContain("lease.user_id = current_user_id");
    expect(sql).toContain("lease_row.status <> 'active'");
    expect(sql).toContain("lease_row.expires_at <= now()");
    expect(sql).toContain("grant execute on function public.read_agent_turn_lease_state(uuid, text)");
    expect(sql).not.toMatch(/request_hash|manifest_hash|prompt|workspace|transcript|body/i);
  });

  it("ships atomic idempotent closure and execution-state proofs", () => {
    const sql = readMigration("20260728174500_bind_agent_turn_closure.sql");
    expect(sql).toContain("tool_execution_started boolean not null default false");
    expect(sql).toContain("closure_request_id text");
    expect(sql).toContain("closure_request_hash text");
    expect(sql).toContain("closure_outcome text");
    expect(sql).toContain("create or replace function public.complete_agent_turn_lease(");
    expect(sql).toContain("lease_row.closure_request_id = p_closure_request_id");
    expect(sql).toContain("lease_row.closure_request_hash = p_closure_request_hash");
    expect(sql).toContain("'closure_conflict'");
    expect(sql).toContain("lease_row.provider_call_count > 0");
    expect(sql).toContain("lease_row.web_search_call_count > 0");
    expect(sql).toContain("lease_row.tool_execution_started");
    expect(sql).toContain("create or replace function public.read_agent_turn_closure_state(");
    expect(sql).toContain("create or replace function public.mark_agent_turn_tool_execution_started(");
    expect(sql.match(/set search_path = ''/g)).toHaveLength(3);
    expect(sql.match(/current_user_id uuid := auth.uid\(\)/g)).toHaveLength(3);
    expect(sql).toContain("to authenticated");
    expect(sql).not.toMatch(/prompt|workspace|request_body|body_text|transcript_text/i);
  });

  it("defines a forward-only causal and idempotent lease migration with a 32-search safety cap", () => {
    const sql = readMigration("20260726143030_harden_agent_turn_lease_causality.sql");

    expect(sql).toContain("initial_request_hash");
    expect(sql).toContain("last_request_hash");
    expect(sql).toContain("next_provider_sequence");
    expect(sql).toContain("last_runtime_item_id");
    expect(sql).toContain("last_continuation_kind");
    expect(sql).toContain("p_initial_request_hash");
    expect(sql).toContain("existing_lease.initial_request_hash = p_initial_request_hash");
    expect(sql).toContain("'request_hash_conflict'");
    expect(sql).toContain("p_expected_sequence < lease_row.next_provider_sequence");
    expect(sql).toContain("p_expected_sequence > lease_row.next_provider_sequence");
    expect(sql).toContain("'sequence_replay'");
    expect(sql).toContain("'sequence_skip'");
    expect(sql).toContain("p_continuation_kind not in ('providerContinuation', 'conversationSummary', 'webSearch')");
    expect(sql).toContain("web_search_call_count >= 32");
    expect(sql).toContain("check (web_search_call_count between 0 and 32)");
    expect(sql.match(/set search_path = ''/g)).toHaveLength(3);
    expect(sql).toContain("revoke all on function public.start_agent_turn_lease");
    expect(sql).not.toMatch(/prompt|workspace|request_body|body_text/i);
  });
});
