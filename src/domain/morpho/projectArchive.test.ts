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

  test("human-readable archive keeps delivery packages, visual route fields, research objects, source index, and citations", () => {
    const workspace = createFixtureWorkspace({ includeMissingMetadata: false });
    const archive = createHumanReadableArchiveManifest(workspace, { createdAt: NOW, chat: "decisionSummary", projectContinuity: "current" });

    expect(archive.status).toBe("ok");
    if (archive.status !== "ok") {
      throw new Error("archive creation should be ready for assertions");
    }

    expect(archive.manifest.archive.delivery.packages).toHaveLength(1);
    expect(archive.manifest.archive.delivery.packages[0]).toMatchObject({
      id: "delivery-main",
      format: "board",
      references: ["ref-stable"],
      sections: [
        expect.objectContaining({
          id: "section-hero",
          title: "Hero",
          order: 0,
          referenceIds: ["ref-stable"],
          narrative: "Hero narrative"
        })
      ],
      gaps: [expect.objectContaining({ id: "gap-missing-angle", status: "open" })]
    });

    expect(archive.manifest.archive.visualObjects).toEqual([
      expect.objectContaining({
        id: "image-hidden",
        role: "preview",
        imageVariant: "rail",
        directionId: "direction-primary",
        directionTitle: "Direction Primary",
        visualBranchId: "branch-primary",
        visualBranchLabel: "Branch Primary",
        isDefaultReference: false,
        visibility: "hidden"
      }),
      expect.objectContaining({
        id: "image-visible",
        role: "primaryVisual",
        imageVariant: "path",
        directionId: "direction-primary",
        directionTitle: "Direction Primary",
        visualBranchId: "branch-primary",
        visualBranchLabel: "Branch Primary",
        isDefaultReference: true,
        visibility: "active"
      })
    ]);

    expect(archive.manifest.archive.researchAndSources.researchObjects).toEqual([
      expect.objectContaining({
        id: "research-market",
        evidence: [expect.objectContaining({ citationIds: ["citation-web"] })]
      })
    ]);
    expect(Object.keys(archive.manifest.archive.researchAndSources.citationSnapshots)).toEqual(["citation-web"]);
    expect(archive.manifest.archive.researchAndSources.sourceIndex.map((entry) => entry.id).sort()).toEqual([
      "file-document",
      "fragment-course",
      "link-source",
      "text-note"
    ]);
  });

  test("audits all workspace assets and every known asset reference without leaking runtime storage keys", () => {
    const workspace = createFixtureWorkspace();
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

  test("keeps delivery snapshots and hidden or eliminated state truthful while blocking invalid editable backups", () => {
    const invalidWorkspace = createFixtureWorkspace();
    const validWorkspace = createFixtureWorkspace({ includeMissingMetadata: false });
    const archive = createHumanReadableArchiveManifest(invalidWorkspace, { createdAt: NOW });
    const backup = createEditableProjectBackupManifest(validWorkspace, { createdAt: NOW });
    const blockedBackup = createEditableProjectBackupManifest(invalidWorkspace, { createdAt: NOW });

    expect(archive.status).toBe("ok");
    expect(backup.status).toBe("ok");
    expect(blockedBackup.status).toBe("blocked");
    if (archive.status !== "ok" || backup.status !== "ok") {
      throw new Error("manifest creation should be ready for assertions");
    }

    expect(archive.manifest.archive.delivery.references[0]?.snapshot.previewAsset?.assetId).toBe("asset-snapshot-preview");
    expect(archive.manifest.archive.directions.find((direction) => direction.id === "direction-eliminated")?.status).toBe("eliminated");
    expect(archive.manifest.archive.visualObjects.find((object) => object.id === "image-hidden")?.visibility).toBe("hidden");
    expect(backup.manifest.workspaceSnapshot.objects["image-hidden"]).toBeDefined();
    expect(backup.manifest.workspaceSnapshot.objects["direction-eliminated"]).toMatchObject({ status: "eliminated" });
    expect(blockedBackup.diagnostics.some((diagnostic) => diagnostic.code === "missing_asset_metadata")).toBe(true);
    expect(blockedBackup.diagnostics.some((diagnostic) => diagnostic.code === "referenced_asset_missing_inventory_entry")).toBe(true);
  });

  test("allows incomplete human-readable archives but rejects incomplete editable backups", () => {
    const invalidWorkspace = createFixtureWorkspace();
    const archive = createHumanReadableArchiveManifest(invalidWorkspace, { createdAt: NOW });
    const backup = createEditableProjectBackupManifest(invalidWorkspace, { createdAt: NOW });

    expect(archive.status).toBe("ok");
    expect(backup.status).toBe("blocked");
    if (archive.status !== "ok") {
      throw new Error("archive creation should be ready for assertions");
    }

    const archiveValidation = validateHumanReadableArchiveManifest(archive.manifest);
    expect(archiveValidation.status).toBe("ok");
    expect(
      archiveValidation.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "referenced_asset_missing_inventory_entry" && diagnostic.severity === "warning"
      )
    ).toBe(true);

    const forcedBackupValidation = validateEditableProjectBackupManifest({
      ...(backup.status === "blocked" ? createBlockedBackupLikeManifest(invalidWorkspace, NOW) : backup.manifest)
    });
    expect(forcedBackupValidation.status).toBe("failed");
    expect(
      forcedBackupValidation.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "referenced_asset_missing_inventory_entry" && diagnostic.severity === "error"
      )
    ).toBe(true);
  });

  test("controls conversation, continuity, and temporary UI state scope explicitly", () => {
    const workspace = createFixtureWorkspace({ includeMissingMetadata: false });
    const defaultArchive = createHumanReadableArchiveManifest(workspace, { createdAt: NOW });
    const scopedArchive = createHumanReadableArchiveManifest(workspace, {
      createdAt: NOW,
      chat: "decisionSummary",
      projectContinuity: "current"
    });
    const fullArchive = createHumanReadableArchiveManifest(workspace, { createdAt: NOW, chat: "full" });
    const backup = createEditableProjectBackupManifest(workspace, { createdAt: NOW });
    const sanitized = sanitizeWorkspaceForEditableBackup(workspace, { chat: "none", projectContinuity: "current" });

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
    expect(sanitized.ui.workIntent).toBe("discussion");
  });

  test("backup default chat none removes messages, checkpoints, and compare analyses", () => {
    const workspace = createFixtureWorkspace({ includeMissingMetadata: false });
    const backup = createEditableProjectBackupManifest(workspace, { createdAt: NOW });

    expect(backup.status).toBe("ok");
    if (backup.status !== "ok") {
      throw new Error("backup creation should be ready for assertions");
    }

    expect(backup.manifest.options.chat).toBe("none");
    expect(backup.manifest.workspaceSnapshot.ai.messages).toEqual([]);
    expect(backup.manifest.workspaceSnapshot.ai.conversationCheckpoints).toEqual([]);
    expect(backup.manifest.workspaceSnapshot.ai.comparisonAnalyses).toEqual({});
  });

  test("backup chat full preserves messages, checkpoints, and compare analyses", () => {
    const workspace = createFixtureWorkspace({ includeMissingMetadata: false });
    const backup = createEditableProjectBackupManifest(workspace, { createdAt: NOW, chat: "full" });

    expect(backup.status).toBe("ok");
    if (backup.status !== "ok") {
      throw new Error("backup creation should be ready for assertions");
    }

    expect(backup.manifest.options.chat).toBe("full");
    expect(backup.manifest.workspaceSnapshot.ai.messages).toEqual(workspace.ai.messages);
    expect(backup.manifest.workspaceSnapshot.ai.conversationCheckpoints).toEqual(workspace.ai.conversationCheckpoints);
    expect(backup.manifest.workspaceSnapshot.ai.comparisonAnalyses).toEqual(workspace.ai.comparisonAnalyses);
  });

  test("backup default project continuity current preserves continuity state", () => {
    const workspace = createFixtureWorkspace({ includeMissingMetadata: false });
    const backup = createEditableProjectBackupManifest(workspace, { createdAt: NOW });

    expect(backup.status).toBe("ok");
    if (backup.status !== "ok") {
      throw new Error("backup creation should be ready for assertions");
    }

    expect(backup.manifest.options.projectContinuity).toBe("current");
    expect(backup.manifest.workspaceSnapshot.projectContinuity).toEqual(workspace.projectContinuity);
  });

  test("backup project continuity none keeps snapshot aligned with scope", () => {
    const workspace = createFixtureWorkspace({ includeMissingMetadata: false });
    const backup = createEditableProjectBackupManifest(workspace, { createdAt: NOW, projectContinuity: "none" });

    expect(backup.status).toBe("ok");
    if (backup.status !== "ok") {
      throw new Error("backup creation should be ready for assertions");
    }

    expect(backup.manifest.options.projectContinuity).toBe("none");
    expect(backup.manifest.workspaceSnapshot.projectContinuity.recordEntries).toEqual([]);
  });

  test("validates external manifests with readable structural diagnostics and rejects runtime-only fields", () => {
    const workspace = createFixtureWorkspace({ includeMissingMetadata: false });
    const archive = createHumanReadableArchiveManifest(workspace, { createdAt: NOW });
    const backup = createEditableProjectBackupManifest(workspace, { createdAt: NOW });
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

    expect(validateHumanReadableArchiveManifest({ ...archive.manifest, format: "wrong" }).status).toBe("failed");
    expect(validateEditableProjectBackupManifest({ ...backup.manifest, manifestVersion: "999" }).status).toBe("failed");
    expect(validateHumanReadableArchiveManifest({ ...archive.manifest, sourceProject: undefined }).status).toBe("failed");

    expect(
      validateEditableProjectBackupManifest({
        ...backup.manifest,
        workspaceSnapshot: {
          ...backup.manifest.workspaceSnapshot,
          assets: {
            ...backup.manifest.workspaceSnapshot.assets,
            "asset-image-visible": {
              ...backup.manifest.workspaceSnapshot.assets["asset-image-visible"],
              storageKey: "blob:leak"
            }
          }
        }
      }).diagnostics.some((diagnostic) => diagnostic.code === "runtime_storage_key_exposed")
    ).toBe(true);

    expect(
      validateEditableProjectBackupManifest({
        ...backup.manifest,
        assetInventory: {
          ...backup.manifest.assetInventory,
          entries: [
            {
              ...backup.manifest.assetInventory.entries[0],
              fileName: undefined
            }
          ]
        }
      }).diagnostics.some((diagnostic) => diagnostic.code === "invalid_asset_inventory_entry")
    ).toBe(true);

    expect(
      validateEditableProjectBackupManifest({
        ...backup.manifest,
        assetInventory: {
          ...backup.manifest.assetInventory,
          references: [
            {
              assetId: backup.manifest.assetInventory.references[0]?.assetId
            }
          ]
        }
      }).diagnostics.some((diagnostic) => diagnostic.code === "invalid_asset_inventory_reference")
    ).toBe(true);

    expect(
      validateEditableProjectBackupManifest({
        ...backup.manifest,
        assetInventory: {
          ...backup.manifest.assetInventory,
          entries: [
            {
              ...backup.manifest.assetInventory.entries[0],
              binaryStatus: "invalid"
            }
          ]
        }
      }).diagnostics.some((diagnostic) => diagnostic.code === "invalid_binary_status")
    ).toBe(true);

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
          entries: backup.manifest.assetInventory.entries.slice(1)
        }
      }).diagnostics.some((diagnostic) => diagnostic.code === "referenced_asset_missing_inventory_entry")
    ).toBe(true);

    expect(
      validateEditableProjectBackupManifest({
        ...backup.manifest,
        workspaceSnapshot: {
          ...backup.manifest.workspaceSnapshot,
          assets: {}
        }
      }).diagnostics.some((diagnostic) => diagnostic.code === "workspace_asset_inventory_mismatch")
    ).toBe(true);
  });
});

function createFixtureWorkspace(options: { includeMissingMetadata?: boolean } = {}): MorphoWorkspace {
  const workspace = createBlankWorkspace("project-m7-a");
  const includeMissingMetadata = options.includeMissingMetadata ?? true;
  const visibleImage = asset("asset-image-visible", "visible.png", "image/png", "originalImage", "blob:visible");
  const hiddenImage = asset("asset-image-hidden", "hidden.png", "image/png", "aiGeneratedImage", "blob:hidden");
  const originalFile = asset("asset-file-original", "course.pdf", "application/pdf", "originalFile", "blob:file");
  const extract = asset("asset-document-extract", "course.extract.json", "application/json", "documentExtract", "extract:file");
  const optionalExtract = asset("asset-missing-extract", "missing.extract.json", "application/json", "documentExtract", "extract:missing");
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
      ...(includeMissingMetadata ? {} : { [optionalExtract.id]: optionalExtract }),
      [link.id]: link,
      [snapshot.id]: snapshot,
      [unused.id]: unused
    },
    objects: {
      "image-visible": {
        id: "image-visible",
        type: "image",
        title: "Visible image",
        summary: "Current primary visual",
        createdBy: "user",
        visibility: "active",
        role: "primaryVisual",
        imageVariant: "path",
        assetId: visibleImage.id,
        directionId: "direction-primary",
        visualBranchId: "branch-primary",
        isDefaultReference: true
      },
      "image-hidden": {
        id: "image-hidden",
        type: "image",
        title: "Hidden image",
        summary: "Historical option",
        createdBy: "ai",
        visibility: "hidden",
        role: "preview",
        imageVariant: "rail",
        assetId: hiddenImage.id,
        directionId: "direction-primary",
        visualBranchId: "branch-primary"
      },
      "file-document": {
        id: "file-document",
        type: "file",
        title: "Course brief",
        summary: "Original PDF with parsed extract",
        createdBy: "user",
        visibility: "active",
        fileKind: "pdf",
        sourceLabel: "Import",
        assetId: originalFile.id,
        parseStatus: "parsed",
        extractedAssetId: extract.id
      },
      "fragment-course": {
        id: "fragment-course",
        type: "documentFragment",
        title: "Course fragment",
        summary: "Extracted text evidence",
        body: "Preserve the source location.",
        createdBy: "user",
        visibility: "active",
        source: {
          fileObjectId: "file-document",
          fileTitle: "Course brief",
          fileName: "course.pdf",
          sourceExtractAssetId: extract.id,
          startOffset: 0,
          endOffset: 28,
          blockIds: ["block-1"]
        }
      },
      "link-source": {
        id: "link-source",
        type: "link",
        title: "External source",
        summary: "Reference website",
        createdBy: "user",
        visibility: "active",
        url: "https://example.com",
        domain: "example.com",
        assetId: link.id
      },
      "text-note": {
        id: "text-note",
        type: "text",
        title: "Research note",
        summary: "Plain text source",
        createdBy: "user",
        visibility: "active",
        body: "Keep the material language warm and calm."
      },
      "research-market": {
        id: "research-market",
        type: "research",
        title: "Market research",
        summary: "Research summary",
        createdBy: "ai",
        visibility: "active",
        findings: ["Users prefer softer lighting."],
        opportunities: ["A calmer rail experience."],
        constraints: ["Must avoid a clinical feel."],
        openQuestions: ["How much ambient light is acceptable?"],
        evidence: [
          {
            claim: "Users prefer softer lighting.",
            sourceObjectIds: ["link-source", "file-document"],
            citationIds: ["citation-web"],
            confidence: "supported"
          }
        ],
        provenance: {
          operationId: "op-research-1",
          proposalId: "proposal-research-1",
          sourceObjectIds: ["link-source", "file-document"],
          citationIds: ["citation-web"],
          didUseWebSearch: true
        }
      },
      "key-conclusion-light": {
        id: "key-conclusion-light",
        type: "keyConclusion",
        title: "Soft light conclusion",
        summary: "Use soft light",
        body: "Use soft reflected light as the main emotional driver.",
        createdBy: "user",
        visibility: "active",
        state: "active",
        confidence: "supported",
        sourceObjectIds: ["research-market", "fragment-course"],
        citationIds: ["citation-web"],
        confirmedAt: NOW
      },
      "design-definition-main": {
        id: "design-definition-main",
        type: "designDefinition",
        title: "Definition main",
        summary: "Definition summary",
        createdBy: "user",
        visibility: "active",
        problem: "Help riders feel guided without feeling managed.",
        principles: ["Warm guidance"],
        avoid: ["Clinical interfaces"],
        currentRevisionId: "rev-definition-main",
        revisionIds: ["rev-definition-main"],
        isCurrentEffective: true
      },
      "direction-primary": {
        id: "direction-primary",
        type: "conceptDirection",
        title: "Direction Primary",
        summary: "Main direction",
        createdBy: "ai",
        visibility: "active",
        status: "primary",
        keywords: ["warm", "soft"],
        currentRevisionId: "rev-direction-primary",
        revisionIds: ["rev-direction-primary"],
        lineageRootId: "direction-primary"
      },
      "direction-eliminated": {
        id: "direction-eliminated",
        type: "conceptDirection",
        title: "Direction Eliminated",
        summary: "Should stay eliminated, not deleted",
        createdBy: "ai",
        visibility: "active",
        status: "eliminated",
        keywords: ["discarded"],
        currentRevisionId: "rev-direction-eliminated",
        revisionIds: ["rev-direction-eliminated"],
        lineageRootId: "direction-eliminated"
      },
      "delivery-main": {
        id: "delivery-main",
        type: "delivery",
        title: "Delivery package",
        summary: "Board draft",
        createdBy: "user",
        visibility: "active",
        format: "board",
        sections: [
          {
            id: "section-hero",
            title: "Hero",
            purpose: "Show the main board hero image",
            order: 0,
            referenceIds: ["ref-stable"],
            narrative: "Hero narrative",
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        gaps: [
          {
            id: "gap-missing-angle",
            label: "Need one more angle study",
            sectionId: "section-hero",
            status: "open",
            origin: "manual",
            createdAt: NOW,
            updatedAt: NOW
          }
        ],
        references: ["ref-stable"]
      }
    },
    citationSnapshots: {
      "citation-web": {
        id: "citation-web",
        operationId: "op-research-1",
        title: "Lighting reference",
        url: "https://example.com/lighting",
        domain: "example.com",
        snippet: "Soft reflected light reduces clinical perception.",
        retrievedAt: NOW
      }
    },
    designDefinitionRevisions: {
      "rev-definition-main": {
        id: "rev-definition-main",
        designDefinitionId: "design-definition-main",
        revisionNumber: 1,
        title: "Definition main",
        summary: "Definition summary",
        projectGoal: "Define a calm guidance system.",
        targetUsers: ["Night commuters"],
        primaryScenarios: ["Late transit"],
        coreProblem: "Guidance feels too clinical.",
        designPrinciples: ["Warm guidance"],
        constraints: ["Stay low-profile"],
        avoidDirections: ["Clinical interfaces"],
        opportunities: ["Ambient rails"],
        openQuestions: ["How much light is enough?"],
        sourceObjectIds: ["research-market", "fragment-course"],
        citationIds: ["citation-web"],
        createdAt: NOW,
        isCurrent: true
      }
    },
    directionRevisions: {
      "rev-direction-primary": {
        id: "rev-direction-primary",
        directionId: "direction-primary",
        revisionNumber: 1,
        title: "Direction Primary",
        summary: "Main direction summary",
        conceptStatement: "A warm rail with soft light cues.",
        keywords: ["warm", "soft"],
        strategy: "Guide through calm emphasis.",
        differentiators: ["Less clinical than panel UI"],
        visualSignals: ["Soft glow"],
        risks: ["May feel too subtle"],
        openQuestions: ["Can it remain visible outdoors?"],
        sourceObjectIds: ["design-definition-main", "research-market"],
        citationIds: ["citation-web"],
        createdAt: NOW,
        isCurrent: true
      },
      "rev-direction-eliminated": {
        id: "rev-direction-eliminated",
        directionId: "direction-eliminated",
        revisionNumber: 1,
        title: "Direction Eliminated",
        summary: "Keep the rejection rationale",
        conceptStatement: "A more clinical path",
        keywords: ["discarded"],
        strategy: "Not pursued",
        differentiators: [],
        visualSignals: [],
        risks: ["Conflicts with current definition"],
        openQuestions: [],
        sourceObjectIds: [],
        citationIds: [],
        createdAt: NOW,
        isCurrent: true
      }
    },
    visualBranches: {
      "branch-primary": {
        id: "branch-primary",
        directionId: "direction-primary",
        label: "Branch Primary",
        rootObjectId: "image-visible",
        createdAt: NOW
      }
    },
    relations: [
      {
        id: "rel-default-reference",
        kind: "defaultReference",
        fromObjectId: "image-visible",
        toObjectId: "direction-primary",
        note: "Default visual reference"
      },
      {
        id: "rel-belongs-visible",
        kind: "belongsToDirection",
        fromObjectId: "image-visible",
        toObjectId: "direction-primary",
        note: "Visible image belongs to direction"
      },
      {
        id: "rel-belongs-hidden",
        kind: "belongsToDirection",
        fromObjectId: "image-hidden",
        toObjectId: "direction-primary",
        note: "Hidden image belongs to direction"
      },
      {
        id: "rel-fragment-source",
        kind: "documentFragmentExtractedFromFile",
        fromObjectId: "fragment-course",
        toObjectId: "file-document",
        note: "Fragment extracted from file"
      }
    ],
    directionLineage: [
      {
        id: "lineage-1",
        kind: "derivedFromDirection",
        fromDirectionId: "direction-primary",
        toDirectionId: "direction-eliminated",
        createdAt: NOW,
        note: "Historical branch"
      }
    ],
    canvas: {
      view: { x: 10, y: 20, zoom: 0.75 },
      instances: [{ id: "instance-hidden", objectId: "image-hidden", position: { x: 1, y: 2 }, size: { w: 100, h: 100 } }]
    },
    deliveryReferences: {
      "ref-stable": {
        id: "ref-stable",
        deliveryObjectId: "delivery-main",
        sectionId: "section-hero",
        order: 0,
        sourceObjectId: "image-visible",
        sourceAssetId: visibleImage.id,
        createdAt: NOW,
        snapshot: {
          sourceType: "image",
          title: "Stable hero snapshot",
          summary: "Snapshot should not be recomputed from the live source.",
          sourceFile: {
            fileObjectId: "file-document",
            title: "Course brief",
            fileName: "course.pdf",
            sourceExtractAssetId: includeMissingMetadata ? "asset-missing-extract" : optionalExtract.id
          },
          previewAsset: {
            assetId: snapshot.id,
            alt: "Stable preview"
          }
        },
        editorial: {
          caption: "Caption draft",
          note: "Editorial note"
        }
      }
    },
    deliverySectionDrafts: {
      "draft-section-hero": {
        id: "draft-section-hero",
        deliveryObjectId: "delivery-main",
        sectionId: "section-hero",
        userMessageId: "msg-user",
        assistantMessageId: "msg-assistant",
        referenceIds: ["ref-stable"],
        sourceFingerprints: {
          "ref-stable": "fingerprint-1"
        },
        title: "Hero",
        narrative: "Drafted hero narrative",
        captions: [{ referenceId: "ref-stable", caption: "Draft caption" }],
        suggestedGaps: [{ label: "Need one more angle study" }],
        status: "pending",
        createdAt: NOW,
        updatedAt: NOW
      }
    },
    decisionRecords: [
      {
        id: "decision-eliminate",
        kind: "setDirectionStatus",
        createdAt: NOW,
        summary: "Eliminate the clinical branch",
        reason: "Conflicts with the current design definition",
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
          summary: "Do not continue the clinical branch",
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
        { id: "msg-user", role: "user", body: "Compare these directions", createdAt: NOW },
        {
          id: "msg-assistant",
          role: "assistant",
          body: "Keep the warmer route and drop the clinical branch",
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
          anchorObjectIds: ["direction-primary"],
          targetDirectionIds: ["direction-primary", "direction-eliminated"],
          sourceStartMessageId: "msg-user",
          sourceEndMessageId: "msg-assistant",
          sourceMessageCount: 2,
          createdAt: NOW,
          updatedAt: NOW,
          threadGoal: "Compare directions",
          progress: ["Eliminate the clinical branch"],
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

function createBlockedBackupLikeManifest(workspace: MorphoWorkspace, createdAt: string) {
  const inventory = collectWorkspaceAssetInventory(workspace);
  const sanitized = sanitizeWorkspaceForEditableBackup(workspace, { chat: "none", projectContinuity: "current" });

  return {
    format: "morpho-editable-project-backup" as const,
    manifestVersion: "1" as const,
    createdAt,
    sourceProject: {
      id: workspace.project.id,
      title: workspace.project.title,
      subtitle: workspace.project.subtitle,
      createdAt: workspace.project.createdAt,
      updatedAt: workspace.project.updatedAt,
      lastOpenedAt: workspace.project.lastOpenedAt
    },
    workspaceSchemaVersion: workspace.schemaVersion,
    options: {
      chat: "none" as const,
      projectContinuity: "current" as const,
      restoreContract: {
        restoresAsNewProjectCopy: true as const,
        mustRemapProjectId: true as const,
        mustRegenerateRuntimeStorageKeys: true as const,
        mustRemapAssetIdsIfChanged: true as const,
        neverMergeByDefault: true as const
      }
    },
    assetInventory: inventory,
    integrity: {
      diagnostics: inventory.diagnostics
    },
    workspaceSnapshot: sanitized
  };
}
