"use client";

import { useCallback, useEffect, useRef } from "react";
import { Tldraw, type Editor, type TLShapeId } from "tldraw";

import type { CanvasInstance, MorphoWorkspace } from "@/domain/morpho/types";
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
  area: FocusArea;
  nonce: number;
};

type MorphoCanvasProps = {
  workspace: MorphoWorkspace;
  annotatedObjectId: string | null;
  focusRequest: FocusRequest;
  onSelectionChange: (objectIds: string[]) => void;
  onInstancesChange: (instances: CanvasInstance[]) => void;
};

const shapeUtils = [MorphoShapeUtil];

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
  focusRequest,
  onSelectionChange,
  onInstancesChange
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
      const toCreate = [];
      const toUpdate: MorphoShape[] = [];

      for (const instance of workspace.canvas.instances) {
        const object = workspace.objects[instance.objectId];
        if (!object) {
          continue;
        }

        const existing = shapesByInstance.get(instance.id);
        if (!existing) {
          toCreate.push(createMorphoShapePartial(instance, object));
        } else {
          toUpdate.push({
            ...existing,
            props: {
              ...getMorphoShapeProps(instance, object),
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
    },
    [annotatedObjectId, workspace]
  );

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

    const bounds = focusBounds[focusRequest.area];
    editor.zoomToBounds(bounds, {
      animation: { duration: 360 },
      inset: 120,
      targetZoom: bounds.zoom
    });
  }, [focusRequest]);

  return (
    <div className="workspace-canvas">
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

export function getShapeIdForInstance(instanceId: string): TLShapeId {
  return `shape:${instanceId}` as TLShapeId;
}
