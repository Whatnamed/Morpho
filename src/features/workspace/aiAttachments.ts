import type { MorphoObject, MorphoWorkspace } from "../../domain/morpho/types";
import { indexedDbBlobStore } from "../../infrastructure/assets/indexedDbAssetStore";

export type MiMoImageAttachment = {
  id: string;
  kind: "image";
  objectId: string;
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
  byteSize?: number;
  status: "ready";
};

export type CollectMiMoImageAttachmentsResult = {
  attachments: MiMoImageAttachment[];
  skippedObjectIds: string[];
  warning?: string;
};

export type ImageCompressionPlan = {
  width: number;
  height: number;
  shouldResize: boolean;
  shouldCompress: boolean;
};

const MAX_MIMO_IMAGE_ATTACHMENTS = 3;
const MAX_MIMO_IMAGE_SIDE = 1600;
const TARGET_MIMO_IMAGE_BYTES = 1.5 * 1024 * 1024;

const IMAGE_UNDERSTANDING_PATTERN =
  /分析这张图|分析这(?:些|几张)图|比较这(?:两|几)张图|提取.*形态|形态语言|视觉分析|看图|图片.*问题|图里|画面|外观|比例|结构|材质|cmf/i;
const WEB_SEARCH_INTENT_PATTERN = /联网|搜索|查资料|查一下|最新|当前|验证|核实|来源|引用|案例|补充资料|补充信息/i;
const FORCED_WEB_SEARCH_PATTERN = /必须联网|请联网|搜索|查一下|最新|当前|验证|核实|来源|引用/i;

export function shouldAttachImagesForMiMo(input: {
  draft: string;
  taskMode: "chatAnalysis" | "imageGeneration" | "researchOperation";
  selectedObjects: MorphoObject[];
}): boolean {
  if (input.taskMode === "imageGeneration") {
    return false;
  }

  return input.selectedObjects.some((object) => object.type === "image") && IMAGE_UNDERSTANDING_PATTERN.test(input.draft);
}

export function buildWebSearchOptions(input: {
  draft: string;
  taskMode: "chatAnalysis" | "imageGeneration" | "researchOperation";
}):
  | {
      enabled: true;
      maxKeyword: number;
      forceSearch: boolean;
      limit: number;
    }
  | undefined {
  if (input.taskMode === "imageGeneration" || !WEB_SEARCH_INTENT_PATTERN.test(input.draft)) {
    return undefined;
  }

  return {
    enabled: true,
    maxKeyword: 2,
    forceSearch: FORCED_WEB_SEARCH_PATTERN.test(input.draft),
    limit: 3
  };
}

export function selectMiMoImageAttachmentCandidates(
  workspace: MorphoWorkspace,
  objectIds: readonly string[],
  limit = MAX_MIMO_IMAGE_ATTACHMENTS
): string[] {
  const candidates: string[] = [];
  for (const objectId of objectIds) {
    if (candidates.length >= limit) {
      break;
    }

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
  const attachments: MiMoImageAttachment[] = [];
  const skippedObjectIds: string[] = [];

  for (const objectId of selectMiMoImageAttachmentCandidates(workspace, objectIds)) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const object = workspace.objects[objectId];
    if (!object || object.type !== "image" || !object.assetId) {
      continue;
    }

    const asset = workspace.assets[object.assetId];
    if (!asset) {
      skippedObjectIds.push(objectId);
      continue;
    }

    try {
      const blob = await indexedDbBlobStore.get(asset.storageKey);
      if (!blob) {
        skippedObjectIds.push(objectId);
        continue;
      }

      const compressed = await compressImageBlobToDataUrl(blob, signal);
      attachments.push({
        id: asset.id,
        kind: "image",
        objectId,
        mimeType: compressed.mimeType,
        dataUrl: compressed.dataUrl,
        width: compressed.width,
        height: compressed.height,
        byteSize: compressed.byteSize,
        status: "ready"
      });
    } catch {
      skippedObjectIds.push(objectId);
    }
  }

  return {
    attachments,
    skippedObjectIds,
    warning:
      skippedObjectIds.length > 0
        ? `有 ${skippedObjectIds.length} 张图片未能读取或压缩，本次不会发送这些图片像素。`
        : undefined
  };
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
    throw new Error("图片压缩失败。");
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

  throw new Error("图片压缩失败。");
}

function loadImage(blob: Blob, signal: AbortSignal): Promise<{ element: HTMLImageElement; width: number; height: number }> {
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
      reject(new Error("图片读取失败。"));
    };
    image.src = url;
  });
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
          reject(new Error("图片压缩失败。"));
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
      reject(new Error("图片读取失败。"));
    };
    reader.onerror = () => {
      signal.removeEventListener("abort", abort);
      reject(reader.error ?? new Error("图片读取失败。"));
    };
    reader.readAsDataURL(blob);
  });
}
