"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { Tldraw, Vec, type Editor, type TLShapeId, type TLShapePartial } from "tldraw";

import { calculateAnchoredZoom } from "@/domain/morpho/canvasCamera";
import type { DesignTraceEdge } from "@/domain/morpho/designTrace";
import type { CanvasInstance, CanvasPoint, CanvasView, MorphoWorkspace } from "@/domain/morpho/types";
import { getRenderableCanvasInstances } from "@/domain/morpho/workspace";
import type { ScreenRect } from "../selectionToolbar";
import {
  MORPHO_SHAPE_TYPE,
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
  nonce: number;
};

type MorphoCanvasProps = {
  workspace: MorphoWorkspace;
  annotatedObjectId: string | null;
  traceObjectIds: string[];
  traceEdges: DesignTraceEdge[];
  assetUrls: Record<string, string>;
  focusRequest: FocusRequest;
  onSelectionChange: (objectIds: string[]) => void;
  onSelectionBoundsChange: (bounds: ScreenRect | null) => void;
  onInstancesChange: (instances: CanvasInstance[]) => void;
  onViewChange: (view: CanvasView) => void;
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
  return focusRequest.nonce !== lastAppliedNonce && Boolean(focusRequest.area || focusRequest.objectId);
}

type TraceOverlayNode = {
  objectId: string;
  x: number;
  y: number;
};

type TraceOverlayEdge = {
  key: string;
  from: TraceOverlayNode;
  to: TraceOverlayNode;
};

export function MorphoCanvas({
  workspace,
  annotatedObjectId,
  traceObjectIds,
  traceEdges,
  assetUrls,
  focusRequest,
  onSelectionChange,
  onSelectionBoundsChange,
  onInstancesChange,
  onViewChange,
  onImportRequest,
  onContextMenuRequest
}: MorphoCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const lastSelectionRef = useRef("");
  const lastInstancesRef = useRef("");
  const pendingInstancesRef = useRef<CanvasInstance[] | null>(null);
  const instancesPersistTimerRef = useRef<number | null>(null);
  const lastAppliedFocusNonceRef = useRef<number | null>(null);
  const viewPersistTimerRef = useRef<number | null>(null);
  const latestViewRef = useRef<CanvasView>(workspace.canvas.view);
  const lastPersistedViewKeyRef = useRef(getCanvasViewKey(workspace.canvas.view));
  const lastContextMenuOpenAtRef = useRef(0);
  const latestWorkspaceRef = useRef(workspace);
  const [liveView, setLiveView] = useState<CanvasView>(workspace.canvas.view);

  useLayoutEffect(() => {
    latestWorkspaceRef.current = workspace;
  }, [workspace]);
  const traceOverlayEdges = useMemo(() => {
    if (traceObjectIds.length === 0 || traceEdges.length === 0) {
      return [];
    }

    const traceObjectIdSet = new Set(traceObjectIds);
    const instanceByObjectId = new Map(workspace.canvas.instances.map((instance) => [instance.objectId, instance]));
    const nodeByObjectId = new Map<string, TraceOverlayNode>();
    for (const objectId of traceObjectIdSet) {
      const instance = instanceByObjectId.get(objectId);
      if (!instance) {
        continue;
      }

      nodeByObjectId.set(objectId, {
        objectId,
        x: (instance.position.x + instance.size.w / 2) * liveView.zoom + liveView.x,
        y: (instance.position.y + instance.size.h / 2) * liveView.zoom + liveView.y
      });
    }

    return traceEdges
      .map((edge, index) => {
        const from = nodeByObjectId.get(edge.fromObjectId);
        const to = nodeByObjectId.get(edge.toObjectId);
        return from && to
          ? {
              key: `${edge.kind}-${edge.fromObjectId}-${edge.toObjectId}-${index}`,
              from,
              to
            }
          : null;
      })
      .filter((edge): edge is TraceOverlayEdge => Boolean(edge));
  }, [liveView, traceEdges, traceObjectIds, workspace.canvas.instances]);

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
    (editor: Editor) => {
      const currentWorkspace = latestWorkspaceRef.current;
      const pageShapes = editor.getCurrentPageShapes().filter(isMorphoShape);
      const inactiveShapes = pageShapes.filter((shape) => !isMorphoShapeActiveInWorkspace(shape, currentWorkspace));
      if (inactiveShapes.length > 0) {
        editor.deleteShapes(inactiveShapes.map((shape) => shape.id));
      }

      const selectedShapes = editor
        .getSelectedShapes()
        .filter(isMorphoShape)
        .filter((shape) => isMorphoShapeActiveInWorkspace(shape, currentWorkspace));
      const selectedObjectIds = selectedShapes.map((shape) => shape.props.objectId);
      const selectionKey = selectedObjectIds.join("|");
      if (selectionKey !== lastSelectionRef.current) {
        lastSelectionRef.current = selectionKey;
        onSelectionChange(selectedObjectIds);
      }
      onSelectionBoundsChange(calculateSelectionScreenBounds(editor));

      const movedInstances = editor
        .getCurrentPageShapes()
        .filter(isMorphoShape)
        .filter((shape) => isMorphoShapeActiveInWorkspace(shape, currentWorkspace))
        .map((shape) => ({
          id: shape.props.instanceId,
          objectId: shape.props.objectId,
          position: { x: shape.x, y: shape.y },
          size: { w: shape.props.w, h: shape.props.h }
        }));

      const instancesKey = JSON.stringify(movedInstances);
      if (instancesKey !== lastInstancesRef.current) {
        lastInstancesRef.current = instancesKey;
        scheduleInstancesPersist(movedInstances);
      }
      const camera = editor.getCamera();
      const nextView = { x: camera.x, y: camera.y, zoom: camera.z };
      setLiveView(nextView);
      scheduleViewPersist(nextView);
    },
    [onSelectionBoundsChange, onSelectionChange, scheduleInstancesPersist, scheduleViewPersist]
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
          toCreate.push(createMorphoShapePartial(renderInstance, object, assetUrl, workspace, traceObjectIds.includes(object.id)));
        } else {
          const nextProps = {
            ...getMorphoShapeProps(renderInstance, object, assetUrl, workspace),
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

        const orderedShapeIds = renderableInstances
          .map((instance) =>
            editor
              .getCurrentPageShapes()
              .filter(isMorphoShape)
              .find((shape) => shape.props.instanceId === instance.id)?.id
          )
          .filter((id): id is TLShapeId => Boolean(id));
        for (const shapeId of orderedShapeIds) {
          editor.bringToFront([shapeId]);
        }
      }, MORPHO_EDITOR_SYNC_RUN_OPTIONS);
    },
    [annotatedObjectId, assetUrls, traceObjectIds, workspace]
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
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushInteractionState();
      }
    };
    const host = canvasHostRef.current;

    host?.addEventListener("pointerup", flushInteractionState, { capture: true });
    host?.addEventListener("pointercancel", flushInteractionState, { capture: true });
    window.addEventListener("blur", flushInteractionState);
    window.addEventListener("beforeunload", flushInteractionState);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      host?.removeEventListener("pointerup", flushInteractionState, { capture: true });
      host?.removeEventListener("pointercancel", flushInteractionState, { capture: true });
      window.removeEventListener("blur", flushInteractionState);
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
        hideUi
        shapeUtils={shapeUtils}
        colorScheme="light"
        onMount={(editor) => {
          editorRef.current = editor;
          syncWorkspaceToEditor(editor);
          latestViewRef.current = workspace.canvas.view;
          lastPersistedViewKeyRef.current = getCanvasViewKey(workspace.canvas.view);
          editor.setCamera({ x: workspace.canvas.view.x, y: workspace.canvas.view.y, z: workspace.canvas.view.zoom });
          setLiveView(workspace.canvas.view);

          const cleanup = editor.store.listen(() => {
            syncFromEditor(editor);
          });

          return () => {
            cleanup();
            editorRef.current = null;
          };
        }}
      />
      {traceOverlayEdges.length > 0 ? (
        <svg className="design-trace-overlay" aria-hidden="true">
          {traceOverlayEdges.map((edge) => (
            <line
              key={edge.key}
              x1={edge.from.x}
              y1={edge.from.y}
              x2={edge.to.x}
              y2={edge.to.y}
            />
          ))}
        </svg>
      ) : null}
    </div>
  );
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

export function shouldOpenCanvasContextMenuFromPointerDown(event: Pick<globalThis.PointerEvent, "button">): boolean {
  return event.button === 2;
}

export function shouldReplaceSelectionForContextMenuTarget(targetShapeId: string, selectedShapeIds: string[]): boolean {
  return !selectedShapeIds.includes(targetShapeId);
}

export function isMorphoShapeActiveInWorkspace(
  shape: { props: Pick<MorphoShape["props"], "objectId"> },
  workspace: Pick<MorphoWorkspace, "objects">
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

function calculateSelectionScreenBounds(editor: Editor): ScreenRect | null {
  const bounds = editor.getSelectionPageBounds();
  if (!bounds) {
    return null;
  }

  const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y });
  const bottomRight = editor.pageToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h });

  return {
    x: Math.min(topLeft.x, bottomRight.x),
    y: Math.min(topLeft.y, bottomRight.y),
    w: Math.abs(bottomRight.x - topLeft.x),
    h: Math.abs(bottomRight.y - topLeft.y)
  };
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
    left.assetUrl === right.assetUrl &&
    areStringArraysEqual(left.details, right.details)
  );
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
