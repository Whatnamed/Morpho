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

## 2026-06-24: Use Server-Side AiJWS Adapter for Text Chat

Decision: implement `/api/ai/chat` as a server-side route that reads `MORPHO_AI_*` / `AIJWS_*` and calls AiJWS through the shared OpenAI-compatible provider adapter. MiMo configuration is no longer read by active text AI routes.

Reason: API keys must not appear in browser code, localStorage, logs, or `NEXT_PUBLIC_*` variables.

Boundary: AiJWS can return text analysis, suggestions, and drafts only. It cannot directly mutate Morpho project state.

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

Boundary: only `chatAnalysis` and `researchOperation` may send image pixels, only when the user text clearly asks to analyze/compare/extract visual information, and only for selected active image objects. Base64 data is sent only in the request and is never stored in workspace/localStorage. The server uses the configured AiJWS/OpenAI-compatible model and `image_url` message parts.

## 2026-06-25: Use Provider Citation Snapshots Only

Decision: AiJWS/OpenAI-compatible response normalization emits `delta`, `citations`, and `done` events. Chat messages and Research Proposals persist citation snapshot IDs when provider citation fields are present.

Reason: Morpho must show sources for online-assisted work, but it must not fabricate citations from plain assistant text.

Boundary: when `MORPHO_AI_WEB_SEARCH_ENABLED=true`, chat/research requests may provide AiJWS/OpenAI-compatible web-search tooling where supported. `imageGeneration` never receives web search tools. If the provider returns no citation annotations, Morpho records no source list and local analysis still continues.

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

## 2026-06-30: Use Schema Version 9 for Explicit Conversation Semantic Records

Decision: upgrade workspace data to `schemaVersion: 9` and allow only authorized conversation semantic patches to append entries to `workspace.projectContinuity.recordEntries`.

Reason: M5-B1 needs explicit user statements such as long-lived preferences, constraints, avoidances, open questions, decision reasons, and rejection reasons to become reusable continuity records without letting ordinary chat, model inference, or proposal drafts mutate project facts.

Boundary: conversation semantic records never update `currentFocus`, objects, revisions, direction status, default references, VisualBranch state, delivery references, or DecisionRecords. Existing v8 entries migrate as `origin: deterministicEvent` and `manualState: active`; migration does not invent message refs or semantic metadata.

## 2026-06-30: Keep Provider Semantic Patches Candidate-Only

Decision: providers may return `morphoProjectContinuityPatch` only as a bounded candidate contract. Morpho locally parses, authorizes, validates, dedupes, summarizes, and writes accepted entries.

Reason: provider-written long-term summaries or guessed associations would make project memory non-deterministic and could silently promote model interpretation into facts.

Boundary: provider `summary` is ignored. Stored summaries come only from deterministic templates over `semanticKind + evidenceQuote`. `evidenceQuote` must be a short substring of the current user draft. The parser rejects unexpected fields, raw payloads, state mutation fields, invalid kind/scope values, oversized quotes, Base64, URLs, and unsafe raw-provider markers.

## 2026-06-30: Authorize Semantic Sources From Task Context Only

Decision: build `SemanticPatchAuthorization` from the current `TaskContextResult`, user message ID, draft, message timestamp, current focus area, and direct authorized IDs.

Reason: a validator that scans the whole workspace would be able to "repair" or invent model associations after the fact, which would violate Morpho's direct-source and hidden-object boundaries.

Boundary: validation checks only the authorization object. Hidden selected objects are excluded from task-context object IDs and cannot become new active semantic sources. Non-project scopes require an authorized direct source. `decisionReason` and `rejectionReason` require an authorized `DecisionRecord` source.

## 2026-06-30: Suppress Semantic Patches for Design And Direction Proposals

Decision: do not write conversation semantic patches when the same assistant reply includes design-definition or concept-direction Proposal JSON.

Reason: those proposals are pending drafts awaiting explicit user application. Mixing them with long-term semantic record writing would make it unclear whether the user confirmed a durable statement or merely received a draft.

Boundary: `morphoResearchProposal` is not a global suppressor. A successful research task may create a research card and also write a valid semantic patch, but the patch can use only the pre-request task context and persisted user message, and it must not bind the newly created research card as a source.

## 2026-06-30: Centralize Continuity Eligibility

Decision: use `getContinuityEntryEligibility(entry)` as the shared rule for `manualState`, `validity`, and `sourceAvailability` across memory views, default context, review lists, request prompt serialization, and the project-record drawer.

Reason: hidden source handling, user withdrawal, source missing state, and review-needed state must not drift across UI and AI context code.

Boundary: `manualState` does not change entry validity or source availability. Hidden sources keep historical validity but stay out of default memory/context. Missing sources are not factual inputs. `notApplicable` and `withdrawn` entries stay in history and can be restored only through semantic-entry UI actions.

## 2026-06-30: Harden Semantic Scope, Message Sources, And Streaming Display

Decision: semantic `scope` now filters provider task context and task-filtered memory views using only current task direct typed sources; message refs are recalculated strictly from `workspace.ai.messages`; streaming display hides complete and trailing partial `morphoProjectContinuityPatch` JSON.

Reason: scoped conversation records are useful project history, but unrelated direction/visual records must not leak into provider context or consume the continuity budget for another task. Removed source messages must not remain active evidence. Users should never see technical semantic JSON during streaming.

Boundary at M5-B1.1 time: workspace schema remained v9 and `ProjectContinuityState` remained v2. The global project-record drawer still shows valid scoped history and source-unavailable entries with snapshots. This did not implement automatic chat compression, transcript pruning, Compare, archive restore, delivery preparation, or agent loops.

## 2026-07-01: Use Schema Version 10 For Conversation Checkpoints

Decision: upgrade workspace data to `schemaVersion: 10` and store automatic short-term conversation checkpoints under `workspace.ai.conversationCheckpoints`.

Reason: long ordinary discussions need continuity without sending the entire visible transcript to the provider and without promoting a chat summary into project facts.

Boundary: `ProjectContinuityState` remains schema v2. Checkpoints are not project memory, stage records, DecisionRecords, design definitions, direction state, default references, delivery references, or archive artifacts. Migration from v9 initializes an empty checkpoint array and preserves all raw `ai.messages` without fabricating lane keys.

## 2026-07-01: Keep Conversation Checkpoints Lane-Scoped And Non-Authoritative

Decision: build checkpoint lanes deterministically from current focus area, focus `updatedAt`, task kind, sorted explicitly selected active object IDs, selected direction IDs, selected-image direction IDs, and an optional unique selected-image VisualBranch ID.

Reason: a checkpoint should continue only the same current discussion range. Focus epoch participation prevents a checkpoint from an older design-definition, direction, research, or visual-development context from silently entering a later context with the same focus area label.

Boundary: lane keys do not use auto-included task-context objects such as current definitions, related key conclusions, or other derived context helpers. They also do not use canvas coordinates, visual grouping, proximity, draft text, or model semantic guesses. Opening drawers, zooming, panning, dragging, hovering, and other visual UI state do not create a new lane.

## 2026-07-01: Request Conversation Checkpoints Only In Normal Discussion Or Comparison Calls

Decision: ask for `morphoConversationCheckpoint` only inside the existing `/api/ai/chat` provider call when ordinary `chatAnalysis` discussion/comparison has crossed deterministic thresholds and no pending proposal is open.

Reason: M5-B2 must not add a second model call or make the provider decide when compression is needed.

Boundary: current thresholds are at least 8 usable messages and 3 user messages, or at least 5,200 characters and 2 user messages. The instruction is not present for `imageGeneration`, `researchOperation`, design-definition Proposal intents, or concept-direction Proposal intents. Failed, cancelled, streaming, and non-chat messages are excluded, and a pending proposal suppresses checkpoint request/write.

## 2026-07-01: Hide Conversation Checkpoint JSON From Visible Chat

Decision: use a shared structured-block helper to hide both `morphoProjectContinuityPatch` and `morphoConversationCheckpoint` JSON from visible assistant text, including malformed closed blocks and trailing unclosed streaming blocks.

Reason: provider contracts are implementation details. Users should see prose and lightweight feedback, not technical JSON or schema errors.

Boundary: the original completed stream text remains available to parsers. Ordinary research, design-definition, concept-direction, and visual-plan JSON blocks are not removed by the checkpoint/semantic block stripper unless their own feature-specific parsing consumes them.

## 2026-07-01: Use Schema Version 11 For Local Compare Analyses

Decision: upgrade workspace data to `schemaVersion: 11` and store saved local Compare analyses under `workspace.ai.comparisonAnalyses`.

Reason: M5-C requires a traceable local Compare loop where explicit selected objects are analyzed, the user confirms a specific decision, and only then domain state changes.

Boundary: Compare is not a project-memory system, stage page, score table, automatic ranking, or autonomous decision path. Saved analyses keep lightweight source snapshots and message links only. Real state changes still go through existing domain actions and `DecisionRecord` entries.

## 2026-07-01: Separate Compare Sources From Background Context

Decision: `/api/ai/chat` carries `comparisonContext` for explicit selected sources and evidence availability, plus `comparisonBackgroundContext` for slim criteria such as current design definition, continuity, and default-reference status.

Reason: Compare must be able to answer questions like whether directions fit the current definition without letting background objects become hidden sources, object comparisons, evidence for key conclusions, or decision targets.

Boundary: `sourceObjectIds` and `objectComparisons` must exactly match the explicit selection. File evidence requires a sent `documentExtract`; image visual evidence requires sent pixels/contact sheet; `keyConclusionCandidate` may use only selected true text evidence sources. Same-reply design-definition or concept-direction Proposal JSON suppresses Compare, semantic patch, and checkpoint writes.

## 2026-07-01: Keep Document Reading Local, Text-Only, And Schema-Neutral

Decision: M5-D1 reads only the existing local IndexedDB `documentExtract` Blob for an active parsed file and presents it in a transient workspace panel with local text search and extract-offset location.

Reason: users need to re-read and verify parsed source text without converting a file into project memory, AI context, a document editor, or a layout preview.

Boundary: workspace schema remains v11. The reader does not add OCR, PDF page rendering, PPTX visual reconstruction, page/slide source maps, routes, cloud services, provider calls, document annotations, fragment extraction, or automatic key-conclusion/project-continuity writes. Parser counts may be shown only as counts; without a real persisted source map, location is limited to parsed text blocks and character ranges.

## 2026-07-01: Use Schema Version 12 For Document Fragments

Decision: upgrade workspace data to `schemaVersion: 12` and add `documentFragment` as an explicit user-created object extracted from bounded parsed reader blocks.

Reason: users need reusable text evidence that remains traceable to a source file, extract asset, character range, and reader block set without turning the original file or full extract into workspace JSON.

Boundary: migration does not fabricate historical fragments. A fragment stores only bounded body text plus source metadata; it does not store original binaries, Base64, full document extracts, OCR output, PDF/PPT layout data, provider payloads, or page/slide source maps.

## 2026-07-01: Treat Fragment Source Navigation As Extract-Offset Navigation Only

Decision: source return for a `documentFragment` opens the existing document reader only when the source file is active and the current `extractedAssetId` still matches the fragment snapshot.

Reason: the only reliable source location persisted today is the `documentExtract` character range and stable reader block IDs.

Boundary: hidden/missing files, missing assets, and asset mismatches keep the fragment readable but disable navigation. The UI must not invent PDF page numbers, PPT slide numbers, coordinates, reparsing, provider calls, or source-file visibility changes.

## 2026-07-01: Keep Document Fragments Explicit In AI And Compare

Decision: selected active `documentFragment` objects can enter TaskContext and Compare as bounded text sources. Compare evidence basis is `documentFragment`, and key-conclusion candidates cite the fragment IDs directly.

Reason: a fragment is a user-extracted text source, not an implicit authorization to read the whole source file.

Boundary: unselected fragments do not enter provider context. The source file and sibling fragments are not auto-attached. Fragment creation writes a deterministic continuity event but does not create Project Memory, a key conclusion, a DecisionRecord, an AI message, a checkpoint, or a Compare analysis.

## 2026-07-02: Use Schema Version 13 For Delivery Preparation

Decision: upgrade workspace data to `schemaVersion: 13` and extend the existing `delivery` object with editable sections, section-scoped references, managed gaps, and pending delivery section drafts.

Reason: delivery preparation needs a closed loop from selected project material to stable section references, source-state review, confirmed narrative, captions, and explicit gaps without becoming final export or creating a parallel package model.

Boundary: M6 does not add PPT/PDF/Figma export, final slide/page layout, archive packaging, cloud sync, collaboration, a mock route, or a second delivery-package abstraction. Canvas coordinates remain visual-only and never determine delivery inclusion or section order.

## 2026-07-02: Keep Delivery References Stable And Explicitly Refreshable

Decision: delivery references store stable bounded snapshots plus deterministic source fingerprint/revision/asset metadata, and stale references refresh only through explicit user action.

Reason: delivery content must not silently change when a source image, conclusion, direction, document fragment, file, or asset changes after being added to delivery preparation.

Boundary: snapshots do not store source binaries, Base64, Blob URLs, provider raw payloads, complete source files, original PDFs/PPTX, or complete document extracts. Refreshing a reference updates only that one reference snapshot and preserves editorial caption/note unless a future explicit overwrite action is designed.

## 2026-07-02: Treat Delivery Section Drafts As Pending AI Drafts

Decision: `prepareDeliverySection` uses only the current section's frozen delivery reference snapshots and may create a pending `DeliverySectionDraft`; applying the draft is the only write boundary for narrative, listed captions, suggested gaps, decision, and continuity.

Reason: AI can help draft explanation text, but it must not silently turn model prose into delivery content, project memory, design definition, direction status, default reference, or Compare output.

Boundary: the route drops web search for this intent. The client does not send live source object bodies, full source files, full document extracts, image pixels, Blob URLs, Base64, normal task context, or Compare context. Malformed blocks or same-reply design/direction/Compare proposals do not create a delivery draft.

## 2026-07-02: Split Archive And Editable Backup Manifests

Decision: M7-A defines two distinct manifest families in pure domain code: `morpho-human-readable-archive` for review/handoff and `morpho-editable-project-backup` for future restore into a new project copy.

Reason: a readable archive is not the same artifact as a restore-ready backup. Keeping them separate avoids mixing handoff-oriented scope with editable recovery scope and keeps future M7-B/M7-C implementation contracts stable.

Boundary: both manifests use `manifestVersion: "1"` independent of `workspace.schemaVersion`. Both expose structured asset inventory and readable diagnostics. Portable inventory keys are logical keys only and must not reuse runtime `storageKey` or Blob URLs. Human-readable archive includes delivery packages, visual-route fields, research/source indexes, and citation snapshots for review/handoff. Backup restore must remap project identity and regenerate runtime storage keys rather than merge into an existing project. Editable backup creation is blocked when restore-critical integrity checks already fail, and backup snapshot UI state is normalized so transient drawer/selection/work-intent state is not treated as long-term project fact.

## 2026-07-02: Use A Separate Bundle Envelope And New-Copy-Only Restore

Decision: M7-B and M7-C add a separate portable package layer with `format: "morpho-project-bundle"` and `bundleVersion: "1"` instead of overloading the M7-A manifest format. Human-readable archive and editable backup remain different package kinds inside the same envelope family.

Reason: download/export and restore need file-level validation, bundled asset byte-length checks, and clear package-level semantics that are distinct from manifest semantics. Keeping the envelope separate allows the manifest contract to stay stable while bundle layout and restore execution evolve.

Boundary: archive bundles may export with warnings when local binaries are missing or byte lengths no longer match metadata. Editable backup bundles are stricter: export is blocked when required binaries are missing or mismatched. Restore always creates a new independent project copy, regenerates runtime storage keys for every restored asset, writes blobs before workspace/catalog state, and attempts rollback cleanup on write failures instead of overwriting or merging existing projects.

## 2026-07-02: Keep Delivery Output Separate From Archive And Backup

Decision: add a third package family for M8 with `format: "morpho-delivery-output"` and `outputVersion: "1"`.

Reason: users need to take the selected delivery preparation package into Figma, PPT, Keynote, Illustrator, or course-submission organization without exporting the whole project process or creating a restorable backup. The output contract must preserve chapter order, stable references, captions, source maps, asset availability, gaps, and unapplied drafts while staying independent from workspace schema v13 and M7 archive/backup envelopes.

Boundary: delivery output exports only one selected `delivery` object's sections, stable references, required assets, gaps, and pending drafts. It does not scan the whole canvas, export all assets, apply drafts, close gaps, refresh stale references, write workspace/catalog/IndexedDB state, restore projects, alter M7 `manifestVersion` or `bundleVersion`, or generate PPTX, PDF, Figma files, final layouts, cloud shares, or collaboration artifacts.

## 2026-07-05: Use Supabase Auth For Email Password Access

Decision: use `@supabase/ssr` and `@supabase/supabase-js` for direct email/password registration and session handling, route protection, current-user access state, and server-side AI quota reservation.

Reason: Morpho needs normal email/password access while preserving trusted server-side session verification, RLS-backed access records, and atomic daily AI quota checks before provider calls. The existing local-first persistence cannot provide account identity or concurrent quota enforcement.

Boundary: successful registration receives a session only when Supabase Email signups are enabled and email confirmation is disabled. New Auth users receive `tester` and `active` access through the database trigger with `500` text and `100` image requests per Beijing calendar day. Supabase is not the project database for Morpho workspaces: project catalog and workspace JSON remain in browser `localStorage`, binary assets remain in IndexedDB, and login/logout must not delete, migrate, hide, or bind local projects to `auth.users.id`.

## 2026-07-05: Harden Supabase Closed-Test RPC Boundaries

Decision: revoke direct `EXECUTE` on Supabase's `public.rls_auto_enable()` event-trigger function from `PUBLIC`, `anon`, and `authenticated`, while keeping the existing event trigger enabled. Daily AI quota dates are explicitly calculated as Beijing calendar days with `Asia/Shanghai`.

Reason: closed-test users should not be able to call infrastructure maintenance functions directly, and quota reset behavior must be product-explicit rather than depending on the database session `TimeZone` or `current_date`.

Boundary: `public.get_my_access_state()` and `public.reserve_ai_daily_quota(text)` intentionally remain `SECURITY DEFINER` RPCs executable only by `authenticated`. They are kept because RLS blocks direct writes to quota/access tables and the server needs a narrow, atomic, current-user RPC to read self status and reserve quota before upstream AI calls. Both functions use fixed `search_path`, `auth.uid()` as the only user identity source, no dynamic SQL, no prompt/project-content persistence, no cross-user parameters, and return only the caller's own access/usage snapshot.
## 2026-07-10: Default GrsAI Image Model to `nano-banana-2-lite`

Decision: add the provider-documented `nano-banana-2-lite` model to the static client-safe catalog and make it the default image-generation model.

Reason: the model uses the same request shape and 440-point rate as `nano-banana-fast`, while the project explicitly selected it as the new default.

Boundary: the model is enabled from provider documentation but is not marked smoke-test verified until a paid generation succeeds. It does not add size controls or change image persistence, reference, operation, or delivery semantics.
## 2026-07-10: Preserve Parallel Design Definition Alternatives on Canvas

Decision: explicit multi-option design-definition generation creates vertically stacked peer drafts. Applying a `createDesignDefinition` proposal creates an independent definition object at that draft's canvas position and makes it current; the previous definition remains visible as non-current. `reviseDesignDefinition` continues to reuse the same object and append a revision.

Reason: alternative definitions represent different product strategies, not successive edits to one strategy. Reusing the current object made one option overwrite another visually and removed the user's ability to switch between candidates.

Boundary: only one definition is current effective at a time. Canvas position remains visual organization only, and switching current definition does not move, delete, or merge definition objects.

## 2026-07-10: Compact Agent Context Without Replaying Tools

Decision: extend the existing `ConversationCheckpoint` data contract for migration and audit compatibility, while the controlled Agent path uses a project-wide `ConversationSummaryRevision` boundary and the fixed Context Policy documented below.

Reason: the Agent previously sent only the last eight global messages, which bounded request size but silently discarded older discussion continuity. The current project-wide summary boundary preserves continuity while keeping the full visible transcript and real project state unchanged; legacy lane fields remain only for migration and traceability.

Boundary: the legacy checkpoint is not the current Agent history boundary. The project-wide summary changes provider input only. It does not delete or rewrite `workspace.ai.messages`, change project facts, expose token meters in the UI, add a dependency, or alter the workspace schema. The latest tool-call/output tail is protected, and a provider context-limit failure retries the provider request exactly once without rerunning completed client-side tools or project mutations. An exact `/compact` command rolls all eligible project messages after the previous summary boundary through bounded summary-only calls. No canvas or project-state tool is available, and only the final summary is persisted after every chunk succeeds.

## 2026-07-13: Stream Agent Responses With Ordered, Safe Process Parts

Decision: use OpenAI-compatible `/responses` SSE as the primary Agent protocol and persist optional ordered `AiMessage.agentTrace` parts under workspace `schemaVersion: 14`.

Reason: a completed JSON response leaves the user without real feedback for long Agent runs and cannot preserve the true order of reasoning summaries, commentary, provider activity, local-tool execution, and final text. The response stream now surfaces only API-returned reasoning summaries and explicit commentary phases; it never derives or displays hidden reasoning content.

Boundary: `agentTrace` stores concise user-facing parts only, not raw SSE, encrypted reasoning, provider headers, API keys, raw tool arguments, hidden chain of thought, or diagnostic HTML. Final answer text remains in `AiMessage.body`. Agent traffic uses `/responses` only. A transient streamed gateway failure may retry and recover through a buffered `/responses` request; it never switches to `/chat/completions`. System and user input uses `input_text`; persisted assistant history uses `output_text`, which this compatibility provider requires for a successful multi-message Response. Every Morpho Agent function tool uses `strict: false` because the provider returns 502 for otherwise valid complex strict schemas; local argument parsing remains the authoritative strict field, type, enum, and business-rule validation before tool execution. Explicit provider phases remain authoritative; unphased text is buffered and classified only from the presence of a tool call in the same model turn, never from prose heuristics. Client-side workspace tools remain local. The internal 28-turn, 18-minute, and normalized repeated-tool guards are recovery mechanisms, not user-visible steps; they request one tools-free finalization and preserve completed trace, citations, tool outputs, images, and project writes.

Implementation hardening: normal turns and `/compact` share one SSE consumer. Provider attempts carry stable IDs, context-limit retry emits a reset boundary, and late failed-attempt events are ignored. Request or response-reader cancellation aborts the route-owned upstream signal. Provider usage uses one strict normalizer, including the valid `total - output` fallback. Agent trace, tool, operation, continuity, and final-message writes use the latest functional workspace boundary; text deltas are batched at roughly 48ms while activity transitions remain immediate. The disclosure is a mounted, bounded, scroll-following 200ms interaction with glyph-only shimmer and reduced-motion fallback. These changes add no dependency and do not alter workspace schema 14.

## 2026-07-13: Let Agent Evidence Gathering and Validated Visual Plans Finish Naturally

Decision: remove low per-Agent-turn accumulated count gates for hosted web search, local `search_web_evidence`, and automatic image generation. Search continuation is determined by remaining evidence gaps, and a validated visual plan executes without a quantity-only confirmation.

Reason: different search angles and follow-up keywords are legitimate parts of comprehensive research, while a requested five- or six-image batch is not inherently a higher-impact project mutation than a smaller new-image batch. Fixed low counters turned otherwise valid work into failures or unnecessary confirmation cards.

Boundary: every local search response remains bounded to five sources and accumulated citations are deduplicated by normalized URL and content. Equivalent consecutive searches still trigger the normalized repeat guard, while different queries do not. Image plan/reference validation, provider quota and API validation, four-request concurrency, pending slots, per-item writes, partial-failure retention, and cancellation remain unchanged. Confirm mode, explicit `request_confirmation`, and existing high-impact project decisions also remain unchanged. The 28-turn and 18-minute guards still stop further tools and request one tools-free summary from all completed results.

## 2026-07-12: Add Cloudflare Workers Deployment Through OpenNext

Decision: add `@opennextjs/cloudflare` and Wrangler as development dependencies, with a separate `open-next.config.ts`, `wrangler.jsonc`, and `cf:*` scripts for Cloudflare Workers deployment.

Reason: Morpho is a full Next.js application with authenticated route handlers and streaming AI responses, so Cloudflare deployment needs a Workers runtime adapter rather than static Pages export. The Cloudflare-only build uses Webpack plus Next standalone output because the current OpenNext Windows preview cannot load Turbopack server-runtime chunks. The standard `build` script remains `next build` so the existing Vercel deployment path is unchanged.

Boundary: OpenNext does not support Next's Node Runtime `proxy.ts`, so the existing request-auth logic is preserved in the Edge-compatible `src/middleware.ts` convention with the same matcher and redirects. The initial Worker otherwise uses only OpenNext's generated entry and static-assets binding with `nodejs_compat`. It does not create or bind KV, R2, D1, Queues, Durable Objects, custom domains, DNS configuration, Cloudflare Images, or a replacement persistence layer. Project workspaces and binary assets remain browser-local in `localStorage` and IndexedDB.

Status update (2026-07-14): Vercel is the active deployment target. The normal Next.js development and build paths must not initialize OpenNext or load `.dev.vars`; Cloudflare support is dormant unless an explicit `cf:*` command is run.

## 2026-07-13: Converge AI Continuity, Memory, Agent, And Image Planning In Schema 15

Decision: upgrade the workspace to `schemaVersion: 15` and make `/api/ai/agent` plus OpenAI-compatible Responses the only formal AI-panel runtime. Replace lane-filtered recent history with one project-wide compaction boundary, add a source-driven revisioned Memory Kernel and current Stage Records, resolve task strategy through a versioned Prompt Registry, and compile structured visual intent through deterministic reference resolution and `ImagePromptCompiler` before `/api/ai/image`.

Reason: the previous checkpoint, memory-view, legacy chat, and model-authored image-prompt paths could each work in isolation while disagreeing about what the Agent knew, what counted as project memory, which path owned delivery drafting, and why an image used particular references. One runtime and one persisted contract are required so history questions, progress questions, semantic updates, delivery drafts, visual batches, backup/restore, and the generated case study behave consistently.

Boundary: raw chat and legacy checkpoints are preserved for audit and migration; lane keys are labels only. A valid summary advances its boundary atomically and never deletes messages. Seven memory documents and six possible stage records are projections over real project state plus locally authorized exact-quote semantic entries, never a second fact source or model-managed files. `/api/ai/chat` remains compatibility-only with no formal-panel caller. `1 / 2 / 4 / 6` are UI shortcuts, not backend limits; explicit positive counts and more than three directions remain valid. High-impact decisions retain confirmation boundaries, generated images never overwrite sources, and provider reasoning or hidden chain of thought is never stored as memory.

Implementation note for the superseded baseline: the current replacement is recorded below. A context-limit failure may perform one replay-safe server retry and, when needed, one client summary/retry without replaying completed local tools. Editable backup defaults to full AI continuity. Migration canonicalizes JSON-omitted fields and collapses consecutive equivalent current revisions so repeated schema-15 parse and case-study upgrade are idempotent. No dependency or external service was added.

## 2026-07-21: Fix Morpho Context, Memory, Reference, And Decision Convergence

Decision: make `src/domain/morpho/agentContextPolicy.ts` the sole production Context Policy source with `windowTokens=256000`, `prepareTokens=204800`, `compactTokens=230400`, and `targetUncompressedTokens=16000`. The client and `/api/ai/agent` server map their budgets from this module; `MORPHO_AI_CONTEXT_*` variables are no longer parsed or documented as production controls.

Reason: Morpho must preserve one stable internal behavior across Vercel, OpenAI-compatible providers, and model changes. `prepare` is a non-destructive planning state; only the 90% compact threshold creates a validated persistent summary. The non-production browser override remains only for deliberate low-threshold acceptance and is rejected in production.

Boundary: every formal Agent request receives a bounded current Memory Kernel projection and task-relevant Stage Record. Full revisions, source details, old decisions, hidden objects, and raw history remain explicit-read material. UI-only compaction/status messages remain visible and auditable but are excluded from model input, summaries, and normal history search. Long-term memory still requires exact user evidence and a locally authorized tool write; the end-of-turn guard can require one explicit submit or structured skip, but never writes directly.

Decision records are classified against current structured state without deletion: `current`, `superseded`, `historical`, or `reviewRequired`. User-explicit, selected, direct-parent, and current-default visual references may cross directions and carry source/target metadata; weak automatic direction references remain direction-compatible and record omission reasons. No dependency or external service was added.

## 2026-07-22: Keep Provider Input Stable And Image Editing Claims Honest

Decision: formal Agent requests use a canonical stable system prefix, a deterministic `standard` / `standardWithWebSearch` tool profile, and append-only provider-only Context Frames for project state, turn context, runtime configuration, and conversation summaries. Prompt cache fields are an opt-in relay capability, disabled by default and generated only from a hashed project ID, model, prompt contract, and tool profile. The fixed Context Policy remains `256000 / 204800 / 230400`, while `targetUncompressedTokens` and `responseReserveTokens` remain independent values.

Reason: cache correctness depends on an exact public prefix, while project state and task scope are expected to change. Putting those changing values in the system prefix would destroy prefix reuse; removing them would damage Agent correctness. Persisted frames preserve the full project conversation and can be archived/restored without exposing provider diagnostics or secrets as normal chat.

Boundary: Context Frames are `providerOnly`, are not visible chat bubbles or ordinary conversation-search hits, and retain raw frame history while the active provider timeline selects applicable latest state. Prompt cache miss or a compatible 400 fallback never changes task correctness. GRSAI currently accepts reference images and image-to-image requests; Morpho may describe prompt-level `directedEdit`, but no mask/inpainting parameter exists, so `maskedLocalEdit` is unavailable, pixel-level preservation is not promised, and every generated image remains a new object.

## 2026-07-22: Persist Provider-Visible User Input And Causal Frame Positions

Decision: every formal user turn persists an immutable `providerInputSnapshot` containing only provider-visible text, prompt contract version, stable attachment references, and a serialized text hash. Provider replay uses the snapshot before current workspace state, while old messages fall back to raw text with an explicit `legacyProviderInput` boundary. Context Frames carry a monotonic sequence and placement; summary frames are keyed by `provider-frame-conversation-summary:<summaryRevisionId>` and duplicate active frames are removed idempotently without deleting summary revisions.

Reason: Responses requests are ordered input transcripts and prompt caching requires an exact stable prefix. Persisting only the raw UI draft caused the next request to diverge when Morpho had added selection counts, document extracts, or images. Persisting full provider responses or image Base64 would leak unnecessary data and make restore brittle, so tool transcript items remain request-local and deterministic reconstruction is used for the minimum post-tool state contract.

Boundary: Project State contains task-independent facts; Turn Context owns strategy, selection, authorization, document/image scope, and task memory; Runtime Configuration contains only semantic runtime changes. Client and server use one input estimator. Cache key/retention are opt-in, `in_memory` is never forwarded, and only explicit compatible `24h` is allowed; cached usage is classified as unavailable, miss, partial hit, or full hit.

## 2026-07-24: Make The Server Authoritative For Agent Provider Contracts And Turn Leases

Decision: `/api/ai/agent` constructs Prompt Contract v3.3, the stable System item, canonical Runtime Item, fixed Tool Registry, effective Tool Profile, and Provider request limits on the server. Client input is parsed with an allowlist and cannot provide a System item, Tool schema, `previousResponseId`, Provider-private field, or unsupported content. Project, memory, object, document, web, historical frame, and conversation-summary source text remains untrusted `user` data. Conversation compaction uses a server-owned `conversationSummary` profile with no tools and a fixed JSON-only directive. Each first request atomically creates a short-lived Supabase Agent Turn Lease; Provider transcript continuations, same-turn fresh transcripts such as compaction, and Agent web searches must increment the same user-bound lease before external execution.

Reason: an authenticated browser must not be able to turn Morpho's Provider key into a general-purpose proxy, forge continuation to bypass daily quota, or elevate project text into trusted instructions. Responses and prompt caching also depend on exact ordered input, so the server-filtered Tool Profile and Runtime Item must be the items actually sent on the first call and replayed on continuation.

Boundary: Supabase stores only user/turn/lease IDs, status, timestamps, terminal outcome, and bounded provider/search counters. It stores no prompt, workspace, transcript, object, document, or image data. RPCs derive identity only from `auth.uid()`, use a fixed `search_path`, lock quota/lease rows for atomic counters, expire after 20 minutes, and grant execution only to `authenticated`. `leaseContinuation` reuses quota and counters only; it never claims an exact Provider transcript continuation and cannot be combined with `continuation`. Stable high-impact state changes still require explicit user authority; exact user evidence authorizes memory writes, and Tool Effect metadata does not weaken existing product confirmation rules. Prompt/cache manifests persist hashes and semantic metadata only, trace persistence is bounded with truncation markers, and paid cache capability remains unverified until separately authorized.
# 2026-07-26: Canonical strategy items and fixed Agent tools

- Task strategy is a bounded client marker only: `{ type: "morpho_strategy", strategy, anchorMessageId }`.
- The Agent route validates the marker, removes it from client input, and materializes a server-owned System item at the original user-turn position.
- Historical user messages retain `taskStrategy`, so uncompressed transcript replay preserves strategy changes exactly. A conversation summary establishes the next baseline.
- The standard Function Tool registry always includes `create_comparison_analysis`. Explicit comparison intent is enforced by local execution authorization, not by changing Provider tools or cache identity.

# 2026-07-26: Causal Agent Turn Lease

- Agent Turn Lease continuation is a sequence-checked capability, not a generic same-turn retry flag.
- The database stores only SHA-256 request/manifest hashes, sequence counters, continuation kind, and canonical runtime item id. It never stores request bodies, workspace content, prompts, or credentials.
- Initial retries are idempotent only for the same user, turn id, and initial request hash. Continuations use atomic sequence compare-and-swap and distinguish `providerContinuation`, `conversationSummary`, and `webSearch`.
- The database web-search safety counter is 32. Local duplicate-query, source, timeout, and abort guards remain the primary bounded-execution controls.

# 2026-07-26: Bounded Provider cache diagnostics

- Only `workspace.ai.latestProviderRequestState` retains the latest full cache item manifest.
- Historical assistant traces retain compact request state and cache diagnostics but never duplicate full manifests.
- Workspace normalization strips manifests from legacy traces. Full project backup/restore retains the latest state; human-readable archives do not need to expose cache internals.

# 2026-07-26: Lease-bound Provider execution and signed continuation

- A repeated first request with the same initial hash is a real Provider execution. `start_agent_turn_lease` advances `provider_call_count` and `next_provider_sequence` for it, charges the daily text quota only once per turn, and fails closed at the 32-call ceiling. Advancing the sequence retires the superseded attempt's continuations.
- `postCompaction` is a distinct continuation kind. A transcript rebuilt after a summary is no longer recorded as an exact Provider transcript continuation, and it is accepted only directly after a server-owned `conversationSummary`.
- Ordering is not causality. Every completed Provider response carries an HMAC binding over the request prefix, the exact output items, and the call ids that were made; an exact continuation is accepted only when the submitted input replays that binding. The token holds identifiers, counts and digests only, lives 20 minutes, and is never persisted with the workspace.
- The signing key is `MORPHO_AGENT_CONTINUATION_SECRET` when set, otherwise a domain-separated derivation from `MORPHO_AI_API_KEY`. Both are server-only and stable across instances; a per-instance key would break continuations.
- Web search consumes a lease sequence before it can fail, so every exit of the search route reports the sequence the server expects. A lost search response may resynchronize once per turn; Provider continuations stay strict because the binding already pins them.

# 2026-07-27: Close signed Agent continuation and compaction boundaries

- Provider transcript continuation is a v5 HMAC capability, not a sequence-only retry. The signed claim binds the unchanged prefix, exact Provider output, Call IDs, domain-separated SHA-256 transcript digests, and compaction receipt scope; prefix, appendable, and compaction Context markers are ordered manifests rather than unordered hash sets. Tool-created state markers bind the signed Call batch and every unique terminal output.
- Conversation compaction uses a restricted descriptor and a server-created v4 receipt. The receipt binds SHA-256 summary/tail/source/manifest hashes, a continuous source boundary, previous-summary identity, summary revision, prompt contract, lease/turn/sequence scope, ordered Context marker metadata, and expiry. It is carried only inside the transient continuation token and is never written to Supabase or workspace message bodies.
- A lost Agent web-search response gets one read-only `read_agent_turn_lease_state` recovery to refresh the sequence, then the failed search is submitted as a terminal tool result without replaying the query. A second transport loss or failed recovery terminates the turn safely; standalone search is unchanged.
- Context compaction is bounded by both token and Item pressure, with at most two continuation compactions and a strict reduction requirement. The shared function-call ceiling is 64 across provider parsing, streaming, tool-batch finalization, and continuation signing; over-limit output fails closed before any Call executes.

# 2026-07-28: Close cross-turn transcript and Context authority

- Every completed non-summary Provider request signs an output-inclusive durable transcript checkpoint and persists it only in `workspace.ai.latestProviderRequestState`; historical traces strip both its manifest hash and token. The 24-hour ordinary-use window is renewable only inside one fixed 180-day lifetime at `/api/ai/agent/snapshot/refresh`, which performs explicit authentication but no Provider or Lease work. Snapshot v3 binds both project and user. Current unexpired tokens are used directly; current expired tokens refresh without a client manifest, while compatible legacy text manifests require an exact closed-transcript upgrade candidate that excludes the fresh user turn.
- Transcript messages distinguish `liveInput` from `durableReplay`. A live image must match every stable reference by ordered content hash; durable history contains no image bytes and must match a source in the prior user/project-bound signed checkpoint. Durable Assistant messages use an immutable raw Provider-output snapshot independently from display sanitization. Transcript manifest v3 binds message, strategy, image-reference and terminal-outcome items to workspace message IDs.
- Summary source envelope v2 has no client-authored `summaryText` or parallel `taskStrategy`. The server derives the Provider-visible source from canonical items, verifies the previous summary body against the prior signed summary hash/revision, and requires every signed Call to have exactly one terminal output before compaction.
- A Summary may carry only Context markers authorized in the exact order of the prior continuation/snapshot or newly appended through the complete current Call batch and terminal outputs. Receipt v4 binds placement, sequence, anchor and causal binding. Post-compaction verification matches a strict before-marker segment, one compaction marker, and a strict after-marker segment. Fresh current-turn frames remain receipt-bound data, and a completed post-compaction request includes those ordered frame identities in its closed snapshot.
- Lease completion can replace the intermediate Assistant Provider snapshot with one signed canonical terminal outcome: `success`, `partialSuccess`, `pendingConfirmation`, `cancelledBeforeExecution`, or `failedBeforeExecution`. Later history and summary input use that outcome item; unproved partial or pending turns fail closed instead of replaying pre-tool Provider prose.

# 2026-07-28: Require complete transcript and idempotent Turn Closure proofs

- A fresh ordinary request has exactly one final user `liveInput`, identified by the explicit `currentUserMessageId`. Every earlier durable message, strategy, image reference, and outcome must match the full ordered manifest in the authenticated user/project Snapshot. Deleted, duplicated, reordered, rebound, or edited history fails before Lease creation. Snapshot preparation is shared by ordinary and Summary paths; only expired/legacy tokens refresh, and the refreshed token/hash/expiry replace state together.
- Unsigned legacy workspaces do not promote raw chat into trusted history. They remain open and searchable, while the first new request establishes `transcriptStartMessageId` and a new server-signed boundary. Compatible signed legacy Snapshots use the controlled Refresh/Upgrade path.
- A long-lived transcript Snapshot proves history, not ownership of the current Turn. Each non-Summary Provider completion therefore issues a separate short-lived Closure Token binding user/project/Lease/Turn/sequence, current user/assistant IDs, transcript manifest, Provider-output snapshot, and terminal Call state. Success keeps only the proved Provider text; partial and pending replace intermediate promises with canonical Outcome items. Summary tokens are accepted only by the separate Summary-receipt closure route.
- Closure is a database idempotency contract. The authenticated Lease row stores one closure request ID/hash/outcome and the tool-execution marker. Exact repeats may re-materialize the same pure signed Outcome after a lost response; any changed outcome, token, manifest, or message identity conflicts. BeforeExecution is allowed without transcript proof only when the locked row proves no Provider, search, or tool execution. Client state is cleared only after server confirmation and one failed recovery ends safely.

# 2026-07-26: Turn outcome from unresolved work

- A turn keeps a ledger of unresolved work rather than a sticky "something failed" flag. A tool failure or a schema repair is cleared when the same tool later succeeds; a required-read exhaustion and the repeat guard end the turn and stay unresolved.
- `partialSuccess` means work is still unresolved at the end of the turn, not that a recovered error occurred during it.

# 2026-07-26: Context bounded by items as well as tokens

- The client budget includes the server-managed prefix (stable System prompt and canonical Runtime item) because the server prepends it to every request. Tools are estimated with web search enabled, which over-counts when the server has it off; the server remains the final authority and still fails closed above the window.
- The Provider rejects any request above 1024 input items regardless of tokens, so compaction pressure is whichever bound is closer: `compactTokens` or `compactItemCount` (880, with `prepareItemCount` 800).

# 2026-07-26: Generated images are memory sources only when anchored

- A generated image is projected into project memory and stage records as an outcome only when it is anchored in project semantics: generated from project objects, attached to a direction or visual branch, the current default reference, or used by a delivery reference.
- A one-off trial generation stays on the canvas and in the factual continuity record of the event that produced it, but it is not projected as an established outcome. Canvas presence is visual organization, not meaning.

# 2026-07-27: Playwright for browser acceptance

- Playwright is a core dependency for browser acceptance. Scope is deliberately narrow: the paths where a regression silently destroys or misrepresents project state — opening projects, canvas selection, hide/restore, anchor replacement, the undo block, reload restore, backup round trip, and Agent turn send/stream/cancel/fail plus 401 and 503.
- No acceptance test may reach a paid model or image endpoint. Agent responses are intercepted at `window.fetch` and served as a real `ReadableStream` of SSE frames produced by the production encoder, so streaming and cancellation are exercised for real and a protocol change breaks the fixtures loudly.
- The suite runs its own production server on its own port. Reusing a developer's dev server would inherit that session and Next refuses a second dev server in the same directory.
- The seed workspace is regenerated from the domain code on every run rather than committed. A committed snapshot would drift from the schema; Playwright's loader cannot import the domain layer directly because of its bare JSON imports.
- Defects the suite finds are recorded as `test.fail` expectations rather than deleted or worked around, so the fix has a test to turn green.

# 2026-07-27: Local storage capacity, measured

- Chromium grants this origin about 9.95 MiB of localStorage, not the 5 MiB commonly assumed. Quota is charged as `(key.length + value.length) * 2` — UTF-16 code units. Morpho's text is mostly Chinese, where UTF-8 sizing would overstate quota pressure by 50%, so every quota decision uses UTF-16.
- The deployable case study alone occupies 1.67 MiB, about 17% of the quota, before the user does anything.
- Measured growth per record, in quota bytes: a project memory revision 14.8 KiB, a context frame 3.7 KiB per turn, an object with its canvas instance 3.9 KiB, an Agent-trace turn 3.3 KiB, a plain chat message 0.8–1.3 KiB. Project memory revisions are the fastest-growing field by an order of magnitude and they accumulate monotonically.
- Restoring an editable backup adds about 1.2 KiB over the source project — regenerated runtime storage keys. Asset binaries live in IndexedDB and are not part of this budget.
- Numbers come from `npm run measure:storage` (content cost, from case-study records) and `e2e/storage-capacity.spec.ts` (the browser's real grant). Both are reproducible; neither is hard-coded.

# 2026-07-27: Storage durability is a separate risk from a failed write

- A rejected write announces itself and leaves the previous data intact. Eviction announces nothing and leaves nothing: Safari clears script-writable storage after seven days without interaction, and Chromium evicts whole origins under disk pressure. The two failures need different mitigations, so they are modelled separately rather than folded into one "storage problem".
- The only mitigations the platform offers are asking for persistence and, when the browser will not grant it, telling the user to keep an exported backup. `persist()` is requested once per session and never re-requested for an already-persisted origin, because Firefox raises a permission prompt for it and a prompt with nothing behind it teaches users to dismiss prompts.
- Usage is read with `estimate()`, which is the only measurement covering IndexedDB. Counting localStorage alone understates real usage by orders of magnitude on any project that has generated images, because that is where the binaries live.
- The pressure threshold is 80% of the origin quota, deliberately below full: a user warned at 99% has no room left to export a backup, and exporting allocates memory of its own.
- `unknown` is a distinct status from `bestEffort`. When there is no StorageManager, or the call throws, nothing may be claimed in either direction and the UI says nothing.

# 2026-07-27: One writer per project, across tabs

- A workspace is held whole in React state and written back as a single localStorage value, so two tabs on the same project do not merge — the second tab's debounced write replaces everything the first tab did, including a completed Agent turn, while both tabs report "已保存". No storage-layer check can catch this afterwards, because the write that destroys the work is a perfectly valid write.
- Web Locks is the primitive: origin-scoped, released automatically when the holding tab closes or crashes, and never outliving the browser session. A stored lock flag could strand a project read-only forever after a hard kill.
- The request uses `ifAvailable: true`, so a second tab learns immediately that the project is taken instead of queueing behind the first tab for as long as it stays open.
- The tab without the lease enters a `readOnly` phase rather than an error. "已保存" would be a lie there and "保存失败" a different one; what is true is that this tab deliberately never schedules a write.
- A browser without Web Locks, or a rejected request, yields `unsupported` and keeps the previous unprotected behaviour. An unenforceable lock must never become the reason a workspace refuses to save — that would lose more work than it protects.
- Pending writes are flushed before the lease is released, so the tab that takes over reads the latest state rather than the state as of the last debounce.

# 2026-07-27: Local write failures are classified, not summarized

- One sentence for every failure helps with none of them, because the fixes are opposite: a full origin is resolved by exporting and deleting, a blocked one by leaving private mode, and an unverified write by not trusting this browser session with more work. The store therefore reports a kind alongside the message.
- `quotaExceeded` covers Chrome and Safari's `QuotaExceededError` (code 22) and Firefox's `NS_ERROR_DOM_QUOTA_REACHED` (code 1014). `storageUnavailable` covers `SecurityError`, `InvalidAccessError` and `InvalidStateError`. `writeNotVerified` comes from reading the value back and finding something else — Safari private mode and some embedded webviews accept a write, throw nothing, and store nothing, so only the read-back catches it.
- The stage matters as much as the kind. A failed workspace write means the user's current work is unsaved; a failed catalog write means the work is already on disk and only the project list is stale. Urgent backup language in the second case is crying wolf, and users warned wrongly stop reading warnings.
- The failure surface carries its own export, and it exports the in-memory workspace rather than the copy on disk: the two have diverged, and the in-memory one is the version that would otherwise be lost. Building the bundle only reads IndexedDB and allocates in memory, so it still works when localStorage is the thing that is full.
- Storage keys stay out of user-facing text. Which key failed is an internal storage mechanic; "your change is not saved" is the fact the user has to act on.

# 2026-07-27: A crashed workspace keeps a way out

- The crash surface's purpose is to let the user leave with their data, not to explain the error. It offers an export before anything else.
- `global-error.tsx` replaces the root layout, so it owns `<html>`/`<body>` and cannot inherit the layout's stylesheet import; it imports the stylesheet itself.
- It identifies the project from `window.location.pathname` rather than route params, because the boundary can catch a failure that happened before the route segment resolved, and the export path only needs a localStorage key. The parse is deliberately conservative: offering an export for the wrong project id would produce a backup of something the user did not ask for, which is worse than offering none.

# 2026-07-27: Deleting a project reclaims blobs only when ownership is provable

- Deletion is the only way a user can reclaim local space, so it has to reclaim the part that actually costs space: the IndexedDB image blobs. A blob deleted out from under another project shows up as a permanently broken image with no way back, so the reclaim is gated on proof rather than assumption.
- Ownership is computed before anything is removed: a blob is deleted only when no other stored workspace still references its storage key. The scan reads every `morpho.project.*.workspace.v1` entry rather than only catalogued ones, because a workspace missing from the catalog is still recoverable data and its references still count.
- An unreadable neighbouring workspace is the absence of evidence, not evidence of absence. While any stored workspace fails to parse, nothing is reclaimed at all — reclaimed space is worth less than an image no project can ever get back.
- Deletion is planned and shown before it is committed, including how many blobs it would remove, and the confirmation offers an export first.


# 2026-07-27: Performance is measured before it is optimized, in two separate layers

- No optimization lands without a number behind it. The measured baseline lives in `docs/architecture/performance-baseline.md`; a change that cannot point at a figure there is a guess, and guesses are what this harness exists to replace. Two of the hypotheses the harness was built to confirm were in fact refuted by it, which is the whole argument for measuring first.
- The split is not "pure versus impure" but "is the answer a deterministic function of input size, or a property of the browser's main thread". Node measures how much work is done; the browser measures when that work blocks someone. Conflating them produces numbers nobody trusts: reconcile can cost 8ms as a Node fact and still ruin typing because `flushSync` drops it into an input handler.
- `vitest bench` was rejected despite tinybench already being present as a vitest dependency. The artifact is the deliverable — phase 4C has to cite a stable path and key — and bench output is keyed by file/suite/name, so a rename silently orphans history, with nowhere in its schema for the environment block or the calibration ratio that make a number portable. The repo already has a working idiom for this: tested logic in `src/`, a thin `.mjs` driver, a committed `*.generated.json`, a runbook section.
- Every figure carries a calibration ratio against a fixed reference workload, because absolute milliseconds do not survive a change of machine and ratios do. CPU occupancy is sampled from `process.cpuUsage()` rather than `os.loadavg()`, which is permanently `[0,0,0]` on Windows.
- The trust gate has two ways to pass, because timings fail in two ways. Either the whole distribution is tight, or the median reproduces across independent interleaved rounds while the tail stays spiky. The second exists for allocation-heavy work: SSR rendering shows 27% relative margin of error around a median that repeats to within 1.3%, and rejecting that would discard a sound measurement while accepting it blind would hide a real GC tail. Both are reported.
- Benchmark units are batched until each timed sample clears a 5ms floor, sized automatically from a post-warmup probe. Below that, timer resolution dominates and reports tens of percent of error for code that is simply too fast to time — an instrument defect that reads as a code defect.
- Units are rotated by target rather than by scenario. Grouped by scenario, an allocation-heavy target's garbage collection lands inside the next scenario's unrelated target: `renderConversation` at 300 objects read 23.09ms grouped that way and 2.77ms in isolation, an 8x error that would have entered the baseline as a false finding about object count.
- Browser instrumentation ships in no product file. A stubbed `__REACT_DEVTOOLS_GLOBAL_HOOK__` gives exact commit counts from the ordinary production build, and Long Animation Frames plus Event Timing need no instrumentation at all. Adding `performance.mark` to application code to serve a harness would be exposing internals as product surface.
- The performance suite never runs in CI. A latency number from a shared, virtualized runner would carry the authority of an official result and the reliability of none, and a flaky perf assertion teaches a team to ignore red. The spec records numbers and asserts only that a measurement happened at all: the seed wrote, the canvas mounted, the probes produced data.
- Performance fixtures are kept apart from the storage footprint fixtures. Storage cost is additive, so those grow one axis at a time and per-record attribution stays valid; time cost is not, because reconcile walks objects, continuity entries and messages in a single pass and the interaction term only appears when the axes rise together. Keeping them separate also keeps `storage-footprint.generated.json` byte-stable.
