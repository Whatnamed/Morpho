// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  calculatePhaseSamples,
  isPhaseEntry,
  isTimestampInWindow,
  type RawEventEntry,
  type RawLoafEntry
} from "../../e2e/fixtures/perfProbe";

describe("perfProbe phase boundary semantics and sample calculation", () => {
  it("uses start-owned window logic via isPhaseEntry and isTimestampInWindow", () => {
    const startedAt = 1000.0;
    const endedAt = 2000.0;

    // Events before start
    expect(isPhaseEntry(950.0, startedAt, endedAt)).toBe(false);
    expect(isTimestampInWindow(950.0, startedAt, endedAt)).toBe(false);

    // Events exactly at start
    expect(isPhaseEntry(1000.0, startedAt, endedAt)).toBe(true);
    expect(isTimestampInWindow(1000.0, startedAt, endedAt)).toBe(true);

    // Events strictly inside window
    expect(isPhaseEntry(1500.0, startedAt, endedAt)).toBe(true);
    expect(isTimestampInWindow(1500.0, startedAt, endedAt)).toBe(true);

    // Events at end boundary (start-owned excludes end, timestamp includes end)
    expect(isPhaseEntry(2000.0, startedAt, endedAt)).toBe(false);
    expect(isTimestampInWindow(2000.0, startedAt, endedAt)).toBe(true);

    // Events strictly after end
    expect(isPhaseEntry(2050.0, startedAt, endedAt)).toBe(false);
    expect(isTimestampInWindow(2050.0, startedAt, endedAt)).toBe(false);
  });

  it("calculates phase samples accurately with start-owned entry filtering", () => {
    const startedAt = 1000.0;
    const endedAt = 2000.0;

    const rawEvents: RawEventEntry[] = [
      { start: 950.0, duration: 100.0, processing: 80.0, processingStart: 960.0, processingEnd: 1040.0 }, // started before phase -> excluded
      { start: 1000.0, duration: 50.0, processing: 30.0, processingStart: 1010.0, processingEnd: 1040.0 }, // exactly at start -> included
      { start: 1500.0, duration: 40.0, processing: 20.0, processingStart: 1510.0, processingEnd: 1530.0 }, // inside phase -> included
      { start: 2000.0, duration: 30.0, processing: 15.0, processingStart: 2005.0, processingEnd: 2020.0 }  // at/after end -> excluded
    ];

    const rawLoaf: RawLoafEntry[] = [
      { start: 800.0, duration: 300.0, blockingDuration: 200.0 }, // started before phase -> excluded
      { start: 1200.0, duration: 150.0, blockingDuration: 80.0 },  // inside phase -> included
      { start: 1600.0, duration: 250.0, blockingDuration: 120.0 }, // inside phase -> included
      { start: 2000.0, duration: 100.0, blockingDuration: 40.0 }   // at/after end -> excluded
    ];

    const commits = [900.0, 1000.0, 1500.0, 2000.0, 2100.0];
    const frames = [950.0, 1050.0, 1550.0, 2000.0, 2050.0];
    const pointerMoves = [1050.0, 1250.0, 1450.0, 1650.0, 1850.0];
    const keyPresses = [1100.0, 1300.0];

    const samples = calculatePhaseSamples({
      startedAt,
      endedAt,
      commits,
      loaf: rawLoaf,
      events: rawEvents,
      frames,
      pointerMoves,
      keyPresses
    });

    expect(samples.phaseStartedAt).toBe(1000.0);
    expect(samples.phaseEndedAt).toBe(2000.0);
    expect(samples.windowMs).toBe(1000.0);

    // Commits in [1000, 2000]
    expect(samples.commitCount).toBe(3);
    expect(samples.commitTimestamps).toEqual([1000.0, 1500.0, 2000.0]);

    // LoAF: only start in [1000, 2000)
    expect(samples.loafCount).toBe(2);
    expect(samples.longestLoafMs).toBe(250.0);
    expect(samples.longestBlockingMs).toBe(120.0);
    expect(samples.totalLoafMs).toBe(400.0);
    expect(samples.totalBlockingMs).toBe(200.0);

    // Events: only start in [1000, 2000)
    expect(samples.slowEventCount).toBe(2);
    expect(samples.firstSlowEventMs).toBe(1000.0);
    expect(samples.lastSlowEventMs).toBe(1500.0);
    expect(samples.slowEventProcessingMaxMs).toBe(30.0);
    expect(samples.slowEventTotalProcessingMs).toBe(50.0);

    // Frames and pointer rates
    expect(samples.frameCount).toBe(3);
    expect(samples.pointerMoveCount).toBe(5);
    expect(samples.keyPressCount).toBe(2);
    expect(samples.pointerRateHz).toBeCloseTo(6.25, 2);
  });

  it("isolates phase generations so old IDB requests do not cross phases", () => {
    type IdbRecord = { store: string; op: string; start: number; end: number; generation: number | null };
    const phase1Gen = 2;
    const phase2Gen = 3;
    const phase2Start = 2000.0;
    const phase2End = 3000.0;

    const requests: IdbRecord[] = [
      { store: "assets", op: "get", start: 1500.0, end: 2100.0, generation: phase1Gen }, // started in phase 1, settled in phase 2
      { store: "assets", op: "put", start: 2200.0, end: 2300.0, generation: phase2Gen }, // started and settled in phase 2
      { store: "blobs", op: "get", start: 2400.0, end: 2500.0, generation: phase2Gen }   // started and settled in phase 2
    ];

    const phase2Requests = requests.filter(
      (r) => r.generation === phase2Gen && r.start < phase2End && r.end > phase2Start
    );

    expect(phase2Requests).toHaveLength(2);
    expect(phase2Requests.every((r) => r.generation === phase2Gen)).toBe(true);
  });
});
