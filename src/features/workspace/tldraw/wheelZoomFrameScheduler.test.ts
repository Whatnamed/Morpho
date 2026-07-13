import { describe, expect, it, vi } from "vitest";

import { createWheelZoomFrameScheduler } from "./wheelZoomFrameScheduler";

describe("wheel zoom frame scheduler", () => {
  it("coalesces multiple inputs into one frame and keeps the latest cursor point", () => {
    let frameCallback: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 7;
    });
    const onFrame = vi.fn();
    const scheduler = createWheelZoomFrameScheduler({
      requestFrame,
      cancelFrame: () => undefined,
      onFrame
    });

    scheduler.push({ zoomLogDelta: 0.02, screenPoint: { x: 120, y: 180 } });
    scheduler.push({ zoomLogDelta: 0.03, screenPoint: { x: 260, y: 320 } });

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).not.toHaveBeenCalled();

    frameCallback?.(16);

    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith({
      zoomLogDelta: 0.05,
      screenPoint: { x: 260, y: 320 }
    });
  });

  it("does not schedule inertia after the pending frame is consumed", () => {
    let frameCallback: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 7;
    });
    const onFrame = vi.fn();
    const scheduler = createWheelZoomFrameScheduler({
      requestFrame,
      cancelFrame: () => undefined,
      onFrame
    });

    scheduler.push({ zoomLogDelta: -0.04, screenPoint: { x: 80, y: 90 } });
    frameCallback?.(16);

    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(requestFrame).toHaveBeenCalledTimes(1);
  });

  it("cancels a queued frame when disposed", () => {
    const cancelFrame = vi.fn();
    const scheduler = createWheelZoomFrameScheduler({
      requestFrame: () => 42,
      cancelFrame,
      onFrame: () => undefined
    });

    scheduler.push({ zoomLogDelta: 0.01, screenPoint: { x: 1, y: 2 } });
    scheduler.dispose();

    expect(cancelFrame).toHaveBeenCalledWith(42);
  });
});
