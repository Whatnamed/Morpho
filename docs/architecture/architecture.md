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
  and detail-location undo into `useWorkspaceSelectionNavigationController.ts`. Manual object
  Snapshot History and the Ctrl/Cmd undo/redo boundary live in the generic
  `useWorkspaceObjectHistoryController.ts`; it delegates page-specific snapshot capture and
  restoration back to `WorkspaceClient.tsx`, while preserving detail-navigation priority and AI
  content protection. Both controllers clear transient history across project/readiness changes,
  and keep same-project ready updates intact. `WorkspaceClient.tsx` remains responsible for
  canvas Trace, surface coordination, domain mutations, AI state, confirmations, and component
  composition. No visible UI, schema, persistence format, or domain contract changed.
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
  initiating project and invalidated on cancel or lifecycle transition. IndexedDB writes cannot
  be physically cancelled by this boundary, so a stale completed blob may remain orphaned;
  object-level Blob garbage collection is intentionally outside this phase.
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
  pending confirmation, and a successful confirmation creates exactly one undo snapshot before
  applying the existing domain action. Compare elimination no longer uses the comparison-specific
  text prompt; ordinary canvas elimination remains on its existing prompt path. No schema,
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
- Supabase stores no project content. Projects, canvases, files, images, and backups stay in browser localStorage and IndexedDB.
- Vercel is the current production deployment path (`npm run build`). Cloudflare Workers via `@opennextjs/cloudflare` and `wrangler` is a retained opt-in backup path behind the `cf:*` scripts.
- `.github/workflows/quality.yml` runs lint, typecheck, test, and build on `main` and pull requests, without provider keys or deployment.
- Export exists as delivery output packages and archive/backup bundles (see the M7 and M8 sections). Project deletion can explicitly reclaim previewed, provably exclusive Blobs; cloud project sync, cloud file storage, multiplayer sync, and object-level or automatic Blob garbage collection remain unimplemented.

## Data Model

Structured workspace data is schema version `17`.

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
project-wide summary only when no valid current summary exists. An already-current schema-17
workspace only strips retired fields and never interprets them. It also drops old
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
- Responses is the only Agent protocol for all configured OpenAI-compatible endpoints, including AiJWS. Transient stream and gateway failures retry `/responses`; a streamed request can recover through a buffered `/responses` request, never `/chat/completions`. System/user history uses `input_text`, while persisted assistant history uses the Responses-compatible `output_text` content type;
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
- every Provider settlement, with or without paid Tool Claims, crosses one server-only privileged RPC that revalidates the authenticated actor plus Turn/project binding; browser roles may acquire and read their own Turn but cannot declare Server External Execution Status;
- Compaction source/apply metadata is persisted before POST. Recovery replays the original Body and applies its Summary only to the original source IDs when their fingerprints and expected previous revision still match; appended tail messages survive, while source change or revision conflict fails without rebinding the old Summary to a new plan;
- Provider Context Frames remain browser-local, untrusted product context. They are retained for continuity and editable backup, not signed or accepted as causal proof by the server;
- GrsAI image planning distinguishes `textToImage`, `imageToImage`, and prompt-level `directedEdit`. The current request has no mask/inpainting field, so `maskedLocalEdit` is unavailable and no pixel-level local-edit guarantee is exposed;
- editable backups default to full conversation scope and preserve canonical raw chat, summary revisions, memory/stage revisions, Continuity Events, Agent Trace, citations, Compare analyses, and image provenance; schema 1-16 backups are inspected and migrated through the legacy compatibility boundary before restore;
- `KeyConclusionObject.category` stores the five-value `KeyConclusionCategory` union (`finding`, `opportunity`, `constraint`, `openQuestion`, and recovery-only `unknown`), while new writes accept only the four-value `AssignableKeyConclusionCategory` subset. Manual, research-extraction, Compare, and Agent-confirmed writes must carry one of those four categories explicitly; an unclassified confirmation starts at `请选择类别` and cannot be confirmed. Recovered `unknown` conclusions remain visible as `待分类` and can be manually assigned one of the four categories from the detail surface. UI, search, task Context, provider summaries, project Memory, and human-readable bundles read the stored field directly. The old extraction-note markers are migration-only compatibility hints and are not runtime semantics;
- the generated current-case fixture is upgraded with `npm.cmd run case-study:upgrade`; repeated upgrades must produce the same workspace hash.

No new runtime dependency or external service was introduced for schema v17.

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
- `src/features/workspace/components/ProjectBundlePanel.tsx` is a lightweight floating workspace panel that reuses the top `归档` entry instead of adding a separate archive page.

## M8 Delivery Output Packages

Morpho now implements a separate delivery output package for taking one prepared delivery package into external layout tools.

- `src/domain/morpho/deliveryOutput.ts` defines the independent `morpho-delivery-output` manifest with `outputVersion: "1"`, validation, diagnostics, selected-delivery-only asset candidates, and Markdown/source-map generation.
- `src/features/delivery-output/deliveryOutputClient.ts` performs browser-only IndexedDB Blob reads, classifies asset availability, writes the zip with `fflate`, and triggers download without writing workspace, catalog, localStorage, or BlobStore state.
- `src/features/workspace/components/DeliveryOutputPanel.tsx` is a lightweight floating output panel opened by the top `输出` button. It selects an active delivery object, runs preflight, shows section/reference/asset/gap/draft counts, and exports one zip.
- Output packages contain `output-manifest.json`, readable Markdown files, `source-map.json`, and only the `assets/` files required by the selected delivery references.
- Stable delivery snapshots are authoritative. Changed or missing source objects do not replace exported titles, summaries, captions, references, or assets.
- Pending section drafts and gaps are exported for review, but export never applies drafts, closes gaps, writes decisions, updates project memory, or changes delivery content.

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
  mixed imports. It preserves successful assets when another asset fails and records an explicit
  failure message for each failed file.
- `useWorkspaceImportController.ts` owns browser services and the project/readiness session
  guard. Its functional workspace commit boundary checks both the session identity and the
  current workspace project before each mutation, including document parsing, extract-asset
  persistence, and parse-status updates.
- `WorkspaceClient.tsx` only wires entry-point events, canvas/viewport positions, and the existing
  selection port. It does not aggregate `AssetRecord`s, save Blobs, or orchestrate parse/extract
  continuation. A stale physical Blob write may be left behind after a project switch; no new
  cleanup or garbage-collection semantics are inferred from that outcome.

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
- Provider continuation uses exact `function_call` / `function_call_output` items from the local Tool Batch. The server validates their bounded syntax and registered Tool names but deliberately does not attest local Tool truth or Workspace effects.
- Provider Requests and Search/Image/Compaction Actions use stable IDs plus server-computed Body hashes. Exact replays are idempotent; identity, hash, sequence, binding, limit, and terminal-state conflicts do not execute externally.
- When explicitly enabled for a compatible relay, Agent, independent Chat, and Compaction add an opaque server-generated Provider Prompt Cache Hint partitioned by authenticated user, local project where applicable, model, Prompt Contract, Tool Profile, and stable system prefix. The hint and optional supported retention are included in the exact external Request/Action Hash. They are performance routing hints only; disabled mode preserves the original request, cache miss never changes correctness, and an unsupported-cache `400` retries once without the optional fields.
- Search, Image, and Compaction persist the exact Action descriptor and durable Body before POST. Ambiguous responses become query-only recovery against the same Journal identity; no recovery path allocates a replacement ID to repeat an external action.
- Image child Actions are serial. A restored descriptor is consumed only after its matching child has completed local handling, after which the next child writes and flushes its own descriptor before send.
- The client Lifecycle reducer alone derives `completed`, `partiallyCompleted`, `pendingConfirmation`, `cancelled`, or `failed` from Server status plus local Tool, confirmation, and persistence facts. The server never accepts or stores that Overall Local Agent Turn Outcome.
- Context pressure is classified from both tokens and Provider Item count. A continuation can perform at most two additional compactions, and only a strict token or Item reduction permits another Provider request; the server and client both fail closed above 1,024 Items. Provider and local tool-batch handling share `MAX_AGENT_FUNCTION_CALLS = 64`; a 65-call response is rejected before execution or continuation signing.
- Explicit history, memory, and progress questions are guarded: the Agent must complete `search_project_conversation`, `read_project_memory`, and/or `read_stage_record` as required before a final answer can be accepted.
- Task Strategy resolves discussion, research, design definition, concept direction, direction preview, visual development, comparison, delivery preparation, and history/memory. A versioned Prompt Registry composes shared authority, continuity, memory, and task policies.
- `submit_memory_update` accepts only locally validated candidates backed by an exact quote from the persisted current user message. Deterministic projections remain authoritative; AI suggestions and one-off generation requests do not become user preferences.
- Citation snapshots come only from provider citation/annotation fields or local web-search results. Morpho never fabricates citations from assistant prose.

Image generation:

- The Agent sends structured visual intent, not a final provider prompt. `ImagePromptCompiler` combines current user input, Design Brief, direction revision, user preferences, role/task template, preservation/change boundaries, and a model adapter.
- References are resolved deterministically: current explicit references, selected source, branch root/direct parent, target-direction representative, applicable default reference, then other required project references. Duplicates, direction mismatches, default exclusion, unavailable assets, and provider-limit omissions are recorded.
- `1 / 2 / 4 / 6` remain UI shortcuts only. Explicit positive counts such as 3, 5, 9, or 12 and more than three directions are accepted; the Agent must produce one complete plan and execution may use bounded concurrency.
- The browser calls `/api/ai/image` only after local intent compilation and plan validation. Each success creates a new image object and persists structured intent, compiled prompt, prompt-contract version, resolved references and omissions, model settings, operation/provider IDs, and source relations.
- Image progress updates the same Agent Process tool activity. Partial failures and cancellation preserve every completed image and never overwrite a source image.

AI authority boundary:

- AI reads through explicit tools and writes only through locally validated tools and domain operations.
- Applied design definitions, direction status, default reference, important delivery decisions, and other high-impact actions keep their existing confirmation/authorization boundaries.
- Project Memory contains source-driven current projections and revision history; it is not a second fact source and is not exposed as user-managed files.
- Delivery section generation creates a pending draft from frozen section references. Applying that draft remains the explicit write boundary for narrative, captions, gaps, decisions, and continuity events.


## Built-In Case Study

The deployable built-in project is `project-morpho-case-study`, generated from the current real editable backup. It preserves the backup's canvas, relations, assets, messages, Agent traces, citations, project continuity, and incomplete state. The old Nightrail structure remains only as a test fixture and as a guarded one-time migration fingerprint.
