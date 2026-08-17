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
      loaf: { start: number; duration: number; blockingDuration: number }[];
      events: {
        start: number;
        duration: number;
        processing: number;
        processingStart: number;
        processingEnd: number;
      }[];
      frames: number[];
      rafActive: boolean;
      phaseGeneration: number;
      activePhaseGeneration: number | null;
      phaseOpen: boolean;
      phaseStart: number;
      lastPhaseGeneration: number | null;
      lastPhaseStart: number | null;
      lastPhaseEnd: number | null;
      injected: number;
      supported: { loaf: boolean; event: boolean };
      firstShapeAtMs: number | null;
      pointerMoves: number[];
      keyPresses: number[];
      pointerDowns: number[];
      observers: {
        loaf: PerformanceObserver | null;
        event: PerformanceObserver | null;
      };
      drainObservers: () => void;
      io?: {
        enabled: boolean;
        lsReads: { key: string; ms: number; chars: number }[];
        lsWrites: { key: string; ms: number; chars: number }[];
        idbRequests: {
          store: string;
          op: string;
          start: number;
          end: number;
          generation: number | null;
        }[];
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
    const initialPhaseStart = performance.now();
    const state: NonNullable<Window["__morphoPerf"]> = {
      commits: [],
      loaf: [],
      events: [],
      frames: [],
      rafActive: false,
      phaseGeneration: 1,
      activePhaseGeneration: 1,
      phaseOpen: true,
      phaseStart: initialPhaseStart,
      lastPhaseGeneration: null,
      lastPhaseStart: null,
      lastPhaseEnd: null,
      injected: 0,
      supported: { loaf: false, event: false },
      firstShapeAtMs: null,
      pointerMoves: [],
      keyPresses: [],
      pointerDowns: [],
      observers: { loaf: null, event: null },
      drainObservers: () => undefined
    };
    window.__morphoPerf = state;
    const initialTick = () => {
      if (!state.phaseOpen || state.activePhaseGeneration !== 1) {
        return;
      }
      state.frames.push(performance.now());
      requestAnimationFrame(initialTick);
    };
    requestAnimationFrame(initialTick);

    if (ioEnabled) {
      state.io = {
        enabled: true,
        lsReads: [],
        lsWrites: [],
        idbRequests: [],
        urlCreates: [],
        urlRevokes: 0,
        marks: [],
        inputs: []
      };

      window.__morphoPerfMark = (name: string) => {
        state.io?.marks.push({ name, at: performance.now() });
      };

      // Input handoff timestamps (form input/change/paste are not covered by the raw
      // pointer/key listeners below, and they are exactly the handoff of file imports
      // and controlled text fields).
      for (const kind of ["input", "change", "paste"] as const) {
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

      // IndexedDB op durations: capture the phase generation when the request starts
      // and the complete request interval when it settles. A late callback from an old
      // phase is then attributable to its originating phase instead of the next one.
      const storeProto = IDBObjectStore.prototype;
      for (const op of ["get", "put", "delete"] as const) {
        const original = storeProto[op] as (...args: unknown[]) => IDBRequest;
        storeProto[op] = function patched(this: IDBObjectStore, ...args: unknown[]) {
          const request = original.apply(this, args);
          const started = performance.now();
          const generation = window.__morphoPerf?.phaseOpen
            ? window.__morphoPerf.activePhaseGeneration
            : null;
          const storeName = this.name;
          const finish = () => {
            const io = window.__morphoPerf?.io;
            if (!io) return;
            io.idbRequests.push({
              store: storeName,
              op,
              start: started,
              end: performance.now(),
              generation
            });
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

    const appendLoaf = (entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        const loaf = entry as PerformanceEntry & { blockingDuration?: number };
        state.loaf.push({
          start: loaf.startTime,
          duration: loaf.duration,
          blockingDuration: loaf.blockingDuration ?? 0
        });
      }
    };
    const appendEvents = (entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        const event = entry as PerformanceEntry & {
          processingStart?: number;
          processingEnd?: number;
        };
        if (event.processingStart !== undefined && event.processingEnd !== undefined) {
          state.events.push({
            start: event.startTime,
            duration: event.duration,
            processing: event.processingEnd - event.processingStart,
            processingStart: event.processingStart,
            processingEnd: event.processingEnd
          });
        }
      }
    };
    state.drainObservers = () => {
      if (state.observers.loaf) appendLoaf(state.observers.loaf.takeRecords());
      if (state.observers.event) appendEvents(state.observers.event.takeRecords());
    };

    try {
      const observer = new PerformanceObserver((list) => appendLoaf(list.getEntries() as PerformanceEntry[]));
      observer.observe({ type: "long-animation-frame", buffered: true } as PerformanceObserverInit);
      state.observers.loaf = observer;
      state.supported.loaf = true;
    } catch {
      state.supported.loaf = false;
    }

    try {
      const observer = new PerformanceObserver((list) => appendEvents(list.getEntries() as PerformanceEntry[]));
      observer.observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
      state.observers.event = observer;
      state.supported.event = true;
    } catch {
      state.supported.event = false;
    }
  }, io);
}

/** Clears every buffer and opens a generation-scoped frame sampler. */
export async function beginPerfPhase(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__morphoPerf;
    if (!state) {
      throw new Error("Perf probe was not installed before navigation.");
    }

    // Records queued before this phase belong to the previous document/operation.
    // Drain them before clearing so a later callback cannot be mistaken for fresh data;
    // the timestamp filter in endPerfPhase is the second boundary guard.
    state.drainObservers();
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
      state.io.idbRequests.length = 0;
      state.io.urlCreates.length = 0;
      state.io.urlRevokes = 0;
      state.io.marks.length = 0;
      state.io.inputs.length = 0;
    }

    const generation = state.phaseGeneration + 1;
    const startedAt = performance.now();
    state.phaseGeneration = generation;
    state.activePhaseGeneration = generation;
    state.phaseOpen = true;
    state.phaseStart = startedAt;
    state.rafActive = true;
    const tick = () => {
      if (!state.rafActive || !state.phaseOpen || state.activePhaseGeneration !== generation) {
        return;
      }
      state.frames.push(performance.now());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as unknown as { __morphoPerfPhaseStart: number }).__morphoPerfPhaseStart = startedAt;
  });
}

/** Closes the sampler, waits for observer delivery, and summarizes only this phase. */
export async function endPerfPhase(page: Page): Promise<PerfPhaseSamples> {
  return page.evaluate(async () => {
    const state = window.__morphoPerf;
    if (!state) {
      throw new Error("Perf probe was not installed before navigation.");
    }
    if (!state.phaseOpen || state.activePhaseGeneration === null) {
      throw new Error("endPerfPhase called without an open performance phase.");
    }

    const generation = state.activePhaseGeneration;
    const startedAt = state.phaseStart;
    const endedAt = performance.now();
    state.phaseOpen = false;
    state.activePhaseGeneration = null;
    state.rafActive = false;
    state.lastPhaseGeneration = generation;
    state.lastPhaseStart = startedAt;
    state.lastPhaseEnd = endedAt;

    const twoFrames = new Promise<void>((resolve) => {
      let count = 0;
      const tick = () => {
        count += 1;
        if (count >= 2) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    await Promise.all([twoFrames, timeout]);
    state.drainObservers();

    const inWindow = (at: number) => at >= startedAt && at <= endedAt;
    const overlap = (start: number, duration: number) => start < endedAt && start + duration > startedAt;
    const commits = state.commits.filter(inWindow);
    const loaf = state.loaf.filter((entry) => overlap(entry.start, entry.duration));
    const events = state.events
      .filter((entry) => overlap(entry.start, entry.duration))
      .sort((a, b) => a.start - b.start);
    const frames = state.frames.filter(inWindow);
    const pointerMoves = state.pointerMoves.filter(inWindow);
    const keyPresses = state.keyPresses.filter(inWindow);
    const processing = events.map((event) => event.processing).sort((a, b) => a - b);
    const percentile = (fraction: number) =>
      processing.length === 0
        ? 0
        : (processing[Math.min(processing.length - 1, Math.max(0, Math.ceil(fraction * processing.length) - 1))] as number);
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    const pointerSpanMs =
      pointerMoves.length < 2
        ? null
        : (pointerMoves[pointerMoves.length - 1] as number) - (pointerMoves[0] as number);

    return {
      commitCount: commits.length,
      commitTimestamps: commits,
      loafCount: loaf.length,
      longestLoafMs: loaf.length === 0 ? 0 : Math.max(...loaf.map((entry) => entry.duration)),
      longestBlockingMs: loaf.length === 0 ? 0 : Math.max(...loaf.map((entry) => entry.blockingDuration)),
      totalLoafMs: sum(loaf.map((entry) => entry.duration)),
      totalBlockingMs: sum(loaf.map((entry) => entry.blockingDuration)),
      slowEventCount: processing.length,
      slowEventProcessingP95Ms: percentile(0.95),
      slowEventProcessingMaxMs: processing.length === 0 ? 0 : (processing[processing.length - 1] as number),
      slowEventTotalProcessingMs: sum(processing),
      firstSlowEventMs: events.length === 0 ? null : (events[0]?.start ?? null),
      lastSlowEventMs: events.length === 0 ? null : (events[events.length - 1]?.start ?? null),
      pointerMoveCount: pointerMoves.length,
      keyPressCount: keyPresses.length,
      pointerRateHz: pointerSpanMs !== null && pointerSpanMs > 0 ? (pointerMoves.length / pointerSpanMs) * 1000 : null,
      frameCount: frames.length,
      windowMs: endedAt - startedAt
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
      idbOps: (() => {
        const phaseGeneration = window.__morphoPerf?.lastPhaseGeneration;
        const requests = io.idbRequests.filter((request) =>
          request.generation === phaseGeneration &&
          request.start < (window.__morphoPerf?.lastPhaseEnd ?? Number.NEGATIVE_INFINITY) &&
          request.end > (window.__morphoPerf?.lastPhaseStart ?? Number.POSITIVE_INFINITY)
        );
        const buckets = new Map<string, { store: string; op: string; count: number; totalMs: number; maxMs: number; lastAt: number | null }>();
        for (const request of requests) {
          const bucketKey = `${request.store}:${request.op}`;
          const current = buckets.get(bucketKey);
          const ms = request.end - request.start;
          if (current) {
            current.count += 1;
            current.totalMs += ms;
            current.maxMs = Math.max(current.maxMs, ms);
            current.lastAt = request.end;
          } else {
            buckets.set(bucketKey, {
              store: request.store,
              op: request.op,
              count: 1,
              totalMs: ms,
              maxMs: ms,
              lastAt: request.end
            });
          }
        }
        return [...buckets.values()];
      })(),
      objectUrlCreations: {
        count: io.urlCreates.length,
        totalMs: io.urlCreates.reduce((total, ms) => total + ms, 0),
        maxMs: io.urlCreates.length === 0 ? 0 : Math.max(...io.urlCreates)
      },
      objectUrlRevocations: io.urlRevokes,
      marks: io.marks.filter((mark) => {
        const start = window.__morphoPerf?.lastPhaseStart ?? Number.POSITIVE_INFINITY;
        const end = window.__morphoPerf?.lastPhaseEnd ?? Number.NEGATIVE_INFINITY;
        return mark.at >= start && mark.at <= end;
      }),
      inputEvents: io.inputs.filter((input) => {
        const start = window.__morphoPerf?.lastPhaseStart ?? Number.POSITIVE_INFINITY;
        const end = window.__morphoPerf?.lastPhaseEnd ?? Number.NEGATIVE_INFINITY;
        return input.at >= start && input.at <= end;
      })
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
  /** Earliest tracked input at/after arming — the initiating input. */
  firstInputAt: number | null;
  /** Latest tracked input at/after arming — the last input inside the window. */
  lastInputAt: number | null;
  firstChangeAt: number | null;
  matchedTextAt: number | null;
  valid: boolean;
  invalidReason: "change_before_input" | "no_input" | null;
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
        firstInputAt: null as number | null,
        lastInputAt: null as number | null,
        firstChangeAt: null as number | null,
        matchedTextAt: null as number | null,
        valid: true,
        invalidReason: null as "change_before_input" | "no_input" | null
      };
      const root = document.querySelector(rootSelector);
      if (!root) {
        throw new Error(`feedback root not found: ${rootSelector}`);
      }
      const processMutations = () => {
        const changedAt = performance.now();
        const textMatched = !requireText || root.textContent?.includes(requireText) === true;
        if (requireText && !textMatched) {
          return;
        }
        if (record.firstChangeAt === null) {
          record.firstChangeAt = changedAt;
        }
        if (requireText && record.matchedTextAt === null) {
          record.matchedTextAt = changedAt;
          observer.disconnect();
        }
      };
      const observer = new MutationObserver(() => processMutations());
      observer.observe(root, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true
      });
      (window as unknown as {
        __morphoFeedback?: { record: typeof record; observer: MutationObserver; process: () => void };
      }).__morphoFeedback = {
        record,
        observer,
        process: processMutations
      };
    },
    { rootSelector, requireText: requireText ?? null }
  );
}

export async function readFeedback(page: Page): Promise<FeedbackResult> {
  return page.evaluate(() => {
    const handle = (window as unknown as {
      __morphoFeedback?: { record: FeedbackResult; observer: MutationObserver; process: () => void };
    }).__morphoFeedback;
    if (!handle) {
      throw new Error("readFeedback called without armFeedback.");
    }
    // MutationObserver delivery is asynchronous. Drain records before disconnecting so
    // the final attribute/text mutation is not lost at the phase boundary.
    if (handle.observer.takeRecords().length > 0) {
      handle.process();
    }
    handle.observer.disconnect();
    (window as unknown as { __morphoFeedback?: unknown }).__morphoFeedback = undefined;
    const state = window.__morphoPerf;
    const phaseStart = state?.lastPhaseStart ?? state?.phaseStart ?? handle.record.armedAt;
    const phaseEnd = state?.lastPhaseEnd ?? performance.now();
    if (state) {
      const inputs = [...state.pointerDowns, ...state.keyPresses];
      if (state.io) {
        inputs.push(...state.io.inputs.map((entry) => entry.at));
      }
      const afterArm = inputs
        .filter((at) => at >= handle.record.armedAt && at >= phaseStart && at <= phaseEnd)
        .sort((a, b) => a - b);
      const initiating = handle.record.firstChangeAt === null
        ? afterArm
        : afterArm.filter((at) => at <= handle.record.firstChangeAt!);
      if (initiating.length > 0) {
        handle.record.firstInputAt = initiating[0] ?? null;
        handle.record.lastInputAt = initiating[initiating.length - 1] ?? null;
      } else {
        handle.record.valid = false;
        handle.record.invalidReason = "no_input";
      }
    }
    if (
      handle.record.firstInputAt !== null &&
      handle.record.firstChangeAt !== null &&
      handle.record.firstChangeAt < handle.record.firstInputAt
    ) {
      handle.record.valid = false;
      handle.record.invalidReason = "change_before_input";
    }
    return handle.record;
  });
}
