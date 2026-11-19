"use client";

import {
  installCurrentCaseStudyAssets,
  type CaseStudyAssetInstallDiagnostic,
  type CaseStudyAssetInstallResult
} from "./caseStudyInstallation";

import { indexedDbBlobStore } from "./indexedDbAssetStore";

export async function ensureCurrentCaseStudyAssetsWithResult(): Promise<CaseStudyAssetInstallResult> {
  const result = await installCurrentCaseStudyAssets(indexedDbBlobStore);
  if (result.diagnostics.length > 0) {
    console.warn("Morpho current case study assets could not be installed.", result.diagnostics);
  }
  return result;
}

export async function ensureCurrentCaseStudyAssets(): Promise<CaseStudyAssetInstallDiagnostic[]> {
  const result = await ensureCurrentCaseStudyAssetsWithResult();
  return result.diagnostics;
}
