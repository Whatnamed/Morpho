import type { CanvasPoint, CanvasView } from "./types";

export const DEFAULT_MIN_CANVAS_ZOOM = 0.12;
export const DEFAULT_MAX_CANVAS_ZOOM = 3;
export const DEFAULT_WHEEL_ZOOM_DELTA_CLAMP = 80;
export const DEFAULT_WHEEL_ZOOM_SENSITIVITY = 0.0007;

export type AnchoredZoomInput = {
  camera: CanvasView;
  anchorPagePoint: CanvasPoint;
  deltaY: number;
  minZoom?: number;
  maxZoom?: number;
  deltaClamp?: number;
  sensitivity?: number;
};

export type AnchoredTargetZoomInput = {
  camera: CanvasView;
  anchorPagePoint: CanvasPoint;
  targetZoom: number;
  minZoom?: number;
  maxZoom?: number;
};

export function calculateAnchoredZoom(input: AnchoredZoomInput): CanvasView {
  const minZoom = input.minZoom ?? DEFAULT_MIN_CANVAS_ZOOM;
  const maxZoom = input.maxZoom ?? DEFAULT_MAX_CANVAS_ZOOM;
  const currentZoom = Number.isFinite(input.camera.zoom) && input.camera.zoom > 0 ? input.camera.zoom : 1;
  const targetZoom = currentZoom * Math.exp(calculateWheelZoomLogDelta(input.deltaY, input));

  return calculateAnchoredZoomForTarget({
    camera: input.camera,
    anchorPagePoint: input.anchorPagePoint,
    targetZoom,
    minZoom,
    maxZoom
  });
}

export function calculateAnchoredZoomForTarget(input: AnchoredTargetZoomInput): CanvasView {
  const minZoom = input.minZoom ?? DEFAULT_MIN_CANVAS_ZOOM;
  const maxZoom = input.maxZoom ?? DEFAULT_MAX_CANVAS_ZOOM;
  const currentZoom = Number.isFinite(input.camera.zoom) && input.camera.zoom > 0 ? input.camera.zoom : 1;
  const targetZoom = clamp(input.targetZoom, minZoom, maxZoom);
  const ratio = currentZoom / targetZoom;

  return {
    x: (input.camera.x + input.anchorPagePoint.x) * ratio - input.anchorPagePoint.x,
    y: (input.camera.y + input.anchorPagePoint.y) * ratio - input.anchorPagePoint.y,
    zoom: targetZoom
  };
}

export function calculateWheelZoomLogDelta(
  deltaY: number,
  options: Pick<AnchoredZoomInput, "deltaClamp" | "sensitivity"> = {}
): number {
  const deltaClamp = options.deltaClamp ?? DEFAULT_WHEEL_ZOOM_DELTA_CLAMP;
  const sensitivity = options.sensitivity ?? DEFAULT_WHEEL_ZOOM_SENSITIVITY;
  const zoomDelta = clamp(deltaY, -deltaClamp, deltaClamp);
  return -zoomDelta * sensitivity;
}

export function normalizeWheelDelta(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) {
    return deltaY * 16;
  }
  if (deltaMode === 2) {
    return deltaY * pageHeight;
  }
  return deltaY;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
