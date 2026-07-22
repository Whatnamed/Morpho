# Morpho M4.3 Context Runtime

> Historical milestone note: this document describes the M4.3 baseline. The current v3.2 runtime has since added project-wide conversation compaction, the Memory Kernel, Provider Context Frames, and the Responses Agent route. Current image-edit wording is `directed edit`; the provider still has no mask/inpainting input and therefore no pixel-level local-edit guarantee.

## Scope

M4.3 closes the runtime gap between selected real project material and the actual AI task that runs.

This milestone adds:

- a unified task-context assembly layer for research, general chat/proposal, direction preview, and visual development;
- controlled provider planning context for `imageGeneration`;
- deterministic auto-routing that considers draft text plus current selection shape;
- controllable multi-preview direction generation;
- more inspectable image-generation operation status and result metadata.

This milestone does not add:

- the M4.3 milestone itself did not add long-term project memory or automatic context compression;
- document readers, page previews, OCR, or partial-file semantic object extraction;
- compare workflow runtime;
- delivery/export/archive runtime;
- cloud sync, auth, multiplayer, or autonomous agents;
- any permanent mock route;
- automatic paid-provider smoke execution.

## Core Problem Closed

Before M4.3, visual planning and ordinary AI task assembly still had three reliability problems:

1. task-specific context was still assembled ad hoc in `WorkspaceClient.tsx`;
2. provider visual-planning requests could lose authorized attachments and local document extracts when `taskMode === "imageGeneration"`;
3. direction preview was still effectively treated as one preview per direction, with weak auditing of requested count and weak placement planning.

M4.3 moves those concerns into explicit, testable runtime boundaries.

## Runtime Structure

### Task context assembly

`src/features/workspace/taskContext.ts` builds a bounded `TaskContextResult` from:

- current workspace state;
- user draft text;
- explicit current selection;
- optional target directions;
- optional target visual branch.

Returned fields include:

- `objectIds`;
- `semanticSummaries`;
- `imageObjectIds`;
- `documentObjectIds`;
- `directionRevisions`;
- `designDefinitionRevision`;
- `visualBranches`;
- `skipped`;
- `truncated`;
- `defaultReference`;
- `scopeNote`.

The layer is pure and deterministic. It does not read IndexedDB blobs, mutate workspace state, infer meaning from canvas position, or expose hidden objects by default.

### Context kinds

Implemented context kinds:

- `research`
- `general`
- `directionPreview`
- `visualDevelopment`
- `designDefinition`
- `conceptDirection`

Each kind starts from explicit selection and then adds only direct semantic dependencies.

## Actual Context by Task

### Research

Research context may include:

- selected files with parsed `documentExtract`;
- selected active images;
- selected text, links, existing research, and other selected semantic objects;
- bounded semantic summaries for selected and directly relevant objects.

The current Agent may receive the configured OpenAI-compatible web-search tool only for eligible research/chat profiles.

### General / proposal discussion

General context includes:

- selected active objects;
- bounded semantic summaries;
- direct semantic dependencies required by the current task kind;
- optional selected image pixels and selected parsed-file extracts when the task route allows them.

It does not send the entire canvas, old hidden objects, or unrelated images.

### Direction preview

Direction-preview context includes:

- selected concept-direction objects and their current revisions;
- current effective design-definition revision, when available;
- selected active images;
- selected parsed-file extracts;
- related active key conclusions discovered from current design-definition and direction revision sources;
- default-reference status.

Default-reference pixels are included only when all of the following are true:

- a current default reference exists;
- it is still active, not hidden;
- the user draft explicitly asks to keep or reference the current default reference;
- the request is a direction-preview or visual-development task;
- if the default reference belongs to a direction, that direction is in the current target direction scope;
- if the default reference has no direction, the current visual task has exactly one clear target direction.

Default-reference pixels are never sent for research, general chat, design-definition drafting, or concept-direction drafting. Multi-direction preview does not receive an undirected default reference because there is no single unambiguous target scope.

Presence of a default reference alone never makes it mandatory input.

### Visual development

Visual-development context includes:

- selected active source images;
- image generation metadata from those images through semantic summaries;
- current direction revision of the selected image scope;
- relevant active visual-branch records;
- current effective design-definition revision;
- related active key conclusions;
- selected parsed-file extracts;
- conditional default-reference status using the same inclusion rules as above.

If selected images span multiple directions, the existing explicit-target-direction rule still applies during visual-plan validation.

## Historical MiMo and GrsAI Boundary

### Historical MiMo planning stage

The historical planning path accepted authorized `imageGeneration` request attachments and local `documentExtracts`; the formal workspace path now uses `/api/ai/agent` Responses SSE.

For visual planning, MiMo can receive:

- structured object summaries;
- bounded structured `taskContext`, including current design-definition revision fields, current direction revision fields, relevant visual-branch records, skipped-object notes, truncation state, and default-reference status;
- selected-image pixels or contact sheets;
- selected local document extracts;
- default-reference status text;
- task-specific system instructions that explain what was and was not sent.

MiMo still does not receive:

- hidden-object pixels by default;
- whole-canvas screenshots;
- raw provider state from previous tasks;
- automatic web search tools for `imageGeneration`.

MiMo output for visual planning remains constrained to `morphoVisualGenerationPlan` JSON.

### GrsAI generation stage

`/api/ai/image` remains narrower than MiMo planning.

GrsAI receives only:

- generation prompt;
- selected model settings;
- necessary image references resolved for generation.

GrsAI never receives:

- local document-extract text;
- MiMo internal context state;
- unrelated selected semantic objects;
- hidden-object state as implicit input.

This preserves the product rule that planning context can be richer than generation context without leaking raw project materials into the image provider.

## Auto-routing

`src/features/workspace/aiTaskRouting.ts` now makes deterministic recommendations from:

- user draft text;
- selected object types;
- whether the selection contains material objects;
- whether the selection contains concept directions or images;
- current manual task-mode and work-intent state.

Manual user selection remains authoritative:

- manual non-default `taskMode` overrides recommended task mode;
- manual non-default `workIntent` overrides recommended work intent.

Automatic routing is only adopted when the panel is still in default discussion state.

Implemented routing behavior now explicitly covers:

- material selection + “分析这些 PDF / 看看这些资料 / 研究一下 / 查一下” -> `researchOperation`;
- selected image + “分析这张图的问题” -> ordinary `chatAnalysis`;
- selected directions + “分别生成预览 / 每个方向生成 / 为这些方向出图” -> `imageGeneration`;
- selected image + “改成夜间场景 / 继续发展 / 生成 CMF / 细节 / 出图” -> `imageGeneration`;
- pure copywriting asks such as “生成一段说明文字” -> ordinary `chatAnalysis`.

## Preview Count and Plan Validation

Direction preview now supports `1`, `2`, `4`, or `6` previews per selected direction.

Rules:

- UI default is `2`;
- total generated preview items per task may not exceed `8`;
- Morpho never silently downgrades the user's chosen count;
- if the total exceeds `8`, the task is blocked with a natural-language explanation.

`validateVisualGenerationPlan()` now enforces:

- the requested count is valid;
- total count is within the hard limit;
- every selected direction is covered exactly `requestedPreviewCount` times;
- no unselected direction is generated;
- direction-preview items use `conceptImage` only;
- direction preview does not auto-bind or auto-create a visual branch;
- no unauthorized object IDs are referenced.

The resulting `ImageGenerationOperation` metadata records `requestedPreviewCount` for later audit.

## Placement Runtime

`src/features/workspace/visualPreviewLayout.ts` adds deterministic direction-preview placement planning.

Behavior:

- same-direction multi-preview results are placed in a stable small grid;
- placements anchor near the direction card instead of the viewport center;
- a direction-preview batch precomputes all result positions once from the pre-generation workspace, so sequential writes cannot push later siblings downward;
- a new generation round starts below the current same-direction bottom edge;
- results avoid covering the source direction card and avoid overlapping each other.

Canvas coordinates remain visual-only layout output. They do not encode business meaning.

## Context Budgets

`TASK_CONTEXT_LIMITS` currently defines:

- max object summaries: `16`
- max document extracts: `8`
- max chars per document: `8_000`
- max total document chars: `24_000`
- max MiMo images: `16`
- max Grs reference images: `4`
- max conversation messages: `12`

The task-context result explicitly records:

- which object IDs were included;
- which were skipped;
- why they were skipped;
- whether truncation occurred;
- whether default reference was included.

This makes the runtime auditable without printing the entire hidden context into the visible chat stream.

## Operation Status and Failure Boundary

Image-generation runtime now surfaces a more explicit status progression:

- preparing context;
- analyzing visual target;
- plan formed;
- generating item `X / N`;
- saving result;
- succeeded;
- partially succeeded;
- cancelled;
- failed.

Operation metadata retains:

- plan;
- provider task IDs when available;
- successful result object IDs;
- failed items.

Single-item failures do not delete already-saved successful results, and generation always creates new image objects rather than mutating existing sources.

## Browser Mock Acceptance

The recommended acceptance path avoids paid-provider usage:

1. run local dev server;
2. open the current real browser project at `/projects/project-morpho-case-study`;
3. preload or manipulate selection state through real UI or seeded local storage;
4. intercept the active `/api/ai/agent` and `/api/ai/image` routes;
5. assert request payloads and visible UI status;
6. return mocked provider plan JSON and mocked image bytes.

Minimum flows to verify:

- selected material -> research route;
- selected directions -> direction preview with preview-count summary and grouped placement;
- selected image -> visual development with provider image attachments and Grs image-only references;
- selected image + analysis wording -> ordinary chat, not image generation;
- manual task-mode override beats auto-routing;
- design-trace overlay still opens and closes.

## Manual Paid Smoke Path

Real provider smoke is intentionally manual and out of the default command path.

If a human explicitly wants a paid smoke test:

1. prepare real `.env.local` keys;
2. set `MORPHO_ALLOW_PAID_SMOKE_TESTS=true`;
3. run local dev server;
4. manually exercise one research route and one image-generation route;
5. verify that no raw provider payload, full document text, or Base64 asset is written into workspace JSON or localStorage.

The agent should not run this automatically.

## Current Provider Transcript Follow-up

The current Responses Agent keeps the M4.3 task-context boundary but adds a durable provider transcript contract. Formal user messages store an immutable provider-visible snapshot, while provider-only Context Frames carry a deterministic `sequence` and `placement`. Project State is task-independent; strategy, selection, authorization, and task memory remain in Turn Context; Runtime Configuration contains only semantic runtime changes.

Active requests use the snapshot before current workspace state, retain all usable uncompressed chat, and insert post-tool state after the initiating user instead of moving it to the front on replay. Summary frames use `provider-frame-conversation-summary:<summaryRevisionId>` and one active frame per revision. Client and server share `src/shared/providerInputBudget.ts`, so active frames, history, tools, image reserve, and the separate response reserve participate in the fixed 256k / 80% / 90% policy without trimming during prepare.

Old messages use a `legacyProviderInput` fallback. Document extracts are captured in the snapshot when sent; unavailable extracts, image input, prompt-contract changes, tool-profile changes, and compaction are explicit cache boundaries. Prompt-cache key and retention remain opt-in; `in_memory` is ignored, and only a capability-verified `24h` value is forwarded. Cache metadata is classified as unavailable, miss, partial hit, or full hit. Original chat and summary revisions remain intact for search, backup, and restore.

## Out of Scope After M4.3

Still not implemented after this milestone:

- context compression or long-term memory;
- document readers and page thumbnails;
- OCR and layout-faithful extraction;
- compare runtime;
- delivery/export/archive pipelines;
- cloud sync and collaboration;
- autonomous agent execution;
- automatic paid-provider smoke automation.
