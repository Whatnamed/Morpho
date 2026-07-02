import { zipSync } from "fflate";

import {
  buildDeliveryOutputMarkdown,
  collectDeliveryOutputAssetCandidates,
  createDeliveryOutputManifest,
  updateDeliveryOutputManifestAssetAvailability,
  type DeliveryOutputAvailability,
  type DeliveryOutputDiagnostic,
  type DeliveryOutputManifest
} from "@/domain/morpho/deliveryOutput";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

type ExportDeliveryOutputOptions = {
  deliveryObjectId: string;
  blobStore: BlobStore;
  createdAt?: string;
  download?: boolean;
  zipSyncImpl?: typeof zipSync;
};

export type DeliveryOutputExportSummary = {
  sections: number;
  references: number;
  embeddedAssets: number;
  referenceOnlyOrNoBinary: number;
  missingOrMismatchedAssets: number;
  openGaps: number;
  pendingDrafts: number;
};

export type ExportDeliveryOutputResult =
  | {
      status: "ok";
      file: File;
      manifest: DeliveryOutputManifest;
      diagnostics: DeliveryOutputDiagnostic[];
      summary: DeliveryOutputExportSummary;
    }
  | {
      status: "blocked";
      reason: string;
      diagnostics: DeliveryOutputDiagnostic[];
    }
  | {
      status: "failed";
      reason: string;
      diagnostics: DeliveryOutputDiagnostic[];
    };

export type InspectDeliveryOutputResult =
  | {
      status: "ok";
      manifest: DeliveryOutputManifest;
      diagnostics: DeliveryOutputDiagnostic[];
      summary: DeliveryOutputExportSummary;
    }
  | {
      status: "blocked";
      reason: string;
      diagnostics: DeliveryOutputDiagnostic[];
    }
  | {
      status: "failed";
      reason: string;
      diagnostics: DeliveryOutputDiagnostic[];
    };

const utf8Encoder = new TextEncoder();

export async function inspectDeliveryOutputPackage(
  workspace: MorphoWorkspace,
  options: Pick<ExportDeliveryOutputOptions, "deliveryObjectId" | "blobStore" | "createdAt">
): Promise<InspectDeliveryOutputResult> {
  const manifestResult = createDeliveryOutputManifest(workspace, {
    deliveryObjectId: options.deliveryObjectId,
    createdAt: options.createdAt
  });

  if (manifestResult.status === "blocked") {
    return {
      status: "blocked",
      reason: manifestResult.reason,
      diagnostics: manifestResult.diagnostics
    };
  }

  try {
    const resolvedAssets = await resolveDeliveryOutputAssets(workspace, manifestResult.manifest, options.blobStore);
    const manifest = updateDeliveryOutputManifestAssetAvailability(manifestResult.manifest, resolvedAssets);
    return {
      status: "ok",
      manifest,
      diagnostics: manifest.integrity.diagnostics,
      summary: summarizeManifest(manifest)
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "Delivery output preflight failed.",
      diagnostics: manifestResult.diagnostics
    };
  }
}

export async function exportDeliveryOutputPackage(
  workspace: MorphoWorkspace,
  options: ExportDeliveryOutputOptions
): Promise<ExportDeliveryOutputResult> {
  const manifestResult = createDeliveryOutputManifest(workspace, {
    deliveryObjectId: options.deliveryObjectId,
    createdAt: options.createdAt
  });

  if (manifestResult.status === "blocked") {
    return {
      status: "blocked",
      reason: manifestResult.reason,
      diagnostics: manifestResult.diagnostics
    };
  }

  const resolvedAssets = await resolveDeliveryOutputAssets(workspace, manifestResult.manifest, options.blobStore);
  const manifest = updateDeliveryOutputManifestAssetAvailability(manifestResult.manifest, resolvedAssets);
  const markdown = buildDeliveryOutputMarkdown(manifest);
  const fileEntries: Record<string, Uint8Array> = {
    "output-manifest.json": utf8(JSON.stringify(manifest, null, 2)),
    "README.md": utf8(markdown["README.md"]),
    "delivery-outline.md": utf8(markdown["delivery-outline.md"]),
    "captions-and-copy.md": utf8(markdown["captions-and-copy.md"]),
    "gaps-and-next-steps.md": utf8(markdown["gaps-and-next-steps.md"]),
    "asset-index.md": utf8(markdown["asset-index.md"]),
    "source-map.json": utf8(markdown["source-map.json"])
  };

  for (const asset of resolvedAssets) {
    if (asset.bytes && asset.outputAssetPath && (asset.availability === "embedded" || asset.availability === "sizeMismatch")) {
      fileEntries[asset.outputAssetPath] = asset.bytes;
    }
  }

  try {
    const zipped = (options.zipSyncImpl ?? zipSync)(fileEntries);
    const file = new File([new Uint8Array(zipped)], outputFileName(manifest), { type: "application/zip" });
    if (options.download) {
      downloadDeliveryOutputFile(file);
    }
    return {
      status: "ok",
      file,
      manifest,
      diagnostics: manifest.integrity.diagnostics,
      summary: summarizeManifest(manifest)
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "Delivery output zip generation failed.",
      diagnostics: manifest.integrity.diagnostics
    };
  }
}

export function downloadDeliveryOutputFile(file: File | Blob, fileName?: string): void {
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName ?? (file instanceof File ? file.name : "morpho-delivery-output.zip");
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

async function resolveDeliveryOutputAssets(
  workspace: MorphoWorkspace,
  manifest: DeliveryOutputManifest,
  blobStore: BlobStore
): Promise<
  Array<{
    assetId: string;
    availability: DeliveryOutputAvailability;
    actualByteLength?: number;
    outputAssetPath?: string;
    bytes?: Uint8Array;
  }>
> {
  const candidates = collectDeliveryOutputAssetCandidates(workspace, manifest);
  const resolved = [];
  for (const candidate of candidates) {
    const runtimeAsset = workspace.assets[candidate.assetId];
    if (!runtimeAsset?.storageKey || candidate.availability === "referenceOnly" || candidate.availability === "noBinaryExpected") {
      resolved.push({
        assetId: candidate.assetId,
        availability: candidate.availability,
        outputAssetPath: candidate.outputAssetPath
      });
      continue;
    }
    try {
      const blob = await blobStore.get(runtimeAsset.storageKey);
      if (!blob) {
        resolved.push({
          assetId: candidate.assetId,
          availability: "missingBinary" as const,
          outputAssetPath: candidate.outputAssetPath
        });
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      resolved.push({
        assetId: candidate.assetId,
        availability: bytes.byteLength === candidate.expectedByteLength ? ("embedded" as const) : ("sizeMismatch" as const),
        actualByteLength: bytes.byteLength,
        outputAssetPath: candidate.outputAssetPath,
        bytes
      });
    } catch {
      resolved.push({
        assetId: candidate.assetId,
        availability: "missingBinary" as const,
        outputAssetPath: candidate.outputAssetPath
      });
    }
  }
  return resolved;
}

function summarizeManifest(manifest: DeliveryOutputManifest): DeliveryOutputExportSummary {
  return {
    sections: manifest.sections.length,
    references: manifest.references.length,
    embeddedAssets: manifest.assets.filter((asset) => asset.availability === "embedded").length,
    referenceOnlyOrNoBinary:
      manifest.assets.filter((asset) => asset.availability === "referenceOnly").length +
      manifest.references.filter((reference) => reference.availability === "noBinaryExpected").length,
    missingOrMismatchedAssets: manifest.assets.filter(
      (asset) => asset.availability === "missingBinary" || asset.availability === "sizeMismatch"
    ).length,
    openGaps: manifest.gaps.filter((gap) => gap.status === "open").length,
    pendingDrafts: manifest.pendingSectionDrafts.length
  };
}

function outputFileName(manifest: DeliveryOutputManifest): string {
  return `morpho-delivery-${safeSlug(manifest.delivery.title)}-${manifest.createdAt.slice(0, 10)}.zip`;
}

function safeSlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "output"
  );
}

function utf8(value: string): Uint8Array {
  return utf8Encoder.encode(value);
}
