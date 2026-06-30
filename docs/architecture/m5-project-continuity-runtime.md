# M5-A Project Continuity Runtime

## Scope

M5-A implements the schema v8 project-continuity foundation in local workspace JSON. It adds a single structured continuity entry point at `workspace.projectContinuity` and removes the old runtime dependence on `project.currentFocus` and `workspace.stageRecords`.

The continuity runtime does not become the source of truth. Real facts remain in Morpho objects, revisions, operations, proposals, citations, relations, visual branches, delivery references, and decision records.

Out of scope for this runtime: automatic project summaries, context compression, Compare as a workflow stage, delivery export runtime, OCR/PDF/PPT readers beyond the existing local extracts, autonomous agent loops, permanent mock routes, and paid-provider smoke tests.

## Data Model

`workspace.projectContinuity` contains:

- `currentFocus`: structured current work focus with `area`, update time, source kind, source object IDs, optional source operation ID, and a short deterministic note.
- `recordEntries`: append-only continuity entries with stable `dedupeKey`, stage, category, summary, typed source refs, timestamps, validity, and invalidation reasons.
- `updatedAt`: last continuity update time.

The six record stages are `startAndInput`, `exploration`, `research`, `designDefinition`, `directionAndVisual`, and `deliveryPreparation`.

The seven derived memory views are `projectOverview`, `designDefinition`, `preferencesAndAvoids`, `decisionLog`, `rejectedDirections`, `openQuestions`, and `deliveryPlan`.

## Migration

Schema v8 migrates legacy `project.currentFocus` only as an input to initialize `projectContinuity.currentFocus`. Runtime code no longer reads `project.currentFocus` for business decisions.

Legacy `stageRecords` are retired. Existing v7 stage snapshots are not bulk-converted into history, so schema v8 does not create a second stage-truth source.

Blank and migrated projects do not invent history. A project with no meaningful source objects starts with an empty `recordEntries` array.

## Event Rules

Continuity events are explicit domain events only. Selection, drag, zoom, drawer toggles, ordinary chat, and canvas navigation do not update current focus or write records.

Each event is idempotent through a stable `dedupeKey` based on the event type and durable IDs such as object IDs, revision IDs, operation IDs, branch IDs, and default-reference IDs. Replaying the same event returns the same workspace shape without appending duplicate entries.

Proposal creation is not a fact. Failed or cancelled operations do not write successful outputs. Partial-success batches record only successful objects; failures can appear in a system note or operation metadata, but not as outputs.

Image-generation batches write at most one `output` continuity entry per operation, with deterministic counts for successful and failed results.

## Source Refs

Continuity records use typed source refs instead of free-form source strings. Supported ref kinds are `object`, `revision`, `operation`, `branch`, `decision`, `citation`, and `deliveryReference`.

Refs carry lightweight snapshots only: title, object type, revision number, status, visibility, and short summary snippet where available. They must not store document bodies, Base64 data, long prompts, raw provider payloads, or API responses.

## Validity

`resolveContinuityValidity` recalculates entry validity from current workspace state before event append and context assembly.

Validity values are:

- `current`: the historical fact still stands; source availability is tracked separately.
- `reviewRequired`: the fact may need review before reuse, such as an archived VisualBranch the user is trying to continue from.
- `superseded`: direct referenced revision or default reference has been replaced.
- `sourceUnavailable`: direct source was deleted or is missing.

Source availability is separate from entry validity: `active`, `hidden`, or `missing`. Hidden sources keep the original entry validity and are labelled as hidden, but they stay out of default active AI context. Deleted or missing sources keep their lightweight snapshot and mark the entry `sourceUnavailable`.

Message source refs are recalculated strictly from current `workspace.ai.messages`. A removed user message becomes `sourceAvailability: "missing"` even if the persisted ref previously said `active`; the continuity entry keeps its quote snapshot but no longer enters factual memory or provider context.

Revision updates affect only entries that directly reference the old revision. Default-reference changes affect only entries that directly reference the replaced default-reference source. Direction elimination is projected from the real direction status and does not delete history.

## Context Assembly

`src/features/workspace/taskContext.ts` adds `projectContinuity` to task context, and `/api/ai/chat` validates, trims, and serializes that context before provider calls.

Sorting is deterministic: task relevance tier, direct source match, current focus stage, validity rank, `updatedAt` descending, then `id` ascending.

`deriveProjectMemoryViews(workspace)` produces the global drawer/readback projection and may still show all currently valid scoped semantic entries. Provider requests use a task-filtered projection produced during `buildProjectContinuityContext`, after applying semantic scope and direct typed-source relevance.

Context inclusion follows validity rules:

- `current` can be included when task-relevant and all direct sources are active.
- `reviewRequired` is included only for direct matches and is labelled as needing review.
- `superseded` is excluded by default unless directly matched by selection or historical inquiry context.
- `sourceUnavailable` is excluded from factual provider context. The project-record drawer still shows it as historical/source-unavailable evidence; provider review lists are reserved for `reviewRequired` items that are directly relevant to the current task.

Task-specific context remains narrow: research gets inputs, project-scope constraints, deterministic research context, and directly relevant records; definition gets inputs, research, design-definition scope, constraints, and current definition; direction tasks get definition, preferences, conclusions, decisions, and directly matched direction scope; visual tasks get definition, direction, VisualBranch, direct decisions, directly matched visual scope, and relevant review items; general chat gets project scope plus scoped records only when there is a direct selected source match.

Semantic scope filtering happens before continuity budget truncation. Unrelated direction/visual scoped records therefore cannot consume the stage-record or memory-view budget needed by project-level constraints.

## UI

The left rail includes a lightweight `项目记录` drawer. It shows current focus, current basis, review items, six record groups, and seven memory projections.

Clicking a source in this drawer only locates/selects the real source object. It does not mutate focus, trigger AI, or write continuity events.

The project homepage shows recent work focus, last explicit continuity update, and a deterministic note. It does not show stage progress, percentages, unlock states, or Kanban-style workflow state.

## M5-B1 Extension

Schema v9 extends project continuity with explicit conversation semantic records. These records use `origin: conversationSemanticPatch`, `manualState`, `semanticKind`, `sourceMessageId`, `evidenceQuote`, `scope`, and typed `message` source refs.

Provider output is only a candidate. `/api/ai/chat` may ask for `morphoProjectContinuityPatch` only during `chatAnalysis` and `researchOperation`, and never during `imageGeneration`. Local parser, authorization, validation, deterministic summary generation, and domain write rules decide what is stored.

Provider summaries are ignored. Stored summaries are deterministic templates derived from `semanticKind + evidenceQuote`, such as `明确偏好：{quote}` or `待确认问题：{quote}`. The exact quote must be a bounded substring of the current user draft.

`SemanticPatchAuthorization` is built from the current task context and direct source IDs. Validation does not scan the full workspace to guess related objects. Hidden selected objects are excluded from task-context object IDs and cannot become new active semantic sources.

If the same assistant reply includes `morphoDesignDefinitionProposal` or `morphoConceptDirectionProposal`, conversation semantic writing is blocked. `morphoResearchProposal` is not a global suppressor; on successful research creation, Morpho may also apply a valid semantic patch from the pre-request context and persisted user message. The semantic patch cannot bind the newly created research card as a source.

`manualState`, `validity`, and `sourceAvailability` remain independent. `getContinuityEntryEligibility` centralizes how those values affect memory, default context, review lists, UI labels, and prompt serialization.

Streaming assistant display hides `morphoProjectContinuityPatch` fenced JSON, including trailing unclosed blocks, while keeping the original completed stream text available to parsers.

See `docs/architecture/m5-b1-conversation-semantic-records.md` for the full contract.

## M5-B2 Boundary

M5-B2 adds short-term conversation checkpoints in `workspace.ai.conversationCheckpoints`. These checkpoints are not project continuity entries, do not enter memory views or the project-record drawer, and do not affect `currentFocus`, validity, source availability, or stage-record grouping.

Project continuity remains responsible for real project facts and long-term explicit semantic records. Conversation checkpoints only summarize the current discussion lane for the next ordinary chat request. See `docs/architecture/m5-b2-conversation-checkpoints.md`.
