# Morpho Runbook

## Install

Use the repository `.npmrc` registry setting.

```bash
npm.cmd install
```

## Environment

Copy `.env.example` to `.env.local` for local AI provider calls. Do not commit `.env.local`.

tldraw hobby / production license (browser-safe public key):

```text
NEXT_PUBLIC_TLDRAW_LICENSE_KEY=
```

Put the key in `.env.local` only. Restart `next dev` after changing it. The app passes it to `<Tldraw licenseKey={...} />` from `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`.

Text chat and agent turns through AiJWS / OpenAI-compatible:

```text
MORPHO_AI_PROVIDER=aijws
MORPHO_AI_BASE_URL=https://api.aijws.com/v1
MORPHO_AI_API_KEY=
MORPHO_AI_MODEL=gpt-5.6-terra
MORPHO_AI_REASONING_EFFORT=high
MORPHO_AI_WEB_SEARCH_ENABLED=true
```

`MORPHO_AI_*` is the text AI path for `/api/ai/chat`, `/api/ai/agent`, and related web-search gating. The server also accepts `AIJWS_API_KEY`, `AIJWS_BASE_URL`, and `AIJWS_MODEL` as compatibility aliases. MiMo variables are no longer used for text AI.

AiJWS text behavior:

- ordinary text and selected-image chat/research use `MORPHO_AI_MODEL`;
- supported reasoning models use `MORPHO_AI_REASONING_EFFORT` with `low`, `medium`, or `high`; omit it to use the provider default;
- selected active images in visual-planning `imageGeneration` requests are sent to AiJWS for the structured visual plan, then GrsAI generates the actual images;
- image input is limited to selected active IndexedDB image assets. Small selections are sent as individual compressed images; larger selections are packed into one or more contact sheets so every selected image is represented without exposing a user-facing upload count limit;
- hidden images, unselected images, default references, and whole-canvas screenshots are not sent by default;
- selected parsed file objects can send bounded local `documentExtract` text to AiJWS for chat/research context. Extracts are local sources, not provider citations;
- selected parsed file objects can also send bounded local `documentExtract` text to AiJWS for visual planning when `taskMode === "imageGeneration"` and the current task context authorizes them;
- when `MORPHO_AI_WEB_SEARCH_ENABLED=true`, chat/research requests may provide provider web-search tooling where supported. Image generation never receives web search tools;
- source links are shown only when the provider returns citation/annotation fields.

Image generation through GrsAI:

```text
MORPHO_GRS_API_KEY=
MORPHO_GRS_BASE_URL=https://grsaiapi.com
MORPHO_GRS_DEFAULT_MODEL=nano-banana-2-lite
MORPHO_GRS_IMAGE_MODEL=
```

`MORPHO_GRS_DEFAULT_MODEL` is the current default image model variable. `MORPHO_GRS_IMAGE_MODEL` remains a legacy fallback for existing local environments.

Paid provider smoke tests are disabled unless explicitly enabled:

```text
MORPHO_ALLOW_PAID_SMOKE_TESTS=false
```

The browser image-task UI sends a selected model ID, aspect ratio, optional size option, and client request ID to `/api/ai/image`. The route still requires server-only GrsAI config, but the provider request body is normalized on the server.

Current implemented behavior:

- default image model in the UI: `nano-banana-2-lite`;
- selectable image models come from `src/domain/morpho/grsImageModels.ts`;
- `nano-banana-*` profiles send `replyType: "json"` and send `imageSize` only when the selected model supports a size option;
- `gpt-image-2` sends pixel-style `aspectRatio`, `replyType: "json"`, and no `imageSize`;
- generated image assets store intrinsic width, height, and aspect ratio when the browser can read them.
- image generation operations store operation IDs and client request IDs; uncertain network responses are not automatically resubmitted.
- direction-preview and visual-development generation first ask AiJWS for a structured visual plan, validate selected source/direction scope locally, and then call GrsAI once per plan item.
- direction-preview supports `1`, `2`, `4`, or `6` previews per selected direction, with a hard total limit of `8` generated items per run.
- image-generation Operation metadata records the requested preview count, visual plan, successful result IDs, and per-item failures for later audit.

Milestone 3 Operation records are local-first and lightweight. Workspace JSON stores operation status, summaries, proposals, citation snapshots, and IndexedDB artifact references. It does not store raw webpages, large extracted files, page previews, provider raw responses, API keys, or response headers.

Only one active Operation is allowed per project. Browser reload marks unfinished operations as `interrupted` and keeps the input snapshot and retryable state; it does not pretend a background job continued.

Research operations can read selected parsed file extracts, selected image pixels, current workspace semantic context, and optional provider web search. A valid research result is recorded and applied into a research card automatically. Key conclusions, design definitions, concept directions, default references, direction status, and delivery decisions still require their own explicit proposal/application paths.

Conversation semantic records:

- `/api/ai/chat` may ask AiJWS for `morphoProjectContinuityPatch` only for `chatAnalysis` and `researchOperation`;
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

Delivery preparation drafts:

- `prepareDeliverySection` uses `/api/ai/chat`, but sends only the current section `deliverySectionContext` frozen snapshots;
- web search is disabled for this intent even if `MORPHO_AI_WEB_SEARCH_ENABLED=true`;
- the browser does not send selected image pixels, full source files, full `documentExtract` text, normal task context, or Compare context for delivery section drafts;
- visible chat hides `morphoDeliverySectionDraft` JSON. A valid block creates only a pending draft; section narrative, captions, suggested gaps, DecisionRecord, and continuity event are written only when the user applies the draft.

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
- `test`: Vitest runs domain, persistence, import, query, AiJWS/OpenAI-compatible, and GrsAI tests.
- `build`: `next build` completes and prerenders static pages/routes where applicable.

GitHub CI runs the same core quality gate in `.github/workflows/quality.yml` on pushes to `main` and on pull requests:

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The CI workflow does not use `.env`, provider API keys, Vercel tokens, paid model smoke tests, deployment, publishing, or version changes.

## Archive And Backup

Current workspace export/restore entry:

- open a project workspace;
- click the top `归档` button;
- use the floating panel to export a human-readable archive, export an editable backup, or restore an editable backup zip.

Current behavior:

- archive export may finish with warnings when referenced local binaries are missing or byte lengths no longer match asset metadata;
- editable backup export is stricter and is blocked when required local binaries are missing or mismatched;
- restore always creates a new local project copy with a new project id and new runtime asset storage keys;
- restore writes blobs first and then writes workspace/catalog state, with best-effort cleanup if persistence fails.

## Delivery Output

Current delivery output entry:

- open a project workspace;
- click the top `输出` button;
- choose one active delivery preparation package;
- review the preflight summary for sections, stable references, embedded assets, link/no-binary items, missing or mismatched assets, open gaps, and pending drafts;
- click `导出交付输出包` to download a zip for external layout tools.

Current behavior:

- output format is `morpho-delivery-output` with `outputVersion: "1"`;
- the zip includes `output-manifest.json`, `README.md`, `delivery-outline.md`, `captions-and-copy.md`, `gaps-and-next-steps.md`, `asset-index.md`, `source-map.json`, and selected-reference assets under `assets/`;
- only assets required by the selected delivery object's stable references are read from IndexedDB;
- missing local binaries and byte-size mismatches export with warnings and are documented instead of being replaced by empty files;
- link-only and text/conclusion references do not create fake local assets;
- delivery output does not restore projects, write workspace state, apply pending drafts, refresh stable references, or create final PPT/PDF/Figma layouts.

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
- selected image + “保留整体结构语言，生成夜间使用场景” routes into visual development, with AiJWS receiving image attachments for planning and Grs receiving image-only generation references;
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

Document fragment mock acceptance for M5-D2:

- use a real browser with a mocked local workspace and IndexedDB `documentExtract` Blob; do not add a permanent mock route and do not call real providers;
- open an active parsed file, select two adjacent parsed blocks, edit the fragment title, and click the explicit extract action;
- verify a new `documentFragment` canvas object appears, the reader remains open, success feedback appears, and the body matches the exact `documentExtract` slice for the saved offsets;
- verify extraction does not call `/api/ai/chat` or `/api/ai/image`, does not create an AI message, DecisionRecord, Compare analysis, operation, checkpoint, semantic patch, key conclusion, or current-focus update;
- select non-consecutive blocks or more than the configured block/character limits and verify no fragment or continuity record is created, no silent truncation occurs, and the UI shows the validation reason;
- select an existing fragment and click source-location. Verify the reader opens the source file, highlights the real extract range, and shows no fabricated PDF page, PPT slide, or coordinate location;
- hide or remove the source file, or change/remove the source extract asset, then select the fragment. Verify the fragment body remains readable, source status is hidden/unavailable/mismatch as appropriate, and source-location is disabled;
- select two active fragments and start Compare. Verify only those fragment IDs are Compare sources, evidence basis is `documentFragment`, and the source file full text is not auto-attached.

Delivery preparation mock acceptance for M6:

- open the floating delivery preparation panel from the top controls or a selected delivery card; opening/closing must not call providers or write Current Focus;
- create a presentation preparation package, edit one section title/purpose, select active research/documentFragment/conceptDirection/image objects, and add them to different sections;
- verify stable delivery references are created, source objects are unchanged, duplicate source references in the same section are blocked, and the same source can be added to another section;
- edit a caption/note, move a reference, remove a reference, add a manual gap, resolve/reopen/remove the gap, close/reopen the panel, and verify content persists;
- modify a source image title or role and hide a source file behind a document fragment, then verify old snapshots remain readable and source states show updated/hidden without automatic refresh;
- click `更新为当前版本` on a source-updated reference, confirm that only that reference snapshot/fingerprint updates, caption/note remain, the source object is unchanged, and a DecisionRecord plus delivery continuity event are written;
- intercept `/api/ai/chat`, click `生成本节说明草稿`, and verify the request body includes only `deliverySectionContext` for the current section snapshots and excludes webSearch, taskContext, comparisonContext, selected image Base64, Blob URLs, and full source file text;
- return normal prose plus a valid `morphoDeliverySectionDraft`; verify technical JSON is hidden, a pending draft card appears, and no section narrative/caption/gap is written before `应用草稿`;
- apply the draft and verify narrative, listed captions, suggested gaps, DecisionRecord, and continuity event are written;
- return malformed draft JSON, a caption with an unauthorized reference ID, too many gaps, or a same-reply design/direction/Compare proposal and verify no delivery draft/content/DecisionRecord/semantic patch/checkpoint/Compare analysis is written.

Delivery output mock acceptance for M8:

- open a project with at least one active delivery preparation package and click the top `输出` button;
- verify the floating panel lists active delivery packages without opening a new page or changing canvas semantics;
- select a package and confirm the preflight summary shows sections, stable references, embedded local assets, link/no-binary items, missing or mismatched assets, open gaps, and pending drafts;
- click `导出交付输出包`, download the zip, and inspect that Markdown files are readable, `source-map.json` maps delivery references to stable snapshots, and embedded files keep usable extensions under `assets/`;
- verify unrelated workspace assets, hidden or eliminated objects not referenced by the delivery package, raw workspace JSON, archive manifests, backup bundles, Blob URLs, and runtime `storageKey` values are absent;
- simulate a missing local Blob and verify export still finishes with warnings, no empty asset file is created, and `README.md` plus `asset-index.md` report the missing binary;
- verify a delivery package with no sections is blocked, while a text-only package with sections but no stable references exports with a clear warning;
- verify archive export, editable backup export, and restore still use the top `归档` panel and are not changed into delivery output.

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

Structured workspace data is schema version `13`. v1/v2/v3/v4/v5/v6/v7/v8/v9/v10/v11/v12 workspace data is migrated through pure migration functions. v6 normalizes image roles to `reference`, `preview`, `conceptImage`, `primaryVisual`, `sceneVisual`, `cmfStudy`, `detailStudy`, `structureDiagram`, `interactionDiagram`, and `deliveryAsset`; old `main`, `scenario`, `cmf`, `detail`, and `diagram` values are migration-only inputs. v7 adds parse metadata to file objects and stores extracted document text as separate IndexedDB assets. v8 adds `workspace.projectContinuity`, migrates legacy `project.currentFocus` into structured `currentFocus`, and retires legacy `stageRecords` instead of converting them into a second stage-history source. v9 adds controlled conversation semantic record fields and message source refs; old v8 entries become `origin: deterministicEvent` and `manualState: active` without fabricated semantic metadata. v10 adds `workspace.ai.conversationCheckpoints`; old v9 messages are preserved, no checkpoint is invented, no old message receives a fabricated `conversationLaneKey`, and `projectContinuity` is unchanged. v11 adds `workspace.ai.comparisonAnalyses` plus assistant-message linkage for local Compare cards; old messages are preserved without fabricated comparison links. v12 adds `documentFragment` support and fragment source relations without fabricating historical fragments or changing existing files/messages/checkpoints/Compare analyses/DecisionRecords/project-continuity records. v13 upgrades delivery preparation with sections, stable section references, gaps, and pending delivery section drafts; it does not fabricate packages, narratives, gaps, drafts, source objects, AI messages, Compare analyses, or project-continuity records. Migration success writes the new project workspace and catalog. Migration failure preserves old raw data and shows a recoverable warning instead of silently resetting to seed data.

Binary assets are stored in IndexedDB:

```text
database: morpho-assets-v1
store: asset-blobs
```

Workspace JSON stores only asset metadata and `assetId` references, not base64 file contents.

M9-A local persistence behavior:

- workspace saves are debounced for 400 ms with a 1200 ms max wait;
- pending saves flush synchronously on pagehide, visibility-hidden, beforeunload, project switch, and workspace unmount;
- workspace and catalog write failures are surfaced separately instead of reporting a false saved state;
- local save failures show a small inline warning near the project title and do not block editing;
- image preview object URLs are cached by `assetId + storageKey`, and only added or changed image assets are read from IndexedDB.

This runtime still does not implement Supabase, cloud sync, accounts, AI access protection, automatic Blob garbage collection, or cross-device backup.

Local document extraction:

- supported: Markdown, plain text, text-layer PDF, and PPTX slide text;
- unsupported or expected to fail clearly: scanned PDFs without text layers, legacy `.ppt`, DOC/DOCX, OCR, embedded image extraction, layout reconstruction, and table fidelity;
- parsed text is capped before being stored as a `documentExtract` asset, and each AI request applies additional per-file and total context caps.
- M5-D1 document reading opens the saved `documentExtract` Blob as local parsed text in a temporary workspace panel. It does not preview original PDF/PPTX/Office layout, run OCR, fabricate page/slide location, or write the extract into workspace JSON.
- M5-D2 document fragments are explicitly extracted from consecutive reader blocks. Each fragment stores bounded body text plus file/extract/offset/block provenance and can return only to the real extract range when the source file and extract asset still match.

## Current Routes

```text
/                         project homepage
/projects/[projectId]     project workspace
/api/ai/chat              AiJWS text chat proxy
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
- PPT/PDF/Figma generation or final delivery layout;
- transcript replacement, transcript deletion, user-managed chat summaries, or full-project chat summaries;
- deployment automation.
