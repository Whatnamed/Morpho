# Morpho Runbook

## Current release status

As of 2026-08-04, A+ Phase A and Phase B are complete. The sole A+ application is the current
Vercel Production Runtime, `main` and `refactor/agent-runtime-a-plus` are aligned at the same
release commit, and the repository is in the healthy observation window before Phase C. The
earliest read-only observation audit is `2026-08-06 10:28:24 Asia/Shanghai`.

Phase C is not authorized or executed. Do not run
`20260729190000_remove_agent_runtime_b_proofs.sql`, `supabase db push`, repair, reset, rollback,
or any remote database write as part of ordinary verification. After the observation time, the
remaining task is a separately recorded read-only audit of A+ Journal/Request/External Action
records, continuity and recovery, duplicate or hanging execution, authentication/database health,
and residual B-runtime dependencies. That audit does not grant Phase C authorization.

## Install

Use the repository `.npmrc` registry setting.

```bash
npm.cmd install
```

## Vercel Production

Morpho is currently deployed to Vercel. The standard production-compatible build is:

```bash
npm.cmd run build
```

Vercel must receive the values named in `.env.example`; never copy values from local `.env.local` into documentation, logs, or Git.

Since 2026-07-27 the build self-hosts Geist through `next/font/google`
(`src/app/layout.tsx`), so the **build machine needs outbound access to
`fonts.googleapis.com` / `fonts.gstatic.com`** on the first uncached build. An
offline build fails at font fetch; behind a proxy, set `HTTPS_PROXY` for the
build shell.

## Cloudflare Workers Backup Capability

Cloudflare/OpenNext remains a retained, opt-in backup capability and does not replace the Vercel production path. Normal `next dev`, validation, and production builds do not initialize OpenNext or read `.dev.vars`; only explicit `cf:*` commands enter that path. Keep the Cloudflare files and scripts intact. See [Cloudflare Workers deployment](./cloudflare-workers.md) for its separate configuration, preview, deployment, acceptance, and rollback flow.

## Environment

Morpho's production Context Policy is fixed in `src/domain/morpho/agentContextPolicy.ts`: `256000` window, `204800` prepare, `230400` compact, `16000` target uncompressed tail, and a separate `16000` response reserve. These values are not configured through Vercel environment variables. Do not add `MORPHO_AI_CONTEXT_*` variables to `.env.local` or Vercel; they are ignored by the production runtime.

Copy `.env.example` to `.env.local` for local development. Do not commit `.env.local`. `.env.example` is the sole baseline for environment-variable names, documented defaults, and comments.

tldraw hobby / production license (browser-safe public key):

```text
NEXT_PUBLIC_TLDRAW_LICENSE_KEY=
```

Put the key in `.env.local` only. Restart `next dev` after changing it. The app passes it to `<Tldraw licenseKey={...} />` from `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`.

Supabase email/password authentication for closed-test access:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
MORPHO_AUTH_REQUIRED=true
```

The two `NEXT_PUBLIC_SUPABASE_*` values are public browser configuration, not secrets. Never use a Supabase service-role key in this application. Supabase stores account identity, tester eligibility, AI daily-quota state, and the minimal A+ Server Turn / Request / External Action Journals. It does not store projects, canvases, files, images, chat bodies, project memory, or the overall local Turn Outcome; projects and backups remain local in browser localStorage / IndexedDB and are not cloud-synced.

With `MORPHO_AUTH_REQUIRED=true`, missing public Supabase configuration fails closed: `/login` renders the configuration error with no variable values, while `/` and `/projects/*` redirect to `/login` instead of rendering protected content. `/api/ai/*` retains its 503 configuration failure behavior. Set `MORPHO_AUTH_REQUIRED=false` only for explicit local authentication bypass.

The workspace has one Agent Runtime and no Runtime environment selector. Historical
`NEXT_PUBLIC_MORPHO_AGENT_RUNTIME` values such as `b` or `a-plus-stage3` are not read by the
application and do not provide a rollback path. Remove that variable from deployment settings when
convenient; leaving an old value present does not change the selected Runtime.

Text chat and agent turns use the AiJWS / OpenAI-compatible `MORPHO_AI_*` group defined in `.env.example`. Its current example model is `gpt-5.6-terra`.

`MORPHO_AI_*` configures the formal A+ Provider Request path under
`/api/ai/agent/turns/[turnId]/requests`, the independent `/api/ai/chat` route, and related web-search
gating. The server also accepts `AIJWS_API_KEY`, `AIJWS_BASE_URL`, and `AIJWS_MODEL` as compatibility
aliases. MiMo variables are no longer used for text AI.

AiJWS text behavior:

- ordinary text and selected-image chat/research use `MORPHO_AI_MODEL`;
- supported reasoning models use `MORPHO_AI_REASONING_EFFORT` with `low`, `medium`, or `high`; omit it to use the provider default;
- selected active images in visual-planning `imageGeneration` requests are sent to AiJWS for the structured visual plan, then GrsAI generates the actual images;
- image input is limited to selected active IndexedDB image assets. Small selections are sent as individual compressed images; larger selections are packed into one or more contact sheets so every selected image is represented without exposing a user-facing upload count limit;
- hidden images, unselected images, default references, and whole-canvas screenshots are not sent by default;
- selected parsed file objects can send bounded local `documentExtract` text to AiJWS for chat/research context. Extracts are local sources, not provider citations;
- selected parsed file objects can also send bounded local `documentExtract` text to AiJWS for visual planning when `taskMode === "imageGeneration"` and the current task context authorizes them;
- when `MORPHO_AI_WEB_SEARCH_ENABLED=true`, chat/research requests may provide provider web-search tooling where supported. Image generation never receives web search tools;
- source links are shown only when the provider returns citation/annotation fields.
- Provider Prompt Cache Hints stay disabled by default. After the current relay passes a compatibility probe, enable only the capabilities it actually supports and use `MORPHO_AI_PROMPT_CACHE_KEY_ENABLED=true` to opt into the opaque server-generated partition key. `24h` retention is sent only when both retention support and `MORPHO_AI_PROMPT_CACHE_RETENTION=24h` are configured. These fields are performance hints, not identity, project ownership, idempotency, cache-hit, or execution proofs; a cache miss never changes correctness.
- each formal Agent user turn persists an immutable provider-visible input snapshot without keys, raw provider responses, cost data, or image Base64; old snapshots are replayed before current workspace state, while legacy input, image input, unavailable document snapshots, tool-profile changes, prompt-contract changes, and compaction are explicit cache boundaries;
- provider-only Context Frames use persisted `sequence` / `placement`; post-tool state stays after its initiating user on replay, and one active Summary Frame is retained per summary revision;
- the client and server share `src/shared/providerInputBudget.ts`, including active frames and tools in the 256k / 80% / 90% budget while keeping the 16k response reserve separate; prepare does not drop valid history;
- cache status is `unavailable`, `miss`, `partialHit`, or `fullHit`. Retention is absent by default, `in_memory` is ignored, and only explicit capability-verified `24h` is forwarded. Without a live probe, AiJWS cache-field compatibility remains unverified.

Image generation uses the GrsAI `MORPHO_GRS_*` group defined in `.env.example`.

`MORPHO_GRS_DEFAULT_MODEL` (example value `gpt-image-2`) is the **server-side default / compatibility fallback** used when a request omits a model or needs a catalog default. It does **not** mean every Morpho image task is fixed to that model. `MORPHO_GRS_IMAGE_MODEL` remains a legacy fallback for existing local environments.

Workspace visual generation routes models by intent (see `resolveImageGenerationSettingsForVisualIntent` in `src/features/workspace/imageGenerationSettings.ts`):

- `directionPreview` / direction batch preview → `nano-banana-2-lite` (fast multi-shot scouting);
- `visualDevelopment`, continue-development, directed edit, scene/detail work, and unknown intent → `gpt-image-2` (higher quality iteration).

Paid provider smoke tests are disabled unless explicitly enabled:

```text
MORPHO_ALLOW_PAID_SMOKE_TESTS=false
```

The browser sends `modelId` (from intent routing for main visual paths), aspect ratio, optional size option, and client request ID to `/api/ai/image`. The route still requires server-only GrsAI config, but the provider request body is normalized on the server.

Current implemented behavior:

- automatic model routing (no required user model picker for the main visual paths):
  - direction preview batch → `nano-banana-2-lite`;
  - visual development / directed edit / scene / detail / unknown → `gpt-image-2`;
- catalog of selectable models still lives in `src/domain/morpho/grsImageModels.ts`;
- `MORPHO_GRS_DEFAULT_MODEL` is server default/fallback only, not a global override of the intent router;
- the formal Agent serializes Image child Actions so each in-flight child has one durable write-ahead
  descriptor; non-Agent visual workflows may still use the shared four-request concurrency helper;
- `nano-banana-*` profiles send `replyType: "json"` and send `imageSize` only when the selected model supports a size option;
- `gpt-image-2` sends pixel-style `aspectRatio`, `replyType: "json"`, and no `imageSize`;
- generated image assets store intrinsic width, height, and aspect ratio when the browser can read them.
- image generation operations store operation IDs and client request IDs; uncertain network responses are not automatically resubmitted.
- direction-preview and visual-development generation use Agent structured visual intent,
  deterministic reference resolution, local Prompt compilation, and one journaled child Action at a time;
- `1`, `2`, `4`, and `6` are UI shortcuts only. Explicit positive counts and more than three selected directions are valid;
- image-generation metadata records requested count, structured intent, compiled prompt, prompt-contract version, reference-resolution omissions, model settings, successful result IDs, and per-item failures.
- the current GRSAI request supports text-to-image, image-to-image, and prompt-level directed edit. It has no mask/inpainting field; UI and prompts must not promise pixel-level local editing, and sources are never overwritten.

Milestone 3 Operation records are local-first and lightweight. Workspace JSON stores operation status, summaries, proposals, citation snapshots, and IndexedDB artifact references. It does not store raw webpages, large extracted files, page previews, provider raw responses, API keys, or response headers.

Only one active Operation is allowed per project. Browser reload marks unfinished operations as `interrupted` and keeps the input snapshot and retryable state; it does not pretend a background job continued.

Research operations can read selected parsed file extracts, selected image pixels, current workspace semantic context, and optional provider web search. A valid research result is recorded and applied into a research card automatically. Key conclusions, design definitions, concept directions, default references, direction status, and delivery decisions still require their own explicit proposal/application paths.

AI continuity and Project Memory:

- the formal panel calls only A+ resources under `/api/ai/agent/turns`; `/api/ai/chat` is independent
  and has no formal-panel caller;
- all uncompressed project messages participate below the Token threshold. Lane, focus, selection, direction, and branch do not filter history;
- automatic compaction persists a validated summary revision and covered boundary before older messages leave provider input. Raw messages remain in the workspace and `search_project_conversation` can still return them;
- explicit history, memory, and progress questions must complete their required read tools before final text is accepted;
- `submit_memory_update` accepts only locally authorized exact quotes from the current persisted user message. AI suggestions and one-off requests are rejected as stable preferences;
- deterministic project facts project into seven current Memory documents and only actually occurred Stage Records. Current versions, source refs, revision chains, and `reviewRequired` are visible under `项目记录`;
- successful writes show only specific feedback such as `已更新项目偏好`, `已记录设计决定`, or `已更新方向与视觉发展记录`; no write means no feedback;
- schema 1-16 backups may contain retired checkpoint/lane/image compatibility fields, but restore inspects and migrates them into the schema-17 canonical workspace before the new copy is returned; current backups never emit those fields.


Delivery preparation drafts:

- delivery drafting uses the A+ Provider Request path and the `prepare_delivery_section_draft` tool,
  with only the current section's frozen `deliverySectionContext` snapshots authorized;
- web search is disabled for this intent even if `MORPHO_AI_WEB_SEARCH_ENABLED=true`;
- the browser does not send selected image pixels, full source files, full `documentExtract` text, normal task context, or Compare context for delivery section drafts;
- locally validated `prepare_delivery_section_draft` arguments create only a pending draft; section narrative, captions, suggested gaps, DecisionRecord, and continuity event are written only when the user applies it.

Without these variables, the app still runs locally, but provider routes return clear configuration errors instead of fake AI results.

## Development Server

```bash
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

Expected local URLs:

```text
http://127.0.0.1:3000/
http://127.0.0.1:3000/projects/project-morpho-case-study
```

## Checks

```bash
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run case-study:upgrade
```

Expected results:

- `lint`: ESLint completes with no reported problems.
- `typecheck`: `tsc --noEmit` completes.
- `test`: Vitest runs domain, persistence, import, query, AiJWS/OpenAI-compatible, and GrsAI tests.
- `build`: `next build` completes and prerenders static pages/routes where applicable.
- `case-study:upgrade`: upgrades the generated current-case workspace to schema 16; running it twice must leave the workspace hash unchanged.

GitHub CI runs the same core quality gate in `.github/workflows/quality.yml` on pushes to `main` and on pull requests:

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The CI workflow does not use `.env`, provider API keys, Vercel tokens, paid model smoke tests, deployment, publishing, or version changes.

## Supabase Security Notes

The remaining Security Advisor notices for `public.get_my_access_state()` and `public.reserve_ai_daily_quota(text)` are intentional and reviewed. They remain `SECURITY DEFINER` RPCs executable only by `authenticated`, because RLS blocks direct access to the qualification/quota tables and the application needs narrow current-user operations to read access state and atomically reserve quota. Both functions use fixed `search_path`, derive identity from `auth.uid()`, accept no cross-user identifier, use no dynamic SQL, and return only the caller's own state. Do not change them to `SECURITY INVOKER` or revoke `authenticated` execution just to remove the notices.

### A+ Stage 2 Server Turn Journal Migration

Stage 2 adds this forward-only migration for the isolated A+ path:

```text
supabase/migrations/20260729012105_add_agent_turn_journal.sql
```

It creates only the private `agent_turn_journal` and `agent_turn_request_journal` tables and
narrow current-user RPCs. The Journal binds a Server Turn to `auth.uid()` and a client-supplied
local project ID; it does not prove ownership of that browser-local project or create a project
registry. It stores identifiers, a server-computed Request Hash, sequence, external status and
counters, timestamps, revision, and an optional bounded failure code. It does not store prompts,
messages, Provider output, Tool arguments/results, Workspace content, Memory, Summary, confirmation
state, local Outcome, or raw errors.

Each acquired Provider request records `execution_started_at` and an
`execution_expires_at` exactly 15 minutes later. Authenticated Journal reads and exact request
replays take row locks and atomically converge an expired `provider_running` request to
`externally_failed` with `external_execution_state_unknown`. That convergence must not invoke the
Provider again or increment the Provider counter or daily quota. The request route retries a
transient settlement failure at most twice after the initial attempt; exhausted settlement retry
is not proof of external success or failure, so later query/replay performs the deadline-based
convergence.

The two additive A+ migrations described in this section were later applied and database-verified
by Phase A. Do not rerun them from the current Stage 4 checkout. The historical Phase A procedure
below pins the independently accepted Stage 3 release checkout and records the exact dry-run/write
boundary; it is retained for audit evidence, not as a pending current operation.

Before editing this migration in place or deploying the Stage 2 revision, inspect the verified
remote migration list. If `20260729012105` has never been applied, the checked-in migration remains
the single forward application. If an earlier form of `20260729012105` is already recorded remotely,
do not expect changed file contents to run again: create a later forward-only migration that adds
`execution_started_at`, `execution_expires_at`, their constraint, and the revised read/acquire/settle
RPC definitions. Never repair this by deleting remote migration history or applying unrelated SQL.

Stop without changing the remote database if the CLI is missing, authentication is unavailable,
the linked ref is not independently verified, or the dry run contains unrelated migrations. A
missing A+ contract fails the new routes closed with `journal_contract_missing`; it does not fall
back to the B Lease or a client-trusted path.

The isolated Stage 2 API is:

```text
POST /api/ai/agent/turns
GET  /api/ai/agent/turns/[turnId]?localProjectId=<local-project-id>
POST /api/ai/agent/turns/[turnId]/requests
```

Use the authenticated `GET` request only to diagnose minimal Server External Execution Status.
The response contains no user ID, Request Hash, Provider body, or local project content. There is
no A+ Feature Flag in the independently audited Stage 2 baseline. Stage 4 has now made these
resources the sole formal Runtime path and removed the temporary Stage 3 selector and retired
Lease/Closure/Snapshot implementation.

For isolated Stage 2 client checks, validated current-request display events may be observed via
the Coordinator's optional `onDisplayEvent` sink. It is not a lifecycle or persistence input.
When recovery reads `awaitingNextRequest` but the matching Provider payload was never observed,
the client must terminate with `providerContinuationPayloadUnavailable`; do not synthesize output,
Tool Calls, or replay the external request. Existing Fault and Tool/Persistence/unresolved-work
reasons must remain in the reducer-derived Outcome. Treat `journal_unavailable` as retryable with the same
Request ID and sequence, while quota, conflict, and terminal Provider/contract denials remain
non-retryable according to their typed lifecycle error. If a deterministic denial occurs after
Provider execution already started, treat it as a Coordinator diagnostic and immediately query the
Journal before recording any lifecycle conflict: terminal status finalizes locally,
`awaitingNextRequest` follows the matching local-payload rule, while `providerRunning` becomes query-only
`external_execution_pending_reconciliation`. `journal_query_failed` is recoverable and must be
retried as a status query, never as a new Provider execution.

Before every new Host execution, the Coordinator must pass the same pure Provider-start validation
used by the lifecycle reducer. An unresolved Fault must therefore fail before the request Route is
called. When querying during `recovering`, dispatch `RECOVERY_RESOLVED` for the matching Fault before
observing `providerRunning`, `awaitingNextRequest`, or any external terminal status; do not send
status or payload-loss events directly into the recovering phase.

### A+ Stage 3 External Action Journal Migration And Verification

Stage 3 adds one later, forward-only Migration:

```text
supabase/migrations/20260729093000_add_agent_turn_external_actions.sql
```

Migration order is fixed:

```text
20260729012105_add_agent_turn_journal.sql
20260729093000_add_agent_turn_external_actions.sql
```

Never edit the remote migration ledger and never rely on changed contents of an already recorded
Migration. In particular, do not modify or reapply
`20260729012105_add_agent_turn_journal.sql`. If a verified remote has an older form of either
contract, create a new later forward-only Migration. Do not delete a remote Migration row, reset the
database, or paste unrelated SQL to make local and remote histories appear equal.

At the time of the Stage 3 implementation, neither Migration had been applied remotely. Phase A
later applied and database-verified the complete additive pair; the current Stage 4 checkout still
contains the later irreversible cleanup and is not a safe source for an additive-only `db push`.
The Phase A commands in the later verification section are historical audit evidence and must not
be rerun. A checked-in SQL file or successful static test is not, by itself, evidence that a remote
database has been upgraded.

After an authorized application, verify the private tables, RLS, routine security, and grants in the
Supabase SQL editor:

```sql
select n.nspname as schema_name, c.relname, c.relrowsecurity
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'private'
  and c.relname in (
    'agent_turn_external_action_claim',
    'agent_turn_external_action_journal'
  )
order by c.relname;

select routine_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'settle_agent_turn_request_with_action_claims',
    'acquire_agent_turn_external_action',
    'read_agent_turn_external_action',
    'settle_agent_turn_external_action'
  )
order by routine_name;

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'settle_agent_turn_request_with_action_claims',
    'acquire_agent_turn_external_action',
    'read_agent_turn_external_action',
    'settle_agent_turn_external_action'
  )
order by routine_name, grantee;
```

Both tables must have RLS enabled and no direct `public`, `anon`, or `authenticated` table grants.
All four routines must be `SECURITY DEFINER` with fixed empty `search_path`; only `authenticated`
has `EXECUTE`. The functions derive the user from `auth.uid()` and bind every operation to that
user's Server Turn and the Turn's client-supplied local project ID. This is not browser-local project
ownership and adds no project registry or cloud Workspace.

The sole formal Agent resources are:

```text
POST /api/ai/agent/turns
GET  /api/ai/agent/turns/[turnId]?localProjectId=<local-project-id>
POST /api/ai/agent/turns/[turnId]/requests
POST /api/ai/agent/turns/[turnId]/requests/cancel
POST /api/ai/agent/turns/[turnId]/actions/web-search
POST /api/ai/agent/turns/[turnId]/actions/image
POST /api/ai/agent/turns/[turnId]/actions/compaction
```

Use only authenticated requests. Search/Image calls also require the bounded Tool Claim that the
server stored atomically when it observed and settled the Provider Tool Call. External Action ID +
Hash replay is read-only with respect to provider execution, Counters, and quota. A completed Search
may replay one bounded expiring receipt. A completed Image or Compaction whose payload was lost
returns `external_action_result_unavailable`; do not retry it under a new Action ID merely to recover
the payload.

For an authorized diagnostic connection, inspect only bounded status and identity fields:

```sql
select server_turn_id, local_project_id, server_execution_status,
       latest_request_id, latest_step_sequence,
       provider_call_count, web_search_call_count, image_call_count,
       bounded_failure_code, updated_at, terminal_at
from private.agent_turn_journal
order by updated_at desc
limit 20;

select server_turn_id, request_id, step_sequence, action_id, action_kind,
       execution_status, bounded_failure_code,
       execution_started_at, execution_expires_at, updated_at, terminal_at
from private.agent_turn_external_action_journal
order by updated_at desc
limit 50;
```

Interpret recovery states as follows:

- `request_not_observed`: the local Recovery Record has an exact active Request, while the Journal
  remains `created` with `latest_request_id is null` and `latest_step_sequence = 0`. Retry only the
  same Request ID, sequence, and body; do not allocate a new identity.
- query-only reconciliation: `providerRunning` or `running` means the external owner may still be
  executing. Query the Journal or allow its deadline convergence; do not call Provider, Search,
  Image, or Compaction again.
- a Search replay that returns `202 running` is polled only for a short bounded window by repeating
  the exact same Action ID, identity, and request body. This is a Journal query/replay, not a new
  Search. If it remains running, surface `external_action_running`; never allocate a recovery ID.
- `awaitingNextRequest`: resume only when the browser Recovery Record still has the matching Tool
  payload. Missing payload ends locally as `providerContinuationPayloadUnavailable`; it does not
  rerun Provider.
- external terminal status: observe it through the client reducer. It does not decide the local Tool
  result, Workspace persistence, pending confirmation, or Overall Local Agent Turn Outcome.

On page load, A+ validates the project-bound local Recovery Record, restores the Coordinator, then
queries the Server Turn Journal before retrying or resuming. Exact request bodies, large observed
Tool payloads, Continuation items, and confirmation payloads are SHA-256-verified IndexedDB values;
`localStorage` contains only their bounded references and lifecycle metadata. A deterministic local
record/message/project conflict is cleared from the active scheduling slot and shown as failure so
the next legal Turn is not blocked. A local persistence failure instead retains the record for
diagnosis and does not report full success.

Stage 4 removed Runtime selection. Database readiness does not choose a client Runtime; the A+
Routes are the only formal Agent resources in this checkout. Applying any pending Migration remains
a separate, explicitly authorized operator action.

### Stage 4 B-Proof Cleanup Migration

Stage 4 adds this forward-only cleanup Migration after the two A+ Journal Migrations:

```text
supabase/migrations/20260729012105_add_agent_turn_journal.sql
supabase/migrations/20260729093000_add_agent_turn_external_actions.sql
supabase/migrations/20260729190000_remove_agent_runtime_b_proofs.sql
```

The cleanup drops only the retired B Lease table and its public RPCs. It does not drop or alter the
Server Turn, Request, or External Action Journal. It has been checked in but was not applied to any
remote database as part of Stage 4. Do not edit or replay older migration files to simulate cleanup;
use the fixed forward-only order above after the operator verification procedure below.

The Supabase Free-plan leaked-password-protection advisor warning is a plan limitation. It is not fixed by changing application SQL or weakening authentication behavior.

## Archive And Backup

Current workspace export/restore entry:

- open a project workspace;
- click the top `归档` button;
- use the floating panel to export a human-readable archive, export an editable backup, or restore an editable backup zip.

Current behavior:

- archive export may finish with warnings when referenced local binaries are missing or byte lengths no longer match asset metadata;
- editable backup export is stricter and is blocked when required local binaries are missing or mismatched;
- editable backups always use full AI continuity scope and preserve raw messages, summary revisions, legacy checkpoints, Memory/Stage revisions, Continuity Events, traces, citations, Compare analyses, and image-generation provenance;
- restore always creates a new local project copy with a new project id and new runtime asset storage keys;
- restore writes blobs first and then writes workspace/catalog state, with best-effort cleanup if persistence fails.

## Delivery Output

Current delivery output entry:

- open a project workspace;
- click the top `输出` button;
- choose one active delivery preparation package;
- review the preflight summary for sections, stable references, embedded assets, link/no-binary items, missing or mismatched assets, open gaps, and pending drafts;
- click `导出交付输出包` to download a zip for external layout tools.

Current behavior:

- output format is `morpho-delivery-output` with `outputVersion: "1"`;
- the zip includes `output-manifest.json`, `README.md`, `delivery-outline.md`, `captions-and-copy.md`, `gaps-and-next-steps.md`, `asset-index.md`, `source-map.json`, and selected-reference assets under `assets/`;
- only assets required by the selected delivery object's stable references are read from IndexedDB;
- missing local binaries and byte-size mismatches export with warnings and are documented instead of being replaced by empty files;
- link-only and text/conclusion references do not create fake local assets;
- delivery output does not restore projects, write workspace state, apply pending drafts, refresh stable references, or create final PPT/PDF/Figma layouts.

Manual provider smoke checks are separate from the default command set and should be run only with real `.env.local` keys and `MORPHO_ALLOW_PAID_SMOKE_TESTS=true`. Do not print keys, key counts, key suffixes, provider raw headers, or provider raw error bodies while testing.

### Agent Responses SSE Probe

Use the local-only probe with a real `.env.local` and explicit paid-test permission:

```bash
node --experimental-strip-types --env-file=.env.local scripts/probe-agent-responses-stream.mjs --scenario=reasoning
node --experimental-strip-types --env-file=.env.local scripts/probe-agent-responses-stream.mjs --scenario=tool --fixture=responses-reasoning-tool-stream.ndjson
node --experimental-strip-types --env-file=.env.local scripts/probe-agent-responses-stream.mjs --scenario=continuation --fixture=responses-tool-continuation-stream.ndjson
node --experimental-strip-types --env-file=.env.local scripts/probe-agent-responses-stream.mjs --scenario=full-agent-continuation
node --experimental-strip-types --env-file=.env.local scripts/probe-agent-responses-stream.mjs --scenario=assistant-history-output-text
node --experimental-strip-types --env-file=.env.local scripts/probe-agent-responses-stream.mjs --scenario=cancel
```

The probe sends only synthetic inputs. It logs event names and writes only sanitized fixtures: no keys, headers, project data, image URLs, encrypted reasoning, or raw diagnostics. The optional `web-search` scenario is expected to report a clean failure if the active provider does not support it; do not replace that failure with a Chat Completions retry.

For manual Agent acceptance, use the logged-in local `project-morpho-case-study` page and keep the case content focused on the ocean-buoy project. Verify a normal answer, a real tool loop beyond four model continuations, optional commentary, no-commentary tool execution, native/provider search activity when available, image generation, cancellation, user-controlled disclosure state, page refresh of a completed trace, and a clean browser console. The process disclosure must contain only real reasoning summaries, commentary, and activity; final text remains below it.

## AI Continuity Browser Acceptance

Start a development server with real local configuration. Use the already-open Chrome local page when available and the generated current-case project:

```bash
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000/projects/project-morpho-case-study`. Formal panel traffic must stay
under `/api/ai/agent/turns`; no workspace action may call `/api/ai/chat`.

Minimum acceptance:

1. Ask `你还记得最早的对话是什么吗？`; verify the process calls `search_project_conversation` and the answer cites the real earliest user message and time.
2. Ask `你看看本地文档，应该有记录过本地文档吧，关于进度还有记忆之类的` and `你还记得上下文吗，关于产品的现在进度如何了`; verify real Project Memory/Stage Record reads occur before the answer and no source-free “没有记录” claim appears.
3. Continue several turns while changing selection, direction, VisualBranch, Current Focus, and delivery-panel visibility; verify one continuous conversation remains and earlier discussion is still recalled.
4. State one explicit stable preference and one avoidance. Verify only the exact user-backed items enter `偏好与避免项`, specific update feedback appears, source navigation works, and an AI suggestion/one-off generation request does not become a preference.
5. Confirm a primary/alternative/eliminated direction decision and verify Decision Log, Rejected Directions, relevant Stage Record, revision chain, and restore semantics.
6. Run visual development for 3 images, then four directions with 3 previews each. Run one batch with
   default reference excluded, plus scene, CMF, and detail tasks. Verify complete plans, serial
   write-ahead child execution, partial-result retention, no source overwrite, one Agent Trace, and
   persisted intent/compiledPrompt/reference/model provenance. Paid calls require
   `MORPHO_ALLOW_PAID_SMOKE_TESTS=true` and explicit user authorization.
7. Generate a delivery-section draft. Verify `prepare_delivery_section_draft` uses frozen section references and creates a pending draft; no delivery content changes before explicit apply.
8. Export an editable backup, inspect it, restore a new copy, and verify raw chat, compaction, Memory/Stage revisions, traces, citations, Compare records, assets, and generation provenance survive.

Automatic compaction may be tested without manufacturing a huge transcript. In development only, set this before reloading:

```js
localStorage.setItem("morpho:test:conversation-token-limits", JSON.stringify({
  windowTokens: 40000,
  prepareTokens: 17000,
  compactTokens: 18000,
  targetUncompressedTokens: 400
}));
```

Verify one `整理讨论上下文` activity, an advanced summary boundary, retained raw messages, and successful history search across that boundary. Remove the key after acceptance. Production builds ignore this override.

For every scenario, inspect console and network failures, hydration errors, duplicate Thinking/progress surfaces, overlapping UI, and final workspace persistence. Do not treat a rendered answer alone as acceptance evidence.


Document reader mock acceptance for M5-D1:

- use a real browser with a mocked local workspace and IndexedDB `documentExtract` Blob; do not add a permanent mock route and do not call real providers;
- select an active parsed file with a valid `documentExtract`, click `阅读解析内容`, verify the floating reader shows file metadata, the local parsed-text warning, block/character-range location, and safe text rendering;
- search a repeated keyword, use next/previous and result clicks, and verify navigation scrolls to extract blocks without calling `/api/ai/chat` or `/api/ai/image`;
- open a PDF/PPTX parsed-file fixture that has `extractedPageCount` but no persisted source map and verify the UI shows only the parser count plus block/character location, not page or slide jump controls;
- select unparsed, parsing, failed, hidden, missing-extract, wrong-source-type, and missing-Blob files and verify the reader does not fake body text, does not reparse, does not call providers, and does not mutate file state;
- switch from file A to file B while A's Blob read is still pending, then let A finish and verify B remains visible; close while a read is pending and verify there is no stale state update or console error;
- after open, search, navigation, and close, verify canvas selection, AI messages, project continuity, conversation checkpoints, Compare analyses, DecisionRecords, and operations remain unchanged.

Document fragment mock acceptance for M5-D2:

- use a real browser with a mocked local workspace and IndexedDB `documentExtract` Blob; do not add a permanent mock route and do not call real providers;
- open an active parsed file, select two adjacent parsed blocks, edit the fragment title, and click the explicit extract action;
- verify a new `documentFragment` canvas object appears, the reader remains open, success feedback appears, and the body matches the exact `documentExtract` slice for the saved offsets;
- verify extraction does not call `/api/ai/chat` or `/api/ai/image`, does not create an AI message, DecisionRecord, Compare analysis, operation, checkpoint, semantic patch, key conclusion, or current-focus update;
- select non-consecutive blocks or more than the configured block/character limits and verify no fragment or continuity record is created, no silent truncation occurs, and the UI shows the validation reason;
- select an existing fragment and click source-location. Verify the reader opens the source file, highlights the real extract range, and shows no fabricated PDF page, PPT slide, or coordinate location;
- hide or remove the source file, or change/remove the source extract asset, then select the fragment. Verify the fragment body remains readable, source status is hidden/unavailable/mismatch as appropriate, and source-location is disabled;
- select two active fragments and start Compare. Verify only those fragment IDs are Compare sources, evidence basis is `documentFragment`, and the source file full text is not auto-attached.

Delivery preparation mock acceptance for M6:

- open the floating delivery preparation panel from the top controls or a selected delivery card; opening/closing must not call providers or write Current Focus;
- create a presentation preparation package, edit one section title/purpose, select active research/documentFragment/conceptDirection/image objects, and add them to different sections;
- verify stable delivery references are created, source objects are unchanged, duplicate source references in the same section are blocked, and the same source can be added to another section;
- edit a caption/note, move a reference, remove a reference, add a manual gap, resolve/reopen/remove the gap, close/reopen the panel, and verify content persists;
- modify a source image title or role and hide a source file behind a document fragment, then verify old snapshots remain readable and source states show updated/hidden without automatic refresh;
- click `更新为当前版本` on a source-updated reference, confirm that only that reference snapshot/fingerprint updates, caption/note remain, the source object is unchanged, and a DecisionRecord plus delivery continuity event are written;
- monitor `/api/ai/agent/turns/**`, click `生成本节说明草稿`, and verify the Agent calls
  `prepare_delivery_section_draft` against only the current frozen section references, without
  selected image Base64, Blob URLs, or full source-file text;
- return a valid delivery tool call and verify a pending draft appears with no section narrative/caption/gap write before `应用草稿`;
- apply the draft and verify narrative, listed captions, suggested gaps, DecisionRecord, and continuity event are written;
- return malformed tool arguments, an unauthorized reference ID, or too many gaps and verify no delivery draft/content/DecisionRecord/memory update/Compare analysis is written.

Delivery output mock acceptance for M8:

- open a project with at least one active delivery preparation package and click the top `输出` button;
- verify the floating panel lists active delivery packages without opening a new page or changing canvas semantics;
- select a package and confirm the preflight summary shows sections, stable references, embedded local assets, link/no-binary items, missing or mismatched assets, open gaps, and pending drafts;
- click `导出交付输出包`, download the zip, and inspect that Markdown files are readable, `source-map.json` maps delivery references to stable snapshots, and embedded files keep usable extensions under `assets/`;
- verify unrelated workspace assets, hidden or eliminated objects not referenced by the delivery package, raw workspace JSON, archive manifests, backup bundles, Blob URLs, and runtime `storageKey` values are absent;
- simulate a missing local Blob and verify export still finishes with warnings, no empty asset file is created, and `README.md` plus `asset-index.md` report the missing binary;
- verify a delivery package with no sections is blocked, while a text-only package with sections but no stable references exports with a clear warning;
- verify archive export, editable backup export, and restore still use the top `归档` panel and are not changed into delivery output.

## Current Local Persistence

Project catalog:

```text
morpho.projects.catalog.v1
```

Per-project workspace:

```text
morpho.project.${projectId}.workspace.v1
```

Legacy single-project key read for a one-time pristine-Nightrail migration:

```text
morpho.workspace.nightrail.v1
```

Current structured workspace data is schema version `17`. v1 through v16 reads are pure and
idempotent. Schema 17 strips old `conversationCheckpoints`, message lane/checkpoint metadata, and
`imageVariant`; a valid old checkpoint range becomes one deterministic project-wide summary only
when no valid current summary exists. Current schema 17 loading never interprets retired fields.
Editable backup restore follows inspect -> restore as a new copy -> migrate, while `chat: none`
clears messages, compaction, summary revisions, provider frames, and Compare analyses.

The following paragraph is historical schema detail retained for migration traceability:

Structured workspace data is schema version `16`. v1 through v15 workspace data is migrated through pure migration functions. v6 normalizes image roles to `reference`, `preview`, `conceptImage`, `primaryVisual`, `sceneVisual`, `cmfStudy`, `detailStudy`, `structureDiagram`, `interactionDiagram`, and `deliveryAsset`; old `main`, `scenario`, `cmf`, `detail`, and `diagram` values are migration-only inputs. v7 adds parse metadata to file objects and stores extracted document text as separate IndexedDB assets. v8 adds `workspace.projectContinuity`, migrates legacy `project.currentFocus` into structured `currentFocus`, and retires legacy `stageRecords` instead of converting them into a second stage-history source. v9 adds controlled conversation semantic record fields and message source refs; old v8 entries become `origin: deterministicEvent` and `manualState: active` without fabricated semantic metadata. v10 adds `workspace.ai.conversationCheckpoints`; old v9 messages are preserved, no checkpoint is invented, no old message receives a fabricated `conversationLaneKey`, and `projectContinuity` is unchanged. v11 adds `workspace.ai.comparisonAnalyses` plus assistant-message linkage for local Compare cards; old messages are preserved without fabricated comparison links. v12 adds `documentFragment` support and fragment source relations without fabricating historical fragments or changing existing files/messages/checkpoints/Compare analyses/DecisionRecords/project-continuity records. v13 upgrades delivery preparation with sections, stable section references, gaps, and pending delivery section drafts. v14 adds optional ordered assistant `agentTrace` records and preserves all prior message bodies, citations, checkpoints, Compare analyses, and project-continuity state without fabricating trace parts. v15 adds project-wide conversation compaction, revisioned summaries, seven revisioned Project Memory documents, six possible revisioned Stage Records, and structured image-generation provenance. v16 adds the stored `KeyConclusionCategory` union (`finding`, `opportunity`, `constraint`, `openQuestion`, `unknown`) plus the new-write-only `AssignableKeyConclusionCategory` subset of the first four values. Legacy or damaged stored values may normalize to `unknown`; new manual, research, Compare, and Agent-confirmed writes cannot use it, and an unclassified confirmation remains at `请选择类别` until the user selects one of the four assignable values. Recovered `unknown` conclusions remain `待分类` and can be manually reclassified from object details. Legacy key conclusions migrate from exact source research matches, then the compatibility-only old-note markers, otherwise `unknown`; current runtime never infers the category from free text. Migration success writes the new project workspace and catalog. Migration failure preserves old raw data and shows a recoverable warning instead of silently resetting to seed data.

Binary assets are stored in IndexedDB:

```text
database: morpho-assets-v1
store: asset-blobs
```

Workspace JSON stores only asset metadata and `assetId` references, not base64 file contents.

M9-A local persistence behavior:

- workspace saves are debounced for 400 ms with a 1200 ms max wait;
- pending saves flush synchronously on pagehide, visibility-hidden, beforeunload, project switch, and workspace unmount;
- workspace and catalog write failures are surfaced separately instead of reporting a false saved state;
- local save failures show a small inline warning near the project title and do not block editing;
- image preview object URLs are cached by `assetId + storageKey`, and only added or changed image assets are read from IndexedDB.

Supabase provides account identity, access qualification, and AI quota only. This runtime still does not implement project cloud sync, cloud file storage, automatic Blob garbage collection, or cross-device backup. Use the editable backup export/restore flow for browser-to-browser transfer.

Local document extraction:

- supported: Markdown, plain text, text-layer PDF, and PPTX slide text;
- unsupported or expected to fail clearly: scanned PDFs without text layers, legacy `.ppt`, DOC/DOCX, OCR, embedded image extraction, layout reconstruction, and table fidelity;
- parsed text is capped before being stored as a `documentExtract` asset, and each AI request applies additional per-file and total context caps.
- M5-D1 document reading opens the saved `documentExtract` Blob as local parsed text in a temporary workspace panel. It does not preview original PDF/PPTX/Office layout, run OCR, fabricate page/slide location, or write the extract into workspace JSON.
- M5-D2 document fragments are explicitly extracted from consecutive reader blocks. Each fragment stores bounded body text plus file/extract/offset/block provenance and can return only to the real extract range when the source file and extract asset still match.

## Current Routes

```text
/                         project homepage
/login                    Supabase email/password login and registration
/projects/[projectId]     project workspace
/api/ai/agent/turns       formal Server Turn creation
/api/ai/agent/turns/[turnId]  Server External Execution Status query
/api/ai/agent/turns/[turnId]/requests  exact idempotent Provider Request stream
/api/ai/agent/turns/[turnId]/requests/cancel  explicit exact-Request external cancellation attempt
/api/ai/agent/turns/[turnId]/actions/web-search  claim-bound idempotent A+ Search action
/api/ai/agent/turns/[turnId]/actions/image  claim-bound idempotent A+ Image action
/api/ai/agent/turns/[turnId]/actions/compaction  idempotent A+ Summary Provider action
/api/ai/chat              independent bounded text route; no formal-panel caller
/api/ai/image             GrsAI image generation proxy
```

## Not Implemented

The current code does not include:

- cloud project synchronization or cloud file storage;
- multiplayer sync;
- automatic web crawling;
- OCR, legacy `.ppt`, DOC/DOCX parsing, and faithful document-layout reconstruction;
- dynamic provider model-list fetching;
- PPT/PDF/Figma generation or final delivery layout;
- transcript replacement, transcript deletion, or user-managed chat-summary files;
- deployment automation beyond the existing Vercel deployment and checked-in Cloudflare/OpenNext backup scripts;
- project search over full `documentExtract` text. Project search reads workspace JSON only; whole-document PDF/PPTX text stays in IndexedDB and is searchable only in the per-file document reader.

## Agent Runtime A+ Migration Verification

The current remote state is:

- `20260729012105_add_agent_turn_journal.sql`: applied and database-verified;
- `20260729093000_add_agent_turn_external_actions.sql`: applied and database-verified;
- `20260729190000_remove_agent_runtime_b_proofs.sql`: not applied;
- Phase A and Phase B: complete;
- healthy observation window: active;
- Phase C: not authorized and not executed.

The three files below remain the fixed forward-only release order. The Phase A and Phase B
subsections are historical audit procedures for the completed gates, not pending operations. Do not
rerun Phase A or issue a remote database write from this section. The only currently executable
follow-up is the separately recorded read-only observation audit after `2026-08-06 10:28:24
Asia/Shanghai`; it does not authorize Phase C.

```text
supabase/migrations/20260729012105_add_agent_turn_journal.sql
supabase/migrations/20260729093000_add_agent_turn_external_actions.sql
supabase/migrations/20260729190000_remove_agent_runtime_b_proofs.sql
```

Historical Phase A pre-write state: Stage 4 had not applied these files remotely. Supabase CLI
`db push` applies every pending local Migration and has no supported "stop at this version" option.
Therefore the completed Phase A used the exact independently accepted Stage 3 commit, which
contained the two additive A+ Migrations but not the cleanup. This was a release checkout, not a
manual SQL copy and not a modified migration ledger. The command shape below matches the official
[Supabase CLI `db push` interface](https://supabase.com/docs/reference/cli/supabase-db-push)
for `--linked` and `--dry-run`; it is retained as a historical record only.

### Phase A — additive A+ database contract only

**Historical execution record — complete; do not rerun.** Phase A applied and verified both additive
Migrations. The PowerShell and SQL commands in this subsection document the exact release gate used
at that time; they are not current instructions to create another worktree, run `supabase db push`,
or write to the remote database.

From a clean repository checkout in PowerShell 7:

```powershell
$ErrorActionPreference = 'Stop'
$stage3Release = '4c52cc5cfa7db5fcdcbf1765acfd8795c6e1f1dc'
$repo = (Resolve-Path .).Path
$phaseA = Join-Path (Split-Path $repo -Parent) 'Morpho-db-phase-a'
$projectRef = '<independently-verified-project-ref>'

if (Test-Path -LiteralPath $phaseA) { throw "Phase A worktree already exists: $phaseA" }
git cat-file -e "$stage3Release^{commit}"
git worktree add --detach $phaseA $stage3Release
Set-Location $phaseA
if (git status --short) { throw 'Phase A checkout is not clean.' }

$additive = @(
  'supabase/migrations/20260729012105_add_agent_turn_journal.sql',
  'supabase/migrations/20260729093000_add_agent_turn_external_actions.sql'
)
$additive | ForEach-Object { if (-not (Test-Path -LiteralPath $_)) { throw "Missing $_" } }
if (Test-Path -LiteralPath 'supabase/migrations/20260729190000_remove_agent_runtime_b_proofs.sql') {
  throw 'Cleanup Migration must not exist in the Phase A release checkout.'
}

supabase --version
supabase projects list
supabase link --project-ref $projectRef
if ((Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim() -ne $projectRef) {
  throw 'Linked Supabase project does not match the independently verified ref.'
}
supabase migration list --linked
supabase db push --dry-run --linked
```

The historical dry-run result was exactly
`20260729012105_add_agent_turn_journal.sql` followed by
`20260729093000_add_agent_turn_external_actions.sql`. If it lists an older B Migration, the cleanup
Migration, any unrelated file, or nothing when the A+ tables are not independently known to exist,
the historical release was stopped and investigated. The historical execution then used:

```powershell
supabase db push --linked
supabase migration list --linked
```

The historical post-apply verification confirmed both additive versions and the Stage 2/3 SQL checks.
All A+ Journal tables had RLS and no direct `public`, `anon`, or `authenticated` table grants; A+ RPCs
remained `SECURITY DEFINER`, used fixed empty `search_path`, derived identity from `auth.uid()`, and
granted execution only to `authenticated`. At the time Phase A was executed, the B Lease table/RPCs
were intentionally retained and the then-current production application passed its no-cost smoke
checks. That is historical Phase A context; the current production application is A+.

The historical execution then returned to the original checkout before removing the disposable
release worktree:

```powershell
Set-Location $repo
git worktree remove $phaseA
```

### Phase B — sole A+ application deployment and no-cost health checks

**Status (2026-08-04): complete.** The audited Stage 4 application was deployed as the sole A+
Vercel Production Runtime after Phase A. The authenticated no-cost Turn create/query and missing-
Provider fail-closed acceptance passed without paid Provider, Search, or Image calls. The current
branch and release state are recorded in [`agent-runtime-a-plus-migration.md`](../architecture/agent-runtime-a-plus-migration.md).

The procedure below is retained as the Phase B audit record. It describes how the gate was executed;
it is not a request to add credentials or rerun paid traffic. The first deployment step used an
authenticated preview or staging deployment with **every accepted text Provider credential absent**:

- `MORPHO_AI_API_KEY` must not exist in that Preview/Staging scope;
- the compatible `AIJWS_API_KEY` alias must not exist either;
- every image Provider credential must also be absent (currently `MORPHO_GRS_API_KEY`).

Do not remove only `MORPHO_AI_API_KEY`: `AIJWS_API_KEY` is still an accepted credential and would
allow a real Provider call. Before deploying or sending the health request, inspect the Vercel
Environment Variables list for the exact Preview/Staging scope and confirm that neither text Key name
and no image Provider Key name is present. Check names and scope only; do not print, read, copy, or
echo any credential value into a terminal, script, log, screenshot, or audit note.

In the same-origin browser DevTools console, with a real authenticated session, create and query a
Turn without invoking a Provider:

```javascript
const localProjectId = `health-${crypto.randomUUID()}`;
const creationIdempotencyKey = `health-${crypto.randomUUID()}`;
const created = await fetch('/api/ai/agent/turns', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ localProjectId, creationIdempotencyKey })
}).then(async (response) => ({ status: response.status, body: await response.json() }));
if (created.status !== 200 || created.body.status !== 'created') throw created;

const queried = await fetch(
  `/api/ai/agent/turns/${created.body.serverTurnId}?localProjectId=${encodeURIComponent(localProjectId)}`,
  { credentials: 'include' }
).then(async (response) => ({ status: response.status, body: await response.json() }));
if (queried.status !== 200 || queried.body.status !== 'created') throw queried;
```

Then POST one syntactically valid A+ Provider Request to that Turn. With all accepted text and image
Provider credentials intentionally absent it must return `503` with `code = provider_unavailable`;
the Journal must remain `created`, all external counters must remain zero, and deployment logs must
show no Provider, Search, or Image call. Do not add a key merely to make this health check pass.

```javascript
const requestId = `health-request-${crypto.randomUUID()}`;
const unavailableResponse = await fetch(
  `/api/ai/agent/turns/${created.body.serverTurnId}/requests`,
  {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      localProjectId,
      requestId,
      stepSequence: 1,
      providerRequest: {
        input: [{
          role: 'user',
          content: [{ type: 'input_text', text: 'No-cost deployment health check.' }]
        }],
        promptContractVersion: 'morpho-agent-v3.3-2026-07-24',
        mode: 'auto',
        capabilityIntent: { comparisonAnalysis: false }
      }
    })
  }
);
const unavailableContentType = unavailableResponse.headers.get('content-type') ?? '';
const unavailable = {
  status: unavailableResponse.status,
  contentType: unavailableContentType,
  body: unavailableContentType.includes('application/json')
    ? await unavailableResponse.json()
    : { error: 'Unexpected non-JSON response. Stop and inspect deployment credentials/logs.' }
};
if (unavailable.status !== 503 || unavailable.body.code !== 'provider_unavailable') {
  throw unavailable;
}

const afterFailClosed = await fetch(
  `/api/ai/agent/turns/${created.body.serverTurnId}?localProjectId=${encodeURIComponent(localProjectId)}`,
  { credentials: 'include' }
).then((response) => response.json());
if (
  afterFailClosed.status !== 'created' ||
  afterFailClosed.counters.provider !== 0 ||
  afterFailClosed.counters.webSearch !== 0 ||
  afterFailClosed.counters.image !== 0
) throw afterFailClosed;
```

Also verify:

- the formal workspace has no Runtime selector and uses only `/api/ai/agent/turns/**`;
- retired B HTTP resources return `404` and application logs contain no calls to B Lease/Closure RPCs;
- create/query logs contain no `journal_contract_missing`, missing-table, missing-function, RLS, or
  grant errors;
- the normal authenticated application can open, persist, and reload a browser-local project without
  server-side project registration.

These checks passed for Phase B. Normal production credentials and real usage remain outside the
no-cost cutover gate; a paid Provider smoke is a distinct explicit authorization and is not required
for this database release. The system is now in the healthy observation window, and Phase C remains
deferred until the separately scheduled read-only audit and a new explicit authorization.

### Phase C — irreversible B database cleanup

**Status (2026-08-04): not authorized and not executed.** Phase C is a separate authorization after
the sole A+ deployment has remained healthy for the agreed validation window. The earliest read-only
observation audit is `2026-08-06 10:28:24 Asia/Shanghai`; reaching that time does not authorize the
cleanup. If later authorized, use the clean audited Stage 4 release checkout, not the Stage 3 Phase A
worktree:

```powershell
$ErrorActionPreference = 'Stop'
$projectRef = '<independently-verified-project-ref>'
if (git status --short) { throw 'Stage 4 release checkout is not clean.' }
git rev-parse HEAD
supabase --version
supabase projects list
supabase link --project-ref $projectRef
if ((Get-Content -LiteralPath 'supabase/.temp/project-ref' -Raw).Trim() -ne $projectRef) {
  throw 'Linked Supabase project does not match the independently verified ref.'
}
supabase migration list --linked
supabase db push --dry-run --linked
```

Expected dry-run result: exactly
`20260729190000_remove_agent_runtime_b_proofs.sql`. If either additive Migration is still pending,
anything unrelated appears, or the release SHA is not the audited SHA recorded for this deployment,
stop. After a separate Phase C authorization:

```powershell
supabase db push --linked
supabase migration list --linked
```

Re-run the A+ table/RLS/RPC/grant checks and the authenticated create/query health check. The retired
`private.ai_agent_turn_leases` table and B Lease/Closure RPC names must now be absent while all A+
Journal objects remain. This cleanup is the irreversible database rollback boundary: after Phase C,
rollback means deploying a new forward Migration and an explicitly audited application strategy;
do not restore B by deleting migration history, editing an applied file, or pasting old SQL manually.

## Agent Runtime Validation

Run from PowerShell 7 without paid Provider flags:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

The architecture-boundary tests additionally require one canonical Runner import, no Runtime
selector or old environment flag, no B Agent/Lease/Snapshot/web-search Routes, no B proof modules,
and the forward-only Workspace normalization boundary. Do not add `--live` to any Provider smoke
test unless `MORPHO_ALLOW_PAID_SMOKE_TESTS=true` and the user has explicitly authorized paid calls.

# Browser acceptance

The acceptance suite runs a production server on port 3100 so it never collides
with a developer's `npm run dev` — Next refuses a second dev server in the same
directory — and it never inherits that server's Supabase session. Build first:

```powershell
npm run build
npm run test:e2e
```

`npm run test:e2e:build` does both. First-time setup needs the browser binary:

```powershell
npx playwright install chromium
```

The suite starts its own server with `MORPHO_AUTH_REQUIRED=false` and empty
provider keys. No test may reach a paid model or image endpoint: the A+ resources under
`/api/ai/agent/turns/**` are intercepted in the page and answered by an in-browser Turn/Request/
External Action Journal mock. Provider Request SSE frames use the production A+ encoder through
`e2e/support/agentSse.ts`. The seed workspace is regenerated from the
real domain code on every run by `e2e/globalSetup.ts` into `e2e/.seed/seed.json`,
because Playwright's loader cannot resolve the case-study fixture's JSON imports.

The browser acceptance suite previously recorded two defects with `test.fail`.
Both were fixed on July 27, 2026 and now run as ordinary Playwright regression
tests:

- persisted canvas selection is reapplied after a reload when
  `ui.lastSelectionIds` is stored correctly;
- the restore preview remains reachable in a 1440x900 window because the
  `.archive-panel` content area scrolls within the viewport.

# Local storage capacity

```powershell
npm run measure:storage
```

Measures what real Morpho content costs in localStorage and writes
`docs/operations/storage-footprint.generated.json`. Growth scenarios replicate
records taken from the deployable case study rather than synthetic payloads. The
matching browser-side measurement — the quota the browser actually grants — is in
`e2e/storage-capacity.spec.ts` and prints to the acceptance run log.

# Performance baseline

Two halves. Run both on an idle machine: the Node half marks the whole run
untrusted if the process was preempted, and the browser half shares the CPU with
nothing else by design.

```powershell
npm run measure:perf
```

```powershell
npm run measure:perf:browser
```

The browser half needs a production build first (`npm run build`) and Chromium
(`npx playwright install chromium`). It runs as its own Playwright project and is
excluded from `npm run test:e2e`, so it never runs in CI — a perf number from a
shared runner would look official while meaning nothing.

Outputs `docs/operations/performance-node.generated.json` and
`docs/operations/performance-browser.generated.json`. The prose baseline that
phase 4C is required to cite is `docs/architecture/performance-baseline.md`.

To isolate one target — useful because an allocation-heavy target can otherwise
push its garbage collection into a neighbour's measurement:

```powershell
npm run measure:perf -- --target=renderConversation
```

A measurement that fails the trust gate is reported as untrusted and must not be
cited as evidence for any optimization. Do not tune the harness until the number
looks acceptable; record it as untrusted and say why.
