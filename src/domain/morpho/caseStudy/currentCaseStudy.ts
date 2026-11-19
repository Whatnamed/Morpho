import assetManifestFixture from "./currentCaseAssets.generated.json";
import diagnosticsFixture from "./currentCaseDiagnostics.generated.json";

export { CURRENT_CASE_STUDY_ID } from "./currentCaseStudyConstants";
export const CURRENT_CASE_STUDY_VERSION = diagnosticsFixture.caseStudyVersion;
export const CURRENT_CASE_STUDY_ASSET_MANIFEST_VERSION = assetManifestFixture.manifestVersion;

export type CurrentCaseStudyAssetManifestEntry = {
  assetId: string;
  contentHash: string;
  mimeType: string;
  publicPath: string;
  runtimeStorageKey: string;
  size: number;
};

export type CurrentCaseStudyAssetManifest = {
  manifestVersion: string;
  assets: CurrentCaseStudyAssetManifestEntry[];
};

export const currentCaseStudyAssetManifest: CurrentCaseStudyAssetManifest = assetManifestFixture;
