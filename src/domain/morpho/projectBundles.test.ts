import { describe, expect, test } from "vitest";

import {
  createEditableProjectBackupManifest,
  createHumanReadableArchiveManifest,
  type EditableProjectBackupManifest,
  type HumanReadableArchiveManifest
} from "./projectArchive";
import {
  createEditableProjectBackupBundle,
  createHumanReadableArchiveBundle,
  planEditableProjectBackupRestore,
  validateEditableProjectBackupBundle,
  validateHumanReadableArchiveBundle,
  type ProjectBundleResolvedAsset
} from "./projectBundles";
import type { AssetRecord, MorphoWorkspace } from "./types";
import { createBlankWorkspace } from "./workspace";

const NOW = "2026-07-02T12:00:00.000Z";

describe("project bundle domain contracts", () => {
  test("creates a human-readable archive bundle with markdown documents and available assets", () => {
    const manifest = createArchiveManifest(createBundleFixtureWorkspace());
    const bundle = createHumanReadableArchiveBundle(manifest, [
      resolvedAsset(manifest, "asset-cover", "embedded", "cover-bytes"),
      resolvedAsset(manifest, "asset-link", "referenceOnly"),
      resolvedAsset(manifest, "asset-brief", "missingRequiredBinary")
    ]);

    expect(bundle.fileName).toBe("morpho-archive-night-study-2026-07-02.zip");
    expect(bundle.envelope.packageKind).toBe("humanArchive");
    expect(bundle.envelope.manifestPath).toBe("archive-manifest.json");
    expect(bundle.envelope.files.map((file) => file.path)).toEqual([
      "bundle.json",
      "archive-manifest.json",
      "README.md",
      "project-overview.md",
      "research-and-sources.md",
      "directions-and-visuals.md",
      "decisions-and-process.md",
      "delivery-preparation.md",
      "asset-index.md",
      "assets/asset-cover"
    ]);
    expect(readBundleText(bundle, "README.md")).toContain("Night Study");
    expect(readBundleText(bundle, "README.md")).toContain("不能用于恢复");
    expect(readBundleText(bundle, "asset-index.md")).toContain("asset-brief");
    expect(bundle.diagnostics.some((diagnostic) => diagnostic.code === "asset_binary_missing")).toBe(true);
  });

  test("allows incomplete human-readable archive bundles but blocks incomplete editable backups", () => {
    const workspace = createBundleFixtureWorkspace();
    const archiveManifest = createArchiveManifest(workspace);
    const backupManifest = createBackupManifest(workspace, { chat: "full", projectContinuity: "current" });

    const archiveBundle = createHumanReadableArchiveBundle(archiveManifest, [
      resolvedAsset(archiveManifest, "asset-cover", "embedded", "cover-bytes"),
      resolvedAsset(archiveManifest, "asset-link", "referenceOnly"),
      resolvedAsset(archiveManifest, "asset-brief", "missingRequiredBinary")
    ]);
    const archiveValidation = validateHumanReadableArchiveBundle({
      bundle: archiveBundle.envelope,
      manifest: archiveManifest,
      files: mapBundleFiles(archiveBundle)
    });

    expect(archiveValidation.status).toBe("ok");
    expect(archiveValidation.diagnostics.some((diagnostic) => diagnostic.code === "asset_binary_missing")).toBe(true);

    const blockedBackup = createEditableProjectBackupBundle(backupManifest, [
      resolvedAsset(backupManifest, "asset-cover", "embedded", "cover-bytes"),
      resolvedAsset(backupManifest, "asset-link", "referenceOnly"),
      resolvedAsset(backupManifest, "asset-brief", "missingRequiredBinary")
    ]);

    expect(blockedBackup.status).toBe("blocked");
    if (blockedBackup.status === "blocked") {
      expect(blockedBackup.diagnostics.some((diagnostic) => diagnostic.code === "asset_binary_missing")).toBe(true);
    }
  });

  test("validates editable backup bundles and remaps project identity plus runtime storage keys during restore planning", () => {
    const backupManifest = createBackupManifest(createBundleFixtureWorkspace(), { chat: "full", projectContinuity: "current" });
    const bundleResult = createEditableProjectBackupBundle(backupManifest, [
      resolvedAsset(backupManifest, "asset-cover", "embedded", "cover-bytes"),
      resolvedAsset(backupManifest, "asset-link", "referenceOnly"),
      resolvedAsset(backupManifest, "asset-brief", "embedded", "brief-bytes")
    ]);

    expect(bundleResult.status).toBe("ok");
    if (bundleResult.status !== "ok") {
      throw new Error("backup bundle should be ready for assertions");
    }

    const validation = validateEditableProjectBackupBundle({
      bundle: bundleResult.bundle.envelope,
      manifest: backupManifest,
      files: mapBundleFiles(bundleResult.bundle)
    });

    expect(validation.status).toBe("ok");
    if (validation.status !== "ok") {
      throw new Error("validated backup should be ready for restore assertions");
    }

    const plan = planEditableProjectBackupRestore(validation.manifest, validation.files, {
      restoredAt: NOW,
      projectId: "project-restored",
      projectTitle: "Night Study（恢复副本 2）",
      createRuntimeStorageKey: (assetId) => `blob:restored:${assetId}`
    });

    expect(plan.status).toBe("ok");
    if (plan.status !== "ok") {
      throw new Error("restore plan should be ready for assertions");
    }

    expect(plan.workspace.project.id).toBe("project-restored");
    expect(plan.workspace.project.title).toBe("Night Study（恢复副本 2）");
    expect(plan.workspace.project.coverAssetId).toBe("asset-cover");
    expect(plan.workspace.assets["asset-cover"]?.storageKey).toBe("blob:restored:asset-cover");
    expect(plan.workspace.assets["asset-brief"]?.storageKey).toBe("blob:restored:asset-brief");
    expect(plan.workspace.assets["asset-link"]?.storageKey).toBe("blob:restored:asset-link");
    expect(plan.assetWrites.map((item) => item.assetId).sort()).toEqual(["asset-brief", "asset-cover"]);
    expect(new TextDecoder().decode(plan.assetWrites[0]?.bytes ?? new Uint8Array())).not.toHaveLength(0);
  });
});

function createBundleFixtureWorkspace(): MorphoWorkspace {
  const workspace = createBlankWorkspace("project-night-study");
  const coverAsset = asset("asset-cover", "cover.png", "image/png", "originalImage", "blob:asset-cover", 11);
  const briefAsset = asset("asset-brief", "brief.pdf", "application/pdf", "originalFile", "blob:asset-brief", 11);
  const linkAsset: AssetRecord = {
    ...asset("asset-link", "source.url", "text/uri-list", "originalLink", "blob:asset-link", 0),
    url: "https://example.com/night-study",
    domain: "example.com"
  };

  return {
    ...workspace,
    project: {
      ...workspace.project,
      title: "Night Study",
      subtitle: "Bundle export fixture",
      coverAssetId: coverAsset.id
    },
    assets: {
      [coverAsset.id]: coverAsset,
      [briefAsset.id]: briefAsset,
      [linkAsset.id]: linkAsset
    },
    ai: {
      messages: [
        { id: "msg-1", role: "user", body: "Keep the warmer direction.", createdAt: NOW },
        { id: "msg-2", role: "assistant", body: "Recorded for the project.", createdAt: NOW }
      ],
      conversationCheckpoints: [
        {
          id: "checkpoint-1",
          laneKey: "general",
          focusArea: "directionAndVisual",
          focusUpdatedAt: NOW,
          taskKind: "general",
          anchorObjectIds: [],
          targetDirectionIds: [],
          sourceStartMessageId: "msg-1",
          sourceEndMessageId: "msg-2",
          sourceMessageCount: 2,
          createdAt: NOW,
          updatedAt: NOW,
          threadGoal: "Refine the direction",
          progress: ["Choose the warmer route"],
          openThreads: []
        }
      ],
      comparisonAnalyses: {}
    },
    projectContinuity: {
      ...workspace.projectContinuity,
      currentFocus: {
        ...workspace.projectContinuity.currentFocus,
        note: "Continue the night-use direction"
      },
      recordEntries: [
        {
          id: "continuity-1",
          dedupeKey: "direction-choice",
          origin: "deterministicEvent",
          manualState: "active",
          stage: "directionAndVisual",
          category: "decision",
          summary: "Keep the warmer route",
          sourceRefs: [],
          createdAt: NOW,
          updatedAt: NOW,
          validity: "current"
        }
      ],
      updatedAt: NOW
    }
  };
}

function createArchiveManifest(workspace: MorphoWorkspace): HumanReadableArchiveManifest {
  const result = createHumanReadableArchiveManifest(workspace, { createdAt: NOW });
  if (result.status !== "ok") {
    throw new Error("archive manifest should be ready for bundle assertions");
  }
  return result.manifest;
}

function createBackupManifest(
  workspace: MorphoWorkspace,
  options: { chat: "none" | "full"; projectContinuity: "current" | "recordEntriesNone" }
): EditableProjectBackupManifest {
  const result = createEditableProjectBackupManifest(workspace, { createdAt: NOW, ...options });
  if (result.status !== "ok") {
    throw new Error("backup manifest should be ready for bundle assertions");
  }
  return result.manifest;
}

function resolvedAsset(
  manifest: HumanReadableArchiveManifest | EditableProjectBackupManifest,
  assetId: string,
  availability: ProjectBundleResolvedAsset["availability"],
  contents?: string
): ProjectBundleResolvedAsset {
  const entry = manifest.assetInventory.entries.find((candidate) => candidate.sourceAssetId === assetId);
  if (!entry) {
    throw new Error(`Missing inventory entry for ${assetId}`);
  }

  const bytes = contents ? new TextEncoder().encode(contents) : undefined;

  return {
    sourceAssetId: entry.sourceAssetId,
    portableBundleKey: entry.portableBundleKey,
    fileName: entry.fileName,
    mimeType: entry.mimeType,
    sourceType: entry.sourceType,
    expectedByteLength: entry.size,
    actualByteLength: bytes?.byteLength,
    availability,
    required: entry.sourceType !== "originalLink",
    bytes
  };
}

function readBundleText(
  bundle:
    | ReturnType<typeof createHumanReadableArchiveBundle>
    | Extract<ReturnType<typeof createEditableProjectBackupBundle>, { status: "ok" }>["bundle"],
  path: string
): string {
  const file = bundle.files.find((candidate) => candidate.path === path);
  if (!file) {
    throw new Error(`Missing bundle file at ${path}`);
  }

  return new TextDecoder().decode(file.bytes);
}

function mapBundleFiles(
  bundle:
    | ReturnType<typeof createHumanReadableArchiveBundle>
    | Extract<ReturnType<typeof createEditableProjectBackupBundle>, { status: "ok" }>["bundle"]
): Record<string, Uint8Array> {
  return Object.fromEntries(bundle.files.map((file) => [file.path, file.bytes]));
}

function asset(
  id: string,
  fileName: string,
  mimeType: string,
  sourceType: AssetRecord["sourceType"],
  storageKey: string,
  size: number
): AssetRecord {
  return {
    id,
    fileName,
    mimeType,
    size,
    createdAt: NOW,
    storageKey,
    sourceType
  };
}
