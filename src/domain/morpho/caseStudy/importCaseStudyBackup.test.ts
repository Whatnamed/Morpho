import { describe, expect, it } from "vitest";

import { createEditableProjectBackupManifest } from "../projectArchive";
import { createEditableProjectBackupBundle, type ProjectBundleResolvedAsset } from "../projectBundles";
import type { AssetRecord, MorphoWorkspace } from "../types";
import { createBlankWorkspace } from "../workspace";
import { prepareCurrentCaseStudyImport } from "./importCaseStudyBackup";

describe("case-study backup import", () => {
  it("converts a valid editable backup deterministically", () => {
    const fixture = createBackupFixture();

    const first = prepareCurrentCaseStudyImport({ ...fixture, caseStudyVersion: "test-1" });
    const second = prepareCurrentCaseStudyImport({ ...fixture, caseStudyVersion: "test-1" });

    expect(first.workspace.project.id).toBe("project-morpho-case-study");
    expect(first.workspace.project.title).toBe("Import fixture");
    expect(first.assetManifest).toEqual(second.assetManifest);
    expect(first.workspace).toEqual(second.workspace);
  });

  it.each([
    ["bundle missing", (fixture: BackupFixture) => ({ ...fixture, bundle: {} })],
    ["manifest invalid", (fixture: BackupFixture) => ({ ...fixture, manifest: {} })],
    ["workspace invalid", withInvalidWorkspace],
    [
      "image asset missing",
      (fixture: BackupFixture) => ({
        ...fixture,
        files: omitFile(fixture.files, "assets/asset-image")
      })
    ],
    [
      "PDF asset missing",
      (fixture: BackupFixture) => ({
        ...fixture,
        files: omitFile(fixture.files, "assets/asset-brief")
      })
    ],
    [
      "size mismatch",
      (fixture: BackupFixture) => ({
        ...fixture,
        files: { ...fixture.files, "assets/asset-image": new Uint8Array([1]) }
      })
    ]
  ])("rejects %s", (_label, mutate) => {
    expect(() => prepareCurrentCaseStudyImport({ ...mutate(createBackupFixture()), caseStudyVersion: "test-1" })).toThrow(
      /validation|workspace/i
    );
  });

  it("rejects a temporary reference-only URL", () => {
    const fixture = createBackupFixture({ includeReferenceOnlyLink: true });

    expect(() => prepareCurrentCaseStudyImport({ ...fixture, caseStudyVersion: "test-1" })).toThrow(
      /stable public URLs/i
    );
  });

  it("cleans local paths while rejecting credential-like values", () => {
    const pathFixture = createBackupFixture({ textBody: "Read C:\\Users\\hasee\\private\\brief.pdf before continuing." });
    const imported = prepareCurrentCaseStudyImport({ ...pathFixture, caseStudyVersion: "test-1" });
    const text = imported.workspace.objects["text-note"];

    expect(text?.type === "text" ? text.body : "").toContain("[已清理本地路径]");
    expect(imported.report.cleanedCategories).toContain("local-path");

    const credentialFixture = createBackupFixture({ textBody: "apiKey=sk-1234567890abcdefghijklmnopqrst" });
    expect(() => prepareCurrentCaseStudyImport({ ...credentialFixture, caseStudyVersion: "test-1" })).toThrow(
      /credential|API key/i
    );
  });
});

type BackupFixture = {
  bundle: unknown;
  files: Record<string, Uint8Array>;
  manifest: unknown;
};

function createBackupFixture(options: { includeReferenceOnlyLink?: boolean; textBody?: string } = {}): BackupFixture {
  const workspace = createFixtureWorkspace(options);
  const manifestResult = createEditableProjectBackupManifest(workspace, {
    chat: "full",
    createdAt: "2026-07-13T00:00:00.000Z",
    projectContinuity: "current"
  });
  if (manifestResult.status !== "ok") {
    throw new Error("Expected fixture manifest to be valid.");
  }

  const bytesByAssetId: Record<string, Uint8Array> = {
    "asset-image": new Uint8Array([1, 2, 3, 4]),
    "asset-brief": new Uint8Array([5, 6, 7, 8, 9])
  };
  const resolvedAssets: ProjectBundleResolvedAsset[] = manifestResult.manifest.assetInventory.entries.map((entry) => {
    const bytes = bytesByAssetId[entry.sourceAssetId];
    return {
      sourceAssetId: entry.sourceAssetId,
      portableBundleKey: entry.portableBundleKey,
      fileName: entry.fileName,
      mimeType: entry.mimeType,
      sourceType: entry.sourceType,
      expectedByteLength: entry.size,
      actualByteLength: bytes?.byteLength,
      availability: entry.sourceType === "originalLink" ? "referenceOnly" : "embedded",
      required: entry.sourceType !== "originalLink",
      bytes
    };
  });
  const bundleResult = createEditableProjectBackupBundle(manifestResult.manifest, resolvedAssets);
  if (bundleResult.status !== "ok") {
    throw new Error("Expected fixture bundle to be valid.");
  }

  return {
    bundle: bundleResult.bundle.envelope,
    files: Object.fromEntries(bundleResult.bundle.files.map((file) => [file.path, file.bytes])),
    manifest: manifestResult.manifest
  };
}

function createFixtureWorkspace(options: { includeReferenceOnlyLink?: boolean; textBody?: string }): MorphoWorkspace {
  const workspace = createBlankWorkspace("project-import-fixture");
  const createdAt = "2026-07-13T00:00:00.000Z";
  const imageAsset = asset("asset-image", "render.png", "image/png", "originalImage", 4);
  const briefAsset = asset("asset-brief", "brief.pdf", "application/pdf", "originalFile", 5);

  return {
    ...workspace,
    project: {
      ...workspace.project,
      title: "Import fixture",
      subtitle: "Fixture subtitle",
      createdAt,
      updatedAt: createdAt,
      lastOpenedAt: createdAt
    },
    assets: {
      "asset-image": imageAsset,
      "asset-brief": briefAsset
    },
    objects: {
      "image-card": {
        id: "image-card",
        type: "image",
        title: "Fixture image",
        summary: "Image",
        createdBy: "user",
        visibility: "active",
        role: "reference",
        assetId: "asset-image"
      },
      "file-card": {
        id: "file-card",
        type: "file",
        title: "Fixture brief",
        summary: "PDF",
        createdBy: "user",
        visibility: "active",
        fileKind: "pdf",
        sourceLabel: "user",
        assetId: "asset-brief",
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        size: 5,
        parseStatus: "unparsed"
      },
      "text-note": {
        id: "text-note",
        type: "text",
        title: "Fixture note",
        summary: "Note",
        createdBy: "user",
        visibility: "active",
        body: options.textBody ?? "Safe fixture note."
      },
      ...(options.includeReferenceOnlyLink
        ? {
            "link-card": {
              id: "link-card",
              type: "link" as const,
              title: "Temporary link",
              summary: "Link",
              createdBy: "user" as const,
              visibility: "active" as const,
              url: "blob:https://localhost/fake",
              domain: "localhost",
              assetId: "asset-link"
            }
          }
        : {})
    },
    ...(options.includeReferenceOnlyLink
      ? {
          assets: {
            "asset-image": imageAsset,
            "asset-brief": briefAsset,
            "asset-link": {
              ...asset("asset-link", "temporary-link", "text/uri-list", "originalLink", 0),
              url: "blob:https://localhost/fake",
              domain: "localhost"
            }
          }
        }
      : {})
  };
}

function asset(
  id: string,
  fileName: string,
  mimeType: string,
  sourceType: AssetRecord["sourceType"],
  size: number
): AssetRecord {
  return {
    id,
    fileName,
    mimeType,
    size,
    createdAt: "2026-07-13T00:00:00.000Z",
    storageKey: `blob:${id}`,
    sourceType
  };
}

function omitFile(files: Record<string, Uint8Array>, path: string): Record<string, Uint8Array> {
  return Object.fromEntries(Object.entries(files).filter(([candidate]) => candidate !== path));
}

function withInvalidWorkspace(fixture: BackupFixture): BackupFixture {
  if (typeof fixture.manifest !== "object" || fixture.manifest === null || Array.isArray(fixture.manifest)) {
    return fixture;
  }
  return {
    ...fixture,
    manifest: {
      ...fixture.manifest,
      workspaceSnapshot: {}
    }
  };
}
