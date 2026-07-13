import type { CanvasPoint } from "@/domain/morpho/types";

export type WheelZoomFrame = {
  zoomLogDelta: number;
  screenPoint: CanvasPoint;
};

export type WheelZoomFrameScheduler = {
  push: (input: WheelZoomFrame) => void;
  dispose: () => void;
};

export function createWheelZoomFrameScheduler(input: {
  onFrame: (frame: WheelZoomFrame) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (frameId: number) => void;
}): WheelZoomFrameScheduler {
  const requestFrame = input.requestFrame ?? window.requestAnimationFrame;
  const cancelFrame = input.cancelFrame ?? window.cancelAnimationFrame;
  let frameId: number | null = null;
  let pending: WheelZoomFrame | null = null;

  const flush = () => {
    frameId = null;
    const next = pending;
    pending = null;
    if (next) {
      input.onFrame(next);
    }
  };

  return {
    push(next) {
      pending = {
        zoomLogDelta: (pending?.zoomLogDelta ?? 0) + next.zoomLogDelta,
        screenPoint: { ...next.screenPoint }
      };
      if (frameId === null) {
        frameId = requestFrame(flush);
      }
    },
    dispose() {
      if (frameId !== null) {
        cancelFrame(frameId);
      }
      frameId = null;
      pending = null;
    }
  };
}
