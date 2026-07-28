# Morpho Agent Runtime A+ Migration

This document is the durable implementation ledger for converging the Morpho Agent Runtime on the A+ trust boundary. It records migration scope and audit gates; it is not authorization to implement a later stage early.

## 1. Status

| Field | Value |
|---|---|
| Decision date | 2026-07-28 |
| Current state | Stage 1 — lifecycle model revised, not wired, awaiting independent re-audit |
| Current formal working branch | `refactor/agent-runtime-a-plus` |
| B implementation archive branch | `archive/agent-runtime-b` |
| B implementation archive tag | `agent-runtime-b-final-2026-07-28-f27a410` |
| Baseline full SHA | `f27a4102e94730ec56a476b349dda4710a67b514` |
| Baseline short SHA | `f27a410` |
| Stage 0 complete | Yes — the decision, archive references, migration ledger, and historical-audit status are recorded in the Stage 0 documentation commit |
| Stage 1 complete | Implementation complete — independent re-audit pending; Stage 2 is not yet allowed |
| Implementation runtime | Existing B-style runtime remains active |
| Later stages | Stage 2, Stage 3, and Stage 4 not started |
| Next allowed stage | Stage 2 only after independent audit |

The formal decision is recorded in [Technical Decisions](./decisions.md). The earlier [AI Continuity Convergence Audit](./ai-continuity-convergence-audit.md) remains historical evidence.

## 2. Problem Statement

Morpho must preserve the product goals already served by the Runtime: one Agent entry point, Provider streaming, continuous project conversation, tools, project memory, context management, compaction, cancellation, and recovery. This migration is not a declaration that all Agent code is poor and is not a request to discard those capabilities.

The structural debt is concentrated in the Turn protocol and its trust boundary. One Turn is currently represented across client runtime state, persisted Workspace state, SSE events, signed Token Claims, route-local state, and Supabase Lease state. Transcript Snapshots, Manifests, causal Continuation Claims, Context Marker bindings, Compaction Receipts, Closure Tokens, Function Call Finalizers, and specialized recovery paths attempt to prove the integrity of browser-owned data after local tools execute in that same browser.

That proof goal is disproportionate for Morpho's current local-first product. The convergence target is a smaller, explicit protocol around one Turn Lifecycle, not a rewrite of every Agent capability.

## 3. Final A+ Trust Boundary

### Server-authoritative scope

The server remains authoritative for:

- authenticated identity;
- binding each Server Turn to the authenticated user and that Turn's client-supplied local `projectId`;
- prevention of Server Turn reuse by another user or under another client-supplied local `projectId`;
- Provider, Search, and Image credentials;
- Provider, Search, and Image quotas and call counters;
- request idempotency and duplicate-execution or duplicate-charge protection;
- valid `turnId`, `requestId`, `requestHash`, and `stepSequence` values;
- Server External Execution Status for Provider, Search, Image, and other server-side external work;
- a server-owned Prompt Contract and Tool Registry;
- bounded external execution;
- server validation of confirmation before externally costly or server-side high-impact operations.

The target server state is a minimal Server Turn Journal. The binding above does not prove ownership of a browser-local project. This migration does not add a server-side project registry, a project ownership table, a binding between local Workspaces and `auth.users`, or cloud Workspace persistence. SSE can report progress, but reconnect and recovery query the journal for authoritative Server External Execution Status.

### Client local-first scope

The client owns and correctly persists:

- Workspace content and local objects;
- local chat bodies and raw chat history;
- local Tool Results and locally executed effects;
- Project Memory and Stage Records;
- Context Frames and Summary Revisions;
- local confirmation state governed by the Tool Effect Matrix and product rules;
- the Overall Local Agent Turn Outcome;
- project continuity and other local project state.

Normal Morpho UI use must still save these records accurately, restore them correctly, and follow product rules. A+ changes the security-proof boundary; it does not relax product correctness or recovery expectations.

### Split status authority

The Server Turn Journal is authoritative only for Server External Execution Status. Its conceptual status domain is:

```ts
type ServerExecutionStatus =
  | "created"
  | "providerRunning"
  | "awaitingNextRequest"
  | "externallyCompleted"
  | "externallyCancelled"
  | "externallyFailed";
```

These names define the architecture boundary, not an implemented Stage 0 schema. Stage 2 may refine storage details without expanding server authority beyond external execution.

The Stage 1 client reducer is the sole authority for the Overall Local Agent Turn Outcome. It combines:

- Server External Execution Status;
- local Tool Batch Outcome;
- local Pending Confirmation or other confirmation state;
- local Workspace persistence and effect results.

The user-visible outcome includes semantic states such as `completed`, `partiallyCompleted`, `pendingConfirmation`, `cancelled`, and `failed`; exact event and type names are a Stage 1 deliverable. The Server Turn Journal must not claim authority over local Tool Results, local Workspace effects, Pending Confirmation, or the overall user-visible Agent Turn outcome. Server status and local outcome require an explicit mapping; neither may overwrite or masquerade as the other.

Confirmation also has two distinct authorities:

- local project high-impact operations are confirmed and enforced by the client Tool Effect Matrix and product rules;
- externally costly or server-side high-impact operations require confirmation that the server validates before execution.

### Audit classification rule

Later audits must use this boundary and must not classify the mere ability to edit one's own local project, chat, or Tool Result as a P0. A client-side modification becomes a required security fix when it can:

- access another user's data or reuse a Server Turn across authenticated users or client-supplied local `projectId` values;
- bypass authentication;
- expose a server credential;
- bypass quota or cause duplicate charging;
- repeat an external call;
- execute an unauthorized high-impact server action; or
- elevate untrusted user text into server-owned System or Tool authority.

Local corruption, data loss, or incorrect recovery during normal UI use remains a product-correctness defect even when it is not a server security defect.

## 4. Preserved Product Capabilities

The migration must preserve:

- one unified Agent entry point;
- streamed reasoning, commentary, activity, and final output;
- continuous multi-turn project context;
- Provider Context Frames;
- Project Memory;
- Stage Records;
- Task Strategy;
- Tool Calling;
- local tool execution;
- user confirmation;
- Web Search;
- Image Generation;
- Context Policy;
- Summary Revision;
- automatic, pre-continuation, and manual compaction;
- cancellation and failure handling;
- recovery after page refresh or network interruption;
- Trace and diagnostic visibility.

These are product capabilities, not B-style proof mechanisms, and none is scheduled for deletion by this decision.

## 5. Security Guarantees Retained

- Auth remains server-verified.
- API keys remain server-only.
- Every Server Turn remains bound to its authenticated user and the Turn's client-supplied local `projectId`; this is not proof of project ownership.
- Quota remains server-enforced.
- Provider, Search, and Image call counters remain authoritative.
- Idempotency remains enforced for external work and Server External Execution Status transitions.
- `requestHash` remains server-validated.
- `stepSequence` remains monotonic and server-validated.
- The Tool Registry and Prompt Contract remain server-owned.
- Local high-impact Workspace actions retain client-side Tool Effect Matrix and product confirmation enforcement.
- Externally costly and server-side high-impact actions retain server-validated confirmation.
- Execution remains bounded by call, duration, and provider limits.
- Server External Execution Status remains queryable and authoritative after SSE interruption.
- The client reducer remains the sole authority for Overall Local Agent Turn Outcome.
- Untrusted client content remains user data and cannot become server System or Tool authority.

## 6. Guarantees Explicitly Dropped

A+ no longer pursues:

- immutability proof for the complete client Transcript;
- server-proved causal authenticity for local Tool Results;
- tamper-proofing of the local Workspace;
- a complete Context Marker hash chain;
- a Closure Proof for client-local results;
- Snapshot, Manifest, or Receipt chains whose only purpose is proving local-history authenticity.

This section defines the destination boundary. Stage 0 does not delete or alter any implementation.

## 7. Module Classification

`Yes` identifies the target disposition of the responsibility, not permission to change it in Stage 0. `Split` means the named module mixes retained logic with logic that must be adapted or removed later; it must not be deleted wholesale.

| Module or responsibility | Keep | Adapt | Remove later | Reason |
|---|---:|---:|---:|---|
| Tool Registry — `src/features/workspace/morphoAgent.ts` | Yes | Split | No | Preserve fixed tool names and schemas; detach old continuation and proof expressions. |
| Tool Effect Matrix — `morphoAgent.ts` | Yes | No | No | Tool effects remain necessary for authorization, confirmation, and outcome semantics. |
| Tool Executors — `agentToolExecutors.ts` | Yes | No | No | Local execution is a core local-first capability. |
| Task Strategy — `agentTaskStrategy.ts` and `src/shared/agentStrategyItem.ts` | Yes | Split | No | Preserve strategy resolution; decouple any transcript-marker proof role. |
| Prompt Registry — `agentPromptRegistry.ts` | Yes | No | No | Prompt policy and contract versioning remain product architecture. |
| Server-owned Prompt Contract — `src/server/ai/agentProviderContract.ts` | Yes | Split | No | Preserve server authority over System items and tools; remove embedded Manifest/Receipt proof work later. |
| Context Policy — `src/domain/morpho/agentContextPolicy.ts` and `src/server/ai/agentContextBudget.ts` | Yes | No | No | Token/item limits and context selection remain required. |
| Context assembly pure functions — `taskContext.ts`, `providerContextFrames.ts`, `providerContextFrame.ts` | Yes | Split | No | Preserve deterministic assembly; detach request-boundary Snapshot/Manifest state. |
| Project Memory — `src/domain/morpho/projectMemory.ts` | Yes | No | No | Local current projections and revisions remain formal product state. |
| Stage Records — `projectMemory.ts` | Yes | No | No | Stage projections and their histories remain formal product state. |
| Summary Revision — `conversationCompaction.ts` and `conversationSummaryAgentRequest.ts` | Yes | Split | No | Preserve summary planning, validation, persistence, and revision history; remove proof-only wrapping later. |
| Provider adapter — `src/server/ai/openaiCompatibleProvider.ts` | Yes | No | No | Provider execution and bounded retry remain server responsibilities. |
| Provider SSE parsing — `openaiCompatibleResponsesStream.ts` | Yes | No | No | Reasoning, commentary, text, and tool parsing remain needed. |
| Client SSE framing and process parsing — `agentStreamProtocol.ts` and `agentStreamClient.ts` | Yes | Yes | No | Keep display framing and parsing; change proof-heavy events and terminal authority. |
| Trace — `agentMessageTrace.ts` and `agentProcessUi.ts` | Yes | No | No | Diagnostics and process visibility are preserved behavior. |
| Auth, quota, and external-call counters — `src/server/auth/aiAccess.ts` and `agentTurnLease.ts` | Yes | Yes | No | Retain security and cost controls while reducing Lease state to the A+ journal core. |
| Host Fake and behavior tests — `agentTurnHostFake.ts`, `agentTurnRunner.test.ts`, `e2e/agent-turn.spec.ts` | Yes | Yes | No | Preserve test seams and behavior evidence; replace assertions coupled only to B proofs. |
| Agent Turn Runner — `agentTurnRunner.ts` | No | Yes | No | Converge orchestration on one explicit Turn Lifecycle and event flow. |
| AgentTurnState — `agentTurnState.ts` | No | Yes | No | Separate Overall Local Agent Turn Outcome, Server External Execution Status, and proof-only fields. |
| Agent Turn Host — `agentTurnHost.ts` | Yes | Yes | No | Preserve the host abstraction while adapting abort, stream, and Coordinator boundaries. |
| Lease — `agentTurnLeaseClient.ts`, `src/server/auth/agentTurnLease.ts`, `app/api/ai/agent/lease/**` | No | Yes | Split | Keep per-Turn authenticated-user/local-`projectId` binding, counters, idempotency, sequence, and Server External Execution Status; remove Closure overlays later. |
| Request Sequence — `agentTurnState.ts`, `agentTurnProviderRequest.ts`, `agentTurnLease.ts` | No | Yes | No | Give one meaning to request and step sequencing across client and server. |
| Outcome Resolver — `agentTurnMessages.ts` | No | Yes | No | Make the lifecycle reducer the sole authority for Overall Local Agent Turn Outcome instead of assembling it from end-of-loop Booleans. |
| Abort — `agentTurnRunner.ts`, `agentStreamClient.ts`, Agent route | No | Yes | No | Decouple stopping SSE consumption from authoritative Server External Execution Status. |
| Recovery — Turn Runner, Lease client, `lease/state/route.ts` | No | Yes | Split | Query and resume one Turn lifecycle instead of recovering only Closure candidates. |
| Compaction lifecycle — Turn Runner, Provider Request, `manualCompactionTurn.ts` | No | Yes | Split | Unify automatic, pre-continuation, and manual terminal semantics while preserving Summary Revisions. |
| SSE protocol — `src/shared/agentStreamProtocol.ts` and Agent route | Yes | Yes | Split | Keep streaming display; remove Snapshot/Lease/Closure authority from events. |
| Tool Batch finalization — `morphoAgent.ts`, `agentToolExecutors.ts`, Turn Runner | No | Yes | Split | All batch outcomes need one lifecycle path, not a Pending Confirmation special case. |
| Agent Route orchestration — `src/app/api/ai/agent/route.ts` | Yes | Yes | Split | Keep Auth, external Provider execution, and streaming; separate journal and remove proof-chain orchestration. |
| Transcript Snapshot strong proof | No | No | Yes | A+ does not authenticate the user's local history; mixed code must be split first. |
| Snapshot Refresh — `app/api/ai/agent/snapshot/refresh/route.ts` | No | No | Yes | This route exists to renew the B transcript-authenticity proof. |
| Complete Transcript Manifest validation | No | No | Yes | Ordered local-history authenticity is outside the A+ server boundary. |
| Tool Result Causal Binding — `agentContinuationToken.ts` | No | No | Yes | Local Tool Results no longer require server cryptographic authenticity. |
| Context Marker strong causal proof — `agentCompactionProtocol.ts` and `agentContinuationToken.ts` | No | No | Yes | Context Frames remain local product data without a server hash chain. |
| Closure Token and Closure Proof Chain — token, Lease client/route, Closure SQL | No | No | Yes | Minimal idempotent Server External Execution Status replaces client-history Closure proof without deciding the Overall Local Agent Turn Outcome. |
| Function Call special Finalizer — `lease/finalize-function-calls/route.ts` | No | No | Yes | Unified Tool Batch Outcome replaces the Pending Confirmation-only protocol. |
| Finalizer-specific recovery — `AgentTurnClosureRecovery` and exact Closure candidate replay | No | No | Yes | Recovery becomes general Turn status/retry handling. |
| B-only Compaction Receipt proof — `agentCompactionProtocol.ts`, token, `lease/summary/route.ts` | No | No | Yes | Compaction correctness remains, but local-history authenticity proof does not. |
| Legacy Claims and version branches — `agentContinuationToken.ts` and `agentTurnProviderRequest.ts` | No | No | Yes | Compatibility branches used only by the retired proof chain leave in Stage 4. |

Several files are deliberately mixed and must not be deleted wholesale. In particular, `morphoAgent.ts`, `agentProviderContract.ts`, `providerContextFrames.ts`, `agentTurnProviderRequest.ts`, `agentCompactionProtocol.ts`, `agentStreamProtocol.ts`, `agentTurnLease.ts`, and the main Agent route contain both retained product/security logic and B-only proof logic. Later stages split or adapt them before Stage 4 deletion.

## 8. Current Runtime Behavior Baseline

The table records expected product behavior to preserve during migration. `Not re-verified in Stage 0` is intentional: Stage 0 performs no runtime or paid/browser acceptance.

| # | Scenario | Expected | Currently verified | Known gap | Stage to verify |
|---:|---|---|---|---|---|
| 1 | Plain-text Agent answer | One Turn persists the user message and a correct final assistant answer. | Not re-verified in Stage 0 | No Stage 0 assertion. | Stage 2 and Stage 4 |
| 2 | Streamed reasoning/commentary/activity/final | Ordered visible process parts stream without converting display events into authoritative terminal state. | Not re-verified in Stage 0 | SSE authority is part of scenario 1 in Section 9. | Stage 3 and Stage 4 |
| 3 | Multi-turn project conversation | Later turns receive continuous project-level context under Context Policy. | Not re-verified in Stage 0 | No Stage 0 assertion. | Stage 2 and Stage 4 |
| 4 | Single tool call | One authorized call executes once and produces one terminal result. | Not re-verified in Stage 0 | No Stage 0 assertion. | Stage 1 and Stage 3 |
| 5 | Multiple tool calls | A batch records every call and resolves one aggregate outcome without replaying completed work. | Not re-verified in Stage 0 | Finalization asymmetry is scenario 4 in Section 9. | Stage 1 and Stage 3 |
| 6 | Read tool | A read returns bounded local data without granting write or server authority. | Not re-verified in Stage 0 | No Stage 0 assertion. | Stage 3 |
| 7 | Reversible local write | A successful local write persists and remains undoable under existing product rules. | Not re-verified in Stage 0 | No Stage 0 assertion. | Stage 3 and Stage 4 |
| 8 | High-impact operation requiring confirmation | No high-impact action executes before explicit confirmation. | Not re-verified in Stage 0 | No Stage 0 assertion. | Stage 3 and Stage 4 |
| 9 | Pending Confirmation | The Turn ends explicitly pending; unconfirmed work is not reported as completed. | Not re-verified in Stage 0 | Special Finalizer path is scenario 4 in Section 9. | Stage 1 and Stage 3 |
| 10 | Web Search | Search is server-authorized, counted, bounded, deduplicated, and recoverable without duplicate execution. | Not re-verified in Stage 0 | General recovery convergence is scenario 6 in Section 9. | Stage 2 and Stage 3 |
| 11 | Image Generation | Image calls protect keys and limits, preserve successful assets, and report partial failure accurately. | Not re-verified in Stage 0 | No Stage 0 assertion. | Stage 2, Stage 3, and Stage 4 |
| 12 | Provider failure | The Turn ends failed or partial according to effects already committed; retry starts cleanly. | Not re-verified in Stage 0 | Failure-marker and classification gaps are scenarios 2 and 3 in Section 9. | Stage 1 and Stage 3 |
| 13 | Tool failure | The failed call is visible and the batch outcome reflects unresolved work. | Not re-verified in Stage 0 | Outcome convergence is scenarios 3 and 4 in Section 9. | Stage 1 and Stage 3 |
| 14 | Partial success | Successful effects remain, failed work remains explicit, and the Turn is not labeled full success. | Not re-verified in Stage 0 | Outcome convergence is scenarios 3 and 4 in Section 9. | Stage 1 and Stage 3 |
| 15 | User cancellation | Cancellation stops further work while preserving authoritative Server External Execution Status and completed local effects; the client reducer derives the overall cancelled or partial outcome. | Not re-verified in Stage 0 | Cancellation/SSE gap is scenario 1 in Section 9. | Stage 2 and Stage 3 |
| 16 | Network interruption | Reconnect queries Server External Execution Status and never replays chargeable external work accidentally; the client reducer retains overall-outcome authority. | Not re-verified in Stage 0 | Recovery convergence is scenario 6 in Section 9. | Stage 2 and Stage 3 |
| 17 | Page refresh | Persisted local state and Server External Execution Status provide separate inputs to reconstruct one Overall Local Agent Turn Outcome. | Not re-verified in Stage 0 | Recovery convergence is scenarios 6 and 7 in Section 9. | Stage 2 and Stage 3 |
| 18 | Automatic compaction | Compaction advances one valid Summary Revision boundary or leaves the previous boundary unchanged. | Not re-verified in Stage 0 | Protocol divergence is scenario 5 in Section 9. | Stage 3 |
| 19 | Pre-continuation compaction | Compaction before continuation uses the same lifecycle and terminal semantics as other compaction. | Not re-verified in Stage 0 | Protocol divergence is scenario 5 in Section 9. | Stage 3 |
| 20 | Manual compaction | Manual compaction uses the same outcome and persistence contract without masquerading as a normal Agent answer. | Not re-verified in Stage 0 | Protocol divergence is scenario 5 in Section 9. | Stage 3 |
| 21 | Duplicate request | The same request identity/hash is idempotent; external execution and charging occur at most once. | Not re-verified in Stage 0 | No Stage 0 assertion. | Stage 2 and Stage 4 |
| 22 | Provider/Search/Image limits | Server counters reject over-limit work and remain correct across retry or reconnect. | Not re-verified in Stage 0 | No Stage 0 assertion. | Stage 2 and Stage 4 |
| 23 | Raw chat and Summary Revision persistence | Raw chat remains available while the active context may use a revisioned summary boundary. | Not re-verified in Stage 0 | Compaction convergence is scenario 5 in Section 9. | Stage 3 and Stage 4 |
| 24 | Failure/cancellation display | Failed and cancelled Turns never silently appear successful. | Not re-verified in Stage 0 | Classification gap is scenario 3 in Section 9. | Stage 1 and Stage 3 |
| 25 | Local success followed by Provider failure | Already committed local project results survive and remain visible after a later Provider failure. | Not re-verified in Stage 0 | Classification gap is scenario 3 in Section 9. | Stage 1 and Stage 3 |

## 9. Existing P0/P1 Migration Acceptance Scenarios

These findings are migration acceptance scenarios, not seven independent Stage 0 patches.

| # | Existing symptom | A+ stage expected to resolve it | Later acceptance criterion | Stage 0 |
|---:|---|---|---|---|
| 1 | When the user cancels a Provider stream, stopping SSE consumption can lose observation of the server's actual external-execution state. | Stage 2 establishes the journal; Stage 3 unifies Abort/SSE/recovery. | Cancellation may stop display immediately, but a later query returns authoritative Server External Execution Status; no external work is replayed merely because SSE ended, and the client reducer combines that status with local effects to derive the overall outcome. | Not fixed in Stage 0. |
| 2 | A Provider Failure Marker can behave as one-shot mutable client state and contaminate a later retry. | Stage 1 lifecycle events/reducer; Stage 3 retry and recovery wiring. | Failure belongs to one Turn event history; a retry starts from an explicit new or resumed state and cannot inherit a stale failure marker. | Not fixed in Stage 0. |
| 3 | A Turn can execute a tool and later be classified as `failedBeforeExecution`. | Stage 1 unified outcome model. | Any recorded tool or external effect makes `failedBeforeExecution` impossible; the reducer emits the appropriate partial, failed-during-execution, cancelled, or pending outcome and preserves successful effects. | Not fixed in Stage 0. |
| 4 | Tool Batch terminal handling has a special Finalizer only for `pendingConfirmation`. | Stage 1 defines one Tool Batch Outcome; Stage 3 wires all tool paths to it. | Success, partial success, failure, cancellation, and Pending Confirmation use the same batch-finalization contract with one terminal output per call and no Pending-only protocol. | Not fixed in Stage 0. |
| 5 | Automatic, pre-continuation, and manual compaction use inconsistent terminal protocols. | Stage 3. | All three use one compaction lifecycle, one Summary Revision apply boundary, and consistent success/failure/cancel/recovery semantics. | Not fixed in Stage 0. |
| 6 | Turn completion and recovery are not generally idempotent; specialized Finalizer Recovery carries unique behavior. | Stage 2 minimal journal; Stage 3 unified recovery. | Every Turn terminal transition is idempotent by request identity/hash/sequence, and all recovery queries or retries use the same lifecycle rather than a Finalizer-only path. | Not fixed in Stage 0. |
| 7 | Deterministic, non-retryable Closure or state conflicts can be persisted as recoverable work and permanently block later Turns. | Stage 1 error classification; Stage 2 journal status; Stage 3 recovery policy. | Deterministic conflicts terminate visibly as non-retryable, clear recoverable scheduling, preserve diagnostics, and do not block the next valid Turn forever. | Not fixed in Stage 0. |

## 10. Migration Stages

Every stage receives one independent commit, then stops for independent audit. Work on the next stage begins only after the current audit passes. No stage may carry later-stage implementation “while nearby.”

### Stage 1 — One Turn Lifecycle

Stage 1 is implemented as an independently testable architecture contract in
`src/features/workspace/agentTurnLifecycle.ts`, with its transition matrix in
`src/features/workspace/agentTurnLifecycle.test.ts`. It is intentionally not imported by
`agentTurnRunner.ts` or any other active Runtime path.

The lifecycle phases are `preparing`, `compacting`, `requestingProvider`,
`executingTools`, `awaitingConfirmation`, `continuing`, `cancelling`, `recovering`, and `terminal`.
`compacting` and `recovering` carry a required resume phase. `terminal` carries the
complete Overall Local Agent Turn Outcome and is absorbing.

The implemented event vocabulary is:

- preparation: `PREPARATION_COMPLETED`;
- compaction: `COMPACTION_STARTED`, `COMPACTION_COMPLETED`, `COMPACTION_FAILED`, and
  `COMPACTION_CANCELLED`, with one vocabulary for automatic, pre-Continuation, and manual modes;
- Provider and server observation: `PROVIDER_REQUEST_STARTED`,
  `SERVER_EXECUTION_STATUS_OBSERVED`, `STREAM_ACTIVITY_OBSERVED`, and
  `PROVIDER_OUTPUT_RECEIVED`, plus request-bound `EXTERNAL_ERROR_RECORDED`;
- local tools and confirmation: `TOOL_BATCH_STARTED`, `TOOL_CALL_TERMINATED`,
  and `TOOL_BATCH_FINALIZED`;
- local effects and lifecycle control: `LOCAL_PERSISTENCE_REQUIRED`,
  `LOCAL_PERSISTENCE_SUCCEEDED`, `LOCAL_PERSISTENCE_FAILED`,
  `UNRESOLVED_WORK_RECORDED`, `UNRESOLVED_WORK_RESOLVED`, `ERROR_RECORDED`,
  `CANCELLATION_REQUESTED`, `RECOVERY_STARTED`, `RECOVERY_RESOLVED`, and `TURN_FINALIZED`.

Each local Tool Call has exactly one strict terminal result: `executed`, `failed`,
`cancelled`, or `pendingConfirmation`, keyed by a stable `callId`. Executed results record
local-effect, persistence, and unresolved-work facts. Failed results carry the typed error;
Pending results carry a confirmation ID and are not treated as executed. No B proof field is
part of this contract.

`pendingConfirmation` follows the explicit terminal-Turn policy. It ends the current Turn;
accepting or rejecting that confirmation is not a continuation event inside the terminal Turn.
Any later authorized execution starts as a new explicit action or new Turn. This keeps
`pendingConfirmation` a true immutable Tool Call terminal result and removes the contradictory
same-Turn `CONFIRMATION_RESOLVED accepted` path.

The pure Tool Batch aggregator produces `completed`, `partiallyCompleted`,
`pendingConfirmation`, `cancelled`, or `failed`, together with counts, persistence-failure,
and unresolved-work facts. It validates the declared Call set before aggregation: duplicate
declarations, duplicate result submissions, missing terminal results, and undeclared results
are deterministic conflicts. Within the reducer, an identical repeated Call terminal fact is
idempotent, while a different terminal fact for that Call is rejected.

The reducer alone derives the Overall Local Agent Turn Outcome as `completed`,
`partiallyCompleted`, `pendingConfirmation`, `cancelled`, or `failed`. A successful Provider
or local Tool effect followed by failure, cancellation, Pending Confirmation, persistence
failure, or unresolved work remains `partiallyCompleted`. `pendingConfirmation` requires an
actual unconfirmed Tool Call. Cancellation with no successful effect is `cancelled`; a terminal
fault with no successful effect or Pending work is `failed`. A caller cannot pass an Outcome to
`TURN_FINALIZED`.

`ServerExternalExecutionStatus` retains the Stage 0 domain (`created`, `providerRunning`,
`awaitingNextRequest`, `externallyCompleted`, `externallyCancelled`, and `externallyFailed`).
The reducer accepts it only through `SERVER_EXECUTION_STATUS_OBSERVED`, validates its own
transition order, and combines it with local facts. Each Provider request has a required
`requestId` and strictly increasing `stepSequence`; Provider output, SSE activity, Server status,
and external errors must match the current request identity. Delayed events from an earlier
request in the same Turn are deterministic conflicts. User-visible Provider effects accumulate
across Continuations and cannot be reset by a later textless response. SSE sequence is scoped to
the active request.

Phase and Server-status guards are one combined transition contract: the initial Provider request
starts only from `created`; Continuation starts only from `awaitingNextRequest` at the next step;
Tool Batch starts only from the matching unconsumed Provider output while the server waits for the
next request; Compaction cannot overlap `providerRunning`; and external terminal states cannot
restart that execution sequence or appear while local Tools are executing. An observed server
completion still does not finalize the Turn, and an observed server failure cannot erase a
successful local effect.

Errors are discriminated as `retryable`, `terminal`, `cancelled`, `conflict`, or
`quotaExceeded`. Only `retryable` carries `recoverable: true`; deterministic conflicts and
quota exhaustion cannot enter ordinary recovery. Every event is Turn-bound, so stale facts
from another Turn are rejected, and creating a new Turn starts with no inherited fault. An active
fault has a stable `faultId`. A different fault cannot overwrite it; identical replay is idempotent;
Recovery starts and resolves only the matching retryable fault. `cancelled` cannot enter the generic
fault channel and must use the explicit cancellation event.

Core reducer invariants are: pure and deterministic transitions; no input mutation; one active
phase; strict phase/event legality; complete Tool Call set validation; no contradictory terminal
facts; terminal absorption; no successful effect erased by later failure or cancellation; and
no Server or SSE status masquerading as Overall Local Agent Turn Outcome. The 71 focused Vitest
cases cover the required basic, Provider/display, Tool Batch, Outcome, error/recovery, and three-mode
compaction matrices, including the five Stage 1 audit-revision boundaries.

Stage 1 replaces Boolean-at-end reasoning only at the tested design-contract boundary. The
existing B-style Runtime, old outcome resolver, Closure/Lease paths, and compaction execution
remain active and unchanged. Client Coordinator implementation, Server Turn Journal, Runtime
wiring, and real-flow migration have not begun. This revision does not itself pass the audit gate:
Stage 2 remains disallowed until an independent Stage 1 re-audit passes.

### Stage 2 — A+ Coordinator and Server Turn Journal

- Add one client Coordinator as the owner of Turn orchestration.
- Add the minimal Server Turn Journal for binding each Server Turn to the authenticated user and that Turn's client-supplied local `projectId`, request identity/hash, sequence, external counters, idempotency, and Server External Execution Status.
- Do not add a server-side project registry, project ownership table, local Workspace ownership proof, or cloud Workspace persistence.
- Make Server External Execution Status queryable after SSE interruption without making it an Overall Local Agent Turn Outcome.
- Keep local Tool Results, local Workspace effects, Pending Confirmation, and the overall user-visible outcome outside Server Turn Journal authority.
- Do not yet unify every Tool, Compaction, Abort, or Recovery path.

### Stage 3 — Unified Runtime Lifecycles

- Route Tool execution, Tool Batch finalization, all compaction modes, SSE, Abort, and Recovery through the common lifecycle.
- Remove specialized terminal/recovery behavior from active paths.
- Preserve local project effects and every capability in Section 4.
- Do not delete the old B-only implementation surface yet.

### Stage 4 — Cutover and Deletion

- Switch to the single accepted Runtime.
- Delete B-only proof protocols, old flags, obsolete RPCs/routes, legacy claims/version branches, and implementation-binding tests.
- Replace deleted proof tests with product behavior and retained-security tests.
- Finish with one Runtime and no long-lived compatibility flag.

## 11. Deletion Policy

- The B implementation is permanently archived in `archive/agent-runtime-b` and `agent-runtime-b-final-2026-07-28-f27a410`.
- The formal branch keeps the existing implementation until the new Runtime passes its staged acceptance gates.
- After Stage 4 acceptance, obsolete code is deleted from the formal branch.
- Morpho will not maintain two Runtimes long term.
- Morpho will not keep a long-lived Runtime Feature Flag.
- Dead code, legacy branches, and commented-out implementations are not archival mechanisms.
- Git history, the archive branch, and the annotated tag are the archive.

## 12. Audit Gates

The following gates apply to every stage:

- Did the commit remain inside the declared stage?
- Did it reintroduce the B objective of proving client-local history or Tool Result integrity?
- Did it create two authorities for Overall Local Agent Turn Outcome, or let Server External Execution Status masquerade as that outcome?
- Is the terminal outcome derived by an explicit lifecycle/reducer rather than Boolean fields assembled at the end?
- Is SSE still display-only rather than authoritative terminal state?
- Are Auth, per-Turn authenticated-user/local-`projectId` binding, API keys, quota, idempotency, counters, request hash/sequence, and server-side external-action confirmation preserved without inventing project ownership?
- Are local high-impact confirmation and server-validated external/high-impact confirmation kept distinct?
- Are all capabilities in Section 4 preserved?
- Did the stage add coupling that belongs to the next stage?
- Do tests protect user behavior and retained security, or only temporary implementation details?

| Stage | Required audit evidence before proceeding |
|---|---|
| Stage 0 | Archive branch and tag point to the pre-Stage-0 baseline; only the three architecture documents changed; the A+ supersession is explicit; Stage 1 implementation has not started and no Stage 1 production/runtime changes are present. |
| Stage 1 | One lifecycle vocabulary, explicit events, pure reducer, and unified Tool Batch Outcome exist; the reducer alone owns Overall Local Agent Turn Outcome; no Coordinator or Server Journal was smuggled in; reducer tests cover failure, cancellation, partial success, and Pending Confirmation. |
| Stage 2 | One Coordinator owns client orchestration; one minimal journal owns only Server External Execution Status; authenticated-user/local-`projectId` binding, idempotency, and isolation tests pass; no project registry or ownership claim is added; SSE loss is recoverable by state query; no local-history authenticity proof or second overall-outcome authority is introduced. |
| Stage 3 | Tool, compaction, SSE, Abort, and Recovery paths use the common lifecycle; the seven scenarios in Section 9 pass; preserved capabilities and successful local effects survive failure/reconnect. |
| Stage 4 | Only one Runtime is reachable; B routes/RPCs/claims/flags and implementation-bound tests are removed; full behavior and retained-security acceptance passes; archive refs remain unchanged. |

## 13. Decision History and Supersession Matrix

The matrix classifies the relevant 2026-07-24 through 2026-07-28 decisions against A+. “Narrowed” means a security or product core remains while its client-integrity proof scope does not. “Historical only” identifies an implementation consequence rather than a continuing architecture contract.

| Date and prior decision | Topic | Status | A+ disposition |
|---|---|---|---|
| 2026-07-24 — `Make The Server Authoritative For Agent Provider Contracts And Turn Leases` | Server authority | Narrowed | Retain Auth, server-owned Prompt/Tool Contract, keys, limits, binding each Turn to its authenticated user and client-supplied local `projectId`, and external-call accounting. This is not browser-local project ownership. Supersede authority over the authenticity of browser-owned Transcript and continuity content. |
| 2026-07-26 — `Canonical strategy items and fixed Agent tools` | Server Tool authority | Retained | Strategy remains bounded input and the Tool Registry remains server-owned; local project text never becomes trusted System or Tool policy. |
| 2026-07-26 — `Causal Agent Turn Lease` | Lease | Narrowed | Retain atomic counters, per-Turn authenticated-user/local-`projectId` binding, request hash, sequence, and idempotency. Supersede use of Lease metadata as proof that client-local history and results are causally authentic. |
| 2026-07-26 — `Lease-bound Provider execution and signed continuation` | Causal continuation | Narrowed | Retain binding of chargeable execution to a valid Turn and sequence. Supersede HMAC proof of the complete client prefix, Provider output replay, local Call results, and post-compaction local transcript. |
| 2026-07-27 — `Close signed Agent continuation and compaction boundaries` (product/security boundary) | Bounded execution and compaction behavior | Retained | Retain call ceilings, strict compaction reduction, Summary Revision correctness, and no duplicate external execution. |
| 2026-07-27 — `Close signed Agent continuation and compaction boundaries` (proof boundary) | Causal continuation, Context Marker, Compaction Receipt | Superseded | v5 continuation manifests, v4 Receipt proof, and Context Marker causal chains are not A+ requirements. |
| 2026-07-28 — `Close cross-turn transcript and Context authority` (product boundary) | Context Frames, summaries, and terminal outcome semantics | Retained | Raw chat, Provider Context Frames, Summary Revisions, and explicit terminal outcomes remain local-first product data. |
| 2026-07-28 — `Close cross-turn transcript and Context authority` (proof boundary) | Transcript Snapshot and cross-turn authority | Superseded | Snapshot refresh and server proof of the complete browser-owned Transcript, Context, and durable replay are outside the A+ boundary. |
| 2026-07-28 — `Require complete transcript and idempotent Turn Closure proofs` (server boundary) | Idempotent Server External Execution Status | Retained | The minimal Server Turn Journal remains authoritative and idempotent only for server external execution; the client reducer owns Overall Local Agent Turn Outcome. |
| 2026-07-28 — `Require complete transcript and idempotent Turn Closure proofs` (proof boundary) | Closure proof | Superseded | Closure Tokens, proof chains, and full-manifest validation of local history and Tool Results are not retained. |
| 2026-07-28 implementation under the Closure decision | Function Call Finalizer | Historical only | The Pending Confirmation-only Finalizer is a B-proof implementation consequence, not the target contract. Unified Tool Batch Outcome replaces it. |
| 2026-07-27/28 recovery clauses under continuation and Closure decisions | Recovery | Narrowed | Retain no-duplicate external execution, idempotent retry, and Server External Execution Status lookup. The client reducer combines that lookup with local state. Supersede exact Closure-candidate replay, Finalizer-specific recovery, and Snapshot refresh as the general recovery model. |
| 2026-07-26 — `Turn outcome from unresolved work` | Outcome semantics | Retained | Preserve the distinction between resolved failures, unresolved work, partial success, and full success; express it through the Stage 1 reducer. |
| 2026-07-26 — `Context bounded by items as well as tokens` | Context and compaction limits | Retained | Token/item pressure and server fail-closed limits remain Context Policy; they do not require a local-history proof chain. |

Where an older entry combines retained server protection with superseded B proofs, the A+ decision governs the boundary. Old entries remain untouched as historical evidence.
