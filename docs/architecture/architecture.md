# Morpho Implemented Architecture

## Current Runtime

Morpho is a single Next.js App Router application in this repository root.

Implemented routes:

- `/` renders the local project homepage.
- `/projects/[projectId]` renders the Morpho workspace for one local project.
- `/api/ai/chat` proxies server-side MiMo streaming chat.
- `/api/ai/image` proxies server-side GrsAI image generation and returns the generated image bytes.

Important module boundaries:

- `src/app/` owns Next.js routes.
- `src/features/projects/` owns the local project homepage UI.
- `src/features/workspace/` owns the visible workbench experience.
- `src/domain/morpho/` owns product-domain types, seed data, deterministic domain actions, import helpers, generation helpers, and queries.
- `src/infrastructure/persistence/` owns browser localStorage project catalog and workspace access.
- `src/infrastructure/assets/` owns browser IndexedDB Blob storage and asset-save workflow.
- `src/server/ai/` owns MiMo provider config, request validation, context conversion, and streaming normalization.
- `src/server/image/` owns GrsAI provider config, request validation, bounded polling, and remote image download.

No database, authentication, cloud object storage, Supabase, multiplayer sync, export pipeline, or deployment automation is implemented.

## Data Model

Structured workspace data is schema version `6`.

Current workspace state includes:

- stable Morpho domain objects in `workspace.objects`;
- binary or link metadata in `workspace.assets`;
- stable delivery snapshots in `workspace.deliveryReferences`;
- scoped semantic decisions in `workspace.decisionRecords`;
- visual-only canvas instances in `workspace.canvas.instances`;
- persisted workspace UI state in `workspace.ui`;
- continuous AI messages in `workspace.ai.messages`.
- lightweight Operation records in `workspace.operations`;
- Artifact Proposal records in `workspace.artifactProposals`;
- citation snapshots in `workspace.citationSnapshots`.
- revisioned design definitions in `workspace.designDefinitionRevisions`;
- revisioned concept directions in `workspace.directionRevisions`;
- direction lineage records in `workspace.directionLineage`;
- lightweight visual branch records in `workspace.visualBranches`;
- derived working state in `workspace.workingState`;
- current stage snapshots in `workspace.stageRecords`.

Operation persistence is intentionally lightweight:

- workspace JSON stores operation status, summaries, input snapshots, proposal records, citation snapshots, and IndexedDB artifact references;
- workspace JSON does not store raw webpages, large extracted document content, page preview binaries, provider raw responses, API keys, or response headers;
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
- `StageRecord` stores the current stage snapshot, not an append-only operation log.

## Local-First Persistence

Project catalog and structured workspace JSON use localStorage:

- catalog key: `morpho.projects.catalog.v1`;
- workspace key: `morpho.project.${projectId}.workspace.v1`;
- legacy single-project key `morpho.workspace.nightrail.v1` is read for migration only.

Binary files are not stored in localStorage. Imported images/files and generated image results are saved as Blobs in IndexedDB:

- database: `morpho-assets-v1`;
- object store: `asset-blobs`;
- workspace objects reference assets by `assetId`;
- assets contain filename, MIME type, size, creation time, storage key, source type, and optional intrinsic image dimensions.

The current code does not implement asset garbage collection. Deleting a canvas object does not delete Blob data.

## Import, Search, Assets, Hidden

Implemented import paths:

- paste image to image object;
- paste text to editable text object;
- drag/drop files to image or file objects;
- drag/drop URL to link object;
- top import button to current viewport area.

Asset panel and search are real workspace queries:

- assets list imported images, files, links, generated images, and future document extracts;
- search covers object titles/text, filenames, URLs/domains, concept/research/definition text, and delivery reference snapshots;
- hidden objects can be found and restored, but hidden objects are not included in default AI context.

## AI Providers

Text chat:

- Browser calls `/api/ai/chat`.
- The route reads `MORPHO_MIMO_*` only on the server.
- MiMo is called through an OpenAI-compatible streaming chat adapter using the server-side `api-key` header.
- The browser receives normalized NDJSON stream events: `delta`, `citations`, `done`, and `error`.
- Milestone 3 task routing uses explicit `taskMode` from the user send action. Regex and suggestion chips may recommend a task mode, but they are not execution authority.
- For `chatAnalysis` and `researchOperation`, selected active image assets are read from IndexedDB and sent through an adaptive visual input pack. Small selections are sent as individual compressed images; larger selections are represented by one or more generated contact sheets so every selected image participates without a user-visible image count limit. The server sends the resulting images as OpenAI-compatible `image_url` content to the configured multimodal model.
- Hidden images, unselected old images, default references, and whole-canvas screenshots are not sent by default.
- When `MORPHO_MIMO_WEB_SEARCH_ENABLED=true`, `chatAnalysis` and `researchOperation` provide MiMo native `web_search` to the model. The model decides whether the current request needs external verification or source supplementation. `imageGeneration` never receives web search tools.
- Citation snapshots are created only from provider citation/annotation fields. Morpho does not fabricate sources from normal assistant text.
- `MORPHO_MIMO_API_KEYS` is preferred over `MORPHO_MIMO_API_KEY`; legacy `MORPHO_MIMO_API_KEY_2` and `MORPHO_MIMO_MODEL` are read only as compatibility fallbacks.

Image generation:

- Browser calls `/api/ai/image`.
- The route reads `MORPHO_GRS_*` only on the server.
- GrsAI uses `POST /v1/api/generate` and, when needed, bounded polling on `GET /v1/api/result?id=...`.
- GrsAI image models are exposed through a static, client-safe catalog. The current default is `nano-banana-fast`, the lowest-point available image model in the catalog.
- The right-side image task UI lets the user choose model, aspect ratio, and model-supported size option for the current request only.
- GrsAI request parameters are selected by server-side model profile. `nano-banana-*` models send `replyType: "json"` and send `imageSize` only when the selected model supports a size option; `gpt-image-2` sends pixel-style `aspectRatio`, `replyType: "json"`, and no `imageSize`.
- The server downloads the final remote result URL and returns image bytes to the browser.
- The browser stores the returned image Blob in IndexedDB and creates a new `ImageObject` plus canvas instance.
- Imported and generated images share the same canvas size helper, using intrinsic asset dimensions when available and `contain` display semantics on the canvas.
- Generated `ImageObject` records include generation metadata: model id, model label, aspect ratio, optional size option, prompt, reference object IDs, optional direction ID, and creation time.
- Image generation operations persist `operationId`, `clientRequestId`, optional provider task ID, status, prompt, references, model/profile, and timing. Uncertain network responses are not automatically resubmitted.
- Visual generation can start from selected images, concept directions, design definitions, or a text prompt. Source/version relations are created only when image sources are present; selected concept directions create `belongsToDirection`.

AI boundary:

- AI can reply, analyze, suggest, and generate editable text or image results.
- AI does not directly mutate domain state such as deletion, hidden state, direction status, default reference, delivery references, or project memory.
- Image generation always creates a new image object and never overwrites a source image.
- MiMo visual input is explicit and bounded by selected active images only. It is adaptively compressed or packed into contact sheets before upload, and never stored as Base64 in workspace/localStorage.
- If image read/compression fails, the chat falls back to object metadata and user text and tells the user that pixels were not sent.

## Demo Project

The seeded migrated project remains the official demo:

- `夜航 / Nightrail`
- Main direction: `方向 A：柔光轨道`
- Default reference image: `柔光轨道 v2`
- Alternative direction: `方向 B：家具化支撑岛`
- Eliminated direction: `方向 C：软性引导带`

Historical `Nightfield`, tactical-tool, and “安静的仪器” demo content is not used.
