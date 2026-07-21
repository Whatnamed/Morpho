# Morpho Implemented Architecture

## Current Runtime

Morpho is a single Next.js App Router application in this repository root.

Implemented routes:

- `/` renders the local project homepage.
- `/projects/[projectId]` renders the Morpho workspace for one local project.
- `/api/ai/agent` is the formal workspace Agent route and streams OpenAI-compatible Responses SSE.
- `/api/ai/chat` remains a deprecated compatibility route for isolated legacy tests; the formal workspace panel has no caller.
- `/api/ai/image` proxies server-side GrsAI image generation and returns the generated image bytes.

Important module boundaries:

- `src/app/` owns Next.js routes.
- `src/features/projects/` owns the local project homepage UI.
- `src/features/workspace/` owns the visible workbench experience.
- `src/domain/morpho/` owns product-domain types, seed data, deterministic domain actions, import helpers, generation helpers, and queries.
- `src/infrastructure/persistence/` owns browser localStorage project catalog and workspace access.
- `src/infrastructure/assets/` owns browser IndexedDB Blob storage and asset-save workflow.
- `src/server/ai/` owns AiJWS/OpenAI-compatible provider config, request validation, context conversion, and response normalization.
- `src/server/image/` owns GrsAI provider config, request validation, bounded polling, and remote image download.

No database, authentication, cloud object storage, Supabase, multiplayer sync, export pipeline, or deployment automation is implemented.

## Data Model

Structured workspace data is schema version `15`.

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
- legacy conversation checkpoints in `workspace.ai.conversationCheckpoints` for migration and audit compatibility;
- project-wide compaction state and revisioned summaries in `workspace.ai.conversationCompaction` and `workspace.ai.conversationSummaryRevisions`;
- append-only provider-only Context Frames in `workspace.ai.providerContextFrames` for project state, turn scope, runtime configuration, and conversation summaries;
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
- the controlled Agent path now uses one deterministic project-wide summary boundary instead of lane-filtered or last-eight history; Agent user/assistant messages may retain lane and discussion labels for traceability, but those labels are not a semantic history boundary;
- `/api/ai/agent` estimates the complete provider request, including system text, recent messages, tool schemas, tool outputs, image reserves, and an optional previous actual input-token baseline;
- the default Agent budget is Morpho's fixed 256,000-token internal window, checkpoint preparation at 204,800 tokens, mandatory request compaction at 230,400 tokens, and a 16,000-token target for the compressible discussion/tool-history portion. Preparation is non-destructive; only the compact threshold advances a validated summary boundary;
- preparation keeps real project context, the current user input, the current selection, the current project summary, every complete post-boundary project message, and the latest unresolved tool-output group. Older completed tool outputs are shortened without replaying their tools;
- Responses token usage is normalized to one internal shape. When a valid provider total and output count omit input tokens, input is derived as `total - output`; malformed or negative usage is discarded. A provider context-limit failure triggers one server-side emergency-compacted retry of the same provider request, never a replay of client-side mutations, image generation, Proposal application, or other completed tools;
- when a mandatory-compaction response does not contain a valid checkpoint, the client may request one checkpoint-only continuation with no tools or images. Failure of that optional refresh does not invalidate the already completed visible Agent result.
- an exact `/compact` input gathers all eligible project messages after the existing summary boundary and rolls them through bounded summary-only Agent requests with no tools or images. The visible assistant message moves from `正在压缩当前上下文…` only after all chunks complete; partial failure keeps the previous summary and reports failure. A successful result writes only the final project summary and does not mutate canvas objects.

Agent streaming additions:

- `/api/ai/agent` now emits typed SSE while the provider is still running, including provider reasoning summaries, optional commentary, final text deltas, native hosted-tool activity, function-call readiness, citations, usage, context metadata, heartbeat, completion, and post-start errors;
- normal Agent turns and the exact `/compact` command consume that one SSE protocol through the shared `agentStreamClient`; there is no JSON response variant for this route;
- `src/server/ai/openaiCompatibleResponsesStream.ts` is the isolated Responses compatibility parser. It handles arbitrary byte boundaries, CRLF/multiline SSE data, heartbeats, `[DONE]`, unknown events, cancellation, provider failure, and early disconnect without saving raw SSE into workspace data;
- Responses is the only Agent protocol for all configured OpenAI-compatible endpoints, including AiJWS. Transient stream and gateway failures retry `/responses`; a streamed request can recover through a buffered `/responses` request, never `/chat/completions`. System/user history uses `input_text`, while persisted assistant history uses the Responses-compatible `output_text` content type;
- Morpho keeps all Agent function tools at `strict: false` for the current compatibility provider because its complex JSON Schema handling returns 502 during valid continuation calls. The existing client-side parser remains the authoritative strict field, type, enum, and business-rule validator before local tool execution;
- assistant messages may persist `agentTrace` ordered parts. Reasoning stores only provider-returned summaries. Explicit `commentary` and `final_answer` phases are authoritative; unphased Responses text is buffered until turn completion and becomes commentary only when that turn also contains a tool call. Tool activities come from actual provider or local-tool execution. Final text remains in `AiMessage.body`;
- every provider attempt has a stable `attemptId`. A context-limit retry emits `turn-attempt-reset`; the client removes failed-attempt provider-only increments, ignores late events from that attempt, retains completed Morpho work, and uses only successful-attempt usage and terminal output;
- the route owns the provider `AbortController`; request abort and response-reader cancellation both abort the upstream fetch and stop heartbeat/parser work;
- the client continues to execute workspace tools locally, updates one stable tool activity per `toolCallId`, and merges all provider continuations into the same assistant message and `agentTurnId`. Agent writes pass through a functional latest-workspace commit boundary, so streamed trace, concurrent user edits, operation/continuity changes, and tool results cannot overwrite one another;
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
- same-reply design-definition or concept-direction Proposal JSON suppresses Compare writes, semantic patches, checkpoints, and Compare decision entry points;
- confirmed Compare decisions write normal `DecisionRecord` entries with lightweight `ComparisonDecisionMetadata`; the full Compare body is not copied into decisions or project memory.

M5-D1 additions:

- workspace schema remains v11; document reading is transient UI state and does not add migration fields;
- `src/features/workspace/documentReader.ts` resolves file-reader availability, builds stable text blocks from the saved extract string, and searches plain text with offsets into the current `documentExtract`;
- `src/features/workspace/components/DocumentReaderPanel.tsx` renders a floating reader for local parsed text, with search, capped result snippets, block scrolling, current-match highlight, and explicit source/precision warnings;
- the reader opens from the bottom detail bar for an active parsed file with a valid `documentExtract` asset. It reads only the IndexedDB Blob referenced by `file.extractedAssetId`;
- unparsed, parsing, failed, hidden, missing-extract, wrong-asset-type, missing-asset, and Blob-read-failed states are explicit and do not trigger reparsing, provider calls, or workspace repair;
- parser counts such as `extractedPageCount` may be displayed as counts only. Without a persisted page/slide source map, the reader locates only extract blocks, paragraphs, snippets, and character ranges and must not expose page/slide jump claims;
- opening, searching, navigating, and closing the reader do not change selection, task mode, current focus, AI messages, conversation checkpoints, semantic records, Compare analyses, DecisionRecords, operations, or project continuity.

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

## Schema v15 AI Continuity And Memory

Schema v15 is the current runtime contract and supersedes lane-local checkpoint selection:

- `conversationLaneKey` and legacy checkpoints remain labels and migration evidence only;
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
- GrsAI image planning distinguishes `textToImage`, `imageToImage`, and prompt-level `directedEdit`. The current request has no mask/inpainting field, so `maskedLocalEdit` is unavailable and no pixel-level local-edit guarantee is exposed;
- editable backups default to full conversation scope and preserve raw chat, summary revisions, legacy checkpoints, memory/stage revisions, Continuity Events, Agent Trace, citations, Compare analyses, and image provenance;
- the generated current-case fixture is upgraded with `npm.cmd run case-study:upgrade`; repeated upgrades must produce the same workspace hash.

No new runtime dependency or external service was introduced for schema v15.

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

The current code does not implement asset garbage collection. Deleting a canvas object does not delete Blob data.

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

Asset panel and search are real workspace queries:

- assets list imported images, files, links, generated images, and future document extracts;
- search covers object titles/text, filenames, URLs/domains, concept/research/definition text, and delivery reference snapshots;
- hidden objects can be found and restored, but hidden objects are not included in default AI context.

## AI Providers

Text Agent:

- The formal workspace panel calls only `/api/ai/agent`; the route streams Responses reasoning summaries, commentary, function calls, citations, usage, context pressure, and final text over typed SSE.
- `/api/ai/chat` is retained only for compatibility tests and has no formal-panel caller. Delivery section drafting, research, design definitions, directions, comparison, memory updates, and visual planning all use Agent tools or deterministic domain services.
- Context is one continuous project conversation. Selection, focus, direction, branch, and the legacy lane key affect strategy and provenance only; they never filter formal history.
- Below the prepare threshold, every uncompressed user/assistant message enters the request. After compaction, the current summary revision plus every complete message after its covered boundary enter the request. Raw messages are never deleted.
- The fixed Morpho policy is a 256,000-token window, 204,800 prepare threshold, 230,400 compact threshold, and 16,000 target uncompressed tail. Production does not read context-threshold environment variables; only the non-production localStorage override is available for low-threshold browser acceptance.
- A valid summary revision is applied atomically with source range, count, hash, previous revision, and boundary metadata. Failed summary validation leaves the prior boundary unchanged. A provider context-limit error may trigger one client summary/retry after the server's replay-safe tool-output retry.
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
