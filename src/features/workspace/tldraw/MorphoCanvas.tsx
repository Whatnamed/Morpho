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
  shouldKeepStageToolbarVisible,
  shouldShowSelectionToolbarForInteraction,
  type SelectionToolbarPlacement,
  type ScreenRect
} from "../selectionToolbar";
import type { PendingImageGenerationSlot } from "../pendingImageGenerationSlots";
import type { StageRegionRecord } from "@/domain/morpho/types";
import {
  areStageRegionRecordsEqual,
  ensureStageRegions,
  fitStageRegionToVisibleMembers,
  getStageRegions,
  hasVisibleStageRegionMembers,
  mergeStageShapeLayoutsIntoRecords,
  resetStageRegionStyle,
  updateStageRegionStyle
} from "@/domain/morpho/stageRegions";
import { buildRelationshipPath, buildRelationshipRoute, createRelationshipRouteCache, type CanvasPageBounds } from "./canvasRelationshipRouting";
import { canvasEdgeKey, collectPrimaryCanvasEdges } from "./primaryCanvasEdges";
import type { PrimaryCanvasTrace } from "./primaryCanvasTrace";
import {
  MorphoShapeUtil,
  createMorphoShapePartial,
  getMorphoShapeProps,
  isMorphoShape,
  type MorphoShape
} from "./MorphoShapeUtil";
import {
  StageRegionShapeUtil,
  STAGE_REGION_SHAPE_TYPE,
  createStageRegionShapePartial,
  isStageRegionShape,
  type StageRegionShape
} from "./StageRegionShapeUtil";
import { StageRegionToolbar, type StageRegionOpenPopover } from "../components/StageRegionToolbar";
import { createStageOpacitySessionController } from "./stageOpacitySession";
import {
  areSelectionIdsEqual,
  normalizeCanvasSelectionIds,
  shouldApplyCanvasSelectionRequest,
  type CanvasSelectableKind,
  type CanvasSelectionRequest
} from "./canvasSelection";

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
  /** Full primary-chain highlight payload for canvas (not only object ids). */
  canvasTrace: PrimaryCanvasTrace | null;
  highlightedObjectId: string | null;
  assetUrls: Record<string, string>;
  pendingImageGenerationSlots: PendingImageGenerationSlot[];
  focusRequest: FocusRequest;
  selectionRequest: CanvasSelectionRequest;
  /**
   * Changes when floating chrome opens/closes so the selection toolbar
   * re-measures obstacles even when the tldraw editor itself is idle.
   */
  floatingChromeKey?: string;
  renderSelectionToolbar?: (
    selectedObjects: MorphoObject[],
    placement: SelectionToolbarPlacement,
    onMeasure?: (size: { w: number; h: number }) => void,
    isMeasuring?: boolean
  ) => ReactNode;
  onSelectionChange: (objectIds: string[]) => void;
  onInstancesChange: (instances: CanvasInstance[]) => void;
  onStageRegionsChange: (regions: StageRegionRecord[]) => void;
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
  /** Morpho object under the pointer, if any. Takes priority over stage. */
  objectId: string | null;
  /** Activated stage region under the pointer when no object was hit. */
  stageId: string | null;
  /** Page-space point for paste/import placement. */
  pagePosition: CanvasPoint;
};

/** Resolve which canvas context-menu body to show from a hit-test result. */
export function resolveCanvasContextMenuKind(request: Pick<CanvasContextMenuRequest, "objectId" | "stageId">): "object" | "stage" | "empty" {
  if (request.objectId) {
    return "object";
  }
  if (request.stageId) {
    return "stage";
  }
  return "empty";
}

const shapeUtils = [MorphoShapeUtil, StageRegionShapeUtil];
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
  const stage = area === "overview" ? null : getStageRegions(workspace).find((region) => region.key === area);
  const memberObjectIds = stage ? new Set(stage.memberObjectIds) : null;
  const instances = getRenderableCanvasInstances(workspace).filter((instance) => !memberObjectIds || memberObjectIds.has(instance.objectId));

  if (instances.length === 0) {
    if (stage?.isActivated) {
      return { x: stage.x, y: stage.y, w: stage.w, h: stage.h, zoom: fallback.zoom };
    }
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

/**
 * Camera updates must not always re-enter React. Only mirror into React state
 * when something outside tldraw's own camera transform still needs screen-space
 * coordinates (currently: pending generation slots overlaid on the host).
 */
export function shouldMirrorCameraIntoReactLiveView(pendingSlotCount: number): boolean {
  return pendingSlotCount > 0;
}

export function MorphoCanvas({
  workspace,
  annotatedObjectId,
  canvasTrace,
  highlightedObjectId,
  assetUrls,
  pendingImageGenerationSlots,
  focusRequest,
  selectionRequest,
  floatingChromeKey = "",
  renderSelectionToolbar,
  onSelectionChange,
  onInstancesChange,
  onStageRegionsChange,
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
  const pendingStageRegionsRef = useRef<StageRegionRecord[] | null>(null);
  const stageRegionsPersistTimerRef = useRef<number | null>(null);
  const lastAppliedFocusNonceRef = useRef<number | null>(null);
  const lastAppliedSelectionRequestNonceRef = useRef<number | null>(null);
  const viewPersistTimerRef = useRef<number | null>(null);
  const liveViewRafRef = useRef<number | null>(null);
  const latestViewRef = useRef<CanvasView>(workspace.canvas.view);
  const lastPersistedViewKeyRef = useRef(getCanvasViewKey(workspace.canvas.view));
  const lastContextMenuOpenAtRef = useRef(0);
  const latestWorkspaceRef = useRef(workspace);
  const onLiveViewChangeRef = useRef(onLiveViewChange);
  const pendingSlotCountRef = useRef(pendingImageGenerationSlots.length);
  const didSendStagesToBackRef = useRef(false);
  const stageOpacityPreviewRef = useRef<string | null>(null);
  const [editorReadyEpoch, setEditorReadyEpoch] = useState(0);
  /** React mirror of the camera — only updated when pending slots need host-space layout. */
  const [liveView, setLiveView] = useState<CanvasView>(workspace.canvas.view);
  const traceObjectIds = useMemo(() => canvasTrace?.highlightedObjectIds ?? [], [canvasTrace]);
  const traceEdgeKeySet = useMemo(() => new Set(canvasTrace?.highlightedEdgeKeys ?? []), [canvasTrace]);
  const secondaryTraceObjectIds = useMemo(() => new Set(canvasTrace?.secondaryObjectIds ?? []), [canvasTrace]);
  const secondaryTraceEdgeKeys = useMemo(() => new Set(canvasTrace?.secondaryEdgeKeys ?? []), [canvasTrace]);
  const isChainTraceActive = canvasTrace?.mode === "chain";

  useLayoutEffect(() => {
    latestWorkspaceRef.current = workspace;
  }, [workspace]);
  useLayoutEffect(() => {
    onLiveViewChangeRef.current = onLiveViewChange;
  }, [onLiveViewChange]);
  useLayoutEffect(() => {
    pendingSlotCountRef.current = pendingImageGenerationSlots.length;
  }, [pendingImageGenerationSlots.length]);
  // When generation slots appear, pull the latest camera into React once so overlays align.
  useEffect(() => {
    if (pendingImageGenerationSlots.length > 0) {
      setLiveView(latestViewRef.current);
    }
  }, [pendingImageGenerationSlots.length]);
  useEffect(() => {
    return () => {
      if (liveViewRafRef.current !== null) {
        window.cancelAnimationFrame(liveViewRafRef.current);
        liveViewRafRef.current = null;
      }
    };
  }, []);
  const canvasComponents = useMemo(
    () => ({
      OnTheCanvas: () => (
        <CanvasRelationshipOverlay
          workspace={workspace}
          emphasizedObjectId={highlightedObjectId}
          isChainTraceActive={isChainTraceActive}
          traceEdgeKeys={traceEdgeKeySet}
          secondaryTraceEdgeKeys={secondaryTraceEdgeKeys}
          secondaryTraceObjectIds={secondaryTraceObjectIds}
        />
      ),
      InFrontOfTheCanvas: () => (
        <CanvasSelectionToolbar
          workspace={workspace}
          floatingChromeKey={floatingChromeKey}
          renderToolbar={renderSelectionToolbar}
          onStageRegionsChange={onStageRegionsChange}
          onStageOpacityPreviewChange={(stageId) => {
            stageOpacityPreviewRef.current = stageId;
          }}
        />
      )
    }),
    [
      floatingChromeKey,
      highlightedObjectId,
      isChainTraceActive,
      renderSelectionToolbar,
      secondaryTraceEdgeKeys,
      secondaryTraceObjectIds,
      traceEdgeKeySet,
      workspace,
      onStageRegionsChange
    ]
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

  /**
   * Publish camera to refs + debounced persist always; only re-enter React when
   * host overlays (pending slots) still need screen-space coordinates.
   */
  const publishCameraView = useCallback(
    (nextView: CanvasView) => {
      latestViewRef.current = nextView;
      onLiveViewChangeRef.current?.(nextView);
      scheduleViewPersist(nextView);
      if (!shouldMirrorCameraIntoReactLiveView(pendingSlotCountRef.current)) {
        return;
      }
      if (liveViewRafRef.current !== null) {
        return;
      }
      liveViewRafRef.current = window.requestAnimationFrame(() => {
        liveViewRafRef.current = null;
        setLiveView(latestViewRef.current);
      });
    },
    [scheduleViewPersist]
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

  const flushPendingStageRegions = useCallback(() => {
    if (stageRegionsPersistTimerRef.current !== null) {
      window.clearTimeout(stageRegionsPersistTimerRef.current);
      stageRegionsPersistTimerRef.current = null;
    }
    const regions = pendingStageRegionsRef.current;
    if (!regions) {
      return;
    }
    pendingStageRegionsRef.current = null;
    onStageRegionsChange(regions);
  }, [onStageRegionsChange]);

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

  const scheduleStageRegionsPersist = useCallback(
    (regions: StageRegionRecord[]) => {
      pendingStageRegionsRef.current = regions;
      if (stageRegionsPersistTimerRef.current !== null) {
        window.clearTimeout(stageRegionsPersistTimerRef.current);
      }
      stageRegionsPersistTimerRef.current = window.setTimeout(() => {
        flushPendingStageRegions();
      }, 140);
    },
    [flushPendingStageRegions]
  );

  const syncSelectionFromEditor = useCallback(
    (editor: Editor) => {
      const currentWorkspace = latestWorkspaceRef.current;
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
    },
    [onSelectionChange]
  );

  const syncShapesFromEditor = useCallback(
    (editor: Editor, changedShapes?: Array<MorphoShape | StageRegionShape>) => {
      const currentWorkspace = latestWorkspaceRef.current;
      const pageMorphoShapes =
        changedShapes?.filter(isMorphoShape) ?? editor.getCurrentPageShapes().filter(isMorphoShape);
      const inactiveShapes = pageMorphoShapes.filter((shape) => !isMorphoShapeActiveInWorkspace(shape, currentWorkspace));
      if (inactiveShapes.length > 0) {
        editor.deleteShapes(inactiveShapes.map((shape) => shape.id));
      }

      const stageShapesChanged = Boolean(changedShapes?.some(isStageRegionShape));
      const morphoShapesChanged = Boolean(changedShapes?.some(isMorphoShape));

      // Stage drags update their members as Morpho shapes; styling a stage never
      // writes unrelated instance geometry.
      if (morphoShapesChanged) {
        const allMorpho = editor.getCurrentPageShapes().filter(isMorphoShape);
        const allInstances = allMorpho
          .filter((shape) => isMorphoShapeActiveInWorkspace(shape, currentWorkspace))
          .map((shape) => ({
            id: shape.props.instanceId,
            objectId: shape.props.objectId,
            position: { x: shape.x, y: shape.y },
            size: { w: shape.props.w, h: shape.props.h }
          }));
        if (allInstances.length > 0) {
          scheduleInstancesPersist(allInstances);
        }
      }

      if (stageShapesChanged && !stageOpacityPreviewRef.current) {
        const stageShapes = editor.getCurrentPageShapes().filter(isStageRegionShape);
        const base = getStageRegions(currentWorkspace);
        const layouts = stageShapes.map((shape) => ({
          id: shape.id.replace(/^shape:/, ""),
          x: shape.x,
          y: shape.y,
          w: shape.props.w,
          h: shape.props.h,
          memberObjectIds: [...shape.props.memberObjectIds],
          colorKey: shape.props.colorKey,
          fillOpacity: shape.props.fillOpacity,
          backgroundVisible: shape.props.backgroundVisible,
          borderStyle: shape.props.borderStyle,
          locked: shape.props.locked
        }));
        const nextRegions = mergeStageShapeLayoutsIntoRecords(base, layouts);
        if (!areStageRegionRecordsEqual(base, nextRegions)) {
          scheduleStageRegionsPersist(nextRegions);
        }
      }

    },
    [scheduleInstancesPersist, scheduleStageRegionsPersist]
  );

  const syncCameraFromEditor = useCallback(
    (editor: Editor) => {
      const camera = editor.getCamera();
      publishCameraView({ x: camera.x, y: camera.y, zoom: camera.z });
    },
    [publishCameraView]
  );

  const syncWorkspaceToEditor = useCallback(
    (editor: Editor) => {
      const ensured = ensureStageRegions(workspace);
      const stageRegions = getStageRegions(ensured).filter((region) => region.isActivated);
      const shapes = editor.getCurrentPageShapes().filter(isMorphoShape);
      const shapesByInstance = new Map(shapes.map((shape) => [shape.props.instanceId, shape]));
      const renderableInstances = getRenderableCanvasInstances(workspace);
      const renderableInstanceIds = new Set(renderableInstances.map((instance) => instance.id));
      const pendingInstances = pendingInstancesRef.current;
      const toCreate: TLShapePartial<MorphoShape>[] = [];
      const toUpdate: MorphoShape[] = [];
      const toDelete = shapes.filter((shape) => !renderableInstanceIds.has(shape.props.instanceId));
      const traceIdSet = new Set(traceObjectIds);

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
              traceIdSet.has(object.id),
              highlightedObjectId === object.id
            )
          );
        } else {
          const nextProps = {
            ...getMorphoShapeProps(renderInstance, object, assetUrl, workspace, highlightedObjectId === object.id),
            isBeingLocallyEdited: object.id === annotatedObjectId,
            isInDesignTrace: traceIdSet.has(object.id)
          };
          if (!areMorphoShapePropsEqual(existing.props, nextProps)) {
            toUpdate.push({
              ...existing,
              props: nextProps
            });
          }
        }
      }

      const existingStages = editor.getCurrentPageShapes().filter(isStageRegionShape);
      const existingStageById = new Map(existingStages.map((shape) => [shape.id.replace(/^shape:/, ""), shape]));
      const stagePartials = stageRegions.map((region) => createStageRegionShapePartial(region));
      const stageIds = new Set(stageRegions.map((region) => region.id));
      const stagesToCreate = stagePartials.filter((partial) => !existingStageById.has(String(partial.id).replace(/^shape:/, "")));
      const stagesToUpdate: StageRegionShape[] = [];
      for (const region of stageRegions) {
        const existing = existingStageById.get(region.id);
        if (!existing) {
          continue;
        }
        const pendingLayout = pendingStageRegionsRef.current?.find((item) => item.id === region.id);
        const layout = pendingLayout ?? region;
        const membersChanged =
          existing.props.memberObjectIds.length !== region.memberObjectIds.length ||
          existing.props.memberObjectIds.some((id, index) => id !== region.memberObjectIds[index]);
        const geometryChanged =
          Math.abs(existing.x - layout.x) > 0.01 ||
          Math.abs(existing.y - layout.y) > 0.01 ||
          Math.abs(existing.props.w - layout.w) > 0.01 ||
          Math.abs(existing.props.h - layout.h) > 0.01;
        const styleChanged =
          existing.props.colorKey !== region.colorKey ||
          existing.props.fillOpacity !== region.fillOpacity ||
          existing.props.backgroundVisible !== region.backgroundVisible ||
          existing.props.borderStyle !== region.borderStyle ||
          existing.props.locked !== region.locked ||
          existing.isLocked !== false;
        if (membersChanged || geometryChanged || styleChanged || existing.props.title !== region.title) {
          stagesToUpdate.push({
            ...existing,
            x: layout.x,
            y: layout.y,
            // Preserve selection for custom-locked stages so their toolbar can
            // always unlock them. Drag/resize is handled by the shape util.
            isLocked: false,
            props: {
              ...existing.props,
              w: layout.w,
              h: layout.h,
              title: region.title,
              stageKey: region.key,
              memberObjectIds: [...region.memberObjectIds],
              colorKey: region.colorKey,
              fillOpacity: region.fillOpacity,
              backgroundVisible: region.backgroundVisible,
              borderStyle: region.borderStyle,
              locked: region.locked
            }
          });
        }
      }
      const stagesToDelete = existingStages.filter((shape) => !stageIds.has(shape.id.replace(/^shape:/, "")));

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

        if (stagesToCreate.length > 0) {
          editor.createShapes(stagesToCreate);
        }
        if (stagesToUpdate.length > 0) {
          editor.updateShapes(stagesToUpdate);
        }
        if (stagesToDelete.length > 0) {
          editor.deleteShapes(stagesToDelete.map((shape) => shape.id));
        }

        // Send stages behind object cards only once after initial create.
        if (!didSendStagesToBackRef.current || stagesToCreate.length > 0) {
          const stageShapeIds = editor.getCurrentPageShapes().filter(isStageRegionShape).map((shape) => shape.id);
          if (stageShapeIds.length > 0) {
            editor.sendToBack(stageShapeIds);
          }
          didSendStagesToBackRef.current = true;
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
      const fallbackPage = {
        x: workspace.canvas.view.x + 160,
        y: workspace.canvas.view.y + 160
      };
      if (!editor) {
        onContextMenuRequest({
          x: clientX,
          y: clientY,
          objectId: null,
          stageId: null,
          pagePosition: fallbackPage
        });
        return;
      }

      const point = editor.screenToPage({ x: clientX, y: clientY });
      const pagePosition = { x: point.x, y: point.y };
      const pageShapesTopFirst = [...editor.getCurrentPageShapesSorted()].reverse();
      const targetMorpho = pageShapesTopFirst
        .filter(isMorphoShape)
        .filter((shape) => workspace.objects[shape.props.objectId]?.visibility === "active")
        .find((shape) => isPointInsideBoxShape(point, shape));

      const selectedShapeIds = editor.getSelectedShapeIds().map((shapeId) => shapeId.toString());
      if (targetMorpho) {
        if (shouldReplaceSelectionForContextMenuTarget(targetMorpho.id.toString(), selectedShapeIds)) {
          editor.select(targetMorpho.id);
        }
        onContextMenuRequest({
          x: clientX,
          y: clientY,
          objectId: targetMorpho.props.objectId,
          stageId: null,
          pagePosition
        });
        lastContextMenuOpenAtRef.current = Date.now();
        return;
      }

      const targetStage = pageShapesTopFirst
        .filter(isStageRegionShape)
        .find((shape) => isPointInsideBoxShape(point, shape));
      if (targetStage) {
        editor.select(targetStage.id);
        onContextMenuRequest({
          x: clientX,
          y: clientY,
          objectId: null,
          stageId: targetStage.id.replace(/^shape:/, ""),
          pagePosition
        });
        lastContextMenuOpenAtRef.current = Date.now();
        return;
      }

      onContextMenuRequest({
        x: clientX,
        y: clientY,
        objectId: null,
        stageId: null,
        pagePosition
      });
      lastContextMenuOpenAtRef.current = Date.now();
    },
    [onContextMenuRequest, workspace.canvas.view.x, workspace.canvas.view.y, workspace.objects]
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
    publishCameraView(nextView);
  }, [publishCameraView]);

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
    // Single flush path for instances + stage regions + camera (no duplicate onMount listeners).
    const flushInteractionState = () => {
      flushPendingInstances();
      flushPendingStageRegions();
      flushViewPersist();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushInteractionState();
      }
    };
    const handleWindowBlur = () => {
      flushInteractionState();
    };
    const host = canvasHostRef.current;

    host?.addEventListener("pointerup", flushInteractionState, { capture: true });
    host?.addEventListener("pointercancel", flushInteractionState, { capture: true });
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("beforeunload", flushInteractionState);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      host?.removeEventListener("pointerup", flushInteractionState, { capture: true });
      host?.removeEventListener("pointercancel", flushInteractionState, { capture: true });
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("beforeunload", flushInteractionState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushInteractionState();
    };
  }, [flushPendingInstances, flushPendingStageRegions, flushViewPersist]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    syncWorkspaceToEditor(editor);
  }, [syncWorkspaceToEditor]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !shouldApplyCanvasSelectionRequest(selectionRequest, lastAppliedSelectionRequestNonceRef.current)) {
      return;
    }
    lastAppliedSelectionRequestNonceRef.current = selectionRequest.nonce;
    const shapeIds = getMorphoShapeIdsForSelectionRequest(
      editor.getCurrentPageShapes().filter(isMorphoShape),
      selectionRequest.objectIds,
      latestWorkspaceRef.current
    );
    editor.select(...shapeIds);
  }, [editorReadyEpoch, selectionRequest]);

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
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY || undefined}
        onMount={(editor) => {
          editorRef.current = editor;
          setEditorReadyEpoch((current) => current + 1);
          editor.user.updateUserPreferences({ isSnapMode: true });
          // World-space dot grid that pans/zooms with the camera (replaces CSS screen grid).
          editor.updateInstanceState({ isGridMode: true });
          syncWorkspaceToEditor(editor);
          latestViewRef.current = workspace.canvas.view;
          lastPersistedViewKeyRef.current = getCanvasViewKey(workspace.canvas.view);
          editor.setCamera({ x: workspace.canvas.view.x, y: workspace.canvas.view.y, z: workspace.canvas.view.zoom });
          latestViewRef.current = workspace.canvas.view;
          setLiveView(workspace.canvas.view);
          onLiveViewChangeRef.current?.(workspace.canvas.view);

          const selectionKind = (shapeId: string): CanvasSelectableKind => {
            const shape = editor.getShape(shapeId as TLShapeId);
            if (shape && isMorphoShape(shape)) return "morpho";
            if (shape && isStageRegionShape(shape)) return "stage";
            return "other";
          };
          const cleanupBeforeSelection = editor.sideEffects.registerBeforeChangeHandler("instance_page_state", (previous, next) => {
            const normalizedIds = normalizeCanvasSelectionIds(previous.selectedShapeIds, next.selectedShapeIds, selectionKind);
            return areSelectionIdsEqual(next.selectedShapeIds, normalizedIds) ? next : { ...next, selectedShapeIds: normalizedIds as TLShapeId[] };
          });
          const cleanupAfterSelection = editor.sideEffects.registerAfterChangeHandler("instance_page_state", (_previous, next) => {
            if (next.pageId === editor.getCurrentPageId()) {
              syncSelectionFromEditor(editor);
            }
          });

          const cleanup = editor.store.listen((entry) => {
            const changedShapes = [
              ...Object.values(entry.changes.added),
              ...Object.values(entry.changes.updated).map(([, after]) => after)
            ].filter(
              (record): record is MorphoShape | StageRegionShape =>
                "type" in record && (isMorphoShape(record as TLShape) || isStageRegionShape(record as TLShape))
            );
            if (changedShapes.length > 0) {
              syncShapesFromEditor(editor, changedShapes);
            }

            const changedRecords = [
              ...Object.values(entry.changes.added),
              ...Object.values(entry.changes.updated).map(([, after]) => after)
            ];
            if (changedRecords.some((record) => record.typeName === "camera")) {
              syncCameraFromEditor(editor);
            }
          });

          return () => {
            cleanup();
            cleanupAfterSelection();
            cleanupBeforeSelection();
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
  emphasizedObjectId,
  isChainTraceActive,
  traceEdgeKeys,
  secondaryTraceEdgeKeys,
  secondaryTraceObjectIds
}: {
  workspace: MorphoWorkspace;
  emphasizedObjectId: string | null;
  isChainTraceActive: boolean;
  traceEdgeKeys: Set<string>;
  secondaryTraceEdgeKeys: Set<string>;
  secondaryTraceObjectIds: Set<string>;
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

  // Permanent overlay draws only primary edges (full aggregate stays available elsewhere).
  const visibleEdges = collectPrimaryCanvasEdges(workspace).filter(
    (edge) => boundsByObjectId.has(edge.fromObjectId) && boundsByObjectId.has(edge.toObjectId)
  );
  const routes = visibleEdges.map((edge) => {
    const pairKey = canvasEdgeKey(edge.fromObjectId, edge.toObjectId);
    const key = `${edge.fromObjectId}:${edge.toObjectId}`;
    const source = boundsByObjectId.get(edge.fromObjectId)!;
    const target = boundsByObjectId.get(edge.toObjectId)!;
    const endpointObjectIds = [edge.fromObjectId, edge.toObjectId];
    const cached = routeCacheRef.current.get(key);
    const route = cached ?? buildRelationshipRoute({
      source,
      target,
      obstacles: []
    });
    if (!cached) routeCacheRef.current.set(key, route, endpointObjectIds);
    const selectedHit = editor.getSelectedShapeIds().some((shapeId) => {
      const shape = editor.getShape(shapeId);
      if (!shape || !isMorphoShape(shape)) return false;
      return shape.props.objectId === edge.fromObjectId || shape.props.objectId === edge.toObjectId;
    });
    const onPrimaryChain = traceEdgeKeys.has(pairKey);
    const onSecondary = secondaryTraceEdgeKeys.has(pairKey);
    const hoverHit =
      emphasizedObjectId === edge.fromObjectId ||
      emphasizedObjectId === edge.toObjectId ||
      secondaryTraceObjectIds.has(edge.fromObjectId) ||
      secondaryTraceObjectIds.has(edge.toObjectId);
    let className = "is-primary";
    if (isChainTraceActive) {
      if (onPrimaryChain) {
        className = "is-emphasized is-chain";
      } else if (onSecondary) {
        className = "is-secondary is-chain-secondary";
      } else {
        className = "is-dimmed";
      }
    } else if (selectedHit || hoverHit || onPrimaryChain) {
      className = "is-emphasized";
    }
    return { key, edge, route, className };
  });

  return (
    <svg className="canvas-relationship-overlay" viewBox="0 0 1 1" aria-hidden="true">
      {routes.map(({ key, route, className }) => (
        <path key={key} className={className} d={buildRelationshipPath(route)} />
      ))}
    </svg>
  );
});

const UNMEASURED_SELECTION_TOOLBAR_SIZE = { w: 360, h: 44 } as const;
const UNMEASURED_STAGE_REGION_TOOLBAR_SIZE = { w: 286, h: 44 } as const;
const SELECTION_TOOLBAR_MARGIN = 18;
const SELECTION_TOOLBAR_GAP = 12;

const CanvasSelectionToolbar = track(function CanvasSelectionToolbar({
  workspace,
  floatingChromeKey,
  renderToolbar,
  onStageRegionsChange,
  onStageOpacityPreviewChange
}: {
  workspace: MorphoWorkspace;
  floatingChromeKey: string;
  renderToolbar?: (
    selectedObjects: MorphoObject[],
    placement: SelectionToolbarPlacement,
    onMeasure?: (size: { w: number; h: number }) => void,
    isMeasuring?: boolean
  ) => ReactNode;
  onStageRegionsChange: (regions: StageRegionRecord[]) => void;
  onStageOpacityPreviewChange: (stageId: string | null) => void;
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
  const [objectToolbarSize, setObjectToolbarSize] = useState<{ key: string; w: number; h: number } | null>(null);
  const [stageToolbarSize, setStageToolbarSize] = useState<{ key: string; w: number; h: number } | null>(null);
  /**
   * Stage chrome anchor: popover + stage id live here so slider commit / brief
   * deselection cannot wipe the open panel. Popover only closes explicitly.
   */
  const [stageChrome, setStageChrome] = useState<{
    stageId: string;
    openPopover: StageRegionOpenPopover;
  } | null>(null);
  const lastStagePlacementRef = useRef<SelectionToolbarPlacement | null>(null);
  const lastStageBoundsRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    setObstacleEpoch((value) => value + 1);
  }, [floatingChromeKey]);
  const selectedShapes = editor.getSelectedShapes();
  const selectedObjects = selectedShapes
    .filter(isMorphoShape)
    .map((shape) => workspace.objects[shape.props.objectId])
    .filter((object): object is MorphoObject => Boolean(object));
  const selectedStageShapes = selectedShapes.filter(isStageRegionShape);
  const selectedStageId =
    selectedStageShapes.length === 1 && selectedObjects.length === 0
      ? selectedStageShapes[0].id.replace(/^shape:/, "")
      : null;
  const stagePopoverOpen = stageChrome?.openPopover != null;
  // While a stage popover is open, keep chrome on that stage even if selection flickers.
  const anchoredStageId = stagePopoverOpen ? stageChrome!.stageId : selectedStageId;
  const stageOnlySelection = Boolean(anchoredStageId) && selectedObjects.length === 0;

  // Selecting a real canvas object dismisses stage popovers. Empty selection does not
  // (slider release can briefly clear tldraw selection).
  useEffect(() => {
    if (selectedObjects.length > 0 && stageChrome) {
      setStageChrome(null);
    }
  }, [selectedObjects, stageChrome]);

  // Opacity commit/history can drop stage selection. Only re-assert while the
  // opacity popover is open — do not steal selection during color/border popovers
  // or normal object interaction.
  useLayoutEffect(() => {
    if (stageChrome?.openPopover !== "opacity" || !stageChrome.stageId) {
      return;
    }
    const shapeId = `shape:${stageChrome.stageId}` as TLShapeId;
    const selected = editor.getSelectedShapeIds();
    if (selected.length === 1 && selected[0] === shapeId) {
      return;
    }
    if (editor.getShape(shapeId)) {
      editor.select(shapeId);
    }
  }, [editor, stageChrome, workspace.canvas.stageRegions]);

  const selectionKey = selectedObjects.length > 0
    ? `objects:${selectedObjects.map((object) => `${object.id}:${object.type}`).join("|")}`
    : `stage:${anchoredStageId ?? ""}`;
  const measuredObjectSize = objectToolbarSize?.key === selectionKey ? objectToolbarSize : null;
  const measuredStageSize = stageToolbarSize?.key === selectionKey ? stageToolbarSize : null;
  const reportObjectToolbarSize = useCallback(
    (size: { w: number; h: number }) => {
      setObjectToolbarSize((current) =>
        current?.key === selectionKey && current.w === size.w && current.h === size.h ? current : { key: selectionKey, ...size }
      );
    },
    [selectionKey]
  );
  const reportStageToolbarSize = useCallback(
    (size: { w: number; h: number }) => {
      // Placement should use the bar height only; popovers hang below/above and
      // must not inflate the toolbar box or candidates fail and chrome vanishes.
      const barHeight = 44;
      const next = { w: size.w, h: Math.min(size.h, barHeight + 4) };
      setStageToolbarSize((current) =>
        current?.key === selectionKey && current.w === next.w && current.h === next.h
          ? current
          : { key: selectionKey, ...next }
      );
    },
    [selectionKey]
  );

  const interactionAllowsToolbar = shouldShowSelectionToolbarForInteraction({
    isSelectIdle,
    isDragging,
    isPanning
  });
  // Opacity slider drag can flip tldraw isDragging; keep stage chrome if a popover is open.
  if (
    !shouldKeepStageToolbarVisible({
      interactionAllowsToolbar,
      stagePopoverOpen,
      stageOnlySelection
    })
  ) {
    return null;
  }

  const selectionBounds = editor.getSelectionRotatedScreenBounds();
  let bounds = selectionBounds
    ? { x: selectionBounds.x, y: selectionBounds.y, w: selectionBounds.w, h: selectionBounds.h }
    : null;
  if ((!bounds || bounds.w <= 0 || bounds.h <= 0) && anchoredStageId) {
    const shape = editor.getShape(`shape:${anchoredStageId}` as TLShapeId);
    const pageBounds = shape ? editor.getShapePageBounds(shape) : null;
    if (pageBounds) {
      const topLeft = editor.pageToScreen({ x: pageBounds.x, y: pageBounds.y });
      const bottomRight = editor.pageToScreen({
        x: pageBounds.x + pageBounds.w,
        y: pageBounds.y + pageBounds.h
      });
      bounds = {
        x: topLeft.x,
        y: topLeft.y,
        w: Math.max(1, bottomRight.x - topLeft.x),
        h: Math.max(1, bottomRight.y - topLeft.y)
      };
    } else if (stagePopoverOpen) {
      bounds = lastStageBoundsRef.current;
    }
  }
  if (bounds) {
    lastStageBoundsRef.current = bounds;
  }
  if (!bounds || (selectedObjects.length === 0 && !anchoredStageId)) {
    return null;
  }
  // Read epoch so layout remount forces a fresh obstacle query + placement.
  void obstacleEpoch;
  const obstacles = collectSelectionToolbarObstacles();
  const placement = getSelectionToolbarPlacement(
    { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
    { w: window.innerWidth, h: window.innerHeight },
    {
      toolbar: selectedObjects.length > 0
        ? measuredObjectSize ?? UNMEASURED_SELECTION_TOOLBAR_SIZE
        : measuredStageSize ?? UNMEASURED_STAGE_REGION_TOOLBAR_SIZE,
      margin: SELECTION_TOOLBAR_MARGIN,
      gap: SELECTION_TOOLBAR_GAP,
      obstacles
    }
  );
  const resolvedPlacement =
    placement ?? (stagePopoverOpen && anchoredStageId ? lastStagePlacementRef.current : null);
  if (placement) {
    lastStagePlacementRef.current = placement;
  }
  if (!resolvedPlacement) {
    return null;
  }

  if (selectedObjects.length > 0) {
    return renderToolbar
      ? <>{renderToolbar(selectedObjects, resolvedPlacement, reportObjectToolbarSize, !measuredObjectSize)}</>
      : null;
  }

  const region = anchoredStageId
    ? getStageRegions(workspace).find((item) => item.id === anchoredStageId)
    : undefined;
  if (!region || !region.isActivated) {
    return null;
  }

  const openPopover = stageChrome?.stageId === region.id ? stageChrome.openPopover : null;
  const handleOpenPopoverChange = (next: StageRegionOpenPopover) => {
    if (next == null) {
      setStageChrome(null);
      return;
    }
    setStageChrome({ stageId: region.id, openPopover: next });
  };

  return (
    <CanvasStageRegionToolbar
      key={region.id}
      workspace={workspace}
      region={region}
      placement={resolvedPlacement}
      openPopover={openPopover}
      onOpenPopoverChange={handleOpenPopoverChange}
      onStageRegionsChange={onStageRegionsChange}
      onStageOpacityPreviewChange={onStageOpacityPreviewChange}
      onMeasure={reportStageToolbarSize}
      isMeasuring={!measuredStageSize}
    />
  );
});

function CanvasStageRegionToolbar({
  workspace,
  region,
  placement,
  openPopover,
  onOpenPopoverChange,
  onStageRegionsChange,
  onStageOpacityPreviewChange,
  onMeasure,
  isMeasuring
}: {
  workspace: MorphoWorkspace;
  region: StageRegionRecord;
  placement: SelectionToolbarPlacement;
  openPopover: StageRegionOpenPopover;
  onOpenPopoverChange: (next: StageRegionOpenPopover) => void;
  onStageRegionsChange: (regions: StageRegionRecord[]) => void;
  onStageOpacityPreviewChange: (stageId: string | null) => void;
  onMeasure: (size: { w: number; h: number }) => void;
  isMeasuring: boolean;
}) {
  const editor = useEditor();
  const workspaceRef = useRef(workspace);
  const onStageRegionsChangeRef = useRef(onStageRegionsChange);
  const onStageOpacityPreviewChangeRef = useRef(onStageOpacityPreviewChange);
  useEffect(() => {
    workspaceRef.current = workspace;
    onStageRegionsChangeRef.current = onStageRegionsChange;
    onStageOpacityPreviewChangeRef.current = onStageOpacityPreviewChange;
  }, [onStageOpacityPreviewChange, onStageRegionsChange, workspace]);
  const [opacitySession, setOpacitySession] = useState<ReturnType<typeof createStageOpacitySessionController> | null>(null);
  useEffect(() => {
    const controller = createStageOpacitySessionController({
      getOpacity: (stageId) => {
        const shape = editor.getShape(`shape:${stageId}` as TLShapeId);
        return shape && isStageRegionShape(shape) ? shape.props.fillOpacity : null;
      },
      writeOpacity: (stageId, value, options) => {
        const shapeId = `shape:${stageId}` as TLShapeId;
        const write = () => {
          editor.updateShapes([
            { id: shapeId, type: STAGE_REGION_SHAPE_TYPE, props: { fillOpacity: value } }
          ]);
          // Only re-assert selection on the recorded commit write (not every preview tick),
          // so continuous drag does not thrash selection for the rest of the editor.
          if (options.history === "record" && editor.getShape(shapeId)) {
            editor.setSelectedShapes([shapeId]);
          }
        };
        if (options.history === "ignore") {
          editor.run(write, MORPHO_EDITOR_SYNC_RUN_OPTIONS);
        } else {
          write();
        }
      },
      markHistoryStoppingPoint: (label) => editor.markHistoryStoppingPoint(label),
      persist: (stageId, value) => {
        const nextWorkspace = updateStageRegionStyle(workspaceRef.current, stageId, { fillOpacity: value });
        if (nextWorkspace !== workspaceRef.current) {
          onStageRegionsChangeRef.current(nextWorkspace.canvas.stageRegions ?? []);
        }
      },
      onSessionStageChange: (stageId) => onStageOpacityPreviewChangeRef.current(stageId)
    });
    setOpacitySession(controller);
    return () => {
      controller.dispose();
      onStageOpacityPreviewChangeRef.current(null);
    };
  }, [editor]);

  const applyWorkspaceStageChange = (nextWorkspace: MorphoWorkspace, historyLabel: string) => {
    const nextRegion = getStageRegions(nextWorkspace).find((item) => item.id === region.id);
    if (!nextRegion || areStageRegionRecordsEqual(workspace.canvas.stageRegions, nextWorkspace.canvas.stageRegions)) {
      return;
    }
    onStageOpacityPreviewChange(region.id);
    editor.markHistoryStoppingPoint(historyLabel);
    editor.updateShapes([createStageRegionShapePartial(nextRegion)]);
    onStageOpacityPreviewChange(null);
    onStageRegionsChange(nextWorkspace.canvas.stageRegions ?? []);
  };

  const beginOpacity = () => {
    opacitySession?.begin(region.id);
  };

  const previewOpacity = (value: number) => {
    opacitySession?.preview(region.id, value);
  };

  return (
    <StageRegionToolbar
      region={region}
      placement={placement}
      canFit={!region.locked && hasVisibleStageRegionMembers(workspace, region.id)}
      openPopover={openPopover}
      onOpenPopoverChange={onOpenPopoverChange}
      onUpdateStyle={(patch, historyLabel) => applyWorkspaceStageChange(updateStageRegionStyle(workspace, region.id, patch), historyLabel)}
      onBeginOpacity={beginOpacity}
      onPreviewOpacity={previewOpacity}
      onCommitOpacity={() => opacitySession?.commit()}
      onCancelOpacity={() => opacitySession?.cancel()}
      onMeasure={onMeasure}
      isMeasuring={isMeasuring}
      onFit={() => applyWorkspaceStageChange(fitStageRegionToVisibleMembers(workspace, region.id), "适应分区内容")}
      onResetStyle={() => applyWorkspaceStageChange(resetStageRegionStyle(workspace, region.id), "恢复分区默认样式")}
    />
  );
}

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

/**
 * Store shape-diff list for syncFromEditor.
 * Empty diffs must not short-circuit selection sync; pass `undefined` so the
 * sync path still reads selection + camera without treating "[]" as a geometry write.
 */
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

export function getMorphoShapeIdsForSelectionRequest(
  shapes: MorphoShape[],
  objectIds: string[],
  workspace: Pick<MorphoWorkspace, "objects" | "artifactProposals">
): TLShapeId[] {
  const requested = new Set(objectIds);
  return shapes
    .filter((shape) => requested.has(shape.props.objectId))
    .filter((shape) => isMorphoShapeActiveInWorkspace(shape, workspace))
    .map((shape) => shape.id);
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

function isPointInsideBoxShape(
  point: { x: number; y: number },
  shape: { x: number; y: number; props: { w: number; h: number } }
): boolean {
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
