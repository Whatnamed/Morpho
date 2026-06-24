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

Structured workspace data is schema version `3`. Milestone 3 will upgrade this to the next schema version when Operation records and proposals are persisted.

Current workspace state includes:

- stable Morpho domain objects in `workspace.objects`;
- binary or link metadata in `workspace.assets`;
- stable delivery snapshots in `workspace.deliveryReferences`;
- scoped semantic decisions in `workspace.decisionRecords`;
- visual-only canvas instances in `workspace.canvas.instances`;
- persisted workspace UI state in `workspace.ui`;
- continuous AI messages in `workspace.ai.messages`.

Milestone 3 Operation persistence is intentionally lightweight:

- workspace JSON stores operation status, summaries, input snapshots, proposal records, citation snapshots, and IndexedDB artifact references;
- workspace JSON does not store raw webpages, large extracted document content, page preview binaries, provider raw responses, API keys, or response headers;
- interrupted operations are recoverable as local state, but they are not treated as background server jobs after refresh.

Canvas rendering is separated from Morpho domain state:

- Morpho objects are stable domain records in `src/domain/morpho/types.ts`.
- Canvas placement lives only in `canvas.instances`.
- tldraw custom shapes store `objectId` and `instanceId` only as a rendering bridge.
- Moving a shape updates canvas instance position; it does not change object type, status, relation, direction state, default reference, or delivery inclusion.
- tldraw renders only canvas instances whose source object exists and has `visibility: "active"`.

Semantic boundaries retained from schema v2:

- hide, delete, and eliminate remain different operations;
- delivery modules reference `DeliveryReference` IDs, not live source object IDs;
- delivery references store independent display snapshots;
- decision records are limited to project-level semantic decisions;
- default reference changes do not rewrite old images, version chains, or delivery references.

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
- MiMo is called through an OpenAI-compatible streaming chat adapter.
- The browser receives normalized plain text stream chunks.
- Milestone 3 task routing uses explicit `taskMode` from the user send action. Regex and suggestion chips may recommend a task mode, but they are not execution authority.
- MiMo image-pixel input and web search remain capability-gated until their official wire format and citation shape are verified.

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
- The current MiMo text chat route does not send image pixels. Until MiMo official visual input is implemented, image discussion in the text route is based only on object metadata and user descriptions.
- `src/server/ai/request.ts` has a metadata-only attachment summary boundary reserved for future visual attachment conversion.

## Demo Project

The seeded migrated project remains the official demo:

- `夜航 / Nightrail`
- Main direction: `方向 A：柔光轨道`
- Default reference image: `柔光轨道 v2`
- Alternative direction: `方向 B：家具化支撑岛`
- Eliminated direction: `方向 C：软性引导带`

Historical `Nightfield`, tactical-tool, and “安静的仪器” demo content is not used.
