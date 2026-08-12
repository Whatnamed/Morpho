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

  test("renders structured archive markdown as readable handoff documents", () => {
    const manifest = createArchiveManifest(createBundleFixtureWorkspace());
    const bundle = createHumanReadableArchiveBundle(manifest, [
      resolvedAsset(manifest, "asset-cover", "embedded", "cover-bytes"),
      resolvedAsset(manifest, "asset-link", "referenceOnly"),
      resolvedAsset(manifest, "asset-brief", "missingRequiredBinary")
    ]);

    expect(readBundleText(bundle, "project-overview.md")).toContain("Keep riders oriented with a warm navigation cue");
    expect(readBundleText(bundle, "project-overview.md")).toContain("Warmer low glare lighting improves perceived safety");
    expect(readBundleText(bundle, "project-overview.md")).toContain("类别：发现");
    expect(readBundleText(bundle, "project-overview.md")).toContain("Sheltered Beacon");
    expect(readBundleText(bundle, "project-overview.md")).toContain("Cold Tech Plinth");
    expect(readBundleText(bundle, "project-overview.md")).toContain("Default Night Reference");
    expect(readBundleText(bundle, "research-and-sources.md")).toContain("Transit riders avoid dark curb zones");
    expect(readBundleText(bundle, "research-and-sources.md")).toContain("https://example.com/night-study");
    expect(readBundleText(bundle, "research-and-sources.md")).toContain("Observed route choice after sunset");
    expect(readBundleText(bundle, "directions-and-visuals.md")).toContain("branch-main");
    expect(readBundleText(bundle, "directions-and-visuals.md")).toContain("defaultReference");
    expect(readBundleText(bundle, "directions-and-visuals.md")).toContain("belongsToDirection");
    expect(readBundleText(bundle, "decisions-and-process.md")).toContain("Selected Sheltered Beacon as primary");
    expect(readBundleText(bundle, "decisions-and-process.md")).toContain("comparison-1");
    expect(readBundleText(bundle, "decisions-and-process.md")).toContain("definition-revision-1");
    expect(readBundleText(bundle, "delivery-preparation.md")).toContain("Hero story");
    expect(readBundleText(bundle, "delivery-preparation.md")).toContain("Explain the rider journey from approach to boarding.");
    expect(readBundleText(bundle, "delivery-preparation.md")).toContain("Draft narrative for the hero section.");
    expect(readBundleText(bundle, "asset-index.md")).toContain("objects.image-default.assetId");
    expect(readBundleText(bundle, "asset-index.md")).toContain("embedded");
    expect(readBundleText(bundle, "asset-index.md")).toContain("missingRequiredBinary");
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
    expect(plan.workspace.operations["operation-research"]?.projectId).toBe("project-restored");
    expect(plan.workspace.objects["conclusion-safety"]).toMatchObject({ category: "finding" });
    expect(plan.assetWrites.map((item) => item.assetId).sort()).toEqual(["asset-brief", "asset-cover"]);
    expect(new TextDecoder().decode(plan.assetWrites[0]?.bytes ?? new Uint8Array())).not.toHaveLength(0);

    const legacySnapshot = structuredClone(backupManifest.workspaceSnapshot);
    legacySnapshot.schemaVersion = 15 as MorphoWorkspace["schemaVersion"];
    const legacyConclusion = legacySnapshot.objects["conclusion-safety"];
    if (!legacyConclusion || legacyConclusion.type !== "keyConclusion") {
      throw new Error("Expected the backup fixture to include a key conclusion.");
    }
    const legacyResearch = legacySnapshot.objects["research-night"];
    if (!legacyResearch || legacyResearch.type !== "research") {
      throw new Error("Expected the backup fixture to include its research source.");
    }
    const { category: _legacyCategory, ...legacyConclusionWithoutCategory } = legacyConclusion;
    legacySnapshot.objects["conclusion-safety"] = {
      ...legacyConclusionWithoutCategory,
      body: legacyResearch.findings[0],
      summary: legacyResearch.findings[0]
    } as typeof legacyConclusion;
    const legacyManifest = {
      ...backupManifest,
      workspaceSchemaVersion: 15 as MorphoWorkspace["schemaVersion"],
      workspaceSnapshot: legacySnapshot
    } as EditableProjectBackupManifest;
    const legacyPlan = planEditableProjectBackupRestore(legacyManifest, mapBundleFiles(bundleResult.bundle), {
      restoredAt: NOW,
      projectId: "project-restored-legacy",
      projectTitle: "Night Study（旧备份恢复）",
      createRuntimeStorageKey: (assetId) => `blob:restored:legacy:${assetId}`
    });

    expect(legacyPlan.status).toBe("ok");
    if (legacyPlan.status === "ok") {
      expect(legacyPlan.workspace.schemaVersion).toBe(17);
      expect(legacyPlan.workspace.objects["conclusion-safety"]).toMatchObject({ category: "finding" });
    }

    const legacyConversationManifest = JSON.parse(JSON.stringify(backupManifest)) as EditableProjectBackupManifest;
    Object.assign(legacyConversationManifest, { workspaceSchemaVersion: 16 });
    const legacyConversationSnapshot = legacyConversationManifest.workspaceSnapshot;
    Object.assign(legacyConversationSnapshot, { schemaVersion: 16 });
    const legacyConversationAi = legacyConversationSnapshot.ai;
    Object.assign(legacyConversationAi, {
      messages: [
        {
          id: "legacy-user",
          role: "user",
          body: "继续验证夜间路径。",
          createdAt: NOW,
          status: "done",
          conversationLaneKey: "legacy-lane",
          pairedMessageId: "legacy-assistant"
        },
        {
          id: "legacy-assistant",
          role: "assistant",
          body: "路径连续性仍然成立。",
          createdAt: NOW,
          status: "done",
          conversationLaneKey: "legacy-lane",
          conversationCheckpointId: "legacy-checkpoint",
          pairedMessageId: "legacy-user"
        }
      ],
      conversationCheckpoints: [{
        id: "legacy-checkpoint",
        laneKey: "legacy-lane",
        focusArea: "directionAndVisual",
        focusUpdatedAt: NOW,
        taskKind: "general",
        anchorObjectIds: ["image-default"],
        targetDirectionIds: ["direction-current"],
        sourceStartMessageId: "legacy-user",
        sourceEndMessageId: "legacy-assistant",
        sourceMessageCount: 2,
        createdAt: NOW,
        updatedAt: NOW,
        threadGoal: "继续验证夜间路径",
        progress: ["路径连续性已经确认。"],
        openThreads: ["还需确认维护方式。"]
      }],
      conversationCompaction: { coveredMessageCount: 0 },
      conversationSummaryRevisions: {}
    });
    Object.assign(legacyConversationSnapshot.objects["image-default"], { imageVariant: "path" });
    const restoredLegacyConversation = planEditableProjectBackupRestore(
      legacyConversationManifest,
      mapBundleFiles(bundleResult.bundle),
      {
        restoredAt: NOW,
        projectId: "project-restored-conversation-legacy",
        projectTitle: "Night Study（旧会话恢复）",
        createRuntimeStorageKey: (assetId) => `blob:restored:conversation:${assetId}`
      }
    );

    expect(restoredLegacyConversation.status).toBe("ok");
    if (restoredLegacyConversation.status === "ok") {
      expect(restoredLegacyConversation.workspace.schemaVersion).toBe(17);
      expect(restoredLegacyConversation.workspace.ai).not.toHaveProperty("conversationCheckpoints");
      expect(Object.keys(restoredLegacyConversation.workspace.ai.conversationSummaryRevisions)).toHaveLength(1);
      expect(restoredLegacyConversation.workspace.ai.conversationCompaction.summaryRevisionId).toBeDefined();
      expect(restoredLegacyConversation.workspace.ai.messages[0]).not.toHaveProperty("conversationLaneKey");
      expect(restoredLegacyConversation.workspace.ai.messages[1]).not.toHaveProperty("conversationCheckpointId");
      expect(restoredLegacyConversation.workspace.objects["image-default"]).not.toHaveProperty("imageVariant");
    }
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
  const designDefinition = {
    id: "definition-current",
    type: "designDefinition" as const,
    title: "Night mobility definition",
    summary: "Keep riders oriented with a warm navigation cue",
    problem: "Night riders need confidence at curbside pickup points.",
    principles: ["Warm low glare guidance", "Readable from across the street"],
    avoid: ["Cold tactical styling"],
    currentRevisionId: "definition-revision-1",
    revisionIds: ["definition-revision-1"],
    isCurrentEffective: true,
    createdBy: "ai" as const,
    visibility: "active" as const,
    createdAt: NOW,
    updatedAt: NOW
  };
  const keyConclusion = {
    id: "conclusion-safety",
    type: "keyConclusion" as const,
    title: "Warm light supports safety",
    summary: "Warmer low glare lighting improves perceived safety",
    body: "Riders report better orientation when the stop edge has a warmer visual anchor.",
    category: "finding" as const,
    state: "active" as const,
    confidence: "supported" as const,
    sourceObjectIds: ["research-night"],
    citationIds: ["citation-night"],
    confirmedAt: NOW,
    createdBy: "ai" as const,
    visibility: "active" as const,
    createdAt: NOW,
    updatedAt: NOW
  };
  const research = {
    id: "research-night",
    type: "research" as const,
    title: "Night curb behavior",
    summary: "Transit riders avoid dark curb zones",
    findings: ["Riders cluster near lit edges."],
    opportunities: ["Use a warmer vertical marker."],
    constraints: ["Avoid glare toward traffic."],
    openQuestions: ["Confirm mounting height."],
    evidence: [
      {
        claim: "Transit riders avoid dark curb zones",
        sourceObjectIds: ["link-night-study"],
        citationIds: ["citation-night"],
        confidence: "supported" as const
      }
    ],
    provenance: {
      operationId: "operation-research",
      proposalId: "proposal-research",
      sourceObjectIds: ["link-night-study"],
      citationIds: ["citation-night"],
      didUseWebSearch: true
    },
    createdBy: "ai" as const,
    visibility: "active" as const,
    createdAt: NOW,
    updatedAt: NOW
  };
  const linkSource = {
    id: "link-night-study",
    type: "link" as const,
    title: "Night study source",
    editableTitle: "Night study source",
    summary: "Observed route choice after sunset",
    description: "Source notes on nighttime curb behavior.",
    url: "https://example.com/night-study",
    domain: "example.com",
    assetId: linkAsset.id,
    createdBy: "user" as const,
    visibility: "active" as const,
    createdAt: NOW,
    updatedAt: NOW
  };
  const activeDirection = {
    id: "direction-sheltered",
    type: "conceptDirection" as const,
    title: "Sheltered Beacon",
    summary: "A warm vertical marker paired with a quiet shelter edge.",
    status: "primary" as const,
    keywords: ["warm", "sheltered"],
    currentRevisionId: "direction-revision-1",
    revisionIds: ["direction-revision-1"],
    lineageRootId: "direction-sheltered",
    createdBy: "ai" as const,
    visibility: "active" as const,
    createdAt: NOW,
    updatedAt: NOW
  };
  const eliminatedDirection = {
    id: "direction-cold",
    type: "conceptDirection" as const,
    title: "Cold Tech Plinth",
    summary: "A colder technical plinth that feels too tactical.",
    status: "eliminated" as const,
    keywords: ["cold", "technical"],
    currentRevisionId: "direction-revision-cold",
    revisionIds: ["direction-revision-cold"],
    lineageRootId: "direction-cold",
    createdBy: "ai" as const,
    visibility: "active" as const,
    createdAt: NOW,
    updatedAt: NOW
  };
  const defaultImage = {
    id: "image-default",
    type: "image" as const,
    title: "Default Night Reference",
    summary: "Warm beacon preview for the primary direction.",
    role: "conceptImage" as const,
    assetId: coverAsset.id,
    directionId: activeDirection.id,
    visualBranchId: "branch-main",
    isDefaultReference: true,
    createdBy: "ai" as const,
    visibility: "active" as const,
    createdAt: NOW,
    updatedAt: NOW
  };
  const delivery = {
    id: "delivery-board",
    type: "delivery" as const,
    title: "Night handoff board",
    summary: "Board package for the night curb concept.",
    format: "board" as const,
    sections: [
      {
        id: "section-hero",
        title: "Hero story",
        purpose: "Explain the rider journey from approach to boarding.",
        order: 1,
        referenceIds: ["delivery-ref-image"],
        narrative: "The hero section opens with the warm marker as a calm waypoint.",
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    gaps: [
      {
        id: "gap-install",
        label: "Add installation context",
        sectionId: "section-hero",
        status: "open" as const,
        origin: "manual" as const,
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    references: ["delivery-ref-image"],
    createdBy: "user" as const,
    visibility: "active" as const,
    createdAt: NOW,
    updatedAt: NOW
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
    objects: {
      [designDefinition.id]: designDefinition,
      [keyConclusion.id]: keyConclusion,
      [research.id]: research,
      [linkSource.id]: linkSource,
      [activeDirection.id]: activeDirection,
      [eliminatedDirection.id]: eliminatedDirection,
      [defaultImage.id]: defaultImage,
      [delivery.id]: delivery
    },
    relations: [
      {
        id: "relation-image-direction",
        kind: "belongsToDirection",
        fromObjectId: defaultImage.id,
        toObjectId: activeDirection.id,
        note: "Primary direction image."
      },
      {
        id: "relation-default-reference",
        kind: "defaultReference",
        fromObjectId: defaultImage.id,
        toObjectId: activeDirection.id,
        note: "Current default reference."
      }
    ],
    deliveryReferences: {
      "delivery-ref-image": {
        id: "delivery-ref-image",
        deliveryObjectId: delivery.id,
        sectionId: "section-hero",
        order: 1,
        sourceObjectId: defaultImage.id,
        createdAt: NOW,
        updatedAt: NOW,
        snapshot: {
          sourceType: "image",
          title: "Default Night Reference",
          summary: "Warm beacon preview for the primary direction.",
          previewAsset: {
            assetId: coverAsset.id,
            alt: "Warm beacon at a night curb."
          }
        },
        sourceAssetId: coverAsset.id,
        editorial: {
          caption: "Warm beacon as the main waypoint.",
          note: "Use as opening visual."
        }
      }
    },
    deliverySectionDrafts: {
      "draft-hero": {
        id: "draft-hero",
        deliveryObjectId: delivery.id,
        sectionId: "section-hero",
        userMessageId: "msg-1",
        assistantMessageId: "msg-2",
        referenceIds: ["delivery-ref-image"],
        sourceFingerprints: {
          "delivery-ref-image": "fingerprint-1"
        },
        title: "Hero story",
        narrative: "Draft narrative for the hero section.",
        captions: [
          {
            referenceId: "delivery-ref-image",
            caption: "Caption draft for the warm beacon."
          }
        ],
        suggestedGaps: [
          {
            label: "Add nighttime installation detail."
          }
        ],
        status: "pending",
        createdAt: NOW,
        updatedAt: NOW
      }
    },
    decisionRecords: [
      {
        id: "decision-primary",
        kind: "setDirectionStatus",
        createdAt: NOW,
        summary: "Selected Sheltered Beacon as primary",
        reason: "It better supports calm nighttime orientation.",
        objectSnapshot: {
          id: activeDirection.id,
          type: "conceptDirection",
          title: activeDirection.title
        },
        relatedObjectIds: [eliminatedDirection.id],
        comparison: {
          comparisonAnalysisId: "comparison-1",
          comparisonAssistantMessageId: "msg-2",
          comparisonSourceObjectIds: [activeDirection.id, eliminatedDirection.id],
          userReason: "Choose the calmer route."
        }
      }
    ],
    operations: {
      "operation-research": {
        id: "operation-research",
        type: "research",
        projectId: workspace.project.id,
        createdAt: NOW,
        updatedAt: NOW,
        status: "succeeded",
        userInput: "Review the night mobility evidence.",
        inputSnapshot: {
          userInput: "Review the night mobility evidence.",
          selectedObjectIds: [research.id],
          sourceSnapshots: [],
          objectSnapshots: []
        },
        allowedCapabilities: { webSearch: true, imagePixels: false },
        steps: [],
        events: [],
        sourceIds: [research.id],
        proposalIds: [],
        retryable: false
      }
    },
    citationSnapshots: {
      "citation-night": {
        id: "citation-night",
        operationId: "operation-research",
        title: "Night mobility observations",
        url: "https://example.com/night-study",
        domain: "example.com",
        snippet: "Observed route choice after sunset",
        retrievedAt: NOW
      }
    },
    designDefinitionRevisions: {
      "definition-revision-1": {
        id: "definition-revision-1",
        designDefinitionId: designDefinition.id,
        revisionNumber: 1,
        title: "Night mobility definition",
        summary: "Keep riders oriented with a warm navigation cue",
        projectGoal: "Improve night curb pickup confidence.",
        targetUsers: ["Night commuters"],
        primaryScenarios: ["Curbside pickup after sunset"],
        coreProblem: "Dark stops make riders uncertain where to wait.",
        designPrinciples: ["Warm low glare guidance"],
        constraints: ["Avoid traffic glare"],
        avoidDirections: ["Cold tactical styling"],
        opportunities: ["Make the waiting edge visible"],
        openQuestions: ["Mounting height"],
        sourceObjectIds: [research.id],
        citationIds: ["citation-night"],
        createdAt: NOW,
        changeNote: "Initial accepted definition.",
        isCurrent: true
      }
    },
    directionRevisions: {
      "direction-revision-1": {
        id: "direction-revision-1",
        directionId: activeDirection.id,
        revisionNumber: 1,
        title: "Sheltered Beacon",
        summary: "A warm vertical marker paired with a quiet shelter edge.",
        conceptStatement: "A calm beacon makes the curb legible without becoming tactical.",
        keywords: ["warm", "sheltered"],
        strategy: "Use vertical warmth and a quiet canopy.",
        differentiators: ["Soft waypoint", "Low glare"],
        visualSignals: ["Warm vertical lens"],
        risks: ["May need installation proof"],
        openQuestions: ["Material durability"],
        sourceObjectIds: [designDefinition.id],
        citationIds: ["citation-night"],
        basedOnDefinitionRevisionId: "definition-revision-1",
        createdAt: NOW,
        changeNote: "Initial primary direction.",
        isCurrent: true
      },
      "direction-revision-cold": {
        id: "direction-revision-cold",
        directionId: eliminatedDirection.id,
        revisionNumber: 1,
        title: "Cold Tech Plinth",
        summary: "A colder technical plinth that feels too tactical.",
        conceptStatement: "A technical plinth marks the stop.",
        keywords: ["cold", "technical"],
        strategy: "Use a precise plinth.",
        differentiators: ["Sharp silhouette"],
        visualSignals: ["Blue edge light"],
        risks: ["Too tactical"],
        openQuestions: ["User comfort"],
        sourceObjectIds: [designDefinition.id],
        citationIds: [],
        basedOnDefinitionRevisionId: "definition-revision-1",
        createdAt: NOW,
        isCurrent: true
      }
    },
    directionLineage: [
      {
        id: "lineage-cold-to-sheltered",
        kind: "supersedesDirection",
        fromDirectionId: eliminatedDirection.id,
        toDirectionId: activeDirection.id,
        createdAt: NOW,
        note: "Sheltered Beacon supersedes the colder plinth route."
      }
    ],
    visualBranches: {
      "branch-main": {
        id: "branch-main",
        directionId: activeDirection.id,
        label: "Warm waypoint branch",
        rootObjectId: defaultImage.id,
        createdAt: NOW
      }
    },
    workingState: {
      ...workspace.workingState,
      currentDesignDefinitionId: designDefinition.id,
      currentDesignDefinitionAvailability: "available",
      primaryDirectionId: activeDirection.id,
      alternativeDirectionIds: [],
      eliminatedDirectionIds: [eliminatedDirection.id],
      activeKeyConclusionIds: [keyConclusion.id],
      currentDefaultReferenceId: defaultImage.id,
      directionReferenceIds: {
        [activeDirection.id]: [defaultImage.id]
      },
      recentResearchObjectIds: [research.id]
    },
    ai: {
      ...workspace.ai,
      messages: [
        { id: "msg-1", role: "user", body: "Keep the warmer direction.", createdAt: NOW },
        { id: "msg-2", role: "assistant", body: "Recorded for the project.", createdAt: NOW }
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
