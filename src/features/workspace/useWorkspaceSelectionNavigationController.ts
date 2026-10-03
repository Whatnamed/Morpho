"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";

import type { CanvasView, MorphoWorkspace } from "@/domain/morpho/types";

import { getTopWorkspaceSurfaceElement } from "./workspaceSurfacePriority";
import type { FocusArea } from "./tldraw/MorphoCanvas";
import {
  areSelectionIdsEqual,
  type CanvasSelectionRequest
} from "./tldraw/canvasSelection";
import {
  popDetailNavigation,
  pushDetailNavigation,
  shouldHydratePersistedSelection,
  type DetailNavigationSnapshot
} from "./workspaceNavigation";

export type WorkspaceFocusRequest = {
  area?: FocusArea;
  objectId?: string;
  view?: CanvasView;
  selectionObjectIds?: string[];
  nonce: number;
};

export type UseWorkspaceSelectionNavigationControllerInput = {
  projectId: string;
  workspace: MorphoWorkspace;
  workspaceReady: boolean;
  updateWorkspace: Dispatch<SetStateAction<MorphoWorkspace>>;
};

export type WorkspaceSelectionNavigationController = {
  captureAttention: () => () => boolean;
  selectedObjectIds: string[];
  selectionRequest: CanvasSelectionRequest;
  focusRequest: WorkspaceFocusRequest;
  setSelectedObjectIds: (action: SetStateAction<string[]>) => void;
  requestCanvasSelection: (objectIds: string[]) => void;
  acceptCanvasSelection: (objectIds: string[]) => void;
  focusArea: (area: FocusArea) => void;
  focusObject: (objectId: string, options?: { rememberView?: boolean }) => void;
  requestObjectFocus: (objectId: string) => void;
  locateObjectFromDetail: (objectId: string) => void;
  undoDetailNavigation: () => boolean;
  commitCanvasView: (view: CanvasView) => void;
  observeCanvasView: (view: CanvasView) => void;
  getLatestCanvasView: () => CanvasView;
  clearCanvasSelection: () => boolean;
  selectAllCanvasObjects: (objectIds: string[]) => boolean;
};

type SelectionSession = Readonly<{
  projectId: string;
  workspaceId: string;
  workspaceReady: boolean;
  generation: symbol;
  objectIds: string[];
}>;

export function useWorkspaceSelectionNavigationController({
  projectId,
  workspace,
  workspaceReady,
  updateWorkspace
}: UseWorkspaceSelectionNavigationControllerInput): WorkspaceSelectionNavigationController {
  const session = useMemo<SelectionSession>(
    () => ({
      projectId,
      workspaceId: workspace.project.id,
      workspaceReady,
      generation: Symbol("workspace-selection-session"),
      objectIds: []
    }),
    [projectId, workspace.project.id, workspaceReady]
  );
  const [selectionSession, setSelectionSession] = useState<SelectionSession>(() => ({
    projectId,
    workspaceId: workspace.project.id,
    workspaceReady,
    generation: Symbol("workspace-selection-state"),
    objectIds: workspaceReady && workspace.project.id === projectId ? [...workspace.ui.lastSelectionIds] : []
  }));
  const [selectionRequestState, setSelectionRequestState] = useState<CanvasSelectionRequest>({ objectIds: [], nonce: 0 });
  const [focusRequestState, setFocusRequestState] = useState<WorkspaceFocusRequest>({ nonce: 0 });
  const [committedSession, commitSession] = useReducer(
    (_current: SelectionSession, next: SelectionSession) => next,
    session
  );
  const latestCanvasViewRef = useRef<CanvasView>({ ...workspace.canvas.view });
  const latestSelectionIdsRef = useRef<string[]>([]);
  useLayoutEffect(() => { latestSelectionIdsRef.current = selectionSession.objectIds; }, [selectionSession]);
  const attentionEpochRef = useRef(0);
  const detailNavigationUndoStackRef = useRef<DetailNavigationSnapshot[]>([]);
  const hydratedProjectIdRef = useRef<string | null>(null);
  const activeSessionRef = useRef<SelectionSession>(session);

  const sessionMatchesProject =
    committedSession === session &&
    session.workspaceReady &&
    workspaceReady &&
    workspace.project.id === projectId &&
    workspace.project.id === session.workspaceId;

  const isCurrentSession = useCallback(
    (expectedSession: SelectionSession) => {
      return activeSessionRef.current === expectedSession && expectedSession.workspaceReady;
    },
    []
  );

  useLayoutEffect(() => {
    if (committedSession === session && activeSessionRef.current === session) {
      return;
    }

    activeSessionRef.current = session;
    commitSession(session);
    // The external workspace session changed; discard transient selection and navigation state.
    setSelectionSession({ ...session, objectIds: [] });
    setSelectionRequestState({ objectIds: [], nonce: 0 });
    setFocusRequestState((current) => ({ nonce: current.nonce }));
    latestCanvasViewRef.current = { ...workspace.canvas.view };
    detailNavigationUndoStackRef.current = [];
    hydratedProjectIdRef.current = null;
  }, [committedSession, projectId, session, workspace.canvas.view]);

  useEffect(() => {
    if (!sessionMatchesProject) {
      return;
    }

    if (
      !shouldHydratePersistedSelection({
        hydratedProjectId: hydratedProjectIdRef.current,
        projectId: workspace.project.id,
        workspaceLoaded: workspaceReady
      })
    ) {
      return;
    }

    const persistedSelection = [...workspace.ui.lastSelectionIds];
    hydratedProjectIdRef.current = workspace.project.id;
    setSelectionSession({ ...session, objectIds: [...persistedSelection] });
    setSelectionRequestState((current) => ({
      objectIds: [...persistedSelection],
      nonce: current.nonce + 1
    }));
  }, [session, sessionMatchesProject, workspace.project.id, workspace.ui.lastSelectionIds, workspaceReady]);

  const selectedObjectIds = useMemo(
    () =>
      sessionMatchesProject && selectionSession.projectId === projectId
        ? [...selectionSession.objectIds]
        : [],
    [projectId, selectionSession, sessionMatchesProject]
  );

  const selectionRequest = useMemo(
    () =>
      sessionMatchesProject
        ? { objectIds: [...selectionRequestState.objectIds], nonce: selectionRequestState.nonce }
        : { objectIds: [], nonce: 0 },
    [selectionRequestState, sessionMatchesProject]
  );

  const focusRequest = useMemo<WorkspaceFocusRequest>(
    () =>
      sessionMatchesProject
        ? {
            ...focusRequestState,
            ...(focusRequestState.view ? { view: { ...focusRequestState.view } } : {}),
            ...(focusRequestState.selectionObjectIds
              ? { selectionObjectIds: [...focusRequestState.selectionObjectIds] }
              : {})
          }
        : { nonce: 0 },
    [focusRequestState, sessionMatchesProject]
  );

  const setSelectedObjectIds = useCallback(
    (action: SetStateAction<string[]>) => {
      if (!isCurrentSession(session)) {
        return;
      }

      const ids = typeof action === "function" ? action([...latestSelectionIdsRef.current]) : action;
      latestSelectionIdsRef.current = [...ids];
      setSelectionSession({ ...session, objectIds: [...ids] });
      setSelectionRequestState((current) => ({ objectIds: [...ids], nonce: current.nonce + 1 }));
      updateWorkspace((current) => {
        if (!isCurrentSession(session) || current.project.id !== projectId || areSelectionIdsEqual(current.ui.lastSelectionIds, ids)) return current;
        return { ...current, ui: { ...current.ui, lastSelectionIds: [...ids] } };
      });
    },
    [isCurrentSession, projectId, session, updateWorkspace]
  );

  const commitSelection = useCallback(
    (objectIds: string[]) => {
      if (!isCurrentSession(session)) {
        return;
      }

      const nextObjectIds = [...objectIds];
      latestSelectionIdsRef.current = [...nextObjectIds];
      setSelectionSession({ ...session, objectIds: [...nextObjectIds] });
      updateWorkspace((current) => {
        if (!isCurrentSession(session) || current.project.id !== projectId) {
          return current;
        }
        if (areSelectionIdsEqual(current.ui.lastSelectionIds, nextObjectIds)) {
          return current;
        }
        return {
          ...current,
          ui: {
            ...current.ui,
            lastSelectionIds: [...nextObjectIds]
          }
        };
      });
    },
    [isCurrentSession, projectId, session, updateWorkspace]
  );

  const requestCanvasSelection = useCallback(
    (objectIds: string[]) => {
      if (!isCurrentSession(session)) {
        return;
      }

      const nextObjectIds = [...objectIds];
      setSelectionRequestState((current) => ({
        objectIds: [...nextObjectIds],
        nonce: current.nonce + 1
      }));
    },
    [isCurrentSession, session]
  );

  const acceptCanvasSelection = useCallback(
    (objectIds: string[]) => {
      commitSelection(objectIds);
    },
    [commitSelection]
  );

  const focusArea = useCallback(
    (area: FocusArea) => {
      if (!isCurrentSession(session)) {
        return;
      }
      setFocusRequestState((current) => ({ area, nonce: current.nonce + 1 }));
    },
    [isCurrentSession, session]
  );

  const requestObjectFocus = useCallback(
    (objectId: string) => {
      if (!isCurrentSession(session)) {
        return;
      }
      setFocusRequestState((current) => ({ objectId, nonce: current.nonce + 1 }));
    },
    [isCurrentSession, session]
  );

  const focusObject = useCallback(
    (objectId: string, options: { rememberView?: boolean } = {}) => {
      if (!isCurrentSession(session)) {
        return;
      }

      if (options.rememberView) {
        detailNavigationUndoStackRef.current = pushDetailNavigation(detailNavigationUndoStackRef.current, {
          view: { ...latestCanvasViewRef.current },
          selectedObjectIds: [...selectedObjectIds]
        });
      }
      if (selectedObjectIds.length <= 1) {
        commitSelection([objectId]);
        requestCanvasSelection([objectId]);
      }
      requestObjectFocus(objectId);
    },
    [commitSelection, isCurrentSession, requestCanvasSelection, requestObjectFocus, selectedObjectIds, session]
  );

  const locateObjectFromDetail = useCallback(
    (objectId: string) => {
      focusObject(objectId, { rememberView: true });
    },
    [focusObject]
  );

  const undoDetailNavigation = useCallback(() => {
    if (!isCurrentSession(session)) {
      return false;
    }

    const restored = popDetailNavigation(detailNavigationUndoStackRef.current);
    if (!restored) {
      return false;
    }

    const restoredView = { ...restored.snapshot.view };
    const restoredSelection = [...restored.snapshot.selectedObjectIds];
    detailNavigationUndoStackRef.current = restored.history;
    latestCanvasViewRef.current = restoredView;
    commitSelection(restoredSelection);
    setFocusRequestState((current) => ({
      view: { ...restoredView },
      selectionObjectIds: [...restoredSelection],
      nonce: current.nonce + 1
    }));
    return true;
  }, [commitSelection, isCurrentSession, session]);

  const observeCanvasView = useCallback(
    (view: CanvasView) => {
      if (!isCurrentSession(session)) {
        return;
      }
      latestCanvasViewRef.current = { ...view };
    },
    [isCurrentSession, session]
  );

  const commitCanvasView = useCallback(
    (view: CanvasView) => {
      if (!isCurrentSession(session)) {
        return;
      }

      latestCanvasViewRef.current = { ...view };
      updateWorkspace((current) => {
        if (!isCurrentSession(session) || current.project.id !== projectId) {
          return current;
        }
        if (
          current.canvas.view.x === view.x &&
          current.canvas.view.y === view.y &&
          current.canvas.view.zoom === view.zoom &&
          current.ui.canvasView.x === view.x &&
          current.ui.canvasView.y === view.y &&
          current.ui.canvasView.zoom === view.zoom
        ) {
          return current;
        }
        const nextView = { ...view };
        return {
          ...current,
          canvas: { ...current.canvas, view: { ...nextView } },
          ui: { ...current.ui, canvasView: { ...nextView } }
        };
      });
    },
    [isCurrentSession, projectId, session, updateWorkspace]
  );

  const getLatestCanvasView = useCallback(
    () => (isCurrentSession(session) ? { ...latestCanvasViewRef.current } : { ...workspace.canvas.view }),
    [isCurrentSession, session, workspace.canvas.view]
  );

  const clearCanvasSelection = useCallback(() => {
    if (!isCurrentSession(session) || selectedObjectIds.length === 0) {
      return false;
    }

    const nextObjectIds: string[] = [];
    setSelectionSession({ ...session, objectIds: [] });
    setSelectionRequestState((current) => ({ objectIds: [], nonce: current.nonce + 1 }));
    updateWorkspace((current) => {
      if (!isCurrentSession(session) || current.project.id !== projectId) {
        return current;
      }
      if (areSelectionIdsEqual(current.ui.lastSelectionIds, nextObjectIds)) {
        return current;
      }
      return { ...current, ui: { ...current.ui, lastSelectionIds: [] } };
    });
    return true;
  }, [isCurrentSession, projectId, selectedObjectIds.length, session, updateWorkspace]);

  const selectAllCanvasObjects = useCallback(
    (objectIds: string[]) => {
      if (!isCurrentSession(session) || objectIds.length === 0) {
        return false;
      }

      const nextObjectIds = [...objectIds];
      setSelectionRequestState((current) => ({
        objectIds: [...nextObjectIds],
        nonce: current.nonce + 1
      }));
      updateWorkspace((current) => {
        if (!isCurrentSession(session) || current.project.id !== projectId) {
          return current;
        }
        if (areSelectionIdsEqual(current.ui.lastSelectionIds, nextObjectIds)) {
          return current;
        }
        return { ...current, ui: { ...current.ui, lastSelectionIds: [...nextObjectIds] } };
      });
      return true;
    },
    [isCurrentSession, projectId, session, updateWorkspace]
  );

  useEffect(() => {
    const returnFromDetail = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.key !== "ArrowLeft") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!undoDetailNavigation()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", returnFromDetail, { capture: true });
    return () => window.removeEventListener("keydown", returnFromDetail, { capture: true });
  }, [undoDetailNavigation]);

  useEffect(() => {
    const observeInteraction = (event: Event) => {
      if (event instanceof KeyboardEvent || (event.target instanceof Element && event.target.closest(".workspace"))) attentionEpochRef.current += 1;
    };
    const events = ["pointerdown", "keydown", "wheel", "focusin"] as const;
    events.forEach((name) => window.addEventListener(name, observeInteraction, true));
    return () => events.forEach((name) => window.removeEventListener(name, observeInteraction, true));
  }, []);

  const captureAttention = useCallback(() => {
    const epoch = attentionEpochRef.current;
    const canHandoff = !getTopWorkspaceSurfaceElement();
    return () => isCurrentSession(session) && canHandoff && epoch === attentionEpochRef.current && !getTopWorkspaceSurfaceElement();
  }, [isCurrentSession, session]);

  return {
    captureAttention,
    selectedObjectIds,
    selectionRequest,
    focusRequest,
    setSelectedObjectIds,
    requestCanvasSelection,
    acceptCanvasSelection,
    focusArea,
    focusObject,
    requestObjectFocus,
    locateObjectFromDetail,
    undoDetailNavigation,
    commitCanvasView,
    observeCanvasView,
    getLatestCanvasView,
    clearCanvasSelection,
    selectAllCanvasObjects
  };
}
