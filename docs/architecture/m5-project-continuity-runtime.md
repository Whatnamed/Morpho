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

Revision updates affect only entries that directly reference the old revision. Default-reference changes affect only entries that directly reference the replaced default-reference source. Direction elimination is projected from the real direction status and does not delete history.

## Context Assembly

`src/features/workspace/taskContext.ts` adds `projectContinuity` to task context, and `/api/ai/chat` validates, trims, and serializes that context before provider calls.

Sorting is deterministic: task relevance tier, direct source match, current focus stage, validity rank, `updatedAt` descending, then `id` ascending.

Context inclusion follows validity rules:

- `current` can be included when task-relevant and all direct sources are active.
- `reviewRequired` is included only for direct matches and is labelled as needing review.
- `superseded` is excluded by default unless directly matched by selection or historical inquiry context.
- `sourceUnavailable` is excluded from factual context and appears only in review lists when relevant.

Task-specific context remains narrow: research gets inputs, constraints, definitions, research, and open questions; definition gets inputs, research, constraints, and current definition; direction tasks get definition, preferences, conclusions, and decisions; visual tasks get definition, direction, VisualBranch, direct decisions, and relevant review items; general chat gets current focus and a small direct basis.

## UI

The left rail includes a lightweight `项目记录` drawer. It shows current focus, current basis, review items, six record groups, and seven memory projections.

Clicking a source in this drawer only locates/selects the real source object. It does not mutate focus, trigger AI, or write continuity events.

The project homepage shows recent work focus, last explicit continuity update, and a deterministic note. It does not show stage progress, percentages, unlock states, or Kanban-style workflow state.

## M5-B1 Extension

Schema v9 extends project continuity with explicit conversation semantic records. These records use `origin: conversationSemanticPatch`, `manualState`, `semanticKind`, `sourceMessageId`, `evidenceQuote`, `scope`, and typed `message` source refs.

Provider output is only a candidate. `/api/ai/chat` may ask for `morphoProjectContinuityPatch` only during `chatAnalysis` and `researchOperation`, and never during `imageGeneration`. Local parser, authorization, validation, deterministic summary generation, and domain write rules decide what is stored.

Provider summaries are ignored. Stored summaries are deterministic templates derived from `semanticKind + evidenceQuote`, such as `明确偏好：{quote}` or `待确认问题：{quote}`. The exact quote must be a bounded substring of the current user draft.

`SemanticPatchAuthorization` is built from the current task context and direct source IDs. Validation does not scan the full workspace to guess related objects. Hidden selected objects are excluded from task-context object IDs and cannot become new active semantic sources.

If the same assistant reply includes a Proposal block (`morphoResearchProposal`, `morphoDesignDefinitionProposal`, or `morphoConceptDirectionProposal`), conversation semantic writing is blocked. Proposal application and successful research-object creation continue to use deterministic M5-A continuity events.

`manualState`, `validity`, and `sourceAvailability` remain independent. `getContinuityEntryEligibility` centralizes how those values affect memory, default context, review lists, UI labels, and prompt serialization.

See `docs/architecture/m5-b1-conversation-semantic-records.md` for the full contract.
