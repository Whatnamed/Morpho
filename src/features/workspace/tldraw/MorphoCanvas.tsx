"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { Tldraw, Vec, track, useEditor, type Editor, type TLShape, type TLShapeId, type TLShapePartial } from "tldraw";

import { calculateAnchoredZoom } from "@/domain/morpho/canvasCamera";
import type { CanvasInstance, CanvasPoint, CanvasView, MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import { getRenderableCanvasInstances } from "@/domain/morpho/workspace";
import {
  getSelectionToolbarPlacement,
  screenRectsFromClientRects,
  SELECTION_TOOLBAR_OBSTACLE_SELECTORS,
  shouldShowSelectionToolbarForInteraction,
  type SelectionToolbarPlacement,
  type ScreenRect
} from "../selectionToolbar";
import { shouldAcceptCanvasSelection } from "../workspaceNavigation";
import type { PendingImageGenerationSlot } from "../pendingImageGenerationSlots";
import { buildRelationshipPath, buildRelationshipRoute, createRelationshipRouteCache, type CanvasPageBounds } from "./canvasRelationshipRouting";
import { collectDirectCanvasEdges } from "./canvasRelationships";
import {
  MorphoShapeUtil,
  createMorphoShapePartial,
  getMorphoShapeProps,
  isMorphoShape,
  type MorphoShape
} from "./MorphoShapeUtil";

export type FocusArea = "overview" | "research" | "definition" | "visual" | "delivery";

type FocusRequest = {
  area?: FocusArea;
  objectId?: string;
  view?: CanvasView;
  selectionObjectIds?: string[];
  nonce: number;
};

type MorphoCanvasProps = {
  workspace: MorphoWorkspace;
  annotatedObjectId: string | null;
  traceObjectIds: string[];
  highlightedObjectId: string | null;
  assetUrls: Record<string, string>;
  pendingImageGenerationSlots: PendingImageGenerationSlot[];
  focusRequest: FocusRequest;
  selectedObjectIds: string[];
  /**
   * Changes when floating chrome opens/closes so the selection toolbar
   * re-measures obstacles even when the tldraw editor itself is idle.
   */
  floatingChromeKey?: string;
  renderSelectionToolbar?: (selectedObjects: MorphoObject[], placement: SelectionToolbarPlacement) => ReactNode;
  onSelectionChange: (objectIds: string[]) => void;
  onInstancesChange: (instances: CanvasInstance[]) => void;
  onViewChange: (view: CanvasView) => void;
  onLiveViewChange?: (view: CanvasView) => void;
  onImportRequest: (request: CanvasImportRequest) => void;
  onContextMenuRequest: (request: CanvasContextMenuRequest) => void;
};

export type CanvasImportRequest = {
  position: CanvasPoint;
  files?: File[];
  text?: string;
  url?: string;
};

export type CanvasContextMenuRequest = {
  x: number;
  y: number;
  objectId: string | null;
};

const shapeUtils = [MorphoShapeUtil];
export const MORPHO_EDITOR_SYNC_RUN_OPTIONS = { history: "ignore" } as const;
const MIN_WHEEL_ZOOM = 0.12;
const MAX_WHEEL_ZOOM = 2.4;

export type CanvasFocusBounds = { x: number; y: number; w: number; h: number; zoom: number };

const focusBounds: Record<FocusArea, CanvasFocusBounds> = {
  overview: { x: 0, y: 30, w: 3050, h: 900, zoom: 0.34 },
  research: { x: 20, y: 150, w: 940, h: 720, zoom: 0.72 },
  definition: { x: 740, y: 160, w: 520, h: 520, zoom: 0.78 },
  visual: { x: 1100, y: 110, w: 1400, h: 720, zoom: 0.55 },
  delivery: { x: 2520, y: 190, w: 520, h: 760, zoom: 0.72 }
};

export function resolveFocusBounds(workspace: MorphoWorkspace, area: FocusArea): CanvasFocusBounds {
  const fallback = focusBounds[area];
  const instances = getRenderableCanvasInstances(workspace).filter((instance) => {
    const object = workspace.objects[instance.objectId];
    if (!object) {
      return false;
    }

    if (area === "overview") {
      return true;
    }

    if (area === "research") {
      return ["file", "text", "link", "imageCollection", "research", "documentFragment", "keyConclusion"].includes(object.type);
    }

    if (area === "definition") {
      return object.type === "designDefinition";
    }

    if (area === "visual") {
      return object.type === "conceptDirection" || object.type === "image";
    }

    if (area === "delivery") {
      return object.type === "delivery";
    }

    return false;
  });

  if (instances.length === 0) {
    return fallback;
  }

  const left = Math.min(...instances.map((instance) => instance.position.x));
  const top = Math.min(...instances.map((instance) => instance.position.y));
  const right = Math.max(...instances.map((instance) => instance.position.x + instance.size.w));
  const bottom = Math.max(...instances.map((instance) => instance.position.y + instance.size.h));
  const padding = area === "overview" ? 160 : 120;
  return {
    x: left - padding,
    y: top - padding,
    w: Math.max(240, right - left + padding * 2),
    h: Math.max(180, bottom - top + padding * 2),
    zoom: fallback.zoom
  };
}

export function shouldApplyFocusRequest(focusRequest: FocusRequest, lastAppliedNonce: number | null): boolean {
  return focusRequest.nonce !== lastAppliedNonce && Boolean(focusRequest.area || focusRequest.objectId || focusRequest.view);
}

export function MorphoCanvas({
  workspace,
  annotatedObjectId,
  traceObjectIds,
  highlightedObjectId,
  assetUrls,
  pendingImageGenerationSlots,
  focusRequest,
  selectedObjectIds,
  floatingChromeKey = "",
  renderSelectionToolbar,
  onSelectionChange,
  onInstancesChange,
  onViewChange,
  onLiveViewChange,
  onImportRequest,
  onContextMenuRequest
}: MorphoCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const lastSelectionRef = useRef("");
  const pendingInstancesRef = useRef<CanvasInstance[] | null>(null);
  const instancesPersistTimerRef = useRef<number | null>(null);
  const lastAppliedFocusNonceRef = useRef<number | null>(null);
  const viewPersistTimerRef = useRef<number | null>(null);
  const latestViewRef = useRef<CanvasView>(workspace.canvas.view);
  const lastPersistedViewKeyRef = useRef(getCanvasViewKey(workspace.canvas.view));
  const lastContextMenuOpenAtRef = useRef(0);
  const latestWorkspaceRef = useRef(workspace);
  const latestSelectedObjectIdsRef = useRef(selectedObjectIds);
  const windowFocusedRef = useRef(typeof document === "undefined" ? true : document.hasFocus());
  const [liveView, setLiveView] = useState<CanvasView>(workspace.canvas.view);

  useLayoutEffect(() => {
    latestWorkspaceRef.current = workspace;
  }, [workspace]);
  useLayoutEffect(() => {
    latestSelectedObjectIdsRef.current = selectedObjectIds;
  }, [selectedObjectIds]);
  const canvasComponents = useMemo(
    () => ({
      OnTheCanvas: () => <CanvasRelationshipOverlay workspace={workspace} emphasizedObjectId={highlightedObjectId} />,
      InFrontOfTheCanvas: () =>
        renderSelectionToolbar ? (
          <CanvasSelectionToolbar
            workspace={workspace}
            floatingChromeKey={floatingChromeKey}
            renderToolbar={renderSelectionToolbar}
          />
        ) : null
    }),
    [floatingChromeKey, highlightedObjectId, renderSelectionToolbar, workspace]
  );
  const pendingSlotRects = useMemo(() => {
    return pendingImageGenerationSlots.map((slot) => {
      return {
        ...slot,
        left: slot.position.x * liveView.zoom + liveView.x,
        top: slot.position.y * liveView.zoom + liveView.y,
        width: slot.size.w * liveView.zoom,
        height: slot.size.h * liveView.zoom
      };
    });
  }, [liveView, pendingImageGenerationSlots]);

  useEffect(() => {
    onLiveViewChange?.(liveView);
  }, [liveView, onLiveViewChange]);

  const flushViewPersist = useCallback(() => {
    if (viewPersistTimerRef.current !== null) {
      window.clearTimeout(viewPersistTimerRef.current);
      viewPersistTimerRef.current = null;
    }

    const view = latestViewRef.current;
    const viewKey = getCanvasViewKey(view);
    if (viewKey === lastPersistedViewKeyRef.current) {
      return;
    }

    onViewChange(view);
    lastPersistedViewKeyRef.current = viewKey;
  }, [onViewChange]);

  const scheduleViewPersist = useCallback(
    (view: CanvasView) => {
      latestViewRef.current = view;
      const viewKey = getCanvasViewKey(view);
      if (viewKey === lastPersistedViewKeyRef.current) {
        return;
      }

      if (viewPersistTimerRef.current !== null) {
        window.clearTimeout(viewPersistTimerRef.current);
      }

      viewPersistTimerRef.current = window.setTimeout(() => {
        const latestView = latestViewRef.current;
        onViewChange(latestView);
        lastPersistedViewKeyRef.current = getCanvasViewKey(latestView);
        viewPersistTimerRef.current = null;
      }, 280);
    },
    [onViewChange]
  );

  const flushPendingInstances = useCallback(() => {
    if (instancesPersistTimerRef.current !== null) {
      window.clearTimeout(instancesPersistTimerRef.current);
      instancesPersistTimerRef.current = null;
    }

    const instances = pendingInstancesRef.current;
    if (!instances) {
      return;
    }

    pendingInstancesRef.current = null;
    onInstancesChange(instances);
  }, [onInstancesChange]);

  const scheduleInstancesPersist = useCallback(
    (instances: CanvasInstance[]) => {
      pendingInstancesRef.current = instances;
      if (instancesPersistTimerRef.current !== null) {
        window.clearTimeout(instancesPersistTimerRef.current);
      }

      instancesPersistTimerRef.current = window.setTimeout(() => {
        flushPendingInstances();
      }, 140);
    },
    [flushPendingInstances]
  );

  const syncFromEditor = useCallback(
    (editor: Editor, changedShapes?: MorphoShape[]) => {
      const currentWorkspace = latestWorkspaceRef.current;
      const pageShapes = changedShapes ?? editor.getCurrentPageShapes().filter(isMorphoShape);
      const inactiveShapes = pageShapes.filter((shape) => !isMorphoShapeActiveInWorkspace(shape, currentWorkspace));
      if (inactiveShapes.length > 0) {
        editor.deleteShapes(inactiveShapes.map((shape) => shape.id));
      }

      if (
        shouldAcceptCanvasSelection({
          documentVisible: document.visibilityState === "visible",
          windowFocused: windowFocusedRef.current
        })
      ) {
        const selectedShapes = editor
          .getSelectedShapes()
          .filter(isMorphoShape)
          .filter((shape) => isMorphoShapeActiveInWorkspace(shape, currentWorkspace));
        const selectedIds = getSelectedMorphoShapeIds(selectedShapes);
        const selectionKey = selectedIds.objectIds.join("|");
        if (selectionKey !== lastSelectionRef.current) {
          lastSelectionRef.current = selectionKey;
          onSelectionChange(selectedIds.objectIds);
        }
      }

      const movedInstances = pageShapes
        .filter((shape) => isMorphoShapeActiveInWorkspace(shape, currentWorkspace))
        .map((shape) => ({
          id: shape.props.instanceId,
          objectId: shape.props.objectId,
          position: { x: shape.x, y: shape.y },
          size: { w: shape.props.w, h: shape.props.h }
        }));

      if (movedInstances.length > 0) {
        scheduleInstancesPersist(movedInstances);
      }
      const camera = editor.getCamera();
      const nextView = { x: camera.x, y: camera.y, zoom: camera.z };
      setLiveView(nextView);
      scheduleViewPersist(nextView);
    },
    [onSelectionChange, scheduleInstancesPersist, scheduleViewPersist]
  );

  const syncWorkspaceToEditor = useCallback(
    (editor: Editor) => {
      const shapes = editor.getCurrentPageShapes().filter(isMorphoShape);
      const shapesByInstance = new Map(shapes.map((shape) => [shape.props.instanceId, shape]));
      const renderableInstances = getRenderableCanvasInstances(workspace);
      const renderableInstanceIds = new Set(renderableInstances.map((instance) => instance.id));
      const pendingInstances = pendingInstancesRef.current;
      const toCreate: TLShapePartial<MorphoShape>[] = [];
      const toUpdate: MorphoShape[] = [];
      const toDelete = shapes.filter((shape) => !renderableInstanceIds.has(shape.props.instanceId));

      for (const instance of renderableInstances) {
        const object = workspace.objects[instance.objectId];
        if (!object) {
          continue;
        }

        const existing = shapesByInstance.get(instance.id);
        const renderInstance = resolveInstanceForEditorSync(instance, pendingInstances);
        const assetUrl = object.type === "image" && object.assetId ? assetUrls[object.assetId] : undefined;
        if (!existing) {
          toCreate.push(
            createMorphoShapePartial(
              renderInstance,
              object,
              assetUrl,
              workspace,
              traceObjectIds.includes(object.id),
              highlightedObjectId === object.id
            )
          );
        } else {
          const nextProps = {
            ...getMorphoShapeProps(renderInstance, object, assetUrl, workspace, highlightedObjectId === object.id),
            isBeingLocallyEdited: object.id === annotatedObjectId,
            isInDesignTrace: traceObjectIds.includes(object.id)
          };
          if (!areMorphoShapePropsEqual(existing.props, nextProps)) {
            toUpdate.push({
              ...existing,
              props: nextProps
            });
          }
        }
      }

      editor.run(() => {
        if (toCreate.length > 0) {
          editor.createShapes(toCreate);
        }

        if (toUpdate.length > 0) {
          editor.updateShapes(toUpdate);
        }

        if (toDelete.length > 0) {
          editor.deleteShapes(toDelete.map((shape) => shape.id));
        }

      }, MORPHO_EDITOR_SYNC_RUN_OPTIONS);
    },
    [annotatedObjectId, assetUrls, highlightedObjectId, traceObjectIds, workspace]
  );

  const getPagePoint = useCallback((clientX: number, clientY: number): CanvasPoint => {
    const editor = editorRef.current;
    if (!editor) {
      return {
        x: workspace.canvas.view.x,
        y: workspace.canvas.view.y
      };
    }

    const point = editor.screenToPage({ x: clientX, y: clientY });
    return { x: point.x, y: point.y };
  }, [workspace.canvas.view.x, workspace.canvas.view.y]);

  const handleDropCapture = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const files = Array.from(event.dataTransfer.files);
      const url = event.dataTransfer.getData("text/uri-list") || getUrlFromText(event.dataTransfer.getData("text/plain"));
      const text = files.length === 0 && !url ? event.dataTransfer.getData("text/plain") : "";

      if (files.length === 0 && !url && !text.trim()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onImportRequest({
        position: getPagePoint(event.clientX, event.clientY),
        files,
        url: url || undefined,
        text: text.trim() || undefined
      });
    },
    [getPagePoint, onImportRequest]
  );

  const handlePasteCapture = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (!event.target || isEditableEventTarget(event.target)) {
        return;
      }

      const files = Array.from(event.clipboardData.files);
      const text = event.clipboardData.getData("text/plain");
      const url = getUrlFromText(text);

      if (files.length === 0 && !text.trim()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const editor = editorRef.current;
      const point = editor?.inputs.getCurrentPagePoint() ?? {
        x: workspace.canvas.view.x + 160,
        y: workspace.canvas.view.y + 160
      };
      onImportRequest({
        position: { x: point.x, y: point.y },
        files,
        url: url || undefined,
        text: files.length === 0 && !url ? text.trim() : undefined
      });
    },
    [onImportRequest, workspace.canvas.view.x, workspace.canvas.view.y]
  );

  const openContextMenuAt = useCallback(
    (clientX: number, clientY: number) => {
      const editor = editorRef.current;
      if (!editor) {
        onContextMenuRequest({ x: clientX, y: clientY, objectId: null });
        return;
      }

      const point = editor.screenToPage({ x: clientX, y: clientY });
      const targetShape = [...editor.getCurrentPageShapesSorted()]
        .filter(isMorphoShape)
        .filter((shape) => workspace.objects[shape.props.objectId]?.visibility === "active")
        .reverse()
        .find((shape) => isPointInsideShape(point, shape));

      const selectedShapeIds = editor.getSelectedShapeIds().map((shapeId) => shapeId.toString());
      if (targetShape && shouldReplaceSelectionForContextMenuTarget(targetShape.id.toString(), selectedShapeIds)) {
        editor.select(targetShape.id);
      }

      onContextMenuRequest({
        x: clientX,
        y: clientY,
        objectId: targetShape?.props.objectId ?? null
      });
      lastContextMenuOpenAtRef.current = Date.now();
    },
    [onContextMenuRequest, workspace.objects]
  );

  const handleContextMenuPointerDown = useCallback(
    (event: globalThis.PointerEvent) => {
      if (!shouldOpenCanvasContextMenuFromPointerDown(event) || !event.target || isEditableEventTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openContextMenuAt(event.clientX, event.clientY);
    },
    [openContextMenuAt]
  );

  const suppressNativeContextMenu = useCallback(
    (event: globalThis.MouseEvent) => {
      if (!event.target || isEditableEventTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (Date.now() - lastContextMenuOpenAtRef.current > 250) {
        openContextMenuAt(event.clientX, event.clientY);
      }
    },
    [openContextMenuAt]
  );

  const handleCanvasWheel = useCallback((event: WheelEvent) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const pagePoint = editor.screenToPage({ x: event.clientX, y: event.clientY });
    const camera = editor.getCamera();
    const nextView = calculateAnchoredZoom({
      camera: { x: camera.x, y: camera.y, zoom: camera.z },
      anchorPagePoint: { x: pagePoint.x, y: pagePoint.y },
      deltaY: event.deltaY,
      minZoom: MIN_WHEEL_ZOOM,
      maxZoom: MAX_WHEEL_ZOOM
    });
    editor.setCamera(new Vec(nextView.x, nextView.y, nextView.zoom), {
      immediate: true
    });
    setLiveView(nextView);
    scheduleViewPersist(nextView);
  }, [scheduleViewPersist]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return;
    }

    host.addEventListener("wheel", handleCanvasWheel, {
      capture: true,
      passive: false
    });

    return () => {
      host.removeEventListener("wheel", handleCanvasWheel, {
        capture: true
      });
    };
  }, [handleCanvasWheel]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return;
    }

    host.addEventListener("pointerdown", handleContextMenuPointerDown, {
      capture: true
    });
    host.addEventListener("contextmenu", suppressNativeContextMenu, {
      capture: true
    });

    return () => {
      host.removeEventListener("pointerdown", handleContextMenuPointerDown, {
        capture: true
      });
      host.removeEventListener("contextmenu", suppressNativeContextMenu, {
        capture: true
      });
    };
  }, [handleContextMenuPointerDown, suppressNativeContextMenu]);

  useEffect(() => {
    const flushInteractionState = () => {
      flushPendingInstances();
      flushViewPersist();
    };
    const restoreSelectionFromParent = () => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }

      const selectedObjectIdSet = new Set(latestSelectedObjectIdsRef.current);
      const shapeIds = editor
        .getCurrentPageShapes()
        .filter(isMorphoShape)
        .filter((shape) => selectedObjectIdSet.has(shape.props.objectId))
        .map((shape) => shape.id);
      lastSelectionRef.current = latestSelectedObjectIdsRef.current.join("|");
      editor.select(...shapeIds);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        windowFocusedRef.current = false;
        flushInteractionState();
      }
    };
    const handleWindowBlur = () => {
      windowFocusedRef.current = false;
      flushInteractionState();
    };
    const handleWindowFocus = () => {
      windowFocusedRef.current = true;
      window.requestAnimationFrame(restoreSelectionFromParent);
    };
    const host = canvasHostRef.current;

    host?.addEventListener("pointerup", flushInteractionState, { capture: true });
    host?.addEventListener("pointercancel", flushInteractionState, { capture: true });
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("beforeunload", flushInteractionState);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      host?.removeEventListener("pointerup", flushInteractionState, { capture: true });
      host?.removeEventListener("pointercancel", flushInteractionState, { capture: true });
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("beforeunload", flushInteractionState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushPendingInstances, flushViewPersist]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    syncWorkspaceToEditor(editor);
  }, [syncWorkspaceToEditor]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !shouldApplyFocusRequest(focusRequest, lastAppliedFocusNonceRef.current)) {
      return;
    }
    lastAppliedFocusNonceRef.current = focusRequest.nonce;

    if (focusRequest.view) {
      const selectedObjectIdSet = new Set(focusRequest.selectionObjectIds ?? []);
      const shapeIds = editor
        .getCurrentPageShapes()
        .filter(isMorphoShape)
        .filter((shape) => selectedObjectIdSet.has(shape.props.objectId))
        .map((shape) => shape.id);
      lastSelectionRef.current = (focusRequest.selectionObjectIds ?? []).join("|");
      editor.select(...shapeIds);
      editor.setCamera(new Vec(focusRequest.view.x, focusRequest.view.y, focusRequest.view.zoom), {
        immediate: true
      });
      scheduleViewPersist(focusRequest.view);
      return;
    }

    if (focusRequest.objectId) {
      const shape = editor.getCurrentPageShapes().filter(isMorphoShape).find((candidate) => candidate.props.objectId === focusRequest.objectId);
      if (shape) {
        editor.select(shape.id);
        editor.zoomToSelection({
          animation: { duration: 360 }
        });
        window.setTimeout(() => {
          const camera = editor.getCamera();
          scheduleViewPersist({ x: camera.x, y: camera.y, zoom: camera.z });
        }, 420);
      }
      return;
    }

    if (focusRequest.area) {
      const bounds = resolveFocusBounds(workspace, focusRequest.area);
      editor.zoomToBounds(bounds, {
        animation: { duration: 360 },
        inset: 120,
        targetZoom: bounds.zoom
      });
      window.setTimeout(() => {
        const camera = editor.getCamera();
        scheduleViewPersist({ x: camera.x, y: camera.y, zoom: camera.z });
      }, 420);
    }
  }, [focusRequest, scheduleViewPersist, workspace]);

  useEffect(() => {
    return () => {
      flushPendingInstances();
      flushViewPersist();
    };
  }, [flushPendingInstances, flushViewPersist]);

  return (
    <div
      ref={canvasHostRef}
      className="workspace-canvas"
      onDragOverCapture={(event) => event.preventDefault()}
      onDropCapture={handleDropCapture}
      onPasteCapture={handlePasteCapture}
    >
      <Tldraw
        components={canvasComponents}
        hideUi
        shapeUtils={shapeUtils}
        colorScheme="light"
        onMount={(editor) => {
          editorRef.current = editor;
          editor.user.updateUserPreferences({ isSnapMode: true });
          syncWorkspaceToEditor(editor);
          latestViewRef.current = workspace.canvas.view;
          lastPersistedViewKeyRef.current = getCanvasViewKey(workspace.canvas.view);
          editor.setCamera({ x: workspace.canvas.view.x, y: workspace.canvas.view.y, z: workspace.canvas.view.zoom });
          setLiveView(workspace.canvas.view);
          onLiveViewChange?.(workspace.canvas.view);

          const cleanup = editor.store.listen((entry) => {
            const changedShapes = [
              ...Object.values(entry.changes.added),
              ...Object.values(entry.changes.updated).map(([, after]) => after)
            ].filter((record): record is MorphoShape => "type" in record && isMorphoShape(record as TLShape));
            syncFromEditor(editor, changedShapes);
          });

          return () => {
            cleanup();
            editorRef.current = null;
          };
        }}
      />
      {pendingSlotRects.length > 0 ? (
        <div className="pending-generation-layer" aria-live="polite">
          {pendingSlotRects.map((slot) => (
            <div
              className="pending-generation-slot"
              key={slot.id}
              style={{
                left: slot.left,
                top: slot.top,
                width: slot.width,
                height: slot.height
              }}
            >
              <span className="pending-generation-spinner" aria-hidden="true" />
              <div>
                <span>{pendingSlotRoleLabel(slot.role)}</span>
                <strong>{slot.title}</strong>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const CanvasRelationshipOverlay = track(function CanvasRelationshipOverlay({
  workspace,
  emphasizedObjectId
}: {
  workspace: MorphoWorkspace;
  emphasizedObjectId: string | null;
}) {
  const editor = useEditor();
  const routeCacheRef = useRef(createRelationshipRouteCache());
  const boundsKeyByObjectRef = useRef(new Map<string, string>());
  const shapes = editor.getCurrentPageShapes().filter(isMorphoShape);
  const boundsByObjectId = new Map<string, CanvasPageBounds>();
  for (const shape of shapes) {
    const bounds = editor.getShapePageBounds(shape);
    if (!bounds) continue;
    const nextBounds = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
    const key = `${nextBounds.x}:${nextBounds.y}:${nextBounds.w}:${nextBounds.h}`;
    const previousKey = boundsKeyByObjectRef.current.get(shape.props.objectId);
    if (previousKey !== key) {
      routeCacheRef.current.invalidateConnectedObject(shape.props.objectId);
      if (!previousKey) {
        routeCacheRef.current.clear();
      }
      boundsKeyByObjectRef.current.set(shape.props.objectId, key);
    }
    boundsByObjectId.set(shape.props.objectId, nextBounds);
  }

  const visibleEdges = collectDirectCanvasEdges(workspace).filter(
    (edge) => boundsByObjectId.has(edge.fromObjectId) && boundsByObjectId.has(edge.toObjectId)
  );
  const portIndexByObject = new Map<string, number>();
  const portCountByObject = new Map<string, number>();
  for (const edge of visibleEdges) {
    portCountByObject.set(edge.fromObjectId, (portCountByObject.get(edge.fromObjectId) ?? 0) + 1);
    portCountByObject.set(edge.toObjectId, (portCountByObject.get(edge.toObjectId) ?? 0) + 1);
  }

  const routes = visibleEdges.map((edge) => {
    const key = `${edge.fromObjectId}:${edge.toObjectId}`;
    const sourceIndex = portIndexByObject.get(edge.fromObjectId) ?? 0;
    const targetIndex = portIndexByObject.get(edge.toObjectId) ?? 0;
    portIndexByObject.set(edge.fromObjectId, sourceIndex + 1);
    portIndexByObject.set(edge.toObjectId, targetIndex + 1);
    const source = boundsByObjectId.get(edge.fromObjectId)!;
    const target = boundsByObjectId.get(edge.toObjectId)!;
    const endpointObjectIds = [edge.fromObjectId, edge.toObjectId];
    const cached = routeCacheRef.current.get(key);
    const route = cached ?? buildRelationshipRoute({
      source,
      target,
      obstacles: [],
      sourcePort: { index: sourceIndex, count: portCountByObject.get(edge.fromObjectId) ?? 1 },
      targetPort: { index: targetIndex, count: portCountByObject.get(edge.toObjectId) ?? 1 }
    });
    if (!cached) routeCacheRef.current.set(key, route, endpointObjectIds);
    const emphasized = emphasizedObjectId === edge.fromObjectId || emphasizedObjectId === edge.toObjectId || editor.getSelectedShapeIds().some((shapeId) => {
      const shape = editor.getShape(shapeId);
      if (!shape || !isMorphoShape(shape)) return false;
      return shape.props.objectId === edge.fromObjectId || shape.props.objectId === edge.toObjectId;
    });
    return { key, edge, route, emphasized };
  });

  return (
    <svg className="canvas-relationship-overlay" viewBox="0 0 1 1" aria-hidden="true">
      {routes.map(({ key, edge, route, emphasized }) => (
        <path
          key={key}
          className={emphasized ? "is-emphasized" : edge.primary ? "is-primary" : "is-secondary"}
          d={buildRelationshipPath(route)}
        />
      ))}
    </svg>
  );
});

const SELECTION_TOOLBAR_SIZE = { w: 460, h: 44 } as const;
const SELECTION_TOOLBAR_MARGIN = 18;
const SELECTION_TOOLBAR_GAP = 12;

const CanvasSelectionToolbar = track(function CanvasSelectionToolbar({
  workspace,
  floatingChromeKey,
  renderToolbar
}: {
  workspace: MorphoWorkspace;
  floatingChromeKey: string;
  renderToolbar: (selectedObjects: MorphoObject[], placement: SelectionToolbarPlacement) => ReactNode;
}) {
  const editor = useEditor();
  // Read path + input atoms so track() re-renders when idle / drag / pan changes.
  const isSelectIdle = editor.isIn("select.idle");
  const isDragging = editor.inputs.getIsDragging();
  const isPanning = editor.inputs.getIsPanning();
  /**
   * Obstacle DOM (drawers / AI panel) often commits in the same React update as
   * floatingChromeKey. Measuring during that render still sees the previous DOM.
   * Remeasure after layout so "toolbar already open → open panel" hides correctly.
   */
  const [obstacleEpoch, setObstacleEpoch] = useState(0);
  useLayoutEffect(() => {
    setObstacleEpoch((value) => value + 1);
  }, [floatingChromeKey]);

  if (
    !shouldShowSelectionToolbarForInteraction({
      isSelectIdle,
      isDragging,
      isPanning
    })
  ) {
    return null;
  }

  const bounds = editor.getSelectionRotatedScreenBounds();
  const selectedObjects = editor
    .getSelectedShapes()
    .filter(isMorphoShape)
    .map((shape) => workspace.objects[shape.props.objectId])
    .filter((object): object is MorphoObject => Boolean(object));
  if (!bounds || selectedObjects.length === 0) {
    return null;
  }

  // Read epoch so layout remount forces a fresh obstacle query + placement.
  void obstacleEpoch;
  const obstacles = collectSelectionToolbarObstacles();
  const placement = getSelectionToolbarPlacement(
    { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
    { w: window.innerWidth, h: window.innerHeight },
    {
      toolbar: { w: SELECTION_TOOLBAR_SIZE.w, h: SELECTION_TOOLBAR_SIZE.h },
      margin: SELECTION_TOOLBAR_MARGIN,
      gap: SELECTION_TOOLBAR_GAP,
      obstacles
    }
  );
  if (!placement) {
    return null;
  }

  return <>{renderToolbar(selectedObjects, placement)}</>;
});

function collectSelectionToolbarObstacles(): ScreenRect[] {
  if (typeof document === "undefined") {
    return [];
  }

  const clientRects: Array<Pick<DOMRect, "left" | "top" | "width" | "height">> = [];
  for (const selector of SELECTION_TOOLBAR_OBSTACLE_SELECTORS) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      // Collapsed AI is already excluded by selector; skip other inert nodes.
      if (element.getClientRects().length === 0) {
        return;
      }
      clientRects.push(element.getBoundingClientRect());
    });
  }

  return screenRectsFromClientRects(clientRects);
}

function getUrlFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed).href;
  } catch {
    return "";
  }
}

function pendingSlotRoleLabel(role: string): string {
  switch (role) {
    case "primaryVisual":
      return "主图";
    case "sceneVisual":
      return "场景图";
    case "cmfStudy":
      return "CMF 研究";
    case "detailStudy":
      return "细节图";
    case "structureDiagram":
      return "设计示意";
    case "deliveryAsset":
      return "交付素材";
    case "preview":
    case "conceptImage":
    default:
      return "正在生成";
  }
}

export function shouldOpenCanvasContextMenuFromPointerDown(event: Pick<globalThis.PointerEvent, "button">): boolean {
  return event.button === 2;
}

export function shouldReplaceSelectionForContextMenuTarget(targetShapeId: string, selectedShapeIds: string[]): boolean {
  return !selectedShapeIds.includes(targetShapeId);
}

export function getSelectedMorphoShapeIds(
  shapes: Array<{ props: Pick<MorphoShape["props"], "objectId" | "morphoType"> }>
): { objectIds: string[]; proposalIds: string[] } {
  const objectIds: string[] = [];
  const proposalIds: string[] = [];

  for (const shape of shapes) {
    objectIds.push(shape.props.objectId);
    if (shape.props.morphoType === "proposalDraft") {
      proposalIds.push(shape.props.objectId);
    }
  }

  return { objectIds, proposalIds };
}

export function isMorphoShapeActiveInWorkspace(
  shape: { props: Pick<MorphoShape["props"], "objectId"> & { morphoType?: string } },
  workspace: Pick<MorphoWorkspace, "objects" | "artifactProposals">
): boolean {
  return workspace.objects[shape.props.objectId]?.visibility === "active";
}

function getCanvasViewKey(view: CanvasView): string {
  return `${view.x}:${view.y}:${view.zoom}`;
}

function isEditableEventTarget(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable;
}

function isPointInsideShape(point: { x: number; y: number }, shape: MorphoShape): boolean {
  return (
    point.x >= shape.x &&
    point.x <= shape.x + shape.props.w &&
    point.y >= shape.y &&
    point.y <= shape.y + shape.props.h
  );
}

export function getShapeIdForInstance(instanceId: string): TLShapeId {
  return `shape:${instanceId}` as TLShapeId;
}

export function resolveInstanceForEditorSync(instance: CanvasInstance, pendingInstances: CanvasInstance[] | null): CanvasInstance {
  return pendingInstances?.find((pendingInstance) => pendingInstance.id === instance.id) ?? instance;
}

export function areMorphoShapePropsEqual(left: MorphoShape["props"], right: MorphoShape["props"]): boolean {
  return (
    left.w === right.w &&
    left.h === right.h &&
    left.objectId === right.objectId &&
    left.instanceId === right.instanceId &&
    left.morphoType === right.morphoType &&
    left.title === right.title &&
    left.summary === right.summary &&
    left.label === right.label &&
    left.imageVariant === right.imageVariant &&
    left.isDefaultReference === right.isDefaultReference &&
    left.isBeingLocallyEdited === right.isBeingLocallyEdited &&
    left.isInDesignTrace === right.isInDesignTrace &&
    left.isDetailReferenceHighlighted === right.isDetailReferenceHighlighted &&
    left.assetUrl === right.assetUrl &&
    areStringArraysEqual(left.details, right.details)
  );
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
