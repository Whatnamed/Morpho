# Morpho Runbook

## Install

Use the repository `.npmrc` registry setting.

```bash
npm.cmd install
```

## Vercel Production

Morpho is currently deployed to Vercel. The standard production-compatible build is:

```bash
npm.cmd run build
```

Vercel must receive the values named in `.env.example`; never copy values from local `.env.local` into documentation, logs, or Git.

## Cloudflare Workers Backup Capability

Cloudflare/OpenNext remains a retained, opt-in backup capability and does not replace the Vercel production path. Normal `next dev`, validation, and production builds do not initialize OpenNext or read `.dev.vars`; only explicit `cf:*` commands enter that path. Keep the Cloudflare files and scripts intact. See [Cloudflare Workers deployment](./cloudflare-workers.md) for its separate configuration, preview, deployment, acceptance, and rollback flow.

## Environment

Morpho's production Context Policy is fixed in `src/domain/morpho/agentContextPolicy.ts`: `256000` window, `204800` prepare, `230400` compact, `16000` target uncompressed tail, and a separate `16000` response reserve. These values are not configured through Vercel environment variables. Do not add `MORPHO_AI_CONTEXT_*` variables to `.env.local` or Vercel; they are ignored by the production runtime.

Copy `.env.example` to `.env.local` for local development. Do not commit `.env.local`. `.env.example` is the sole baseline for environment-variable names, documented defaults, and comments.

tldraw hobby / production license (browser-safe public key):

```text
NEXT_PUBLIC_TLDRAW_LICENSE_KEY=
```

Put the key in `.env.local` only. Restart `next dev` after changing it. The app passes it to `<Tldraw licenseKey={...} />` from `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`.

Supabase email/password authentication for closed-test access:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
MORPHO_AUTH_REQUIRED=true
```

The two `NEXT_PUBLIC_SUPABASE_*` values are public browser configuration, not secrets. Never use a Supabase service-role key in this application. Supabase stores only account identity, tester eligibility, and AI daily-quota state. Projects, canvases, files, images, and backups remain local in browser localStorage / IndexedDB and are not cloud-synced.

With `MORPHO_AUTH_REQUIRED=true`, missing public Supabase configuration fails closed: `/login` renders the configuration error with no variable values, while `/` and `/projects/*` redirect to `/login` instead of rendering protected content. `/api/ai/*` retains its 503 configuration failure behavior. Set `MORPHO_AUTH_REQUIRED=false` only for explicit local authentication bypass.

Text chat and agent turns use the AiJWS / OpenAI-compatible `MORPHO_AI_*` group defined in `.env.example`. Its current example model is `gpt-5.6-terra`.

`MORPHO_AI_*` configures the formal `/api/ai/agent` Responses path, the compatibility-only `/api/ai/chat` route, and related web-search gating. The server also accepts `AIJWS_API_KEY`, `AIJWS_BASE_URL`, and `AIJWS_MODEL` as compatibility aliases. MiMo variables are no longer used for text AI.

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
- prompt cache fields stay disabled by default. Enable `MORPHO_AI_SUPPORTS_PROMPT_CACHE_KEY`, `MORPHO_AI_SUPPORTS_PROMPT_CACHE_RETENTION`, and the explicit key flag only after the current relay has passed the compatibility probe; a cache miss never changes Agent correctness.

Image generation uses the GrsAI `MORPHO_GRS_*` group defined in `.env.example`.

`MORPHO_GRS_DEFAULT_MODEL` (example value `gpt-image-2`) is the **server-side default / compatibility fallback** used when a request omits a model or needs a catalog default. It does **not** mean every Morpho image task is fixed to that model. `MORPHO_GRS_IMAGE_MODEL` remains a legacy fallback for existing local environments.

Workspace visual generation routes models by intent (see `resolveImageGenerationSettingsForVisualIntent` in `src/features/workspace/imageGenerationSettings.ts`):

- `directionPreview` / direction batch preview → `nano-banana-2-lite` (fast multi-shot scouting);
- `visualDevelopment`, continue-development, directed edit, scene/detail work, and unknown intent → `gpt-image-2` (higher quality iteration).

Paid provider smoke tests are disabled unless explicitly enabled:

```text
MORPHO_ALLOW_PAID_SMOKE_TESTS=false
```

The browser sends `modelId` (from intent routing for main visual paths), aspect ratio, optional size option, and client request ID to `/api/ai/image`. The route still requires server-only GrsAI config, but the provider request body is normalized on the server.

Current implemented behavior:

- automatic model routing (no required user model picker for the main visual paths):
  - direction preview batch → `nano-banana-2-lite`;
  - visual development / directed edit / scene / detail / unknown → `gpt-image-2`;
- catalog of selectable models still lives in `src/domain/morpho/grsImageModels.ts`;
- `MORPHO_GRS_DEFAULT_MODEL` is server default/fallback only, not a global override of the intent router;
- multi-item plans generate with up to **4 concurrent** GrsAI requests (`IMAGE_GENERATION_MAX_CONCURRENCY`);
- `nano-banana-*` profiles send `replyType: "json"` and send `imageSize` only when the selected model supports a size option;
- `gpt-image-2` sends pixel-style `aspectRatio`, `replyType: "json"`, and no `imageSize`;
- generated image assets store intrinsic width, height, and aspect ratio when the browser can read them.
- image generation operations store operation IDs and client request IDs; uncertain network responses are not automatically resubmitted.
- direction-preview and visual-development generation use Agent structured visual intent, deterministic reference resolution, local Prompt compilation, and then call GrsAI per plan item with concurrency capped at 4;
- `1`, `2`, `4`, and `6` are UI shortcuts only. Explicit positive counts and more than three selected directions are valid;
- image-generation metadata records requested count, structured intent, compiled prompt, prompt-contract version, reference-resolution omissions, model settings, successful result IDs, and per-item failures.
- the current GRSAI request supports text-to-image, image-to-image, and prompt-level directed edit. It has no mask/inpainting field; UI and prompts must not promise pixel-level local editing, and sources are never overwritten.

Milestone 3 Operation records are local-first and lightweight. Workspace JSON stores operation status, summaries, proposals, citation snapshots, and IndexedDB artifact references. It does not store raw webpages, large extracted files, page previews, provider raw responses, API keys, or response headers.

Only one active Operation is allowed per project. Browser reload marks unfinished operations as `interrupted` and keeps the input snapshot and retryable state; it does not pretend a background job continued.

Research operations can read selected parsed file extracts, selected image pixels, current workspace semantic context, and optional provider web search. A valid research result is recorded and applied into a research card automatically. Key conclusions, design definitions, concept directions, default references, direction status, and delivery decisions still require their own explicit proposal/application paths.

AI continuity and Project Memory:

- the formal panel calls only `/api/ai/agent`; `/api/ai/chat` is compatibility-only;
- all uncompressed project messages participate below the Token threshold. Lane, focus, selection, direction, and branch do not filter history;
- automatic compaction persists a validated summary revision and covered boundary before older messages leave provider input. Raw messages remain in the workspace and `search_project_conversation` can still return them;
- explicit history, memory, and progress questions must complete their required read tools before final text is accepted;
- `submit_memory_update` accepts only locally authorized exact quotes from the current persisted user message. AI suggestions and one-off requests are rejected as stable preferences;
- deterministic project facts project into seven current Memory documents and only actually occurred Stage Records. Current versions, source refs, revision chains, and `reviewRequired` are visible under `项目记录`;
- successful writes show only specific feedback such as `已更新项目偏好`, `已记录设计决定`, or `已更新方向与视觉发展记录`; no write means no feedback;
- legacy `conversationCheckpoints` and lane keys remain in backups and migrations but do not select formal Agent history.


Delivery preparation drafts:

- delivery drafting uses `/api/ai/agent` and the `prepare_delivery_section_draft` tool, with only the current section's frozen `deliverySectionContext` snapshots authorized;
- web search is disabled for this intent even if `MORPHO_AI_WEB_SEARCH_ENABLED=true`;
- the browser does not send selected image pixels, full source files, full `documentExtract` text, normal task context, or Compare context for delivery section drafts;
- locally validated `prepare_delivery_section_draft` arguments create only a pending draft; section narrative, captions, suggested gaps, DecisionRecord, and continuity event are written only when the user applies it.

Without these variables, the app still runs locally, but provider routes return clear configuration errors instead of fake AI results.

## Development Server

```bash
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

Expected local URLs:

```text
http://127.0.0.1:3000/
http://127.0.0.1:3000/projects/project-morpho-case-study
```

## Checks

```bash
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run case-study:upgrade
```

Expected results:

- `lint`: ESLint completes with no reported problems.
- `typecheck`: `tsc --noEmit` completes.
- `test`: Vitest runs domain, persistence, import, query, AiJWS/OpenAI-compatible, and GrsAI tests.
- `build`: `next build` completes and prerenders static pages/routes where applicable.
- `case-study:upgrade`: upgrades the generated current-case workspace to schema 15; running it twice must leave the workspace hash unchanged.

GitHub CI runs the same core quality gate in `.github/workflows/quality.yml` on pushes to `main` and on pull requests:

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The CI workflow does not use `.env`, provider API keys, Vercel tokens, paid model smoke tests, deployment, publishing, or version changes.

## Supabase Security Notes

The remaining Security Advisor notices for `public.get_my_access_state()` and `public.reserve_ai_daily_quota(text)` are intentional and reviewed. They remain `SECURITY DEFINER` RPCs executable only by `authenticated`, because RLS blocks direct access to the qualification/quota tables and the application needs narrow current-user operations to read access state and atomically reserve quota. Both functions use fixed `search_path`, derive identity from `auth.uid()`, accept no cross-user identifier, use no dynamic SQL, and return only the caller's own state. Do not change them to `SECURITY INVOKER` or revoke `authenticated` execution just to remove the notices.

The Supabase Free-plan leaked-password-protection advisor warning is a plan limitation. It is not fixed by changing application SQL or weakening authentication behavior.

## Archive And Backup

Current workspace export/restore entry:

- open a project workspace;
- click the top `归档` button;
- use the floating panel to export a human-readable archive, export an editable backup, or restore an editable backup zip.

Current behavior:

- archive export may finish with warnings when referenced local binaries are missing or byte lengths no longer match asset metadata;
- editable backup export is stricter and is blocked when required local binaries are missing or mismatched;
- editable backups always use full AI continuity scope and preserve raw messages, summary revisions, legacy checkpoints, Memory/Stage revisions, Continuity Events, traces, citations, Compare analyses, and image-generation provenance;
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

### Agent Responses SSE Probe

Use the local-only probe with a real `.env.local` and explicit paid-test permission:

```bash
node --experimental-strip-types --env-file=.env.local scripts/probe-agent-responses-stream.mjs --scenario=reasoning
node --experimental-strip-types --env-file=.env.local scripts/probe-agent-responses-stream.mjs --scenario=tool --fixture=responses-reasoning-tool-stream.ndjson
node --experimental-strip-types --env-file=.env.local scripts/probe-agent-responses-stream.mjs --scenario=continuation --fixture=responses-tool-continuation-stream.ndjson
node --experimental-strip-types --env-file=.env.local scripts/probe-agent-responses-stream.mjs --scenario=full-agent-continuation
node --experimental-strip-types --env-file=.env.local scripts/probe-agent-responses-stream.mjs --scenario=assistant-history-output-text
node --experimental-strip-types --env-file=.env.local scripts/probe-agent-responses-stream.mjs --scenario=cancel
```

The probe sends only synthetic inputs. It logs event names and writes only sanitized fixtures: no keys, headers, project data, image URLs, encrypted reasoning, or raw diagnostics. The optional `web-search` scenario is expected to report a clean failure if the active provider does not support it; do not replace that failure with a Chat Completions retry.

For manual Agent acceptance, use a disposable local project. Verify a normal answer, a real tool loop beyond four model continuations, optional commentary, no-commentary tool execution, native/provider search activity when available, image generation, cancellation, user-controlled disclosure state, page refresh of a completed trace, and a clean browser console. The process disclosure must contain only real reasoning summaries, commentary, and activity; final text remains below it.

## AI Continuity Browser Acceptance

Start a development server with real local configuration. Use the already-open Chrome local page when available and the generated current-case project:

```bash
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000/projects/project-morpho-case-study`. Formal panel traffic must use `/api/ai/agent`; no workspace action may call `/api/ai/chat`.

Minimum acceptance:

1. Ask `你还记得最早的对话是什么吗？`; verify the process calls `search_project_conversation` and the answer cites the real earliest user message and time.
2. Ask `你看看本地文档，应该有记录过本地文档吧，关于进度还有记忆之类的` and `你还记得上下文吗，关于产品的现在进度如何了`; verify real Project Memory/Stage Record reads occur before the answer and no source-free “没有记录” claim appears.
3. Continue several turns while changing selection, direction, VisualBranch, Current Focus, and delivery-panel visibility; verify one continuous conversation remains and earlier discussion is still recalled.
4. State one explicit stable preference and one avoidance. Verify only the exact user-backed items enter `偏好与避免项`, specific update feedback appears, source navigation works, and an AI suggestion/one-off generation request does not become a preference.
5. Confirm a primary/alternative/eliminated direction decision and verify Decision Log, Rejected Directions, relevant Stage Record, revision chain, and restore semantics.
6. Run visual development for 3 images, then four directions with 3 previews each. Run one batch with default reference excluded, plus scene, CMF, and detail tasks. Verify complete plans, bounded concurrent execution, partial-result retention, no source overwrite, one Agent Trace, and persisted intent/compiledPrompt/reference/model provenance. Paid calls require `MORPHO_ALLOW_PAID_SMOKE_TESTS=true`.
7. Generate a delivery-section draft. Verify `prepare_delivery_section_draft` uses frozen section references and creates a pending draft; no delivery content changes before explicit apply.
8. Export an editable backup, inspect it, restore a new copy, and verify raw chat, compaction, Memory/Stage revisions, traces, citations, Compare records, assets, and generation provenance survive.

Automatic compaction may be tested without manufacturing a huge transcript. In development only, set this before reloading:

```js
localStorage.setItem("morpho:test:conversation-token-limits", JSON.stringify({
  windowTokens: 40000,
  prepareTokens: 17000,
  compactTokens: 18000,
  targetUncompressedTokens: 400
}));
```

Verify one `整理讨论上下文` activity, an advanced summary boundary, retained raw messages, and successful history search across that boundary. Remove the key after acceptance. Production builds ignore this override.

For every scenario, inspect console and network failures, hydration errors, duplicate Thinking/progress surfaces, overlapping UI, and final workspace persistence. Do not treat a rendered answer alone as acceptance evidence.


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
- monitor `/api/ai/agent`, click `生成本节说明草稿`, and verify the Agent calls `prepare_delivery_section_draft` against only the current frozen section references, without selected image Base64, Blob URLs, or full source-file text;
- return a valid delivery tool call and verify a pending draft appears with no section narrative/caption/gap write before `应用草稿`;
- apply the draft and verify narrative, listed captions, suggested gaps, DecisionRecord, and continuity event are written;
- return malformed tool arguments, an unauthorized reference ID, or too many gaps and verify no delivery draft/content/DecisionRecord/memory update/Compare analysis is written.

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

Legacy single-project key read for a one-time pristine-Nightrail migration:

```text
morpho.workspace.nightrail.v1
```

Structured workspace data is schema version `15`. v1 through v14 workspace data is migrated through pure migration functions. v6 normalizes image roles to `reference`, `preview`, `conceptImage`, `primaryVisual`, `sceneVisual`, `cmfStudy`, `detailStudy`, `structureDiagram`, `interactionDiagram`, and `deliveryAsset`; old `main`, `scenario`, `cmf`, `detail`, and `diagram` values are migration-only inputs. v7 adds parse metadata to file objects and stores extracted document text as separate IndexedDB assets. v8 adds `workspace.projectContinuity`, migrates legacy `project.currentFocus` into structured `currentFocus`, and retires legacy `stageRecords` instead of converting them into a second stage-history source. v9 adds controlled conversation semantic record fields and message source refs; old v8 entries become `origin: deterministicEvent` and `manualState: active` without fabricated semantic metadata. v10 adds `workspace.ai.conversationCheckpoints`; old v9 messages are preserved, no checkpoint is invented, no old message receives a fabricated `conversationLaneKey`, and `projectContinuity` is unchanged. v11 adds `workspace.ai.comparisonAnalyses` plus assistant-message linkage for local Compare cards; old messages are preserved without fabricated comparison links. v12 adds `documentFragment` support and fragment source relations without fabricating historical fragments or changing existing files/messages/checkpoints/Compare analyses/DecisionRecords/project-continuity records. v13 upgrades delivery preparation with sections, stable section references, gaps, and pending delivery section drafts. v14 adds optional ordered assistant `agentTrace` records and preserves all prior message bodies, citations, checkpoints, Compare analyses, and project-continuity state without fabricating trace parts. v15 adds project-wide conversation compaction, revisioned summaries, seven revisioned Project Memory documents, six possible revisioned Stage Records, and structured image-generation provenance. It migrates old checkpoints without deleting them, preserves every raw message and event, and does not fabricate unsupported semantic facts. Migration success writes the new project workspace and catalog. Migration failure preserves old raw data and shows a recoverable warning instead of silently resetting to seed data.

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

Supabase provides account identity, access qualification, and AI quota only. This runtime still does not implement project cloud sync, cloud file storage, automatic Blob garbage collection, or cross-device backup. Use the editable backup export/restore flow for browser-to-browser transfer.

Local document extraction:

- supported: Markdown, plain text, text-layer PDF, and PPTX slide text;
- unsupported or expected to fail clearly: scanned PDFs without text layers, legacy `.ppt`, DOC/DOCX, OCR, embedded image extraction, layout reconstruction, and table fidelity;
- parsed text is capped before being stored as a `documentExtract` asset, and each AI request applies additional per-file and total context caps.
- M5-D1 document reading opens the saved `documentExtract` Blob as local parsed text in a temporary workspace panel. It does not preview original PDF/PPTX/Office layout, run OCR, fabricate page/slide location, or write the extract into workspace JSON.
- M5-D2 document fragments are explicitly extracted from consecutive reader blocks. Each fragment stores bounded body text plus file/extract/offset/block provenance and can return only to the real extract range when the source file and extract asset still match.

## Current Routes

```text
/                         project homepage
/login                    Supabase email/password login and registration
/projects/[projectId]     project workspace
/api/ai/agent             formal OpenAI-compatible Responses Agent stream
/api/ai/chat              deprecated compatibility-only text route
/api/ai/web-search        AiJWS web-search proxy
/api/ai/image             GrsAI image generation proxy
```

## Not Implemented

The current code does not include:

- cloud project synchronization or cloud file storage;
- multiplayer sync;
- automatic web crawling;
- OCR, legacy `.ppt`, DOC/DOCX parsing, and faithful document-layout reconstruction;
- dynamic provider model-list fetching;
- PPT/PDF/Figma generation or final delivery layout;
- transcript replacement, transcript deletion, or user-managed chat-summary files;
- deployment automation beyond the existing Vercel deployment and checked-in Cloudflare/OpenNext backup scripts.
