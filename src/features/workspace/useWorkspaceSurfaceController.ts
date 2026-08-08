"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";

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
  workspaceReady: boolean;
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

type WorkspaceSurfaceSession = Readonly<{
  projectId: string;
  workspaceReady: boolean;
  generation: symbol;
}>;

export function useWorkspaceSurfaceController({
  projectId,
  projectTitle,
  workspaceReady,
  now = Date.now
}: UseWorkspaceSurfaceControllerInput): WorkspaceSurfaceController {
  const session = useMemo<WorkspaceSurfaceSession>(
    () => ({
      projectId,
      workspaceReady,
      generation: Symbol("workspace-surface-session")
    }),
    [projectId, workspaceReady]
  );
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
  const [committedSession, commitSession] = useReducer(
    (_current: WorkspaceSurfaceSession, next: WorkspaceSurfaceSession) => next,
    session
  );
  const currentSessionRef = useRef<WorkspaceSurfaceSession>(session);

  const isCurrentSession = useCallback((expectedSession: WorkspaceSurfaceSession): boolean => {
    // The ref is the synchronous handoff gate for callbacks created before a project switch.
    return currentSessionRef.current === expectedSession && expectedSession.workspaceReady;
  }, []);

  // The marker represents the project/readiness pair whose reset effect has committed.
  // Until then, the render gate keeps transient surfaces invisible during the switch.
  const sessionMatchesProject =
    committedSession === session && session.workspaceReady && workspaceReady;

  const resetSurfaceState = useCallback((nextProjectTitle: string) => {
    setActiveDrawerState(null);
    setDrawerAnchorState(null);
    setHighlightedContinuityEntryIdsState([]);
    setProjectMenuOpenState(false);
    setProjectRenameDraftState(nextProjectTitle);
    setCanvasContextMenuState(null);
    setDetailProposalIdState(null);
    setDetailDesignDefinitionIdState(null);
    setDetailConceptDirectionIdState(null);
    setActiveResearchDetailObjectIdState(null);
  }, []);

  const changeDrawer = useCallback(
    (drawer: DrawerMode, anchor?: LeftRailAnchor) => {
      if (!isCurrentSession(session)) {
        return;
      }

      setDrawerAnchorState(drawer ? anchor ?? null : null);
      setActiveDrawerState(drawer);
    },
    [isCurrentSession, session]
  );

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
      if (!isCurrentSession(session)) {
        return;
      }

      setHighlightedContinuityEntryIdsState([...entryIds]);
      changeDrawer("records");
    },
    [changeDrawer, isCurrentSession, session]
  );

  const toggleProjectMenu = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }

    if (!projectMenuOpenState) {
      setProjectRenameDraftState(projectTitle);
    }
    setProjectMenuOpenState((current) => !current);
  }, [isCurrentSession, projectMenuOpenState, projectTitle, session]);

  const closeProjectMenu = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    setProjectMenuOpenState(false);
  }, [isCurrentSession, session]);

  const setProjectRenameDraft = useCallback(
    (value: string) => {
      if (!isCurrentSession(session)) {
        return;
      }

      setProjectRenameDraftState(value);
    },
    [isCurrentSession, session]
  );

  const consumeProjectRename = useCallback((): ProjectRenameIntent => {
    if (!isCurrentSession(session)) {
      return { status: "unchanged" };
    }

    const title = projectRenameDraftState.trim();
    if (!title || title === projectTitle) {
      setProjectMenuOpenState(false);
      setProjectRenameDraftState(projectTitle);
      return { status: "unchanged" };
    }

    setProjectMenuOpenState(false);
    return { status: "rename", title };
  }, [isCurrentSession, projectRenameDraftState, projectTitle, session]);

  const openCanvasContextMenu = useCallback(
    (request: WorkspaceCanvasContextMenuRequest) => {
      if (!isCurrentSession(session)) {
        return;
      }

      setCanvasContextMenuState({
        ...request,
        pagePosition: { ...request.pagePosition },
        openedAt: now()
      });
    },
    [isCurrentSession, now, session]
  );

  const closeCanvasContextMenu = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    setCanvasContextMenuState(null);
  }, [isCurrentSession, session]);

  const canDismissCanvasContextMenu = useCallback(
    (timestamp = now()) =>
      isCurrentSession(session) &&
      canvasContextMenuState !== null &&
      timestamp - canvasContextMenuState.openedAt >= CANVAS_CONTEXT_MENU_DISMISS_DELAY_MS,
    [canvasContextMenuState, isCurrentSession, now, session]
  );

  const openProposalDetail = useCallback(
    (proposalId: string) => {
      if (!isCurrentSession(session)) {
        return;
      }

      setDetailProposalIdState(proposalId);
      setDetailDesignDefinitionIdState(null);
      setDetailConceptDirectionIdState(null);
    },
    [isCurrentSession, session]
  );

  const closeProposalDetail = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    setDetailProposalIdState(null);
  }, [isCurrentSession, session]);

  const closeProposalDetailIf = useCallback(
    (proposalIds: string[]) => {
      if (!isCurrentSession(session)) {
        return;
      }
      setDetailProposalIdState((current) => (current && proposalIds.includes(current) ? null : current));
    },
    [isCurrentSession, session]
  );

  const openDesignDefinitionDetail = useCallback(
    (objectId: string) => {
      if (!isCurrentSession(session)) {
        return;
      }

      setDetailProposalIdState(null);
      setDetailDesignDefinitionIdState(objectId);
      setDetailConceptDirectionIdState(null);
    },
    [isCurrentSession, session]
  );

  const closeDesignDefinitionDetail = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    setDetailDesignDefinitionIdState(null);
  }, [isCurrentSession, session]);

  const openConceptDirectionDetail = useCallback(
    (objectId: string) => {
      if (!isCurrentSession(session)) {
        return;
      }

      setDetailProposalIdState(null);
      setDetailDesignDefinitionIdState(null);
      setDetailConceptDirectionIdState(objectId);
    },
    [isCurrentSession, session]
  );

  const closeConceptDirectionDetail = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    setDetailConceptDirectionIdState(null);
  }, [isCurrentSession, session]);

  const openResearchDetail = useCallback(
    (objectId: string) => {
      if (!isCurrentSession(session)) {
        return;
      }

      setActiveResearchDetailObjectIdState(objectId);
    },
    [isCurrentSession, session]
  );

  const closeResearchDetail = useCallback(() => {
    if (!isCurrentSession(session)) {
      return;
    }
    setActiveResearchDetailObjectIdState(null);
  }, [isCurrentSession, session]);

  const closeTopSurface = useCallback(
    (ports: WorkspaceExternalSurfacePorts): boolean => {
      if (!isCurrentSession(session)) {
        return false;
      }
      const priorityState: WorkspaceSurfacePriorityState = {
        canvasContextMenuOpen: canvasContextMenuState !== null,
        proposalDetailOpen: detailProposalIdState !== null,
        designDefinitionDetailOpen: detailDesignDefinitionIdState !== null,
        conceptDirectionDetailOpen: detailConceptDirectionIdState !== null,
        researchDetailOpen: activeResearchDetailObjectIdState !== null,
        documentReaderOpen: ports.documentReaderOpen,
        deliveryPreparationOpen: ports.deliveryPreparationOpen,
        deliveryOutputOpen: ports.deliveryOutputOpen,
        projectBundleOpen: ports.projectBundleOpen,
        projectMenuOpen: projectMenuOpenState,
        drawerOpen: activeDrawerState !== null
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
      isCurrentSession,
      session
    ]
  );

  useLayoutEffect(() => {
    if (committedSession === session && currentSessionRef.current === session) {
      return;
    }

    currentSessionRef.current = session;
    commitSession(session);
    // The external workspace session changed; clear all transient surfaces before exposing it.
    resetSurfaceState(projectTitle);
  }, [committedSession, commitSession, projectTitle, resetSurfaceState, session]);

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
    projectRenameDraft: sessionMatchesProject ? projectRenameDraftState : "",
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
