import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

import { currentCaseStudyAssetManifest } from "@/domain/morpho/caseStudy/currentCaseStudy";

export type CaseStudyAssetInstallDiagnostic = {
  assetId: string;
  code: "fetch_failed" | "hash_mismatch" | "size_mismatch" | "storage_failed";
};

export type CaseStudyAssetInstallResult = {
  diagnostics: CaseStudyAssetInstallDiagnostic[];
  installedCount: number;
  repairedCount: number;
  skippedCount: number;
  updatedStorageKeys: string[];
};

export async function installCurrentCaseStudyAssets(
  blobStore: BlobStore,
  options: {
    fetchAsset?: (input: string) => Promise<Response>;
  } = {}
): Promise<CaseStudyAssetInstallResult> {
  const fetchAsset = options.fetchAsset ?? ((input: string) => fetch(input));
  const diagnostics: CaseStudyAssetInstallDiagnostic[] = [];
  const updatedStorageKeys: string[] = [];
  let installedCount = 0;
  let repairedCount = 0;
  let skippedCount = 0;

  for (const asset of currentCaseStudyAssetManifest.assets) {
    let existing: Blob | null;
    try {
      existing = await blobStore.get(asset.runtimeStorageKey);
    } catch {
      diagnostics.push({ assetId: asset.assetId, code: "storage_failed" });
      continue;
    }
    if (existing) {
      const existingVerification = await verifyAssetBlob(existing, asset);
      if (existingVerification === "ok") {
        skippedCount += 1;
        continue;
      }
    }

    let response: Response;
    try {
      response = await fetchAsset(asset.publicPath);
    } catch {
      diagnostics.push({ assetId: asset.assetId, code: "fetch_failed" });
      continue;
    }

    if (!response.ok) {
      diagnostics.push({ assetId: asset.assetId, code: "fetch_failed" });
      continue;
    }

    const blob = new Blob([await response.arrayBuffer()], { type: asset.mimeType });
    const verification = await verifyAssetBlob(blob, asset);
    if (verification === "size_mismatch") {
      diagnostics.push({ assetId: asset.assetId, code: "size_mismatch" });
      continue;
    }
    if (verification === "hash_mismatch") {
      diagnostics.push({ assetId: asset.assetId, code: "hash_mismatch" });
      continue;
    }

    try {
      await blobStore.put(asset.runtimeStorageKey, blob);
      updatedStorageKeys.push(asset.runtimeStorageKey);
      if (existing) {
        repairedCount += 1;
      } else {
        installedCount += 1;
      }
    } catch {
      diagnostics.push({ assetId: asset.assetId, code: "storage_failed" });
    }
  }

  return { diagnostics, installedCount, repairedCount, skippedCount, updatedStorageKeys };
}

async function verifyAssetBlob(
  blob: Blob,
  asset: (typeof currentCaseStudyAssetManifest.assets)[number]
): Promise<"ok" | "size_mismatch" | "hash_mismatch"> {
  if (blob.size !== asset.size) {
    return "size_mismatch";
  }

  const actualHash = await sha256Hex(await blob.arrayBuffer());
  return actualHash === asset.contentHash ? "ok" : "hash_mismatch";
}

async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
