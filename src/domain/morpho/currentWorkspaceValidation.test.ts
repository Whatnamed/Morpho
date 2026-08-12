import { describe, expect, it } from "vitest";

import { createBlankWorkspace, createInitialWorkspace } from "./workspace";
import { validateCurrentMorphoWorkspace } from "./currentWorkspaceValidation";

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
});
