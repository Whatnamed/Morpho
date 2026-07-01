# Morpho Runbook

## Install

Use the repository `.npmrc` registry setting.

```bash
npm.cmd install
```

## Environment

Copy `.env.example` to `.env.local` for local AI provider calls. Do not commit `.env.local`.

Text chat through MiMo:

```text
MORPHO_AI_PROVIDER=mimo
MORPHO_MIMO_API_KEYS=
MORPHO_MIMO_API_KEY=
MORPHO_MIMO_BASE_URL=https://api.xiaomimimo.com/v1
MORPHO_MIMO_TEXT_MODEL=mimo-v2.5-pro
MORPHO_MIMO_MULTIMODAL_MODEL=mimo-v2.5
MORPHO_MIMO_WEB_SEARCH_ENABLED=true
```

`MORPHO_MIMO_API_KEYS` is a comma-separated primary/fallback key list. The singular `MORPHO_MIMO_API_KEY` remains a compatibility fallback only when the plural variable is empty. Existing local environments may still use `MORPHO_MIMO_API_KEY_2` and `MORPHO_MIMO_MODEL`; both are read as compatibility fallbacks, but new setups should use `MORPHO_MIMO_API_KEYS` and `MORPHO_MIMO_MULTIMODAL_MODEL`.

MiMo chat behavior:

- ordinary text uses `MORPHO_MIMO_TEXT_MODEL`;
- selected active images in chat/research use `MORPHO_MIMO_MULTIMODAL_MODEL`;
- selected active images in visual-planning `imageGeneration` requests also use `MORPHO_MIMO_MULTIMODAL_MODEL`;
- image input is limited to selected active IndexedDB image assets. Small selections are sent as individual compressed images; larger selections are packed into one or more contact sheets so every selected image is represented without exposing a user-facing upload count limit;
- hidden images, unselected images, default references, and whole-canvas screenshots are not sent by default;
- selected parsed file objects can send bounded local `documentExtract` text to MiMo for chat/research context. Extracts are local sources, not provider citations;
- selected parsed file objects can also send bounded local `documentExtract` text to MiMo for visual planning when `taskMode === "imageGeneration"` and the current task context authorizes them;
- when `MORPHO_MIMO_WEB_SEARCH_ENABLED=true`, chat/research requests provide MiMo native `web_search` and the model decides whether to use it. Image generation never receives web search tools;
- source links are shown only when MiMo returns citation/annotation fields.

Image generation through GrsAI:

```text
MORPHO_GRS_API_KEY=
MORPHO_GRS_BASE_URL=https://grsaiapi.com
MORPHO_GRS_DEFAULT_MODEL=nano-banana-fast
MORPHO_GRS_IMAGE_MODEL=
```

`MORPHO_GRS_DEFAULT_MODEL` is the current default image model variable. `MORPHO_GRS_IMAGE_MODEL` remains a legacy fallback for existing local environments.

Paid provider smoke tests are disabled unless explicitly enabled:

```text
MORPHO_ALLOW_PAID_SMOKE_TESTS=false
```

The browser image-task UI sends a selected model ID, aspect ratio, optional size option, and client request ID to `/api/ai/image`. The route still requires server-only GrsAI config, but the provider request body is normalized on the server.

Current implemented behavior:

- default image model in the UI: `nano-banana-fast`;
- selectable image models come from `src/domain/morpho/grsImageModels.ts`;
- `nano-banana-*` profiles send `replyType: "json"` and send `imageSize` only when the selected model supports a size option;
- `gpt-image-2` sends pixel-style `aspectRatio`, `replyType: "json"`, and no `imageSize`;
- generated image assets store intrinsic width, height, and aspect ratio when the browser can read them.
- image generation operations store operation IDs and client request IDs; uncertain network responses are not automatically resubmitted.
- direction-preview and visual-development generation first ask MiMo for a structured visual plan, validate selected source/direction scope locally, and then call GrsAI once per plan item.
- direction-preview supports `1`, `2`, `4`, or `6` previews per selected direction, with a hard total limit of `8` generated items per run.
- image-generation Operation metadata records the requested preview count, visual plan, successful result IDs, and per-item failures for later audit.

Milestone 3 Operation records are local-first and lightweight. Workspace JSON stores operation status, summaries, proposals, citation snapshots, and IndexedDB artifact references. It does not store raw webpages, large extracted files, page previews, provider raw responses, API keys, or response headers.

Only one active Operation is allowed per project. Browser reload marks unfinished operations as `interrupted` and keeps the input snapshot and retryable state; it does not pretend a background job continued.

Research operations can read selected parsed file extracts, selected image pixels, current workspace semantic context, and optional provider web search. A valid research result is recorded and applied into a research card automatically. Key conclusions, design definitions, concept directions, default references, direction status, and delivery decisions still require their own explicit proposal/application paths.

Conversation semantic records:

- `/api/ai/chat` may ask MiMo for `morphoProjectContinuityPatch` only for `chatAnalysis` and `researchOperation`;
- `imageGeneration` never receives the semantic patch instruction;
- provider summaries are ignored, and Morpho creates deterministic summaries locally from the exact user quote;
- the exact quote must come from the current user message and is stored only as a short message source snapshot;
- semantic patch writing is skipped on invalid output, failed/cancelled requests, image-generation tasks, or replies that also contain design-definition or concept-direction Proposal JSON;
- research replies may contain both `morphoResearchProposal` and a valid semantic patch. The patch is authorized only from the pre-request task context and local persisted user message, and it must not reference the newly created research card;
- semantic `scope` filters provider context and task-filtered memory views, not the project-record drawer. Unrelated direction/visual scoped entries are excluded before the continuity budget is applied;
- if the source user message is removed, its message ref becomes `missing`, the entry keeps the quote snapshot, and it no longer enters factual memory or provider context;
- streaming display hides complete and trailing partial `morphoProjectContinuityPatch` JSON. The original completed stream remains available to parsers;
- successful writes show `已补入项目记录 · N 条` under the assistant message. The button opens/highlights records only; it does not trigger AI, change current focus, or mutate objects.

Conversation checkpoints:

- ordinary `chatAnalysis` discussion/comparison may ask for a bounded `morphoConversationCheckpoint` only after local deterministic thresholds are met;
- no extra provider call is made for checkpoint generation;
- the checkpoint is stored in `workspace.ai.conversationCheckpoints`, not `projectContinuity`;
- lane anchors come only from explicit active selection plus directly selected/selected-image direction and branch IDs, not from auto-included task-context objects;
- provider request context may include the current checkpoint plus a few recent raw messages instead of the whole transcript;
- the current draft is sent separately and is not duplicated in `messages`;
- pending proposals suppress checkpoint request and checkpoint write;
- checkpoint JSON is hidden from visible chat, including malformed and streaming partial blocks;
- successful saves show only `已整理当前讨论脉络` under the assistant message;
- checkpoint failures do not affect normal replies, semantic patches, project facts, current focus, or project records.

Without these variables, the app still runs locally, but provider routes return clear configuration errors instead of fake AI results.

## Development Server

```bash
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

Expected local URLs:

```text
http://127.0.0.1:3000/
http://127.0.0.1:3000/projects/project-nightrail
```

## Checks

```bash
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected results:

- `lint`: ESLint completes with no reported problems.
- `typecheck`: `tsc --noEmit` completes.
- `test`: Vitest runs domain, persistence, import, query, MiMo, and GrsAI tests.
- `build`: `next build` completes and prerenders static pages/routes where applicable.

Manual provider smoke checks are separate from the default command set and should be run only with real `.env.local` keys and `MORPHO_ALLOW_PAID_SMOKE_TESTS=true`. Do not print keys, key counts, key suffixes, provider raw headers, or provider raw error bodies while testing.

## Browser Mock Acceptance

Recommended local mock acceptance path:

```bash
npm.cmd run dev -- --hostname 127.0.0.1 --port 3007
```

Then use Playwright or an equivalent real browser to:

1. open `http://127.0.0.1:3007/projects/project-nightrail`;
2. intercept `/api/ai/chat`;
3. intercept `/api/ai/image`;
4. exercise the required M4.3 flows without real provider keys;
5. verify request payloads and visible UI state.

Minimum flows to cover:

- selected material + “分析这些资料并整理第一轮研究” routes into research;
- selected directions + “分别为这几个方向生成预览图” routes into direction preview and shows correct preview total;
- selected image + “保留整体结构语言，生成夜间使用场景” routes into visual development, with MiMo receiving image attachments and Grs receiving image-only generation references;
- selected image + “分析这张图的问题” stays ordinary chat and does not call `/api/ai/image`;
- manual task mode override beats automatic routing;
- design-trace overlay still opens and closes;
- the left-rail `项目记录` drawer opens and closes, shows current focus and review sections, and source clicks only locate real objects without triggering AI or mutating focus;
- a mocked ordinary chat reply with a valid `morphoProjectContinuityPatch` strips the JSON from visible text, shows `已补入项目记录 · 1 条`, and opens/highlights the project-record drawer when clicked;
- a mocked ambiguous or invalid patch does not write continuity but still shows the normal assistant reply;
- a mocked design-definition or concept-direction proposal reply that also contains a semantic patch does not write the semantic patch;
- a mocked research reply that contains both a valid `morphoResearchProposal` and a valid semantic patch creates the research card and shows `已补入项目记录 · 1 条` without binding the new research card as a semantic source;
- a mocked stream that emits prose, then an unclosed semantic fenced JSON block, then the closing fence never shows `morphoProjectContinuityPatch` or its JSON fields in the chat panel at any intermediate state;
- a mocked long ordinary chat reaches the checkpoint threshold, `/api/ai/chat` receives `conversationContext.checkpointRequested=true`, returns prose plus `morphoConversationCheckpoint`, and the UI shows prose plus `已整理当前讨论脉络` without technical JSON;
- the next mocked same-lane ordinary chat request includes the sanitized checkpoint and only bounded recent raw messages, not the full old transcript or duplicated current draft;
- switching selected direction/image or changing the focus epoch produces a different lane and does not send the old checkpoint;
- a malformed checkpoint block is hidden, does not save a checkpoint, and does not block a valid semantic patch;
- a reply with both `morphoProjectContinuityPatch` and `morphoConversationCheckpoint` can write both independently, while visible chat shows neither technical JSON block;
- semantic entry manual actions (`不再适用`, `撤回记录`, `恢复为当前有效`) update drawer labels and keep current focus unchanged;
- hidden object sources display `来源已隐藏`, missing sources display `来源不可用`, and message sources display the stored quote only.

Document reader mock acceptance for M5-D1:

- use a real browser with a mocked local workspace and IndexedDB `documentExtract` Blob; do not add a permanent mock route and do not call real providers;
- select an active parsed file with a valid `documentExtract`, click `阅读解析内容`, verify the floating reader shows file metadata, the local parsed-text warning, block/character-range location, and safe text rendering;
- search a repeated keyword, use next/previous and result clicks, and verify navigation scrolls to extract blocks without calling `/api/ai/chat` or `/api/ai/image`;
- open a PDF/PPTX parsed-file fixture that has `extractedPageCount` but no persisted source map and verify the UI shows only the parser count plus block/character location, not page or slide jump controls;
- select unparsed, parsing, failed, hidden, missing-extract, wrong-source-type, and missing-Blob files and verify the reader does not fake body text, does not reparse, does not call providers, and does not mutate file state;
- switch from file A to file B while A's Blob read is still pending, then let A finish and verify B remains visible; close while a read is pending and verify there is no stale state update or console error;
- after open, search, navigation, and close, verify canvas selection, AI messages, project continuity, conversation checkpoints, Compare analyses, DecisionRecords, and operations remain unchanged.

## Current Local Persistence

Project catalog:

```text
morpho.projects.catalog.v1
```

Per-project workspace:

```text
morpho.project.${projectId}.workspace.v1
```

Legacy single-project key read for migration:

```text
morpho.workspace.nightrail.v1
```

Structured workspace data is schema version `11`. v1/v2/v3/v4/v5/v6/v7/v8/v9/v10 workspace data is migrated through pure migration functions. v6 normalizes image roles to `reference`, `preview`, `conceptImage`, `primaryVisual`, `sceneVisual`, `cmfStudy`, `detailStudy`, `structureDiagram`, `interactionDiagram`, and `deliveryAsset`; old `main`, `scenario`, `cmf`, `detail`, and `diagram` values are migration-only inputs. v7 adds parse metadata to file objects and stores extracted document text as separate IndexedDB assets. v8 adds `workspace.projectContinuity`, migrates legacy `project.currentFocus` into structured `currentFocus`, and retires legacy `stageRecords` instead of converting them into a second stage-history source. v9 adds controlled conversation semantic record fields and message source refs; old v8 entries become `origin: deterministicEvent` and `manualState: active` without fabricated semantic metadata. v10 adds `workspace.ai.conversationCheckpoints`; old v9 messages are preserved, no checkpoint is invented, no old message receives a fabricated `conversationLaneKey`, and `projectContinuity` is unchanged. v11 adds `workspace.ai.comparisonAnalyses` plus assistant-message linkage for local Compare cards; old messages are preserved without fabricated comparison links. Migration success writes the new project workspace and catalog. Migration failure preserves old raw data and shows a recoverable warning instead of silently resetting to seed data.

Binary assets are stored in IndexedDB:

```text
database: morpho-assets-v1
store: asset-blobs
```

Workspace JSON stores only asset metadata and `assetId` references, not base64 file contents.

Local document extraction:

- supported: Markdown, plain text, text-layer PDF, and PPTX slide text;
- unsupported or expected to fail clearly: scanned PDFs without text layers, legacy `.ppt`, DOC/DOCX, OCR, embedded image extraction, layout reconstruction, and table fidelity;
- parsed text is capped before being stored as a `documentExtract` asset, and each AI request applies additional per-file and total context caps.
- M5-D1 document reading opens the saved `documentExtract` Blob as local parsed text in a temporary workspace panel. It does not preview original PDF/PPTX/Office layout, run OCR, fabricate page/slide location, or write the extract into workspace JSON.

## Current Routes

```text
/                         project homepage
/projects/[projectId]     project workspace
/api/ai/chat              MiMo text chat proxy
/api/ai/image             GrsAI image generation proxy
```

## Not Implemented

The current code does not include:

- Supabase or any other database;
- authentication;
- cloud file storage;
- multiplayer sync;
- automatic web crawling;
- OCR, legacy `.ppt`, DOC/DOCX parsing, and faithful document-layout reconstruction;
- dynamic provider model-list fetching;
- export package generation;
- transcript replacement, transcript deletion, user-managed chat summaries, or full-project chat summaries;
- deployment automation.
