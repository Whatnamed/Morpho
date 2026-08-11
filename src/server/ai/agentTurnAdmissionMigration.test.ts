import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = "20260810025000_harden_agent_turn_admission.sql";

function readMigration(): string {
  return readFileSync(resolve(process.cwd(), "supabase/migrations", MIGRATION), "utf8")
    .split("\r\n")
    .join("\n")
    .toLowerCase();
}

describe("A+ admission hardening migration", () => {
  it("keeps old transactional implementations private behind access-checked wrappers", () => {
    const sql = readMigration();
    expect(sql).toContain("alter function public.create_agent_turn_journal(text, text) set schema private");
    expect(sql).toContain("create_agent_turn_journal_unchecked_20260729");
    expect(sql).toContain("acquire_agent_turn_external_action_unchecked_20260729");
    expect(sql.match(/current_access_status is distinct from 'active'/g)).toHaveLength(2);
    expect(sql.match(/security definer/g)).toHaveLength(3);
    expect(sql.match(/set search_path = ''/g)).toHaveLength(3);
    expect(sql).toContain("revoke all on function private.create_agent_turn_journal_unchecked_20260729");
    expect(sql).toContain("revoke all on function private.acquire_agent_turn_external_action_unchecked_20260729");
  });

  it("serializes creation limits, preserves exact replay, and tombstones stale active Turns", () => {
    const sql = readMigration();
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql.indexOf("creation_idempotency_key = p_creation_idempotency_key")).toBeLessThan(
      sql.indexOf("active_turn_count >= 16")
    );
    expect(sql).toContain("recent_creation_count >= 120");
    expect(sql).toContain("retained_turn_count >= 2000");
    expect(sql).toContain("terminal_at < observed_at - interval '30 days'");
    expect(sql).toContain("updated_at < observed_at - interval '24 hours'");
    expect(sql).toContain("bounded_failure_code = 'turn_abandoned'");
    expect(sql).toContain("server_execution_status = 'externally_failed'");
    expect(sql).toContain("request.execution_status in ('provider_running', 'awaiting_next_request')");
    expect(sql).toContain("action.execution_status = 'running'");
    expect(sql).toContain("delete from private.agent_turn_external_action_claim");
    expect(sql).not.toMatch(
      /delete from private\.agent_turn_journal[\s\S]*terminal_at is null[\s\S]*interval '24 hours'/
    );
    expect(sql).toContain("'created', 'provider_running', 'awaiting_next_request'");
  });

  it("invalidates outstanding claims and running actions when active access is revoked", () => {
    const sql = readMigration();
    expect(sql).toContain("after update of status on public.app_user_access");
    expect(sql).toContain("old.status = 'active' and new.status <> 'active'");
    expect(sql).toContain("bounded_failure_code = 'access_revoked'");
    expect(sql).toContain("delete from private.agent_turn_external_action_claim");
  });
});
