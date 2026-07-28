import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  acquireAgentTurnRequestForClient,
  createAgentTurnJournalForClient,
  fromDatabaseStatus,
  readAgentTurnJournalForClient,
  settleAgentTurnRequestForClient,
  toDatabaseStatus,
  type AgentTurnJournalClient
} from "./agentTurnJournal";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
const MIGRATION = "20260729012105_add_agent_turn_journal.sql";

function row(overrides: Record<string, unknown> = {}) {
  return {
    decision: "created",
    denial_reason: null,
    server_turn_id: TURN_ID,
    local_project_id: "project-a",
    status_name: "created",
    latest_request_id: null,
    latest_step_sequence: 0,
    provider_call_count: 0,
    web_search_call_count: 0,
    image_call_count: 0,
    created_at: "2026-07-29T01:00:00.000Z",
    updated_at: "2026-07-29T01:00:00.000Z",
    terminal_at: null,
    failure_code: null,
    ...overrides
  };
}

function client(
  value: unknown,
  options: { userId?: string | null; error?: unknown } = {}
): AgentTurnJournalClient & { rpc: ReturnType<typeof vi.fn> } {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: options.userId === null ? null : { id: options.userId ?? "user-a" } },
        error: undefined
      }))
    },
    rpc: vi.fn(() => ({
      single: vi.fn(async () => ({ data: value, error: options.error }))
    }))
  };
}

function readMigration(): string {
  return readFileSync(resolve(process.cwd(), "supabase/migrations", MIGRATION), "utf8")
    .split("\r\n")
    .join("\n");
}

describe("A+ Server Turn Journal service", () => {
  it.each([
    ["create", (mock: AgentTurnJournalClient) => createAgentTurnJournalForClient(mock, {
      localProjectId: "project-a",
      creationIdempotencyKey: "create-a"
    })],
    ["read", (mock: AgentTurnJournalClient) => readAgentTurnJournalForClient(mock, {
      serverTurnId: TURN_ID,
      localProjectId: "project-a"
    })],
    ["acquire", (mock: AgentTurnJournalClient) => acquireAgentTurnRequestForClient(mock, {
      serverTurnId: TURN_ID,
      localProjectId: "project-a",
      requestId: "request-a",
      stepSequence: 1,
      requestHash: "a".repeat(64)
    })]
  ])("rejects unauthenticated %s before every RPC", async (_name, operation) => {
    const mock = client(row(), { userId: null });
    await expect(operation(mock)).resolves.toMatchObject({
      status: "denied",
      httpStatus: 401,
      code: "unauthenticated"
    });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("creates a Turn with only local project binding and creation idempotency key", async () => {
    const mock = client(row());
    await expect(createAgentTurnJournalForClient(mock, {
      localProjectId: "project-a",
      creationIdempotencyKey: "create-a"
    })).resolves.toMatchObject({
      status: "ok",
      replayed: false,
      snapshot: {
        serverTurnId: TURN_ID,
        localProjectId: "project-a",
        status: "created",
        counters: { provider: 0, webSearch: 0, image: 0 }
      }
    });
    expect(mock.rpc).toHaveBeenCalledWith("create_agent_turn_journal", {
      p_local_project_id: "project-a",
      p_creation_idempotency_key: "create-a"
    });
    expect(JSON.stringify(mock.rpc.mock.calls)).not.toContain("user-a");
  });

  it("returns the same Turn for an exact creation replay", async () => {
    const mock = client(row({ decision: "replayed" }));
    await expect(createAgentTurnJournalForClient(mock, {
      localProjectId: "project-a",
      creationIdempotencyKey: "create-a"
    })).resolves.toMatchObject({ status: "ok", replayed: true });
  });

  it("maps a creation key reused with another local project to deterministic 409", async () => {
    const mock = client(row({ decision: "denied", denial_reason: "creation_key_conflict" }));
    await expect(createAgentTurnJournalForClient(mock, {
      localProjectId: "project-b",
      creationIdempotencyKey: "create-a"
    })).resolves.toEqual({
      status: "denied",
      httpStatus: 409,
      code: "creation_key_conflict",
      error: "A+ Server Turn Journal 请求发生确定性冲突。",
      recoverable: false
    });
  });

  it("reads a minimal snapshot and hides an invisible user or project as 404", async () => {
    const visible = client({ visible: true, ...row() });
    await expect(readAgentTurnJournalForClient(visible, {
      serverTurnId: TURN_ID,
      localProjectId: "project-a"
    })).resolves.toMatchObject({ status: "ok", snapshot: { serverTurnId: TURN_ID } });

    const hidden = client({ visible: false });
    await expect(readAgentTurnJournalForClient(hidden, {
      serverTurnId: TURN_ID,
      localProjectId: "project-other"
    })).resolves.toMatchObject({ status: "denied", httpStatus: 404, code: "not_found" });
  });

  it("acquires Sequence 1 through the atomic request RPC", async () => {
    const mock = client(row({
      decision: "acquired",
      status_name: "provider_running",
      latest_request_id: "request-a",
      latest_step_sequence: 1,
      provider_call_count: 1
    }));
    await expect(acquireAgentTurnRequestForClient(mock, {
      serverTurnId: TURN_ID,
      localProjectId: "project-a",
      requestId: "request-a",
      stepSequence: 1,
      requestHash: "a".repeat(64)
    })).resolves.toMatchObject({
      status: "ok",
      executionGranted: true,
      replayed: false,
      snapshot: { status: "providerRunning", counters: { provider: 1 } }
    });
    expect(mock.rpc).toHaveBeenCalledWith("acquire_agent_turn_request", {
      p_server_turn_id: TURN_ID,
      p_local_project_id: "project-a",
      p_request_id: "request-a",
      p_step_sequence: 1,
      p_request_hash: "a".repeat(64)
    });
  });

  it("returns exact Request replay without another execution grant", async () => {
    const mock = client(row({
      decision: "replayed",
      status_name: "provider_running",
      latest_request_id: "request-a",
      latest_step_sequence: 1,
      provider_call_count: 1
    }));
    await expect(acquireAgentTurnRequestForClient(mock, {
      serverTurnId: TURN_ID,
      localProjectId: "project-a",
      requestId: "request-a",
      stepSequence: 1,
      requestHash: "a".repeat(64)
    })).resolves.toMatchObject({ status: "ok", executionGranted: false, replayed: true });
  });

  it.each([
    ["request_id_conflict", 409],
    ["sequence_conflict", 409],
    ["sequence_replay", 409],
    ["sequence_skip", 409],
    ["terminal_turn", 409],
    ["status_conflict", 409],
    ["quota_exceeded", 429],
    ["provider_limit", 429],
    ["invalid_turn", 404]
  ])("maps %s without a recoverable task", async (reason, httpStatus) => {
    const mock = client(row({ decision: "denied", denial_reason: reason }));
    await expect(acquireAgentTurnRequestForClient(mock, {
      serverTurnId: TURN_ID,
      localProjectId: "project-a",
      requestId: "request-a",
      stepSequence: 1,
      requestHash: "a".repeat(64)
    })).resolves.toMatchObject({
      status: "denied",
      httpStatus,
      recoverable: false
    });
  });

  it("settles only the matching latest Request and maps the explicit status vocabulary", async () => {
    const mock = client(row({
      decision: "updated",
      status_name: "externally_completed",
      latest_request_id: "request-a",
      latest_step_sequence: 1,
      provider_call_count: 1,
      terminal_at: "2026-07-29T01:01:00.000Z"
    }));
    await expect(settleAgentTurnRequestForClient(mock, {
      serverTurnId: TURN_ID,
      localProjectId: "project-a",
      requestId: "request-a",
      stepSequence: 1,
      status: "externallyCompleted"
    })).resolves.toMatchObject({
      status: "ok",
      replayed: false,
      snapshot: { status: "externallyCompleted" }
    });
    expect(mock.rpc).toHaveBeenCalledWith("settle_agent_turn_request", {
      p_server_turn_id: TURN_ID,
      p_local_project_id: "project-a",
      p_request_id: "request-a",
      p_step_sequence: 1,
      p_status: "externally_completed",
      p_failure_code: null
    });
  });

  it("stores only a bounded machine failure code for external failure", async () => {
    const mock = client(row({
      decision: "updated",
      status_name: "externally_failed",
      latest_request_id: "request-a",
      latest_step_sequence: 1,
      provider_call_count: 1,
      terminal_at: "2026-07-29T01:01:00.000Z",
      failure_code: "provider_http_503"
    }));
    await expect(settleAgentTurnRequestForClient(mock, {
      serverTurnId: TURN_ID,
      localProjectId: "project-a",
      requestId: "request-a",
      stepSequence: 1,
      status: "externallyFailed",
      failureCode: "provider_http_503"
    })).resolves.toMatchObject({
      status: "ok",
      snapshot: { failureCode: "provider_http_503" }
    });
  });

  it("reports a missing RPC as a deployment gap", async () => {
    const mock = client(null, {
      error: { code: "PGRST202", message: "Could not find the function public.create_agent_turn_journal" }
    });
    await expect(createAgentTurnJournalForClient(mock, {
      localProjectId: "project-a",
      creationIdempotencyKey: "create-a"
    })).resolves.toMatchObject({
      status: "denied",
      httpStatus: 503,
      code: "journal_contract_missing"
    });
  });

  it("keeps one explicit camelCase/snake_case status mapping", () => {
    expect(toDatabaseStatus("providerRunning")).toBe("provider_running");
    expect(toDatabaseStatus("awaitingNextRequest")).toBe("awaiting_next_request");
    expect(fromDatabaseStatus("externally_cancelled")).toBe("externallyCancelled");
    expect(fromDatabaseStatus("overall_completed")).toBeUndefined();
  });
});

describe("A+ Server Turn Journal SQL contract", () => {
  it("uses new private tables with no project registry and no direct table grants", () => {
    const sql = readMigration();
    expect(sql).toContain("create table if not exists private.agent_turn_journal");
    expect(sql).toContain("create table if not exists private.agent_turn_request_journal");
    expect(sql).toContain("revoke all on table private.agent_turn_journal from public, anon, authenticated");
    expect(sql).toContain("revoke all on table private.agent_turn_request_journal from public, anon, authenticated");
    expect(sql).not.toMatch(/create table(?: if not exists)? (?:public\.)?projects\b/i);
    expect(sql).not.toMatch(/workspace_owner|project_owner|ownership_relation/i);
  });

  it("derives identity only from auth.uid and scopes every operation to user plus local project", () => {
    const sql = readMigration();
    expect(sql.match(/current_user_id uuid := auth\.uid\(\)/g)).toHaveLength(4);
    expect(sql).not.toMatch(/p_user_id|authenticated_user_id text|authenticated_user_id uuid/i);
    expect(sql.match(/journal\.user_id = current_user_id/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql.match(/journal\.local_project_id = p_local_project_id/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps creation and Request identities unique and serializes acquisition", () => {
    const sql = readMigration();
    expect(sql).toContain("unique (user_id, creation_idempotency_key)");
    expect(sql).toContain("primary key (server_turn_id, request_id)");
    expect(sql).toContain("unique (server_turn_id, step_sequence)");
    expect(sql.match(/for update;/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("p_step_sequence > journal_row.latest_step_sequence + 1");
    expect(sql).toContain("p_step_sequence <= journal_row.latest_step_sequence");
  });

  it("returns exact replay before quota reservation and increments one Provider count only for acquisition", () => {
    const sql = readMigration();
    const acquire = sql.slice(
      sql.indexOf("create or replace function public.acquire_agent_turn_request"),
      sql.indexOf("create or replace function public.settle_agent_turn_request")
    );
    expect(acquire.indexOf("result_decision := 'replayed'")).toBeLessThan(
      acquire.indexOf("public.reserve_ai_daily_quota('text')")
    );
    expect(acquire.indexOf("public.reserve_ai_daily_quota('text')")).toBeLessThan(
      acquire.indexOf("provider_call_count = journal.provider_call_count + 1")
    );
    expect(acquire.match(/provider_call_count = journal\.provider_call_count \+ 1/g)).toHaveLength(1);
    expect(acquire).not.toContain("web_search_call_count = journal.web_search_call_count + 1");
    expect(acquire).not.toContain("image_call_count = journal.image_call_count + 1");
  });

  it("makes terminal states absorbing and settlement idempotent", () => {
    const sql = readMigration();
    expect(sql).toContain("journal_row.server_execution_status in (\n      'externally_completed', 'externally_cancelled', 'externally_failed'");
    expect(sql).toContain("request_row.execution_status = p_status");
    expect(sql).toContain("request_row.execution_status <> 'provider_running'");
    expect(sql).toContain("journal_row.server_execution_status <> 'provider_running'");
    expect(sql).toContain("result_decision := 'replayed'");
  });

  it("bounds providerRunning execution and converges expired requests without replay", () => {
    const sql = readMigration();
    expect(sql).toContain("execution_started_at timestamptz not null");
    expect(sql).toContain("execution_expires_at timestamptz not null");
    expect(sql).toContain("now() + interval '15 minutes'");
    expect(sql.match(/execution_expires_at <= now\(\)/g)).toHaveLength(3);
    expect(sql.match(/external_execution_state_unknown/g)?.length).toBeGreaterThanOrEqual(6);

    const read = sql.slice(
      sql.indexOf("create or replace function public.read_agent_turn_journal"),
      sql.indexOf("create or replace function public.acquire_agent_turn_request")
    );
    expect(read).toContain("for update;");
    expect(read).toContain("server_execution_status = 'externally_failed'");

    const acquire = sql.slice(
      sql.indexOf("create or replace function public.acquire_agent_turn_request"),
      sql.indexOf("create or replace function public.settle_agent_turn_request")
    );
    expect(acquire.indexOf("execution_expires_at <= now()")).toBeLessThan(
      acquire.indexOf("result_decision := 'replayed'")
    );
    expect(acquire.match(/public\.reserve_ai_daily_quota\('text'\)/g)).toHaveLength(1);
    expect(acquire.match(/provider_call_count = journal\.provider_call_count \+ 1/g)).toHaveLength(1);
  });

  it("hardens all exposed RPCs and grants only the authenticated role", () => {
    const sql = readMigration();
    expect(sql.match(/security definer/g)).toHaveLength(4);
    expect(sql.match(/set search_path = ''/g)).toHaveLength(4);
    expect(sql.match(/revoke all on function public\./g)).toHaveLength(4);
    expect(sql.match(/grant execute on function public\./g)).toHaveLength(4);
    expect(sql).not.toMatch(/grant execute[\s\S]{0,160}to anon/i);
  });

  it("stores no local or Provider content and no Overall Local Outcome", () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/messages|transcript|system_prompt|user_prompt|provider_output|tool_arguments|tool_results|workspace_objects|memory_content|summary_content|context_frame|confirmation_content|stack_trace/i);
    expect(sql).not.toMatch(/pending_confirmation|partially_completed|local_tool_failed|overall_completed/i);
    expect(sql).toContain("latest_request_hash text");
    expect(sql).toContain("bounded_failure_code text");
  });
});
