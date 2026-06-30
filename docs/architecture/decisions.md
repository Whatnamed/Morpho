# Morpho Technical Decisions

## 2026-06-23: Use Next.js App Router

Decision: use `next`, `react`, and `react-dom` for the formal application foundation.

Reason: Morpho needs a production-oriented TypeScript application in the existing project root without creating a temporary project.

Current scope: App Router pages and route handlers run in one application. No separate backend service is implemented.

## 2026-06-23: Use tldraw as the Canvas SDK

Decision: use `tldraw` for the real canvas layer.

Reason: Morpho needs pan, zoom, selection, and extensible canvas object rendering. A custom `morpho-object` shape bridges tldraw canvas instances to Morpho domain objects.

Boundary: canvas coordinates are stored only as visual placement in `canvas.instances`. Domain semantics remain in Morpho objects and relations.

## 2026-06-23: Use Vitest for Domain Boundary Tests

Decision: use `vitest` for deterministic tests.

Reason: Morpho product rules require automated tests for object relations, state changes, delivery references, AI context boundaries, persistence migration, provider adapters, and import behavior.

## 2026-06-23: Use lucide-react for Interface Icons

Decision: use `lucide-react` for compact toolbar, rail, AI, and detail icons.

Reason: the app needs recognizable icon buttons without adding a large UI component system.

## 2026-06-23: Pin ESLint to 9.x

Decision: use `eslint@^9.39.0` with `eslint-config-next@16.2.9`.

Reason: `eslint@10.5.0` installed by `latest` triggered a runtime incompatibility in the React rule stack used by `eslint-config-next`. ESLint 9 satisfies Next's peer dependency and lint runs successfully.

## 2026-06-23: Use Schema Version 2 for Core Workspace Semantics

Decision: introduce visibility, delivery references, and scoped decision records.

Reason: Morpho needs structural separation between visibility, deletion, direction state, default references, and delivery references before adding project entry, import, AI, or export behavior.

Implemented fields include object `visibility`, `deliveryReferences`, and scoped `decisionRecords`.

## 2026-06-23: Keep Decision Records Semantic

Decision: `DecisionRecord` is not a universal operation log.

Reason: hidden and restore actions are temporary workspace operations and should not pollute decision history. Decision records are reserved for project-level decisions such as default-reference changes, direction status changes, delivery-reference changes, and reasoned deletion.

## 2026-06-23: Snapshot Delivery References

Decision: delivery modules store `DeliveryReference` IDs, and each delivery reference stores a display snapshot.

Reason: delivery content must remain stable when its source object is renamed, hidden, deleted, replaced by a new default reference, or continued into a new version.

## 2026-06-23: Preserve Raw localStorage on Migration Failure

Decision: localStorage migration is pure, and failed migration does not overwrite stored raw data.

Reason: localStorage is temporary, but it already represents real local project state. Future database or sync migration should follow the same rule: migration failure must be recoverable and must not silently reset project data to seed content.

## 2026-06-24: Use Schema Version 3 for Local Projects and Assets

Decision: upgrade workspace data to `schemaVersion: 3`.

Reason: Milestone 2 needs multi-project local persistence, asset records, text/link/image collection objects, persisted UI state, and extended AI messages while preserving v2 semantic boundaries.

Implemented fields include `workspace.assets`, `workspace.ui`, `TextObject`, `LinkObject`, and `ImageCollectionObject`.

## 2026-06-24: Use localStorage for Project Catalog and Workspace JSON

Decision: store the local project catalog and each workspace JSON document in localStorage.

Reason: the current product is local-first and must run without Supabase, authentication, cloud storage, or a configured backend database.

Boundary: localStorage stores structured project state only. Binary assets are stored separately in IndexedDB.

## 2026-06-24: Use IndexedDB for Local Binary Assets

Decision: store imported and generated binary files as Blobs in native IndexedDB.

Reason: images, PDFs, and other files must survive refresh without putting base64 payloads in localStorage.

Boundary: current code records asset metadata and Blob storage keys but does not implement garbage collection.

## 2026-06-24: Use Server-Side MiMo Adapter for Text Chat

Decision: implement `/api/ai/chat` as a server-side route that reads `MORPHO_MIMO_*` and calls MiMo through an OpenAI-compatible streaming adapter.

Reason: API keys must not appear in browser code, localStorage, logs, or `NEXT_PUBLIC_*` variables.

Boundary: MiMo can return text analysis, suggestions, and drafts only. It cannot directly mutate Morpho project state.

## 2026-06-24: Use Server-Side GrsAI Adapter for Image Generation

Decision: implement `/api/ai/image` as a server-side route that reads `MORPHO_GRS_*`, calls GrsAI `POST /v1/api/generate`, polls `GET /v1/api/result?id=...` when required, downloads the remote result, and returns image bytes to the browser.

Reason: image generation needs a real provider path while keeping keys server-only and preserving local-first asset storage.

Boundary: generated images are saved by the browser as new IndexedDB assets and new Morpho image objects. The source image, default reference, version chain, and delivery references are not overwritten.

## 2026-06-24: Keep GrsAI Model Request Profiles Separate

Decision: GrsAI request defaults are selected by server-side model profile and a client-safe static image model catalog.

Reason: native `nano-banana-*` and `gpt-image-2` do not use the same request shape. `nano-banana-2` uses `imageSize: "1K"` and `replyType: "json"`, while `gpt-image-2` uses pixel-style `aspectRatio`, `replyType: "json"`, and no `imageSize`.

Boundary: browser code does not expose API keys or base URL, and it does not build provider-private request bodies. The image task UI sends only model ID, aspect ratio, optional size option, prompt, and explicit references. The server adapter normalizes requests before calling GrsAI.

## 2026-06-24: Default GrsAI Image Model to `nano-banana-fast`

Decision: use a static GrsAI image model catalog and default to `nano-banana-fast`.

Reason: the current provider documentation does not expose a model-list endpoint for Morpho to consume, and the supplied provider model list marks `nano-banana-fast` as the lowest-point available image model. Maintenance and text/recognition models are not exposed in the image-generation selector.

Boundary: model points are displayed as provider points only. Morpho does not present RMB price estimates as authoritative; the UI says fees are subject to the provider console.

## 2026-06-24: Store Intrinsic Image Dimensions and Generation Metadata

Decision: store optional `width`, `height`, and `aspectRatio` on `AssetRecord`, and store generation metadata on generated image objects.

Reason: generated and imported images need consistent canvas sizing without cropping, and generated results must remain traceable to the chosen model, prompt, ratio, size option, references, and direction.

Boundary: metadata is shown in the bottom detail surface, not stacked on canvas cards. The selected model, ratio, and size option affect only the current generation request and are not written into project memory or default reference state.

## 2026-06-24: Keep MiMo Text Chat Metadata-Only for Images

Decision: the MiMo text chat route explicitly does not send image pixels yet.

Reason: until MiMo official visual input support is implemented in the provider adapter, Morpho must not present text chat as true image analysis.

Boundary: this was the Milestone 2 boundary. It is superseded for explicit image-understanding requests by the 2026-06-25 decision below; ordinary chat without image-understanding intent still remains metadata-only.

## 2026-06-25: Add Controlled AI Operation Runtime

Decision: introduce a local-first Operation Runtime for finite, auditable AI workflows.

Reason: Research and image-generation tasks need input snapshots, recoverable status, citation snapshots, and user-confirmed proposals without turning Morpho into an unbounded autonomous agent.

Boundary: Operation records store status, summaries, proposals, citation snapshots, and IndexedDB artifact references. They do not store raw webpages, large extracted documents, provider raw responses, API keys, response headers, or hidden provider diagnostics in localStorage.

## 2026-06-25: Use Schema Version 4 for Operation State

Decision: upgrade workspace data to `schemaVersion: 4`.

Reason: Operation records, artifact proposals, and citation snapshots need stable local-first containers that migrate safely from v3 project data.

Boundary: schema v4 does not introduce a backend job queue. Browser refresh marks unfinished operations interrupted instead of pretending they continue on a server.

## 2026-06-25: Use Schema Version 5 for Semantic Working State and Revisioned Design Loop

Decision: upgrade workspace data to `schemaVersion: 5`.

Reason: M4 semantic work needs first-class key conclusions, revisioned design definitions, revisioned concept directions, direction lineage, lightweight visual branches, and a rebuildable working-state index that can drive AI context and stage snapshots without turning canvas layout into business state.

Boundary: `workingState` and legacy `stageRecords` are derived and stored for fast local reads, but they are not the sole source of truth. Authority remains with formal objects, revisions, relations, and decision records. Schema v5 still does not introduce PDF runtime, delivery-plan runtime, or archive export. The `stageRecords` runtime boundary is superseded by schema v8 project continuity.

## 2026-06-25: Treat Image Role Changes as Visual-Development Decisions

Decision: image role changes go through the `setImageRole` domain action and write a `setImageRole` decision record.

Reason: M4 visual development needs images to carry explicit roles such as scene visual, CMF study, detail study, structure diagram, and delivery asset without inferring those roles from canvas position or proximity.

Boundary: changing an image role does not set a default reference, does not move the image into a direction, does not hide other images, and does not create a new version. Direction assignment and image generation remain separate actions.

## 2026-06-25: Make Task Mode the Execution Authority

Decision: user-send `taskMode` controls whether a request is chat/analysis, image generation, or research operation.

Reason: selected images and broad text regexes previously risked routing ordinary questions into GrsAI image generation.

Boundary: regexes, selected object types, and suggestion chips may set a recommended task mode, but they cannot silently change the execution path.

Superseded boundary: the 2026-06-26 default-routing decision below keeps manual user-selected modes authoritative, but lets the default discussion mode adopt a recommended executable task when the user has not explicitly switched modes.

## 2026-06-25: Gate Provider Capabilities by Verification

Decision: GrsAI model profiles and MiMo optional capabilities carry verification status.

Reason: provider model lists, image-to-image support, multi-reference behavior, visual input formats, web-search tools, and citation response shapes must not be presented as reliable until documented and smoke-test verified.

Boundary: `nano-banana-fast` remains the low-cost default candidate, but only verified capabilities are exposed as executable UI options. MiMo web search request wiring and citation parsing are implemented, but paid smoke tests are still manual and disabled by default.

## 2026-06-25: Add Explicit MiMo Visual Input and Citation Events

Decision: `/api/ai/chat` now supports selected-image visual input and normalized citation events.

Reason: M3.2 needs real image understanding and source display without turning ordinary chat into implicit multimodal analysis or exposing local assets broadly.

Boundary: only `chatAnalysis` and `researchOperation` may send image pixels, only when the user text clearly asks to analyze/compare/extract visual information, and only for selected active image objects. The browser reads and compresses up to 3 IndexedDB image Blobs; Base64 data is sent only in the request and is never stored in workspace/localStorage. The server uses the configured multimodal MiMo model and OpenAI-compatible `image_url` message parts.

## 2026-06-25: Use Provider Citation Snapshots Only

Decision: MiMo stream normalization emits `delta`, `citations`, `done`, and `error` events. Chat messages and Research Proposals persist citation snapshot IDs when provider citation fields are present.

Reason: Morpho must show sources for online-assisted work, but it must not fabricate citations from plain assistant text.

Boundary: when `MORPHO_MIMO_WEB_SEARCH_ENABLED=true`, chat/research requests provide MiMo native `web_search` and let the model decide whether to use it. `imageGeneration` never receives web search tools. If the provider returns no citation annotations, Morpho records no source list and local analysis still continues.

## 2026-06-25: Persist Anchored Canvas Camera

Decision: custom wheel zoom is calculated around the cursor page point and the final camera is debounced into workspace state.

Reason: the canvas should zoom predictably and restore the user’s last view after refresh without writing workspace state on every wheel event.

Boundary: camera persistence remains view/UI state. It does not affect object semantics, relationships, direction state, default reference, or delivery inclusion.

## 2026-06-25: Use Adaptive MiMo Visual Input Packs

Decision: selected active images in chat/research are packed into MiMo attachments adaptively. Small selections are sent as individual compressed images; larger selections are represented by generated contact sheets that cover all selected images.

Reason: Morpho should not expose a user-facing maximum image count for analysis, and it must not silently drop selected references.

Boundary: only selected active image assets are read. Hidden images, unselected old images, default references, whole-canvas screenshots, Base64 payloads, and contact sheet binaries are not stored in workspace/localStorage.

## 2026-06-25: Let MiMo Decide Whether to Use Web Search

Decision: when server configuration enables MiMo web search, chat/research requests provide the native `web_search` tool and let the model decide whether the current request needs external verification or source supplementation.

Reason: online assistance should support the current analysis without adding a separate user-facing research configuration flow.

Boundary: `imageGeneration` never receives web search tools. Morpho only persists provider citation snapshots and never fabricates sources from assistant prose.

## 2026-06-26: Use Schema Version 6 for M4 Proposal Integrity and Visual Branch Runtime

Decision: upgrade workspace data to `schemaVersion: 6`.

Reason: M4.1-B requires deterministic proposal review, unique current-effective design definition semantics, official image roles, operational concept-direction lifecycle, and direction-scoped visual branches.

Boundary: schema v6 does not introduce PDF parsing, delivery package runtime, ZIP export, DOCX/PPTX generation, cloud sync, multiplayer collaboration, auto layout, or autonomous research agents.

## 2026-06-26: Normalize Image Roles at Migration Boundary

Decision: runtime image roles are limited to `reference`, `preview`, `conceptImage`, `primaryVisual`, `sceneVisual`, `cmfStudy`, `detailStudy`, `structureDiagram`, `interactionDiagram`, and `deliveryAsset`.

Reason: old role values and current formal role values must not coexist in runtime UI, generation metadata, shape labels, or tests.

Boundary: legacy `main`, `scenario`, `cmf`, `detail`, and `diagram` are accepted only during migration and are mapped respectively to `primaryVisual`, `sceneVisual`, `cmfStudy`, `detailStudy`, and `structureDiagram`.

## 2026-06-26: Enforce One Current Effective Design Definition

Decision: reconcile enforces at most one `DesignDefinitionObject.isCurrentEffective === true` across active and hidden objects.

Reason: downstream direction generation and context assembly need one authoritative definition pointer without silently substituting an older object.

Boundary: if multiple current-effective definitions appear in migrated or corrupted data, the winner is deterministic: newest current revision `createdAt`, then stable ID order. Hidden current definitions remain current but are marked unavailable for default context.

## 2026-06-26: Make Concept Direction Lifecycle Explicit

Decision: `ConceptDirectionProposal.applicationMode` controls application semantics: `create`, `revise`, `split`, or `merge`.

Reason: revising, splitting, and merging directions have different identity and lineage semantics and must not all be implemented as "create a new direction".

Boundary: `revise` reuses one direction ID and creates a new current revision; `split` creates child directions with `splitFromDirection` lineage and leaves the parent unchanged; `merge` creates one new direction and records one `mergedFromDirection` lineage per parent. No mode automatically hides, deletes, eliminates, or promotes directions to primary.

## 2026-06-26: Keep VisualBranch as a Direction-Scoped Record

Decision: `VisualBranchRecord` remains a lightweight record under `workspace.visualBranches`, not a `MorphoObject`.

Reason: visual branches are routing and grouping metadata for direction-internal image development, not independent canvas entities, delivery references, or workflow lanes.

Boundary: branch archive/restore changes only branch availability for grouping and context priority. It does not delete images, clear image direction IDs, break generation metadata, or modify lineage.

## 2026-06-26: Use Semantic Source Snapshots for Proposal Review

Decision: proposals and operations store lightweight source semantic snapshots and produce structured `ProposalReviewDetails`.

Reason: title, summary, canvas placement, size, zoom, and image role edits should not all be treated as source changes, while real semantic changes must be explainable before applying stale proposals.

Boundary: snapshots contain object ID, type, visibility, and a semantic fingerprint only. They do not store base64, large attachments, raw provider payloads, or webpage bodies.

## 2026-06-26: Gate Provider-Backed Tasks Through One Active Operation

Decision: research, image generation, design-definition proposals, and concept-direction proposals all use `canStartOperation()` before starting provider-backed work.

Reason: simultaneous `running` or `waiting_for_user` operations can leave conflicting proposals and unclear state transitions.

Boundary: ordinary discussion and comparison remain lightweight chat and do not have to create full Operation records. Suggestion chips and regex recommendations still cannot override the user-selected work intent at send time.

## 2026-06-26: Use Schema Version 7 for Local Document Extracts

Decision: upgrade workspace data to `schemaVersion: 7`.

Reason: M4.2 needs selected imported documents to participate in research and semantic drafting without storing full file text in workspace JSON.

Implemented fields on `FileObject` include parse status, extracted asset ID, extracted character count, optional page count, parse timestamp, and parse error. Extracted text is stored as a separate IndexedDB `documentExtract` asset.

Boundary: the original imported file remains the source asset. Parsed text is a bounded local context artifact, not a network citation, and failed or unsupported parsing does not block ordinary file import.

## 2026-06-26: Use pdfjs-dist and fflate for Browser-Side Document Extraction

Decision: add `pdfjs-dist` for text-layer PDF extraction and `fflate` for PPTX ZIP/XML extraction.

Reason: Morpho needs local, demo-safe document extraction for real uploaded research material before introducing cloud OCR or a server document pipeline.

Boundary: supported extraction is best-effort and local-only. Text PDFs, Markdown, plain text, and PPTX slide text are supported. Scanned PDFs, legacy `.ppt`, DOC/DOCX, layout fidelity, OCR, embedded images, and table reconstruction are not implemented.

## 2026-06-26: Auto-Route Default AI Requests but Preserve Manual Override

Decision: when the AI panel is still in default discussion/chat mode, recommended task routing can execute `researchOperation`, `imageGeneration`, or semantic proposal intents automatically. Once the user manually selects a non-default task mode or work intent, that explicit choice remains authoritative.

Reason: M4.2's demo flow depends on natural language moving from real inputs into research, definition, direction, preview, and iteration without forcing the user to manage backend modes.

Boundary: suggestions only route at send time. They do not mutate project state by themselves, and provider-backed tasks still pass through the one-active-operation gate.

## 2026-06-26: Compile Visual Generation Through MiMo Plans Before GrsAI Calls

Decision: visual generation first asks MiMo for a structured `morphoVisualGenerationPlan`, validates that plan locally, then calls GrsAI once per approved plan item.

Reason: direction previews and visual-development branches need semantic routing, role assignment, direction ownership, source references, and partial-failure tracking before image bytes are created.

Boundary: plan validation blocks unauthorized object IDs, ambiguous cross-direction source mixes, and direction-preview requests that do not map one selected direction to one preview. Generated results always create new image objects and never replace source images, default references, direction status, or delivery references.

## 2026-06-26: Keep Design Chain Trace Read-Only and Rebuildable

Decision: design-chain tracing is computed from current objects, relations, revisions, visual branches, generation metadata, and decision records at view time.

Reason: M4.2 needs reviewers to inspect how an image or direction descends from real inputs, research, conclusions, definitions, directions, and visual iterations without creating another persistent workflow object.

Boundary: the trace overlay and bottom detail summary do not write project state and do not infer meaning from canvas proximity. Canvas coordinates are used only to draw the temporary visual overlay between already-known semantic records.

## 2026-06-28: Centralize Bounded Task Context Assembly

Decision: introduce a dedicated task-context assembly layer in `src/features/workspace/taskContext.ts`.

Reason: AI task input assembly had become split across view code and was no longer reliable enough for M4.3 requirements around selected materials, visual planning, default-reference gating, hidden-object exclusion, and explainable truncation.

Boundary: the task-context layer is pure and deterministic. It returns bounded IDs, semantic summaries, authorized image/document scopes, skip reasons, truncation state, and default-reference status. It does not read blob bytes itself, mutate workspace state, infer semantics from canvas position, or persist raw context payloads.

## 2026-06-28: Let MiMo Visual Planning Receive Authorized Local Inputs

Decision: keep authorized `attachments` and `documentExtracts` on `/api/ai/chat` when `taskMode === "imageGeneration"`.

Reason: MiMo visual planning for direction preview and visual development must see the real selected images and selected local parsed materials in order to produce reliable plans.

Boundary: this applies only to the MiMo planning stage. `imageGeneration` still never receives native web search tools, and `/api/ai/image` still never receives document-extract text or hidden context internals.

## 2026-06-28: Keep Default Reference Optional and Explicit in Visual Planning

Decision: current default-reference pixels enter visual planning only when the user explicitly asks to keep or reference the current default reference and the reference remains active and relevant to the current direction scope.

Reason: Morpho treats default reference as an optional consistency baseline, not as a hard prerequisite for every visual-generation task.

Boundary: simply having a project-level default reference does not authorize its pixels for every task. Hidden default references remain excluded from default AI context.

## 2026-06-28: Validate Direction Preview by Requested Count Instead of One-per-Direction

Decision: direction preview now supports `1`, `2`, `4`, or `6` previews per selected direction, with a hard total limit of `8` generated items per run, and the requested count is stored on image-generation Operation metadata.

Reason: M4.3 requires controllable multi-preview comparison without silently changing user intent or letting MiMo invent extra/unscoped outputs.

Boundary: every selected direction must be covered exactly `requestedPreviewCount` times, every preview item must use `conceptImage`, no automatic visual-branch binding is allowed for direction preview, and Morpho blocks over-limit or under-specified plans before any GrsAI call.

## 2026-06-28: Use Deterministic Selection-aware Auto-routing

Decision: recommended task routing now combines draft text with selected object types instead of relying on narrow keyword-only heuristics.

Reason: Morpho needs the default discussion mode to move naturally into research, direction preview, and visual development, while still keeping image analysis, copywriting, and manual overrides on the correct path.

Boundary: routing remains deterministic and local. Morpho does not call a second model just to choose a task route, and manual user-selected task mode or work intent still remains authoritative.

## 2026-06-30: Use Schema Version 8 for Project Continuity

Decision: upgrade workspace data to `schemaVersion: 8` and introduce `workspace.projectContinuity` as the single project-continuity runtime entry point.

Reason: M5-A needs structured current focus, traceable stage records, derived project memory views, typed source refs, validity, and bounded continuity context without maintaining both legacy `project.currentFocus` and `stageRecords` as competing truth sources.

Boundary: schema v8 accepts legacy `project.currentFocus` only as migration input. Legacy `stageRecords` are retired and are not bulk-converted into historical continuity entries. The continuity state remains a deterministic projection over real objects, revisions, operations, proposals, citations, relations, visual branches, delivery references, and decision records.

## 2026-06-30: Keep Project Continuity Event-Driven and Deterministic

Decision: write continuity only from explicit successful domain events through `applyProjectContinuityEvent`, and resolve entry validity with `resolveContinuityValidity` before context assembly.

Reason: project continuity must be stable, replay-safe, and explainable. React effects, selection changes, drawer toggles, ordinary chat, proposal generation, failed operations, and canvas movement must not silently create project facts.

Boundary: every continuity event has a stable `dedupeKey`. Source refs are typed and store only lightweight snapshots plus source availability (`active`, `hidden`, or `missing`). Hidden sources do not change entry validity and are excluded from default active AI context; deleted or missing sources become `sourceUnavailable`; directly replaced revisions or default references become `superseded`. Exploration remains empty unless a future explicit exploration event is introduced.
