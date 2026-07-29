import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLEANUP_MIGRATION = "20260729190000_remove_agent_runtime_b_proofs.sql";

describe("Agent Runtime A+ database cutover", () => {
  it("removes only B lease functions and its private table in a forward migration", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations", CLEANUP_MIGRATION), "utf8")
      .toLowerCase();

    expect(sql).toContain("drop table if exists private.ai_agent_turn_leases");
    expect(sql).toContain("drop function if exists public.start_agent_turn_lease");
    expect(sql).toContain("drop function if exists public.continue_agent_turn_lease");
    expect(sql).toContain("drop function if exists public.complete_agent_turn_lease");
    expect(sql).toContain("drop function if exists public.read_agent_turn_lease_state");
    expect(sql).toContain("drop function if exists public.read_agent_turn_closure_state");
    expect(sql).toContain("drop function if exists public.mark_agent_turn_tool_execution_started");
    expect(sql).toContain("drop function if exists public.mark_agent_turn_provider_failure");

    expect(sql).not.toContain("drop table if exists private.agent_turn_journal");
    expect(sql).not.toContain("drop table if exists private.agent_turn_request_journal");
    expect(sql).not.toContain("drop table if exists private.agent_turn_external_action_journal");
    expect(sql).not.toContain("drop function if exists public.create_agent_turn_journal");
    expect(sql).not.toContain("drop function if exists public.acquire_agent_turn_request");
    expect(sql).not.toContain("drop function if exists public.settle_agent_turn_request");
  });
});
