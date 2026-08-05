# M5-D2 Document Fragments And Source Traceability

> **Historical milestone document**：本文件记录 M5-D2 文档片段与来源追溯的阶段实现。数据与阅读器
> 设计可用于理解现有兼容边界；当前 Agent 入口、连续性和发布状态以当前架构文档为准。

## Scope

M5-D2 adds `documentFragment` as a first-class Morpho object created only by an explicit user action inside the document reader.

The extraction unit is a consecutive set of parsed reader blocks from the current local `documentExtract`. This is intentional: M5-D1 stores a stable extract string with block and character offsets, not a reliable PDF page, PPT slide, DOM range, glyph, or coordinate source map.

Out of scope: OCR, scanned PDF text recognition, original PDF page rendering, PPTX slide reconstruction, Word/PDF/PPT editing, arbitrary native text drag selection, page-level extraction, slide-level extraction, AI-response auto-extraction, automatic key conclusions, automatic project-memory writes, whole-source-file AI context, cross-file full-text search, export, archive, and permanent mock/debug routes.

## Data Model

Schema version `12` adds the object type:

```ts
type DocumentFragmentObject = {
  id: MorphoObjectId;
  type: "documentFragment";
  title: string;
  summary: string;
  body: string;
  createdBy: "user";
  createdAt: string;
  updatedAt: string;
  visibility: "active" | "hidden";
  source: {
    fileObjectId: MorphoObjectId;
    fileTitle: string;
    fileName?: string;
    sourceExtractAssetId: AssetId;
    startOffset: number;
    endOffset: number;
    blockIds: string[];
  };
};
```

`documentFragment` is not a file. The original imported file remains a `file` object. The fragment stores a bounded text body because the user explicitly extracted a small source range for later reuse. It does not store original binaries, Base64, provider payloads, complete `documentExtract` text, OCR output, page images, or layout data.

Source relation is explicit through both `object.source` metadata and a `documentFragmentExtractedFromFile` relation. Canvas placement near a source file is a visual convenience only and never expresses source semantics.

## Migration

Migrating v11 to v12 initializes only required schema fields and preserves existing objects, assets, messages, checkpoints, Compare analyses, DecisionRecords, operations, and project-continuity records.

Migration does not fabricate historical document fragments. Re-running migration is idempotent.

## Extraction Validation

Extraction logic lives in `src/features/workspace/documentFragments.ts` as pure helpers:

- `resolveDocumentFragmentSelection`
- `validateDocumentFragmentSelection`
- `buildDocumentFragmentDraft`
- `createDocumentFragment`
- `createDocumentFragmentWithContinuity`
- `resolveDocumentFragmentSourceAvailability`
- `resolveDocumentFragmentLocation`

Selection is valid only when all conditions hold:

- source object exists, is `type === "file"`, and is active;
- source file is parsed and has `extractedAssetId`;
- source asset exists and `sourceType === "documentExtract"`;
- the reader `extractAssetId` matches the file's current `extractedAssetId`;
- selected block IDs are non-empty, unique, present in the current reader blocks, and consecutive by block index;
- selection contains at most 8 blocks;
- body length is at most 6,000 characters;
- title is non-empty and at most 80 characters.

The body is always recomputed from the current reader source string:

```ts
fragment.body === sourceText.slice(startOffset, endOffset)
```

The UI cannot provide arbitrary body text or offsets to bypass validation. Invalid selection is blocked with an explicit reason and is never silently truncated, auto-filled, or partially extracted.

## Reader UI

`DocumentReaderPanel` supports block selection, selection clearing, editable fragment title, extraction feedback, and source-range highlighting when opened from an existing fragment.

The current workspace composition keeps those local interactions in `DocumentReaderPanel`, while
`useDocumentReaderController` owns the transient Reader session, extract recovery, request
identity/cancellation, source-preview Object URL lifecycle, and explicit fragment-creation
orchestration. Delivery Reference navigation plus the final canvas selection/focus after
`在画布中查看` remain page-level responsibilities in `WorkspaceClient`.

Creating a fragment happens only when the user clicks the extraction button. Opening, closing, reading, searching, selecting blocks, changing search results, or locating a source range does not create objects, AI messages, provider calls, operations, Compare analyses, DecisionRecords, checkpoints, current-focus updates, or project-memory writes.

After successful extraction:

- a new active `documentFragment` object is created;
- a canvas instance is added near the source file instance when one exists, otherwise near the current viewport;
- a source relation is added;
- one deterministic `documentFragmentCreated` continuity event is recorded;
- the reader can remain open;
- the reader shows lightweight success feedback and an explicit action to view the new canvas object.

The explicit view-on-canvas action may select and focus the fragment instance. Extraction itself does not automatically change Current Focus, send AI, change task mode, close AI, or force canvas selection.

## Source Availability And Return Location

`resolveDocumentFragmentSourceAvailability` reports real source state:

- `active`: source file is active and the current extract asset still matches the fragment snapshot;
- `hidden`: source file exists but is hidden;
- `missing`: source file no longer exists;
- `assetMissing`: the referenced extract asset is missing or no longer a `documentExtract`;
- `assetMismatch`: the file now points to a different extract asset.

The fragment body and source snapshot remain readable in all cases. Hidden, missing, or changed sources do not delete the fragment and do not fabricate a jump target.

`resolveDocumentFragmentLocation` returns a `DocumentReaderInitialLocation` only when the source is active and the extract asset matches. Opening from the bottom detail surface reuses the existing reader and highlights the exact saved character range. It does not show fake page numbers, fake slide numbers, PDF coordinates, or source-file visibility changes.

## AI, Task Context, Compare, And Key Conclusions

Document fragments enter provider context only when explicitly selected or otherwise explicitly included by the existing task-context pipeline. The provider receives the fragment body, title, bounded provenance, source file title, offset range, and source availability. It does not receive the whole source file or sibling fragments automatically.

Compare supports active `documentFragment` objects as explicit selected text sources. Their evidence basis is `documentFragment`, not `documentExtract`. The source file is not auto-added to Compare sources or authorization.

Key-conclusion candidates may cite selected active document fragments as text evidence. `sourceObjectIds` point to the fragment object, not the source file. Downstream traceability follows `keyConclusion -> documentFragment -> file/extract/offset/blockIds`.

Hidden fragments are not eligible as new Compare or AI sources under the normal active-selection rules. A hidden or missing source file does not invalidate an active fragment as a bounded extracted text object, but source availability is preserved for downstream provenance.

## Continuity Boundary

`documentFragmentCreated` is a project-continuity event because it records a user-created traceable material object. It is not Project Memory and does not copy the fragment body into memory views.

The event records fragment ID, source file ID, start/end offsets, block IDs, and timestamp through typed source refs and deterministic summaries. It does not become a design definition, preference, key conclusion, decision, default reference, or stage-completion marker.

## M6 Delivery Preparation Boundary

A `documentFragment` can be explicitly added to a delivery section as a stable delivery reference. The delivery reference snapshot keeps the fragment title, summary, bounded body, source file title/name, extract asset ID, and character range.

This does not authorize reading the whole source file, all sibling fragments, or the complete `documentExtract`. If the source file is hidden, missing, or points to a different/missing extract asset later, the delivery reference keeps its frozen fragment snapshot and shows the real source state instead of fabricating a source jump or silently refreshing.

## Tests

Coverage includes:

- selection validation and body slicing in `src/features/workspace/documentFragments.test.ts`;
- v11-to-v12 migration in `src/domain/morpho/workspace.test.ts`;
- task-context inclusion boundaries in `src/features/workspace/taskContext.test.ts`;
- Compare selection/evidence validation in `src/domain/morpho/comparisonAnalysis.test.ts` and `src/features/workspace/comparisonAction.test.ts`;
- document-reader UI behavior in `src/features/workspace/documentReader.test.ts`.
