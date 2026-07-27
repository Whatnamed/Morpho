import type { Page } from "@playwright/test";

/**
 * Browser-side performance instrumentation, injected entirely from the test.
 *
 * Not one line of this ships in the product. `AGENTS.md` forbids exposing internals as
 * product UI, and a `performance.mark` added to application code to serve a harness
 * would be exactly that. Everything here is installed via `addInitScript` before any
 * app script runs, against the ordinary production build.
 *
 * Four sources, in decreasing order of how much they are trusted:
 *
 * 1. **Long Animation Frames** — the primary signal, and the one that needs no
 *    instrumentation at all. `blockingDuration` is what the user actually feels.
 * 2. **Event Timing** — `processingEnd - processingStart` per pointer/key event, i.e.
 *    how long the app blocked handling it. The correct way to time a drag; timing the
 *    Playwright calls instead would measure CDP round trips.
 * 3. **React commit counts** — a stubbed `__REACT_DEVTOOLS_GLOBAL_HOOK__`. Production
 *    react-dom still calls `inject` and `onCommitFiberRoot`; that is how DevTools
 *    detects React on live sites. Verified against this project's production build
 *    before the design was committed to. Gives exact commit counts and timestamps but
 *    no component names, because production is minified — attribution by component is
 *    answered in Node by the SSR render targets instead.
 * 4. **rAF sampler** — opened only for a scripted interaction window and closed after.
 *    Left running at rest it would keep a rAF loop alive that would otherwise idle,
 *    which would be instrumentation changing the thing it measures.
 */

export type PerfPhaseSamples = {
  commitCount: number;
  commitTimestamps: number[];
  loafCount: number;
  longestLoafMs: number;
  longestBlockingMs: number;
  totalLoafMs: number;
  totalBlockingMs: number;
  /**
   * Event Timing only surfaces entries at or above a 16 ms duration — the spec clamps
   * `durationThreshold` to that floor — so every `slowEvent*` field below describes the
   * SLOW TAIL of input handling, never the full input stream. Deriving an input rate
   * from these would report the rate of janky events and call it the pointer rate;
   * `pointerMoveCount` / `keyPressCount` / `pointerRateHz` come from raw listeners
   * instead and are the only fields that describe input volume.
   */
  slowEventCount: number;
  slowEventProcessingP95Ms: number;
  slowEventProcessingMaxMs: number;
  slowEventTotalProcessingMs: number;
  firstSlowEventMs: number | null;
  lastSlowEventMs: number | null;
  pointerMoveCount: number;
  keyPressCount: number;
  pointerRateHz: number | null;
  frameCount: number;
  windowMs: number;
};

declare global {
  interface Window {
    __morphoPerf?: {
      commits: number[];
      loaf: { duration: number; blockingDuration: number }[];
      events: { processing: number; start: number }[];
      frames: number[];
      rafActive: boolean;
      injected: number;
      supported: { loaf: boolean; event: boolean };
      firstShapeAtMs: number | null;
      pointerMoves: number[];
      keyPresses: number[];
    };
  }
}

/** Installs the probe. Must run before any app script, i.e. via addInitScript. */
export async function installPerfProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = {
      commits: [] as number[],
      loaf: [] as { duration: number; blockingDuration: number }[],
      events: [] as { processing: number; start: number }[],
      frames: [] as number[],
      rafActive: false,
      injected: 0,
      supported: { loaf: false, event: false },
      firstShapeAtMs: null as number | null,
      pointerMoves: [] as number[],
      keyPresses: [] as number[]
    };
    window.__morphoPerf = state;

    // Raw input counters, because Event Timing cannot answer "how many events were
    // there". Its `durationThreshold` is clamped to a 16 ms minimum by spec, so those
    // buffers only ever hold the SLOW tail — deriving a pointer rate from them would
    // report the rate of janky events and call it the input rate.
    window.addEventListener("pointermove", () => state.pointerMoves.push(performance.now()), {
      capture: true,
      passive: true
    });
    window.addEventListener("keydown", () => state.keyPresses.push(performance.now()), {
      capture: true,
      passive: true
    });

    // When the canvas first paints a shape, measured in the page rather than by
    // polling from the test — a Playwright poll would fold its own interval into the
    // number. `performance.now()` is relative to navigation start, which is what a
    // "time to first shape" figure should mean.
    const watchForFirstShape = () => {
      if (document.querySelector(".morpho-shape-host")) {
        state.firstShapeAtMs = performance.now();
        return;
      }
      const observer = new MutationObserver(() => {
        if (document.querySelector(".morpho-shape-host")) {
          state.firstShapeAtMs = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", watchForFirstShape, { once: true });
    } else {
      watchForFirstShape();
    }

    const renderers = new Map<number, unknown>();
    let nextRendererId = 1;
    Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      configurable: true,
      enumerable: false,
      value: {
        isDisabled: false,
        supportsFiber: true,
        renderers,
        inject(renderer: unknown) {
          const id = nextRendererId++;
          renderers.set(id, renderer);
          state.injected += 1;
          return id;
        },
        onCommitFiberRoot() {
          state.commits.push(performance.now());
        },
        onPostCommitFiberRoot() {},
        onCommitFiberUnmount() {},
        checkDCE() {},
        on() {},
        off() {},
        emit() {},
        getFiberRoots() {
          return new Set();
        }
      }
    });

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEntry[]) {
          const loaf = entry as PerformanceEntry & { blockingDuration?: number };
          state.loaf.push({ duration: loaf.duration, blockingDuration: loaf.blockingDuration ?? 0 });
        }
      }).observe({ type: "long-animation-frame", buffered: true } as PerformanceObserverInit);
      state.supported.loaf = true;
    } catch {
      state.supported.loaf = false;
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const event = entry as PerformanceEntry & { processingStart?: number; processingEnd?: number };
          if (event.processingStart !== undefined && event.processingEnd !== undefined) {
            state.events.push({
              processing: event.processingEnd - event.processingStart,
              start: event.startTime
            });
          }
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
      state.supported.event = true;
    } catch {
      state.supported.event = false;
    }
  });
}

/** Clears every buffer and opens the frame sampler. Call immediately before a phase. */
export async function beginPerfPhase(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__morphoPerf;
    if (!state) {
      throw new Error("Perf probe was not installed before navigation.");
    }
    state.commits.length = 0;
    state.loaf.length = 0;
    state.events.length = 0;
    state.frames.length = 0;
    state.pointerMoves.length = 0;
    state.keyPresses.length = 0;
    state.rafActive = true;
    const tick = () => {
      if (!state.rafActive) {
        return;
      }
      state.frames.push(performance.now());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as unknown as { __morphoPerfPhaseStart: number }).__morphoPerfPhaseStart = performance.now();
  });
}

/** Closes the sampler and drains the buffers into a summary. */
export async function endPerfPhase(page: Page): Promise<PerfPhaseSamples> {
  return page.evaluate(() => {
    const state = window.__morphoPerf;
    if (!state) {
      throw new Error("Perf probe was not installed before navigation.");
    }
    state.rafActive = false;
    const startedAt = (window as unknown as { __morphoPerfPhaseStart?: number }).__morphoPerfPhaseStart ?? 0;
    const windowMs = performance.now() - startedAt;

    const processing = state.events.map((event) => event.processing).sort((a, b) => a - b);
    const percentile = (fraction: number) =>
      processing.length === 0
        ? 0
        : (processing[Math.min(processing.length - 1, Math.max(0, Math.ceil(fraction * processing.length) - 1))] as number);

    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

    const pointerSpanMs =
      state.pointerMoves.length < 2
        ? null
        : (state.pointerMoves[state.pointerMoves.length - 1] as number) - (state.pointerMoves[0] as number);

    return {
      commitCount: state.commits.length,
      commitTimestamps: state.commits.slice(),
      loafCount: state.loaf.length,
      longestLoafMs: state.loaf.length === 0 ? 0 : Math.max(...state.loaf.map((entry) => entry.duration)),
      longestBlockingMs:
        state.loaf.length === 0 ? 0 : Math.max(...state.loaf.map((entry) => entry.blockingDuration)),
      totalLoafMs: sum(state.loaf.map((entry) => entry.duration)),
      totalBlockingMs: sum(state.loaf.map((entry) => entry.blockingDuration)),
      slowEventCount: processing.length,
      slowEventProcessingP95Ms: percentile(0.95),
      slowEventProcessingMaxMs: processing.length === 0 ? 0 : (processing[processing.length - 1] as number),
      slowEventTotalProcessingMs: sum(processing),
      firstSlowEventMs: state.events.length === 0 ? null : (state.events[0]?.start ?? null),
      lastSlowEventMs: state.events.length === 0 ? null : (state.events[state.events.length - 1]?.start ?? null),
      pointerMoveCount: state.pointerMoves.length,
      keyPressCount: state.keyPresses.length,
      pointerRateHz: pointerSpanMs !== null && pointerSpanMs > 0 ? (state.pointerMoves.length / pointerSpanMs) * 1000 : null,
      frameCount: state.frames.length,
      windowMs
    };
  });
}

/** Whether the browser supports the two observers, so a spec can fail loudly if not. */
export async function readProbeSupport(
  page: Page
): Promise<{ loaf: boolean; event: boolean; injected: number; firstShapeAtMs: number | null }> {
  return page.evaluate(() => ({
    loaf: window.__morphoPerf?.supported.loaf ?? false,
    event: window.__morphoPerf?.supported.event ?? false,
    injected: window.__morphoPerf?.injected ?? 0,
    firstShapeAtMs: window.__morphoPerf?.firstShapeAtMs ?? null
  }));
}
