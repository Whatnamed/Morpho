# M5-C Comparison And Decision Writeback

## Scope

M5-C implements Compare as a local workspace operation: explicit selected sources are analyzed, the user confirms a concrete decision, and only then Morpho writes real domain state.

Compare is not a page, stage, score table, ranking engine, project memory entry, or autonomous decision maker.

## Source And Evidence Contract

New Compare source selection is limited to 2-4 active objects selected by the user. Hidden, missing, duplicate, or unselected objects cannot become new Compare sources.

Allowed source types are `file`, `image`, `research`, `keyConclusion`, `documentFragment`, and `conceptDirection`. A `file` is eligible only when it has a usable parsed `documentExtract` and that extract is sent in the current request. A `documentFragment` is eligible only when the fragment object itself is active and explicitly selected.

The server request carries a separate `comparisonContext`:

```ts
type ComparisonContext = {
  sourceObjectIds: string[];
  attachedImageObjectIds: string[];
  unavailableImageObjectIds: string[];
  attachedDocumentObjectIds: string[];
  unavailableDocumentObjectIds: string[];
  backgroundObjectIds: string[];
};
```

Each model-produced `objectComparison` must declare `evidenceBasis` as `pixels`, `documentExtract`, `documentFragment`, or `objectSummary`. Local validation rejects basis values that do not match the actual request inputs. If any selected image lacks pixels or a contact sheet, `evidenceLimits` is required and that image cannot claim `pixels` basis or visual evidence.

## Background Context Boundary

Compare receives a slim `comparisonBackgroundContext` containing the current effective design definition, bounded project continuity, and default-reference status.

This background can explain criteria, for example comparing directions against the current definition, but it cannot enter `sourceObjectIds`, `objectComparisons`, `keyConclusionCandidate.evidence`, or decision targets.

## Proposal Suppression

If the same assistant reply includes `morphoDesignDefinitionProposal` or `morphoConceptDirectionProposal`, Morpho may save and display that proposal, but it suppresses Compare writes, semantic patches, conversation checkpoints, and Compare decision entry points for that reply.

Pending design/direction proposals are drafts, not stable project facts.

## Analysis Persistence

Schema v11 stores saved analyses under `workspace.ai.comparisonAnalyses`. Assistant messages link to the saved analysis by `comparisonAnalysisId`.

A saved `ComparisonAnalysis` keeps source snapshots. If a source later becomes hidden or missing, the Compare card remains visible with the stored snapshot. Active sources can still be located on the canvas; hidden or missing sources cannot be jumped to automatically.

M5-D1 document reading does not change Compare source-card behavior. Clicking an active file source from a Compare card remains object location/focus only; reading the local extract still requires the explicit bottom-detail `阅读解析内容` action.

`ComparisonAnalysis.sourceObjectIds` and `objectComparisons` must exactly cover the explicit selection. `keyConclusionCandidate` is only a draft and may use only true text evidence sources from the selection: sent document extracts, selected active document fragments, research objects, or existing key conclusions. Direction summaries, images, object summaries for files, source files behind fragments, and background context cannot become key-conclusion evidence.

For document fragments, `sourceObjectIds` point to the fragment object. The original file is not automatically added as a Compare source or authorization target. Provenance follows `documentFragment -> source file / extract asset / offset range / block IDs`.

## Decision Writeback

Compare decisions reuse the existing pending confirmation card. Reason rules are action-specific:

- Eliminating a direction, restoring an eliminated direction, setting default reference, and clearing default reference require a user reason.
- Setting a non-eliminated direction as primary or alternative may leave the reason empty, but still requires explicit confirmation.

Eliminated directions expose only `restoreAlternative` from a Compare card. They cannot be promoted directly to primary or alternative from Compare.

Before opening a confirmation and again before final writeback, Morpho validates that the analysis still exists, the target belongs to `analysis.sourceObjectIds`, the target object still exists and is active, and the current object type/status matches the requested action.

Confirmed writebacks create normal `DecisionRecord` entries and the associated deterministic continuity events. They include lightweight comparison metadata:

```ts
type ComparisonDecisionMetadata = {
  comparisonAnalysisId: string;
  comparisonAssistantMessageId: string;
  comparisonSourceObjectIds: string[];
  userReason?: string;
};
```

Decision records do not copy the full Compare prose or full analysis body.

## Tests

Primary coverage lives in:

- `src/domain/morpho/comparisonAnalysis.test.ts`
- `src/features/workspace/comparisonAction.test.ts`
- `src/features/workspace/components/AiConversationPanel.test.ts`
- `src/server/ai/request.test.ts`
- `src/domain/morpho/workspace.test.ts`

Browser acceptance should verify explicit selection, proposal suppression, decision-card reason behavior, cancellation without state write, and saved-card visibility after source hidden/missing changes.
