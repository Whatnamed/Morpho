// @vitest-environment happy-dom

import { act, createElement, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeliverySectionDraft } from "@/domain/morpho/deliveryPreparation";
import { importTextObject } from "@/domain/morpho/imports";
import { createBlankWorkspace, createInitialWorkspace, hideObject } from "@/domain/morpho/workspace";
import type { DeliveryObject, MorphoWorkspace } from "@/domain/morpho/types";

import {
  useDeliveryPreparationController,
  type DeliveryPreparationController,
  type UseDeliveryPreparationControllerInput
} from "./useDeliveryPreparationController";

const roots: Root[] = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await act(async () => root.unmount());
    }
  }
  document.body.replaceChildren();
});

describe("useDeliveryPreparationController", () => {
  it("opens and closes while selecting a valid requested delivery", async () => {
    const harness = await renderController({ initialWorkspace: createInitialWorkspace() });

    act(() => harness.current().open("delivery-ppt-six"));

    expect(harness.current().isOpen).toBe(true);
    expect(harness.current().activeDeliveryObjectId).toBe("delivery-ppt-six");

    act(() => harness.current().close());

    expect(harness.current().isOpen).toBe(false);
  });

  it("falls back from a removed requested delivery without writing workspace state", async () => {
    const harness = await renderController({ initialWorkspace: createInitialWorkspace() });
    const before = harness.workspace();

    act(() => harness.current().open("delivery-board-a1"));
    expect(harness.current().activeDeliveryObjectId).toBe("delivery-board-a1");

    act(() => {
      harness.updateWorkspace((current) => ({
        ...current,
        objects: Object.fromEntries(Object.entries(current.objects).filter(([id]) => id !== "delivery-board-a1"))
      }));
    });

    expect(harness.current().activeDeliveryObjectId).toBe("delivery-ppt-six");
    expect(harness.workspace()).not.toBe(before);

    const afterFirstRemoval = harness.workspace();
    act(() => {
      harness.updateWorkspace((current) => ({
        ...current,
        objects: Object.fromEntries(Object.entries(current.objects).filter(([object]) => !object.startsWith("delivery-")))
      }));
    });

    expect(harness.current().activeDeliveryObjectId).toBeNull();
    expect(harness.workspace()).not.toBe(afterFirstRemoval);
  });

  it("selects another delivery and clears the active section", async () => {
    const harness = await renderController({ initialWorkspace: createInitialWorkspace() });
    const board = getDelivery(harness.workspace(), "delivery-board-a1");
    const sectionId = board.sections[0]?.id;
    if (!sectionId) {
      throw new Error("Expected a delivery section.");
    }

    act(() => {
      harness.current().open(board.id);
      harness.current().selectSection(sectionId);
    });
    expect(harness.current().activeSectionId).toBe(sectionId);

    act(() => harness.current().selectDelivery("delivery-ppt-six"));

    expect(harness.current().activeDeliveryObjectId).toBe("delivery-ppt-six");
    expect(harness.current().activeSectionId).toBeNull();
  });

  it("creates a delivery from the latest workspace view and notifies the page once", async () => {
    const base = createBlankWorkspace("project-delivery-controller-create");
    const workspace: MorphoWorkspace = {
      ...base,
      canvas: {
        ...base.canvas,
        view: { x: 120, y: 80, zoom: 1.25 }
      }
    };
    const onDeliveryCreated = vi.fn();
    const harness = await renderController({ initialWorkspace: workspace, onDeliveryCreated });
    let concurrentObjectId = "";

    act(() => {
      harness.updateWorkspace((current) => {
        const imported = importTextObject(current, {
          text: "Concurrent workspace note",
          position: { x: 800, y: 400 }
        });
        concurrentObjectId = imported.objectIds[0] ?? "";
        return imported.workspace;
      });
    });

    let result!: ReturnType<DeliveryPreparationController["createDelivery"]>;
    act(() => {
      result = harness.current().createDelivery({ title: "Controller delivery", format: "board" });
    });

    expect(result.status).toBe("created");
    if (result.status !== "created") {
      throw new Error(result.reason);
    }
    const createdDeliveryObjectId = result.deliveryObjectId;
    expect(onDeliveryCreated).toHaveBeenCalledTimes(1);
    expect(onDeliveryCreated).toHaveBeenCalledWith(createdDeliveryObjectId);
    expect(harness.current().activeDeliveryObjectId).toBe(createdDeliveryObjectId);
    expect(harness.current().activeSectionId).toBeNull();
    expect(harness.workspace().objects[concurrentObjectId]).toMatchObject({ type: "text" });
    expect(getDelivery(harness.workspace(), createdDeliveryObjectId).sections.length).toBeGreaterThan(0);

    const instance = harness.workspace().canvas.instances.find((candidate) => candidate.objectId === createdDeliveryObjectId);
    expect(instance?.position).toEqual({ x: 340, y: 260 });
  });

  it("uses the latest workspace for a reference mutation and keeps concurrent objects", async () => {
    const harness = await renderController({ initialWorkspace: createInitialWorkspace() });
    const delivery = getDelivery(harness.workspace(), "delivery-board-a1");
    const sectionId = delivery.sections[0]?.id;
    if (!sectionId) {
      throw new Error("Expected a delivery section.");
    }
    let concurrentObjectId = "";

    act(() => {
      harness.updateWorkspace((current) => {
        const imported = importTextObject(current, {
          text: "Added after controller render",
          position: { x: 520, y: 320 }
        });
        concurrentObjectId = imported.objectIds[0] ?? "";
        return imported.workspace;
      });
    });

    let result!: ReturnType<DeliveryPreparationController["addSelectedObjects"]>;
    act(() => {
      result = harness.current().addSelectedObjects({
        deliveryObjectId: delivery.id,
        sectionId,
        sourceObjectIds: [concurrentObjectId]
      });
    });

    expect(result.status).toBe("updated");
    expect(harness.workspace().objects[concurrentObjectId]).toMatchObject({ type: "text" });
    expect(getDelivery(harness.workspace(), delivery.id).sections[0]?.referenceIds).toHaveLength(1);
  });

  it("returns blocked reasons once and preserves the active state", async () => {
    const onBlocked = vi.fn();
    const harness = await renderController({ initialWorkspace: createInitialWorkspace(), onBlocked });
    act(() => harness.current().open("delivery-board-a1"));
    const before = harness.workspace();
    const activeBefore = harness.current().activeDeliveryObjectId;

    let result!: ReturnType<DeliveryPreparationController["createSection"]>;
    act(() => {
      result = harness.current().createSection({
        deliveryObjectId: "missing-delivery",
        title: "不会创建"
      });
    });

    expect(result).toEqual({ status: "blocked", reason: "交付准备包不存在。" });
    expect(harness.workspace()).toBe(before);
    expect(harness.current().activeDeliveryObjectId).toBe(activeBefore);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenLastCalledWith("交付准备包不存在。");
  });

  it("creates, updates, moves, and removes sections through the domain functions", async () => {
    const harness = await renderController({ initialWorkspace: createInitialWorkspace() });
    const delivery = getDelivery(harness.workspace(), "delivery-board-a1");

    let created!: ReturnType<DeliveryPreparationController["createSection"]>;
    act(() => {
      created = harness.current().createSection({
        deliveryObjectId: delivery.id,
        title: "新章节",
        purpose: "补充说明"
      });
    });
    expect(created.status).toBe("updated");
    const createdSection = getDelivery(harness.workspace(), delivery.id).sections.find((section) => section.title === "新章节");
    if (!createdSection) {
      throw new Error("Expected created section.");
    }

    let updated!: ReturnType<DeliveryPreparationController["updateSection"]>;
    act(() => {
      updated = harness.current().updateSection({
        deliveryObjectId: delivery.id,
        sectionId: createdSection.id,
        title: "新章节已更新",
        narrative: "章节说明"
      });
    });
    expect(updated.status).toBe("updated");

    act(() => {
      const moved = harness.current().moveSection({ deliveryObjectId: delivery.id, sectionId: createdSection.id, toIndex: 0 });
      expect(moved.status).toBe("updated");
    });
    expect(getDelivery(harness.workspace(), delivery.id).sections[0]?.id).toBe(createdSection.id);

    let removed!: ReturnType<DeliveryPreparationController["removeSection"]>;
    act(() => {
      removed = harness.current().removeSection({ deliveryObjectId: delivery.id, sectionId: createdSection.id });
    });
    expect(removed).toEqual({ status: "updated" });
    expect(getDelivery(harness.workspace(), delivery.id).sections.some((section) => section.id === createdSection.id)).toBe(false);
  });

  it("adds, moves, edits, and removes real delivery references", async () => {
    const harness = await renderController({ initialWorkspace: createInitialWorkspace() });
    const delivery = getDelivery(harness.workspace(), "delivery-board-a1");
    const firstSectionId = delivery.sections[0]?.id;
    const secondSectionId = delivery.sections[1]?.id;
    if (!firstSectionId || !secondSectionId) {
      throw new Error("Expected two delivery sections.");
    }

    let added!: ReturnType<DeliveryPreparationController["addSelectedObjects"]>;
    act(() => {
      added = harness.current().addSelectedObjects({
        deliveryObjectId: delivery.id,
        sectionId: firstSectionId,
        sourceObjectIds: ["research-night-path"]
      });
    });
    expect(added.status).toBe("updated");
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    const referenceId = added.createdReferenceIds[0];
    if (!referenceId) {
      throw new Error("Expected created reference.");
    }

    expect(
      harness.current().moveReference({
        deliveryObjectId: delivery.id,
        referenceId,
        toSectionId: secondSectionId,
        toIndex: 0
      }).status
    ).toBe("updated");
    expect(
      harness.current().updateReferenceEditorial({
        deliveryObjectId: delivery.id,
        referenceId,
        caption: "图注",
        note: "备注"
      }).status
    ).toBe("updated");
    expect(harness.workspace().deliveryReferences[referenceId]?.editorial).toEqual({ caption: "图注", note: "备注" });
    expect(
      harness.current().removeReference({ deliveryObjectId: delivery.id, referenceId }).status
    ).toBe("updated");
    expect(harness.workspace().deliveryReferences[referenceId]).toBeUndefined();
  });

  it("refreshes a changed reference with the fixed reason and blocks unavailable sources", async () => {
    const onBlocked = vi.fn();
    const harness = await renderController({ initialWorkspace: createInitialWorkspace(), onBlocked });
    const delivery = getDelivery(harness.workspace(), "delivery-board-a1");
    const sectionId = delivery.sections[0]?.id;
    if (!sectionId) {
      throw new Error("Expected a delivery section.");
    }
    const added = harness.current().addSelectedObjects({
      deliveryObjectId: delivery.id,
      sectionId,
      sourceObjectIds: ["image-soft-rail-v2"]
    });
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    const referenceId = added.createdReferenceIds[0];
    if (!referenceId) {
      throw new Error("Expected created reference.");
    }
    act(() => {
      harness.updateWorkspace((current) => {
        const source = current.objects["image-soft-rail-v2"];
        if (!source) {
          return current;
        }
        return {
          ...current,
          objects: {
            ...current.objects,
            [source.id]: { ...source, title: "更新后的主图" }
          }
        };
      });
    });

    expect(harness.current().refreshReference({ deliveryObjectId: delivery.id, referenceId }).status).toBe("updated");
    expect(harness.workspace().deliveryReferences[referenceId]?.snapshot.title).toBe("更新后的主图");
    expect(harness.workspace().decisionRecords.at(-1)?.reason).toBe("用户在交付准备面板中确认更新为当前版本。");

    act(() => {
      harness.updateWorkspace((current) => hideObject(current, "image-soft-rail-v2"));
    });
    const beforeBlocked = harness.workspace();
    const callCountBeforeBlocked = onBlocked.mock.calls.length;
    const blocked = harness.current().refreshReference({ deliveryObjectId: delivery.id, referenceId });
    expect(blocked).toEqual({ status: "blocked", reason: "来源不可用，不能更新引用。" });
    expect(harness.workspace()).toBe(beforeBlocked);
    expect(onBlocked).toHaveBeenCalledTimes(callCountBeforeBlocked + 1);
  });

  it("adds, resolves, reopens, and removes manual gaps", async () => {
    const harness = await renderController({ initialWorkspace: createInitialWorkspace() });
    const delivery = getDelivery(harness.workspace(), "delivery-board-a1");
    const sectionId = delivery.sections[0]?.id;
    if (!sectionId) {
      throw new Error("Expected a delivery section.");
    }

    const added = harness.current().addGap({ deliveryObjectId: delivery.id, sectionId, label: "补一张示意图" });
    expect(added.status).toBe("updated");
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    expect(getDelivery(harness.workspace(), delivery.id).gaps.find((gap) => gap.id === added.gapId)).toMatchObject({
      id: added.gapId,
      sectionId,
      origin: "manual",
      status: "open"
    });

    expect(harness.current().setGapStatus({ deliveryObjectId: delivery.id, gapId: added.gapId, status: "resolved" })).toEqual({
      status: "updated"
    });
    expect(harness.current().setGapStatus({ deliveryObjectId: delivery.id, gapId: added.gapId, status: "open" })).toEqual({
      status: "updated"
    });
    expect(harness.current().removeGap({ deliveryObjectId: delivery.id, gapId: added.gapId })).toEqual({ status: "updated" });
    expect(getDelivery(harness.workspace(), delivery.id).gaps.some((gap) => gap.id === added.gapId)).toBe(false);
  });

  it("applies and discards real pending section drafts", async () => {
    const harness = await renderController({ initialWorkspace: createInitialWorkspace() });
    const delivery = getDelivery(harness.workspace(), "delivery-board-a1");
    const sectionId = delivery.sections[0]?.id;
    if (!sectionId) {
      throw new Error("Expected a delivery section.");
    }
    const added = harness.current().addSelectedObjects({
      deliveryObjectId: delivery.id,
      sectionId,
      sourceObjectIds: ["research-night-path"]
    });
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    const referenceId = added.createdReferenceIds[0];
    if (!referenceId) {
      throw new Error("Expected created reference.");
    }

    const draft = createDeliverySectionDraft(harness.workspace(), {
      deliveryObjectId: delivery.id,
      sectionId,
      userMessageId: "user-draft-1",
      assistantMessageId: "assistant-draft-1",
      title: "应用标题",
      narrative: "应用说明",
      captions: [{ referenceId, caption: "应用图注" }],
      suggestedGaps: [{ label: "应用待补" }]
    });
    if (draft.status !== "updated") {
      throw new Error(draft.reason);
    }
    act(() => harness.updateWorkspace(() => draft.workspace));

    expect(harness.current().applyDraft({ deliveryObjectId: delivery.id, draftId: draft.draftId })).toEqual({ status: "updated" });
    expect(getDelivery(harness.workspace(), delivery.id).sections[0]).toMatchObject({ narrative: "应用说明" });
    expect(harness.workspace().deliverySectionDrafts[draft.draftId]?.status).toBe("applied");

    const secondDraft = createDeliverySectionDraft(harness.workspace(), {
      deliveryObjectId: delivery.id,
      sectionId,
      userMessageId: "user-draft-2",
      assistantMessageId: "assistant-draft-2",
      narrative: "放弃说明",
      captions: [],
      suggestedGaps: []
    });
    if (secondDraft.status !== "updated") {
      throw new Error(secondDraft.reason);
    }
    act(() => harness.updateWorkspace(() => secondDraft.workspace));
    expect(harness.current().discardDraft({ deliveryObjectId: delivery.id, draftId: secondDraft.draftId })).toEqual({ status: "updated" });
    expect(harness.workspace().deliverySectionDrafts[secondDraft.draftId]?.status).toBe("discarded");
  });

  it("blocks section draft requests without changing pending target or workspace", async () => {
    const onBlocked = vi.fn();
    const workspace = createInitialWorkspace();
    const harness = await renderController({ initialWorkspace: workspace, onBlocked });
    const before = harness.workspace();

    expect(harness.current().requestSectionDraft({ deliveryObjectId: "missing-delivery", sectionId: "missing-section" })).toEqual({
      status: "blocked",
      reason: "交付准备包不可用。"
    });
    const delivery = getDelivery(harness.workspace(), "delivery-board-a1");
    const sectionId = delivery.sections[0]?.id ?? "";
    expect(harness.current().requestSectionDraft({ deliveryObjectId: delivery.id, sectionId })).toEqual({
      status: "blocked",
      reason: "请先为本章节加入至少一项交付引用。"
    });
    expect(harness.current().pendingDraftTarget).toBeNull();
    expect(harness.workspace()).toBe(before);
    expect(onBlocked).toHaveBeenCalledTimes(2);
  });

  it("builds the exact section draft prompt and clears its pending target", async () => {
    const harness = await renderController({ initialWorkspace: createInitialWorkspace() });
    const delivery = getDelivery(harness.workspace(), "delivery-board-a1");
    const sectionId = delivery.sections[0]?.id;
    if (!sectionId) {
      throw new Error("Expected a delivery section.");
    }
    const added = harness.current().addSelectedObjects({
      deliveryObjectId: delivery.id,
      sectionId,
      sourceObjectIds: ["research-night-path"]
    });
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    const beforeRequest = harness.workspace();

    let result!: ReturnType<DeliveryPreparationController["requestSectionDraft"]>;
    act(() => {
      result = harness.current().requestSectionDraft({ deliveryObjectId: delivery.id, sectionId });
    });

    expect(result).toEqual({
      status: "ready",
      target: { deliveryObjectId: delivery.id, sectionId },
      prompt: `请基于“${getDelivery(harness.workspace(), delivery.id).sections[0]?.title}”这一节的交付引用快照，生成一份本节说明草稿，并给出必要的图注和待补内容建议。`
    });
    expect(harness.workspace()).toBe(beforeRequest);
    expect(harness.current().pendingDraftTarget).toEqual({ deliveryObjectId: delivery.id, sectionId });
    expect(harness.current().activeDeliveryObjectId).toBe(delivery.id);

    act(() => harness.current().clearPendingDraftTarget());
    expect(harness.current().pendingDraftTarget).toBeNull();
  });

  it("clears active and pending delivery state without exposing it during a project change", async () => {
    const harness = await renderController({ initialWorkspace: createInitialWorkspace() });
    const delivery = getDelivery(harness.workspace(), "delivery-board-a1");
    const sectionId = delivery.sections[0]?.id;
    if (!sectionId) {
      throw new Error("Expected a delivery section.");
    }
    let added!: ReturnType<DeliveryPreparationController["addSelectedObjects"]>;
    act(() => {
      added = harness.current().addSelectedObjects({
        deliveryObjectId: delivery.id,
        sectionId,
        sourceObjectIds: ["research-night-path"]
      });
    });
    if (added.status !== "updated") {
      throw new Error(added.reason);
    }
    act(() => harness.current().open(delivery.id));
    let draftRequest!: ReturnType<DeliveryPreparationController["requestSectionDraft"]>;
    act(() => {
      draftRequest = harness.current().requestSectionDraft({ deliveryObjectId: delivery.id, sectionId });
    });
    expect(draftRequest.status).toBe("ready");
    expect(harness.current().pendingDraftTarget).not.toBeNull();

    const snapshotStart = harness.snapshots().length;
    act(() => {
      harness.switchProject("project-delivery-new", createBlankWorkspace("project-delivery-new"));
    });

    const newProjectSnapshots = harness.snapshots().slice(snapshotStart).filter((snapshot) => snapshot.projectId === "project-delivery-new");
    expect(newProjectSnapshots.length).toBeGreaterThan(0);
    for (const snapshot of newProjectSnapshots) {
      expect(snapshot.isOpen).toBe(false);
      expect(snapshot.activeDeliveryObjectId).toBeNull();
      expect(snapshot.activeSectionId).toBeNull();
      expect(snapshot.pendingDraftTarget).toBeNull();
    }
    expect(harness.current().isOpen).toBe(false);
    expect(harness.current().activeDeliveryObjectId).toBeNull();
    expect(harness.current().activeSectionId).toBeNull();
    expect(harness.current().pendingDraftTarget).toBeNull();
  });

  it("blocks stale domain operations after A to B to A2", async () => {
    const harness = await renderController({ initialWorkspace: createInitialWorkspace() });
    const staleCreateDelivery = harness.current().createDelivery;
    const staleCreateSection = harness.current().createSection;

    act(() => {
      harness.switchProject("project-delivery-b", createBlankWorkspace("project-delivery-b"));
    });
    const projectA2 = createBlankWorkspace("project-delivery-a2");
    act(() => {
      harness.switchProject("project-delivery-a2", projectA2);
    });
    const before = harness.workspace();

    let createDeliveryResult!: ReturnType<DeliveryPreparationController["createDelivery"]>;
    let createSectionResult!: ReturnType<DeliveryPreparationController["createSection"]>;
    act(() => {
      createDeliveryResult = staleCreateDelivery({ title: "stale", format: "board" });
      createSectionResult = staleCreateSection({
        deliveryObjectId: "delivery-board-a1",
        title: "stale section",
        purpose: "stale"
      });
    });

    expect(createDeliveryResult.status).toBe("blocked");
    expect(createSectionResult.status).toBe("blocked");
    expect(harness.workspace()).toBe(before);
  });
});

type RenderControllerInput = Omit<UseDeliveryPreparationControllerInput, "projectId" | "workspace" | "updateWorkspace" | "workspaceReady"> & {
  initialWorkspace: MorphoWorkspace;
  projectId?: string;
  workspaceReady?: boolean;
};

type ControllerSnapshot = { projectId: string } &
  Pick<DeliveryPreparationController, "isOpen" | "activeDeliveryObjectId" | "activeSectionId" | "pendingDraftTarget">;

async function renderController(initialInput: RenderControllerInput) {
  let controller: DeliveryPreparationController | null = null;
  let workspace = initialInput.initialWorkspace;
  let updateWorkspace: Dispatch<SetStateAction<MorphoWorkspace>> | null = null;
  let setProjectId: Dispatch<SetStateAction<string>> | null = null;
  const snapshots: ControllerSnapshot[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  function Harness({ input }: { input: RenderControllerInput }) {
    const [currentWorkspace, setCurrentWorkspace] = useState(input.initialWorkspace);
    const [currentProjectId, setCurrentProjectId] = useState(input.initialWorkspace.project.id);
    workspace = currentWorkspace;
    updateWorkspace = setCurrentWorkspace;
    setProjectId = setCurrentProjectId;
    const currentController = useDeliveryPreparationController({
      ...input,
      projectId: currentProjectId,
      workspaceReady: input.workspaceReady ?? true,
      workspace: currentWorkspace,
      updateWorkspace: setCurrentWorkspace
    });
    controller = currentController;
    snapshots.push({
      projectId: currentProjectId,
      isOpen: currentController.isOpen,
      activeDeliveryObjectId: currentController.activeDeliveryObjectId,
      activeSectionId: currentController.activeSectionId,
      pendingDraftTarget: currentController.pendingDraftTarget
    });
    return null;
  }

  await act(async () => {
    root.render(createElement(Harness, { input: initialInput }));
  });

  return {
    current: () => {
      if (!controller) {
        throw new Error("Controller did not render.");
      }
      return controller;
    },
    workspace: () => workspace,
    snapshots: () => [...snapshots],
    updateWorkspace: (action: SetStateAction<MorphoWorkspace>) => {
      if (!updateWorkspace) {
        throw new Error("Workspace setter is unavailable.");
      }
      updateWorkspace(action);
    },
    switchProject: (projectId: string, nextWorkspace: MorphoWorkspace) => {
      if (!setProjectId || !updateWorkspace) {
        throw new Error("Controller setters are unavailable.");
      }
      setProjectId(projectId);
      updateWorkspace(nextWorkspace);
    }
  };
}

function getDelivery(workspace: MorphoWorkspace, objectId: string): DeliveryObject {
  const object = workspace.objects[objectId];
  if (!object || object.type !== "delivery") {
    throw new Error(`Expected delivery object ${objectId}.`);
  }
  return object;
}
