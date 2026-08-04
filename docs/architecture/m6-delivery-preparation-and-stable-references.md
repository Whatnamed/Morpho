# M6 Delivery Preparation And Stable References

> **Historical milestone document**：本文件记录 M6 交付准备与稳定引用的阶段实现。交付产品规则仍以
> `docs/product/05_...` 为准，正式面板 Runtime 和 AI 路由以 A+ 当前架构文档为准；不要把本文件中
> 的旧兼容路由描述当作当前调用关系。

## Scope

M6 implements delivery preparation as a local, editable workspace loop. It is not final export, automatic presentation generation, PDF/PPT/Figma production, archive, restore, collaboration, cloud sync, or final layout.

The existing `delivery` Morpho object is the delivery preparation package. M6 extends it with sections, stable references, gaps, and pending section drafts. It does not create a parallel `DeliveryPackage`, `ExportPackage`, or presentation-plan model.

## Data Model

Workspace schema is `13`.

`DeliveryObject` represents one delivery preparation package:

- `format`: `board` or `presentation`;
- `sections`: ordered editable delivery sections;
- `references`: delivery reference IDs owned by the package;
- `gaps`: real user-managed or user-applied draft gaps.

`DeliverySection` contains section identity, title, optional purpose, order, reference order, optional confirmed narrative, and timestamps. It is not a slide, page, grid, layout, template, font, color, or animation model.

`DeliveryReference` contains the owning delivery object, section, order, optional source object ID, stable snapshot, deterministic source fingerprint/revision/asset fields, and optional editorial caption/note.

`DeliveryGap` contains a label, optional section binding, status `open | resolved`, origin `manual | deliveryDraft`, and timestamps. Empty sections and source-state problems are derived structural signals, not automatically persisted gaps.

`DeliverySectionDraft` is a pending AI draft bound to one delivery object, one section, one user message, one assistant message, the section reference IDs, and the source fingerprints used when the draft was created. It is not project fact and does not enter project memory.

## Migration

Schema v12 migrates to v13 without fabricating delivery packages, narratives, drafts, or gaps.

Legacy delivery objects with references but no sections receive one deterministic migration section titled `交付内容`, and the legacy references are placed into that section. Legacy references keep their snapshots and are filled with package, section, and order fields when missing.

Migration is idempotent and does not alter Compare, checkpoints, semantic patches, document fragments, existing AI messages, source objects, or project-continuity records.

## Stable Snapshot Boundary

A delivery reference snapshot is readable without the live source object. It may include lightweight title, summary, bounded body/excerpt, source revision, file/range metadata, and preview asset ID/alt text.

Snapshots do not include:

- source image binaries;
- Base64;
- Blob URLs;
- provider raw payloads;
- original PDFs/PPTX/files;
- complete `documentExtract` text;
- full source files;
- export bundles.

Text snapshots are bounded by domain validation. Oversized text is blocked rather than silently stored as a fake complete body.

## Source State

`resolveDeliveryReferenceState` distinguishes:

- `current`: the frozen snapshot still matches the source fingerprint;
- `sourceHidden`: the source object or document-fragment source file exists but is hidden;
- `sourceMissing`: the source object no longer exists;
- `assetMissing`: the source asset needed for the reference no longer exists;
- `sourceUpdated`: the source exists but the deterministic delivery fingerprint differs.

Updating a stale reference is an explicit user action through `refreshDeliveryReferenceSnapshot`. It updates only that reference snapshot and fingerprint, preserves editorial caption/note, does not mutate the source object, and writes a `DecisionRecord` plus a delivery continuity event.

## Domain Operations

All meaningful writes live in `src/domain/morpho/deliveryPreparation.ts`.

Implemented operations include package creation, section update/move/remove, adding active objects as references, reference move/remove/editorial update/refresh, gap add/status/remove, draft create/apply/discard, source-state resolution, stable snapshot creation, deterministic fingerprinting, and derived structural signals.

Adding a reference is explicit. It cannot reference a delivery object, hidden object, missing object, canvas proximity, AI recommendation, or all canvas objects. The same source can appear in different sections, but duplicate source references inside the same section are blocked.

## AI Draft Boundary

`prepareDeliverySection` is a `chatAnalysis` work intent that sends only `deliverySectionContext`: the current section metadata, open gaps, and current section delivery reference snapshots. It does not send live source objects, full source files, full document extracts, Blob URLs, Base64, web search, Compare context, or normal task context.

MiMo may return prose plus one `morphoDeliverySectionDraft` structured block. The visible chat hides the technical JSON. The local parser rejects malformed blocks, unauthorized reference IDs, oversized gaps/captions, and same-reply design-definition, concept-direction, or comparison proposal blocks.

Valid output creates a pending `DeliverySectionDraft` only. Applying the draft writes section narrative, listed captions, suggested gaps, a `DecisionRecord`, and a delivery continuity event. Discarding the draft changes only draft status and writes no delivery content, no project memory, and no continuity event.

## UI

The delivery preparation panel is a floating workspace surface, not a route and not a permanent three-column shell. It supports:

- create board/presentation preparation packages;
- select a package and section;
- edit section title, purpose, and confirmed narrative;
- add current active selected canvas objects to a section;
- edit captions/notes;
- move/remove references;
- refresh a stale reference explicitly;
- manage open/resolved gaps;
- request, apply, or discard AI section drafts.

The canvas delivery card remains compact and shows package-level counts: format, section count, reference count, open gap count, and source-review count. It does not render full section narratives or layout pages.

Opening/closing the panel and selecting sections are UI-local. They do not write Current Focus, checkpoints, semantic patches, Compare analyses, or DecisionRecords.

## Continuity And Current Focus

Delivery package creation, reference add/remove/refresh, section/gap changes, and draft application can write deterministic `deliveryPreparationChanged` continuity events. Package creation and delivery events can move Current Focus to `deliveryPreparation` because they are real user-directed delivery preparation work.

Panel open/close, delivery package selection, section selection, draft generation, and draft discard do not create project facts. Draft generation creates an AI message plus pending draft only after valid provider output; it does not enter project memory.

## Tests

Primary coverage lives in:

- `src/domain/morpho/deliveryPreparation.test.ts`;
- `src/domain/morpho/deliverySectionDraftBlock.test.ts`;
- `src/server/ai/request.test.ts`;
- `src/domain/morpho/workspace.test.ts`.

Browser mock acceptance should intercept `/api/ai/chat` and verify delivery creation/organization, stable snapshot behavior, explicit reference refresh, valid draft creation/application, invalid draft rejection, and no real provider calls.
