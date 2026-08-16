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

/**
 * Phase 5 additions (opt-in via `{ io: true }`): browser-API-level attribution so a
 * single phase window can answer "was the time spent in localStorage, IndexedDB,
 * object-URL creation, or React?" without touching one line of product code.
 *
 * Everything patched is a browser API (localStorage, IDBObjectStore,
 * URL.createObjectURL), installed before app scripts run. Overhead is one closure
 * per call; the old baseline spec does not enable it and measures the same page as
 * before.
 */
export type PerfIoStats = {
  localStorageReads: { count: number; totalMs: number; maxMs: number; totalChars: number };
  localStorageWrites: { count: number; totalMs: number; maxMs: number; totalChars: number };
  idbOps: { store: string; op: string; count: number; totalMs: number; maxMs: number; lastAt: number | null }[];
  objectUrlCreations: { count: number; totalMs: number; maxMs: number };
  objectUrlRevocations: number;
  marks: { name: string; at: number }[];
  inputEvents: { kind: string; at: number }[];
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
      pointerDowns: number[];
      io?: {
        enabled: boolean;
        lsReads: { key: string; ms: number; chars: number }[];
        lsWrites: { key: string; ms: number; chars: number }[];
        idb: Map<string, { store: string; op: string; count: number; totalMs: number; maxMs: number; lastAt: number | null }>;
        urlCreates: number[];
        urlRevokes: number;
        marks: { name: string; at: number }[];
        inputs: { kind: string; at: number }[];
      };
    };
    __morphoPerfMark?: (name: string) => void;
  }
}

/** Installs the probe. Must run before any app script, i.e. via addInitScript. */
export async function installPerfProbe(page: Page, options: { io?: boolean } = {}): Promise<void> {
  const io = options.io === true;
  await page.addInitScript((ioEnabled: boolean) => {
    const state: NonNullable<Window["__morphoPerf"]> = {
      commits: [],
      loaf: [],
      events: [],
      frames: [],
      rafActive: false,
      injected: 0,
      supported: { loaf: false, event: false },
      firstShapeAtMs: null,
      pointerMoves: [],
      keyPresses: [],
      pointerDowns: []
    };
    window.__morphoPerf = state;

    if (ioEnabled) {
      state.io = {
        enabled: true,
        lsReads: [],
        lsWrites: [],
        idb: new Map(),
        urlCreates: [],
        urlRevokes: 0,
        marks: [],
        inputs: []
      };

      window.__morphoPerfMark = (name: string) => {
        state.io?.marks.push({ name, at: performance.now() });
      };

      // Input handoff timestamps (change/paste are not covered by the raw pointer/key
      // listeners below, and they are exactly the handoff of a file-picker import).
      for (const kind of ["change", "paste"] as const) {
        window.addEventListener(
          kind,
          () => state.io?.inputs.push({ kind, at: performance.now() }),
          { capture: true, passive: true }
        );
      }

      const lsProto = window.localStorage.constructor.prototype;
      const originalGetItem = lsProto.getItem;
      const originalSetItem = lsProto.setItem;
      // Instance-level patch: Storage.prototype methods are what app code calls.
      Object.defineProperty(window.localStorage, "getItem", {
        value: function getItem(key: string) {
          const started = performance.now();
          const value = originalGetItem.call(this, key);
          state.io?.lsReads.push({ key: key.slice(0, 48), ms: performance.now() - started, chars: value?.length ?? 0 });
          return value;
        }
      });
      Object.defineProperty(window.localStorage, "setItem", {
        value: function setItem(key: string, value: string) {
          const started = performance.now();
          originalSetItem.call(this, key, value);
          state.io?.lsWrites.push({ key: key.slice(0, 48), ms: performance.now() - started, chars: value.length });
        }
      });

      // IndexedDB op durations: wrap the request's success event so the measured span
      // covers actual IDB work, not just scheduling.
      const storeProto = IDBObjectStore.prototype;
      for (const op of ["get", "put", "delete"] as const) {
        const original = storeProto[op] as (...args: unknown[]) => IDBRequest;
        storeProto[op] = function patched(this: IDBObjectStore, ...args: unknown[]) {
          const request = original.apply(this, args);
          const started = performance.now();
          const storeName = this.name;
          const finish = () => {
            const bucket = `${storeName}:${op}`;
            const io = window.__morphoPerf?.io;
            if (!io) return;
            const entry = io.idb.get(bucket);
            const ms = performance.now() - started;
            const at = performance.now();
            if (entry) {
              entry.count += 1;
              entry.totalMs += ms;
              entry.maxMs = Math.max(entry.maxMs, ms);
              entry.lastAt = at;
            } else {
              io.idb.set(bucket, { store: storeName, op, count: 1, totalMs: ms, maxMs: ms, lastAt: at });
            }
          };
          request.addEventListener("success", finish, { once: true });
          request.addEventListener("error", finish, { once: true });
          return request;
        } as never;
      }

      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = function patchedCreateObjectURL(blob: Blob | MediaSource) {
        const started = performance.now();
        const url = originalCreateObjectURL.call(this, blob);
        state.io?.urlCreates.push(performance.now() - started);
        return url;
      };
      const originalRevokeObjectURL = URL.revokeObjectURL;
      URL.revokeObjectURL = function patchedRevokeObjectURL(url: string) {
        state.io!.urlRevokes += 1;
        return originalRevokeObjectURL.call(this, url);
      };
    }

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
    window.addEventListener("pointerdown", () => state.pointerDowns.push(performance.now()), {
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
  }, io);
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
    state.pointerDowns.length = 0;
    if (state.io) {
      state.io.lsReads.length = 0;
      state.io.lsWrites.length = 0;
      state.io.idb.clear();
      state.io.urlCreates.length = 0;
      state.io.urlRevokes = 0;
      state.io.marks.length = 0;
      state.io.inputs.length = 0;
    }
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

/** Drains the opt-in IO buffers into an aggregate. Requires `installPerfProbe(page, { io: true })`. */
export async function collectIoStats(page: Page): Promise<PerfIoStats> {
  return page.evaluate(() => {
    const io = window.__morphoPerf?.io;
    if (!io) {
      throw new Error("IO instrumentation was not enabled for this probe.");
    }
    const summarizeLs = (entries: { ms: number; chars: number }[]) => ({
      count: entries.length,
      totalMs: entries.reduce((total, entry) => total + entry.ms, 0),
      maxMs: entries.length === 0 ? 0 : Math.max(...entries.map((entry) => entry.ms)),
      totalChars: entries.reduce((total, entry) => total + entry.chars, 0)
    });
    return {
      localStorageReads: summarizeLs(io.lsReads),
      localStorageWrites: summarizeLs(io.lsWrites),
      idbOps: [...io.idb.values()],
      objectUrlCreations: {
        count: io.urlCreates.length,
        totalMs: io.urlCreates.reduce((total, ms) => total + ms, 0),
        maxMs: io.urlCreates.length === 0 ? 0 : Math.max(...io.urlCreates)
      },
      objectUrlRevocations: io.urlRevokes,
      marks: io.marks.slice(),
      inputEvents: io.inputs.slice()
    } satisfies PerfIoStats;
  });
}

/**
 * Arms a one-shot DOM-change tracker for first-feedback latency.
 *
 * `armFeedback` records the latest input handoff timestamp (pointer/key/change/paste)
 * and the first mutation inside `rootSelector` after arming. The trigger runs between
 * the two calls; `readFeedback` then closes the window. `requireText` (optional)
 * ignores mutations until some text content matching it appears anywhere under the
 * root, for "first meaningful feedback" rather than "first DOM touch".
 */
export type FeedbackResult = {
  armedAt: number;
  lastInputAt: number | null;
  firstChangeAt: number | null;
  matchedTextAt: number | null;
};

export async function armFeedback(
  page: Page,
  rootSelector: string,
  requireText?: string
): Promise<void> {
  await page.evaluate(
    ({ rootSelector, requireText }) => {
      const state = window.__morphoPerf;
      if (!state) {
        throw new Error("Perf probe was not installed before navigation.");
      }
      const record = {
        armedAt: performance.now(),
        lastInputAt: null as number | null,
        firstChangeAt: null as number | null,
        matchedTextAt: null as number | null
      };
      const root = document.querySelector(rootSelector);
      if (!root) {
        throw new Error(`feedback root not found: ${rootSelector}`);
      }
      const observer = new MutationObserver(() => {
        if (record.firstChangeAt === null) {
          record.firstChangeAt = performance.now();
        }
        if (requireText && record.matchedTextAt === null && root.textContent?.includes(requireText)) {
          record.matchedTextAt = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      (window as unknown as { __morphoFeedback?: { record: typeof record; observer: MutationObserver } }).__morphoFeedback = {
        record,
        observer
      };
    },
    { rootSelector, requireText: requireText ?? null }
  );
}

export async function readFeedback(page: Page): Promise<FeedbackResult> {
  return page.evaluate(() => {
    const handle = (window as unknown as { __morphoFeedback?: { record: FeedbackResult; observer: MutationObserver } }).__morphoFeedback;
    if (!handle) {
      throw new Error("readFeedback called without armFeedback.");
    }
    handle.observer.disconnect();
    (window as unknown as { __morphoFeedback?: unknown }).__morphoFeedback = undefined;
    const state = window.__morphoPerf;
    // The triggering input arrives AFTER arming, so lastInputAt must be resolved at
    // read time: the latest pointerdown/keydown/change/paste at or after armedAt.
    if (state) {
      const inputs = [...state.pointerDowns, ...state.keyPresses];
      if (state.io) {
        inputs.push(...state.io.inputs.map((entry) => entry.at));
      }
      const afterArm = inputs.filter((at) => at >= handle.record.armedAt);
      handle.record.lastInputAt = afterArm.length === 0 ? null : Math.max(...afterArm);
    }
    return handle.record;
  });
}
