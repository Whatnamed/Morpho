"use client";

import { useCallback, useEffect, useRef, type ClipboardEvent, type DragEvent, type WheelEvent } from "react";
import { Tldraw, Vec, type Editor, type TLShapeId } from "tldraw";

import type { CanvasInstance, CanvasPoint, MorphoWorkspace } from "@/domain/morpho/types";
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
  assetUrls: Record<string, string>;
  focusRequest: FocusRequest;
  onSelectionChange: (objectIds: string[]) => void;
  onInstancesChange: (instances: CanvasInstance[]) => void;
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

export function MorphoCanvas({
  workspace,
  annotatedObjectId,
  assetUrls,
  focusRequest,
  onSelectionChange,
  onInstancesChange,
  onImportRequest
}: MorphoCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const lastSelectionRef = useRef("");
  const lastInstancesRef = useRef("");

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
          toCreate.push(createMorphoShapePartial(instance, object, assetUrl));
        } else {
          toUpdate.push({
            ...existing,
            props: {
              ...getMorphoShapeProps(instance, object, assetUrl),
              isBeingLocallyEdited: object.id === annotatedObjectId
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
    [annotatedObjectId, assetUrls, workspace]
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

  const handleWheelCapture = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const pagePoint = editor.screenToPage({ x: event.clientX, y: event.clientY });
    const camera = editor.getCamera();
    const zoomDelta = Math.max(-80, Math.min(80, event.deltaY));
    const targetZoom = Math.max(MIN_WHEEL_ZOOM, Math.min(MAX_WHEEL_ZOOM, camera.z * Math.exp(-zoomDelta * 0.0018)));
    const ratio = targetZoom / camera.z;
    editor.setCamera(new Vec((camera.x + pagePoint.x) * ratio - pagePoint.x, (camera.y + pagePoint.y) * ratio - pagePoint.y, targetZoom), {
      immediate: true
    });
  }, []);

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
    }
  }, [focusRequest]);

  return (
    <div
      className="workspace-canvas"
      onDragOverCapture={(event) => event.preventDefault()}
      onDropCapture={handleDropCapture}
      onPasteCapture={handlePasteCapture}
      onWheelCapture={handleWheelCapture}
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

          const cleanup = editor.store.listen(() => {
            syncFromEditor(editor);
          });

          return () => {
            cleanup();
            editorRef.current = null;
          };
        }}
      />
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
