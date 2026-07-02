import { describe, expect, test } from "vitest";
import {
  collectWorkspaceAssetInventory,
  createEditableProjectBackupManifest,
  createHumanReadableArchiveManifest,
  sanitizeWorkspaceForEditableBackup,
  validateEditableProjectBackupManifest,
  validateHumanReadableArchiveManifest
} from "./projectArchive";
import type { AssetRecord, MorphoWorkspace } from "./types";
import { createBlankWorkspace, createInitialWorkspace } from "./workspace";

const NOW = "2026-07-02T10:00:00.000Z";

describe("M7-A project archive and backup manifests", () => {
  test("creates distinct human-readable archive and editable backup manifests from current workspaces", () => {
    const blank = createBlankWorkspace("project-blank");
    const seeded = createInitialWorkspace();

    const archive = createHumanReadableArchiveManifest(blank, { createdAt: NOW });
    const backup = createEditableProjectBackupManifest(seeded, { createdAt: NOW });

    expect(archive.status).toBe("ok");
    expect(backup.status).toBe("ok");
    if (archive.status !== "ok" || backup.status !== "ok") {
      throw new Error("manifest creation should be ready for assertions");
    }

    expect(archive.manifest.format).toBe("morpho-human-readable-archive");
    expect(backup.manifest.format).toBe("morpho-editable-project-backup");
    expect(archive.manifest.manifestVersion).toBe("1");
    expect(backup.manifest.manifestVersion).toBe("1");
    expect(archive.manifest.createdAt).toBe(NOW);
    expect(backup.manifest.createdAt).toBe(NOW);
    expect(archive.manifest.sourceProject.id).toBe("project-blank");
    expect(backup.manifest.sourceProject.id).toBe(seeded.project.id);
    expect(archive.manifest.workspaceSchemaVersion).toBe(13);
    expect(backup.manifest.workspaceSchemaVersion).toBe(13);
    expect(archive.manifest.archive).toBeDefined();
    expect(backup.manifest.workspaceSnapshot).toBeDefined();
    expect("workspaceSnapshot" in archive.manifest).toBe(false);
    expect("archive" in backup.manifest).toBe(false);
  });

  test("audits all workspace assets and every known asset reference without leaking runtime storage keys", () => {
    const workspace = createAssetFixtureWorkspace();

    const inventory = collectWorkspaceAssetInventory(workspace);

    expect(inventory.entries.map((entry) => entry.sourceAssetId).sort()).toEqual([
      "asset-document-extract",
      "asset-file-original",
      "asset-image-hidden",
      "asset-image-visible",
      "asset-link",
      "asset-snapshot-preview",
      "asset-unused"
    ]);
    expect(inventory.entries.map((entry) => entry.portableBundleKey)).toEqual(
      inventory.entries.map((entry) => `assets/${entry.sourceAssetId}`)
    );
    expect(inventory.entries.some((entry) => JSON.stringify(entry).includes("blob:"))).toBe(false);
    expect(inventory.references.map((reference) => `${reference.field}:${reference.assetId}`).sort()).toEqual([
      "deliveryReferences.ref-stable.snapshot.previewAsset.assetId:asset-snapshot-preview",
      "deliveryReferences.ref-stable.snapshot.sourceFile.sourceExtractAssetId:asset-missing-extract",
      "deliveryReferences.ref-stable.sourceAssetId:asset-image-visible",
      "objects.file-document.assetId:asset-file-original",
      "objects.file-document.extractedAssetId:asset-document-extract",
      "objects.fragment-course.source.sourceExtractAssetId:asset-document-extract",
      "objects.image-hidden.assetId:asset-image-hidden",
      "objects.image-visible.assetId:asset-image-visible",
      "objects.link-source.assetId:asset-link",
      "project.coverAssetId:asset-image-visible"
    ]);
    expect(inventory.diagnostics.some((diagnostic) => diagnostic.code === "missing_asset_metadata")).toBe(true);
    expect(inventory.diagnostics.some((diagnostic) => diagnostic.code === "binary_not_verified")).toBe(true);
    expect(inventory.entries.every((entry) => entry.binaryStatus === "notVerified")).toBe(true);
  });

  test("keeps delivery snapshots and hidden or eliminated state truthful while preserving backup state", () => {
    const workspace = createAssetFixtureWorkspace();
    const archive = createHumanReadableArchiveManifest(workspace, { createdAt: NOW });
    const backup = createEditableProjectBackupManifest(workspace, { createdAt: NOW });

    expect(archive.status).toBe("ok");
    expect(backup.status).toBe("ok");
    if (archive.status !== "ok" || backup.status !== "ok") {
      throw new Error("manifest creation should be ready for assertions");
    }

    expect(archive.manifest.archive.delivery.references[0]?.snapshot.previewAsset?.assetId).toBe("asset-snapshot-preview");
    expect(archive.manifest.archive.directions[0]?.status).toBe("eliminated");
    expect(archive.manifest.archive.visualObjects.find((object) => object.id === "image-hidden")?.visibility).toBe("hidden");
    expect(backup.manifest.workspaceSnapshot.objects["image-hidden"]).toBeDefined();
    expect(backup.manifest.workspaceSnapshot.objects["direction-eliminated"]).toMatchObject({ status: "eliminated" });
  });

  test("controls conversation, continuity, and temporary UI state scope explicitly", () => {
    const workspace = createAssetFixtureWorkspace();
    const defaultArchive = createHumanReadableArchiveManifest(workspace, { createdAt: NOW });
    const scopedArchive = createHumanReadableArchiveManifest(workspace, {
      createdAt: NOW,
      chat: "decisionSummary",
      projectContinuity: "current"
    });
    const fullArchive = createHumanReadableArchiveManifest(workspace, { createdAt: NOW, chat: "full" });
    const backup = createEditableProjectBackupManifest(workspace, { createdAt: NOW });
    const sanitized = sanitizeWorkspaceForEditableBackup(workspace);

    expect(defaultArchive.status).toBe("ok");
    expect(scopedArchive.status).toBe("ok");
    expect(fullArchive.status).toBe("ok");
    expect(backup.status).toBe("ok");
    if (
      defaultArchive.status !== "ok" ||
      scopedArchive.status !== "ok" ||
      fullArchive.status !== "ok" ||
      backup.status !== "ok"
    ) {
      throw new Error("manifest creation should be ready for assertions");
    }

    expect(defaultArchive.manifest.archive.conversation).toEqual({ mode: "none" });
    expect(defaultArchive.manifest.archive.projectContinuity).toEqual({ mode: "none" });
    expect(scopedArchive.manifest.archive.conversation.mode).toBe("decisionSummary");
    expect(scopedArchive.manifest.archive.projectContinuity.mode).toBe("current");
    expect(fullArchive.manifest.archive.conversation.mode).toBe("full");
    expect(backup.manifest.workspaceSnapshot.projectContinuity.recordEntries.length).toBeGreaterThan(0);
    expect(sanitized.ui.lastSelectionIds).toEqual([]);
    expect(sanitized.ui.activeDrawer).toBeNull();
    expect(sanitized.ui.aiOpen).toBe(true);
    expect(sanitized.ui.canvasView).toEqual(sanitized.canvas.view);
  });

  test("validates external manifests with readable structural diagnostics", () => {
    const validWorkspace = createAssetFixtureWorkspace({ includeMissingMetadata: false });
    const invalidWorkspace = createAssetFixtureWorkspace();
    const archive = createHumanReadableArchiveManifest(validWorkspace, { createdAt: NOW });
    const backup = createEditableProjectBackupManifest(validWorkspace, { createdAt: NOW });
    const invalidBackup = createEditableProjectBackupManifest(invalidWorkspace, { createdAt: NOW });
    if (archive.status !== "ok" || backup.status !== "ok") {
      throw new Error("manifest creation should be ready for assertions");
    }

    expect(validateHumanReadableArchiveManifest(archive.manifest)).toEqual({
      status: "ok",
      manifest: archive.manifest,
      diagnostics: []
    });
    expect(validateEditableProjectBackupManifest(backup.manifest)).toEqual({
      status: "ok",
      manifest: backup.manifest,
      diagnostics: []
    });
    expect(validateEditableProjectBackupManifest(invalidBackup.status === "ok" ? invalidBackup.manifest : null).status).toBe("failed");

    expect(validateHumanReadableArchiveManifest({ ...archive.manifest, format: "wrong" }).status).toBe("failed");
    expect(validateEditableProjectBackupManifest({ ...backup.manifest, manifestVersion: "999" }).status).toBe("failed");
    expect(validateHumanReadableArchiveManifest({ ...archive.manifest, sourceProject: undefined }).status).toBe("failed");
    expect(
      validateEditableProjectBackupManifest({
        ...backup.manifest,
        assetInventory: {
          ...backup.manifest.assetInventory,
          entries: [
            backup.manifest.assetInventory.entries[0],
            { ...backup.manifest.assetInventory.entries[0] }
          ]
        }
      }).diagnostics.some((diagnostic) => diagnostic.code === "duplicate_portable_bundle_key")
    ).toBe(true);
    expect(
      validateEditableProjectBackupManifest({
        ...backup.manifest,
        assetInventory: {
          ...backup.manifest.assetInventory,
          entries: []
        }
      }).diagnostics.some((diagnostic) => diagnostic.code === "referenced_asset_missing_inventory_entry")
    ).toBe(true);
    expect(validateEditableProjectBackupManifest({ ...backup.manifest, workspaceSnapshot: { schemaVersion: 13 } }).status).toBe(
      "failed"
    );
  });
});

function createAssetFixtureWorkspace(options: { includeMissingMetadata?: boolean } = {}): MorphoWorkspace {
  const workspace = createBlankWorkspace("project-m7-a");
  const includeMissingMetadata = options.includeMissingMetadata ?? true;
  const visibleImage = asset("asset-image-visible", "visible.png", "image/png", "originalImage", "blob:visible");
  const hiddenImage = asset("asset-image-hidden", "hidden.png", "image/png", "aiGeneratedImage", "blob:hidden");
  const originalFile = asset("asset-file-original", "course.pdf", "application/pdf", "originalFile", "blob:file");
  const extract = asset("asset-document-extract", "course.extract.json", "application/json", "documentExtract", "extract:file");
  const missingExtract = asset("asset-missing-extract", "missing.extract.json", "application/json", "documentExtract", "extract:missing");
  const link = asset("asset-link", "source.url", "text/uri-list", "originalLink", "link:asset-link");
  const snapshot = asset("asset-snapshot-preview", "stable.png", "image/png", "aiGeneratedImage", "blob:snapshot");
  const unused = asset("asset-unused", "unused.png", "image/png", "originalImage", "blob:unused");

  return {
    ...workspace,
    project: {
      ...workspace.project,
      coverAssetId: visibleImage.id
    },
    assets: {
      [visibleImage.id]: visibleImage,
      [hiddenImage.id]: hiddenImage,
      [originalFile.id]: originalFile,
      [extract.id]: extract,
      ...(includeMissingMetadata ? {} : { [missingExtract.id]: missingExtract }),
      [link.id]: link,
      [snapshot.id]: snapshot,
      [unused.id]: unused
    },
    objects: {
      "image-visible": {
        id: "image-visible",
        type: "image",
        title: "可见图像",
        summary: "当前主视觉参考",
        createdBy: "user",
        visibility: "active",
        role: "reference",
        imageVariant: "path",
        assetId: visibleImage.id,
        isDefaultReference: true
      },
      "image-hidden": {
        id: "image-hidden",
        type: "image",
        title: "隐藏图像",
        summary: "历史备选图",
        createdBy: "ai",
        visibility: "hidden",
        role: "preview",
        imageVariant: "rail",
        assetId: hiddenImage.id
      },
      "file-document": {
        id: "file-document",
        type: "file",
        title: "课程要求",
        summary: "原始 PDF 与解析物",
        createdBy: "user",
        visibility: "active",
        fileKind: "pdf",
        sourceLabel: "导入文件",
        assetId: originalFile.id,
        parseStatus: "parsed",
        extractedAssetId: extract.id
      },
      "fragment-course": {
        id: "fragment-course",
        type: "documentFragment",
        title: "课程片段",
        summary: "从 PDF 里提取出的关键段落",
        body: "必须保留来源定位。",
        createdBy: "user",
        visibility: "active",
        source: {
          fileObjectId: "file-document",
          fileTitle: "课程要求",
          fileName: "course.pdf",
          sourceExtractAssetId: extract.id,
          startOffset: 0,
          endOffset: 12,
          blockIds: ["block-1"]
        }
      },
      "link-source": {
        id: "link-source",
        type: "link",
        title: "外部链接",
        summary: "链接资产",
        createdBy: "user",
        visibility: "active",
        url: "https://example.com",
        domain: "example.com",
        assetId: link.id
      },
      "direction-eliminated": {
        id: "direction-eliminated",
        type: "conceptDirection",
        title: "已淘汰方向",
        summary: "不应被误标为删除",
        createdBy: "ai",
        visibility: "active",
        status: "eliminated",
        keywords: ["discarded"],
        currentRevisionId: "rev-direction-eliminated",
        revisionIds: ["rev-direction-eliminated"],
        lineageRootId: "direction-eliminated"
      }
    },
    directionRevisions: {
      "rev-direction-eliminated": {
        id: "rev-direction-eliminated",
        directionId: "direction-eliminated",
        revisionNumber: 1,
        title: "已淘汰方向",
        summary: "保留淘汰原因",
        conceptStatement: "旧方案",
        keywords: ["discarded"],
        strategy: "不继续",
        differentiators: [],
        visualSignals: [],
        risks: ["不符合当前定义"],
        openQuestions: [],
        sourceObjectIds: [],
        citationIds: [],
        createdAt: NOW,
        isCurrent: true
      }
    },
    canvas: {
      view: { x: 10, y: 20, zoom: 0.75 },
      instances: [
        { id: "instance-hidden", objectId: "image-hidden", position: { x: 1, y: 2 }, size: { w: 100, h: 100 } }
      ]
    },
    deliveryReferences: {
      "ref-stable": {
        id: "ref-stable",
        deliveryObjectId: "delivery-main",
        sectionId: "section-1",
        sourceObjectId: "image-visible",
        sourceAssetId: visibleImage.id,
        createdAt: NOW,
        snapshot: {
          sourceType: "image",
          title: "旧快照标题",
          summary: "即使 live source 更新也不重算",
          sourceFile: {
            fileObjectId: "file-document",
            title: "课程要求",
            fileName: "course.pdf",
            sourceExtractAssetId: includeMissingMetadata ? "asset-missing-extract" : missingExtract.id
          },
          previewAsset: {
            assetId: snapshot.id,
            alt: "稳定快照"
          }
        }
      }
    },
    decisionRecords: [
      {
        id: "decision-eliminate",
        kind: "setDirectionStatus",
        createdAt: NOW,
        summary: "淘汰该方向",
        reason: "不符合课程限制",
        relatedObjectIds: ["direction-eliminated"]
      }
    ],
    projectContinuity: {
      ...workspace.projectContinuity,
      recordEntries: [
        {
          id: "continuity-decision",
          dedupeKey: "decision",
          origin: "deterministicEvent",
          manualState: "active",
          stage: "directionAndVisual",
          category: "decision",
          summary: "确认不继续旧方向",
          sourceRefs: [],
          createdAt: NOW,
          updatedAt: NOW,
          validity: "current"
        }
      ],
      updatedAt: NOW
    },
    ai: {
      messages: [
        { id: "msg-user", role: "user", body: "请比较这两个方向", createdAt: NOW },
        {
          id: "msg-assistant",
          role: "assistant",
          body: "建议淘汰旧方向",
          createdAt: NOW,
          continuityEntryIds: ["continuity-decision"]
        }
      ],
      conversationCheckpoints: [
        {
          id: "checkpoint-1",
          laneKey: "direction",
          focusArea: "directionAndVisual",
          focusUpdatedAt: NOW,
          taskKind: "comparison",
          anchorObjectIds: ["direction-eliminated"],
          targetDirectionIds: ["direction-eliminated"],
          sourceStartMessageId: "msg-user",
          sourceEndMessageId: "msg-assistant",
          sourceMessageCount: 2,
          createdAt: NOW,
          updatedAt: NOW,
          threadGoal: "比较方向",
          progress: ["淘汰旧方向"],
          openThreads: []
        }
      ],
      comparisonAnalyses: {}
    },
    ui: {
      activeDrawer: "search",
      aiOpen: false,
      lastSelectionIds: ["image-hidden"],
      canvasView: { x: 999, y: 999, zoom: 3 },
      workIntent: "comparison"
    }
  };
}

function asset(
  id: string,
  fileName: string,
  mimeType: string,
  sourceType: AssetRecord["sourceType"],
  storageKey: string
): AssetRecord {
  return {
    id,
    fileName,
    mimeType,
    sourceType,
    size: 123,
    createdAt: NOW,
    storageKey
  };
}
