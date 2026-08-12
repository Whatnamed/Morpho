import { describe, expect, it } from "vitest";

import { createBlankWorkspace, createInitialWorkspace, migrateWorkspaceToCurrentSchema } from "./workspace";
import { validateCurrentMorphoWorkspace } from "./currentWorkspaceValidation";
import type { MorphoObject, MorphoWorkspace } from "./types";

describe("current workspace deep validation", () => {
  it("accepts canonical blank and initial workspaces", () => {
    const blank = validateCurrentMorphoWorkspace(createBlankWorkspace("project-validation"));
    const initial = validateCurrentMorphoWorkspace(createInitialWorkspace());

    expect(blank).toMatchObject({ status: "ok" });
    if (initial.status === "failed") {
      throw new Error(JSON.stringify(initial.issues, null, 2));
    }
    expect(initial).toMatchObject({ status: "ok" });
  });

  it("rejects malformed nested object containers and record key/id mismatches", () => {
    const malformed = structuredClone(createInitialWorkspace()) as unknown as Record<string, unknown>;
    malformed.objects = [];
    expect(validateCurrentMorphoWorkspace(malformed)).toMatchObject({
      status: "failed",
      issues: expect.arrayContaining([expect.objectContaining({ path: "objects" })])
    });

    const mismatched = structuredClone(createInitialWorkspace());
    const [objectId, object] = Object.entries(mismatched.objects)[0] ?? [];
    if (!objectId || !object) throw new Error("Expected an initial object fixture.");
    mismatched.objects[objectId] = { ...object, id: "different-object-id" };
    expect(validateCurrentMorphoWorkspace(mismatched)).toMatchObject({
      status: "failed",
      issues: expect.arrayContaining([expect.objectContaining({ path: `objects.${objectId}.id` })])
    });
  });

  it("rejects dangling critical references and non-finite infinite-canvas geometry", () => {
    const dangling = structuredClone(createInitialWorkspace());
    dangling.canvas.instances.push({
      id: "canvas-missing",
      objectId: "missing-object",
      position: { x: 0, y: 0 },
      size: { w: 100, h: 100 }
    });
    expect(validateCurrentMorphoWorkspace(dangling)).toMatchObject({
      status: "failed",
      issues: expect.arrayContaining([expect.objectContaining({
        path: expect.stringMatching(/canvas\.instances\.\d+\.objectId/)
      })])
    });

    const invalidGeometry = structuredClone(createInitialWorkspace());
    invalidGeometry.canvas.view.x = Number.POSITIVE_INFINITY;
    expect(validateCurrentMorphoWorkspace(invalidGeometry)).toMatchObject({
      status: "failed",
      issues: expect.arrayContaining([expect.objectContaining({ path: "canvas.view.x" })])
    });

    const largeCoordinates = structuredClone(createInitialWorkspace());
    largeCoordinates.canvas.view.x = 1e100;
    largeCoordinates.canvas.view.y = -1e100;
    expect(validateCurrentMorphoWorkspace(largeCoordinates)).toMatchObject({ status: "ok" });
  });

  it("rejects missing current revisions but preserves stable delivery snapshots with missing sources", () => {
    const missingRevision = structuredClone(createInitialWorkspace());
    const definition = Object.values(missingRevision.objects).find((object) => object.type === "designDefinition");
    if (!definition || definition.type !== "designDefinition") throw new Error("Expected a design definition fixture.");
    definition.currentRevisionId = "missing-definition-revision";
    expect(validateCurrentMorphoWorkspace(missingRevision)).toMatchObject({
      status: "failed",
      issues: expect.arrayContaining([expect.objectContaining({
        path: `objects.${definition.id}.currentRevisionId`
      })])
    });

    const stableSnapshot = createBlankWorkspace("project-stable-delivery");
    stableSnapshot.objects.delivery = {
      id: "delivery",
      type: "delivery",
      title: "交付",
      summary: "稳定交付快照",
      createdBy: "user",
      visibility: "active",
      format: "board",
      sections: [{
        id: "hero",
        title: "Hero",
        order: 1,
        referenceIds: ["delivery-ref"],
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z"
      }],
      gaps: [],
      references: ["delivery-ref"]
    };
    stableSnapshot.deliveryReferences["delivery-ref"] = {
      id: "delivery-ref",
      deliveryObjectId: "delivery",
      sectionId: "hero",
      sourceObjectId: "deleted-source",
      sourceAssetId: "deleted-asset",
      createdAt: "2026-08-12T00:00:00.000Z",
      snapshot: { sourceType: "image", title: "冻结的交付素材" }
    };
    expect(validateCurrentMorphoWorkspace(stableSnapshot)).toMatchObject({ status: "ok" });
  });

  it("rejects inconsistent current availability and default-reference projections", () => {
    const workspace = structuredClone(createInitialWorkspace());
    const definition = Object.values(workspace.objects).find((object) => object.type === "designDefinition");
    if (!definition || definition.type !== "designDefinition") throw new Error("Expected a design definition fixture.");
    definition.visibility = "hidden";
    expect(validateCurrentMorphoWorkspace(workspace)).toMatchObject({
      status: "failed",
      issues: expect.arrayContaining([expect.objectContaining({ path: "workingState.currentDesignDefinitionAvailability" })])
    });

    const defaults = structuredClone(createInitialWorkspace());
    const defaultImage = Object.values(defaults.objects).find((object) => object.type === "image" && object.isDefaultReference);
    if (!defaultImage || defaultImage.type !== "image") throw new Error("Expected a default-reference fixture.");
    defaults.objects["duplicate-default"] = {
      ...defaultImage,
      id: "duplicate-default",
      title: "Duplicate default"
    };
    expect(validateCurrentMorphoWorkspace(defaults)).toMatchObject({
      status: "failed",
      issues: expect.arrayContaining([expect.objectContaining({ path: "objects" })])
    });
  });

  it("rejects an operation bound to a different project", () => {
    const workspace = createBlankWorkspace("project-operation-owner");
    workspace.operations["operation-owner"] = {
      id: "operation-owner",
      type: "research",
      projectId: "project-other",
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      status: "succeeded",
      userInput: "Review the project.",
      inputSnapshot: {
        userInput: "Review the project.",
        selectedObjectIds: [],
        sourceSnapshots: [],
        objectSnapshots: []
      },
      allowedCapabilities: { webSearch: false, imagePixels: false },
      steps: [],
      events: [],
      sourceIds: [],
      proposalIds: [],
      retryable: false
    };

    expect(validateCurrentMorphoWorkspace(workspace)).toMatchObject({
      status: "failed",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "operations.operation-owner.projectId" })
      ])
    });
  });

  it("preserves structurally valid revision and proposal history after source objects are deleted", () => {
    const workspace = createBlankWorkspace("project-history");
    workspace.designDefinitionRevisions["historical-definition-revision"] = {
      id: "historical-definition-revision",
      designDefinitionId: "deleted-definition",
      revisionNumber: 1,
      title: "Deleted definition snapshot",
      summary: "Historical revision remains available for traceability.",
      projectGoal: "Preserve history.",
      targetUsers: [],
      primaryScenarios: [],
      coreProblem: "The live object was deleted.",
      designPrinciples: [],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      sourceObjectIds: [],
      citationIds: [],
      createdAt: "2026-08-12T00:00:00.000Z",
      isCurrent: false
    };
    workspace.artifactProposals["historical-proposal"] = {
      id: "historical-proposal",
      type: "designDefinition",
      status: "applied",
      sourceSnapshots: [],
      sourceObjectIds: [],
      citationIds: [],
      createdAt: "2026-08-12T00:00:00.000Z",
      title: "Applied historical proposal",
      summary: "Its original base may have been deleted.",
      projectGoal: "Preserve proposal history.",
      targetUsers: [],
      primaryScenarios: [],
      coreProblem: "Historical data should remain readable.",
      designPrinciples: [],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      basedOnDesignDefinitionId: "deleted-definition"
    };

    expect(validateCurrentMorphoWorkspace(workspace)).toMatchObject({ status: "ok" });
  });

  it("requires the variant contract for every Morpho object type", () => {
    const control = createObjectContractWorkspace();
    expect(validateCurrentMorphoWorkspace(control)).toMatchObject({ status: "ok" });

    for (const [type, requiredFields] of Object.entries(REQUIRED_VARIANT_FIELDS_BY_TYPE)) {
      for (const requiredField of [...REQUIRED_OBJECT_BASE_FIELDS, ...requiredFields]) {
        const damaged = structuredClone(control);
        const objectId = OBJECT_ID_BY_TYPE[type as MorphoObject["type"]];
        const object = damaged.objects[objectId] as unknown as Record<string, unknown>;
        delete object[requiredField];

        expect(validateCurrentMorphoWorkspace(damaged), `${type}.${requiredField}`).toMatchObject({
          status: "failed",
          issues: expect.arrayContaining([
            expect.objectContaining({ path: `objects.${objectId}.${requiredField}` })
          ])
        });
      }
    }
  });

  it("rejects incomplete delivery sections, delivery gaps, and key-conclusion confidence", () => {
    const cases: Array<{
      path: string;
      damage: (workspace: MorphoWorkspace) => void;
    }> = [
      {
        path: "objects.delivery.sections.0.createdAt",
        damage: (workspace) => {
          delete (workspace.objects.delivery as unknown as { sections: Array<Record<string, unknown>> }).sections[0]?.createdAt;
        }
      },
      {
        path: "objects.delivery.gaps.0.label",
        damage: (workspace) => {
          delete (workspace.objects.delivery as unknown as { gaps: Array<Record<string, unknown>> }).gaps[0]?.label;
        }
      },
      {
        path: "objects.conclusion.confidence",
        damage: (workspace) => {
          delete (workspace.objects.conclusion as unknown as Record<string, unknown>).confidence;
        }
      }
    ];

    for (const testCase of cases) {
      const damaged = structuredClone(createObjectContractWorkspace());
      testCase.damage(damaged);
      expect(validateCurrentMorphoWorkspace(damaged), testCase.path).toMatchObject({
        status: "failed",
        issues: expect.arrayContaining([expect.objectContaining({ path: testCase.path })])
      });
    }
  });

  it("rejects malformed optional nested object metadata when present", () => {
    const cases: Array<{
      path: string;
      damage: (workspace: MorphoWorkspace) => void;
    }> = [
      {
        path: "objects.image.pendingReview.newDefaultReferenceId",
        damage: (workspace) => {
          (workspace.objects.image as unknown as Record<string, unknown>).pendingReview = {
            reason: "defaultReferenceReplaced"
          };
        }
      },
      {
        path: "objects.image.generation.referenceResolution.candidates.0.included",
        damage: (workspace) => {
          const image = workspace.objects.image;
          if (image.type !== "image" || !image.generation?.referenceResolution) throw new Error("Expected image metadata fixture.");
          delete (image.generation.referenceResolution.candidates[0] as unknown as Record<string, unknown>).included;
        }
      },
      {
        path: "objects.research.evidence.0.confidence",
        damage: (workspace) => {
          const research = workspace.objects.research;
          if (research.type !== "research" || !research.evidence?.[0]) throw new Error("Expected research evidence fixture.");
          delete (research.evidence[0] as unknown as Record<string, unknown>).confidence;
        }
      },
      {
        path: "objects.research.provenance.didUseWebSearch",
        damage: (workspace) => {
          const research = workspace.objects.research;
          if (research.type !== "research" || !research.provenance) throw new Error("Expected research provenance fixture.");
          delete (research.provenance as unknown as Record<string, unknown>).didUseWebSearch;
        }
      },
      {
        path: "objects.file.parsedAt",
        damage: (workspace) => {
          (workspace.objects.file as unknown as Record<string, unknown>).parsedAt = 42;
        }
      },
      {
        path: "objects.proposal.proposalType",
        damage: (workspace) => {
          (workspace.objects.proposal as unknown as Record<string, unknown>).proposalType = "unknownProposal";
        }
      }
    ];

    for (const testCase of cases) {
      const damaged = structuredClone(createObjectContractWorkspace());
      testCase.damage(damaged);
      expect(validateCurrentMorphoWorkspace(damaged), testCase.path).toMatchObject({
        status: "failed",
        issues: expect.arrayContaining([expect.objectContaining({ path: testCase.path })])
      });
    }
  });

  it("validates required and discriminated fields across the persisted workspace contract", () => {
    const cases: Array<{
      path: string;
      damage: (workspace: MorphoWorkspace) => void;
    }> = [
      {
        path: "artifactProposals.proposal.items",
        damage: (workspace) => {
          delete (workspace.artifactProposals.proposal as unknown as Record<string, unknown>).items;
        }
      },
      {
        path: "operations.operation.inputSnapshot.objectSnapshots",
        damage: (workspace) => {
          delete (workspace.operations.operation.inputSnapshot as unknown as Record<string, unknown>).objectSnapshots;
        }
      },
      {
        path: "deliveryReferences.reference.snapshot.sourceType",
        damage: (workspace) => {
          workspace.deliveryReferences.reference = {
            id: "reference",
            createdAt: "2026-08-12T00:00:00.000Z",
            snapshot: { sourceType: "image", title: "Stable snapshot" }
          };
          delete (workspace.deliveryReferences.reference.snapshot as unknown as Record<string, unknown>).sourceType;
        }
      },
      {
        path: "projectContinuity.recordEntries.0.semanticKind",
        damage: (workspace) => {
          workspace.projectContinuity.recordEntries.push({
            id: "continuity",
            dedupeKey: "continuity",
            origin: "conversationSemanticPatch",
            manualState: "active",
            stage: "research",
            category: "preference",
            summary: "Preference",
            sourceRefs: [],
            createdAt: "2026-08-12T00:00:00.000Z",
            updatedAt: "2026-08-12T00:00:00.000Z",
            validity: "current",
            semanticKind: "preference"
          });
          (workspace.projectContinuity.recordEntries[0] as unknown as Record<string, unknown>).semanticKind = "invalidSemanticKind";
        }
      },
      {
        path: "projectMemory.revisions.memory.basis",
        damage: (workspace) => {
          workspace.projectMemory.revisions.memory = {
            id: "memory",
            documentKey: "projectOverview",
            sections: [],
            sourceRefs: [],
            basis: "deterministic",
            createdAt: "2026-08-12T00:00:00.000Z",
            reviewRequired: false
          };
          delete (workspace.projectMemory.revisions.memory as unknown as Record<string, unknown>).basis;
        }
      },
      {
        path: "projectMemory.documents.outputPlan",
        damage: (workspace) => {
          delete (workspace.projectMemory.documents as unknown as Record<string, unknown>).outputPlan;
        }
      },
      {
        path: "canvas.stageRegions.0.key",
        damage: (workspace) => {
          workspace.canvas.stageRegions = [{
            id: "stage",
            key: "research",
            title: "Research",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            memberObjectIds: []
          }];
          (workspace.canvas.stageRegions[0] as unknown as Record<string, unknown>).key = "invalidStage";
        }
      },
      {
        path: "ai.messages.0.providerInputSnapshot.serializedTextHash",
        damage: (workspace) => {
          workspace.ai.messages.push({
            id: "message",
            role: "user",
            body: "Review this.",
            providerInputSnapshot: {
              schemaVersion: 1,
              promptContractVersion: "agent-v1",
              textParts: [],
              attachmentRefs: [],
              serializedTextHash: "hash"
            }
          });
          const message = workspace.ai.messages[0];
          if (!message?.providerInputSnapshot) throw new Error("Expected provider input fixture.");
          delete (message.providerInputSnapshot as unknown as Record<string, unknown>).serializedTextHash;
        }
      }
    ];

    for (const testCase of cases) {
      const damaged = structuredClone(createObjectContractWorkspace());
      testCase.damage(damaged);
      expect(validateCurrentMorphoWorkspace(damaged), testCase.path).toMatchObject({
        status: "failed",
        issues: expect.arrayContaining([expect.objectContaining({ path: testCase.path })])
      });
    }
  });

  it.each([
    ["variant", "derivedFromDirection"],
    ["split", "splitFromDirection"],
    ["merge", "mergedFromDirection"],
    ["revision", "supersedesDirection"]
  ] as const)("normalizes retired proposal lineage alias %s on read but rejects it at the current validation boundary", (alias, canonical) => {
    const stored = createObjectContractWorkspace() as unknown as Record<string, unknown>;
    const proposals = stored.artifactProposals as Record<string, unknown>;
    proposals.proposal = {
      id: "proposal",
      type: "conceptDirection",
      status: "pending",
      sourceSnapshots: [],
      sourceObjectIds: [],
      citationIds: [],
      createdAt: "2026-08-12T00:00:00.000Z",
      title: "Split direction",
      summary: "Legacy proposal",
      applicationMode: "split",
      parentDirectionIds: ["direction"],
      directions: [{
        title: "Split",
        summary: "Legacy split",
        conceptStatement: "A split direction.",
        keywords: [],
        strategy: "Explore a variant.",
        differentiators: [],
        visualSignals: [],
        risks: [],
        openQuestions: [],
        basedOnDirectionId: "direction",
        lineageKind: alias
      }]
    };

    expect(validateCurrentMorphoWorkspace(stored)).toMatchObject({
      status: "failed",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "artifactProposals.proposal.directions.0.lineageKind" })
      ])
    });

    const parsed = migrateWorkspaceToCurrentSchema(stored);
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") throw new Error(parsed.reason);
    const proposal = parsed.workspace.artifactProposals.proposal;
    expect(proposal?.type).toBe("conceptDirection");
    if (proposal?.type !== "conceptDirection") throw new Error("Expected concept-direction proposal.");
    expect(proposal.directions[0]?.lineageKind).toBe(canonical);
    expect(validateCurrentMorphoWorkspace(parsed.workspace)).toMatchObject({ status: "ok" });
  });
});

const REQUIRED_OBJECT_BASE_FIELDS = ["id", "type", "title", "summary", "createdBy", "visibility"] as const;

const REQUIRED_VARIANT_FIELDS_BY_TYPE = {
  image: ["role"],
  file: ["fileKind", "sourceLabel"],
  text: ["body"],
  link: ["url", "domain"],
  imageCollection: ["memberObjectIds", "expanded"],
  research: ["findings", "opportunities", "constraints", "openQuestions"],
  keyConclusion: ["category", "body", "state", "confidence", "sourceObjectIds", "citationIds", "confirmedAt"],
  documentFragment: ["body", "source"],
  proposalDraft: ["proposalId", "proposalType"],
  designDefinition: ["problem", "principles", "avoid", "currentRevisionId", "revisionIds", "isCurrentEffective"],
  conceptDirection: ["status", "keywords", "currentRevisionId", "revisionIds", "lineageRootId"],
  delivery: ["format", "sections", "gaps", "references"]
} as const satisfies {
  [Type in MorphoObject["type"]]: readonly (keyof Extract<MorphoObject, { type: Type }>)[];
};

const OBJECT_ID_BY_TYPE = {
  image: "image",
  file: "file",
  text: "text",
  link: "link",
  imageCollection: "collection",
  research: "research",
  keyConclusion: "conclusion",
  documentFragment: "fragment",
  proposalDraft: "proposal",
  designDefinition: "definition",
  conceptDirection: "direction",
  delivery: "delivery"
} as const satisfies Record<MorphoObject["type"], string>;

function createObjectContractWorkspace(): MorphoWorkspace {
  const workspace = createBlankWorkspace("project-object-contract");
  const now = "2026-08-12T00:00:00.000Z";

  workspace.assets.image = {
    id: "image",
    fileName: "image.png",
    mimeType: "image/png",
    size: 128,
    createdAt: now,
    storageKey: "blob:image",
    sourceType: "originalImage",
    width: 16,
    height: 9,
    aspectRatio: 16 / 9
  };
  workspace.assets.extract = {
    id: "extract",
    fileName: "extract.json",
    mimeType: "application/json",
    size: 64,
    createdAt: now,
    storageKey: "extract:file",
    sourceType: "documentExtract"
  };
  workspace.artifactProposals.proposal = {
    id: "proposal",
    type: "deliveryPlan",
    workIntent: "prepareDeliverySection",
    status: "pending",
    reviewState: "ready",
    reviewDetails: [],
    sourceSnapshots: [],
    sourceObjectIds: [],
    citationIds: [],
    createdAt: now,
    canvasPlacement: { x: 10, y: 20 },
    title: "Delivery plan",
    summary: "Prepare the delivery.",
    items: [{
      title: "Hero",
      purpose: "Explain the direction.",
      contentType: "image",
      sourceObjectIds: [],
      missingReason: "Awaiting selection."
    }]
  };
  workspace.operations.operation = {
    id: "operation",
    type: "research",
    projectId: workspace.project.id,
    createdAt: now,
    updatedAt: now,
    status: "succeeded",
    userInput: "Review sources.",
    inputSnapshot: {
      userInput: "Review sources.",
      selectedObjectIds: [],
      sourceSnapshots: [],
      objectSnapshots: []
    },
    allowedCapabilities: { webSearch: false, imagePixels: false },
    steps: [],
    events: [],
    sourceIds: [],
    proposalIds: [],
    errorSummary: "",
    retryable: false
  };
  workspace.designDefinitionRevisions["definition-revision"] = {
    id: "definition-revision",
    designDefinitionId: "definition",
    revisionNumber: 1,
    title: "Definition",
    summary: "Definition summary",
    projectGoal: "Create a coherent concept.",
    targetUsers: [],
    primaryScenarios: [],
    coreProblem: "Keep the experience calm.",
    designPrinciples: [],
    constraints: [],
    avoidDirections: [],
    opportunities: [],
    openQuestions: [],
    sourceObjectIds: [],
    citationIds: [],
    createdAt: now,
    changeNote: "Initial revision",
    isCurrent: false
  };
  workspace.directionRevisions["direction-revision"] = {
    id: "direction-revision",
    directionId: "direction",
    revisionNumber: 1,
    title: "Direction",
    summary: "Direction summary",
    conceptStatement: "A calm concept.",
    keywords: [],
    strategy: "Use a restrained visual language.",
    differentiators: [],
    visualSignals: [],
    risks: [],
    openQuestions: [],
    sourceObjectIds: [],
    citationIds: [],
    basedOnDefinitionRevisionId: "definition-revision",
    createdAt: now,
    changeNote: "Initial revision",
    isCurrent: false
  };
  workspace.visualBranches.branch = {
    id: "branch",
    directionId: "direction",
    label: "Primary branch",
    rootObjectId: "image",
    createdAt: now
  };
  workspace.objects = {
    image: {
      id: "image",
      type: "image",
      title: "Image",
      summary: "Reference image",
      createdBy: "user",
      visibility: "active",
      role: "reference",
      assetId: "image",
      directionId: "direction",
      visualBranchId: "branch",
      pendingReview: {
        reason: "defaultReferenceReplaced",
        previousDefaultReferenceId: "deleted-image",
        newDefaultReferenceId: "image",
        decisionId: "decision",
        markedAt: now
      },
      generation: {
        operationId: "operation",
        clientRequestId: "request",
        providerTaskId: "provider-task",
        modelId: "model",
        modelLabel: "Model",
        aspectRatio: "16:9",
        sizeOption: "1K",
        prompt: "Create a calm product visual.",
        compiledPrompt: "Create a calm product visual.",
        promptContractVersion: "visual-v1",
        editMode: "imageToImage",
        referenceObjectIds: [],
        referenceResolution: {
          resolvedObjectIds: [],
          candidates: [{
            objectId: "deleted-image",
            reason: "userExplicit",
            priority: 1,
            included: false,
            omissionReason: "unavailable"
          }],
          providerLimit: 4,
          defaultReferenceExcluded: false
        },
        directionId: "direction",
        visualBranchId: "branch",
        title: "Image",
        purpose: "Reference study",
        role: "reference",
        visualIntent: {
          id: "intent",
          targetDirectionId: "direction",
          visualBranchId: "branch",
          title: "Image",
          purpose: "Reference study",
          requestedReferenceObjectIds: [],
          excludeDefaultReference: false,
          changeGoals: [],
          preserve: [],
          allowToChange: [],
          productForm: [],
          materialsAndCmf: [],
          environmentAndLighting: [],
          avoid: [],
          editMode: "imageToImage",
          role: "reference"
        },
        visualPlan: {
          kind: "visualDevelopment",
          items: []
        },
        createdAt: now
      }
    },
    file: {
      id: "file",
      type: "file",
      title: "File",
      summary: "Source file",
      createdBy: "user",
      visibility: "active",
      fileKind: "pdf",
      sourceLabel: "Upload",
      assetId: "image",
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      size: 128,
      parseStatus: "parsed",
      extractedAssetId: "extract",
      extractedCharCount: 20,
      extractedPageCount: 1,
      sourcePageCount: 1,
      extractionTruncated: false,
      parsedAt: now,
      parseError: ""
    },
    text: {
      id: "text",
      type: "text",
      title: "Text",
      summary: "Text note",
      createdBy: "user",
      visibility: "active",
      body: "A note."
    },
    link: {
      id: "link",
      type: "link",
      title: "Link",
      summary: "External source",
      createdBy: "user",
      visibility: "active",
      url: "https://example.com",
      domain: "example.com",
      editableTitle: "Example",
      description: "Example source",
      assetId: "image"
    },
    collection: {
      id: "collection",
      type: "imageCollection",
      title: "Collection",
      summary: "Image collection",
      createdBy: "user",
      visibility: "active",
      memberObjectIds: ["image"],
      expanded: true,
      pendingReview: {
        reason: "defaultReferenceReplaced",
        previousDefaultReferenceId: "deleted-image",
        newDefaultReferenceId: "image",
        decisionId: "decision",
        markedAt: now
      }
    },
    research: {
      id: "research",
      type: "research",
      title: "Research",
      summary: "Research summary",
      createdBy: "ai",
      visibility: "active",
      findings: [],
      opportunities: [],
      constraints: [],
      openQuestions: [],
      evidence: [{
        claim: "A supported claim.",
        sourceObjectIds: [],
        citationIds: [],
        confidence: "supported"
      }],
      provenance: {
        operationId: "operation",
        proposalId: "proposal",
        sourceObjectIds: [],
        citationIds: [],
        didUseWebSearch: false
      }
    },
    conclusion: {
      id: "conclusion",
      type: "keyConclusion",
      title: "Conclusion",
      summary: "Conclusion summary",
      createdBy: "user",
      visibility: "active",
      category: "finding",
      body: "A confirmed conclusion.",
      state: "active",
      confidence: "supported",
      sourceObjectIds: [],
      citationIds: [],
      confirmedAt: now,
      supersededById: "deleted-conclusion",
      note: "Historical successor may be unavailable."
    },
    fragment: {
      id: "fragment",
      type: "documentFragment",
      title: "Fragment",
      summary: "Document fragment",
      createdBy: "user",
      visibility: "active",
      body: "Extracted content.",
      source: {
        fileObjectId: "file",
        fileTitle: "File",
        fileName: "brief.pdf",
        sourceExtractAssetId: "extract",
        startOffset: 0,
        endOffset: 18,
        blockIds: ["block"]
      }
    },
    proposal: {
      id: "proposal",
      type: "proposalDraft",
      title: "Proposal",
      summary: "Proposal draft",
      createdBy: "ai",
      visibility: "active",
      proposalId: "proposal",
      proposalType: "deliveryPlan"
    },
    definition: {
      id: "definition",
      type: "designDefinition",
      title: "Definition",
      summary: "Definition summary",
      createdBy: "user",
      visibility: "active",
      problem: "Keep the experience calm.",
      principles: [],
      avoid: [],
      currentRevisionId: "definition-revision",
      revisionIds: ["definition-revision"],
      isCurrentEffective: false
    },
    direction: {
      id: "direction",
      type: "conceptDirection",
      title: "Direction",
      summary: "Direction summary",
      createdBy: "ai",
      visibility: "active",
      status: "needsReview",
      keywords: [],
      currentRevisionId: "direction-revision",
      revisionIds: ["direction-revision"],
      lineageRootId: "direction"
    },
    delivery: {
      id: "delivery",
      type: "delivery",
      title: "Delivery",
      summary: "Delivery preparation",
      createdBy: "user",
      visibility: "active",
      format: "board",
      sections: [{
        id: "section",
        title: "Hero",
        purpose: "Introduce the direction.",
        order: 0,
        referenceIds: [],
        narrative: "A concise narrative.",
        createdAt: now,
        updatedAt: now
      }],
      gaps: [{
        id: "gap",
        label: "Add a detail view.",
        sectionId: "section",
        status: "open",
        origin: "manual",
        createdAt: now,
        updatedAt: now
      }],
      references: []
    }
  };

  return workspace;
}
