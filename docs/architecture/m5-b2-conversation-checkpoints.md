# M5-B2 Conversation Checkpoints

## Scope

M5-B2 adds automatic short-term conversation checkpoints for long ordinary chat discussion/comparison turns. The goal is to keep the next request coherent without sending the entire visible transcript to the provider.

This is not project memory, a design definition, a DecisionRecord, direction status, default reference state, delivery preparation, Compare, archive restore, or a user-managed summary feature.

## Data Model

Schema v10 adds `workspace.ai.conversationCheckpoints`. `ProjectContinuityState` remains schema v2.

Each `ConversationCheckpoint` stores one current checkpoint per lane:

- `laneKey`, `focusArea`, `focusUpdatedAt`, and `taskKind` bind the note to one current discussion range.
- `anchorObjectIds`, `targetDirectionIds`, and optional `visualBranchId` are lightweight anchors only.
- `sourceStartMessageId`, `sourceEndMessageId`, and `sourceMessageCount` record the source range without copying transcript text.
- `threadGoal`, `progress`, `openThreads`, and optional `nextTurnAnchor` are the bounded short-term discussion note.

`AiMessage` may carry `conversationLaneKey` and `conversationCheckpointId`. Messages never duplicate checkpoint content.

Migration v9 -> v10 initializes an empty `conversationCheckpoints` array, preserves all old `ai.messages`, does not invent lane keys for historical messages, does not modify `projectContinuity`, and remains idempotent.

## Lane Key

`buildConversationLaneKey` is deterministic and does not use canvas coordinates, visual proximity, draft text, or model guesses.

The current implementation uses:

- `projectContinuity.currentFocus.area`;
- `projectContinuity.currentFocus.updatedAt` as the focus epoch;
- task context kind;
- sorted explicitly selected active object IDs;
- sorted directly selected direction IDs plus selected-image `directionId` values;
- an optional unique `visualBranchId` that comes directly from the selected images.

It does not use auto-included task-context objects such as the current design definition, related key conclusions, or other derived context helpers.

The focus epoch is part of the key so a new applied definition, direction, research result, or visual-development action can naturally start a new discussion lane even when the focus area name stays the same.

## Trigger Rules

Checkpoint requests are deterministic. Morpho asks for a checkpoint only when:

- `taskMode === "chatAnalysis"`;
- `workIntent === "discussion"` or `workIntent === "comparison"`;
- the request is not image generation, research operation, design-definition proposal, or concept-direction proposal;
- the current request is not in a pending-proposal state;
- the current lane has enough completed user/assistant chat after the last checkpoint.

Current constants:

- message threshold: at least 8 usable messages and at least 3 user messages;
- character threshold: at least 5,200 characters and at least 2 user messages;
- recent raw messages with checkpoint: 6;
- recent raw messages without checkpoint: 8;
- stored checkpoint retention: 10 lanes.

Failed, cancelled, streaming, error, system, import-failure, and non-chat task messages are not compressible sources.

## Request Context

For ordinary discussion, the provider receives:

```text
current user draft
+ task/project context, including M5-A / M5-B1 projectContinuity
+ same-lane usable checkpoint when valid
+ recent raw messages after that checkpoint
```

The current draft is sent only as `draft`, not repeated inside `messages`. If no same-lane checkpoint exists, Morpho keeps bounded fallback history so first-time ordinary chat does not lose existing context. Historical messages without `conversationLaneKey` can be used for that fallback, but they are not forced into a new lane.

The server route accepts only a sanitized `conversationContext` containing checkpoint text, `recentMessageCount`, and `checkpointRequested`. It does not expose lane keys, source message IDs, localStorage details, or full checkpoint storage metadata to the provider.

The system prompt states the priority:

```text
current user input > real project facts/projectContinuity > checkpoint > recent raw messages
```

The checkpoint is described as a non-authoritative current discussion note.

## Parser, Validator, And Storage

Providers may return a fenced JSON block with top-level `morphoConversationCheckpoint`. The local parser and validator reject invalid JSON, extra fields, empty checkpoints, overlong fields, too many items, URLs, Base64, code fences, prompt/system dumps, raw-provider markers, state-write commands, and object/revision/decision IDs.

A checkpoint write only succeeds after the relevant user and assistant messages are already persisted, the assistant message belongs to the same lane, the task is ordinary chat discussion/comparison, the request actually asked for a checkpoint, no pending proposal is present, no design-definition or concept-direction Proposal is present, and parser/validator both pass.

The source range must also be valid in the domain layer: `sourceStartMessageId` and `sourceEndMessageId` must belong to the same lane, `sourceStartMessageId` must not be after `sourceEndMessageId`, `sourceEndMessageId` must equal the completed assistant message being saved, and every message in the stored source range must be a compressible `chatAnalysis` user/assistant message from that lane.

Updating a lane keeps the same checkpoint ID and original `sourceStartMessageId`, advances `sourceEndMessageId`, updates count and timestamp, and never deletes raw `ai.messages`. Retention removes only the least recently updated checkpoint records beyond the lane limit.

## Relationship To Project Continuity And Semantic Patches

`projectContinuity` remains the project-fact continuity system. Conversation checkpoints never enter `projectContinuity.recordEntries`, memory views, the project-record drawer, current focus, objects, revisions, directions, VisualBranch state, default references, delivery references, or DecisionRecords.

`morphoProjectContinuityPatch` and `morphoConversationCheckpoint` may appear in the same ordinary discussion reply. They are parsed, validated, and written independently. A failed semantic patch does not block a valid checkpoint, and a failed checkpoint does not block a valid semantic patch.

Design-definition and concept-direction Proposal replies suppress both semantic patch writing and checkpoint writing.

## Display Protection And UI

The shared structured-block helper hides both `morphoProjectContinuityPatch` and `morphoConversationCheckpoint` from visible assistant text for valid JSON, malformed closed JSON, schema-invalid JSON, and trailing unclosed streaming blocks. Ordinary research, definition, direction, and visual-plan JSON markers are not stripped by this helper unless their own parsers consume them.

When a checkpoint is saved, the assistant message shows only a light inline note:

```text
已整理当前讨论脉络
```

The UI does not show checkpoint JSON, long summaries, provider status, a project-record drawer entry, or a manual checkpoint editor.

## Explicitly Not Implemented

M5-B2 itself does not implement Compare, document readers, OCR, delivery preparation, archive/restore, transcript deletion, transcript replacement, user-managed summaries, full-project summaries, permanent mock routes, real paid-provider smoke calls, or a new Agent loop. M5-C later implements Compare and decision write-back while preserving this checkpoint boundary: design-definition and concept-direction Proposal replies still suppress checkpoint writing.
