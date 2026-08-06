"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DrawerMode } from "./components/LeftRail";
import type { LeftRailAnchor } from "./leftRailPopoverPlacement";
import {
  resolveTopWorkspaceSurface,
  type WorkspaceSurfacePriorityState
} from "./workspaceSurfacePriority";

export type WorkspaceCanvasContextMenuState = {
  x: number;
  y: number;
  objectId: string | null;
  stageId: string | null;
  pagePosition: {
    x: number;
    y: number;
  };
  openedAt: number;
};

export type WorkspaceCanvasContextMenuRequest = Omit<WorkspaceCanvasContextMenuState, "openedAt">;

export type ProjectRenameIntent =
  | {
      status: "rename";
      title: string;
    }
  | {
      status: "unchanged";
    };

export type WorkspaceExternalSurfacePorts = {
  documentReaderOpen: boolean;
  closeDocumentReader: () => void;
  deliveryPreparationOpen: boolean;
  closeDeliveryPreparation: () => void;
  deliveryOutputOpen: boolean;
  closeDeliveryOutput: () => void;
  projectBundleOpen: boolean;
  closeProjectBundle: () => void;
  clearCanvasSelection: () => boolean;
};

export type UseWorkspaceSurfaceControllerInput = {
  projectId: string;
  projectTitle: string;
  now?: () => number;
};

export type WorkspaceSurfaceController = {
  activeDrawer: DrawerMode;
  drawerAnchor: LeftRailAnchor | null;
  highlightedContinuityEntryIds: string[];
  projectMenuOpen: boolean;
  projectRenameDraft: string;
  canvasContextMenu: WorkspaceCanvasContextMenuState | null;
  detailProposalId: string | null;
  detailDesignDefinitionId: string | null;
  detailConceptDirectionId: string | null;
  activeResearchDetailObjectId: string | null;
  openDrawer: (drawer: Exclude<DrawerMode, null>, anchor?: LeftRailAnchor) => void;
  closeDrawer: () => void;
  changeDrawer: (drawer: DrawerMode, anchor?: LeftRailAnchor) => void;
  openProjectRecords: (entryIds?: string[]) => void;
  toggleProjectMenu: () => void;
  closeProjectMenu: () => void;
  setProjectRenameDraft: (value: string) => void;
  consumeProjectRename: () => ProjectRenameIntent;
  openCanvasContextMenu: (request: WorkspaceCanvasContextMenuRequest) => void;
  closeCanvasContextMenu: () => void;
  canDismissCanvasContextMenu: (timestamp?: number) => boolean;
  openProposalDetail: (proposalId: string) => void;
  closeProposalDetail: () => void;
  closeProposalDetailIf: (proposalIds: string[]) => void;
  openDesignDefinitionDetail: (objectId: string) => void;
  closeDesignDefinitionDetail: () => void;
  openConceptDirectionDetail: (objectId: string) => void;
  closeConceptDirectionDetail: () => void;
  openResearchDetail: (objectId: string) => void;
  closeResearchDetail: () => void;
  closeTopSurface: (ports: WorkspaceExternalSurfacePorts) => boolean;
};

const DRAWER_DISMISS_SELECTORS = ".left-rail, .project-map, .side-drawer, .search-layer";
const CANVAS_CONTEXT_MENU_DISMISS_DELAY_MS = 220;

export function useWorkspaceSurfaceController({
  projectId,
  projectTitle,
  now = Date.now
}: UseWorkspaceSurfaceControllerInput): WorkspaceSurfaceController {
  const [activeDrawerState, setActiveDrawerState] = useState<DrawerMode>(null);
  const [drawerAnchorState, setDrawerAnchorState] = useState<LeftRailAnchor | null>(null);
  const [highlightedContinuityEntryIdsState, setHighlightedContinuityEntryIdsState] = useState<string[]>([]);
  const [projectMenuOpenState, setProjectMenuOpenState] = useState(false);
  const [projectRenameDraftState, setProjectRenameDraftState] = useState(projectTitle);
  const [canvasContextMenuState, setCanvasContextMenuState] = useState<WorkspaceCanvasContextMenuState | null>(null);
  const [detailProposalIdState, setDetailProposalIdState] = useState<string | null>(null);
  const [detailDesignDefinitionIdState, setDetailDesignDefinitionIdState] = useState<string | null>(null);
  const [detailConceptDirectionIdState, setDetailConceptDirectionIdState] = useState<string | null>(null);
  const [activeResearchDetailObjectIdState, setActiveResearchDetailObjectIdState] = useState<string | null>(null);
  const committedProjectIdRef = useRef(projectId);

  // The marker represents the project whose reset effect has committed. Until then,
  // the render gate keeps the previous project's transient surfaces invisible.
  // eslint-disable-next-line react-hooks/refs
  const sessionMatchesProject = committedProjectIdRef.current === projectId;

  const changeDrawer = useCallback((drawer: DrawerMode, anchor?: LeftRailAnchor) => {
    setDrawerAnchorState(drawer ? anchor ?? null : null);
    setActiveDrawerState(drawer);
  }, []);

  const openDrawer = useCallback(
    (drawer: Exclude<DrawerMode, null>, anchor?: LeftRailAnchor) => {
      changeDrawer(drawer, anchor);
    },
    [changeDrawer]
  );

  const closeDrawer = useCallback(() => {
    changeDrawer(null);
  }, [changeDrawer]);

  const openProjectRecords = useCallback(
    (entryIds: string[] = []) => {
      setHighlightedContinuityEntryIdsState([...entryIds]);
      changeDrawer("records");
    },
    [changeDrawer]
  );

  const toggleProjectMenu = useCallback(() => {
    if (!projectMenuOpenState) {
      setProjectRenameDraftState(projectTitle);
    }
    setProjectMenuOpenState((current) => !current);
  }, [projectMenuOpenState, projectTitle]);

  const closeProjectMenu = useCallback(() => {
    setProjectMenuOpenState(false);
  }, []);

  const setProjectRenameDraft = useCallback((value: string) => {
    setProjectRenameDraftState(value);
  }, []);

  const consumeProjectRename = useCallback((): ProjectRenameIntent => {
    const title = projectRenameDraftState.trim();
    if (!title || title === projectTitle) {
      setProjectMenuOpenState(false);
      setProjectRenameDraftState(projectTitle);
      return { status: "unchanged" };
    }

    setProjectMenuOpenState(false);
    return { status: "rename", title };
  }, [projectRenameDraftState, projectTitle]);

  const openCanvasContextMenu = useCallback(
    (request: WorkspaceCanvasContextMenuRequest) => {
      setCanvasContextMenuState({
        ...request,
        pagePosition: { ...request.pagePosition },
        openedAt: now()
      });
    },
    [now]
  );

  const closeCanvasContextMenu = useCallback(() => {
    setCanvasContextMenuState(null);
  }, []);

  const canDismissCanvasContextMenu = useCallback(
    (timestamp = now()) =>
      canvasContextMenuState !== null && timestamp - canvasContextMenuState.openedAt >= CANVAS_CONTEXT_MENU_DISMISS_DELAY_MS,
    [canvasContextMenuState, now]
  );

  const openProposalDetail = useCallback((proposalId: string) => {
    setDetailProposalIdState(proposalId);
    setDetailDesignDefinitionIdState(null);
    setDetailConceptDirectionIdState(null);
  }, []);

  const closeProposalDetail = useCallback(() => {
    setDetailProposalIdState(null);
  }, []);

  const closeProposalDetailIf = useCallback((proposalIds: string[]) => {
    setDetailProposalIdState((current) => (current && proposalIds.includes(current) ? null : current));
  }, []);

  const openDesignDefinitionDetail = useCallback((objectId: string) => {
    setDetailProposalIdState(null);
    setDetailDesignDefinitionIdState(objectId);
    setDetailConceptDirectionIdState(null);
  }, []);

  const closeDesignDefinitionDetail = useCallback(() => {
    setDetailDesignDefinitionIdState(null);
  }, []);

  const openConceptDirectionDetail = useCallback((objectId: string) => {
    setDetailProposalIdState(null);
    setDetailDesignDefinitionIdState(null);
    setDetailConceptDirectionIdState(objectId);
  }, []);

  const closeConceptDirectionDetail = useCallback(() => {
    setDetailConceptDirectionIdState(null);
  }, []);

  const openResearchDetail = useCallback((objectId: string) => {
    setActiveResearchDetailObjectIdState(objectId);
  }, []);

  const closeResearchDetail = useCallback(() => {
    setActiveResearchDetailObjectIdState(null);
  }, []);

  const closeTopSurface = useCallback(
    (ports: WorkspaceExternalSurfacePorts): boolean => {
      const priorityState: WorkspaceSurfacePriorityState = {
        canvasContextMenuOpen: sessionMatchesProject && canvasContextMenuState !== null,
        proposalDetailOpen: sessionMatchesProject && detailProposalIdState !== null,
        designDefinitionDetailOpen: sessionMatchesProject && detailDesignDefinitionIdState !== null,
        conceptDirectionDetailOpen: sessionMatchesProject && detailConceptDirectionIdState !== null,
        researchDetailOpen: sessionMatchesProject && activeResearchDetailObjectIdState !== null,
        documentReaderOpen: ports.documentReaderOpen,
        deliveryPreparationOpen: ports.deliveryPreparationOpen,
        deliveryOutputOpen: ports.deliveryOutputOpen,
        projectBundleOpen: ports.projectBundleOpen,
        projectMenuOpen: sessionMatchesProject && projectMenuOpenState,
        drawerOpen: sessionMatchesProject && activeDrawerState !== null
      };

      switch (resolveTopWorkspaceSurface(priorityState)) {
        case "canvasContextMenu":
          closeCanvasContextMenu();
          return true;
        case "proposalDetail":
          closeProposalDetail();
          return true;
        case "designDefinitionDetail":
          closeDesignDefinitionDetail();
          return true;
        case "conceptDirectionDetail":
          closeConceptDirectionDetail();
          return true;
        case "researchDetail":
          closeResearchDetail();
          return true;
        case "documentReader":
          ports.closeDocumentReader();
          return true;
        case "deliveryPreparation":
          ports.closeDeliveryPreparation();
          return true;
        case "deliveryOutput":
          ports.closeDeliveryOutput();
          return true;
        case "projectBundle":
          ports.closeProjectBundle();
          return true;
        case "projectMenu":
          closeProjectMenu();
          return true;
        case "drawer":
          closeDrawer();
          return true;
        case "canvasSelection":
          return ports.clearCanvasSelection();
      }
    },
    [
      activeDrawerState,
      activeResearchDetailObjectIdState,
      canvasContextMenuState,
      closeCanvasContextMenu,
      closeConceptDirectionDetail,
      closeDesignDefinitionDetail,
      closeDrawer,
      closeProjectMenu,
      closeProposalDetail,
      closeResearchDetail,
      detailConceptDirectionIdState,
      detailDesignDefinitionIdState,
      detailProposalIdState,
      projectMenuOpenState,
      sessionMatchesProject
    ]
  );

  useEffect(() => {
    if (committedProjectIdRef.current === projectId) {
      return;
    }

    committedProjectIdRef.current = projectId;
    setActiveDrawerState(null);
    setDrawerAnchorState(null);
    setHighlightedContinuityEntryIdsState([]);
    setProjectMenuOpenState(false);
    setProjectRenameDraftState(projectTitle);
    setCanvasContextMenuState(null);
    setDetailProposalIdState(null);
    setDetailDesignDefinitionIdState(null);
    setDetailConceptDirectionIdState(null);
    setActiveResearchDetailObjectIdState(null);
  }, [projectId, projectTitle]);

  useEffect(() => {
    if (!sessionMatchesProject || !activeDrawerState) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDrawerState, closeDrawer, sessionMatchesProject]);

  useEffect(() => {
    if (!sessionMatchesProject || !activeDrawerState) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      if (event.target.closest(DRAWER_DISMISS_SELECTORS)) {
        return;
      }

      closeDrawer();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [activeDrawerState, closeDrawer, sessionMatchesProject]);

  return {
    activeDrawer: sessionMatchesProject ? activeDrawerState : null,
    drawerAnchor: sessionMatchesProject ? drawerAnchorState : null,
    highlightedContinuityEntryIds: sessionMatchesProject ? highlightedContinuityEntryIdsState : [],
    projectMenuOpen: sessionMatchesProject ? projectMenuOpenState : false,
    projectRenameDraft: sessionMatchesProject ? projectRenameDraftState : projectTitle,
    canvasContextMenu: sessionMatchesProject ? canvasContextMenuState : null,
    detailProposalId: sessionMatchesProject ? detailProposalIdState : null,
    detailDesignDefinitionId: sessionMatchesProject ? detailDesignDefinitionIdState : null,
    detailConceptDirectionId: sessionMatchesProject ? detailConceptDirectionIdState : null,
    activeResearchDetailObjectId: sessionMatchesProject ? activeResearchDetailObjectIdState : null,
    openDrawer,
    closeDrawer,
    changeDrawer,
    openProjectRecords,
    toggleProjectMenu,
    closeProjectMenu,
    setProjectRenameDraft,
    consumeProjectRename,
    openCanvasContextMenu,
    closeCanvasContextMenu,
    canDismissCanvasContextMenu,
    openProposalDetail,
    closeProposalDetail,
    closeProposalDetailIf,
    openDesignDefinitionDetail,
    closeDesignDefinitionDetail,
    openConceptDirectionDetail,
    closeConceptDirectionDetail,
    openResearchDetail,
    closeResearchDetail,
    closeTopSurface
  };
}
