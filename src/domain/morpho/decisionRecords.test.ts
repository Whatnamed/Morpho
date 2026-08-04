import { describe, expect, it } from "vitest";

import { classifyDecisionRecords } from "./decisionRecords";
import { createInitialWorkspace, setConceptDirectionStatus, setDefaultReference, setKeyConclusionCategory } from "./workspace";

describe("decision record classification", () => {
  it("marks an earlier direction status as superseded after a later status change", () => {
    const primary = setConceptDirectionStatus(
      createInitialWorkspace(),
      "direction-soft-rail",
      "primary",
      "作为当前主方向"
    );
    const changed = setConceptDirectionStatus(
      primary,
      "direction-soft-rail",
      "alternative",
      "改为备选方向"
    );
    const classified = classifyDecisionRecords(changed);

    expect(classified.find((item) => item.record.summary.endsWith("-> primary"))).toMatchObject({
      state: "superseded"
    });
    expect(classified.find((item) => item.record.summary.endsWith("-> alternative"))).toMatchObject({
      state: "current"
    });
  });

  it("marks an old default reference as superseded when the project replaces it", () => {
    const workspace = withAvailableImages(createInitialWorkspace());
    const firstDefaultId = workspace.workingState.currentDefaultReferenceId;
    if (!firstDefaultId) {
      throw new Error("Expected the case-study workspace to have a default reference.");
    }
    const changed = setDefaultReference(workspace, "image-support-island-preview", {
      reason: "改用另一方向作为全局基线。"
    });
    const classified = classifyDecisionRecords(changed);

    expect(classified.find((item) => item.record.objectSnapshot?.id === firstDefaultId)).toMatchObject({
      state: "superseded"
    });
    expect(classified.find((item) => item.record.objectSnapshot?.id === "image-support-island-preview")).toMatchObject({
      state: "current"
    });
  });

  it("marks the first manual key-conclusion category assignment as current", () => {
    const target = getUnknownKeyConclusion(createInitialWorkspace());
    const result = setKeyConclusionCategory(target.workspace, target.object.id, "finding", {
      reason: "用户补充类别。"
    });
    if (result.status !== "updated") {
      throw new Error(result.reason);
    }

    const record = classifyDecisionRecords(result.workspace).find(
      (item) => item.record.kind === "setKeyConclusionCategory"
    );
    expect(record).toMatchObject({ state: "current" });
  });

  it("marks an earlier key-conclusion category assignment as superseded after a later change", () => {
    const target = getUnknownKeyConclusion(createInitialWorkspace());
    const first = setKeyConclusionCategory(target.workspace, target.object.id, "finding");
    if (first.status !== "updated") {
      throw new Error(first.reason);
    }
    const second = setKeyConclusionCategory(first.workspace, target.object.id, "opportunity");
    if (second.status !== "updated") {
      throw new Error(second.reason);
    }

    const classified = classifyDecisionRecords(second.workspace);
    expect(classified.find((item) => item.record.summary.endsWith("→ finding"))).toMatchObject({
      state: "superseded"
    });
    expect(classified.find((item) => item.record.summary.endsWith("→ opportunity"))).toMatchObject({
      state: "current"
    });
  });

  it("does not call a decision current when its source object cannot be resolved", () => {
    const workspace = createInitialWorkspace();
    const withMissingDecision = {
      ...workspace,
      decisionRecords: [
        ...workspace.decisionRecords,
        {
          id: "decision-missing-source",
          kind: "applyConceptDirection" as const,
          createdAt: "2026-07-13T12:00:00.000Z",
          summary: "应用不存在的方向",
          relatedObjectIds: ["direction-deleted"],
          objectSnapshot: { id: "direction-deleted", type: "conceptDirection" as const, title: "已删除方向" }
        }
      ]
    };

    expect(classifyDecisionRecords(withMissingDecision).at(-1)).toMatchObject({
      state: "reviewRequired"
    });
  });
});

function withAvailableImages(workspace: ReturnType<typeof createInitialWorkspace>) {
  const objects = { ...workspace.objects };
  for (const object of Object.values(objects)) {
    if (object.type === "image") {
      objects[object.id] = { ...object, assetId: `asset-${object.id}` };
    }
  }
  return { ...workspace, objects };
}

function getUnknownKeyConclusion(workspace: ReturnType<typeof createInitialWorkspace>) {
  const object = Object.values(workspace.objects).find((candidate) => candidate.type === "keyConclusion");
  if (!object || object.type !== "keyConclusion") {
    throw new Error("Expected a key conclusion fixture.");
  }
  return {
    workspace: {
      ...workspace,
      objects: {
        ...workspace.objects,
        [object.id]: { ...object, category: "unknown" as const }
      }
    },
    object
  };
}
