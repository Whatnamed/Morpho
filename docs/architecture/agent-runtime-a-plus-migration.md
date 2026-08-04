# Morpho Agent Runtime A+ Migration

This document is the durable implementation ledger for converging the Morpho Agent Runtime on the A+ trust boundary. It records migration scope, release evidence, and audit gates; it is not authorization to implement or execute a later stage early.

## 1. Status

| Field | Value |
|---|---|
| Decision date | 2026-07-28 |
| Current state | Phase A complete; Phase B complete; healthy observation window active; Phase C deferred and unauthorized |
| Current formal working branch | `main` |
| A+ branch relation | `main` and `refactor/agent-runtime-a-plus` are kept fast-forward-aligned; the A+ runtime release baseline is recorded below |
| Phase B A+ runtime SHA | `c7820091ca63bcca333071dcd77308e093a525f8` |
| B implementation archive branch | `archive/agent-runtime-b` |
| B implementation archive tag | `agent-runtime-b-final-2026-07-28-f27a410` |
| Baseline full SHA | `f27a4102e94730ec56a476b349dda4710a67b514` |
| Baseline short SHA | `f27a410` |
| Stage 0 complete | Yes — the decision, archive references, migration ledger, and historical-audit status are recorded in the Stage 0 documentation commit |
| Stage 1 complete | Yes — independently audited at `8d7c2df442ea1ccfb012e35691c2df8430a85f52` |
| Stage 2 complete | Yes — independently audited at `895f1c26a3753342f78df155b99f992984adfa05` |
| Stage 3 implementation | Independently accepted at `4c52cc5cfa7db5fcdcbf1765acfd8795c6e1f1dc` |
| A+ Runtime | The only reachable Runtime on this working branch |
| Active working-branch runtime | Canonical A+ `agentTurnRunner.ts`; no selector or B fallback |
| Server journals | Server Turn Journal plus External Action Journal implemented; the two additive A+ Migrations are applied and database-verified |
| Stage 4 | Complete — independently accepted at `1ec902ecfd09c6b0abfe7b58230321e880321e94` |
| Phase B acceptance | Sole A+ Vercel Production deployment and authenticated no-cost health acceptance completed; no paid Provider smoke was required |
| Observation gate | Healthy observation window active; earliest read-only audit `2026-08-06 10:28:24 Asia/Shanghai` |
| Next allowed stage | Phase C前只读观察审计；Phase C cleanup remains separately unauthorized |

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

These names define the architecture boundary. Stage 2 implements one explicit shared mapping between
the camel-case client protocol and snake-case Journal storage without expanding server authority
beyond external execution.

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

This table is the pre-cutover classification used to control the migration. `Split` identified a
mixed module whose product/security responsibilities had to be retained before the B-only portion
could be removed.

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
| Legacy Claims and version branches — `agentContinuationToken.ts` and `agentTurnProviderRequest.ts` | No | No | Yes | Stage 4 deleted compatibility branches used only by the retired proof chain. |

Stage 4 completed those splits. Fixed Tool schemas/effects remain in `morphoAgent.ts`; Context Frames
remain untrusted product data; bounded provider execution and server Prompt/Tool ownership remain in
`agentTurnProviderRequest.ts`; display SSE remains in `agentStreamProtocol.ts`; deterministic product
hashes moved to `agentProductHash.ts`. The B Provider Contract, Lease, Continuation, Compaction Proof,
old Agent Route, Snapshot Refresh, special Finalizers, and their implementation-bound tests were
deleted rather than retained as commented compatibility code.

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

`preparing` is a mandatory gate rather than an optional alias for Provider startup. The first
Provider request can start only after `PREPARATION_COMPLETED` has moved the Turn to
`requestingProvider`. A terminal, conflict, or quota preparation fault can finalize the Turn as
`failed`; a retryable preparation fault may enter Recovery and must resolve before preparation
can complete. No unresolved preparation fault can be bypassed by starting Provider execution.

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

An unresolved fault is also an execution gate: it blocks `PREPARATION_COMPLETED`,
`PROVIDER_REQUEST_STARTED`, `TOOL_BATCH_STARTED`, and ordinary Continuation startup. External
facts already in flight may still be observed so the Turn can settle accurately. A retryable
external error may recover while its request remains running, but `externallyFailed` itself is
terminal and cannot be relabeled retryable. If external execution reaches any terminal Server
status while Recovery is active, `RECOVERY_RESOLVED` derives and enters the Overall Local terminal
outcome instead of returning to an unusable Phase/Server-status combination. Recovery from
`awaitingNextRequest` resumes in `continuing`, where the next legal action is explicit.

Core reducer invariants are: pure and deterministic transitions; no input mutation; one active
phase; strict phase/event legality; complete Tool Call set validation; no contradictory terminal
facts; terminal absorption; no successful effect erased by later failure or cancellation; and
no Server or SSE status masquerading as Overall Local Agent Turn Outcome. The focused Vitest
matrix covers the required basic, Provider/display, Tool Batch, Outcome, error/recovery, and three-mode
compaction matrices, all audit-revision rounds, and a table-driven viability matrix over
representative reachable Phase, Server-status, and Fault classes. The Compaction failure path uses
the same Fault merge rule as every other error source: a different unresolved Fault is preserved and
rejected as a conflict, while an identical Fault replay advances idempotently to the appropriate
recovering or terminal phase.

Stage 1 passed independent audit at `8d7c2df442ea1ccfb012e35691c2df8430a85f52` as the
tested design-contract boundary. Stage 2 then added the isolated components recorded below, and
Stage 3 connected them behind a temporary default-off selector. Stage 4 later removed that selector,
the B Runtime, old outcome resolver, Closure/Lease paths, and B compaction execution; the historical
Stage 2/3 sections below retain the staged evidence rather than describing the current entry point.

### Stage 2 — A+ Coordinator and Server Turn Journal

Stage 2 is complete and was independently audited at
`895f1c26a3753342f78df155b99f992984adfa05`. The one client orchestration owner is
`src/features/workspace/agentTurnCoordinator.ts`; its concrete fetch adapter is
`src/features/workspace/agentTurnCoordinatorHttpHost.ts`. The Coordinator creates a Server Turn,
owns one in-memory Stage 1 lifecycle, allocates Request IDs and strictly increasing step sequences,
allows at most one active request, retries with the same identity and sanitized Provider request,
rejects stale stream/query results, and exposes deep-frozen lifecycle snapshots. Every lifecycle
change is an event sent to `reduceAgentTurnLifecycle`; the Coordinator has no second Outcome
resolver and cannot accept an Overall Local Agent Turn Outcome from its caller. It has no React,
UI, localStorage, Workspace-schema, Supabase, or API-key dependency.

Validated current-request stream events are also copied to an optional `onDisplayEvent` observer.
This display sink receives deep-frozen text, Tool Call IDs, process activity, and server-status
events only after Request ID and sequence validation; stale or reducer-rejected events are not
forwarded. The sink is observational and local-only: it cannot submit lifecycle events, change the
Journal, persist Tool Results, or provide an Overall Local Agent Turn Outcome. A sink exception is
isolated from lifecycle progression, while already observed display events remain available to the
caller if the stream later ends or recovery is required.

The minimal Journal is introduced by
`supabase/migrations/20260729012105_add_agent_turn_journal.sql`. It uses the private
`agent_turn_journal` Turn table and private `agent_turn_request_journal` request-idempotency table,
plus narrow authenticated RPCs for create, read, atomic request acquisition, and settlement. Each
Turn is bound to `auth.uid()` and its client-supplied `localProjectId`; this is not project ownership
and no project registry, ownership relation, Workspace-to-`auth.users` binding, or cloud Workspace
record is added. Direct table access is revoked. The query response exposes only the Turn ID, local
project ID, Server External Execution Status, latest request identity/sequence, Provider/Search/Image
counters, timestamps, optional bounded failure code, and no user ID or Request Hash.

The Journal stores no messages, transcript, system or user prompt, Provider output, Tool arguments
or results, Workspace object, Memory, Summary, Context Frame, confirmation state, local persistence
result, Overall Local Agent Turn Outcome, raw Provider error, stack trace, Transcript Snapshot,
Closure Proof, HMAC transcript claim, Compaction Receipt, or local-history authenticity proof.
Request Hash is a server-computed stable SHA-256 over the actual external contract: model,
reasoning setting, canonical Provider input, and server-owned Tool Contract. It means only “the same
external request body was replayed”; the Journal stores the digest, not its input.

The stable resource API is:

```text
POST /api/ai/agent/turns
GET  /api/ai/agent/turns/[turnId]?localProjectId=...
POST /api/ai/agent/turns/[turnId]/requests
```

Creation is idempotent for one authenticated user, `localProjectId`, and
`creationIdempotencyKey`; a conflicting project binding is a deterministic non-recoverable `409`.
Request acquisition locks the Turn row in one database transaction, checks exact Request ID, Hash,
sequence, current status, Provider limit, and daily quota before inserting the request. Exactly one
concurrent caller receives execution authority and increments the Provider counter. Exact replay
returns the existing snapshot without external execution or another counter/quota mutation; Hash,
sequence, terminal-state, and binding conflicts do not execute. Search and Image counters exist but
remain zero until Stage 3 connects their real server paths; Stage 2 never fabricates them.

Every acquired request records `execution_started_at` and a fixed 15-minute
`execution_expires_at`. Authenticated read and exact replay lock the relevant Journal rows before
checking that deadline. An expired `providerRunning` request converges atomically to
`externallyFailed` with bounded code `external_execution_state_unknown`; it is never re-executed,
and Provider counters or daily quota are not incremented again. Settlement uses a bounded
three-attempt retry for transient Journal unavailability. If all attempts fail, the request remains
recoverable through the same read/replay deadline convergence instead of treating SSE completion
as authoritative Journal settlement.

Only the server request execution path advances `providerRunning` to `awaitingNextRequest`,
`externallyCompleted`, `externallyCancelled`, or `externallyFailed`; the HTTP request schema accepts
neither arbitrary status nor counters. The stream task settles the Journal independently of final
SSE consumption. When the stream ends early or lacks a final frame, the Coordinator queries the
Journal and emits `SERVER_EXECUTION_STATUS_OBSERVED` into the Stage 1 reducer. A recovered external
completion with no locally observed usable Provider output is finalized as
`externalExecutionCompletedWithoutUsableOutcome`; no response text is invented. Local output plus
a later external failure retains the reducer's partial-completion semantics.

`awaitingNextRequest` has a stricter payload rule: if the Journal confirms that status but the
current client never observed the matching Provider output, the Coordinator emits
`PROVIDER_OUTPUT_UNAVAILABLE`. The reducer creates no fake output or Tool Call, performs no replay,
and terminates the local Turn as `failed` or `partiallyCompleted` with
`providerContinuationPayloadUnavailable`, depending on earlier visible or Tool effects. This event
uses the same Fault merge invariant as every other error: an existing different Fault is preserved,
and payload loss is added as a separate Outcome reason. The normal Outcome derivation retains Tool
failure, persistence failure, unresolved work, and the existing Fault reason instead of replacing
them with a payload-only result.
Handshake denials are likewise typed before entering the reducer: quota and Provider-limit
denials are `quotaExceeded`, deterministic identity/sequence/status denials are `conflict`,
transient Journal/Auth/Supabase unavailability is `retryable`, and remaining deterministic
Provider/contract failures are `terminal`.

If an exact retry is deterministically denied after its lifecycle request already started, the
Coordinator does not leave the caller to infer a second recovery action and never starts Provider
again. The denial remains a Coordinator diagnostic rather than prematurely becoming a lifecycle
Fault. The Coordinator immediately reconciles the same Request ID and sequence against the Journal;
only a binding mismatch or an otherwise illegal reconciliation records a conflict. A terminal
Journal status is observed and finalized through the reducer, `awaitingNextRequest` continues when
the matching local output exists or takes the payload-unavailable terminal path when it does not,
and `providerRunning` returns the explicit
recoverable `external_execution_pending_reconciliation` state with Provider retry disabled and
query-only reconciliation still available. A transient Journal query failure is itself reported as
recoverable, and a later status query continues with the same Request identity without external
re-execution.

Provider acquisition also has a shared pure preflight used by both the Coordinator and the reducer.
The Coordinator applies it before calling the Host, so an unresolved Fault, illegal phase/status,
invalid identity, or invalid sequence cannot obtain server execution authority before the reducer
rejects the same transition. When a Journal query succeeds while the lifecycle is `recovering`, the
Coordinator first emits the matching `RECOVERY_RESOLVED` event and only then interprets the queried
server status. Running resumes a safe request phase, awaiting status follows the local-payload rule,
and every external terminal status finalizes through ordinary reducer events.

At the audited Stage 2 baseline no Feature Flag existed, and neither the UI nor the existing
`agentTurnRunner.ts` called the A+ Coordinator or its Routes. That baseline did not unify Tool,
Compaction, Abort, or Recovery paths and deleted no B code. Stage 3 starts only in the following
section and preserves the default B production path.

### Stage 3 — Unified Runtime Lifecycles

Stage 3 was independently accepted at
`4c52cc5cfa7db5fcdcbf1765acfd8795c6e1f1dc`. The following subsections retain the historical
Stage 3 implementation and audit evidence. Its temporary selector and parallel B Runtime were
subsequently removed by Stage 4.

#### Runtime entry and one client scheduler

At the Stage 3 audit baseline, `WorkspaceClient.tsx` had one product entry and a temporary
`agentRuntimeSelector.ts` chose B or A+. Stage 4 deleted that selector and environment variable;
`WorkspaceClient.tsx` now imports the canonical `agentTurnRunner.ts` directly.

The A+ Runner never writes lifecycle state directly and has no second Outcome resolver. It invokes
explicit Coordinator methods for Provider start/retry/query, Tool Batch start/call terminal/batch
finalization, local persistence, unresolved work, Compaction, cancellation, local error, and Turn
finalization. Every such method emits one Stage 1 event through `reduceAgentTurnLifecycle`; only the
reducer derives `completed`, `partiallyCompleted`, `pendingConfirmation`, `cancelled`, or `failed`.
The A+ message adapter maps that terminal local outcome to existing persisted message vocabulary
only after local Message/Trace/Workspace persistence has been attempted.

#### Provider, Stream, and local Tool contract

The A+ Provider request accepts bounded client-owned `user`/`assistant` messages and exact
Continuation items (`function_call` plus `function_call_output`). The server continues to add its
own System Prompt and fixed Tool Registry. It rejects client System roles, client Tool schemas,
unknown fields, excess items/bytes/depth, malformed Call IDs, unknown Tool names, duplicate Calls,
and incomplete Continuation pairs. Request Hash covers the stable model/reasoning/input/tool
contract actually sent externally, including local Tool Result Continuation items; that hash proves
only exact external-request replay, not the truth of a local Tool Result.

The transient `providerOutput` display event now carries the validated Tool payload
(`callId`, registered `name`, and bounded JSON `argumentsText`) as well as visible text and Call IDs.
The payload is not written to the Server Turn Journal. SSE remains display-only for reasoning,
commentary, activity, text, citations, Tool observation, and status hints. A stale Request event is
rejected, a display sink exception cannot change lifecycle state, ending local SSE consumption does
not cancel external execution, and missing terminal frames reconcile through the Journal.

`agentToolBatchAPlus.ts` validates the complete Call set before one `TOOL_BATCH_STARTED`, reuses the
existing Tool schemas, `AGENT_TOOL_EXECUTORS`, Tool Effect Matrix, execution-policy/confirmation
rules, Workspace commit boundary, Message Trace, Search adapter, and image-generation adapter, and
records exactly one terminal result per declared Call:

| Tool fact | Lifecycle terminal mapping |
|---|---|
| Successful read | `executed`, no local effect, persistence `notRequired` |
| Successful local write | `executed`, local effect `produced`, persistence `succeeded` |
| Local effect followed by save failure | `executed`, effect preserved, persistence `failed` plus the shared persistence Fault |
| Schema or executor failure | `failed` with a bounded typed terminal error |
| Not-yet-run work after cancellation | `cancelled`; already completed Calls remain unchanged |
| Confirmation required | `pendingConfirmation`; remaining Calls terminate and the current Turn ends |
| Partially successful image batch | `executed` with successful object IDs retained and failed items recorded as unresolved work |

All Calls then pass through the single `TOOL_BATCH_FINALIZED` aggregator. Executed, failed, and
cancelled results get bounded Provider-visible outputs; a pending confirmation is never reported as
executed and never continues the same Provider loop. User acceptance or rejection is a new explicit
local action and does not reopen the terminal Turn. The A+ path does not call the Pending-only
Function Call Finalizer, Closure Finalizer, Closure-candidate recovery, or Snapshot refresh.

#### Local Recovery Record and reconciliation

`agentTurnRecoveryStore.ts` is a versioned browser-local Recovery Record. `localStorage` contains
only the bounded identity/state index; exact retry requests, large Provider Tool payloads, runtime
Continuation data, and pending-confirmation payloads are stored as SHA-256-verified IndexedDB
references. The record contains no API key, authenticated user ID, React value, AbortController,
Fetch object, B Token, Closure/Snapshot/Manifest/Receipt, or invented Server status. The Coordinator
owns explicit export/restore validation, and deterministic record/binding conflicts are cleared from
the active scheduling slot so a later legal Turn is not permanently blocked.

The record is updated after Server Turn creation, pre-request identity creation, Provider output,
Tool/batch facts, Compaction apply state, cancellation/query reconciliation, and local persistence.
It is cleared only when the reducer is terminal, Message/Trace/Workspace persistence succeeded, and
there is no terminal pending-confirmation card to restore. Save failure retains the record and shows
failure. Refresh recovery validates project/message identity, restores the Coordinator, queries the
Journal before deciding execution, and follows these rules:

- `created` with no observed request permits only an exact same-ID/sequence/body retry;
- `providerRunning` is query-only and never re-executes Provider;
- `awaitingNextRequest` resumes the saved Tool payload, while missing payload terminates with
  `providerContinuationPayloadUnavailable` and no fabricated Tool;
- Tool-complete/Continuation-unknown recovery queries first and never re-runs the Tool;
- an active same-page Session exposes an explicit Resume/Reconcile operation; query-only pauses set
  streaming false, retain the Session, and do not make a later legal Turn wait for a page refresh;
- a Search, Image, or Compaction External Action in `running` is not a Tool or Compaction terminal;
  its stable Action ID, kind, request body/hash, Call binding, and observed status are retained for
  exact same-identity replay/query until a receipt, payload, unavailable result, cancellation, or
  failure is observed;
- every external terminal status is observed by the reducer and cannot overwrite local outcome;
- deterministic identity, sequence, project binding, terminal-state, Summary-revision, or external-
  action Hash conflict is non-retryable and cannot remain on the ordinary retry schedule.

#### Cancellation and the unified Compaction lifecycle

Cancellation first emits `CANCELLATION_REQUESTED`, stops new local work and display consumption,
then calls an explicit authenticated cancellation Route on the exact latest Request. Cancellation is
best-effort and process-local at the Provider adapter; the Coordinator always queries the Journal
afterward. A local `AbortController` never fabricates `externallyCancelled`. If the Provider actually
completed, the Journal retains `externallyCompleted`, while the reducer separately derives a local
cancelled or partial outcome from already completed effects.

`agentCompactionOrchestrator.ts` is the one core for `automatic`, `preContinuation`, and
`manual`. Each mode emits `COMPACTION_STARTED`, performs one server-authorized External Action,
validates the Summary, applies one deterministic Summary Revision using
`expectedPreviousRevisionId`, records the applied revision in Recovery before durable save, and ends
with `COMPACTION_COMPLETED`, `COMPACTION_FAILED`, or `COMPACTION_CANCELLED`; a `202 running` response
keeps the lifecycle in `compacting` and is resumed with the same Action identity. Raw chat and retained
tail remain. Replay cannot create another revision; conflicts do not overwrite a newer revision;
failure/cancellation leave the previous revision authoritative. Manual Compaction uses a UI-only
Turn message and is not represented as an ordinary Agent answer. A+ requires no Compaction Receipt,
Transcript Snapshot, Manifest, continuation-token proof, or Closure call.

#### Minimal External Action Journal

The forward-only Migration
`supabase/migrations/20260729093000_add_agent_turn_external_actions.sql` adds private
`agent_turn_external_action_claim` and `agent_turn_external_action_journal` tables plus four narrow
authenticated RPCs. It does not alter `20260729012105_add_agent_turn_journal.sql`. A Provider
request settlement atomically stores only bounded server-observed Search/Image Tool Claims; raw
arguments and local results are absent. Search/Image acquisition must match that claim, the owning
authenticated user's Server Turn, client-supplied local `projectId`, latest Request/sequence, stable
Action ID, server-computed Action Hash, action kind, and remaining claim limit. Compaction has the
same stable external-action identity but no local Tool claim.

The tables have no direct client grants. RPCs derive identity from `auth.uid()`, use fixed empty
`search_path`, lock Turn/Request/Claim/Action rows, enforce deadlines and terminal absorption, and
grant execution only to `authenticated`. Exact Action ID + Hash replay returns the existing state
without another action, quota reservation, or Counter increment; changed identity/Hash is a
non-retryable conflict. Search stores only a bounded 24-hour result receipt so a lost response can
be replayed without another query. Image binary and Summary bodies are not Journal data: if their
completed payload is lost, A+ reports that Tool/Compaction result unavailable and never repeats the
paid call. Provider, Web Search, and Image counters remain Server Turn Journal facts. The Migration
is committed but is not applied remotely by Stage 3.

An A+ image batch also derives its local Operation ID and client request IDs from the Server Turn
and parent Tool Call. Refresh therefore reuses the exact child Action Hash. Before contacting the
server, the browser recognizes an already persisted child image by that stable client request ID and
keeps the existing object rather than generating or writing it twice.

#### Stage 3 acceptance evidence

`agentRuntimeAPlusAcceptance.test.ts` remains the reducer/aggregator contract matrix; it is not by
itself evidence that every Section 9 scenario is wired through the real Runner. End-to-end runtime
evidence is in
`agentTurnRunner.test.ts`, lifecycle matrices in `agentTurnLifecycle.test.ts`, Coordinator
retry/query/conflict matrices in `agentTurnCoordinator.test.ts`, all three real Compaction modes in
`agentCompactionOrchestrator.test.ts`, local refresh payload integrity in
`agentTurnRecoveryStore.test.ts`, exact Search replay polling in
`agentExternalActionClientAPlus.test.ts`, and Search/Image/Compaction/Cancel/Provider Route tests. Coverage
now includes same-page Provider resume, query-only Search replay to a Receipt, `202` Image response
classification without Blob parsing, Compaction running convergence, persisted local-effect recovery
without a duplicate object, restored Search citations and runtime facts, cancellation without duplicate
Provider execution, clean new-Turn Fault state, local Tool success followed by Provider failure, the
seven Tool Batch outcome classes, three Compaction modes, SSE detach, refresh/query/exact retry/payload
loss, and deterministic conflicts that do not block a fresh Turn. The Workspace-level Runner tests
begin at the same Agent input contract and observe Message, Trace, Tool, Workspace, persistence, and
reducer Outcome. All external providers are fakes; Stage 3 performs no paid Provider, Search, or Image call.
The subsequent independent audit accepted the aggregate Stage 3 evidence at the SHA recorded above.

#### Stage 3 recovery-convergence revision

At that Stage 3 checkpoint, the follow-up implementation kept Stage 4 blocked while closing the three
recovery boundaries identified by audit:

- `resumeMorphoAgentTurnAPlus` and the temporary Selector/Workspace failure retry perform an explicit query-only
  reconciliation for an active Session. A `providerRunning` result never starts a second Provider;
  an external terminal or `awaitingNextRequest` result drives the existing Session forward, and a
  pending query leaves streaming false so the current page remains usable.
- Search, Image, and Compaction share the bounded External Action status vocabulary. `running` is
  persisted as a non-terminal pending action with its stable identity/body/hash and, when applicable,
  Tool Call binding. Search replays the same receipt request; Image checks status and Content-Type
  before reading a Blob; Compaction keeps `compacting` until the same Action converges. None of these
  query/replay paths reserves quota or starts a second external execution.
- Recovery Record v2 stores the serializable runtime facts consumed by later Steps, including Required
  Read state, citations, web-search evidence, Memory/Stage update keys, final text, and confirmation
  flags. Tool execution intent is flushed before local execution, and local write Tools derive stable
  effect/Operation IDs from `serverTurnId + callId`; recovery first detects an existing effect before
  executing again. The record never claims server authority over local effects or Overall Outcome.

That revision changed only Stage 3 runtime, local Recovery, tests, and architecture ledger wording. It
did not apply the Supabase Migration remotely, change the Server Journal schema, delete B Runtime, or
start Stage 4; later Stage 3 revisions and the final audit closed this gate.

#### Stage 3 recovery boundary micro-fixes

The next historical Stage 3 revision closed the three remaining P1 boundaries from the independent
review while keeping Stage 4 blocked at that checkpoint:

- A running or response-ambiguous External Action now calls the optional non-terminal UI port. The
  Workspace keeps an explicit `外部任务仍在执行 / 再次检查` entry through repeated `pending` checks;
  only `recovered`, `none`, or a terminal failure closes or changes that entry. Sending a new message
  while that entry is present performs Resume first rather than silently returning because an active
  Session exists.
- Search, Image, and Compaction POST transport failures after the request attempt are classified as
  ambiguous `running` Actions. The browser retains the same Action ID, serialized Body, and SHA-256
  Body Hash and replays that exact request/query identity. Abort remains a user cancellation, and
  explicit server terminal/conflict responses remain terminal. Tests assert one simulated external
  acquisition and identical replay bodies for all three actions.
- Every Tool marked `pendingDraftWrite`, `reversibleWorkspaceWrite`, or `memoryWrite` now has a recorded
  replay strategy. Delivery section drafts use a stable Draft ID; proposal revision recognizes already-
  applied final values; semantic Memory Patch uses its existing dedupe key; Comparison overwrites its
  stable analysis ID; Research, Design Definition, Concept Direction, and Visual Tools retain their
  stable operation/request identities. Delivery, revision, Memory, Comparison, Visual, and effect-
  matrix audit tests cover the crash/replay boundary.

Those micro-fixes changed only Stage 3 runtime, local domain idempotency, tests, and the architecture
ledger. They did not apply the Supabase Migration remotely, change the Server Journal schema, delete B
Runtime, or start Stage 4; later Stage 3 revisions and the final audit closed this gate.

#### Stage 3 write-ahead recovery and delivery-outcome revision

The next focused revision closes the remaining recovery and Tool Batch semantics found by the latest
independent review:

- Search, Image, and Compaction now build the stable Action ID, exact serialized Body, and SHA-256
  Body Hash before the first POST. The complete descriptor is written to the browser-local Recovery
  Store and the write is flushed successfully before the request may leave the page. A refresh reuses
  only that persisted Body after matching Action kind/ID, Tool Call binding where applicable, and Hash;
  it never rebuilds Search queries, Image references/model settings, or Compaction messages from the
  current Workspace. Missing, damaged, or mismatched payloads stop with
  `external_action_request_payload_unavailable`.
- Because the Recovery Record has one current External Action descriptor, A+ Image child Actions are
  submitted serially. Each next child replaces the descriptor only after the preceding child has
  returned and its local result handling has settled. At that checkpoint, the B default path retained
  its existing bounded image concurrency. A future parallel A+ implementation must persist every in-flight child descriptor
  before restoring parallel submission.
- `prepare_delivery_section_draft` is a low-impact local pending-draft write, not the reserved
  `pendingConfirmation` lifecycle state. A successful call records one `executed` Tool terminal,
  requires durable Workspace persistence, returns `draftCreated` to the Provider, and leaves Apply or
  Discard as a later independent user action. Stable Draft identity keeps refresh replay idempotent.
- The local-write strategy audit now derives the complete expected Tool set from
  `MORPHO_AGENT_TOOL_EFFECT_MATRIX`; adding a new pending-draft, reversible-Workspace, or Memory write
  without an explicit replay strategy fails the test instead of escaping a hand-maintained name list.

Tests cover a page disappearing while the first Search response never arrives, exact Compaction request
replay with an explicit local-source conflict after conversation data changes, persisted Image descriptor
forwarding after current settings change, missing External Action payloads, Delivery Batch terminal loss/replay, and full Runner
Continuation after Delivery Draft creation. That revision did not change a Route, Server Journal,
Supabase schema, or remote deployment; it did not switch the default Runtime, delete B, or start
Stage 4. Later Stage 3 revisions and the final audit closed this gate.

#### Stage 3 recovered-batch and Compaction apply-boundary revision

The final focused Stage 3 revision closes two continuity gaps discovered after the write-ahead audit:

- A restored Image child descriptor is now a one-time pending cursor, not an immutable batch-wide
  rejection gate. Already persisted children are skipped by stable `clientRequestId`; the matching
  restored child reuses the exact persisted Body; and its descriptor is consumed only after that
  child's local Workspace/Operation result handling settles. The next child must then build, persist,
  and flush its own descriptor before POST. A page loss between children therefore converges through
  the already persisted result and advances without duplicate images, Hash conflict, or
  `external_action_request_payload_unavailable`.
- A recovered Compaction no longer computes or uses a new Workspace Plan. Its SHA-256-verified request
  Body supplies the original message IDs, roles, bodies, and source endpoints, while client-only
  write-ahead metadata preserves the matching Source ID Hash, expected previous Summary Revision, and
  original token estimate without changing the server Route body. Recovery requires the request and
  metadata to agree before querying the same Action.
- The Summary apply boundary accepts only append-only messages beyond the original source range. A
  changed, missing, or reordered original message returns `compaction_source_changed`; a changed or
  missing base Summary Revision returns `summary_revision_conflict`. A currently unnecessary
  Compaction Plan does not discard an already persisted Action, and an old Summary is never bound to a
  newly computed source range.

Focused tests exercise `A existing -> restore B -> persist B -> write/send C`, exact restored
Compaction with no current Plan, append-only tail preservation, source-content conflict, Summary
Revision conflict, and Recovery Store round-trip of the client apply boundary. This revision changes
only Stage 3 client runtime, browser-local Recovery metadata, tests, and architecture ledger wording.
It changed no Route, Server Journal, Supabase Migration, Runtime default, or B code and did not start
Stage 4. The later independent audit accepted Stage 3 at the SHA recorded above.

### Stage 4 — Cutover and Deletion

Stage 4 was independently accepted on `refactor/agent-runtime-a-plus` at
`1ec902ecfd09c6b0abfe7b58230321e880321e94` after the release-gate and neutral Provider
cache-hint revision:

- `WorkspaceClient.tsx` calls the canonical `agentTurnRunner.ts` directly. The Selector,
  `NEXT_PUBLIC_MORPHO_AGENT_RUNTIME`, and both old public Runner names are gone.
- B Client/Server Lease, Continuation, Snapshot/Manifest, Context Marker causal proof, Compaction
  Receipt, Closure, special Function Call Finalizer, old Agent/Web Search routes, and proof-bound
  tests are deleted. The fixed Tool Registry, Context Policy, Summary Revision, raw chat, Provider
  snapshots, Trace, Project Memory/Stage Records, local Tool product rules, Auth/quota, Provider
  secrets, request identity/sequence, counters, and both A+ Journals remain.
- Canonical Workspace types no longer retain `AgentTurnClosureRecovery`, signed Outcome items, or
  Provider Request State. Schema-v15 normalization explicitly discards those legacy browser fields
  while preserving product data, so old local projects open without keeping a second state source.
- `20260729190000_remove_agent_runtime_b_proofs.sql` is the forward-only cleanup Migration. It drops
  only B Lease RPCs and `private.ai_agent_turn_leases`; it does not modify migration history or the
  A+ Turn/Request/External Action Journal. It is checked in but was not applied remotely by Stage 4.
- Remote database release is explicitly split into Phase A (the exact accepted Stage 3 checkout
  applies only the two additive A+ Journal Migrations), Phase B (the sole A+ application passes
  authenticated no-cost create/query and fail-closed checks), and Phase C (the Stage 4 checkout
  applies only the irreversible B cleanup). A current Stage 4 `db push` must never be used as a
  shortcut for Phase A.
- Optional Provider Prompt Cache Hints are restored as neutral server-generated performance
  partitions for A+, independent Chat, and Compaction. Their opaque keys cover authenticated user,
  local project where applicable, model, Prompt Contract, Tool Profile, and stable system prefix;
  optional retention is emitted only for an explicitly supported capability. The actual hint fields
  enter the exact external request/action hash. They do not prove identity, project ownership,
  client data, replay safety, external completion, or cache hit.
- Architecture tests assert one reachable Runtime, absence of B routes/protocols/flags, preservation
  of A+ and independent AI routes, and the one-way Workspace compatibility boundary. Migration tests
  assert the cleanup cannot drop A+ journal objects.

The B code remains available only through Git history, `archive/agent-runtime-b`, and the annotated
tag `agent-runtime-b-final-2026-07-28-f27a410`; Stage 4 does not move either archive reference.

### Stage 5 — Merge and Release Candidate Gate

> **Historical planning status**：本节记录 Phase A 之前的 Stage 5 release-candidate 计划和当时的
> 发布顺序。该计划已经完成并由下方的 Phase A、Phase B 与观察窗口记录收口；其中“不得合并
> `main`”等措辞只描述当时的冻结状态，不是当前分支状态。当前唯一可执行的后续事项是
> Phase C 前只读观察审计，不能据此自动执行 Phase C。

Stage 5 prepares a reviewable merge candidate without authorizing a source merge, database release,
or production cutover.

#### Accepted baselines

```text
Stage 3:
4c52cc5cfa7db5fcdcbf1765acfd8795c6e1f1dc

Stage 4:
1ec902ecfd09c6b0abfe7b58230321e880321e94

main baseline:
f27a4102e94730ec56a476b349dda4710a67b514
```

At the start of Stage 5, `refactor/agent-runtime-a-plus` was 42 commits ahead of `origin/main` and
zero commits behind. The `main` baseline was the direct ancestor and there was no `main`-side
development to absorb, merge, or reconcile.

#### Stage 5 responsibilities

- Freeze the A+ merge candidate while preserving every Stage 0–4 audited SHA.
- Run the complete local quality, production-build, browser, Case Study, architecture-boundary, and
  Route acceptance suite against the final Release Candidate HEAD.
- Create a Draft PR as the GitHub CI, Vercel Preview, review, and complete 42+1 commit-range container.
- Require GitHub Actions and Vercel Preview to pass without Provider credentials, paid calls, remote
  Supabase changes, or production deployment.
- Keep `main`, production, all three database release phases, and both B archive refs unchanged.

#### Source merge and production release remain separate

Creating a Draft PR does not authorize production deployment. Before Phase A completes, this branch
must not enter `main`: updating `main` may trigger Vercel Production while the sole A+ application
still depends on Server Turn Journal and External Action Journal contracts that have not been applied
remotely.

The release order remains:

1. Complete the Stage 5 Release Candidate, local verification, CI, Preview, and review gate.
2. Separately authorize and execute Phase A from the accepted Stage 3 checkout, applying only the two
   additive A+ Journal Migrations.
3. After Phase A passes, separately authorize the `main` fast-forward and Phase B sole-A+ deployment
   plus authenticated no-cost health checks.
4. After an agreed healthy A+ window, separately authorize Phase C irreversible B database cleanup.

#### Future merge policy

The later authorized source merge must be fast-forward only so every audited commit SHA remains
reachable unchanged. Do not squash, rebase, rewrite the 42 migration commits, use GitHub Squash and
Merge, or use GitHub Rebase and Merge. The Draft PR is only a review and CI container. A later
authorized task may execute:

```powershell
git checkout main
git pull --ff-only origin main
git merge --ff-only refactor/agent-runtime-a-plus
git push origin main
```

Stage 5 does not execute those commands and does not authorize Phase A, Phase B, or Phase C.

#### Historical Runtime B database reconciliation

The production Runtime B schema and migration ledger were reconciled against the fixed B baseline
`f27a4102e94730ec56a476b349dda4710a67b514`. This was a bounded repair of historical B state, not
Phase A and not an A+ schema release.

The five local Migration files were verified byte-for-byte against the B baseline before any ledger
or schema action:

| Migration | Baseline Git blob | Reconciliation mode |
|---|---|---|
| `20260726143030_harden_agent_turn_lease_causality.sql` | `0e2c5af62fb8a5c7110f672129311a2b059b961a` | History-only Repair |
| `20260726161500_bind_agent_turn_provider_execution.sql` | `616ace498b471ae474cead2952654fa5bdd9a28f` | History-only Repair |
| `20260727180000_read_agent_turn_lease_state.sql` | `bbbe9631b23b10f3fe20b90f8d073c9e65e613a3` | Normal Backfill |
| `20260728174500_bind_agent_turn_closure.sql` | `4e167ece1f7667dc87489773e0a878572f0ccd32` | Normal Backfill |
| `20260728203000_harden_agent_turn_closure_sequence.sql` | `0fd81b724ea61a5e320b95d1e8196d2b37ea1185` | Normal Backfill |

Before Repair, all five versions lacked a remote migration-history entry. Read-only schema comparison
proved that the first two Migration effects already existed and matched the baseline, so only
`20260726143030` and `20260726161500` were marked `applied` through History-only Repair. The immediate
post-Repair history showed those two versions applied while the later three remained pending.

The next fixed-CLI dry-run contained exactly these three normal Backfill files and no others:

```text
20260727180000_read_agent_turn_lease_state.sql
20260728174500_bind_agent_turn_closure.sql
20260728203000_harden_agent_turn_closure_sequence.sql
```

One official `db push` then applied that exact set. There was no retry, manual SQL, reset, rollback,
or additional schema write. The final migration history records all five Runtime B versions as
applied. Independent post-apply checks confirmed the audited 13 critical fields, 13 critical
constraints, and seven final RPC signatures; zero obsolete overloads; `SECURITY DEFINER` plus fixed
empty `search_path`; and the intended `authenticated`/`postgres` `EXECUTE` grants. All audited data-
anomaly aggregates are zero, and the final remote database lint reported no schema errors.

The A+ Turn, Request, and External Action Journal objects remained absent, and the Runtime B cleanup
Migration remained unapplied. A read-only Stage 3 readiness dry-run from
`4c52cc5cfa7db5fcdcbf1765acfd8795c6e1f1dc` contained only:

```text
20260729012105_add_agent_turn_journal.sql
20260729093000_add_agent_turn_external_actions.sql
```

The retained evidence bundle is
`C:\Users\hasee\AppData\Local\Temp\morpho-b-reconcile-20260729-234644`.

#### Authentication recovery and no-paid health acceptance

Production logs recorded four historical middleware failures at `2026-07-29T16:00:41Z` with the
exact Supabase Auth code `refresh_token_not_found`. The A+ branch audit found two convergence gaps:
`getUser()` errors were not classified, leaving a terminal stale session to retry indefinitely, and
redirect responses did not preserve Supabase `Set-Cookie` writes and the narrowly required
`Cache-Control`, `Expires`, and `Pragma` headers from the middleware response.

The minimal branch fix starts at
`a66d3274a595ad896d013a0d2b8a3f9ca000691e` and converges at
`f971d48a214354e4b4f4c1beaca2940a2a4e0a9a`. It accepts only an `AuthApiError` whose code is exactly
`refresh_token_not_found` as terminal. It expires only the current Supabase project's known auth
cookie root and chunks, preserves strict cookie attributes, keeps unknown/network errors fail-closed
without deleting the session, and copies only the response cookies and authentication-related
anti-cache headers into a new redirect. Logs include only sanitized error metadata.

Local verification passed lint, TypeScript checking, 176 Vitest files with 1,421 tests, production
build, Case Study upgrade, and all 18 Playwright tests. A real `@supabase/ssr` integration test uses
the Supabase Auth service's actual terminal error response shape without storing a real refresh token and proves
that the resulting redirect expires the stale cookie securely. The deterministic integration path
is also the Preview test substitute for the exact terminal-stale case: a controlled random invalid
token in the live Preview was classified by Supabase as `validation_failed`, so the middleware
correctly kept that different error fail-closed rather than misclassifying or clearing it.

The final Preview deployment for `f971d48a214354e4b4f4c1beaca2940a2a4e0a9a` was Ready. Anonymous
login/protected-route behavior had no loop; a normal authenticated session opened the project
directory and `project-morpho-case-study`; and three reloads retained the exact project path, one
Canvas application, one enabled AI input, the idle state, and the directory's `42` canvas objects and
`21` visual assets. Its acceptance window contained no hydration, Supabase, or authentication error
and no `refresh_token_not_found`.

Production was not redeployed. The immutable origin of the existing `main` deployment at
`f27a4102e94730ec56a476b349dda4710a67b514` supplied a fresh origin with no prior Morpho cookie or
local-storage state. After a normal login, `project-morpho-case-study` passed three independent reloads
between `2026-07-30T01:03:02Z` and `2026-07-30T01:10:46Z`. Each reload returned the exact project path,
one Canvas application, one enabled AI input, the same project title, and idle status; the directory
still reported `42` canvas objects and `21` visual assets. In that exact Production deployment/time
window, runtime-log queries found no new `refresh_token_not_found`, session-load failure, missing
function/table, Closure, Provider Failure, Lease State, RLS, or Grant error. No Agent, Provider,
Search, or Image request was sent. The earlier log is therefore classified as a stale pre-existing
browser session now covered by the branch recovery fix, not as a new Production failure.

#### Phase A additive database acceptance

Phase A was applied and database-verified at `2026-07-30T02:16:40Z` with the fixed Supabase CLI
`2.109.1`, the accepted Stage 3 checkout
`4c52cc5cfa7db5fcdcbf1765acfd8795c6e1f1dc`, and the previously verified `morpho` project
(`lpra...uavb`). Historical Runtime B reconciliation remained applied and verified, and the accepted
authentication-recovery boundary remained unchanged.

The write-ahead Migration List showed all five reconciled Runtime B versions applied and exactly the
following two A+ versions pending. Their accepted Git blobs were rechecked before the write:

| Additive Migration | Accepted Git blob |
|---|---|
| `20260729012105_add_agent_turn_journal.sql` | `c3752c9cbdf2b733ccd68ef4a7462bf36633c044` |
| `20260729093000_add_agent_turn_external_actions.sql` | `b952991ec3316357dd8af54bef0fd896b01ba21a` |

The strict dry-run contained those two files in that order and no historical B Migration, cleanup,
seed, roles, or other Migration. One official `db push --linked` applied that exact set successfully;
there was no retry, Repair, reset, rollback, manual Migration SQL, or other remote write. The final
Migration List records both versions on local and remote, and the final dry-run reports that the
remote database is up to date. The irreversible
`20260729190000_remove_agent_runtime_b_proofs.sql` cleanup is not applied.

Read-only catalog verification confirmed all four private A+ objects and their complete column,
type, nullability, default, primary-key, unique, foreign-key, check-constraint, and index definitions:

```text
private.agent_turn_journal
private.agent_turn_request_journal
private.agent_turn_external_action_claim
private.agent_turn_external_action_journal
```

The two External Action tables have RLS enabled exactly as defined, with zero policies and no direct
`PUBLIC`, `anon`, or `authenticated` table grants; the Turn and Request journals likewise expose no
direct grants. All eight A+ RPC identity signatures are present with no extra overload, use
`SECURITY DEFINER` plus fixed empty `search_path`, grant `EXECUTE` only to `authenticated` and the
owner, and deny `PUBLIC` and `anon`. Function-definition checks matched the authenticated-user/local-
project binding, creation/request/action idempotency, request and action Hash identity, contiguous
Sequence, bounded counters and quota, execution-expiry fail-closed behavior, Action Claim consumption,
and bounded Web Search receipt contracts. The schema contains no Prompt, Transcript, Workspace,
Image Base64, credential, or key payload column.

The Runtime B compatibility boundary is still intact: the Lease table has its 23 columns and 18
constraints, all seven exact final RPCs remain `SECURITY DEFINER` with fixed empty `search_path` and
the intended Execute ACL, no obsolete overload appeared, and active B Leases were zero before and
after the additive release. Database lint completed with no Error; it reported only three existing
`warning extra` notices for unread local PL/pgSQL variables. Post-apply application verification
passed lint, TypeScript checking, 176 Vitest files with 1,421 tests, production build, and all 18
Playwright tests without sending an Agent, Provider, Search, or Image request.

The retained Phase A evidence bundle is
`C:\Users\hasee\AppData\Local\Temp\morpho-a-plus-final-release-20260730-100137`.

The following is the Phase A closeout snapshot recorded on 2026-07-30. Its `Next allowed action`
line is historical; the current Phase B and observation status is recorded in the next section.

```text
Historical Runtime B database reconciliation:
Applied and verified

Authentication recovery regression:
Accepted

Production B fresh-session health:
Passed without paid provider calls

Phase A:
Applied and database-verified

A+ additive migrations:
20260729012105
20260729093000

B cleanup:
Not applied

Next allowed action:
Phase B main cutover and Production acceptance.
```

#### Phase B main cutover and Production acceptance

Phase B is complete. The A+ runtime release at
`c7820091ca63bcca333071dcd77308e093a525f8` was strict fast-forwarded into `main`, and the
documentation closeout keeps `main` and `refactor/agent-runtime-a-plus` fast-forward-aligned. The
current production application is the sole A+ Runtime on Vercel; no B Runtime selector, fallback, or
formal-panel call path was reintroduced.

The authenticated no-cost Production acceptance was completed after Phase A. It covered the A+
Turn create/query boundary and the missing-Provider fail-closed path without making a paid Provider,
Search, or Image call. The Server Turn/Request/External Action Journal contract remained the only
server-side authority for external execution status, while local project content and the overall
local Turn outcome remained browser-owned.

The B compatibility database objects remain intentionally present. The irreversible
`20260729190000_remove_agent_runtime_b_proofs.sql` Migration has not been applied, and Phase C is
not authorized. The repository is therefore in the healthy observation window. Before the earliest
observation time of `2026-08-06 10:28:24 Asia/Shanghai`, no Phase C write is permitted. After that
time, the only remaining task is a separately recorded read-only audit of real A+ Journal, Request,
External Action, continuity/recovery, duplicate-execution, hanging-state, authentication, database,
and residual-B-runtime evidence; that audit does not itself authorize cleanup.

## 11. Deletion Policy

- The B implementation is permanently archived in `archive/agent-runtime-b` and `agent-runtime-b-final-2026-07-28-f27a410`.
- The formal branch kept the existing implementation until Stage 3 passed its staged acceptance gates.
- Stage 4 deleted obsolete code after that Stage 3 pass and was independently accepted at the SHA
  recorded above; Stage 5 preserves that accepted code baseline unchanged.
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
