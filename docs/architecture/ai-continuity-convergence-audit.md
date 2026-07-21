# AI Continuity Convergence Audit

Date: 2026-07-21
Baseline HEAD: `fafa9694dd5257924afde7cf8d103874ea9fd7a1`
Target: Morpho v3.2 AI continuity, memory, Agent, and image-generation contract.

## Scope

This audit compares the v3.2 product rules with the current schema 14 implementation before code migration. It covers the formal AI panel, conversation persistence and compaction, project memory, stage records, visual planning, delivery drafting, backup/restore, the built-in case study, and user-visible process feedback.

## Confirmed Gaps

| Area | Current implementation | v3.2 rule | Gap and affected files |
|---|---|---|---|
| Conversation history | `buildConversationLaneKey` includes focus epoch, task, selected objects, directions, and branch. `buildConversationContextForRequest` sends only the lane and limits it to 6/8 messages and 2,600 characters. | All uncompressed project-chat history participates within the Token Budget. Lane is metadata only. | History is split into islands and silently dropped. `conversationCheckpoint.ts`, `WorkspaceClient.tsx`, `morphoAgent.ts`. |
| Server pressure handling | Context pressure keeps a fixed 4/2 history messages and truncates old tool outputs before a persisted summary exists. | `prepare` does not drop messages; `compact` advances only after a valid persisted summary; emergency retry preserves completed tool effects. | Current request can lose older discussion before a durable boundary exists. `agentContextBudget.ts`, Agent route/client loop. |
| Compaction persistence | Schema 14 stores lane-local `ConversationCheckpoint` with a 900-character body and no revision chain or project-wide covered boundary. | Store summary revisions, previous revision, covered message range/count, source hash, estimated tokens, and a project-wide compaction state. | Cannot prove freshness, avoid repeat compaction, or restore a single continuous boundary. `types.ts`, `workspace.ts`, backup code. |
| History queries | Agent can only call `read_selected_context`; old-chat questions are answered from supplied context. | `search_project_conversation` supports earliest/latest, keyword, role, time range, neighboring context, message ID, and time. | The two reported questions can be guessed incorrectly. `morphoAgent.ts`, `WorkspaceClient.tsx`. |
| Project memory | Seven `ProjectMemoryView`s are derived on read. They have no current revision pointer, historical revisions, basis, or document-level source contract. | Seven stable, versioned, source-driven current projections; structured project state remains authoritative. | Memory cannot be restored or audited as a current projection. `projectContinuity.ts`, schema and records drawer. |
| Memory semantics | `preferencesAndAvoids` combines DesignDefinition principles/constraints/avoids with semantic entries. | User Preferences contains only explicit or confirmed stable user preferences and direct sources. Design Brief projects the applied definition. | Definition facts are mislabeled as user preference. `projectContinuity.ts`. |
| Stage records | `getContinuityRecordGroups` groups append-only Continuity Events by stage. | Six current Stage Records have revision chains and eight optional semantic sections. Events remain separate audit history. | Event history currently masquerades as current stage records. `projectContinuity.ts`, records drawer. |
| Memory updates | Legacy semantic patch is returned as hidden JSON from `/api/ai/chat`; the Agent path does not expose a controlled memory-write tool. | One coordinator combines deterministic projections and locally validated semantic candidates. | Ordinary Agent discussion cannot reliably record explicit stable preferences. `workspaceSemanticPatch.ts`, `researchSemanticPatch.ts`, Agent tools. |
| Task strategy | Formal Agent always builds `kind: "general"` and one long prompt. | Resolve discussion, research, design definition, concept direction, direction preview, visual development, comparison, delivery, and history/memory strategies. | Relevant context and tool policy are not selected deterministically. `WorkspaceClient.tsx`, `morphoAgent.ts`, `taskContext.ts`. |
| Runtime convergence | The normal panel uses `/api/ai/agent`, but delivery drafting falls back to `handleSendAiMessage` and `/api/ai/chat`; legacy research/image handlers remain in the panel component. | Formal panel uses one Responses Agent runtime and tools. | Delivery still has a second prompt, stream, and structured-write contract. `WorkspaceClient.tsx`, `/api/ai/chat`. |
| Visual plan | Agent `generate_visuals.items[].prompt` is the final provider prompt and `referenceObjectIds` is model-selected. | Agent returns structured intent; Morpho resolves references and compiles the provider prompt. | Prompt provenance and reference priority are nondeterministic. `morphoAgent.ts`, `visualGenerationPlan.ts`, generation metadata. |
| Reference resolution | Task context may add default reference only through draft wording; selected/model references are otherwise accepted from plan. | Explicit reference > selected source > branch root/parent > direction representative > applicable default > other required references; respect exclusion and provider limit. | Default can be omitted or model-chosen references can dominate. `taskContext.ts`, new pure resolver. |
| Image quantity | `DIRECTION_PREVIEW_COUNTS`, total 8, direction count <= 3, and count union `1 | 2 | 4 | 6` are enforced. | Those values are UI shortcuts only; 3/5/9/12 and more than three directions are valid, with transparent batching. | Backend and routing reject valid requests. `visualGenerationPlan.ts`, `visualGenerationRouting.ts`, `WorkspaceClient.tsx`, panel props/tests. |
| Generation record | Metadata stores final prompt and references, but not structured intent, reference-resolution omissions, adapter/version, or prompt contract version. | Persist intent, compiled prompt, reference result, model/parameters, and provider task ID. | A generated image cannot fully explain why it was produced. `types.ts`, generation commit helpers. |
| Process UI | Agent Trace is ordered, but semantic feedback says generic “saved as project record”; image phase detail also lives in a separate task-status surface. | Show accurate memory/stage update labels and only real process activities; no duplicate thinking. | Feedback semantics are too broad and image progress is split. `AiConversationPanel.tsx`, Agent activity mapping. |
| Records drawer | Drawer shows current focus, review events, and recent events. | Default views: current project memory, current stage records, history and sources, including revisions. | Users cannot inspect the actual current projections required by v3.2. `OverlayDrawers.tsx`. |
| Schema and migration | Schema 14 migrates checkpoints and continuity events but has no memory kernel or compaction state. | New schema initializes deterministic memory/stage projections, migrates old checkpoints without deleting them, and is idempotent. | Old projects cannot enter the new runtime safely. `types.ts`, `workspace.ts`, fixtures/tests. |
| Backup and case study | Editable snapshot preserves workspace fields when chat is included, but full chat is optional and archive contracts do not expose new projections/summary revisions. | Editable backup retains raw chat, trace, compaction, memory/stage revisions, continuity, and full generation provenance. Case study is regenerated under the new schema. | New state can be omitted unless contracts and defaults change. `projectArchive.ts`, bundles, case-study importer/generated fixture. |

## Implementation Sequence

1. Upgrade the workspace schema and add conversation-compaction, project-memory, stage-record, and generation-provenance types.
2. Implement pure conversation selection, summary parsing/apply, history search, and migration from legacy checkpoints.
3. Implement the Memory Kernel and coordinator: deterministic projection first, controlled semantic update second, current-revision reads for Agent/UI.
4. Add Task Strategy Resolver and Prompt Registry, then add real read/query/update/delivery tools to the Agent.
5. Replace final-prompt visual tool arguments with structured visual intent, deterministic reference resolution, and `ImagePromptCompiler`; remove count limits.
6. Wire the formal panel to Agent-only delivery, memory feedback, compaction, and records views. Retain `/api/ai/chat` only as a compatibility route with no formal-panel caller.
7. Extend archive/backup validation and case-study generation, update architecture/decisions/runbook, then run focused and full verification.

## Migration Risks

- Existing case-study messages have lane keys and legacy checkpoints. Migration must preserve both as audit data while deriving one project-wide summary boundary only when the source range is valid.
- Deterministic memory reconciliation runs frequently. It must compare semantic content and avoid creating revisions for timestamps or unrelated UI edits.
- User-preference writes require an exact persisted user-message source and evidence quote; otherwise AI suggestions could become false long-term facts.
- Emergency context retry must not replay completed local tools. Summary/compaction work must happen before a new request or retain the latest function-call/output tail.
- Provider reference-image limit is four. Resolution must record omitted references rather than silently dropping or rejecting the whole visual plan.
- The current case-study fixture is generated. It must be regenerated through the importer, never hand-edited, and the source backup ZIP must remain uncommitted.

## Acceptance Evidence

- Unit tests prove global uncompressed history, boundary-based history after compaction, no lane isolation, failed-compaction atomicity, and original-message retention.
- Agent tool tests prove earliest/keyword conversation search and current memory/stage reads before absence claims.
- Memory/stage tests prove deterministic projections, explicit-only preferences, source refs, revision chains, dedupe, and review-required behavior.
- Agent tests prove strategy selection, delivery tool use, controlled memory update, Responses-only formal runtime, trace/citation preservation, and confirmation behavior.
- Image tests prove role-specific compiler output, reference priority/exclusion/limit, persisted provenance, arbitrary positive counts, more than three directions, batching, and partial-failure preservation.
- Migration and bundle round trips prove old schema compatibility, idempotence, full raw chat, compaction, memory/stage revisions, Agent Trace, and generation provenance.
- Browser acceptance runs the two reported questions plus continuity, preference, direction decision, low-threshold compaction, image, delivery, and editable-backup scenarios with a clean console.

## Implemented Outcome

- Workspace schema 15 now stores project-wide compaction state and summary revisions, seven typed project-memory responsibilities and revisions, six typed stage-record responsibilities and revisions, and generation provenance for structured intent, compiled prompts, reference resolution, model, and provider data.
- The formal panel uses the Responses Agent route for discussion, research, design definition, directions, comparison, delivery drafting, history queries, memory reads, stage reads, controlled semantic updates, and image planning. `/api/ai/chat` remains compatibility-only and has no formal-panel caller.
- Request assembly now uses all uncompressed project conversation within the effective Token Budget, or the current summary plus every message after its persisted boundary. Lane, focus, selection, direction, and visual branch remain metadata and strategy inputs rather than history partitions.
- The Memory Kernel reconciles deterministic projections from current objects, revisions, decisions, directions, default reference, delivery, and operations. Semantic writes are limited to source-backed, locally validated candidates such as explicit stable user preferences.
- Task Strategy and Prompt Registry v3.2 select the relevant context contract, tools, and output rules without creating separate chats. Delivery drafting is a pending Agent tool result until the user applies it.
- Image generation now resolves references deterministically, compiles role-specific provider prompts from structured intent, accepts arbitrary positive counts, supports more than three directions, and executes with bounded concurrency while preserving partial success and source assets.
- The project-record drawer now separates current project memory, stage records, and history with sources. Agent trace is the single process surface for tool work, compaction, image progress, and accurate memory/stage feedback.
- Editable backups default to full chat and current continuity, include schema-15 memory/stage/compaction/generation state, and restore as independently keyed project copies. The current case-study fixture and upgrade script are schema-15 and idempotent.

## Provider Input, Prompt Cache, Memory Trim, And Image Boundary Follow-up

Audit date: 2026-07-22. The following findings were rechecked against the fafa969 baseline before implementation and then revalidated against the current checkout:

| Check | Result |
|---|---|
| Stable system prefix | `buildMorphoAgentStableSystemPrompt()` now contains only canonical product, authority, continuity, memory, tool, cache, and image-boundary rules plus the prompt contract version. Project title, selection, stage, memory body, default reference, task strategy, summary IDs, counts, pressure, and timestamps are no longer in this prefix. |
| Tool profile | Compare remains in the fixed tool collection. Web search is the only stable profile split (`standard` / `standardWithWebSearch`); order and schemas are deterministic. |
| Dynamic context | Project State, Turn Context, Runtime Configuration, and Conversation Summary are provider-only append-only frames. They are persisted in `workspace.ai.providerContextFrames`, excluded from ordinary chat search, and included in full editable backup/restore. |
| Uncompressed history | `buildContinuousConversationContext()` remains project-wide and keeps every usable message before the compact boundary. Prepare does not remove or summarize messages. Only persisted summary boundaries replace older active input. |
| Context budget | The fixed 256k / 204.8k / 230.4k policy remains. `targetUncompressedTokens` is only the compaction target; `responseReserveTokens` is a separate occupancy reserve used for pressure classification and request planning. |
| Cache capability | Cache key and retention fields are disabled by default, generated from hashed project ID plus model/contract/profile only when explicitly enabled, and removed on a compatible unsupported-field 400. Cached, uncached, and hit-ratio usage are normalized without double counting; missing provider cache metadata is `unavailable`. |
| Memory trim | Default memory uses semantic section priority and total item/character budgets. Design Brief keeps core problem, principles, constraints, and avoidances ahead of lower-priority sections. Stage sections use an explicit semantic order rather than object insertion order. |
| Memory guard | Invalid evidence, unauthorized items, missing skip reasons, and all-rejected patches stay retryable. `handled` becomes true only for an applied entry, an equivalent idempotent result, or a valid non-empty skip reason. |
| GRSAI image boundary | Reference input and image-to-image remain supported. Prompt-level `directedEdit` is distinct from `imageToImage`; no mask/inpainting field exists in the request, so `maskedLocalEdit` remains unavailable and the UI/prompt warn against pixel-lock claims. Sources are still never overwritten. |

The independent `npm.cmd run test:prompt-cache` probe exercises relay behaviors for unsupported 400, ignored unknown fields, and normal forwarding using deterministic mocks. `--live` is opt-in and requires both `MORPHO_ALLOW_PAID_SMOKE_TESTS=true` and `MORPHO_PROMPT_CACHE_PROBE_URL`.

## Verification Record

- On 2026-07-22, the full Vitest suite passed with 129 files and 873 tests. `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run test:prompt-cache`, and the standard `npm.cmd run build` used by the active Vercel deployment path also passed. No dependency was added. Cloudflare build and preview scripts were intentionally not run because they are dormant, opt-in paths rather than the active deployment target.
- The production `.next/static` and `.next/server` JavaScript bundle scan contained no `morpho:test:conversation-token-limits` localStorage override and no `MORPHO_AI_CONTEXT_*` threshold names. `git diff --check` passed; the build-generated `next-env.d.ts` change was restored as generated noise.
- Running `case-study:upgrade` twice produced schema 15 and the same SHA-256 both times: `51C0D9946D31FDF8739D7A25C6ADDA2006BB18083D60B0D180824CA8CDE233C0`.
- After Supabase was restarted, the authenticated Chrome page loaded and then reloaded successfully at `http://localhost:3000/projects/project-morpho-case-study`. This acceptance used the actual ocean-buoy project, not a medical-device or rural demo: the DOM showed ocean-noise materials, the `声学生态风险预警浮标系统` definition, and the `方向 1｜守望塔：长期驻留型声学浮标` direction. A paid, read-only Agent question completed with the response that the product line is a long-stay acoustic ecological risk-warning buoy; the server log recorded `POST /api/ai/agent 200` and no formal-panel `POST /api/ai/chat`. The returned UI ended in `状态 空闲`, kept the input disabled after completion, and did not create a canvas or memory mutation. The captured console warnings are limited to the known tldraw `zh-CN` missing-message warning and an existing browser-extension hydration attribute; no current Agent failure was observed after the reload.
- Editable-backup export and inspection previously verified schema 15, full chat, current continuity, 49 embedded assets, zero missing assets, zero size mismatches, and the expected memory, stage, trace, operation, decision, citation, delivery-draft, and generation records. Confirm-stage restore and round-trip behavior pass automated tests. The Chrome connector's security policy did not allow programmatic injection of a generated local ZIP into the native file chooser, so that final Chrome click was not represented as completed; no product failure was observed or concealed.
