import type { MorphoObject, MorphoWorkspace } from "../../domain/morpho/types";
import { indexedDbBlobStore } from "../../infrastructure/assets/indexedDbAssetStore";

export type MiMoImageAttachmentRepresentation = "single" | "contactSheet";

export type MiMoImageAttachment = {
  id: string;
  kind: "image";
  objectId: string;
  objectIds?: string[];
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
  byteSize?: number;
  representation: MiMoImageAttachmentRepresentation;
  status: "ready";
};

export type VisualInputPackEntry = {
  objectId: string;
  representation: MiMoImageAttachmentRepresentation;
  attachmentId?: string;
  status: "ready" | "failed";
};

export type CollectMiMoImageAttachmentsResult = {
  attachments: MiMoImageAttachment[];
  skippedObjectIds: string[];
  entries: VisualInputPackEntry[];
  warning?: string;
};

export type ImageCompressionPlan = {
  width: number;
  height: number;
  shouldResize: boolean;
  shouldCompress: boolean;
};

const DIRECT_IMAGE_THRESHOLD = 3;
const CONTACT_SHEET_CHUNK_SIZE = 16;
const CONTACT_SHEET_MAX_SIDE = 1600;
const MAX_MIMO_IMAGE_SIDE = 1600;
const TARGET_MIMO_IMAGE_BYTES = 1.5 * 1024 * 1024;

const FORCED_WEB_SEARCH_PATTERN =
  /必须联网|请联网|联网|搜索|查一下|最新|当前|验证|核实|来源|引用|source|search|verify|latest|current/i;

export function shouldAttachImagesForMiMo(input: {
  draft: string;
  taskMode: "chatAnalysis" | "imageGeneration" | "researchOperation";
  selectedObjects: MorphoObject[];
}): boolean {
  void input.draft;
  return input.taskMode !== "imageGeneration" && input.selectedObjects.some((object) => object.type === "image" && object.visibility === "active");
}

export function buildWebSearchOptions(input: {
  draft: string;
  taskMode: "chatAnalysis" | "imageGeneration" | "researchOperation";
}):
  | {
      enabled: true;
      forceSearch: boolean;
      maxKeyword: number;
      limit: number;
    }
  | undefined {
  if (input.taskMode === "imageGeneration") {
    return undefined;
  }

  const forceSearch = FORCED_WEB_SEARCH_PATTERN.test(input.draft);
  if (!forceSearch) {
    return undefined;
  }

  return {
    enabled: true,
    forceSearch,
    maxKeyword: 2,
    limit: 3
  };
}

export function selectMiMoImageAttachmentCandidates(workspace: MorphoWorkspace, objectIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const objectId of objectIds) {
    if (seen.has(objectId)) {
      continue;
    }
    seen.add(objectId);

    const object = workspace.objects[objectId];
    if (!object || object.type !== "image" || object.visibility !== "active" || !object.assetId) {
      continue;
    }

    const asset = workspace.assets[object.assetId];
    if (!asset || !asset.mimeType.startsWith("image/")) {
      continue;
    }

    candidates.push(object.id);
  }

  return candidates;
}

export function planImageAttachmentCompression(input: {
  width: number;
  height: number;
  byteSize: number;
  maxSide?: number;
  targetBytes?: number;
}): ImageCompressionPlan {
  const maxSide = input.maxSide ?? MAX_MIMO_IMAGE_SIDE;
  const targetBytes = input.targetBytes ?? TARGET_MIMO_IMAGE_BYTES;
  const longestSide = Math.max(input.width, input.height);
  const scale = longestSide > maxSide ? maxSide / longestSide : 1;

  return {
    width: Math.max(1, Math.round(input.width * scale)),
    height: Math.max(1, Math.round(input.height * scale)),
    shouldResize: scale < 1,
    shouldCompress: input.byteSize > targetBytes
  };
}

export async function collectMiMoImageAttachments(
  workspace: MorphoWorkspace,
  objectIds: readonly string[],
  signal: AbortSignal
): Promise<CollectMiMoImageAttachmentsResult> {
  const candidates = selectMiMoImageAttachmentCandidates(workspace, objectIds);
  if (candidates.length <= DIRECT_IMAGE_THRESHOLD) {
    return collectDirectImageAttachments(workspace, candidates, signal);
  }

  return collectContactSheetAttachments(workspace, candidates, signal);
}

async function collectDirectImageAttachments(
  workspace: MorphoWorkspace,
  objectIds: readonly string[],
  signal: AbortSignal
): Promise<CollectMiMoImageAttachmentsResult> {
  const attachments: MiMoImageAttachment[] = [];
  const skippedObjectIds: string[] = [];
  const entries: VisualInputPackEntry[] = [];

  for (const objectId of objectIds) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const object = workspace.objects[objectId];
    const asset = object?.type === "image" && object.assetId ? workspace.assets[object.assetId] : undefined;
    if (!asset) {
      skippedObjectIds.push(objectId);
      entries.push({ objectId, representation: "single", status: "failed" });
      continue;
    }

    try {
      const blob = await indexedDbBlobStore.get(asset.storageKey);
      if (!blob) {
        throw new Error("Missing blob.");
      }

      const compressed = await compressImageBlobToDataUrl(blob, signal);
      const attachment: MiMoImageAttachment = {
        id: asset.id,
        kind: "image",
        objectId,
        objectIds: [objectId],
        mimeType: compressed.mimeType,
        dataUrl: compressed.dataUrl,
        width: compressed.width,
        height: compressed.height,
        byteSize: compressed.byteSize,
        representation: "single",
        status: "ready"
      };
      attachments.push(attachment);
      entries.push({ objectId, representation: "single", attachmentId: attachment.id, status: "ready" });
    } catch {
      skippedObjectIds.push(objectId);
      entries.push({ objectId, representation: "single", status: "failed" });
    }
  }

  return {
    attachments,
    skippedObjectIds,
    entries,
    warning: buildAttachmentWarning(objectIds.length, attachments.length, skippedObjectIds.length, 0)
  };
}

async function collectContactSheetAttachments(
  workspace: MorphoWorkspace,
  objectIds: readonly string[],
  signal: AbortSignal
): Promise<CollectMiMoImageAttachmentsResult> {
  const attachments: MiMoImageAttachment[] = [];
  const skippedObjectIds: string[] = [];
  const entries: VisualInputPackEntry[] = [];

  for (const chunk of chunkArray(objectIds, CONTACT_SHEET_CHUNK_SIZE)) {
    const loaded: Array<{ objectId: string; image: LoadedImage }> = [];
    for (const objectId of chunk) {
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const object = workspace.objects[objectId];
      const asset = object?.type === "image" && object.assetId ? workspace.assets[object.assetId] : undefined;
      if (!asset) {
        skippedObjectIds.push(objectId);
        entries.push({ objectId, representation: "contactSheet", status: "failed" });
        continue;
      }

      try {
        const blob = await indexedDbBlobStore.get(asset.storageKey);
        if (!blob) {
          throw new Error("Missing blob.");
        }
        loaded.push({ objectId, image: await loadImage(blob, signal) });
      } catch {
        skippedObjectIds.push(objectId);
        entries.push({ objectId, representation: "contactSheet", status: "failed" });
      }
    }

    if (loaded.length === 0) {
      continue;
    }

    const sheet = await createContactSheetDataUrl(loaded, signal);
    const sheetObjectIds = loaded.map((item) => item.objectId);
    const attachment: MiMoImageAttachment = {
      id: `contact-sheet-${sheetObjectIds.join("-")}`,
      kind: "image",
      objectId: sheetObjectIds[0] ?? "contact-sheet",
      objectIds: sheetObjectIds,
      mimeType: sheet.mimeType,
      dataUrl: sheet.dataUrl,
      width: sheet.width,
      height: sheet.height,
      byteSize: sheet.byteSize,
      representation: "contactSheet",
      status: "ready"
    };
    attachments.push(attachment);
    entries.push(
      ...sheetObjectIds.map((objectId) => ({
        objectId,
        representation: "contactSheet" as const,
        attachmentId: attachment.id,
        status: "ready" as const
      }))
    );
  }

  return {
    attachments,
    skippedObjectIds,
    entries,
    warning: buildAttachmentWarning(objectIds.length, entries.filter((entry) => entry.status === "ready").length, skippedObjectIds.length, attachments.length)
  };
}

function buildAttachmentWarning(total: number, ready: number, skipped: number, contactSheets: number): string | undefined {
  if (total === 0) {
    return undefined;
  }

  const parts = [`已纳入 ${ready} 张参考图进行本轮分析。`];
  if (contactSheets > 0) {
    parts.push("其中部分图片已自动整理为总览图，以便同时比较整体方向与细节。");
  }
  if (skipped > 0) {
    parts.push(`${skipped} 张图片未能读取或压缩，本次没有发送这些图片像素。`);
  }
  return parts.join(" ");
}

async function compressImageBlobToDataUrl(
  blob: Blob,
  signal: AbortSignal
): Promise<{ dataUrl: string; mimeType: string; width: number; height: number; byteSize: number }> {
  const image = await loadImage(blob, signal);
  const plan = planImageAttachmentCompression({
    width: image.width,
    height: image.height,
    byteSize: blob.size
  });

  if (!plan.shouldResize && !plan.shouldCompress) {
    return {
      dataUrl: await blobToDataUrl(blob, signal),
      mimeType: blob.type || "image/png",
      width: image.width,
      height: image.height,
      byteSize: blob.size
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Image compression failed.");
  }

  context.drawImage(image.element, 0, 0, plan.width, plan.height);
  for (const quality of [0.82, 0.72, 0.62, 0.52]) {
    const output = await canvasToBlob(canvas, "image/jpeg", quality, signal);
    if (output.size <= TARGET_MIMO_IMAGE_BYTES || quality === 0.52) {
      return {
        dataUrl: await blobToDataUrl(output, signal),
        mimeType: "image/jpeg",
        width: plan.width,
        height: plan.height,
        byteSize: output.size
      };
    }
  }

  throw new Error("Image compression failed.");
}

type LoadedImage = {
  element: HTMLImageElement;
  width: number;
  height: number;
};

function loadImage(blob: Blob, signal: AbortSignal): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    const cleanup = () => {
      URL.revokeObjectURL(url);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort);
    image.onload = () => {
      cleanup();
      resolve({
        element: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height
      });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Image read failed."));
    };
    image.src = url;
  });
}

async function createContactSheetDataUrl(
  images: Array<{ objectId: string; image: LoadedImage }>,
  signal: AbortSignal
): Promise<{ dataUrl: string; mimeType: string; width: number; height: number; byteSize: number }> {
  const columns = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / columns);
  const cellSize = Math.max(120, Math.min(320, Math.floor(CONTACT_SHEET_MAX_SIDE / Math.max(columns, rows))));
  const canvas = document.createElement("canvas");
  canvas.width = columns * cellSize;
  canvas.height = rows * cellSize;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Contact sheet creation failed.");
  }

  context.fillStyle = "#fbf7ef";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#3d352d";
  context.font = "14px sans-serif";

  images.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellSize;
    const y = row * cellSize;
    const labelHeight = 22;
    const maxW = cellSize - 16;
    const maxH = cellSize - labelHeight - 16;
    const scale = Math.min(maxW / item.image.width, maxH / item.image.height, 1);
    const drawW = item.image.width * scale;
    const drawH = item.image.height * scale;
    const drawX = x + (cellSize - drawW) / 2;
    const drawY = y + 8 + (maxH - drawH) / 2;

    context.strokeStyle = "#e0d6c8";
    context.strokeRect(x + 4, y + 4, cellSize - 8, cellSize - 8);
    context.drawImage(item.image.element, drawX, drawY, drawW, drawH);
    context.fillText(`${index + 1}. ${item.objectId}`, x + 8, y + cellSize - 8, cellSize - 16);
  });

  const output = await canvasToBlob(canvas, "image/jpeg", 0.78, signal);
  return {
    dataUrl: await blobToDataUrl(output, signal),
    mimeType: "image/jpeg",
    width: canvas.width,
    height: canvas.height,
    byteSize: output.size
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Image compression failed."));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });
}

function blobToDataUrl(blob: Blob, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => {
      reader.abort();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.onload = () => {
      signal.removeEventListener("abort", abort);
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Image read failed."));
    };
    reader.onerror = () => {
      signal.removeEventListener("abort", abort);
      reject(reader.error ?? new Error("Image read failed."));
    };
    reader.readAsDataURL(blob);
  });
}

function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}
