"use client";

import { installCurrentCaseStudyAssets, type CaseStudyAssetInstallDiagnostic } from "@/domain/morpho/caseStudy/caseStudyInstallation";

import { indexedDbBlobStore } from "./indexedDbAssetStore";

export async function ensureCurrentCaseStudyAssets(): Promise<CaseStudyAssetInstallDiagnostic[]> {
  const result = await installCurrentCaseStudyAssets(indexedDbBlobStore, { storage: window.localStorage });
  if (result.diagnostics.length > 0) {
    console.warn("Morpho current case study assets could not be installed.", result.diagnostics);
  }
  return result.diagnostics;
}
