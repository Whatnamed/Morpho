# M5-B1 Conversation Semantic Records

## Scope

M5-B1 upgrades workspace data to schema v9 and lets Morpho write a small, controlled subset of explicit user conversation into `workspace.projectContinuity.recordEntries`.

This feature records only clearly stated long-lived preferences, constraints, avoidances, open questions, decision reasons, and rejection reasons. It does not change project facts, object state, direction status, design definitions, default references, visual branches, delivery references, or current focus.

Out of scope: automatic chat compression, transcript replacement, Compare, automatic status changes, default-reference changes, definition or direction application, new document readers, delivery export, archive restore, agent loops, permanent mock routes, and paid provider smoke tests.

## Data Model

Schema v9 keeps `workspace.projectContinuity` as the single continuity entry point and upgrades `ProjectContinuityState.schemaVersion` to `2`.

`ContinuityRecordEntry` now includes:

- `origin`: `deterministicEvent` or `conversationSemanticPatch`.
- `manualState`: `active`, `notApplicable`, or `withdrawn`.
- `semanticKind`: optional semantic patch kind.
- `sourceMessageId`: the user message that supplied the exact quote.
- `evidenceQuote`: a bounded quote from the user message.
- `scope`: `project`, `designDefinition`, `direction`, or `visual`.

`ContinuitySourceRef.kind` now supports `message`. Message refs store only the message ID, title `用户表达`, the short quote snapshot, created time, and source availability. Full chat text is not copied into continuity records.

## Provider Contract

The provider may return a fenced JSON block with top-level key `morphoProjectContinuityPatch` only for `chatAnalysis` and `researchOperation` requests.

Allowed shape:

```json
{
  "morphoProjectContinuityPatch": {
    "items": [
      {
        "kind": "preference",
        "scope": "project",
        "evidenceQuote": "exact user quote",
        "relatedObjectIds": [],
        "relatedRevisionIds": [],
        "relatedDecisionIds": []
      }
    ]
  }
}
```

Allowed `kind` values are `preference`, `constraint`, `avoidance`, `openQuestion`, `decisionReason`, and `rejectionReason`. Allowed `scope` values are `project`, `designDefinition`, `direction`, and `visual`.

The provider must not generate long-term `summary`. If a `summary` field appears on an item, Morpho ignores it. The local domain builds deterministic summaries from `semanticKind + evidenceQuote`, for example `明确偏好：{quote}` or `待确认问题：{quote}`.

The parser rejects unexpected top-level fields, unexpected item fields, state mutation fields, invalid kinds/scopes, too many items, and unsafe quotes. It accepts `summary` only as an ignored compatibility field.

## Authorization And Validation

Provider output is only a candidate. Local code is authoritative:

- `buildSemanticPatchAuthorization` creates a `SemanticPatchAuthorization` from the current `TaskContextResult`, user message ID, message timestamp, current draft, current focus area, and authorized direct IDs.
- `validateConversationSemanticPatch` checks only that authorization object. It does not scan the full workspace to guess related objects or repair provider output.
- `evidenceQuote` must be a normalized substring of the current user draft and is capped at 180 characters.
- Quotes containing Base64 data URLs, raw provider payload markers, or URLs are rejected.
- Related object, revision, and decision IDs must be in the authorization sets.
- Hidden selected objects are excluded from `TaskContextResult.objectIds`, so they cannot become new active semantic sources.
- Non-project scopes require at least one authorized direct source.
- `decisionReason` and `rejectionReason` require an authorized `DecisionRecord` source; an arbitrary object ID is not enough.

If the same assistant reply contains any Proposal block, including `morphoResearchProposal`, `morphoDesignDefinitionProposal`, or `morphoConceptDirectionProposal`, semantic patch writing is blocked. Research proposals still use the M5-A deterministic `researchApplied` path when applied successfully.

## Domain Write Rules

`applyConversationSemanticPatch` resolves continuity validity first, validates each item, and appends only accepted records. It does not update `currentFocus`.

Dedupe uses:

```text
userMessageId + semanticKind + scope + deterministicSummary + stable related source IDs
```

Replaying the same semantic patch for the same user message does not append duplicates.

Conversation semantic entries are written into the current focus stage for grouping only. The current focus itself remains unchanged.

## Eligibility

`getContinuityEntryEligibility(entry)` is the centralized rule for `manualState x validity x sourceAvailability`.

It returns:

- `canEnterMemory`
- `canEnterDefaultContext`
- `canEnterReviewList`
- `uiLabel`
- `reason`

Memory views, continuity context, request prompt serialization, and the project-record drawer rely on this function instead of scattering independent `if` logic.

Important combinations:

- `manualState=withdrawn` or `manualState=notApplicable`: stays in history, excluded from memory/default context/review list.
- `sourceAvailability=hidden`: validity stays unchanged, but the entry is excluded from memory and default context and labelled `来源已隐藏`.
- `sourceAvailability=missing` or `validity=sourceUnavailable`: excluded from factual context and eligible for review list.
- `validity=reviewRequired`: review list only, and only when directly relevant.
- `validity=superseded`: excluded by default unless selected or historical context is requested.

## Request And UI Flow

`/api/ai/chat` adds semantic patch instructions only for `chatAnalysis` and `researchOperation`. `imageGeneration` never receives the instruction.

Route validation trims `projectContinuity`, `message` source refs, summaries, and source snapshots before provider prompt construction. It does not send full chat bodies through continuity refs, Base64 payloads, raw provider payloads, or internal storage details.

Client flow:

1. Persist the real user message.
2. Read the provider reply.
3. Strip `morphoProjectContinuityPatch` JSON from visible assistant text.
4. Skip semantic writing on request failure, cancellation, stream interruption, invalid format, validation failure, image generation, or any Proposal block.
5. Apply accepted semantic entries locally.
6. Attach `continuityEntryIds` to the assistant message.

The assistant message then shows a lightweight `已补入项目记录 · N 条` button. Clicking it opens and highlights the project-record drawer; it does not trigger AI, change focus, or mutate objects.

The drawer labels semantic entries as `来自明确对话 · 偏好/约束/避免项/待确认/决策理由/淘汰理由`, shows the deterministic summary, exact quote, source refs, validity, source availability, and manual-state actions. Only semantic entries can be marked `不再适用`, `撤回记录`, or restored to `当前有效`.

## Migration

The v8 -> v9 migration marks existing M5-A continuity entries as `origin: deterministicEvent` and `manualState: active`. It does not fabricate semantic patch metadata or message refs.

Migration remains pure and idempotent. Existing objects, revisions, operations, proposals, citations, visual branches, decision records, delivery references, and project-continuity entries are preserved.

## Tests

Primary coverage lives in:

- `src/domain/morpho/conversationSemanticPatch.test.ts`
- `src/domain/morpho/projectContinuity.test.ts`
- `src/domain/morpho/workspace.test.ts`
- `src/features/workspace/workspaceSemanticPatch.test.ts`
- `src/features/workspace/components/AiConversationPanel.test.tsx` or `.test.ts`
- `src/features/workspace/components/OverlayDrawers.test.ts`
- `src/server/ai/request.test.ts`

Use the runbook browser mock flow to verify visible feedback and drawer interactions without creating permanent mock routes or calling paid providers.
