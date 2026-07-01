import type {
  CanvasPoint,
  DocumentFragmentObject,
  FileObject,
  MorphoObjectId,
  MorphoWorkspace
} from "@/domain/morpho/types";
import { applyProjectContinuityEvent, resolveContinuityValidity } from "@/domain/morpho/projectContinuity";

import { buildDocumentReaderBlocks, type DocumentReaderBlock } from "./documentReader";

export const DOCUMENT_FRAGMENT_LIMITS = {
  maxBlocks: 8,
  maxBodyChars: 6_000,
  maxTitleChars: 80,
  maxSummaryChars: 300
} as const;

export type DocumentFragmentSelectionInput = {
  fileObjectId: MorphoObjectId;
  extractAssetId: string;
  blockIds: string[];
  title: string;
  sourceText: string;
};

export type ResolvedDocumentFragmentSelection = {
  fileObjectId: MorphoObjectId;
  extractAssetId: string;
  file: FileObject;
  blocks: DocumentReaderBlock[];
  blockIds: string[];
  startOffset: number;
  endOffset: number;
  body: string;
  title: string;
};

export type DocumentFragmentSelectionResult =
  | ({ status: "ready" } & ResolvedDocumentFragmentSelection)
  | { status: "blocked"; reason: string };

export type DocumentFragmentDraft = Omit<DocumentFragmentObject, "id" | "createdAt" | "updatedAt"> & {
  position?: CanvasPoint;
};

export type DocumentFragmentDraftResult =
  | { status: "ready"; draft: DocumentFragmentDraft }
  | { status: "blocked"; reason: string };

export type CreateDocumentFragmentResult = {
  workspace: MorphoWorkspace;
  fragment: DocumentFragmentObject;
};

export type DocumentFragmentSourceAvailability =
  | { status: "active"; file: FileObject }
  | { status: "hidden"; file: FileObject; reason: string }
  | { status: "missing"; reason: string }
  | { status: "assetMissing"; file: FileObject; reason: string }
  | { status: "assetMismatch"; file: FileObject; reason: string };

export type DocumentFragmentLocationResult =
  | {
      status: "ready";
      fileObjectId: MorphoObjectId;
      extractAssetId: string;
      startOffset: number;
      endOffset: number;
      label: string;
    }
  | { status: "blocked"; reason: string };

export type DocumentReaderInitialLocation = {
  startOffset: number;
  endOffset: number;
  label: string;
};

export function resolveDocumentFragmentSelection(
  workspace: MorphoWorkspace,
  input: DocumentFragmentSelectionInput
): DocumentFragmentSelectionResult {
  return validateDocumentFragmentSelection(workspace, input);
}

export function validateDocumentFragmentSelection(
  workspace: MorphoWorkspace,
  input: DocumentFragmentSelectionInput
): DocumentFragmentSelectionResult {
  const file = workspace.objects[input.fileObjectId];
  if (!file || file.type !== "file") {
    return { status: "blocked", reason: "Document fragments can only be extracted from an existing file object." };
  }
  if (file.visibility !== "active") {
    return { status: "blocked", reason: "Document fragments can only be extracted from an active source file." };
  }
  if (file.parseStatus !== "parsed" || !file.extractedAssetId) {
    return { status: "blocked", reason: "Document fragments require a parsed documentExtract source." };
  }
  if (file.extractedAssetId !== input.extractAssetId) {
    return { status: "blocked", reason: "Reader extract asset does not match the current file extract asset." };
  }
  const asset = workspace.assets[file.extractedAssetId];
  if (!asset || asset.sourceType !== "documentExtract") {
    return { status: "blocked", reason: "Document fragment source extract asset is unavailable." };
  }
  if (input.blockIds.length === 0) {
    return { status: "blocked", reason: "Select at least one parsed block before extracting a document fragment." };
  }
  if (input.blockIds.length > DOCUMENT_FRAGMENT_LIMITS.maxBlocks) {
    return { status: "blocked", reason: `A document fragment can include at most ${DOCUMENT_FRAGMENT_LIMITS.maxBlocks} parsed blocks.` };
  }
  if (input.blockIds.length !== new Set(input.blockIds).size) {
    return { status: "blocked", reason: "Document fragment selection must not contain duplicate blocks." };
  }

  const sourceText = input.sourceText;
  if (!sourceText) {
    return { status: "blocked", reason: "Document fragment extraction requires the current reader source text." };
  }
  const allBlocks = buildDocumentReaderBlocks(sourceText);
  const blockById = new Map(allBlocks.map((block) => [block.id, block]));
  const selectedBlocks = input.blockIds.map((blockId) => blockById.get(blockId));
  if (selectedBlocks.some((block) => !block)) {
    return { status: "blocked", reason: "Document fragment selection contains blocks outside the current reader." };
  }

  const blocks = selectedBlocks.filter((block): block is DocumentReaderBlock => Boolean(block));
  const sortedBlocks = [...blocks].sort((left, right) => left.index - right.index);
  for (let index = 1; index < sortedBlocks.length; index += 1) {
    if (sortedBlocks[index].index !== sortedBlocks[index - 1].index + 1) {
      return { status: "blocked", reason: "A document fragment can only extract consecutive parsed blocks." };
    }
  }

  const first = sortedBlocks[0];
  const last = sortedBlocks[sortedBlocks.length - 1];
  const startOffset = first.startOffset;
  const endOffset = last.endOffset;
  const body = sourceText.slice(startOffset, endOffset);
  if (body.length === 0) {
    return { status: "blocked", reason: "Document fragment body cannot be empty." };
  }
  if (body.length > DOCUMENT_FRAGMENT_LIMITS.maxBodyChars) {
    return { status: "blocked", reason: `Document fragment body cannot exceed ${DOCUMENT_FRAGMENT_LIMITS.maxBodyChars} characters.` };
  }

  const title = input.title.trim();
  if (!title) {
    return { status: "blocked", reason: "Document fragment title cannot be empty." };
  }
  if (title.length > DOCUMENT_FRAGMENT_LIMITS.maxTitleChars) {
    return { status: "blocked", reason: `Document fragment title cannot exceed ${DOCUMENT_FRAGMENT_LIMITS.maxTitleChars} characters.` };
  }

  return {
    status: "ready",
    fileObjectId: file.id,
    extractAssetId: file.extractedAssetId,
    file,
    blocks: sortedBlocks,
    blockIds: sortedBlocks.map((block) => block.id),
    startOffset,
    endOffset,
    body,
    title
  };
}

export function buildDocumentFragmentDraft(
  workspace: MorphoWorkspace,
  selection: ResolvedDocumentFragmentSelection,
  input: { title: string; summary?: string; position?: CanvasPoint }
): DocumentFragmentDraftResult {
  const title = input.title.trim();
  if (!title) {
    return { status: "blocked", reason: "Document fragment title cannot be empty." };
  }
  if (title.length > DOCUMENT_FRAGMENT_LIMITS.maxTitleChars) {
    return { status: "blocked", reason: `Document fragment title cannot exceed ${DOCUMENT_FRAGMENT_LIMITS.maxTitleChars} characters.` };
  }
  const summary = (input.summary?.trim() || buildDefaultSummary(selection)).slice(0, DOCUMENT_FRAGMENT_LIMITS.maxSummaryChars);
  const file = workspace.objects[selection.fileObjectId];
  if (!file || file.type !== "file") {
    return { status: "blocked", reason: "Document fragment source file is missing." };
  }

  return {
    status: "ready",
    draft: {
      type: "documentFragment",
      title,
      summary,
      body: selection.body,
      createdBy: "user",
      visibility: "active",
      source: {
        fileObjectId: file.id,
        fileTitle: file.title,
        fileName: file.fileName,
        sourceExtractAssetId: selection.extractAssetId,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        blockIds: [...selection.blockIds]
      },
      position: input.position
    }
  };
}

export function createDocumentFragment(workspace: MorphoWorkspace, draft: DocumentFragmentDraft): CreateDocumentFragmentResult {
  const now = new Date().toISOString();
  const fragmentId = nextAvailableId(workspace.objects, `document-fragment-${draft.source.fileObjectId}-${draft.source.startOffset}`);
  const fragment: DocumentFragmentObject = {
    ...draft,
    id: fragmentId,
    createdAt: now,
    updatedAt: now
  };
  const sourceInstance = workspace.canvas.instances.find((instance) => instance.objectId === draft.source.fileObjectId);
  const position = draft.position ??
    (sourceInstance
      ? { x: sourceInstance.position.x + sourceInstance.size.w + 92, y: sourceInstance.position.y }
      : { x: workspace.canvas.view.x + 180, y: workspace.canvas.view.y + 180 });

  return {
    fragment,
    workspace: {
      ...workspace,
      objects: {
        ...workspace.objects,
        [fragment.id]: fragment
      },
      relations: [
        ...workspace.relations,
        {
          id: nextAvailableId(Object.fromEntries(workspace.relations.map((relation) => [relation.id, relation])), `rel-${fragment.id}-source`),
          kind: "documentFragmentExtractedFromFile",
          fromObjectId: fragment.id,
          toObjectId: draft.source.fileObjectId,
          note: "User explicitly extracted this document fragment from a bounded parsed text range."
        }
      ],
      canvas: {
        ...workspace.canvas,
        instances: [
          ...workspace.canvas.instances,
          {
            id: `canvas-${fragment.id}`,
            objectId: fragment.id,
            position,
            size: { w: 280, h: 188 }
          }
        ]
      }
    }
  };
}

export function createDocumentFragmentWithContinuity(
  workspace: MorphoWorkspace,
  draft: DocumentFragmentDraft
): CreateDocumentFragmentResult {
  const created = createDocumentFragment(workspace, draft);
  const continuity = resolveContinuityValidity(created.workspace);
  return {
    fragment: created.fragment,
    workspace: applyProjectContinuityEvent(continuity, {
      type: "documentFragmentCreated",
      fragmentObjectId: created.fragment.id,
      fileObjectId: created.fragment.source.fileObjectId,
      startOffset: created.fragment.source.startOffset,
      endOffset: created.fragment.source.endOffset,
      blockIds: [...created.fragment.source.blockIds]
    })
  };
}

export function resolveDocumentFragmentSourceAvailability(
  workspace: MorphoWorkspace,
  fragment: DocumentFragmentObject
): DocumentFragmentSourceAvailability {
  const sourceFile = workspace.objects[fragment.source.fileObjectId];
  if (!sourceFile || sourceFile.type !== "file") {
    return { status: "missing", reason: "Source file is no longer available." };
  }
  if (sourceFile.visibility !== "active") {
    return { status: "hidden", file: sourceFile, reason: "Source file is hidden." };
  }
  if (sourceFile.extractedAssetId !== fragment.source.sourceExtractAssetId) {
    return { status: "assetMismatch", file: sourceFile, reason: "Current source extract asset no longer matches the fragment snapshot." };
  }
  const asset = workspace.assets[fragment.source.sourceExtractAssetId];
  if (!asset || asset.sourceType !== "documentExtract") {
    return { status: "assetMissing", file: sourceFile, reason: "Source documentExtract asset is unavailable." };
  }
  return { status: "active", file: sourceFile };
}

export function resolveDocumentFragmentLocation(
  workspace: MorphoWorkspace,
  fragment: DocumentFragmentObject
): DocumentFragmentLocationResult {
  const availability = resolveDocumentFragmentSourceAvailability(workspace, fragment);
  if (availability.status !== "active") {
    return { status: "blocked", reason: availability.reason };
  }
  return {
    status: "ready",
    fileObjectId: fragment.source.fileObjectId,
    extractAssetId: fragment.source.sourceExtractAssetId,
    startOffset: fragment.source.startOffset,
    endOffset: fragment.source.endOffset,
    label: "Document fragment source range"
  };
}

function buildDefaultSummary(selection: ResolvedDocumentFragmentSelection): string {
  return `${selection.file.title} / parsed blocks ${selection.blocks[0].index + 1}-${selection.blocks.at(-1)?.index ?? selection.blocks[0].index + 1}`;
}

function nextAvailableId(record: Record<string, unknown>, preferredId: string): string {
  if (!record[preferredId]) {
    return preferredId;
  }
  let suffix = 2;
  while (record[`${preferredId}-${suffix}`]) {
    suffix += 1;
  }
  return `${preferredId}-${suffix}`;
}
