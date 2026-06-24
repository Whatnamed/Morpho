import type { CanvasPoint, CanvasView } from "./types";

export type AnchoredZoomInput = {
  camera: CanvasView;
  anchorPagePoint: CanvasPoint;
  deltaY: number;
  minZoom?: number;
  maxZoom?: number;
  deltaClamp?: number;
  sensitivity?: number;
};

export function calculateAnchoredZoom(input: AnchoredZoomInput): CanvasView {
  const minZoom = input.minZoom ?? 0.12;
  const maxZoom = input.maxZoom ?? 2.4;
  const deltaClamp = input.deltaClamp ?? 80;
  const sensitivity = input.sensitivity ?? 0.0007;
  const zoomDelta = Math.max(-deltaClamp, Math.min(deltaClamp, input.deltaY));
  const targetZoom = clamp(input.camera.zoom * Math.exp(-zoomDelta * sensitivity), minZoom, maxZoom);
  const ratio = targetZoom / input.camera.zoom;

  return {
    x: (input.camera.x + input.anchorPagePoint.x) * ratio - input.anchorPagePoint.x,
    y: (input.camera.y + input.anchorPagePoint.y) * ratio - input.anchorPagePoint.y,
    zoom: targetZoom
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
