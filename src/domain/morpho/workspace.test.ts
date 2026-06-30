import { describe, expect, it } from "vitest";

import {
  assembleAiContext,
  buildKeyConclusionDraftFromResearchSource,
  createKeyConclusion,
  createAiDraftFromSuggestion,
  createBlankWorkspace,
  createDeliveryReference,
  createInitialWorkspace,
  createVisualBranch,
  deleteObject,
  getRenderableCanvasInstances,
  hideObject,
  migrateWorkspaceToCurrentSchema,
  archiveVisualBranch,
  assignImageToVisualBranch,
  removeImageFromVisualBranch,
  renameVisualBranch,
  restoreVisualBranch,
  setConceptDirectionStatus,
  setDefaultReference,
  setKeyConclusionState,
  setImageRole,
  updateCanvasInstancePosition
} from "./workspace";
import { importAssetBackedObjects, importTextObject, importUrlObject } from "./imports";
import { recordDesignDefinitionProposal } from "../operations/operations";
import { hasPendingDesignDefinitionRevisionProposal, reconcileWorkspaceDerivedState } from "./derivedState";

describe("Morpho workspace domain boundaries", () => {
  it("creates a blank schema v9 project without depending on Nightrail seed object ids", () => {
    const workspace = createBlankWorkspace("project-empty-local");

    expect(workspace.schemaVersion).toBe(9);
    expect(workspace.project.id).toBe("project-empty-local");
    expect(workspace.objects["image-soft-rail-v2"]).toBeUndefined();
    expect(workspace.canvas.instances).toEqual([]);
    expect(workspace.assets).toEqual({});
    expect(workspace.operations).toEqual({});
    expect(workspace.artifactProposals).toEqual({});
    expect(workspace.citationSnapshots).toEqual({});
    expect(workspace.projectContinuity.currentFocus.area).toBe("startAndInput");
    expect(workspace.projectContinuity.recordEntries).toEqual([]);
  });

  it("initializes the seed continuity focus from real project sources", () => {
    const workspace = createInitialWorkspace();

    expect(workspace.projectContinuity.currentFocus.area).toBe("directionAndVisual");
    expect(workspace.projectContinuity.currentFocus.sourceObjectIds).toEqual([
      "direction-soft-rail",
      "direction-support-island",
      "direction-soft-guide",
      "image-soft-rail-v2"
    ]);
  });

  it("moves a canvas instance without changing object type, status, or relations", () => {
    const workspace = createInitialWorkspace();
    const instance = workspace.canvas.instances[0];
    const objectBefore = workspace.objects[instance.objectId];

    const updated = updateCanvasInstancePosition(workspace, instance.id, {
      x: instance.position.x + 320,
      y: instance.position.y + 80
    });

    expect(updated.canvas.instances[0].position).toEqual({
      x: instance.position.x + 320,
      y: instance.position.y + 80
    });
    expect(updated.objects[instance.objectId]).toEqual(objectBefore);
    expect(updated.relations).toEqual(workspace.relations);
  });

  it("turns an AI suggestion into an editable draft without mutating project state", () => {
    const workspace = createInitialWorkspace();
    const selectedObjectId = "image-soft-rail-v2";

    const result = createAiDraftFromSuggestion(workspace, {
      selectedObjectIds: [selectedObjectId],
      suggestion: "继续发展这张图，保留低位导向与暖光氛围。"
    });

    expect(result.workspace).toBe(workspace);
    expect(result.draft).toBe("继续发展这张图，保留低位导向与暖光氛围。");
    expect(result.contextObjectIds).toEqual([selectedObjectId]);
  });

  it("creates a key conclusion with source relations and updates derived project state", () => {
    const workspace = importTextObject(createBlankWorkspace("project-key-conclusion"), {
      text: "夜间起身时需要连续、低干扰的导向，不应只依赖单点扶手。",
      position: { x: 120, y: 140 }
    }).workspace;
    const sourceObject = Object.values(workspace.objects).find((object) => object.type === "text");

    expect(sourceObject).toBeDefined();
    if (!sourceObject || sourceObject.type !== "text") {
      throw new Error("Expected imported text object.");
    }

    const result = createKeyConclusion(workspace, {
      title: "连续支撑优先于单点扶手",
      summary: "夜间起身路径需要连续导向与支撑。",
      body: sourceObject.body,
      sourceObjectIds: [sourceObject.id],
      confidence: "needsVerification",
      state: "needsVerification",
      note: "用户从文本输入中明确保留该结论。",
      position: { x: 360, y: 180 }
    });

    expect(result.workspace.objects[result.keyConclusion.id]?.type).toBe("keyConclusion");
    expect(
      result.workspace.relations.some(
        (relation) =>
          relation.kind === "supportsConclusion" &&
          relation.fromObjectId === sourceObject.id &&
          relation.toObjectId === result.keyConclusion.id
      )
    ).toBe(true);
    expect(result.workspace.workingState.activeKeyConclusionIds).not.toContain(result.keyConclusion.id);
    expect(result.workspace.workingState.openQuestionIds).toContain(result.keyConclusion.id);
    expect(result.workspace.projectContinuity.recordEntries.at(-1)).toMatchObject({
      stage: "research",
      category: "decision"
    });
    expect(result.workspace.projectContinuity.recordEntries.at(-1)?.sourceRefs).toContainEqual(
      expect.objectContaining({ kind: "object", id: result.keyConclusion.id })
    );
    expect(result.workspace.decisionRecords.at(-1)?.kind).toBe("createKeyConclusion");
  });

  it("builds key conclusion drafts from exact research items and evidence bindings", () => {
    const workspace = createInitialWorkspace();
    const research = workspace.objects["research-night-path"];
    if (!research || research.type !== "research") {
      throw new Error("Expected seed research object.");
    }

    const enrichedWorkspace = {
      ...workspace,
      objects: {
        ...workspace.objects,
        "research-night-path": {
          ...research,
          findings: [...research.findings, "第二条发现：夜间转向点比终点扶手更需要连续导向。"],
          evidence: [
            {
              claim: "证据 A：连续导向优先于单点支撑。",
              sourceObjectIds: ["research-night-path", "file-course-brief"],
              citationIds: ["citation-research-a"],
              confidence: "supported" as const
            },
            {
              claim: "证据 B：转角区域需要更柔和的触达线索。",
              sourceObjectIds: ["file-path-references"],
              citationIds: ["citation-research-b"],
              confidence: "needsVerification" as const
            }
          ]
        }
      }
    };

    const findingDraft = buildKeyConclusionDraftFromResearchSource(enrichedWorkspace, "research-night-path", {
      kind: "finding",
      index: 1
    });
    expect(findingDraft.status).toBe("ready");
    if (findingDraft.status !== "ready") {
      throw new Error("Expected finding draft to be ready.");
    }
    expect(findingDraft.draft.summary).toBe("第二条发现：夜间转向点比终点扶手更需要连续导向。");
    expect(findingDraft.draft.body).toBe("第二条发现：夜间转向点比终点扶手更需要连续导向。");
    expect(findingDraft.draft.sourceObjectIds).toEqual(["research-night-path"]);
    expect(findingDraft.draft.citationIds).toEqual([]);

    const evidenceDraft = buildKeyConclusionDraftFromResearchSource(enrichedWorkspace, "research-night-path", {
      kind: "evidence",
      index: 1
    });
    expect(evidenceDraft.status).toBe("ready");
    if (evidenceDraft.status !== "ready") {
      throw new Error("Expected evidence draft to be ready.");
    }
    expect(evidenceDraft.draft.summary).toBe("证据 B：转角区域需要更柔和的触达线索。");
    expect(evidenceDraft.draft.sourceObjectIds).toEqual(["file-path-references"]);
    expect(evidenceDraft.draft.citationIds).toEqual(["citation-research-b"]);
    expect(evidenceDraft.draft.confidence).toBe("needsVerification");
    expect(evidenceDraft.draft.state).toBe("needsVerification");
  });

  it("reconciles active key conclusions when their state changes", () => {
    const workspace = createInitialWorkspace();

    const needsVerification = setKeyConclusionState(workspace, "insight-continuous-support", "needsVerification", {
      reason: "需要复核该结论是否仍然成立。"
    });
    expect(needsVerification.status).toBe("updated");
    if (needsVerification.status !== "updated") {
      throw new Error("Expected key conclusion state update.");
    }
    expect(needsVerification.workspace.objects["insight-continuous-support"]).toMatchObject({
      state: "needsVerification"
    });
    expect(needsVerification.workspace.workingState.activeKeyConclusionIds).not.toContain("insight-continuous-support");

    const superseded = setKeyConclusionState(
      needsVerification.workspace,
      "insight-continuous-support",
      "superseded",
      {
        supersededById: "insight-nonmedical",
        reason: "已有更新结论替代。"
      }
    );
    expect(superseded.status).toBe("updated");
    if (superseded.status !== "updated") {
      throw new Error("Expected superseded update.");
    }
    expect(superseded.workspace.objects["insight-continuous-support"]).toMatchObject({
      state: "superseded",
      supersededById: "insight-nonmedical"
    });
    expect(superseded.workspace.workingState.activeKeyConclusionIds).not.toContain("insight-continuous-support");

    const restored = setKeyConclusionState(superseded.workspace, "insight-continuous-support", "active", {
      reason: "重新确认该结论依然成立。"
    });
    expect(restored.status).toBe("updated");
    if (restored.status !== "updated") {
      throw new Error("Expected restore update.");
    }
    expect(restored.workspace.objects["insight-continuous-support"]).toMatchObject({
      state: "active",
      supersededById: undefined
    });
    expect(restored.workspace.workingState.activeKeyConclusionIds).toContain("insight-continuous-support");
  });

  it("blocks superseded state changes when the replacement key conclusion is missing", () => {
    const workspace = createInitialWorkspace();

    const result = setKeyConclusionState(workspace, "insight-continuous-support", "superseded");

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") {
      throw new Error("Expected superseded update to be blocked.");
    }
    expect(result.reason).toContain("supersededById");
    expect(result.workspace).toBe(workspace);
  });

  it("detects a pending revision proposal on the current design definition", () => {
    const workspace = createInitialWorkspace();
    const currentDefinition =
      workspace.objects["definition-current"]?.type === "designDefinition"
        ? workspace.objects["definition-current"]
        : undefined;
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-revision-pending",
      title: "当前设计定义 v2",
      summary: "收紧连续支撑与触感边界。",
      projectGoal: "保持居家感的同时提升夜间路径支撑可信度。",
      targetUsers: ["独居老人"],
      primaryScenarios: ["床边起身", "进入卫浴"],
      coreProblem: "如何在不增加器械感的前提下强化连续支撑。",
      designPrinciples: ["连续支撑", "柔和触感"],
      constraints: ["避免医院感"],
      avoidDirections: ["厚重器械感"],
      opportunities: ["统一转角与触感语言"],
      openQuestions: ["转角连接是否需要更明显的触感差异？"],
      sourceObjectIds: ["insight-continuous-support"],
      citations: [],
      basedOnDesignDefinitionId: "definition-current",
      basedOnRevisionId: currentDefinition?.currentRevisionId,
      workIntent: "reviseDesignDefinition",
      changeNote: "收紧连续支撑边界。"
    });

    expect(hasPendingDesignDefinitionRevisionProposal(proposed.workspace, "definition-current")).toBe(true);
  });

  it("does not treat create-definition proposals as revision drafts on the current definition", () => {
    const workspace = createInitialWorkspace();
    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-create-pending",
      title: "首版设计定义草案",
      summary: "一份与当前定义无关的首版草案。",
      projectGoal: "测试首版创建语义。",
      targetUsers: ["测试用户"],
      primaryScenarios: ["测试场景"],
      coreProblem: "测试问题。",
      designPrinciples: ["测试原则"],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: [],
      workIntent: "createDesignDefinition"
    });

    expect(hasPendingDesignDefinitionRevisionProposal(proposed.workspace, "definition-current")).toBe(false);
  });

  it("reconciles multiple current effective design definitions deterministically", () => {
    const workspace = createInitialWorkspace();
    const current = workspace.objects["definition-current"];
    if (!current || current.type !== "designDefinition") {
      throw new Error("Expected seed current design definition.");
    }

    const olderRevision = {
      ...workspace.designDefinitionRevisions[current.currentRevisionId],
      id: "definition-revision-older-current",
      designDefinitionId: "definition-older-current",
      createdAt: "2026-01-01T00:00:00.000Z"
    };
    const duplicate = {
      ...current,
      id: "definition-older-current",
      title: "旧的异常 current 定义",
      currentRevisionId: olderRevision.id,
      revisionIds: [olderRevision.id],
      isCurrentEffective: true
    };

    const reconciled = reconcileWorkspaceDerivedState({
      ...workspace,
      objects: {
        ...workspace.objects,
        [duplicate.id]: duplicate
      },
      designDefinitionRevisions: {
        ...workspace.designDefinitionRevisions,
        [olderRevision.id]: olderRevision
      }
    });

    const currentDefinitions = Object.values(reconciled.objects).filter(
      (object) => object.type === "designDefinition" && object.isCurrentEffective
    );
    expect(currentDefinitions.map((object) => object.id)).toEqual(["definition-current"]);
    expect(reconciled.workingState.currentDesignDefinitionId).toBe("definition-current");
  });

  it("keeps a hidden current definition addressable without falling back to an older definition", () => {
    const workspace = createInitialWorkspace();
    const hidden = hideObject(workspace, "definition-current");

    expect(hidden.workingState.currentDesignDefinitionId).toBe("definition-current");
    expect(hidden.workingState.currentDesignDefinitionAvailability).toBe("hidden");

    const context = assembleAiContext(hidden, {
      draft: "基于当前定义生成方向。",
      selectedObjectIds: [],
      explicitObjectIds: [],
      task: "conceptDirection"
    });

    expect(context.objectIds).not.toContain("definition-current");
  });

  it("hides objects without deleting objects, relations, or creating decision records", () => {
    const workspace = createInitialWorkspace();
    const hidden = hideObject(workspace, "image-soft-rail-v2");

    expect(hidden.objects["image-soft-rail-v2"]?.visibility).toBe("hidden");
    expect(hidden.relations).toEqual(workspace.relations);
    expect(hidden.decisionRecords).toEqual(workspace.decisionRecords);
    expect(getRenderableCanvasInstances(hidden).some((instance) => instance.objectId === "image-soft-rail-v2")).toBe(
      false
    );
  });

  it("keeps a hidden default reference as state but excludes it from visual AI context", () => {
    const workspace = hideObject(createInitialWorkspace(), "image-soft-rail-v2");

    expect(workspace.objects["image-soft-rail-v2"]?.type).toBe("image");
    expect(workspace.objects["image-soft-rail-v2"]?.visibility).toBe("hidden");

    const context = assembleAiContext(workspace, {
      draft: "继续发展主方向的视觉细节。",
      selectedObjectIds: [],
      explicitObjectIds: [],
      task: "visualDevelopment"
    });

    expect(context.objectIds).not.toContain("image-soft-rail-v2");
    expect(context.defaultReferenceStatus).toEqual({
      status: "hidden",
      objectId: "image-soft-rail-v2",
      message: "当前后续默认参考已隐藏，请先恢复或替换后再用于相关生成。"
    });
  });

  it("does not inject the primary direction into visual context without an explicit visual target", () => {
    const workspace = createInitialWorkspace();

    const context = assembleAiContext(workspace, {
      draft: "做一次无方向视觉探索。",
      selectedObjectIds: [],
      explicitObjectIds: [],
      task: "visualDevelopment"
    });

    expect(context.objectIds).not.toContain("direction-soft-rail");
    expect(context.objectIds).not.toContain("image-soft-rail-v2");
  });

  it("adds the default reference to visual context only when it belongs to the explicit target direction", () => {
    const workspace = createInitialWorkspace();

    const matchingContext = assembleAiContext(workspace, {
      draft: "继续发展方向 A。",
      selectedObjectIds: [],
      explicitObjectIds: [],
      task: "visualDevelopment",
      visualTargetDirectionId: "direction-soft-rail"
    });

    expect(matchingContext.objectIds).toContain("direction-soft-rail");
    expect(matchingContext.objectIds).toContain("image-soft-rail-v2");

    const mismatchedContext = assembleAiContext(workspace, {
      draft: "继续发展方向 B。",
      selectedObjectIds: [],
      explicitObjectIds: [],
      task: "visualDevelopment",
      visualTargetDirectionId: "direction-support-island"
    });

    expect(mismatchedContext.objectIds).toContain("direction-support-island");
    expect(mismatchedContext.objectIds).not.toContain("image-soft-rail-v2");
  });

  it("requires confirmation before deleting an object that still has active references", () => {
    const workspace = createInitialWorkspace();
    const result = deleteObject(workspace, "image-soft-rail-v2");

    expect(result.status).toBe("requiresConfirmation");
    if (result.status !== "requiresConfirmation") {
      throw new Error("Expected deleteObject to require confirmation.");
    }
    expect(result.workspace).toBe(workspace);
    expect(result.reasons).toContain("对象是当前后续默认参考。");
  });

  it("confirmed deletion removes live references without damaging delivery reference snapshots", () => {
    const workspace = createInitialWorkspace();
    const deliveryReferenceBefore = workspace.deliveryReferences["delivery-ref-board-main"];

    const result = deleteObject(workspace, "image-soft-rail-v2", {
      confirmed: true,
      reason: "用户明确删除默认参考源图。"
    });

    expect(result.status).toBe("updated");
    expect(result.workspace.objects["image-soft-rail-v2"]).toBeUndefined();
    expect(result.workspace.canvas.instances.some((instance) => instance.objectId === "image-soft-rail-v2")).toBe(
      false
    );
    expect(
      result.workspace.relations.some(
        (relation) => relation.fromObjectId === "image-soft-rail-v2" || relation.toObjectId === "image-soft-rail-v2"
      )
    ).toBe(false);
    expect(result.workspace.deliveryReferences["delivery-ref-board-main"].snapshot).toEqual(
      deliveryReferenceBefore.snapshot
    );
    expect(result.workspace.decisionRecords.at(-1)?.objectSnapshot).toEqual({
      id: "image-soft-rail-v2",
      type: "image",
      title: "柔光轨道 v2"
    });
  });

  it("keeps delivery reference snapshots stable after the source object changes or disappears", () => {
    const workspace = createInitialWorkspace();
    const created = createDeliveryReference(workspace, {
      deliveryObjectId: "delivery-board-a1",
      sourceObjectId: "insight-continuous-support",
      caption: "交付摘要：连续支持比单点扶手更符合真实动作路径。"
    });

    expect(created.status).toBe("updated");
    if (created.status !== "updated") {
      throw new Error("Expected createDeliveryReference to update the workspace.");
    }

    const sourceChanged = {
      ...created.workspace,
      objects: {
        ...created.workspace.objects,
        "insight-continuous-support": {
          ...created.workspace.objects["insight-continuous-support"],
          title: "已改名的源对象",
          visibility: "hidden" as const
        }
      }
    };
    const deleted = deleteObject(sourceChanged, "insight-continuous-support", {
      confirmed: true,
      reason: "用户明确删除源结论。"
    });

    expect(deleted.status).toBe("updated");
    expect(deleted.workspace.deliveryReferences[created.deliveryReferenceId].snapshot.title).toBe(
      "连续支撑比单点扶手更符合真实动作路径"
    );
    expect(deleted.workspace.deliveryReferences[created.deliveryReferenceId].snapshot.caption).toBe(
      "交付摘要：连续支持比单点扶手更符合真实动作路径。"
    );
  });

  it("sets exactly one active image as the default reference without touching delivery references", () => {
    const workspace = createInitialWorkspace();
    const deliveryReferenceBefore = structuredClone(workspace.deliveryReferences);

    const updated = setDefaultReference(workspace, "image-night-scenario", {
      reason: "用户选择夜间场景作为下一轮视觉生成基线。"
    });

    const defaultImages = Object.values(updated.objects).filter(
      (object) => object.type === "image" && object.isDefaultReference
    );

    expect(defaultImages.map((object) => object.id)).toEqual(["image-night-scenario"]);
    expect(updated.deliveryReferences).toEqual(deliveryReferenceBefore);
    expect(updated.decisionRecords.at(-1)?.kind).toBe("setDefaultReference");
  });

  it("keeps exactly one primary direction when promoting another direction", () => {
    const workspace = createInitialWorkspace();
    const alternativeDirection = Object.values(workspace.objects).find(
      (object) => object.type === "conceptDirection" && object.status === "alternative"
    );
    const currentPrimary = Object.values(workspace.objects).find(
      (object) => object.type === "conceptDirection" && object.status === "primary"
    );

    expect(alternativeDirection).toBeDefined();
    expect(currentPrimary).toBeDefined();
    if (!alternativeDirection || alternativeDirection.type !== "conceptDirection") {
      throw new Error("Expected alternative direction.");
    }
    if (!currentPrimary || currentPrimary.type !== "conceptDirection") {
      throw new Error("Expected current primary direction.");
    }

    const updated = setConceptDirectionStatus(
      workspace,
      alternativeDirection.id,
      "primary",
      "用户明确将备选方向提升为主方向。"
    );

    const primaryDirections = Object.values(updated.objects).filter(
      (object) => object.type === "conceptDirection" && object.status === "primary"
    );

    expect(primaryDirections.map((direction) => direction.id)).toEqual([alternativeDirection.id]);
    expect(updated.objects[currentPrimary.id]).toMatchObject({
      id: currentPrimary.id,
      type: "conceptDirection",
      status: "alternative"
    });
    expect(updated.workingState.primaryDirectionId).toBe(alternativeDirection.id);
    expect(updated.decisionRecords.at(-1)?.kind).toBe("setDirectionStatus");
  });

  it("changes an image role as a traceable visual-development decision without replacing references", () => {
    const workspace = createInitialWorkspace();
    const source = workspace.objects["image-night-scenario"];
    if (!source || source.type !== "image") {
      throw new Error("Expected seed image.");
    }
    const relationCount = workspace.relations.length;

    const updated = setImageRole(workspace, source.id, "primaryVisual", {
      reason: "用户明确将该图标记为主视觉。"
    });
    const image = updated.objects[source.id];
    const decision = updated.decisionRecords.at(-1);

    expect(image).toMatchObject({
      id: source.id,
      type: "image",
      role: "primaryVisual"
    });
    expect(image?.type === "image" ? image.isDefaultReference : undefined).toBe(source.isDefaultReference);
    expect(updated.relations).toHaveLength(relationCount);
    expect(decision?.kind).toBe("setImageRole");
    expect(updated.projectContinuity).toBe(workspace.projectContinuity);
  });

  it("creates, renames, archives, and restores a visual branch without creating canvas objects", () => {
    const workspace = createInitialWorkspace();
    const initialObjectCount = Object.keys(workspace.objects).length;

    const created = createVisualBranch(workspace, {
      branchId: "branch-cmf-explore",
      directionId: "direction-soft-rail",
      label: "CMF 探索"
    });

    expect(created.status).toBe("updated");
    if (created.status !== "updated") {
      throw new Error(created.reason);
    }
    expect(created.workspace.visualBranches["branch-cmf-explore"]).toMatchObject({
      id: "branch-cmf-explore",
      directionId: "direction-soft-rail",
      label: "CMF 探索"
    });
    expect(Object.keys(created.workspace.objects)).toHaveLength(initialObjectCount);

    const renamed = renameVisualBranch(created.workspace, "branch-cmf-explore", "CMF 与材质探索");
    expect(renamed.status).toBe("updated");
    if (renamed.status !== "updated") {
      throw new Error(renamed.reason);
    }
    expect(renamed.workspace.visualBranches["branch-cmf-explore"]?.label).toBe("CMF 与材质探索");

    const archived = archiveVisualBranch(renamed.workspace, "branch-cmf-explore");
    expect(archived.status).toBe("updated");
    if (archived.status !== "updated") {
      throw new Error(archived.reason);
    }
    expect(archived.workspace.visualBranches["branch-cmf-explore"]?.archivedAt).toBeDefined();

    const restored = restoreVisualBranch(archived.workspace, "branch-cmf-explore");
    expect(restored.status).toBe("updated");
    if (restored.status !== "updated") {
      throw new Error(restored.reason);
    }
    expect(restored.workspace.visualBranches["branch-cmf-explore"]?.archivedAt).toBeUndefined();
  });

  it("assigns images to visual branches only within the branch direction", () => {
    const workspace = createInitialWorkspace();
    const seedImage = workspace.objects["image-rail-detail"];
    if (!seedImage || seedImage.type !== "image") {
      throw new Error("Expected seed image.");
    }
    const withoutDirectionImage = {
      ...seedImage,
      directionId: undefined,
      visualBranchId: undefined
    };
    const prepared = {
      ...workspace,
      objects: {
        ...workspace.objects,
        [withoutDirectionImage.id]: withoutDirectionImage
      }
    };

    const assigned = assignImageToVisualBranch(prepared, withoutDirectionImage.id, "visual-branch-soft-rail-detail");
    expect(assigned.status).toBe("updated");
    if (assigned.status !== "updated") {
      throw new Error(assigned.reason);
    }
    expect(assigned.workspace.objects[withoutDirectionImage.id]).toMatchObject({
      id: withoutDirectionImage.id,
      type: "image",
      directionId: "direction-soft-rail",
      visualBranchId: "visual-branch-soft-rail-detail"
    });

    const crossDirection = assignImageToVisualBranch(
      assigned.workspace,
      "image-support-island-preview",
      "visual-branch-soft-rail-detail"
    );
    expect(crossDirection.status).toBe("blocked");
    if (crossDirection.status === "blocked") {
      expect(crossDirection.reason).toContain("跨方向");
    }

    const removed = removeImageFromVisualBranch(assigned.workspace, withoutDirectionImage.id);
    expect(removed.status).toBe("updated");
    if (removed.status !== "updated") {
      throw new Error(removed.reason);
    }
    expect(removed.workspace.objects[withoutDirectionImage.id]).toMatchObject({
      id: withoutDirectionImage.id,
      type: "image",
      directionId: "direction-soft-rail",
      visualBranchId: undefined
    });
  });

  it("does not include the default reference in non-visual AI context", () => {
    const workspace = createInitialWorkspace();

    const context = assembleAiContext(workspace, {
      draft: "帮我整理当前项目的交付缺口。",
      selectedObjectIds: [],
      explicitObjectIds: [],
      task: "deliveryPreparation"
    });

    expect(context.objectIds).not.toContain("image-soft-rail-v2");
    expect(context.defaultReferenceStatus).toEqual({ status: "notRelevant" });
  });

  it("imports text, URL, image, and file inputs as explicit typed objects with asset references", () => {
    const workspace = createBlankWorkspace("project-imports");
    const withText = importTextObject(workspace, {
      text: "低施工、夜间起身、柔光路径。",
      position: { x: 120, y: 140 }
    }).workspace;
    const withUrl = importUrlObject(withText, {
      url: "https://example.com/night-path",
      title: "夜间路径资料",
      position: { x: 360, y: 140 }
    }).workspace;
    const imported = importAssetBackedObjects(withUrl, {
      assets: [
        {
          id: "asset-image-a",
          fileName: "reference.png",
          mimeType: "image/png",
          size: 1234,
          createdAt: "2026-06-24T00:00:00.000Z",
          storageKey: "blob:asset-image-a",
          sourceType: "originalImage"
        },
        {
          id: "asset-file-a",
          fileName: "brief.pdf",
          mimeType: "application/pdf",
          size: 4321,
          createdAt: "2026-06-24T00:00:00.000Z",
          storageKey: "blob:asset-file-a",
          sourceType: "originalFile"
        }
      ],
      position: { x: 120, y: 360 }
    });

    const objects = Object.values(imported.workspace.objects);
    expect(objects.some((object) => object.type === "text" && object.body === "低施工、夜间起身、柔光路径。")).toBe(
      true
    );
    expect(objects.some((object) => object.type === "link" && object.domain === "example.com")).toBe(true);
    expect(objects.some((object) => object.type === "image" && object.assetId === "asset-image-a")).toBe(true);
    expect(objects.some((object) => object.type === "file" && object.assetId === "asset-file-a")).toBe(true);
    expect(imported.workspace.assets["asset-image-a"]?.sourceType).toBe("originalImage");
    expect(imported.workspace.assets["asset-file-a"]?.sourceType).toBe("originalFile");
  });

  it("migrates v1 workspace data to schema v9 without mutating the source object", () => {
    const legacyWorkspace = {
      schemaVersion: 1,
      project: {
        id: "legacy-project",
        title: "Legacy",
        subtitle: "旧数据",
        currentFocus: "direction_visual_development"
      },
      objects: {
        "image-a": {
          id: "image-a",
          type: "image",
          title: "旧主图",
          summary: "旧版本图片",
          createdBy: "ai",
          role: "main",
          imageVariant: "rail",
          isDefaultReference: true
        },
        "delivery-a": {
          id: "delivery-a",
          type: "delivery",
          title: "旧交付模块",
          summary: "旧版本交付",
          createdBy: "user",
          format: "board",
          references: ["image-a"],
          gaps: []
        }
      },
      relations: [],
      canvas: {
        view: { x: 0, y: 0, zoom: 1 },
        instances: []
      },
      ai: {
        messages: []
      }
    };
    const before = structuredClone(legacyWorkspace);

    const result = migrateWorkspaceToCurrentSchema(legacyWorkspace);

    expect(result.status).toBe("ok");
    expect(legacyWorkspace).toEqual(before);
    if (result.status === "ok") {
      expect(result.workspace.schemaVersion).toBe(9);
      expect(result.workspace.objects["image-a"]?.visibility).toBe("active");
      expect(result.workspace.objects["image-a"]).toMatchObject({
        type: "image",
        role: "primaryVisual"
      });
      expect(result.workspace.assets).toBeDefined();
      expect(result.workspace.operations).toEqual({});
      expect(result.workspace.artifactProposals).toEqual({});
      expect(result.workspace.citationSnapshots).toEqual({});
      expect(Object.values(result.workspace.deliveryReferences)).toHaveLength(1);
      expect(result.workspace.objects["delivery-a"]?.type).toBe("delivery");
      const deliveryObject = result.workspace.objects["delivery-a"];
      expect(deliveryObject?.type).toBe("delivery");
      if (deliveryObject?.type !== "delivery") {
        throw new Error("Expected migrated object to be a delivery object.");
      }
      expect(deliveryObject.references).toEqual(["delivery-ref-delivery-a-image-a"]);
      expect(result.workspace.projectContinuity.currentFocus).toMatchObject({
        area: "directionAndVisual",
        sourceKind: "migration"
      });
      expect(result.workspace.projectContinuity.schemaVersion).toBe(2);
      expect(result.workspace).not.toHaveProperty("stageRecords");
    }
  });

  it("migrates v8 project continuity entries to v9 deterministic active entries without inventing semantic patches", () => {
    const workspace = createInitialWorkspace();
    const v8Workspace = {
      ...workspace,
      schemaVersion: 8,
      projectContinuity: {
        schemaVersion: 1,
        currentFocus: workspace.projectContinuity.currentFocus,
        recordEntries: [
          {
            id: "continuity-legacy",
            dedupeKey: "legacy:event",
            stage: "research",
            category: "decision",
            summary: "旧版连续性记录。",
            sourceRefs: [
              {
                kind: "object",
                id: "research-night-path",
                snapshot: {
                  title: "夜间路径研究",
                  objectType: "research",
                  visibility: "active"
                }
              }
            ],
            createdAt: "2026-06-30T08:00:00.000Z",
            updatedAt: "2026-06-30T08:00:00.000Z",
            validity: "current"
          }
        ],
        updatedAt: "2026-06-30T08:00:00.000Z"
      }
    };

    const result = migrateWorkspaceToCurrentSchema(v8Workspace);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error(result.reason);
    }
    expect(result.didMigrate).toBe(true);
    expect(result.workspace.schemaVersion).toBe(9);
    expect(result.workspace.projectContinuity.schemaVersion).toBe(2);
    expect(result.workspace.projectContinuity.recordEntries).toEqual([
      expect.objectContaining({
        id: "continuity-legacy",
        origin: "deterministicEvent",
        manualState: "active",
        semanticKind: undefined,
        sourceMessageId: undefined
      })
    ]);
    expect(result.workspace.objects["research-night-path"]).toBeDefined();
    expect(result.workspace.visualBranches).toEqual(workspace.visualBranches);
    expect(result.workspace.decisionRecords).toEqual(workspace.decisionRecords);
  });

  it("reports migration failure without producing replacement seed data", () => {
    const result = migrateWorkspaceToCurrentSchema({ schemaVersion: 99, objects: {} });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error("Expected migration to fail.");
    }
    expect(result.reason).toBe("Unsupported Morpho workspace schema version.");
  });
});
