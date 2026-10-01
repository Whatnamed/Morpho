// Optional local PostgreSQL WASM fault harness. No network, secrets or production database access.
// npm.cmd install --prefix temp/p3a-sql-check --no-save --package-lock=false @electric-sql/pglite
// node scripts/verify-external-effect-journal.mjs temp/p3a-sql-check/node_modules/@electric-sql/pglite/dist/index.js
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw new Error("Pass the path to an installed PGlite module.");
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const actor = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
const other = "019fa9c0-7b9d-7a20-8f31-2c676296c9d2";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const namespace = { provider: "grsai", baseUrl: "https://provider.test", credentialScope: hash("credential") };
const effectId = (value) => `effect:${hash(value)}`;
const attempt1 = "019fa9c0-7b9d-7a20-8f31-2c676296c9d3";
const attempt2 = "019fa9c0-7b9d-7a20-8f31-2c676296c9d4";
const frozenRequest = JSON.stringify({ model: "test", prompt: "frozen input" });
const registration = { namespace, frozenRequest, requestDigest: hash(frozenRequest), attemptId: attempt1 };
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const call = async (id, operation, payload = {}, user = actor) =>
  (await db.query("select public.operate_external_effect($1::uuid,$2,'image',$3,$4::jsonb) as result",
    [user, effectId(id), operation, JSON.stringify(payload)])).rows[0].result;
const observe = (id, kind, extra = {}, attemptId = attempt1) => call(id, "observe", {
  attemptId, observationId: hash(JSON.stringify([attemptId, kind, extra])), observation: { kind, ...extra }
});

try {
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role;
    insert into auth.users values ('${actor}'),('${other}');
    create table public.legacy_in_flight(id text, status text); insert into public.legacy_in_flight values ('old','running');`);
  const sql = await readFile(new URL("../supabase/migrations/20261001090000_add_external_effect_observation.sql", import.meta.url), "utf8");
  await db.exec(sql);
  await db.exec(sql);
  check((await db.query("select count(*)::int as n from public.external_effect")).rows[0].n === 0, "No legacy identity backfill");
  check((await db.query("select status from public.legacy_in_flight")).rows[0].status === "running", "Legacy in-flight remains unchanged");
  const privileges = (await db.query(`select
    has_function_privilege('authenticated','public.operate_external_effect(uuid,text,text,text,jsonb)','execute') as client_write,
    has_function_privilege('service_role','public.operate_external_effect(uuid,text,text,text,jsonb)','execute') as server_write,
    has_table_privilege('authenticated','public.external_effect','select') as client_read`)).rows[0];
  check(!privileges.client_write && !privileges.client_read && privileges.server_write, "Trusted server boundary");
  check((await call("legacy", "read")).snapshot === null, "Missing legacy identity stays missing");
  const first = await call("lost", "register", registration);
  check(first.executionGranted && first.snapshot.executionState === "unknown", "Admission is not Provider running evidence");
  await observe("lost", "submitted");
  check(!(await call("lost", "register", registration)).executionGranted, "Ambiguous lost response never grants another POST");
  check((await call("lost", "correction", { ...registration, attemptId: attempt2, correction: "cacheCompatibility" })).executionGranted === false, "Unknown cannot authorize compatibility correction");
  check((await call("lost", "register", { ...registration, requestDigest: hash("changed"), frozenRequest: "changed" })).error === "effect_request_conflict", "Frozen request conflict");
  check((await call("lost", "read", {}, other)).snapshot === null, "Owner isolation");
  await call("known", "register", registration);
  await observe("known", "running", { taskId: "same-task" });
  check((await call("known", "read")).snapshot.taskId === "same-task", "Task survives another observer/instance");
  await observe("known", "unknown");
  check((await call("known", "read")).snapshot.executionState === "running", "Transport errors preserve Provider running evidence");
  await call("known", "cancel");
  await observe("known", "localAbort");
  check((await call("known", "read")).snapshot.executionState === "running", "Cancel intent/local abort do not prove cancellation");
  const late = await observe("known", "succeeded", { taskId: "same-task" });
  check(late.snapshot.executionState === "succeeded" && late.snapshot.cancelRequestedAt && late.snapshot.localAbortObservedAt, "Late success and cancellation coexist");
  await observe("known", "failed", { taskId: "same-task" });
  check((await call("known", "read")).snapshot.executionState === "succeeded", "Success cannot be downgraded");
  const before = (await db.query("select count(*)::int as n from public.external_effect_observation")).rows[0].n;
  await observe("known", "succeeded", { taskId: "same-task" });
  check((await db.query("select count(*)::int as n from public.external_effect_observation")).rows[0].n === before, "Duplicate observation has no second effect");
  check((await observe("known", "running", { taskId: "different-task" })).error === "provider_identity_conflict", "Task identity cannot mutate");
  await call("cancel-before", "cancel");
  check(!(await call("cancel-before", "register", registration)).executionGranted, "Pre-register cancel tombstone blocks POST");
  await call("failure", "register", registration);
  await observe("failure", "failed", { taskId: "failed-task" });
  check((await call("failure", "read")).snapshot.executionState === "failed", "Explicit Provider failure is recorded");
  await observe("failure", "succeeded", { taskId: "failed-task" });
  check((await call("failure", "read")).snapshot.executionState === "succeeded", "Late success remains admissible after failure");
  await call("rejected", "register", registration);
  await observe("rejected", "rejected");
  const corrected = await call("rejected", "correction", { ...registration, frozenRequest: "{\"corrected\":true}",
    requestDigest: hash("{\"corrected\":true}"), attemptId: attempt2, correction: "cacheCompatibility" });
  check(corrected.executionGranted && corrected.snapshot.requestDigest === registration.requestDigest, "Compatibility attempt does not replace the logical frozen request");
  await observe("rejected", "rejected", {}, attempt2);
  check(!(await call("rejected", "correction", { ...registration, attemptId: attempt1, correction: "cacheCompatibility" })).executionGranted, "Correction at most once");
  const saved = (await db.query("select frozen_request from public.external_effect where effect_id = $1", [effectId("rejected")])).rows[0];
  check(saved.frozen_request === frozenRequest, "Original logical request remains immutable");
  console.log(`P3A SQL checks: ${checks} passed; migration reapplied; no production access.`);
} finally { await db.close(); }
