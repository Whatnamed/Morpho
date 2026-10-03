# Morpho Implemented Architecture

## Current Runtime

Morpho is a single Next.js App Router application in this repository root.

## Current release status

The current formal Runtime is the sole A+ Runtime. A+ Phase A, Phase B, Phase C Observation, and
Phase C Cleanup are complete; the Runtime B database table/RPC contract has been removed. Historical
Runtime B Migrations, archive references, and recovery evidence remain only for history and recovery.
The Phase C cleanup acceptance baseline is recorded in the phase ledger and is not an assertion about
the current `main` or current Production Deployment. The phase ledger and release evidence live in
[`agent-runtime-a-plus-migration.md`](./agent-runtime-a-plus-migration.md).

The workspace has one Agent Runtime. `WorkspaceClient.tsx` uses
`useWorkspaceAgentRuntimeController.ts`, which constructs the project-scoped guarded Host and
delegates to the canonical `agentTurnRunner.ts`; there is no Runtime selector, environment flag, B
fallback, UI/URL switch, or request-body override. The client Coordinator and Turn Lifecycle
reducer own orchestration and Overall Local Agent Turn Outcome. The Server Turn Journal owns only
Server External Execution Status.

Implemented routes:

- `/` renders the local project homepage.
- `/login` renders Supabase email/password sign-in and registration for closed-test access.
- `/projects/[projectId]` renders the Morpho workspace for one local project.
- `/api/ai/agent/turns` creates the Server Turn Journal resource used by the workspace Agent.
- `/api/ai/agent/turns/[turnId]` reads minimal Server External Execution Status.
- `/api/ai/agent/turns/[turnId]/requests` starts exact idempotent A+ Provider requests; its explicit
  `/cancel` child attempts cancellation without treating SSE detach as external cancellation.
- `/api/ai/agent/turns/[turnId]/actions/web-search`, `/image`, and `/compaction` execute bounded,
  idempotent A+ external actions through the private External Action Journal.
- `/api/ai/chat` remains an independent bounded text route; the workspace Agent does not use it.
- `/api/ai/image` proxies server-side GrsAI image generation and returns the generated image bytes.

Agent Runtime details:

- `agentTurnRunner.ts` uses the Coordinator and reducer; the Server Turn
  Journal owns only Server External Execution Status, while the client derives the Overall Local
  Agent Turn Outcome from local Tool, confirmation, and persistence facts.
- A same-page running or ambiguous External Action keeps a visible query-only Resume entry. Search,
  Image, and Compaction persist the full Action descriptor and flush it before POST, classify a
  non-abort response loss as `running`, and recover only with the persisted Action ID, serialized Body,
  and Body Hash. A missing/mismatched Body fails explicitly instead of being regenerated from current
  Workspace state. The current A+ Image path serializes child Actions so the one current descriptor
  always names the only in-flight child.
- Browser-local writes remain product-correctness effects. Every Tool Effect Matrix write has an
  explicit replay strategy: stable Operation/client-request IDs, stable delivery Draft IDs,
  final-value comparison, semantic dedupe, or stable Analysis ID overwrite. These strategies do not
  make local Workspace state server-authoritative. Delivery Draft creation is an executed local write;
  Apply/Discard remains a later independent user action rather than a Pending Confirmation Turn.

Important module boundaries:

- `src/app/` owns Next.js routes.
- `src/middleware.ts` owns authenticated route access and login redirects.
- `src/features/projects/` owns the local project homepage UI.
- `src/features/workspace/` owns the visible workbench experience.
- `src/features/auth/` owns the login client and its decorative sign-in scene.
- `src/design-system/` owns the app-side design-token install (`tokens.css` + `tokens/*.css`, mirrored from `docs/design/design-system/`); `globals.css` imports it once and declares no tokens of its own.
- `src/features/archive/` owns archive, editable backup, and restore clients.
- `src/features/delivery-output/` owns the browser-only delivery output package client.
- WorkspaceClient decomposition phase 1 keeps page composition in `WorkspaceClient.tsx` while
  `useProjectBundleController.ts` owns Project Bundle panel state and async orchestration and
  `useDeliveryOutputController.ts` owns Delivery Output panel state, preflight concurrency, and
  export orchestration. Both controllers delegate package construction, validation, restore, and
  download behavior to the existing feature clients.
- WorkspaceClient decomposition phase 2 moves Document Reader session state, request identity,
  cancellation, source-preview Blob/Object URL ownership, extract loading/recovery orchestration,
  and document-fragment creation orchestration into `useDocumentReaderController.ts`.
  `documentSourcePreview.ts` owns preview MIME checks and Object URL creation/revocation, while the
  controller continues to delegate extract recovery and fragment domain behavior to the existing
  Reader modules. The Reader session is project/readiness-scoped, and recovery workspace updates
  revalidate that session inside the functional current-workspace boundary. Delivery Reference
  navigation and canvas selection/focus remain page-level in `WorkspaceClient.tsx`; no schema,
  import format, fragment contract, or visible Reader behavior changed.
- WorkspaceClient decomposition phase 3 moves Delivery Preparation session state, active delivery
  fallback, pending section-draft target, and deterministic mutation wiring into
  `useDeliveryPreparationController.ts`. The controller delegates all Delivery domain behavior to
  the existing domain functions; AI panel composition, Document Reader navigation, canvas selection
  and focus remain page-level, and `DeliveryPreparationPanel` keeps its local form and presentation
  state. No schema, backup, import, draft, output, or visible UI contract changed.
- WorkspaceClient decomposition phase 4 moves transient drawer, project-menu, context-menu,
  detail-surface, and research-detail session state into `useWorkspaceSurfaceController.ts`. The
  controller owns deterministic top-surface close ordering and project-switch isolation, while
  canvas selection/focus, routing, domain mutations, AI state, and the four existing feature
  controllers remain page-level. No visible UI, shortcut priority, schema, or domain contract
  changed.
- WorkspaceClient decomposition phase 5 moves the project-aware selection session, persisted
  selection hydration, canvas selection/focus request nonces, live versus committed canvas View,
  and detail-location return into `useWorkspaceSelectionNavigationController.ts`. P6H replaces
  the original snapshot history with operation-owned manual deltas in
  `useWorkspaceObjectHistoryController.ts` / `workspaceManualHistory.ts`. Ctrl/Cmd+Z, Shift+Z
  and Ctrl/Cmd+Y belong to mutation history; detail return uses Alt+Left. Editable DOM inputs
  retain native text editing history. Navigation no longer consumes mutation Undo. Both controllers
  clear transient history across project/readiness changes,
  and keep same-project ready updates intact. `WorkspaceClient.tsx` remains responsible for
  canvas Trace, surface coordination, domain mutations, AI state, confirmations, and component
  composition. The original decomposition preserved UI; P6H supersedes only the history/shortcut
  behavior above, without schema or persistence-format changes.
- WorkspaceClient decomposition phase 6-A moves Visual Generation Execution into the React-free
  `workspaceVisualGenerationExecution.ts` core and the
  `useWorkspaceVisualGenerationController.ts` React wiring layer. The core owns plan validation,
  operation and A+ recovery identity, placement and pending slots, provider concurrency, request
  persistence, local asset saving, result commits, partial/failure/cancel handling, and final
  selection/focus. Each execution captures a project/readiness session token; the controller
  checks that token and the current workspace project ID inside the same functional workspace
  commit, and gates pending slots, task status, selection, and focus with the same identity.
  Project/readiness lifecycle changes abort the local Agent execution slot and reset visual
  transient state, while A+ Recovery descriptors remain durable for query-only recovery. The
  controller supplies the guarded workspace commit boundary, transient status updates, asset
  storage, and browser fetch services while preserving the existing
  `ExecuteAgentVisualGenerationPlan` return contract. `WorkspaceClient.tsx` remains responsible
  for page composition and the surrounding AI confirmation flow. No schema, provider route, or
  visible image-generation behavior changed.
- WorkspaceClient decomposition phase 6-B moves normal A+ Agent page/session orchestration into
  `useWorkspaceAgentRuntimeController.ts`. The controller owns the project-scoped Host,
  initial Recovery, send/manual compact/resume/retry/cancel dispatch, runtime display state,
  pending Recovery acknowledgement, and the owned abort/stream-flush slots used by Agent and
  confirmed local visual tasks. Its Host carries `{ projectId, workspaceReady, generation }`; a
  project or readiness boundary detaches the old session, flushes and locally aborts its display
  work, removes only that project's local Runner ownership, and resets runtime chrome. Guarded
  Host reads, persistence, UI effects, and functional Workspace commits fail closed with
  `agent_turn_host_session_detached`, including a project-ID recheck inside the commit updater,
  so stale work cannot mutate the next project or create a duplicate Provider/external action.
  `WorkspaceClient.tsx` still assembles the full A+ turn input and owns Pending Confirmation,
  `imageTaskStatus`, and visual-confirmation business rules. The Runner, Provider protocol,
  Recovery format, persistence/schema, and Context/Compaction strategy are unchanged apart from
  recognizing detached Host sessions as non-failure page teardown. No visible UI contract changed.
- The Agent request-latency follow-up keeps those A+ boundaries but shortens the fresh-Turn path.
  `agentTurnRunner.ts` creates one Recovery Store per send and uses its synchronous metadata-only
  preflight before Preparation. An existing v2 record, any legacy v1 record, malformed metadata,
  or an invalid project identity still enters the original full `load`/validate/clear/query-only
  recovery path; only a confirmed absence skips its Promise/IndexedDB reconstruction path.
  Non-Delivery Preparation starts independent image-attachment and document-extract reads together, captures
  the post-message Workspace once, builds continuous conversation Context once, and derives the
  task and stable four-document Project State Memory Contexts from one reconciliation.
  Provider Context Frames do not mutate messages or the compaction boundary, so that conversation
  result remains authoritative after frame append. The user/assistant message commit and Context
  Frame commit remain separate synchronous boundaries: preparation failure, user-message
  retention, exact recovery body, Tool continuation, and Journal authority semantics are unchanged.
- WorkspaceClient decomposition phase 6-C moves Import/Asset Ingestion execution into the
  React-free `workspaceImportExecution.ts` core and the
  `useWorkspaceImportController.ts` React wiring layer. The core owns file classification,
  IndexedDB asset-save delegation, partial-success reporting, import-domain writes, document
  parse/extract continuation, and parse-failure persistence. Each execution captures
  `{ projectId, workspaceReady, generation }`; every async boundary rechecks that session, and
  the controller rechecks the current workspace project ID inside the same functional commit
  updater before writing assets, objects, parse state, or selection. Canvas, top Rail, context
  menu, and other import entry points share this one execution path; selection is delegated to
  the existing project-scoped selection controller rather than duplicated here. Same-project
  rerenders keep an import alive, while project/readiness transitions fail closed. Browser-level
  async entry points such as clipboard reads and file pickers capture this handle before their
  first await or picker handoff, and context-menu file-picker positions are tagged to the
  initiating project and invalidated on cancel or lifecycle transition. IndexedDB writes cannot be physically
  cancelled by this boundary. Import and visual-generation execution treat newly written assets as provisional
  and delete them best-effort when a stale session or failed local commit prevents the Workspace reference from
  becoming durable; generic object-level Blob garbage collection remains intentionally outside this phase.
- WorkspaceClient decomposition phase 6-D moves Proposal review orchestration into the React-free
  `workspaceProposalWorkflow.ts` core and the
  `useWorkspaceProposalWorkflowController.ts` React wiring layer. The core delegates apply,
  reject, and the three supported draft-update operations to the existing domain actions and
  normalizes their selection/focus and assistant-message results; `deliveryPlan` remains an
  explicit unsupported proposal type. The controller is the single entry point for chat,
  canvas, and detail-surface review actions, owns the project-scoped transient active proposal,
  and commits through the current-workspace functional boundary so stale callbacks fail closed.
  Source-changed proposals require the explicit review opt-in, while base-superseded and
  target-unavailable proposals remain blocked. Surface detail ownership stays with the Surface
  controller, selection/focus ownership stays with the Selection controller, and discussion or
  regeneration only opens the existing AI draft/task/work-intent flow without sending or applying
  a proposal. No schema, provider, A+ runtime, persistence, or visible product contract changed.
- WorkspaceClient decomposition phase 6-E moves Compare decision preparation and writeback into the
  React-free `comparisonDecision.ts` core and the
  `useWorkspaceComparisonDecisionController.ts` React wiring layer. All seven Compare actions
  (`setPrimary`, `setAlternative`, `eliminate`, `restoreAlternative`, `setDefaultReference`,
  `clearDefaultReference`, and `createKeyConclusion`) follow one request -> explicit pending
  confirmation -> current-workspace revalidation -> domain writeback path. Requests do not mutate
  workspace state or acknowledge an Agent/provider action; required reasons are enforced locally,
  and optional-reason actions still require confirmation. Final metadata uses the current saved
  analysis, while a key conclusion keeps only its candidate text-evidence sources. The controller
  owns a project-scoped session so A/B/A2 stale callbacks fail closed, same-project rerenders keep
  pending confirmation, and a successful local confirmation commits the existing domain action
  with exactly one operation-owned manual history entry. Compare elimination no longer uses the
  comparison-specific text prompt; ordinary canvas elimination remains on its existing prompt path. No schema,
  provider, or A+ runtime contract changed.
- WorkspaceClient decomposition phase 6-F moves the shared Pending Confirmation model into the
  neutral `workspaceConfirmation.ts` module and gives the page one project-scoped confirmation
  slot through `useWorkspaceConfirmationController.ts`. Local, Agent A+, and Compare producers
  all request that slot without overwriting an existing value; an occupied Agent request becomes
  an explicit terminal `confirmation_slot_occupied`, while a colliding durable A+ recovery record
  remains recoverable until the local or Compare confirmation is resolved. Generic confirm, cancel,
  secondary default-reference review, key-conclusion editing, current-workspace revalidation,
  Agent acknowledgement, visual-task ownership, and UI effects live in
  `useWorkspaceConfirmationExecutionController.ts`; Compare remains authoritative for its own
  decision confirmation. Agent acknowledgement is required before Agent writeback or external
  visual generation, local and Compare confirmations do not acknowledge an Agent turn, and failed
  acknowledgement leaves the confirmation card and workspace unchanged. Default-reference
  confirmations bind the exact target, previous default, and review image/collection IDs;
  Agent proposal confirmations bind source objects and, when based on the current design
  definition, its exact ID and revision. Agent requested actions also bind the applicable
  design-definition review state, previous default-reference identity, or concept-direction
  status, so stale confirmations are rejected before acknowledgement and undo. Project/readiness
  transitions clear the slot and stale callbacks fail closed, while same-project rerenders preserve
  it. Successful reversible writes
  create one object-operation undo entry; request, cancel, blocked, and failed-ack paths do not
  include or restore pending confirmation state. `WorkspaceClient.tsx` now only composes the
  controllers and dispatches Compare versus generic confirmation callbacks. No schema,
  persistence format, Provider, A+ protocol, or visible confirmation-card contract changed.
- WorkspaceClient decomposition Phase 6-G Final Audit: COMPLETE. The audit verified that the
  Phase 1–6-F controllers and React-free cores are the active authorities, that the page keeps only
  composition, thin dispatch, and page-local UI behavior, and that project/readiness sessions plus
  functional current-workspace commits protect asynchronous write paths. The Document Reader
  recovery boundary, Delivery Preparation/Output and Project Bundle operations, Surface/Selection/
  History callbacks, and canvas Proposal rejection routing all fail closed across A/B/A2 transitions;
  same-project rerenders remain valid. Phase 1–6-G are closed; there is no planned Phase 6-H or 6-I
  decomposition. Future work must come from a real new product requirement or a reproducible
  regression.
- `src/domain/morpho/` owns product-domain types, the generated case-study fixture, deterministic domain actions, import helpers, generation helpers, and queries.
- `src/infrastructure/persistence/` owns browser localStorage project catalog and workspace access.
- `src/infrastructure/assets/` owns browser IndexedDB Blob storage and asset-save workflow.
- `src/infrastructure/supabase/` owns browser/server Supabase clients and public configuration reading.
- `src/server/ai/` owns AiJWS/OpenAI-compatible provider config, request validation, context conversion, and response normalization.
- `src/server/auth/` owns account access state and AI quota guards.
- `src/server/image/` owns GrsAI provider config, request validation, bounded polling, and remote image download.

Implemented server-side state and deployment:

- Supabase provides account identity, closed-test qualification, AI daily quota, and the Server
  Turn/Request/External Action Journals through narrow `SECURITY DEFINER` RPCs. Forward-only SQL
  lives in `supabase/migrations/`. Phase C cleanup is complete: the retired Runtime B lease table
  and RPC contract have been removed. Historical migration names and acceptance evidence remain
  only in the phase ledger and recovery records.
- Projects, canvases, files, generated results and backups stay in browser localStorage and IndexedDB.
  P3A additionally registers the exact paid Provider request (which can contain selected text/image
  input) in a service-only execution journal, without credentials. P3B adds finite execution-result
  escrow, separate from long-term browser-local assets and Project Truth; see both contracts below.
- Vercel is the current production deployment path (`npm run build`). Cloudflare Workers via `@opennextjs/cloudflare` and `wrangler` is a retained opt-in backup path behind the `cf:*` scripts.
- `.github/workflows/quality.yml` runs lint, typecheck, test, and build on `main` and pull requests, without provider keys or deployment.
- Export exists as delivery output packages and archive/backup bundles (see the M7 and M8 sections). Project deletion can explicitly reclaim previewed, provably exclusive Blobs; cloud project sync, cloud file storage, multiplayer sync, and object-level or automatic Blob garbage collection remain unimplemented.

## Data Model

Structured workspace data is schema version `18`.

Truth / evidence authority (P1B-1):

- New object creation persists a random `incarnationId`, preserved through edits, revision changes,
  visibility changes, persistence and Backup. Reusing an object ID creates a different incarnation.
  Source baselines/evidence bases and Decision targets bind both IDs; content equality cannot revive
  old authority. Fragments also bind their source file incarnation. Schema 1–17 upgrades establish
  random forward identities for surviving live objects only; existing identities are preserved.
  Historical bindings without identities remain unknown/review-required and are never backfilled.
  Schema 18 normalization and Backup restore preserve established identities without regenerating
  them. Identity-less older schema 18 objects remain unknown unless newly created through a domain
  creation boundary.
- Delivery action Decision kinds represent historical occurrences without effects. Only kinds with
  ongoing current semantics require structured effects; Decision Memory and history UI share this
  classification. Proposal targets and parent dependencies have separately frozen identity bindings.
- Domain commands persist typed `DecisionEffect` targets, state changes and adopted revision IDs.
  `decisionRecords.ts` classifies from those effects, later effects and domain pointers. Legacy
  unstructured records remain history/review-required; labels never reconstruct historical effects.
- `sourceResolution.ts` separates existence, visibility, content availability and fingerprint
  freshness. Version-2 fingerprints include file extraction identity/status, link content fields,
  fragment text/range and its source-file extraction dependency. They are bounded change detectors,
  not Blob hashes; actual binary readability remains an asset-reader concern.
- `evidenceAuthority.ts` qualifies each claim against its frozen `EvidenceBasis`. Unknown, changed,
  hidden, missing, candidate-only and unverified sources cannot establish `supported`. User adoption
  remains separate from evidence confidence. `reportedConfidence` retains unsupported legacy claims
  without fabricating a historical basis. Current object compatibility views, Research extraction,
  selected-context Tool output and Turn Context Frames consume these queries.
- A Research evidence item explicitly binds kind/index/text. Conclusion extraction inherits only
  that item's evidence, with a separate Research origin; unbound legacy items inherit no whole-card
  citations. Editing list text detaches the old binding; editing adopted text cannot certify new claims.
- Controlled semantic writes support explicit supersede/retract/resolve, scoped target IDs and
  persisted user evidence. UI withdrawal/resolution/restoration and Tool writes share the domain
  transition. Replaced facts cannot be restored as current. No automatic contradiction matching is
  used to decide which old fact to replace.
- Proposal dependencies are frozen from task Context or Operation input before execution and checked
  at Apply. Local A+ recovery and pending confirmations preserve those snapshots; old recovery without
  them remains unknown. Schema 1–17 projects/backups remain readable, migration is idempotent, and
  old incomplete Proposal baselines require explicit review rather than being recaptured.

P1B-2 still owns full Memory / Stage / Continuity consumer convergence and projection ownership.
P2 execution/input fulfillment, P5 Delivery Draft baselines and P6H manual history are unchanged.

Current workspace state includes:

- stable Morpho domain objects in `workspace.objects`;
- binary or link metadata in `workspace.assets`;
- stable delivery snapshots in `workspace.deliveryReferences`;
- pending delivery section drafts in `workspace.deliverySectionDrafts`;
- scoped semantic decisions in `workspace.decisionRecords`;
- visual-only canvas instances in `workspace.canvas.instances`;
- persisted workspace UI state in `workspace.ui`;
- continuous AI messages in `workspace.ai.messages`.
- optional ordered Agent process traces in `AiMessage.agentTrace`.
- project-wide compaction state and revisioned summaries in `workspace.ai.conversationCompaction` and `workspace.ai.conversationSummaryRevisions`;
- append-only provider-only Context Frames in `workspace.ai.providerContextFrames` for project state, turn scope, runtime configuration, and conversation summaries;
- immutable provider-visible user snapshots in `AiMessage.providerInputSnapshot`, plus deterministic frame `sequence` / `placement` metadata for transcript replay;
- seven revisioned current project-memory projections plus six possible revisioned stage records in `workspace.projectMemory`;
- saved local Compare analyses in `workspace.ai.comparisonAnalyses`.
- lightweight Operation records in `workspace.operations`;
- Artifact Proposal records in `workspace.artifactProposals`;
- citation snapshots in `workspace.citationSnapshots`.
- revisioned design definitions in `workspace.designDefinitionRevisions`;
- revisioned concept directions in `workspace.directionRevisions`;
- direction lineage records in `workspace.directionLineage`;
- lightweight visual branch records in `workspace.visualBranches`;
- derived working state in `workspace.workingState`;
- structured project-continuity state in `workspace.projectContinuity`.

Operation persistence is intentionally lightweight:

- workspace JSON stores operation status, summaries, input snapshots, proposal records, citation snapshots, and IndexedDB artifact references;
- workspace JSON does not store raw webpages, full document extracts, page preview binaries, provider raw responses, API keys, or response headers;
- interrupted operations are recoverable as local state, but they are not treated as background server jobs after refresh.

Schema-v17 loading is the one-way compatibility boundary for retired B browser fields, old
conversation checkpoint/lane metadata, `imageVariant`, and the formal key-conclusion category
model. It accepts v1-v16 workspace data through pure migration,
preserves valid legacy categories, derives a category only from an exact source research item or
the explicitly isolated old-note fallback, and stores recovery-only `unknown` when the legacy
evidence is not enough. New writes use only the four assignable categories and never default to
`unknown`; current runtime code never infers category from title, body, or note. It strips old
checkpoint collections and message metadata, removes `imageVariant` without inferring an image
role, and migrates at most one structurally valid legacy checkpoint range into a deterministic
project-wide summary only when no valid current summary exists. Schema-17 and schema-18
workspaces only strip retired fields and never interpret them. It also drops old
Closure Recovery, signed terminal Outcome, and Provider Request State records while preserving raw
chat, Summary Revisions, Provider Context Frames, Provider input/output snapshots, Agent traces,
project data, and assets. Those dropped fields are not part of the canonical type or archive format
and are never regenerated.

Canvas rendering is separated from Morpho domain state:

- Morpho objects are stable domain records in `src/domain/morpho/types.ts`.
- Canvas placement lives only in `canvas.instances`.
- tldraw custom shapes store `objectId` and `instanceId` only as a rendering bridge.
- Moving a shape updates canvas instance position; it does not change object type, status, relation, direction state, default reference, or delivery inclusion.
- tldraw renders only canvas instances whose source object exists and has `visibility: "active"`.
- Custom wheel zoom anchors around the mouse page point and persists the final camera view with debounce to `workspace.canvas.view` and `workspace.ui.canvasView`; zoom/pan state remains visual workspace UI state.

Semantic boundaries retained from schema v2:

- hide, delete, and eliminate remain different operations;
- delivery modules reference `DeliveryReference` IDs, not live source object IDs;
- delivery references store independent display snapshots;
- decision records are limited to project-level semantic decisions;
- default reference changes do not rewrite old images, version chains, or delivery references.

Schema v6 semantic additions:

- `keyConclusion` is a first-class Morpho object, separate from research objects and design definitions;
- design definitions are revisioned, and reconcile enforces at most one `isCurrentEffective` definition across active and hidden objects. A hidden current definition remains the current pointer but is marked unavailable for context instead of falling back to an older definition;
- concept directions are revisioned and lineage-aware. Proposal application modes are explicit: `create` creates new pending-preview directions, `revise` reuses one direction ID and creates a new current revision, `split` creates child directions with `splitFromDirection` lineage, and `merge` creates one new direction with one `mergedFromDirection` record per parent;
- image roles are explicit `ImageObject.role` values and can be changed through a traceable user decision. Runtime roles are limited to `reference`, `preview`, `conceptImage`, `primaryVisual`, `sceneVisual`, `cmfStudy`, `detailStudy`, `structureDiagram`, `interactionDiagram`, and `deliveryAsset`; legacy `main`, `scenario`, `cmf`, `detail`, and `diagram` are migration-only inputs;
- VisualBranch records are lightweight records under `workspace.visualBranches`, not Morpho objects and not canvas cards. They group images inside one direction, can be archived/restored, and do not delete or move images when archived;
- visual generation resolves an explicit direction/branch target from selected images, selected directions, or branch settings. It does not silently inject the primary direction, and images from different directions block generation until the target is explicit;
- Operation records now cover research, image generation, design definition proposals, and concept direction proposals. Active `queued`, `preparing`, `running`, and `waiting_for_user` operations block new provider-backed tasks;
- Proposal source review uses per-source semantic snapshots and explanatory `reviewDetails`; title, summary, canvas movement, size, and zoom changes are not semantic source changes;
- visual-development stage snapshots include active images assigned to concept directions, not only the direction objects themselves;
- `ProjectWorkingState` is stored as a derived, rebuildable index for current effective state and AI context assembly;
- legacy `stageRecords` stored current stage snapshots in earlier schemas, but schema v8 retires them in favor of `workspace.projectContinuity`.

Schema v7 and M4.2 additions:

- imported parseable files track `FileObject.parseStatus`, `extractedAssetId`, extracted character count, optional page count, parse timestamp, and parse errors;
- local document extracts are saved as IndexedDB `documentExtract` assets and are loaded into AI requests only when their source file object is selected and parsed;
- research operations combine selected file extracts, selected image visual input packs, workspace context, and optional AiJWS/OpenAI-compatible web search. A valid research proposal is recorded for audit and then applied into a `ResearchObject` canvas card automatically;
- default AI routing can adopt recommended research, image-generation, design-definition, or concept-direction execution paths when the user has not manually selected an overriding mode;
- visual generation asks AiJWS for a structured visual plan, validates that plan against selected sources and direction ownership, then calls GrsAI once per plan item. Each successful result becomes a new image object with generation metadata and direction/branch/source relations; partial failures remain attached to the image-generation Operation;
- design-chain tracing is computed on demand from objects, relations, revisions, visual branches, generation metadata, and decision records. The bottom detail surface shows the trace summary and the canvas draws a temporary overlay between traced objects without writing workspace state.

M4.3 additions:

- task-specific AI input assembly is centralized in `src/features/workspace/taskContext.ts` instead of being scattered through `WorkspaceClient.tsx`;
- task context is explicit and bounded by task kind, current selection, direct semantic dependencies, conditional default reference, selected image pixels, and selected local document extracts;
- hidden objects remain excluded from default AI context and are reported through predictable skip reasons when they are selected or otherwise encountered;
- `imageGeneration` planning requests to AiJWS can now include authorized image attachments and local `documentExtract` text, while `imageGeneration` still never receives web search;
- direction preview supports controllable multi-preview counts per selected direction with runtime validation and operation-level audit metadata;
- direction-preview image placement is planned through a deterministic layout helper instead of piling all generated results into one fallback area.

M5-A additions:

- schema v8 adds `workspace.projectContinuity` as the single project-continuity runtime entry point;
- legacy `project.currentFocus` is accepted only as migration input, and legacy `stageRecords` are not converted into a second history source;
- continuity events are written only from explicit successful domain events and are idempotent through stable `dedupeKey` values;
- continuity records use typed refs for objects, revisions, operations, visual branches, decisions, citations, and delivery references, with lightweight source snapshots only;
- `hidden`, `superseded`, and deleted or missing sources are resolved into different validity states before context assembly;
- task context now includes bounded project continuity records and derived memory views with deterministic relevance sorting;
- the left rail exposes a lightweight `项目记录` drawer, while the project homepage shows recent focus and continuity update notes without progress widgets.

M5-B1 schema-v9 compatibility history (superseded by schema-v15 Memory feedback):

- schema v9 adds controlled conversation semantic records to `workspace.projectContinuity.recordEntries` without changing real project facts;
- conversation semantic entries carry `origin`, `manualState`, `semanticKind`, `sourceMessageId`, `evidenceQuote`, and `scope`;
- `message` is now a typed continuity source ref, storing only a message ID, title `用户表达`, short quote snapshot, timestamp, and source availability;
- providers may return `morphoProjectContinuityPatch` candidates only for `chatAnalysis` and `researchOperation`; local parser, `SemanticPatchAuthorization`, validation, deterministic summary generation, and domain rules are authoritative;
- provider-generated summaries are ignored, and stored summaries are deterministic templates derived only from `semanticKind + evidenceQuote`;
- before writing a semantic patch, Morpho verifies that the local persisted `userMessageId` exists, is user-authored, and still matches the authorization draft;
- semantic `scope` filters provider task context and task-filtered memory views, but it does not delete scoped entries from the project-record drawer/global memory projection;
- semantic patches are blocked when the same reply includes design-definition or concept-direction Proposal JSON; research Proposal JSON can coexist with a valid semantic patch, but that patch may use only the pre-request context and must not reference the newly created research card;
- message refs are recalculated from current `workspace.ai.messages`, so removed source messages become `missing`, preserve quote snapshots, and stop entering factual memory/provider context;
- streaming assistant display strips complete and trailing partial `morphoProjectContinuityPatch` JSON while preserving original completed stream text for parsers;
- `getContinuityEntryEligibility` centralizes `manualState`, `validity`, and `sourceAvailability` behavior for memory, context, review lists, and drawer labels;
- assistant messages can show a lightweight `已补入项目记录` feedback button that opens/highlights records without triggering AI or changing focus.

M5-B2 schema-v10 compatibility history (superseded by the schema-v15 continuous-conversation runtime below):

The following bullets explain why legacy checkpoint fields still exist and how older workspaces were produced. They are not the current formal Agent Context contract.

- schema v10 adds short-term conversation checkpoints to `workspace.ai.conversationCheckpoints`; `ProjectContinuityState` remains schema v2;
- old v9 workspaces migrate by initializing an empty checkpoint array, preserving all raw `ai.messages`, and not fabricating lane keys or checkpoint content;
- ordinary `chatAnalysis` discussion/comparison requests build a deterministic conversation lane from current focus area, focus `updatedAt`, task kind, sorted explicitly selected active object IDs, selected direction IDs, selected-image direction IDs, and an optional unique selected-image VisualBranch ID;
- checkpoint requests trigger only after deterministic message/character thresholds, never for image generation, research operation, design-definition proposals, or concept-direction proposals, and are suppressed while a pending proposal is open;
- legacy pre-schema-15 provider context used a valid lane checkpoint plus bounded raw messages; that compatibility path is no longer the formal Agent history boundary, while the current draft remains a separate user input and is not duplicated in history;
- `morphoConversationCheckpoint` is parsed and validated independently from `morphoProjectContinuityPatch`; either valid block may succeed if the other fails;
- checkpoint writes update only `workspace.ai.conversationCheckpoints` and the assistant message `conversationCheckpointId`; they never write project records, current focus, objects, revisions, directions, default references, delivery references, or DecisionRecords;
- visible assistant text strips both complete and trailing partial checkpoint/semantic technical JSON blocks, and a saved checkpoint shows only the lightweight `已整理当前讨论脉络` message.
- the current Agent path uses one deterministic project-wide summary boundary instead of lane-filtered or last-eight history; current user/assistant messages do not write lane or checkpoint metadata;
- the A+ request route estimates the complete provider request, including system text, recent messages, tool schemas, tool outputs, image reserves, and an optional previous actual input-token baseline;
- the default Agent budget is Morpho's fixed 256,000-token internal window, summary preparation at 204,800 tokens, mandatory request compaction at 230,400 tokens, and a 16,000-token target for the compressible discussion/tool-history portion. Preparation is non-destructive; only the compact threshold advances a validated summary boundary;
- preparation keeps real project context, the current user input, the current selection, the current project summary, every complete post-boundary project message, and the latest unresolved tool-output group. Older completed tool outputs are shortened without replaying their tools;
- Responses token usage is normalized to one internal shape. When a valid provider total and output count omit input tokens, input is derived as `total - output`; malformed or negative usage is discarded. A provider context-limit failure triggers one server-side emergency-compacted retry of the same provider request, never a replay of client-side mutations, image generation, Proposal application, or other completed tools;
- when a mandatory-compaction response does not contain a valid summary, the compaction write is skipped and the already completed visible Agent result remains valid.
- an exact `/compact` input gathers all eligible project messages after the existing summary boundary and rolls them through bounded summary-only Agent requests with no tools or images. The write-ahead descriptor binds the original source message IDs, fingerprints, expected previous revision, token estimate, and boundary IDs. Recovery may retain newly appended tail messages, but changed or missing source messages and a changed summary revision fail explicitly. A successful result writes only the final project summary and does not mutate canvas objects.

Agent streaming additions:

- `/api/ai/agent/turns/[turnId]/requests` emits typed SSE while the provider is still running, including provider reasoning summaries, optional commentary, final text deltas, native hosted-tool activity, function-call readiness, citations, usage, context metadata, heartbeat, completion, and post-start errors;
- normal Agent turns consume that SSE protocol through the Coordinator Host. Compaction is a bounded External Action with its own Journal route and persisted write-ahead descriptor;
- `src/server/ai/openaiCompatibleResponsesStream.ts` is the isolated Responses compatibility parser. It handles arbitrary byte boundaries, CRLF/multiline SSE data, heartbeats, `[DONE]`, unknown events, cancellation, provider failure, and early disconnect without saving raw SSE into workspace data;
- `src/server/ai/providerResponseBoundary.ts` bounds buffered JSON to 8 MiB, diagnostic reads to 16 KiB/800 exposed characters, total SSE transport to 32 MiB, and an unfinished SSE frame to 1 MiB. One 240-second safety budget spans fetch, the narrowly verified prompt-cache compatibility correction, and stream parsing. Explicit caller cancellation remains `AbortError`; deadline/transport/read failures after submission retain their internal boundary codes but publicly converge as `external_execution_state_unknown` when execution cannot be confirmed. No such failure authorizes a second buffered or image-stripping request;
- Responses is the only Agent protocol for all configured OpenAI-compatible endpoints, including AiJWS. Network errors, HTTP 408/429/5xx, and incomplete/disconnected SSE never trigger another `/responses` POST or stream-to-buffered generation. Partial stream activity is retained; `response.failed` remains distinguishable from an unconfirmed transport failure. Morpho never switches to `/chat/completions`. System/user history uses `input_text`, while persisted assistant history uses the Responses-compatible `output_text` content type;
- Morpho keeps all Agent function tools at `strict: false` for the current compatibility provider because its complex JSON Schema handling returns 502 during valid continuation calls. The existing client-side parser remains the authoritative strict field, type, enum, and business-rule validator before local tool execution;
- assistant messages may persist `agentTrace` ordered parts. Reasoning stores only provider-returned summaries. Explicit `commentary` and `final_answer` phases are authoritative; unphased Responses text is buffered until turn completion and becomes commentary only when that turn also contains a tool call. Tool activities come from actual provider or local-tool execution. Final text remains in `AiMessage.body`;
- every provider attempt has a stable `attemptId`. A context-limit retry emits `turn-attempt-reset`; the client removes failed-attempt provider-only increments, ignores late events from that attempt, retains completed Morpho work, and uses only successful-attempt usage and terminal output;
- the request route owns the provider `AbortController`; explicit cancellation calls its exact Request resource, while an SSE reader detach alone does not claim external cancellation;
- client and server share `src/shared/providerInputBudget.ts`; cache diagnostics use four states (`unavailable`, `miss`, `partialHit`, `fullHit`) and prompt-cache retention is absent by default, with only explicit compatible `24h` forwarded;
- the client executes workspace tools locally, updates one stable tool activity per `toolCallId`, and merges provider continuations into the same assistant message and `agentTurnId`. Agent writes pass through a functional latest-workspace commit boundary, so streamed trace, concurrent user edits, operation/continuity changes, and tool results cannot overwrite one another;
- text deltas are merged by part and flushed about every 48ms, while tool start/end remains immediate. The process disclosure keeps ordered parts mounted for a 200ms lightweight collapse, follows the internal scroll only near the bottom, uses 220-320px bounded scrolling with fades, and disables shimmer/transitions for reduced motion;
- normal Agent execution has no four-turn product limit and no per-turn accumulated web-search-call limit. Hosted provider searches and local `search_web_evidence` results may continue while the task still has evidence gaps; each local search response remains bounded to five sources, while URL/content citation deduplication and context compaction bound the accumulated payload;
- validated visual plans are not routed to confirmation merely because the current Agent turn has already generated a fixed number of images. Each image still passes plan/reference validation and the existing provider quota, four-request concurrency, pending-slot, per-item commit, failure-isolation, and cancellation paths;
- the internal 28-model-turn ceiling, 18-minute duration guard, and normalized repeated-tool signature guard remain recovery mechanisms rather than product steps. A guard records a result for the stopped duplicate call, disables tools for one finalization request, and retains completed trace, citations, images, and project writes.

M5-C additions:

- schema v11 adds saved local Compare analyses under `workspace.ai.comparisonAnalyses` and links assistant messages through `comparisonAnalysisId`;
- Compare source selection is explicit only: 2-4 active selected objects, with hidden/missing/duplicate/unselected objects blocked for new analyses;
- parsed file sources require a sent `documentExtract`, and image visual evidence is authorized only when pixels or contact sheets are attached in that request;
- legacy schema-v11 compatibility tests still cover `/api/ai/chat` comparison payloads; the formal panel now creates Compare analysis through the Agent `create_comparison_analysis` tool with the same local authorization and validation;
- model `objectComparisons` carry `evidenceBasis`, and local validation rejects mismatches against actual pixels/document extracts/object summaries;
- `keyConclusionCandidate` is candidate-only and may use only selected true text evidence sources: sent document extracts, research objects, or existing key conclusions;
- same-reply design-definition or concept-direction Proposal JSON suppresses Compare writes, semantic patches, and Compare decision entry points;
- confirmed Compare decisions write normal `DecisionRecord` entries with lightweight `ComparisonDecisionMetadata`; the full Compare body is not copied into decisions or project memory.

M5-D1 additions:

- workspace schema remains v11; document reading is transient UI state and does not add migration fields;
- `src/features/workspace/documentReader.ts` resolves file-reader availability, builds stable text blocks from the saved extract string, and searches plain text with offsets into the current `documentExtract`;
- `src/features/workspace/components/DocumentReaderPanel.tsx` renders a floating reader for local parsed text, with search, capped result snippets, block scrolling, current-match highlight, and explicit source/precision warnings;
- the reader opens from the bottom detail bar for an active parsed file with a valid `documentExtract` asset. It reads only the IndexedDB Blob referenced by `file.extractedAssetId`;
- unparsed, parsing, failed, hidden, missing-extract, wrong-asset-type, missing-asset, and Blob-read-failed states are explicit and do not trigger reparsing, provider calls, or workspace repair;
- parser counts such as `extractedPageCount` may be displayed as counts only. Without a persisted page/slide source map, the reader locates only extract blocks, paragraphs, snippets, and character ranges and must not expose page/slide jump claims;
- opening, searching, navigating, and closing the reader do not change selection, task mode, current focus, AI messages, retired checkpoint metadata, semantic records, Compare analyses, DecisionRecords, operations, or project continuity.

M5-D2 additions:

- schema v12 adds `documentFragment` as a first-class Morpho object created only through explicit user extraction in the document reader;
- v11 migration to v12 initializes only schema requirements and does not fabricate historical fragments or rewrite existing files, messages, checkpoints, Compare analyses, DecisionRecords, operations, or project-continuity records;
- fragment extraction is bounded to 1-8 consecutive parsed reader blocks and at most 6,000 characters. The saved body is recomputed from `sourceText.slice(startOffset, endOffset)` and cannot be supplied by the UI;
- fragments store a source snapshot with file object ID, file title/name, source `documentExtract` asset ID, character offsets, and block IDs. They do not store original binaries, Base64, provider payloads, full extracts, OCR, page images, or layout maps;
- `documentFragmentExtractedFromFile` relations and fragment source metadata express provenance. Canvas placement remains visual-only and never implies source semantics;
- source availability distinguishes active, hidden, missing, missing extract asset, and extract-asset mismatch. The fragment body remains readable when the source is hidden or unavailable, but source navigation is disabled instead of fabricated;
- opening a fragment source location reuses the document reader with a real extract-offset range. It does not expose fake PDF pages, fake PPT slides, coordinates, provider calls, source-file visibility changes, current-focus writes, or AI-context changes;
- creating a fragment writes one deterministic `documentFragmentCreated` continuity event, but does not write the fragment body into Project Memory or create a key conclusion, decision, Compare analysis, operation, AI message, or checkpoint;
- task context can include selected active fragments as bounded text sources with provenance and source availability. It does not auto-attach the whole source file or sibling fragments;
- Compare can use selected active fragments as explicit text sources with evidence basis `documentFragment`; key-conclusion candidates may cite selected fragment IDs, not their source file IDs.

M6 additions:

- schema v13 upgrades the existing `delivery` object into the delivery preparation package with editable `sections`, package-level `references`, managed `gaps`, and pending `workspace.deliverySectionDrafts`;
- schema v14 adds optional persisted `AiMessage.agentTrace` records. v13 workspaces migrate without fabricating traces or changing existing message bodies, citations, checkpoints, Compare analyses, or project-continuity state;
- legacy delivery references migrate into one deterministic `交付内容` section when needed, without inventing new packages, narratives, gaps, drafts, or AI messages;
- delivery references are stable snapshots, not live source views. They store bounded title/summary/body/revision/file/asset metadata only and never store Blob URLs, Base64, source binaries, full source files, complete `documentExtract` text, or provider raw payloads;
- source state is resolved as current, hidden, missing, asset missing, or source updated through deterministic fingerprint/revision comparison, not generic `updatedAt` checks;
- refreshing a source-updated delivery reference is an explicit user action that updates only that reference snapshot, preserves editorial caption/note, and writes a normal decision plus delivery continuity event;
- `prepareDeliverySection` sends only the current section delivery reference snapshots in `deliverySectionContext`, does not send web search, normal task context, Compare context, live source objects, full files, or full document extracts, and creates only a pending draft until the user applies it;
- the floating delivery preparation panel supports package creation, section editing, explicit add-selected-object references, captions, gaps, stale-reference refresh, and draft apply/discard without becoming an export editor or slide layout engine.

### P5 Delivery dependency and inspection contract

- `deliveryInspection.ts` owns deterministic handoff inspection, not Project Truth. It consumes
  P1B source identity/evidence and P4 frozen lineage/actual inputs/delivered observation. Source
  existence, visibility, freshness, frozen asset metadata availability, copy review and provenance
  are independent facts. Only Output preflight reads Blob availability; metadata is not proof of bytes.
- New Drafts carry optional version-1 `generationBaseline`. A+ associates this baseline with existing
  P2B delivered section receipts at request preparation or bounded read, including identical-version
  pagination. Tool commit consumes the latest fully delivered matching evidence, never the latest
  Workspace. A fresh continuation rematerializes the current chapter in the next body, while exact
  active-request Recovery preserves the submitted body. A later partially delivered chapter cannot
  inherit an older chapter's full-read claim. Recovery facts preserve evidence; legacy absence stays unknown.
- Applicability is `current / review-required / stale / blocked`. Section title/purpose/narrative,
  order, relevant gaps, reference membership/order, snapshots and editorial changes invalidate the
  dependency baseline. Known target/copy conflicts block application even with review acknowledgment.
  Upstream change with unchanged frozen snapshot requires explicit review; legacy baseline absence
  never becomes current and requires the visibly labelled review-and-overwrite action.
- Snapshot refresh retains caption/note/narrative and marks reference and section copy for review.
  Explicit section copy review clears those flags without asserting source correctness. Both actions
  use the existing P6H manual history boundary; reload preserves flags and Undo/Redo recomputes inspection.
- `Section.referenceIds` is the sole current reference order. Preparation, Agent section Context and
  Output consume it directly; `Reference.order` is derived compatibility metadata refreshed on moves/reload.
- Workspace remains schema 18 with validated additive optional fields. Draft section/reference IDs
  are historical dependencies: removing them preserves readable drafts and permits Editable Backup,
  while applicability guards pending writes. Deleting the Delivery owner still removes its drafts.

## Schema v17 AI Continuity, Memory, And Key Conclusions

Schema v17 is the current runtime contract and supersedes lane-local checkpoint selection:

- current Agent preparation, append, search, and provider context are project-wide; no lane key or
  checkpoint result participates in current history selection;
- legacy checkpoint/lane/image compatibility types are isolated in
  `src/domain/morpho/legacyWorkspaceCompatibility.ts` and are not imported by current business
  modules;
- `ConversationCompactionState` points to a revisioned project-wide summary boundary, while all original `ai.messages` remain persisted and searchable;
- `ProjectMemoryState` contains seven document descriptors, current revision pointers, immutable history, source refs, basis, and `reviewRequired`;
- stage records use six possible project areas but create current revisions only for stages with real content; Compare writes back to the relevant stage and never becomes a stage;
- `resolveCurrentDesignDefinition(...)` in `derivedState.ts` resolves the current-effective definition object and only its owned `currentRevisionId`. Provider Project State Frames use it; hidden current definitions are explicitly unavailable and never select an older object's `isCurrent` revision.
- An empty Stage projection removes its current descriptor, retains `stageRevisions`, and creates no empty revision. Reactivating equivalent content reuses the historical value without rewriting it; changed content continues the retained revision chain. Design Definition and Concept Direction revision writes use copy-on-write and preserve the input Workspace/revision values.
- Repeatable Visual Branch and Delivery mutations create occurrence identity at the owning mutation boundary. Continuity dedupes replay of that occurrence, while later repeated actions remain separate. Existing revision/operation/Decision identities and legacy persisted `dedupeKey` records remain readable; no Workspace schema change is required.

P1A deletion/reference roles use the existing v17 shapes:

| Reference | Role and deletion contract |
|---|---|
| Relations, CanvasInstances, Stage Region/collection members, UI selection | Current membership: remove the deleted object ID. |
| Visual Branch direction/root; Image direction/branch | Live organization: direction deletion removes its owned branches and unbinds surviving images; image deletion clears branch roots. Image assets and immutable generation provenance remain. |
| Direction revision owner, lineage endpoints and `lineageRootId` | Historical identity: retain revisions and lineage. Missing endpoints are legal; existing endpoints must still have the correct type. |
| DeliveryReference/DeliverySectionDraft owner | Current ownership/pending application: owner deletion removes owned references and drafts, preserving upstream sources. |
| DeliveryReference source and snapshot | Stable snapshot: upstream deletion preserves the reference and snapshot; source availability reports missing. |
| DocumentFragment source File | Historical source identity: retain extracted body, file identity/title and extract asset; a missing File is legal, an existing wrong-type endpoint is rejected. Queries report missing availability. |
| Artifact Proposal sources/targets; Decision/Continuity sources | Existing historical source snapshots remain readable; existing application/review rules are retained, without a new dependency schema. |

P1A snapshot stop-loss is retained unchanged in `workspaceSnapshotHistory.ts` for legacy safety tests; the normal Workspace UI does not call it. P6H manual history below supersedes whole-Workspace restoration without weakening those historical guards.
- deterministic projection and controlled semantic entries meet in one Memory Kernel, with consecutive equivalent revisions collapsed during migration so reload is idempotent;
- Agent messages record prompt-contract version, task strategy, specific memory/stage update keys, citations, and Agent Trace provenance;
- `src/domain/morpho/agentContextPolicy.ts` is the only production Context Policy source: 256,000 window, 204,800 prepare, 230,400 compact, 16,000 uncompressed-tail target, and a separate 16,000 response reserve. `prepare` never trims history; only `compact` advances a validated summary boundary;
- every formal Agent request receives a bounded current Memory Kernel projection plus the task-relevant current Stage Record. Full history, revisions, hidden objects, and old decisions remain explicit-read material;
- `AiMessage.contextVisibility` keeps `/compact` commands and pure operation notices in UI/audit history without sending them to model Context, summary, or default conversation search;
- DecisionRecords remain append-only and are classified against current structured state as `current`, `superseded`, `historical`, or `reviewRequired`; current Agent memory and the default drawer view do not treat every record as current;
- generated images record structured intent, compiled prompt, reference-resolution diagnostics, prompt-contract version, model settings, and operation/provider provenance;
- Provider input keeps a byte-stable system prefix and deterministic `standard` / `standardWithWebSearch` tool profiles. Cache key/retention fields are opt-in and relay-compatible; missing cache metadata is observable as unavailable but never affects correctness;
- every A+ Provider request is built from bounded browser-local conversation, Summary Revision, Context Frames, selected project inputs, and exact Continuation items. The server validates shape, size, Tool names, Call IDs, and exact replay hash, but does not prove that browser-local history or Tool Results are true;
- the Server Turn/Request Journal binds an exact request to the authenticated user and client-supplied local project ID. It owns Provider acquisition, counters, deadline convergence, and Server External Execution Status; it stores no transcript, local Tool Result, confirmation, Workspace effect, or Overall Local Agent Turn Outcome;
- Before any A+ `/requests` POST, Coordinator's `persistRequestIntent` barrier waits for the existing Runner RecoveryWriter to durably save the current Server Turn binding, active request ID/sequence and exact Provider body. Observation alone is not durability; absent/failed storage prevents POST. Reload queries Journal first: an unseen initial request (created Turn) or unseen continuation (Journal still matches the previous `awaitingNextRequest` step) may use only the existing exact retry path and original identity/body. Observed execution stays query/redelivery-only under the existing policy. This adds no local authority over Journal, new retry mechanism, or schema/migration;
- every Provider settlement, with or without paid Tool Claims, crosses one server-only privileged RPC that revalidates the authenticated actor plus Turn/project binding; browser roles may acquire and read their own Turn but cannot declare Server External Execution Status;
- Compaction source/apply metadata is persisted before POST. Recovery replays the original Body and applies its Summary only to the original source IDs when their fingerprints and expected previous revision still match; appended tail messages survive, while source change or revision conflict fails without rebinding the old Summary to a new plan;
- Compaction concurrency freezes the raw current `summaryRevisionId` independently of usable previous Summary content. Planning, apply validation and domain apply share message/source eligibility: an existing unusable historical revision remains in history and is not sent as `previousSummary`; the next Summary covers the complete usable range. A dangling pointer fails closed. Fresh Recovery v2 boundaries add `usablePreviousSummarySourceHash` (digest of usable revision/source body, order and membership, or explicit `null` for no usable base); legacy boundaries remain readable without invented receipts. No Workspace schema or database migration is required;
- Provider Context Frames remain browser-local, untrusted product context. They are retained for continuity and editable backup, not signed or accepted as causal proof by the server;
- GrsAI image planning distinguishes `textToImage`, `imageToImage`, and prompt-level `directedEdit`. The current request has no mask/inpainting field, so `maskedLocalEdit` is unavailable and no pixel-level local-edit guarantee is exposed;
- editable backups default to full conversation scope and preserve canonical raw chat, summary revisions, memory/stage revisions, Continuity Events, Agent Trace, citations, Compare analyses, and image provenance; schema 1-16 backups are inspected and migrated through the legacy compatibility boundary before restore;
- `KeyConclusionObject.category` stores the five-value `KeyConclusionCategory` union (`finding`, `opportunity`, `constraint`, `openQuestion`, and recovery-only `unknown`), while new writes accept only the four-value `AssignableKeyConclusionCategory` subset. Manual, research-extraction, Compare, and Agent-confirmed writes must carry one of those four categories explicitly; an unclassified confirmation starts at `请选择类别` and cannot be confirmed. Recovered `unknown` conclusions remain visible as `待分类` and can be manually assigned one of the four categories from the detail surface. UI, search, task Context, provider summaries, project Memory, and human-readable bundles read the stored field directly. The old extraction-note markers are migration-only compatibility hints and are not runtime semantics;
- the generated current-case fixture is upgraded with `npm.cmd run case-study:upgrade`; repeated upgrades must produce the same workspace hash.

No new runtime dependency or external service was introduced for schema v17.

### P1B-2 projection ownership and consumer qualification (2026-10-01)

- New Definition/Direction semantic assertions require one explicit authorized owner object or
  owned current revision at the shared domain write boundary. Incidental sources remain evidence,
  not owner bindings; missing or conflicting owners are rejected with a correctable reason.
  Legacy unbound/ambiguous records retain their original sources and become review diagnostics
  (`scopeOwner:unbound` / `scopeOwner:ambiguous`), without inferring historical targets. Direction
  reads match owner objects/revisions, retaining explicit target precedence over incidental sources.

- `continuityAuthority.ts` owns source availability, semantic eligibility and scope queries below
  event writing and projection. It consumes P1B-1 Decision classification and source resolution;
  `currentDesignDefinition.ts` supplies the shared current-effective definition query below derived
  state and Memory;
  `projectMemory.ts` no longer imports the Continuity orchestration module.
- Domain derived-state completion and Continuity event/semantic mutations reconcile Memory and
  Stage before returning. The persistence setter remains a defensive adapter for raw/legacy callers.
- String sections remain readable and backward compatible. Optional `itemMetadata` retains each
  item's semantic identity, scope, sources, validity and specific eligibility/review reason. Current
  legacy projections rebuild from authority on normalization; historical revisions are not enriched
  with fabricated metadata. Workspace schema remains 18 and Memory schema remains 1.
- UI reads current projections with per-item source links and scope labels. Continuity Context,
  default Memory, Provider frames, explicit Memory/Stage Tool reads and the image compiler consume
  the same item scope/qualification. Scope filtering produces transient read views, including filtered
  source lists; it never overwrites durable revisions or changes frozen DeliveryReferences.
- Hidden current definitions clear the current Brief without falling back. Review records remain
  labeled Stage risk diagnostics, not default claims. Superseded/historical Decision events remain
  history. Empty Memory/Stage descriptors clear, preserving revisions; equivalent replay does not
  append, and restoring an equivalent cleared projection reuses its historical value.
- The earlier snapshot stop-loss recognized eagerly completed projections. P6H instead keeps
  current historical stores, checks touched immutable revision payloads, and completes qualified
  projections from the checked inverse; unrelated new history does not block a manual delta.

### P6H operation-owned Manual History (2026-10-03, accepted)

- History is session-local, project/readiness-scoped and bounded to 20 entries per stack. A
  successful explicit manual commit records only its actual field changes, keyed-record lifecycle,
  ID membership/order changes and identity/currentness guards. It stores no Workspace snapshot.
- Undo/Redo check all expected present-side values, object incarnation/type, CanvasInstance binding,
  Delivery/Branch owner identity, touched immutable revision payloads and semantic lifecycle
  evidence before applying anything. Single-primary/current-definition/default-reference collisions
  and current-schema validation also fail closed. A conflict leaves the entire Workspace and entry
  intact and shows a retained-history notice. Redo uses the same delta in the opposite direction.
- AI messages/results, Provider operations, assets, proposals, citations, historical revisions,
  Decisions and Continuity events come from the current Workspace. Inverses neither call Provider
  nor remove those independent stores. `manualHistoryMutation.ts` appends compensating identity-bound
  Decision effects using the existing P1B vocabulary, updates only the affected current revision
  flags and semantic user-action lifecycle, then reconciles qualified Memory/Stage projections.
- P6H review correction (2026-10-03): capture the deterministic occurrences appended by one
  manual commit, guard their non-derived payload/lifecycle, withdraw them on Undo and reactivate
  the same records on Redo. Retain occurrence identity/content and independent entries; inverse
  Direction compensation events also belong to that history entry and withdraw on the next flip.
  Use existing deterministic `manualState` only: P1B reserves lifecycleEvidence/supersession for
  semantic facts. Current Focus has a small before/after effect guarded by its value and matching
  original occurrence; later independent Focus relinquishes this entry's focus ownership without
  blocking entity Undo. Compensation events do not take Focus. Reconcile current Memory/Stage
  from the resulting authority instead of restoring historical projections or Continuity snapshots.
- Explicit user mutations are wired through the current functional commit boundary: imports/paste,
  Reader fragment creation, hide/restore/delete, project title, Canvas layout/layers/Region edits,
  Direction status, current Definition, reference/visual review and existing Branch organization,
  Research extraction/manual Conclusion creation/category, Continuity manual lifecycle, local
  Compare/confirmation writes and Delivery section/reference/editorial/gap/draft edits. Independent
  Agent/Proposal/runtime execution retains its existing commit ports and is not captured.
- Caption and note own separate fields even when editorial was initially absent. Keyed membership
  edits preserve independently added references. Object creation owns its logical object/instance
  and necessary Region membership, but not one-way Region activation. Renderer auto-grow may complete
  that entry's instance-size baseline only after an exact prior instance match with unchanged owned
  content; manual resize or independently changed content still conflicts. Geometry callbacks
  carry only actually changed fields/instances. Debounced renderer measurements cannot capture
  stale positions or split a manual pointer gesture; coordinate restoration projects back to the
  editor. A Region/member drag commits both geometry parts through one manual boundary.
- Viewport, reading/detail navigation and selection are not historical mutation fields; only invalid
  live selections are pruned when an inverse removes/hides their target. TopControls expose manual
  Undo/Redo availability; text inputs retain native edit shortcuts. No navigation UI redesign.
- Intentionally excluded: paid/external execution, Agent writes/confirmation, AI Proposal apply,
  asynchronous file parsing/recovery, assets/byte storage, conversation/runtime bookkeeping and
  project archive restore. A created/deleted whole record changed by such an independent writer may
  conservatively block; new dependencies or identity/currentness changes also block instead of merging.
  Reload/project change clears the stacks. Workspace schema 18, migrations and backup format remain
  unchanged. P4 visual lineage contracts are preserved. Final web review accepted P6H on 2026-10-03;
  combined P4/P6H validation and integration evidence are recorded in the Program Map.

### P6I Interaction Contract (2026-10-03, accepted)

- Actual floating roots declare `data-workspace-surface`; persistent input/detail surfaces declare
  `data-workspace-keyboard-owner`. Workspace shortcuts consume these DOM contracts rather than a
  second list of CSS class names. Escape resolves visible rendered stacking contexts and DOM order,
  dispatches to the existing surface close port, then focuses the remaining surface or Canvas.
  Editable controls keep native edits; destructive/select-all keys cannot reach background Canvas.
- `useWorkspaceSelectionNavigationController` remains the sole selection/navigation controller.
  Programmatic selection synchronizes React, Canvas requests and persisted UI selection; native
  Canvas selection only mirrors its object IDs. Object focus changes the camera without selecting.
  Locate preserves existing multi-selection; single-object navigation retains its existing selection
  behavior. Reader open/close preserves selection. Hidden search results explicitly restore through
  manual history before locating; unavailable detail targets disclose that they cannot be located.
- A Delivery chapter input target is transient and visible beside the composer, with explicit detach.
  Close, different Delivery/section, removed/hidden target, incompatible image purpose, suggestion or
  Reader entry clears ownership. Restoring a removed section cannot revive the old binding. Chapter
  intent comes from the live target rather than a persisted hidden input mode. P5 generation baselines,
  inspection, Draft applicability and the actual scoped preparation path are unchanged.
- Generic Proposal hide uses ordinary visibility-only hide/restore, including mixed selections.
  Explicit reject/discard and P2 authority/confirmation retain their existing domain commands.
  Research recommendation preselects candidates in the existing review panel; only explicit retain
  calls P1B Key Conclusion creation via P6H. Retain is additive and never hides prior retained items.
- Region drag moves the landmark only. Its toolbar can explicitly select the landmark and all visible
  members (including distant ones), reveal their bounds and move the native selection together.
  The title reports the actual selected member count. This narrow native-selection exception changes
  no Stage membership semantics; existing P6H geometry commit captures one combined drag.
- A UI attention token belongs to the existing project/selection session and is invalidated by user
  pointer, keyboard, wheel or focus interaction. Automatic select/focus/open is allowed only while
  that token is current and no closable surface owns attention, both at start and completion.
  Agent/visual/import UI ports preserve the live valid selection when ownership is lost, including
  domain-result UI selection projections. Results/assets/messages still commit normally. Nested visual
  work inherits the parent UI guard; submitted bodies, P3 execution/recovery and P4 lineage are unchanged.
- Bottom Detail has one controlled tab shared with Canvas. Default information draws no relationship
  lines; Source/Version/Related request direct existing edges, while explicit chain Trace consumes its
  existing historical data. Definition/Direction revision rows expand full immutable revision bodies
  through existing detail components. No new Trace store or history model.
- Ordinary text editing uses the existing prompt and P6H manual commit. The domain command checks
  active identity/incarnation and expected body, preserves object identity, and refuses stale edits.
  Collection collapse/member editing, ordinary instance lock/copy/group, drag-to-Delivery and complete
  reopen-reading-position continuity remain documented implementation gaps, deferred from this package.
  Workspace schema 18, migrations, Backup and Provider contracts are unchanged.

## Local-First Persistence

Project catalog and structured workspace JSON use localStorage:

- catalog key: `morpho.projects.catalog.v1`;
- workspace key: `morpho.project.${projectId}.workspace.v1`;
- legacy single-project key `morpho.workspace.nightrail.v1` is read only to detect and safely replace one pristine Nightrail demo.

Binary files are not stored in localStorage. Imported images/files and generated image results are saved as Blobs in IndexedDB:

- database: `morpho-assets-v1`;
- object store: `asset-blobs`;
- workspace objects reference assets by `assetId`;
- assets contain filename, MIME type, size, creation time, storage key, source type, and optional intrinsic image dimensions.

`usePersistentWorkspace` acquires the cross-tab project write lease before catalog initialization, workspace
migration/repair, or current-case-study asset seeding. A granted lease uses writer initialization and may persist those changes;
`heldElsewhere` uses read-only initialization that only parses and migrates in memory, including a deterministic
case-study fallback, and performs no shared localStorage or IndexedDB seed writes. Browsers without an enforceable
lease keep the existing `unsupported` compatibility path.

Project deletion implements previewed, ownership-checked cleanup of Blobs used exclusively by that project. Deleting a canvas object does not delete Blob data, and object-level or orphan-sweep garbage collection is not implemented. The prerequisites and fail-closed design are recorded in [`asset-gc-evaluation.md`](asset-gc-evaluation.md).

The deployable starter is `project-morpho-case-study`, generated from an editable backup. Its public case-study assets are hash-addressed under `public/case-study/current/assets/`; first use fetches, verifies, and writes them into the same IndexedDB BlobStore used by ordinary projects. The installer is idempotent and only removes the two known legacy Nightrail seed keys after a confirmed pristine replacement.

M9-A persistence hardening:

- `usePersistentWorkspace` no longer writes the full workspace and catalog on every React state change. It schedules writes through `workspacePersistence` with a 400 ms debounce and a 1200 ms max wait.
- Pending writes are synchronously flushed on pagehide, visibility-hidden, beforeunload, project switch, and workspace hook unmount.
- Loading and migration errors disable automatic writes, so a temporary blank workspace cannot overwrite existing local project data.
- `persistProjectWorkspaceAndSummary(...)` reports workspace-write and catalog-write failures separately. Catalog writes are skipped when workspace writes fail; catalog failures keep the already-written workspace and surface a catalog-stage error.
- Image preview object URLs are reconciled incrementally by `workspaceAssetUrlCache` using `assetId + storageKey`, avoiding full IndexedDB rereads and full URL revocation when unrelated workspace state changes.

## M7 Archive, Bundle, And Restore Layers

Morpho now implements the M7 contract in two layers.

Manifest layer:

- `createHumanReadableArchiveManifest(...)` builds a reading/handoff manifest and never pretends to be a restorable workspace dump.
- `createEditableProjectBackupManifest(...)` builds a portable backup manifest, records restore constraints, and blocks creation when restore-critical integrity checks already fail.
- `collectWorkspaceAssetInventory(...)` audits current workspace asset metadata plus known asset references across project cover, objects, document extracts, and delivery snapshots.
- `sanitizeWorkspaceForEditableBackup(...)` preserves edit-relevant structured project state while normalizing transient UI state, including resetting `workIntent` to `discussion`.
- Validation accepts `unknown` input and returns structured diagnostics suitable for future UI display.

Bundle and restore layer:

- runtime localStorage keys and IndexedDB `storageKey` values stay runtime-only and are excluded from portable manifests;
- `src/domain/morpho/projectBundles.ts` defines the `morpho-project-bundle` envelope, bundle file layout, package validation, and restore planning;
- `src/features/archive/projectBundleClient.ts` collects IndexedDB binaries, classifies asset availability, creates downloadable zip files with `fflate`, validates uploaded backups, and executes the local restore write path;
- human-readable archive carries delivery packages, stable delivery references, visual-route fields, research objects, readable source-index objects, and citation snapshots instead of only a raw object subset;
- human-readable archive bundle output includes Markdown reading files plus every currently readable local asset binary;
- editable backup bundle output includes only the files required for restore and is blocked when required binaries are missing or mismatched;
- restore writes every new binary before writing workspace/catalog state, removes newly written blobs on failure, creates a new project id and new runtime storage keys, and never merges into the source project;
- editable-backup inspection and restore planning share `validateCurrentMorphoWorkspace(...)`: current v17
  snapshots first canonicalize only the four retired Concept Direction proposal-lineage aliases, then are
  deep-validated before tolerant normalization; every other malformed current field still fails closed. Historical snapshots use the existing migration
  chain and then the same current validator, and a restore-stage revalidation runs before any Blob/localStorage
  write. Validation covers bounded structure, all Morpho object variants, finite canvas geometry, key/id and
  revision ownership, and critical live references while preserving stable delivery snapshots whose source was
  hidden or deleted;
- `src/features/workspace/components/ProjectBundlePanel.tsx` is a lightweight floating workspace panel that reuses the top `归档` entry instead of adding a separate archive page.

## M8 Delivery Output Packages

Morpho now implements a separate delivery output package for taking one prepared delivery package into external layout tools.

- `src/domain/morpho/deliveryOutput.ts` defines the independent `morpho-delivery-output` manifest with `outputVersion: "1"`, validation, diagnostics, selected-delivery-only asset candidates, and Markdown/source-map generation.
- `src/features/delivery-output/deliveryOutputClient.ts` performs browser-only IndexedDB Blob reads, classifies asset availability, writes the zip with `fflate`, and triggers download without writing workspace, catalog, localStorage, or BlobStore state.
- `src/features/workspace/components/DeliveryOutputPanel.tsx` is a lightweight floating output panel opened by the top `输出` button. It selects an active delivery object, runs preflight, shows section/reference/asset/gap/draft counts, and exports one zip.
- Output packages contain `output-manifest.json`, readable Markdown files, `source-map.json`, and only the `assets/` files required by the selected delivery references.
- Stable delivery snapshots are authoritative. Changed or missing source objects do not replace exported titles, summaries, captions, references, or assets.
- Pending section drafts and gaps are exported for review, but export never applies drafts, closes gaps, writes decisions, updates project memory, or changes delivery content.
- P5 Output manifest v1 adds optional reference inspection, section copy-review and pending Draft
  applicability; legacy output lacking them has unknown review/provenance. Diagnostics, UI summary,
  Markdown and source-map carry the same facts. Missing materials are counted by distinct asset ID,
  including references without Asset metadata (or by reference ID when no asset identity exists).
  Structural `ready` is exportability, never confirmed handoff quality. Archive elimination rationale
  comes only from the latest real identity-bound `setDirectionStatus` elimination effect, excluding
  P6H `decision-manual-history-*` compensation. The latest real elimination without a reliable reason
  remains unknown rather than inheriting an older reason; absent
  reliable effect/reason renders `未记录明确原因`.

Delivery output is not an archive or editable backup. It cannot restore a project, does not contain raw workspace JSON, does not use M7 `manifestVersion`/`bundleVersion`, and does not generate PPTX, PDF, Figma files, cloud shares, collaboration state, or final presentation layouts.

## Import, Search, Assets, Hidden

Implemented import paths:

- paste image to image object;
- paste text to editable text object;
- drag/drop files to image or file objects;
- drag/drop URL to link object;
- top import button to current viewport area.

Parseable imported files are extracted locally after import:

- Markdown and plain text are copied into bounded text extracts;
- text-layer PDFs are extracted with `pdfjs-dist`;
- PPTX slide text is extracted with `fflate`;
- unsupported or failed parses leave the original file object imported and marked with a parse error.

Import execution boundary:

- `workspaceImportExecution.ts` is the single semantic path for image/file, URL, text, batch, and
  mixed imports. `importResourcePolicy.ts` runs a whole-batch metadata and decoded-image preflight
  before the first Blob or Workspace write. The fixed ceilings are 32 files and 128 MiB raw bytes
  per batch; 64 MiB per PDF, image, or other file; 8 MiB per text file; 120,000 clipboard characters;
  40 million decoded pixels per image and 100 million per batch; 200 PDF pages parsed; and 120,000 extracted characters.
  These limits bound browser memory while retaining the existing local-first file workflow.
- File-count, raw-byte, invalid-image, and decoded-pixel violations reject the entire batch before
  persistence. Valid source files may still be imported when normal document parsing fails. PDF
  extraction processes pages and text items incrementally, records source/processed page counts,
  and marks capped output as partial instead of claiming a complete parse.
- Image dimensions decoded during preflight are reused by asset persistence. If a later Workspace
  commit fails, only Blob keys newly written by that import are deleted best-effort; this is import
  compensation, not a project-wide garbage collector. Successful source assets remain authoritative
  once their Workspace objects commit, even if later parsing fails.
- `useWorkspaceImportController.ts` owns browser services and the project/readiness session
  guard. Its functional workspace commit boundary checks both the session identity and the
  current workspace project before each mutation, including document parsing, extract-asset
  persistence, and parse-status updates.
- `WorkspaceClient.tsx` only wires entry-point events, canvas/viewport positions, and the existing
  selection port. It does not aggregate `AssetRecord`s, save Blobs, or orchestrate parse/extract
  continuation. If a stale physical Blob write occurs outside the guarded import execution, no project-wide
  garbage-collection semantics are inferred from that outcome.

Asset panel and search are real workspace queries:

- assets list imported images, files, links, generated images, and future document extracts;
- search covers object titles/text, filenames, URLs/domains, concept/research/definition text, document fragment bodies with their source file title/name, and delivery reference snapshots;
- a matched row carries a bounded snippet windowed around the match, not the full matching text. A document fragment row also carries its source file snapshot and a resolved `active` / `hidden` / `missing` source state, so source location is offered only when the source object is still active;
- hidden objects can be found and restored, but hidden objects are not included in default AI context.

`searchWorkspace` is a synchronous pure query over workspace JSON. Full `documentExtract` text is not part of workspace JSON — it lives only as an IndexedDB Blob, capped at 120,000 characters per file — so whole-document PDF/PPTX text is currently searchable only through the document reader's per-file search, not through project search.

## AI Providers

Text Agent:

- The formal workspace panel calls the canonical A+ Turn resources under `/api/ai/agent/turns`; Provider Requests stream Responses reasoning summaries, commentary, function calls, citations, usage, context pressure, and final text over typed SSE.
- `/api/ai/chat` is retained only for compatibility tests and has no formal-panel caller. Delivery section drafting, research, design definitions, directions, comparison, memory updates, and visual planning all use Agent tools or deterministic domain services.
- Context is one continuous project conversation. Selection, focus, direction, and branch affect strategy and provenance only; they never filter formal history.
- Below the prepare threshold, every uncompressed user/assistant message enters the request. After compaction, the current summary revision plus every complete message after its covered boundary enter the request. Raw messages are never deleted.
- The fixed Morpho policy is a 256,000-token window, 204,800 prepare threshold, 230,400 compact threshold, and 16,000 target uncompressed tail. Production does not read context-threshold environment variables; only the non-production localStorage override is available for low-threshold browser acceptance.
- A valid summary revision is applied atomically with source range, count, hash, previous revision, and boundary metadata. Failed summary validation leaves the prior boundary unchanged. A provider context-limit error may trigger one client summary/retry after the server's replay-safe tool-output retry.
- P3S stops ambiguous paid submissions for shared Text/Compaction and GrsAI adapters, including independent Chat/Image routes. GrsAI sends one generate POST on the primary host; network errors, 408/429/5xx, response loss, and observation expiry cannot resubmit on that host or a fallback host. Known-task GET polling and secure same-result downloads remain unchanged. Configured fallback hosts remain eligible result-download hosts, not automatic generation destinations.
- A+ Text, Compaction, and Image retain their administrative Journal statuses and bounded
  `failureCode: external_execution_state_unknown`; `externallyFailed` is not proof of Provider
  failure. P3A adds separate execution observations without reopening a terminal Turn or authorizing
  paid retry. Public unknown errors remain non-retryable; Compaction preserves raw chat and creates
  no fabricated summary. No result escrow, ACK, queue, worker, webhook or exactly-once guarantee is introduced.
- Provider continuation uses exact `function_call` / `function_call_output` items from the local Tool Batch. The server validates their bounded syntax and registered Tool names but deliberately does not attest local Tool truth or Workspace effects.
- Provider Requests and Search/Image/Compaction Actions use stable IDs plus server-computed Body hashes. Exact replays are idempotent; identity, hash, sequence, binding, limit, and terminal-state conflicts do not execute externally.
- When explicitly enabled for a compatible relay, Agent, independent Chat, and Compaction add an opaque server-generated Provider Prompt Cache Hint partitioned by authenticated user, local project where applicable, model, Prompt Contract, Tool Profile, and stable system prefix. The hint and optional supported retention are included in the exact external Request/Action Hash. They are performance routing hints only; disabled mode preserves the original request, cache miss never changes correctness, and a `400` retries once only when the diagnostic explicitly rejects an optional cache field actually sent, removing only optional cache fields and preserving stream mode. Generic unknown-field errors do not authorize another POST.
- Search, Image, and Compaction persist the exact Action descriptor and durable Body before POST. Ambiguous responses become query-only recovery against the same Journal identity; no recovery path allocates a replacement ID to repeat an external action.
- Image child Actions are serial. A restored descriptor is consumed only after its matching child has completed local handling, after which the next child writes and flushes its own descriptor before send.
- The client Lifecycle reducer alone derives `completed`, `partiallyCompleted`, `pendingConfirmation`, `cancelled`, or `failed` from Server status plus local Tool, confirmation, and persistence facts. The server never accepts or stores that Overall Local Agent Turn Outcome.
- Context pressure is classified from both tokens and Provider Item count. A continuation can perform at most two additional compactions, and only a strict token or Item reduction permits another Provider request; the server and client both fail closed above 1,024 Items. Provider and local tool-batch handling share `MAX_AGENT_FUNCTION_CALLS = 64`; a 65-call response is rejected before execution or continuation signing.
- Explicit history, memory, and progress questions declare required `search_project_conversation`, `read_project_memory`, and/or `read_stage_record` reads in the Task Contract. P2B evaluates exact target/key/query/range receipts in the production Runner, permits a reminder within existing legal continuations, and reports terminal missing coverage as unverified without another paid request.
- New turns resolve a turn-local Task Contract with a primary strategy and independent activities. The primary strategy is a compatibility/display hint; it does not cancel activities or own their effect scopes. The versioned Prompt Registry composes all activity policies and the bounded Method selection.
- The stable System prefix carries a compact design-partner persona (respect existing work, maturity-adapted depth, evidence vs inference, real design variables, visual output as a design tool, user decision authority) under Prompt Contract `morpho-agent-v3.8-2026-10-01`.
- Task strategy policy is delivered as a server-owned canonical System item: the client sends `strategy` + `strategyAnchorMessageId`; the server validates the kind and materializes the canonical strategy message after the Runtime item. The comparison policy states the chat-only default: a persisted Compare record requires an explicit save intent.
- `capabilityIntent.webSearch` (current-turn user authority) survives every A+ request copy path (Coordinator copy, active-request restore, recovery export/restore, exact retry, continuation); recovery shape validation is fail-closed on the optional bit. The server still requires global web-search enabled AND current-turn user authority before exposing `search_web_evidence`.
- Design Method Packs (`src/shared/designMethodPack.ts`) are a lightweight runtime-owned professional method layer: the client resolves 0–3 pack ids deterministically from strategy and draft; the server validates the ids against the fixed registry and materializes the pack text as a second trusted System item. Packs (research synthesis, design definition, concept divergence/refinement, critique, reference interpretation, form/CMF/scenario development, comparison, delivery narrative) are short judgment principles, never process gates; ordinary discussion gets none.
- `submit_memory_update` accepts only locally validated candidates backed by an exact quote from the persisted current user message. Deterministic projections remain authoritative; AI suggestions and one-off generation requests do not become user preferences. Admission is clause-first and declaration-based: clauses addressing only this turn's concrete image/object/version (e.g. "这张图不要高反光", "这张图统一一下配色") are rejected as one-off unless an explicit project/long-term scope or a quantitative constraint SUBJECT overrides them; a long-term scope word alone is not a declaration ("后续怎么做？"), questions and threshold inquiries ("这个材质怎么样？", "高度低于多少合适？") and temporary instructions ("先别用蓝色") never produce a candidate, preference requires an explicit stance (我喜欢/默认用/以后都用/统一采用…), constraint requires normative syntax (必须/不超过/上限/控制在…), and structured-state commands ("默认参考改成这张") are handled by real workspace state, not memory. When candidates exist, the initial Provider input carries ONE transient runtime-control reminder (never persisted to the conversation) requiring `submit_memory_update` with verbatim evidence or `items: []` + non-empty `skippedReason` before the turn ends; the armed flag lives in Recovery facts so refresh/retry never re-arms or regenerates it.
- Citation snapshots come only from provider citation/annotation fields or local web-search results. A shared pure navigation policy accepts only credential-free public HTTP(S) destinations, derives display identity from the normalized URL, and rejects local/private/link-local/loopback addresses without DNS or network probes. Citation and Markdown renderers reapply the same policy so unsafe legacy snapshots remain inert. Morpho never fabricates citations from assistant prose.

Image generation:

- The Agent sends structured visual intent, not a final provider prompt. `ImagePromptCompiler` combines current user input, Design Brief, direction revision, user preferences, role/task template, preservation/change boundaries, and a model adapter. Compilation asserts design intent over rendering decoration and grounds scenario roles in scale, action, and human-product relationships.
- References are resolved deterministically within P2A scope: the task's identity parent and required role bindings precede optional explicit/selected references, branch roots, representatives, defaults and project references. Ancestor reference arrays never determine a parent. P4 records roles, exclusions and count/byte/pixel omissions separately from ownership.
- `1 / 2 / 4 / 6` remain UI shortcuts only. Explicit positive counts such as 3, 5, 9, or 12 and more than three directions are accepted; the Agent must produce one complete plan and execution may use bounded concurrency.
- The browser submits Image only after local intent compilation, plan validation and required-pixel materialization. Each success creates a new image object and persists frozen lineage, actual input provenance, structured intent, the actual compiled prompt/edit mode, model settings, operation/provider IDs and separate version/reference relations. A+ and confirmed independent Image retain P3 execution/delivery/recovery boundaries.
- Image progress updates the same Agent Process tool activity. Partial failures and cancellation preserve every completed image and never overwrite a source image.

AI authority boundary:

- AI reads through explicit tools and writes only through locally validated tools and domain operations.
- Current-user text and trusted send-time UI inputs produce a runtime-only Turn Task Contract before Provider output exists. Its grants derive the local Tool authority profile and Provider-visible tools through the same shared functions. Imported/local documents, object summaries, historical conversation, memory, Provider evidence, Tool arguments, Method Packs, and model commentary cannot expand those grants.
- A+ filters the shared Tool Registry to the contract allowlist, including bounded confirmation actions. An authorized Search with disabled server capability fails explicitly before Provider submission instead of creating a different executable tool set. Independent Chat retains its current-user/UI search classifier. A document cannot enable networking by asking for it inside its content.
- New Tool effects are checked against the profile before Tool activity, recovery intent, external action, confirmation, workspace persistence, or execution. A mismatch returns stable `agent_tool_not_authorized` and stops new effects. Contract-less Recovery separately observes/resumes an exact persisted external action as a prior execution fact; it does not grant a new Tool effect.

Current F06 authority layering:

P2A Turn Task ownership (2026-10-01; accepted implementation `02655e829a72aea7bd555917de9fa89519818bfd`):

- `shared/turnTaskContract.ts` owns the bounded DTO, parser, common tool/confirmation projections;
  `turnTaskResolver.ts` mints activities and effect grants solely from current-user instruction and
  trusted UI input. `taskMode` / `workIntent` remain UI inputs, not exclusive activity routers.
- Activities retain instruction, targets, direct sources, permitted visual references, exclusions,
  required facts, expected outputs/count and independent grants. Named selected targets and ordinal
  selection references bind deterministic visual scope; unresolved restrictive targets close the
  effect tools and leave read/discussion available. Simple chat/critique/read needs one activity and
  four read tools, no planner or paid/write permissions.
  Visual target/source/reference/exclusion/default intent uses the visual activity's owned clauses;
  comparison, critique and research qualifiers cannot supply visual scope.
- `buildTurnTaskContexts` reuses P1B queries and qualifications for each activity. The aggregate is
  read/discussion context; Tool executors and pending confirmations consume their own activity
  context. Visual compilation bounds every explicit/implicit reference to the frozen permitted set,
  recording `taskScopeExcluded`, and uses the visual instruction rather than the comparison draft.
- `shared/agentToolContract.ts` owns the existing tool DTO/schema/effect registry;
  `shared/agentPromptRegistry.ts` owns stable policy/version. Feature re-exports preserve callers;
  the Server no longer imports workspace feature code for these contracts. Methods consume activity
  kinds/instructions and retain the existing maximum of three packs; they never create grants.
- The request carries the frozen Task Contract through Coordinator copies, continuations and
  Recovery. The Server validates it and renders registry-owned Strategy/Method text, but does not
  authenticate client-owned local facts or grant provenance. Local argument, domain, persistence,
  paid/confirmation and session gates remain required. Contract-less legacy requests/recovery use
  only the common read tool set; no historical effect scopes are reconstructed into new authority.
  Legacy Recovery does not reclassify its draft or current Workspace as a historical task contract.
  A matching persisted web/image action may replay its exact identity/body/hash without minting
  grants. Image recovery reuses the saved Operation Plan and refuses unrecorded children, even
  after recovering a recorded child. An unsupported old Prompt Contract can finish observation
  and result recovery, but ends with an explicit compatibility notice before any new Provider
  request/continuation; its version/input are never silently rewritten.
- P2A adds no Workspace/Journal schema, runtime, workflow or persistent task database. Required-read
  fulfillment, final input coverage, document/Delivery deep reads, history trimming/compaction
  rebuild, new-image observation, concept revise/split/merge execution and final task fulfillment
  remain P2B. Reference roles/lineage and Delivery/History changes remain with P4/P5/P6H.

- Composer text and selected objects feed `recommendedTaskMode` / `recommendedWorkIntent` only. At
  send time, `taskMode` / `workIntent` resolve to `executionTaskMode` / `executionWorkIntent`, with
  runtime-only `executionModeSource` provenance (`userSelected` or `autoRecommended`). The frozen
  `AgentToolAuthorityProfile` is the only effect decision presented to Provider Tool execution.
- Auto mutation routing requires a positive mutation verb; topic-only prompts such as “解释当前
  设计定义” and “基于现有概念方向总结” stay discussion/read-only. Local reversible proposals
  may use the resulting structured execution intent, while external Search, paid Image, Memory,
  and high-impact confirmation keep their independent deterministic grants.
- Web Search is not implied by `researchOperation` when it was auto-recommended. It requires either
  a manual Research selection or a clear current-user network cue. Paid Image requires the
  send-time user-selected image task; Memory and confirmation retain their existing required-update
  and action-allowlist gates. Ambiguous same-turn requests fail closed.
- Applied design definitions, direction status, default reference, important delivery decisions, and other high-impact actions keep their existing confirmation/authorization boundaries.
- Project Memory contains source-driven current projections and revision history; it is not a second fact source and is not exposed as user-managed files.
- Delivery section generation creates a pending draft from frozen section references. Applying that draft remains the explicit write boundary for narrative, captions, gaps, decisions, and continuity events.


### P2B input, bounded reads and structural fulfillment (2026-10-01)

- Keep the accepted P2A Task Contract and one A+ Runner. New contracts opt into additive
  `readContractVersion: 1`; absence preserves the P2A Provider tool names, descriptions and schemas.
  Workspace schema stays 18 and Recovery stays v2. Optional snapshot `coverage`, Recovery receipts,
  pending read IDs/step sequence, observation payloads and assistant `taskFulfillment` normalize
  idempotently. Legacy coverage and fulfillment remain absent/unknown; nothing reconstructs old
  reads, grants or outcomes from current Workspace state.
- Preparation serializes scoped task context into the actual request and stores its text in the
  immutable ProviderInputSnapshot. Coverage records object/incarnation/revision, P1B semantic
  fingerprint, actual content hash, text representation and UTF-16 half-open ranges. Summaries,
  partial extracts, unavailable sources and pixels remain different. Document extraction preserves
  stored offsets and records available text length independently of parser-reported length.
  The old combined-message last-96 cut is removed. The current turn, latest Project/Runtime frames
  and current Summary frame are retained, with old frame omissions disclosed; eligible uncompressed
  history remains intact within existing server item/token limits.
- `read_workspace_source` reads scoped current objects or owned revisions, document extract ranges,
  the authorized Delivery chapter, or one image through the existing attachment packer. Text reads
  are at most 8,000 characters and report the remaining range. `read_selected_context` explicitly
  remains a preparation summary snapshot. Source/currentness queries stay with P1B; there is no
  parallel project read database.
- Required-read checks use real serialized receipts, not Tool-name counts. Recovery binds pending
  receipt IDs to the next request sequence; the Runner marks them delivered only after matching
  Provider output is observed. Range unions require the same identity/revision/content. Exact keys,
  query mode/keyword and explicit revision targets are checked. A complete initial revision can
  satisfy its requirement without a redundant Tool call. Failed, missing, stale, partial or
  unavailable material does not become complete coverage. A bounded reminder uses an already legal
  Tool continuation; zero-Tool terminal responses never start an extra paid repair.
- New continuations retain Tool results and refresh scoped Workspace context without changing grants
  or frozen domain baselines. Successful compaction rebuilds the next request from the new Summary
  and uncovered conversation tail. Submitted Coordinator requests and exact legacy in-flight actions
  retain their original body/identity; refresh is query/replay of that request, not reconstruction.
- Concept create/revise/split/merge call the existing domain proposal application. A revision binds
  the original object/current revision; split/merge bind the complete authorized parent set and
  original revisions. Confirmation uses the same operation arguments and checks the revision before
  apply. Domain validation determines the result; a blocked proposal is not a completed revision.
- Delivery preparation sends the actual section and allowed stable reference snapshots, with bounded
  coverage and subsequent section reads. Draft validation stays bound to that target. This adds no
  stale-draft/apply-baseline, reference-refresh or handoff semantics.
- Explicit generate-then-compare/critique tasks can read newly created image pixels. Each fresh
  continuation rematerializes only scoped source/reference pixels needed by pending generation or
  later activities, together with authorized observations. Original sources retain request order
  and take precedence over observation read order. Shared Provider bounds cover the whole request:
  at most four image parts, 2 MiB decoded per image and 2.5 MiB decoded total (P3B ingress also caps the serialized request at 4 MiB). Images that do not fit are omitted;
  indivisible contact sheets containing unrelated members are omitted rather than leaking them.
  Request-local coverage records `requestImageStatus`, `requestStepSequence` and omission reason.
  Omitted coverage projects to unavailable metadata; historical `delivered` remains historical and
  cannot satisfy current pixel obligations. Compaction preserves the materialized visual messages;
  active Recovery bodies remain frozen. Observation adds no paid authority, Compare write, adoption or engineering
  validation. Ordinary generation adds no observation obligation, and completing the authorized
  image count prevents a second batch being submitted as an observation follow-up.
- `agentTaskFulfillment.ts` evaluates explicit read obligations and actual effect receipts against
  Workspace results: saved image object/asset counts, correct Concept revision/lineage and Delivery
  target drafts. It persists `fulfilled / partial / blocked / awaitingUser / notPerformed / unknown`
  separately from Provider/Runtime outcome. Provider prose does not certify a Workspace write;
  unfinished structural obligations produce an honest final notice and keep successful effects.
  Comparison/critique with omitted scoped source pixels cannot report that visual obligation fulfilled.
  The evaluator does not grade design quality or decide user-owned project state.

Validation and package acceptance live in the Program Map. P3A/P3B execution observation and result
escrow, P4 full visual identity/provenance, P5 Delivery applicability/handoff and P6 UI/history remain
outside this implementation.

## Built-In Case Study

The deployable built-in project is `project-morpho-case-study`, generated from the current real editable backup. It preserves the backup's canvas, relations, assets, messages, Agent traces, citations, project continuity, and incomplete state. The old Nightrail structure remains only as a test fixture and as a guarded one-time migration fingerprint.

## P3A Effect Identity / Execution Observation (2026-10-01; accepted implementation `ccf4561c8c422d3b5a01c8146e63287023ab6a79`)

`externalEffectJournal.ts`, `externalEffectObservation.ts` and `externalEffectProtocol.ts` add a
version-1 execution contract alongside the existing Turn/Request/External Action journals.
`20261001090000_add_external_effect_observation.sql` creates private effect, attempt and observation
tables and one service-role-only `operate_external_effect` RPC. Existing Journal SQL/rows, Workspace
schema 18 and Recovery v2 are unchanged; no historical identity is invented or cleanup rerun.

- Logical effect identity is deterministic within the authenticated owner: A+ Turn/project/kind/
  Request sequence or Action ID; independent confirmed Image uses its persisted `clientRequestId`;
  independent Chat uses `X-Morpho-Effect-Key`. A fresh independent paid request without a stable key
  is rejected. This Morpho identity is not a Provider idempotency key.
  Fresh independent Image registration also requires `X-Morpho-Effect-Contract: 1`; a legacy
  independent request with a stable ID but no registry/contract marker stays unknown and cannot
  be mistaken for a never-executed new effect. Known registry identities remain queryable.
- The logical effect freezes the first exact Provider JSON request and SHA-256 digest, without
  Authorization headers. Each actual POST attempt has its own UUID and exact body/digest. Namespace
  records Provider family, exact base URL and a one-way credential configuration fingerprint. It
  asserts neither account equivalence nor shared cross-node task scope. Model/config changes never
  redirect known tasks or rebuild recovery requests.
- Effect registration and attempt acquisition precede POST. An existing effect never grants an
  ambiguous resubmission. Only P3S's verified cache/image compatibility rejection can admit a bounded
  correction attempt; the logical frozen request remains unchanged. No transient retry/fallback is restored.
- Adapters durably record task/response IDs as soon as observed, before further polling/download or
  stream reads. `unknown`, `running`, `succeeded`, `failed`, `cancelled` are Provider facts, independent
  of administrative closure/local outcome. Admission, task identity alone, transport loss, query 404,
  deadlines and local abort are not running/failure/cancellation evidence. Known running survives
  query errors. Confirmed terminals resist unknown/stale running observations; late success is
  admissible after failure/cancel and success cannot be downgraded.
- Cancel intent and local abort observation have separate durable timestamps. Pre-registration
  cancellation creates a tombstone that blocks submit; cancellation checks before submit remain
  subject to the ordinary check/send race. Post-submit abort does not prove Provider cancellation,
  refund or non-execution. Only a trusted Provider cancellation observation sets `cancelled`.
  A+ Text cancel validates the latest request ID/step sequence, then reads that exact effect.
  An existing `unknown`/`running` effect accepts durable intent even after administrative Turn
  closure; the Turn is never reopened. Confirmed Provider terminals and legacy terminal Turns
  without an effect remain read-only. Local abort follows successful persistence and affects
  only a matching execution still present in the current server instance.
- Authenticated `/api/ai/effects/[effectId]?kind=...` GET reads/observes and can retrieve a known Image
  task's same result via `result=image`; POST records only cancel intent. Browser roles cannot call
  the observation RPC or mutate tables. Routes derive the actor from verified authentication.
  GrsAI observation uses one bounded GET on the exact namespace, never generate or fallback.
- A+ Image same-Action replay and independent Image same-key replay read the execution registry
  before current request/config/hash rebuilding or new quota/admission. Known tasks resume GET and
  secure download; unknown without a task stays unknown. Image Recovery retains the optional
  snapshot and frozen body; existing client-request/object dedupe prevents duplicate local effects.
  Turn query retains optional text observations without fabricating missing output or Tool payload.
- Legacy replay without registry identity follows the old Journal query/replay boundary. It does
  not register/reexecute a historical effect. Missing migration or privileged configuration fails
  new submissions closed; old read-only Turn query remains available. New registry records are not
  coupled to legacy Turn cleanup, so observation does not depend on reopening a terminal Turn.

Provider capability evidence: repository GrsAI task GET and secure retrieval code plus the public
[task-query documentation](https://qmy27nhsd9.apifox.cn/452409577e0) verified on 2026-10-01. Generate
page retrieval timed out; existing `replyType=json` is retained. Stable idempotency, client-key lookup,
cross-node/account equivalence, retention and reliable cancel are **not guaranteed**. AiJWS exposes
observed response IDs, but this implementation does not assume OpenAI's GET/retrieve/cancel capabilities
apply to the relay. Credential rotation or namespace mismatch blocks observation instead of guessing.

At the accepted P3A boundary, no generated Text/Compaction payload, image bytes or result URL was escrowed. P3B below supersedes that delivery limitation. Same-task retrieval
still depends on Provider availability; without usable Provider identity/result the result remains
unavailable. Late success records facts and does not auto-continue a cancelled Turn, promote project
state or create a new paid operation. P3B result escrow/redelivery store/retention/hosting/local ACK,
P4/P5 and P2 Task/Fulfillment redesign remain outside this package. No production Journal migration,
paid Provider call, billing verification or real multi-instance hosting test was performed.

## P3B Result Delivery / Hosting Contract (2026-10-02; validating)

P3B uses the existing privileged Supabase PostgreSQL service.
`20261001154434_add_external_result_delivery.sql` adds RLS-enabled, browser-revoked
`external_result` and `external_result_chunk` tables plus the service-role-only
`operate_external_result` and `cleanup_external_result_payloads` RPCs. No new service,
Workspace schema version, scheduler, cloud Workspace, Provider guarantee or Project Truth authority.

- An effect owns one immutable result version 1: actor-scoped result ID, effect/kind, SHA-256 of
  exact complete bytes, byte length, MIME, chunk count and fixed expiry. Prepare/write/publish are
  restartable only with identical metadata/chunks. PostgreSQL checks complete bytes and SHA-256
  before publication. Pending/incomplete results are never reported as available. Complete staged
  chunks can be republished with their stored Journal binding after a lost settlement response.
- Text escrows the final normalized Provider output and Tool calls; stream activity remains
  transient. Publication and original Request settlement/Tool claims share a database transaction.
  The final SSE carries a small resultAvailable manifest; the transport downloads/verifies chunks
  before delivering providerOutput. Turn queries restore missing envelopes before local execution.
  A+ Text POST replay checks the original client Provider-request content SHA-256 in the immutable
  result JSONB binding before returning or republishing escrow. This proof is independent of current
  Provider config/model/cache: exact content redelivers without admission, changed content returns
  `409 request_id_conflict`. Missing legacy proof fails closed with
  `503 request_content_identity_unavailable`; existing same-effect GET retrieval remains available.
  No result/effect identity, SQL/Journal schema, retention, ACK or paid retry contract changes.
- Image escrows securely downloaded original Provider bytes, not expiring remote URLs. New A+ and
  independent Image responses return manifests. Recovery can retrieve a known GrsAI task into
  escrow using GET only. Result reads precede current config/quota/admission. Expired escrow cannot
  be resurrected or replaced by another image under the same identity. Incomplete, unexpired Image
  staging may retrieve the same trusted Provider task through P3A GET-only observation. Retrieved
  bytes must match the entire original manifest; recovery writes without prepare/rebinding and
  publishes using the stored Journal binding. Conflicting chunks fail closed. Delivery pending
  retains the A+ Action across reload; it is separate from generation failure.
- Compaction escrows a validated Summary and original source digest/endpoints/previous revision;
  original frozen local source/apply checks remain authoritative. Existing identical revisions
  survive crashes between Workspace and Recovery writes. Save failures preserve a pending same-
  result action; they do not start another paid compaction. Edited source/base still blocks apply.
- Administrative terminal absorption is unchanged. Late result publication never reopens a Turn
  or grants new Tool claims after closure. A failed administrative Text request with observed
  Provider success can deliver its saved text without executing its Tool batch. Cancellation
  continues to suppress automatic new effects; Provider execution and local outcome stay distinct.
- Authenticated `/api/ai/effects/[effectId]/result?kind=...` GET returns a manifest; chunk GETs
  return at most 512 KiB. POST accepts only exact resultId/version/hash ACK fields. Routes derive
  the actor from verified authentication; no browser table/RPC writes or public asset URLs.
  ACK is a client persistence claim, not server proof of Project Truth, task fulfillment or billing.
- ACK follows verified local persistence: Text's complete envelope/Tool payload in SHA-verified
  IndexedDB Recovery plus conversation Workspace flush; Image Blob transaction plus object/asset
  Workspace flush; Compaction revision plus Workspace flush. HTTP/read/UI success never ACKs.
  A small durable local ACK outbox retries only the same ACK after loss/reload. Image generation
  metadata keeps an optional transport receipt for crash dedupe; old images remain receipt-less.
- Confirmed independent Image writes an exact IndexedDB intent and original local commit draft
  before POST. Reload makes one bounded result GET per pending identity and saves that same result;
  it does not resend Provider input or invent a new operation. Cancelled operations do not auto-apply
  late results. IndexedDB intent bytes expire/clean up on the next project access within a 24h policy.

Capacity contract (UTF-8 bytes, all individual field limits also subject to the serialized cap):

| Boundary | Limit |
| --- | --- |
| AI HTTP ingress (A+ Request/Image/Compaction, independent Image/Chat) | 4 MiB |
| Exact materialized Provider frozen body, including server prompt/JSON escaping | 8 MiB before POST |
| New local external-action descriptor / Recovery runtime and individually referenced payload | 4 MiB / existing 32 MiB per blob (not a whole-record aggregate cap); metadata 2 MiB |
| Independent Image local write-ahead intent | 8 MiB including escaped input/commit draft; at most 32 pending intents per project, 24h |
| Image input (A+ and independent) | 2 MiB decoded each, 2.5 MiB decoded total |
| Escrow Image / JSON result | 16 MiB / 8 MiB; Text also honors existing 240,000 output characters and bounded Tool calls |
| Result DB/write/delivery chunk | 512 KiB raw (bounded base64 RPC encoding) |
| Per owner raw input / escrow including pre-submit reservations | 64 MiB / 128 MiB |
| Invocation declaration / Provider safety budget / escrow write budget | 300s / 240s / 45s; RPC transport has a 10s timeout |

Result capacity is reserved on new effect registration under a per-owner database lock before paid
submission, then replaced with actual result size. Exhaustion fails closed. New clients preflight
serialized input before Fetch; old large already-persisted Image/Compaction descriptors can query
their original result by GET without retransmitting their body. Recovery's 32 MiB per-blob limit
supports the accumulated runtime and existing legacy payloads; it does not increase the 4 MiB
sendable HTTP contract. Escrow JSON is capped at 8 MiB before its local Recovery wrapper. Legacy exact Recovery bytes remain
readable; no historical identity/result is backfilled.

First raw input is stored once on the logical effect; the ordinary attempt references it through
parent identity/digest, while verified compatibility corrections keep their changed exact body.
Raw input expires 24h after initial effect creation; result expires 24h after prepare. Reads/ACK do
not extend either clock. Cleanup erases expired raw/chunks/binding; compact identity/digest/namespace/
observation/result-manifest/ACK tombstones remain to prevent paid resubmission. Lazy owner cleanup
is supplemented by a 15-minute pg_cron job only when pg_cron is already enabled. Otherwise rollout
must configure an external invocation of the service-only maintenance RPC. Offline local intent
cleanup runs on project access. Access expiry is enforced independently of physical cleanup.

Current code declares a conservative Vercel Fluid 300s contract and keeps ingress/chunk responses
below the documented 4.5 MB function payload ceiling. The production plan, Fluid configuration,
database migration/grants, cleanup scheduling, real DB concurrency and Provider/hosting retention
are unverified. Process termination before full escrow publication can still lose Text/Compaction
not retrievable from the relay; incomplete escrow is explicitly unavailable. No exactly-once paid
execution, durable background completion, P2 fulfillment or long-term cloud assets are promised.

## P4 Visual Lineage / Reference / Observation (2026-10-03; accepted)

Execution baseline is `41666d2e678d78fb3d4b561e74dbca0836bb92f5`. The Program Map owns acceptance.
Workspace schema remains 18; the new optional contracts carry their own `version: 1`. There is no
DB migration, second Truth authority, task scheduler, read-coverage ledger or Provider runtime.

- Visual Intent separates `identityParentObjectId` from `referenceBindings` (structure, CMF,
  environment, composition, style or unspecified, with a required flag) and
  `excludedReferenceObjectIds`. These are task-local roles, not permanent ImageRole changes.
  An explicit null requests new identity. An omitted parent can resolve only from the sole image
  in the current task source set; multiple sources require an explicit parent/null. Defaults,
  reference ordering/count, representatives and a source's old references never resolve a parent.
- `VisualLineageSnapshot` freezes parent object/incarnation/asset/title, Direction identity/title,
  Branch ID/label/root and each ownership origin. Direction is an explicit task target or the
  parent's Direction. Branch is an explicit compatible task branch or the parent's same-direction
  available branch. Auxiliary references cannot establish ownership. Branch creation still uses
  existing explicit domain/UI authority. Archiving during generation does not change the frozen
  result's membership; deletion detaches live membership while retaining historical generation facts.
- P2A remains the scope/grant owner. An explicit reference/borrow/reuse verb bound to an image,
  or use-as-reference instruction, may add that auxiliary input without expanding a narrowed
  source/target set. Attribute descriptions and comparison-only mentions grant no reference
  authority. Positive and negative predicates share object matching and full clause boundaries;
  exclusion wins for the same object without suppressing another object's reference. The
  compiler (`morpho-image-prompt-v4`) binds each image position to its role and preserves the owning
  activity instruction when recompiling after an optional omission.
- The existing Image asset-reader boundary materializes references once. Parent and required
  inputs have priority; missing/unreadable pixels, exclusion or count/byte limits block a required
  input before submission. Optional omissions retain specific reasons. The prompt, edit mode and
  actual `referenceObjectIds` are rebuilt from readable pixels, so zero pixels means text-to-image.
- Planned Operation `plan` stays separate from per-item `materializedItems` and result
  `generation.providerInputs`. The latter freezes each candidate's source/role/requirement,
  sent/omitted state, omission reason, payload index and the existing P2B image-representation hash.
  Here sent identifies the pixels in the exact serialized payload; a pre-submit manifest alone
  proves no Provider execution. P3 execution observations and delivery receipts remain separate.
  The raw Image body carries lineage/input facts into exact Recovery. Recovery compares payload
  IDs/hashes with the frozen manifest and commits original prompt/model/aspect/size settings;
  it never rereads today's source pixels or changes the original action/body. Restored results
  remain retrievable if the current Direction/Branch was removed or archived.
- Successful commit emits exactly one parent version relation regardless of reference count,
  and reference relations for actual inputs. Derived-state reconciliation preserves this new
  evidence-backed version. Default-reference review uses the new identity parent, so borrowing
  an auxiliary image does not turn the result into that image's direct derivative.
- New generation Trace consumes frozen parent and actual auxiliary snapshots. Direction/Branch
  edges explain membership and do not traverse today's Direction revision or Branch root as a
  generation cause. Missing/reused historical identities remain frozen edges; a legacy ancestor
  without frozen lineage is not expanded into current Workspace facts. Legacy stored relations
  remain recorded history, with unknown identity/role/pixel interpretation, not repaired parents.
  Canvas primary edges and Trace use the same parent contract; auxiliary inputs stay secondary,
  including the first reference of an explicit new identity. Historical canvas chains stop before
  a legacy ancestor instead of promoting its current Direction or first reference to a cause.
- P2B still owns image reads, request materialization, required reads and fulfillment. Only its
  exact observed request's delivered, matching full pixels/contact-sheet receipt appends a result
  observation link (receipt, object/incarnation/asset, hash, representation, request and step).
  Read preparation, omitted/metadata-only pixels and Image success cannot create this link.
  It means pixels were supplied to the Agent, not visual quality or engineering validity.
  Generate-only gains no critique, compare, read obligation or regeneration. Existing explicit
  generate-then-review consumes real P2B observation and retains the authorized generation count.
- Current validation checks frozen contracts, actual ID/order/edit-mode consistency, required
  pixels and observation identity. Normalization/reload, JSON and Editable Backup preserve them
  without historical backfill. Legacy fields stay absent/unknown; no parent/role/observation is
  synthesized from current defaults or ownership. Image details distinguish the intended purpose,
  identity parent, auxiliary roles/omissions, generation-time ownership and observation state.

Local mocked unit/browser validation establishes these deterministic contracts. Real paid image
quality, Provider interpretation of roles, production Journal/hosting and billing are unverified;
P4 does not change the accepted P3 rollout limits or start P5/P6 work.
