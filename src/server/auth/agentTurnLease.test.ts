import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  continueAgentTurnLeaseForClient,
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

describe("Agent Turn Lease access", () => {
  it("starts one lease through the atomic quota RPC", async () => {
    const mock = client({
      allowed: true,
      denial_reason: null,
      lease_id: "lease-a",
      expires_at: "2026-07-24T03:00:00.000Z",
      provider_call_count: 1,
      web_search_call_count: 0,
      text_request_count: 4
    });

    await expect(startAgentTurnLeaseForClient(mock, "agent-turn-a")).resolves.toMatchObject({
      status: "allowed",
      lease: { id: "lease-a", providerCallCount: 1, webSearchCallCount: 0 }
    });
    expect(mock.rpc).toHaveBeenCalledWith("start_agent_turn_lease", { p_agent_turn_id: "agent-turn-a" });
  });

  it("rejects forged, cross-user, expired and closed continuations without provider access", async () => {
    for (const reason of ["invalid_lease", "expired", "closed"] as const) {
      const mock = client({
        allowed: false,
        denial_reason: reason,
        lease_id: null,
        expires_at: null,
        provider_call_count: 1,
        web_search_call_count: 0
      });
      await expect(continueAgentTurnLeaseForClient(mock, {
        leaseId: "lease-forged",
        agentTurnId: "agent-turn-forged",
        callKind: "provider"
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
      web_search_call_count: 2
    });
    await expect(continueAgentTurnLeaseForClient(allowed, {
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a",
      callKind: "web_search"
    })).resolves.toMatchObject({ status: "allowed", lease: { webSearchCallCount: 2 } });
    expect(allowed.rpc).toHaveBeenCalledWith("continue_agent_turn_lease", {
      p_lease_id: "lease-a",
      p_agent_turn_id: "agent-turn-a",
      p_call_kind: "web_search"
    });

    const limited = client({
      allowed: false,
      denial_reason: "web_search_limit",
      lease_id: "lease-a",
      expires_at: "2026-07-24T03:00:00.000Z",
      provider_call_count: 3,
      web_search_call_count: 8
    });
    await expect(continueAgentTurnLeaseForClient(limited, {
      leaseId: "lease-a",
      agentTurnId: "agent-turn-a",
      callKind: "web_search"
    })).resolves.toMatchObject({ status: "denied", httpStatus: 429 });
  });

  it("keeps ownership and counters atomic in the SQL contract", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260724023731_add_agent_turn_leases.sql"),
      "utf8"
    );
    expect(sql).toContain("set search_path = private, public, pg_temp");
    expect(sql).toContain("current_user_id uuid := auth.uid()");
    expect(sql).toContain("for update");
    expect(sql).toContain("provider_call_count = provider_call_count + case");
    expect(sql).toContain("web_search_call_count = web_search_call_count + case");
    expect(sql).toContain("lease_row.user_id <> current_user_id");
    expect(sql).toContain("lease_row.expires_at <= now()");
    expect(sql).toContain("revoke all on table private.ai_agent_turn_leases from public, anon, authenticated");
  });
});
