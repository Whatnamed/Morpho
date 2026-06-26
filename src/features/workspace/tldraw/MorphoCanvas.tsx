"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { Tldraw, Vec, type Editor, type TLShapeId } from "tldraw";

import { calculateAnchoredZoom } from "@/domain/morpho/canvasCamera";
import type { DesignTraceEdge } from "@/domain/morpho/designTrace";
import type { CanvasInstance, CanvasPoint, CanvasView, MorphoWorkspace } from "@/domain/morpho/types";
import { getRenderableCanvasInstances } from "@/domain/morpho/workspace";
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
  onInstancesChange: (instances: CanvasInstance[]) => void;
  onViewChange: (view: CanvasView) => void;
  onImportRequest: (request: CanvasImportRequest) => void;
};

export type CanvasImportRequest = {
  position: CanvasPoint;
  files?: File[];
  text?: string;
  url?: string;
};

const shapeUtils = [MorphoShapeUtil];
const MIN_WHEEL_ZOOM = 0.12;
const MAX_WHEEL_ZOOM = 2.4;

const focusBounds: Record<FocusArea, { x: number; y: number; w: number; h: number; zoom: number }> = {
  overview: { x: 0, y: 30, w: 3050, h: 900, zoom: 0.34 },
  research: { x: 20, y: 150, w: 940, h: 720, zoom: 0.72 },
  definition: { x: 740, y: 160, w: 520, h: 520, zoom: 0.78 },
  visual: { x: 1100, y: 110, w: 1400, h: 720, zoom: 0.55 },
  delivery: { x: 2520, y: 190, w: 520, h: 760, zoom: 0.72 }
};

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
  onInstancesChange,
  onViewChange,
  onImportRequest
}: MorphoCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const lastSelectionRef = useRef("");
  const lastInstancesRef = useRef("");
  const viewPersistTimerRef = useRef<number | null>(null);
  const [liveView, setLiveView] = useState<CanvasView>(workspace.canvas.view);
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

  const scheduleViewPersist = useCallback(
    (view: CanvasView) => {
      if (viewPersistTimerRef.current !== null) {
        window.clearTimeout(viewPersistTimerRef.current);
      }

      viewPersistTimerRef.current = window.setTimeout(() => {
        onViewChange(view);
        viewPersistTimerRef.current = null;
      }, 280);
    },
    [onViewChange]
  );

  const syncFromEditor = useCallback(
    (editor: Editor) => {
      const selectedObjectIds = editor
        .getSelectedShapes()
        .filter(isMorphoShape)
        .map((shape) => shape.props.objectId);
      const selectionKey = selectedObjectIds.join("|");
      if (selectionKey !== lastSelectionRef.current) {
        lastSelectionRef.current = selectionKey;
        onSelectionChange(selectedObjectIds);
      }

      const movedInstances = editor
        .getCurrentPageShapes()
        .filter(isMorphoShape)
        .map((shape) => ({
          id: shape.props.instanceId,
          objectId: shape.props.objectId,
          position: { x: shape.x, y: shape.y },
          size: { w: shape.props.w, h: shape.props.h }
        }));

      const instancesKey = JSON.stringify(movedInstances);
      if (instancesKey !== lastInstancesRef.current) {
        lastInstancesRef.current = instancesKey;
        onInstancesChange(movedInstances);
      }
      const camera = editor.getCamera();
      setLiveView({ x: camera.x, y: camera.y, zoom: camera.z });
    },
    [onInstancesChange, onSelectionChange]
  );

  const syncWorkspaceToEditor = useCallback(
    (editor: Editor) => {
      const shapes = editor.getCurrentPageShapes().filter(isMorphoShape);
      const shapesByInstance = new Map(shapes.map((shape) => [shape.props.instanceId, shape]));
      const renderableInstances = getRenderableCanvasInstances(workspace);
      const renderableInstanceIds = new Set(renderableInstances.map((instance) => instance.id));
      const toCreate = [];
      const toUpdate: MorphoShape[] = [];
      const toDelete = shapes.filter((shape) => !renderableInstanceIds.has(shape.props.instanceId));

      for (const instance of renderableInstances) {
        const object = workspace.objects[instance.objectId];
        if (!object) {
          continue;
        }

        const existing = shapesByInstance.get(instance.id);
        const assetUrl = object.type === "image" && object.assetId ? assetUrls[object.assetId] : undefined;
        if (!existing) {
          toCreate.push(createMorphoShapePartial(instance, object, assetUrl, workspace, traceObjectIds.includes(object.id)));
        } else {
          toUpdate.push({
            ...existing,
            props: {
              ...getMorphoShapeProps(instance, object, assetUrl, workspace),
              isBeingLocallyEdited: object.id === annotatedObjectId,
              isInDesignTrace: traceObjectIds.includes(object.id)
            }
          });
        }
      }

      if (toCreate.length > 0) {
        editor.createShapes(toCreate);
      }

      if (toUpdate.length > 0) {
        editor.updateShapes(toUpdate);
      }

      if (toDelete.length > 0) {
        editor.deleteShapes(toDelete.map((shape) => shape.id));
      }
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
      if (isEditableEventTarget(event.target)) {
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
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    syncWorkspaceToEditor(editor);
  }, [syncWorkspaceToEditor]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
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
      const bounds = focusBounds[focusRequest.area];
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
  }, [focusRequest, scheduleViewPersist]);

  useEffect(() => {
    return () => {
      if (viewPersistTimerRef.current !== null) {
        window.clearTimeout(viewPersistTimerRef.current);
      }
    };
  }, []);

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
        autoFocus
        shapeUtils={shapeUtils}
        colorScheme="light"
        onMount={(editor) => {
          editorRef.current = editor;
          syncWorkspaceToEditor(editor);
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

function isEditableEventTarget(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable;
}

export function getShapeIdForInstance(instanceId: string): TLShapeId {
  return `shape:${instanceId}` as TLShapeId;
}
