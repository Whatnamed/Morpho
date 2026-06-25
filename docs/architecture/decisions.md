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

Boundary: `workingState` and `stageRecords` are derived and stored for fast local reads, but they are not the sole source of truth. Authority remains with formal objects, revisions, relations, and decision records. Schema v5 still does not introduce PDF runtime, delivery-plan runtime, or archive export.

## 2026-06-25: Treat Image Role Changes as Visual-Development Decisions

Decision: image role changes go through the `setImageRole` domain action and write a `setImageRole` decision record.

Reason: M4 visual development needs images to carry explicit roles such as scene visual, CMF study, detail study, structure diagram, and delivery asset without inferring those roles from canvas position or proximity.

Boundary: changing an image role does not set a default reference, does not move the image into a direction, does not hide other images, and does not create a new version. Direction assignment and image generation remain separate actions.

## 2026-06-25: Make Task Mode the Execution Authority

Decision: user-send `taskMode` controls whether a request is chat/analysis, image generation, or research operation.

Reason: selected images and broad text regexes previously risked routing ordinary questions into GrsAI image generation.

Boundary: regexes, selected object types, and suggestion chips may set a recommended task mode, but they cannot silently change the execution path.

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
