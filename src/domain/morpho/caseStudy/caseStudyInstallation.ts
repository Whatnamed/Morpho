import type { BlobStore } from "@/infrastructure/assets/localAssetWorkflow";

import {
  CURRENT_CASE_STUDY_ASSET_MANIFEST_VERSION,
  CURRENT_CASE_STUDY_ID,
  CURRENT_CASE_STUDY_VERSION,
  currentCaseStudyAssetManifest,
  currentCaseStudyWorkspace
} from "./currentCaseStudy";
import { fingerprintCaseStudyWorkspace } from "./caseStudyFingerprint";

export const CASE_STUDY_INSTALLATION_STORAGE_KEY = "morpho.case-study.install.v1";

export type CaseStudyInstallationMarker = {
  assetManifestVersion: string;
  installedVersion: string;
  projectId: string;
  workspaceFingerprint: string;
  obsoleteStorageKeys?: string[];
};

export type CaseStudyAssetInstallDiagnostic = {
  assetId: string;
  code: "fetch_failed" | "hash_mismatch" | "size_mismatch" | "storage_failed";
};

export type CaseStudyAssetInstallResult = {
  diagnostics: CaseStudyAssetInstallDiagnostic[];
  installedCount: number;
  repairedCount: number;
  skippedCount: number;
};

export async function installCurrentCaseStudyAssets(
  blobStore: BlobStore,
  options: {
    fetchAsset?: (input: string) => Promise<Response>;
    storage?: Storage;
  } = {}
): Promise<CaseStudyAssetInstallResult> {
  const fetchAsset = options.fetchAsset ?? ((input: string) => fetch(input));
  const previousMarker = options.storage ? readCaseStudyInstallationMarker(options.storage) : null;
  const diagnostics: CaseStudyAssetInstallDiagnostic[] = [];
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
      if (existing) {
        repairedCount += 1;
      } else {
        installedCount += 1;
      }
    } catch {
      diagnostics.push({ assetId: asset.assetId, code: "storage_failed" });
    }
  }

  if (diagnostics.length === 0 && options.storage) {
    await Promise.all(
      (previousMarker?.obsoleteStorageKeys ?? []).map(async (storageKey) => {
        try {
          await blobStore.delete(storageKey);
        } catch {
          // Legacy seed binaries are safe to leave behind if IndexedDB cleanup is unavailable.
        }
      })
    );
    writeCaseStudyInstallationMarker(options.storage, {
      assetManifestVersion: CURRENT_CASE_STUDY_ASSET_MANIFEST_VERSION,
      installedVersion: CURRENT_CASE_STUDY_VERSION,
      projectId: CURRENT_CASE_STUDY_ID,
      workspaceFingerprint: fingerprintCaseStudyWorkspace(currentCaseStudyWorkspace)
    });
  }

  return { diagnostics, installedCount, repairedCount, skippedCount };
}

export function readCaseStudyInstallationMarker(storage: Storage): CaseStudyInstallationMarker | null {
  const raw = storage.getItem(CASE_STUDY_INSTALLATION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value) ||
      typeof value.installedVersion !== "string" ||
      typeof value.projectId !== "string" ||
      typeof value.workspaceFingerprint !== "string" ||
      typeof value.assetManifestVersion !== "string"
    ) {
      return null;
    }
    return {
      assetManifestVersion: value.assetManifestVersion,
      installedVersion: value.installedVersion,
      obsoleteStorageKeys: Array.isArray(value.obsoleteStorageKeys)
        ? value.obsoleteStorageKeys.filter((storageKey): storageKey is string => typeof storageKey === "string")
        : undefined,
      projectId: value.projectId,
      workspaceFingerprint: value.workspaceFingerprint
    };
  } catch {
    return null;
  }
}

export function writeCaseStudyInstallationMarker(storage: Storage, marker: CaseStudyInstallationMarker): void {
  storage.setItem(CASE_STUDY_INSTALLATION_STORAGE_KEY, JSON.stringify(marker));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
