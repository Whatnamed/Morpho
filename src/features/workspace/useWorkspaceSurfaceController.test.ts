// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useWorkspaceSurfaceController,
  type WorkspaceCanvasContextMenuState,
  type WorkspaceExternalSurfacePorts,
  type WorkspaceSurfaceController,
  type UseWorkspaceSurfaceControllerInput
} from "./useWorkspaceSurfaceController";

const roots: Root[] = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  vi.restoreAllMocks();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await act(async () => root.unmount());
    }
  }
  document.body.replaceChildren();
});

describe("useWorkspaceSurfaceController", () => {
  it("opens, switches, and closes drawers while keeping anchor semantics", async () => {
    const harness = await renderController(createInput());
    const firstAnchor = makeAnchor(10);
    const secondAnchor = makeAnchor(20);

    act(() => harness.current().openDrawer("map", firstAnchor));
    expect(harness.current()).toMatchObject({ activeDrawer: "map", drawerAnchor: firstAnchor });

    act(() => harness.current().changeDrawer("assets", secondAnchor));
    expect(harness.current()).toMatchObject({ activeDrawer: "assets", drawerAnchor: secondAnchor });

    act(() => harness.current().closeDrawer());
    expect(harness.current()).toMatchObject({ activeDrawer: null, drawerAnchor: null });
  });

  it("opens project records with the requested highlights and clears them when called without ids", async () => {
    const harness = await renderController(createInput());

    act(() => harness.current().openProjectRecords(["record-a", "record-b"]));
    expect(harness.current()).toMatchObject({
      activeDrawer: "records",
      highlightedContinuityEntryIds: ["record-a", "record-b"]
    });

    act(() => harness.current().openProjectRecords());
    expect(harness.current().highlightedContinuityEntryIds).toEqual([]);
  });

  it("closes only the drawer for Escape and removes both global listeners on unmount", async () => {
    const removeWindowEventListener = vi.spyOn(window, "removeEventListener");
    const removeDocumentEventListener = vi.spyOn(document, "removeEventListener");
    const harness = await renderController(createInput());

    act(() => harness.current().openDrawer("records", makeAnchor(10)));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(harness.current().activeDrawer).toBeNull();

    act(() => harness.current().openDrawer("records", makeAnchor(10)));
    await harness.unmount();
    expect(removeWindowEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(removeDocumentEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
  });

  it("keeps the drawer open for internal pointer targets and closes for an external Element", async () => {
    const harness = await renderController(createInput());
    const selectors = ["left-rail", "project-map", "side-drawer", "search-layer"];

    for (const className of selectors) {
      act(() => harness.current().openDrawer("records"));
      const target = document.createElement("div");
      target.className = className;
      document.body.append(target);
      act(() => target.dispatchEvent(new Event("pointerdown", { bubbles: true })));
      expect(harness.current().activeDrawer).toBe("records");
      target.remove();
    }

    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(harness.current().activeDrawer).toBeNull();
  });

  it("does not close the drawer when pointerdown target is not an Element", async () => {
    const harness = await renderController(createInput());

    act(() => harness.current().openDrawer("records"));
    act(() => document.dispatchEvent(new Event("pointerdown")));

    expect(harness.current().activeDrawer).toBe("records");
  });

  it("resets the rename draft when opening the project menu and keeps direct close behavior", async () => {
    const harness = await renderController(createInput({ projectTitle: "旧项目" }));

    act(() => harness.current().toggleProjectMenu());
    expect(harness.current()).toMatchObject({ projectMenuOpen: true, projectRenameDraft: "旧项目" });
    act(() => harness.current().setProjectRenameDraft("  改过的标题  "));
    act(() => harness.current().closeProjectMenu());
    expect(harness.current()).toMatchObject({ projectMenuOpen: false, projectRenameDraft: "  改过的标题  " });

    act(() => harness.current().toggleProjectMenu());
    expect(harness.current()).toMatchObject({ projectMenuOpen: true, projectRenameDraft: "旧项目" });
  });

  it("consumes blank and unchanged rename drafts without a workspace write", async () => {
    const harness = await renderController(createInput({ projectTitle: "当前标题" }));

    act(() => harness.current().toggleProjectMenu());
    act(() => harness.current().setProjectRenameDraft("   "));
    let result: ReturnType<WorkspaceSurfaceController["consumeProjectRename"]> | undefined;
    act(() => {
      result = harness.current().consumeProjectRename();
    });
    expect(result).toEqual({ status: "unchanged" });
    expect(harness.current()).toMatchObject({ projectMenuOpen: false, projectRenameDraft: "当前标题" });

    act(() => harness.current().toggleProjectMenu());
    act(() => harness.current().setProjectRenameDraft("当前标题"));
    act(() => {
      result = harness.current().consumeProjectRename();
    });
    expect(result).toEqual({ status: "unchanged" });
    expect(harness.current()).toMatchObject({ projectMenuOpen: false, projectRenameDraft: "当前标题" });
  });

  it("returns a trimmed rename intent and only closes the menu", async () => {
    const harness = await renderController(createInput({ projectTitle: "当前标题" }));

    act(() => harness.current().toggleProjectMenu());
    act(() => harness.current().setProjectRenameDraft("  新标题  "));
    let result: ReturnType<WorkspaceSurfaceController["consumeProjectRename"]> | undefined;
    act(() => {
      result = harness.current().consumeProjectRename();
    });
    expect(result).toEqual({ status: "rename", title: "新标题" });
    expect(harness.current().projectMenuOpen).toBe(false);
  });

  it("stores a complete context-menu request with an injected timestamp and preserves the dismiss guard", async () => {
    const harness = await renderController(createInput({ now: () => 1000 }));
    const request = makeContextRequest();

    act(() => harness.current().openCanvasContextMenu(request));
    expect(harness.current().canvasContextMenu).toEqual({ ...request, openedAt: 1000 });
    expect(harness.current().canDismissCanvasContextMenu(1219)).toBe(false);
    expect(harness.current().canDismissCanvasContextMenu(1220)).toBe(true);

    act(() => harness.current().closeCanvasContextMenu());
    expect(harness.current().canvasContextMenu).toBeNull();
  });

  it("keeps detail surfaces asymmetric and closes each detail independently", async () => {
    const harness = await renderController(createInput());

    act(() => harness.current().openResearchDetail("research-a"));
    act(() => harness.current().openProposalDetail("proposal-a"));
    expect(harness.current()).toMatchObject({
      detailProposalId: "proposal-a",
      detailDesignDefinitionId: null,
      detailConceptDirectionId: null,
      activeResearchDetailObjectId: "research-a"
    });

    act(() => harness.current().openDesignDefinitionDetail("definition-a"));
    expect(harness.current()).toMatchObject({
      detailProposalId: null,
      detailDesignDefinitionId: "definition-a",
      detailConceptDirectionId: null,
      activeResearchDetailObjectId: "research-a"
    });

    act(() => harness.current().openConceptDirectionDetail("direction-a"));
    expect(harness.current()).toMatchObject({
      detailProposalId: null,
      detailDesignDefinitionId: null,
      detailConceptDirectionId: "direction-a",
      activeResearchDetailObjectId: "research-a"
    });

    act(() => harness.current().closeConceptDirectionDetail());
    expect(harness.current()).toMatchObject({
      detailConceptDirectionId: null,
      activeResearchDetailObjectId: "research-a"
    });
    act(() => harness.current().closeResearchDetail());
    expect(harness.current().activeResearchDetailObjectId).toBeNull();
  });

  it("closes a proposal detail only when its id is removed", async () => {
    const harness = await renderController(createInput());

    act(() => harness.current().openProposalDetail("proposal-a"));
    act(() => harness.current().closeProposalDetailIf(["proposal-b"]));
    expect(harness.current().detailProposalId).toBe("proposal-a");

    act(() => harness.current().closeProposalDetailIf(["proposal-a", "proposal-c"]));
    expect(harness.current().detailProposalId).toBeNull();
  });

  it("closes one surface at a time in the complete top-surface order", async () => {
    const harness = await renderController(createInput());
    const closed: string[] = [];
    const ports = makePorts(closed);
    const closeTopSurface = () => {
      let result = false;
      act(() => {
        result = harness.current().closeTopSurface(ports);
      });
      return result;
    };

    act(() => harness.current().openCanvasContextMenu(makeContextRequest()));
    act(() => harness.current().openProposalDetail("proposal-a"));
    expect(closeTopSurface()).toBe(true);
    expect(closed).toEqual([]);
    expect(harness.current().canvasContextMenu).toBeNull();
    expect(closeTopSurface()).toBe(true);
    expect(harness.current().detailProposalId).toBeNull();

    act(() => harness.current().openDesignDefinitionDetail("definition-a"));
    expect(closeTopSurface()).toBe(true);
    act(() => harness.current().openConceptDirectionDetail("direction-a"));
    expect(closeTopSurface()).toBe(true);
    act(() => harness.current().openResearchDetail("research-a"));
    expect(closeTopSurface()).toBe(true);

    act(() => {
      harness.current().toggleProjectMenu();
      harness.current().openDrawer("records");
    });
    expect(closeTopSurface()).toBe(true);
    expect(closed).toEqual(["documentReader"]);
    expect(closeTopSurface()).toBe(true);
    expect(closed).toEqual(["documentReader", "deliveryPreparation"]);
    expect(closeTopSurface()).toBe(true);
    expect(closed).toEqual(["documentReader", "deliveryPreparation", "deliveryOutput"]);
    expect(closeTopSurface()).toBe(true);
    expect(closed).toEqual(["documentReader", "deliveryPreparation", "deliveryOutput", "projectBundle"]);
    expect(closeTopSurface()).toBe(true);
    expect(harness.current().projectMenuOpen).toBe(false);
    expect(closeTopSurface()).toBe(true);
    expect(harness.current().activeDrawer).toBeNull();
    expect(closeTopSurface()).toBe(true);
    expect(closed).toEqual([
      "documentReader",
      "deliveryPreparation",
      "deliveryOutput",
      "projectBundle",
      "canvasSelection"
    ]);
    expect(ports.documentReaderOpen).toBe(false);
    expect(ports.deliveryPreparationOpen).toBe(false);
    expect(ports.deliveryOutputOpen).toBe(false);
    expect(ports.projectBundleOpen).toBe(false);
  });

  it("returns the selection clearer result when no surface is open", async () => {
    const harness = await renderController(createInput());
    const closed: string[] = [];
    const ports = makePorts(closed);
    ports.documentReaderOpen = false;
    ports.deliveryPreparationOpen = false;
    ports.deliveryOutputOpen = false;
    ports.projectBundleOpen = false;
    const closeTopSurface = () => {
      let result = false;
      act(() => {
        result = harness.current().closeTopSurface(ports);
      });
      return result;
    };

    ports.clearCanvasSelection = vi.fn(() => false);
    expect(closeTopSurface()).toBe(false);
    expect(ports.clearCanvasSelection).toHaveBeenCalledTimes(1);
    expect(closed).toEqual([]);

    ports.clearCanvasSelection = vi.fn(() => true);
    expect(closeTopSurface()).toBe(true);
  });

  it("makes every first render of a switched project surface-safe", async () => {
    const harness = await renderController(createInput({ projectId: "project-old", projectTitle: "旧项目" }));

    act(() => {
      harness.current().openProjectRecords(["old-record"]);
      harness.current().toggleProjectMenu();
      harness.current().setProjectRenameDraft("旧项目编辑中");
      harness.current().openCanvasContextMenu(makeContextRequest());
      harness.current().openProposalDetail("old-proposal");
      harness.current().openResearchDetail("old-research");
    });

    await harness.rerender(createInput({ projectId: "project-new", projectTitle: "新项目" }));
    const newProjectRenders = harness.snapshots().filter((snapshot) => snapshot.projectId === "project-new");
    expect(newProjectRenders.length).toBeGreaterThan(0);
    for (const snapshot of newProjectRenders) {
      expect(snapshot).toMatchObject({
        activeDrawer: null,
        drawerAnchor: null,
        highlightedContinuityEntryIds: [],
        projectMenuOpen: false,
        canvasContextMenu: null,
        detailProposalId: null,
        detailDesignDefinitionId: null,
        detailConceptDirectionId: null,
        activeResearchDetailObjectId: null
      });
      expect(snapshot.projectRenameDraft).not.toContain("旧项目");
    }
    expect(harness.current().projectRenameDraft).toBe("新项目");
  });

  it("keeps all surfaces closed throughout the asynchronous project switch", async () => {
    const harness = await renderController(
      createInput({ projectId: "project-old", projectTitle: "旧项目", workspaceReady: true })
    );

    act(() => {
      harness.current().openProjectRecords(["old-record"]);
      harness.current().toggleProjectMenu();
      harness.current().openCanvasContextMenu(makeContextRequest());
      harness.current().openProposalDetail("old-proposal");
      harness.current().openResearchDetail("old-research");
    });

    await harness.rerender(
      createInput({ projectId: "project-new", projectTitle: "旧项目", workspaceReady: false })
    );
    let unreadyRenameResult: ReturnType<WorkspaceSurfaceController["consumeProjectRename"]> | undefined;
    act(() => {
      openEverySurface(harness);
      harness.current().setProjectRenameDraft("未命名项目");
      unreadyRenameResult = harness.current().consumeProjectRename();
    });
    expect(unreadyRenameResult).toEqual({ status: "unchanged" });
    expect(harness.current()).toMatchObject({
      activeDrawer: null,
      drawerAnchor: null,
      highlightedContinuityEntryIds: [],
      projectMenuOpen: false,
      projectRenameDraft: "",
      canvasContextMenu: null,
      detailProposalId: null,
      detailDesignDefinitionId: null,
      detailConceptDirectionId: null,
      activeResearchDetailObjectId: null
    });

    await harness.rerender(
      createInput({ projectId: "project-new", projectTitle: "未命名项目", workspaceReady: false })
    );
    act(() => {
      openEverySurface(harness);
    });
    expect(harness.current()).toMatchObject({
      activeDrawer: null,
      projectMenuOpen: false,
      projectRenameDraft: "",
      canvasContextMenu: null,
      detailProposalId: null,
      activeResearchDetailObjectId: null
    });

    await harness.rerender(
      createInput({ projectId: "project-new", projectTitle: "真实新项目", workspaceReady: true })
    );
    expect(harness.current()).toMatchObject({
      activeDrawer: null,
      drawerAnchor: null,
      highlightedContinuityEntryIds: [],
      projectMenuOpen: false,
      projectRenameDraft: "真实新项目",
      canvasContextMenu: null,
      detailProposalId: null,
      detailDesignDefinitionId: null,
      detailConceptDirectionId: null,
      activeResearchDetailObjectId: null
    });

    act(() => harness.current().toggleProjectMenu());
    expect(harness.current()).toMatchObject({ projectMenuOpen: true, projectRenameDraft: "真实新项目" });
  });

  it("keeps surface sessions during an update within the same project", async () => {
    const harness = await renderController(createInput({ projectId: "project-a", projectTitle: "项目 A" }));

    act(() => {
      harness.current().openDrawer("records", makeAnchor(30));
      harness.current().openProjectRecords(["record-a"]);
      harness.current().toggleProjectMenu();
      harness.current().setProjectRenameDraft("编辑中的标题");
      harness.current().openCanvasContextMenu(makeContextRequest());
      harness.current().openResearchDetail("research-a");
    });
    const before = snapshotSurface(harness.current(), "project-a");

    await harness.rerender(createInput({ projectId: "project-a", projectTitle: "项目 A" }));
    expect(snapshotSurface(harness.current(), "project-a")).toEqual(before);
  });
});

function createInput(
  overrides: Partial<SurfaceTestInput> = {}
): SurfaceTestInput {
  return {
    projectId: "project-a",
    projectTitle: "项目 A",
    workspaceReady: true,
    ...overrides
  };
}

type SurfaceTestInput = UseWorkspaceSurfaceControllerInput & {
  workspaceReady: boolean;
};

function openEverySurface(harness: Awaited<ReturnType<typeof renderController>>) {
  harness.current().openDrawer("records");
  harness.current().openProjectRecords(["loading-record"]);
  harness.current().toggleProjectMenu();
  harness.current().openCanvasContextMenu(makeContextRequest());
  harness.current().openProposalDetail("loading-proposal");
  harness.current().openResearchDetail("loading-research");
}

async function renderController(initialInput: UseWorkspaceSurfaceControllerInput) {
  let controller: WorkspaceSurfaceController | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const renderedSnapshots: SurfaceSnapshot[] = [];

  function Harness({ input }: { input: UseWorkspaceSurfaceControllerInput }) {
    controller = useWorkspaceSurfaceController(input);
    renderedSnapshots.push(snapshotSurface(controller, input.projectId));
    return null;
  }

  const render = async (input: UseWorkspaceSurfaceControllerInput) => {
    await act(async () => {
      root.render(createElement(Harness, { input }));
    });
  };

  await render(initialInput);

  return {
    current: () => {
      if (!controller) {
        throw new Error("Controller did not render.");
      }
      return controller;
    },
    rerender: render,
    snapshots: () => renderedSnapshots,
    unmount: async () => {
      await act(async () => root.unmount());
      const index = roots.indexOf(root);
      if (index >= 0) {
        roots.splice(index, 1);
      }
    }
  };
}

type SurfaceSnapshot = {
  projectId: string;
  activeDrawer: WorkspaceSurfaceController["activeDrawer"];
  drawerAnchor: WorkspaceSurfaceController["drawerAnchor"];
  highlightedContinuityEntryIds: string[];
  projectMenuOpen: boolean;
  projectRenameDraft: string;
  canvasContextMenu: WorkspaceCanvasContextMenuState | null;
  detailProposalId: string | null;
  detailDesignDefinitionId: string | null;
  detailConceptDirectionId: string | null;
  activeResearchDetailObjectId: string | null;
};

function snapshotSurface(controller: WorkspaceSurfaceController, projectId: string): SurfaceSnapshot {
  return {
    projectId,
    activeDrawer: controller.activeDrawer,
    drawerAnchor: controller.drawerAnchor,
    highlightedContinuityEntryIds: [...controller.highlightedContinuityEntryIds],
    projectMenuOpen: controller.projectMenuOpen,
    projectRenameDraft: controller.projectRenameDraft,
    canvasContextMenu: controller.canvasContextMenu,
    detailProposalId: controller.detailProposalId,
    detailDesignDefinitionId: controller.detailDesignDefinitionId,
    detailConceptDirectionId: controller.detailConceptDirectionId,
    activeResearchDetailObjectId: controller.activeResearchDetailObjectId
  };
}

function makeAnchor(offset: number) {
  return {
    top: offset,
    right: offset + 10,
    bottom: offset + 20,
    left: offset - 10,
    width: 20,
    height: 20
  };
}

function makeContextRequest() {
  return {
    x: 120,
    y: 240,
    objectId: "object-a",
    stageId: "stage-a",
    pagePosition: { x: 640, y: 480 }
  };
}

function makePorts(closed: string[]): WorkspaceExternalSurfacePorts {
  const ports: WorkspaceExternalSurfacePorts = {
    documentReaderOpen: true,
    closeDocumentReader: () => {
      closed.push("documentReader");
      ports.documentReaderOpen = false;
    },
    deliveryPreparationOpen: true,
    closeDeliveryPreparation: () => {
      closed.push("deliveryPreparation");
      ports.deliveryPreparationOpen = false;
    },
    deliveryOutputOpen: true,
    closeDeliveryOutput: () => {
      closed.push("deliveryOutput");
      ports.deliveryOutputOpen = false;
    },
    projectBundleOpen: true,
    closeProjectBundle: () => {
      closed.push("projectBundle");
      ports.projectBundleOpen = false;
    },
    clearCanvasSelection: () => {
      closed.push("canvasSelection");
      return true;
    }
  };
  return ports;
}
