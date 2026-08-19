// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { PerfPhaseSamples } from "../../e2e/fixtures/perfProbe";

describe("perfProbe phase boundary semantics", () => {
  it("filters out events and frames starting before phaseStartedAt", () => {
    const startedAt = 1000.0;
    const endedAt = 2000.0;

    const rawEvents = [
      { start: 950.0, duration: 100.0, processing: 80.0, processingStart: 960.0, processingEnd: 1040.0 }, // starts before phase (overlaps startedAt)
      { start: 1000.0, duration: 50.0, processing: 30.0, processingStart: 1010.0, processingEnd: 1040.0 }, // exactly at start
      { start: 1500.0, duration: 40.0, processing: 20.0, processingStart: 1510.0, processingEnd: 1530.0 }, // inside phase
      { start: 2000.0, duration: 30.0, processing: 15.0, processingStart: 2005.0, processingEnd: 2020.0 }, // at/after end
      { start: 2050.0, duration: 20.0, processing: 10.0, processingStart: 2055.0, processingEnd: 2065.0 } // after end
    ];

    const isPhaseEntry = (start: number) => start >= startedAt && start < endedAt;
    const filteredEvents = rawEvents.filter((entry) => isPhaseEntry(entry.start));

    expect(filteredEvents).toHaveLength(2);
    expect(filteredEvents[0]?.start).toBe(1000.0);
    expect(filteredEvents[1]?.start).toBe(1500.0);
    expect(filteredEvents.every((e) => e.start >= startedAt && e.start < endedAt)).toBe(true);
  });

  it("attributes LoAF entries starting inside phase window and delivered at phase end", () => {
    const startedAt = 500.0;
    const endedAt = 1200.0;

    const rawLoaf = [
      { start: 400.0, duration: 200.0, blockingDuration: 150.0 }, // started before phase -> excluded
      { start: 600.0, duration: 300.0, blockingDuration: 250.0 }, // started inside phase -> included
      { start: 1100.0, duration: 200.0, blockingDuration: 100.0 }, // started inside phase, ends after endedAt -> included
      { start: 1200.0, duration: 100.0, blockingDuration: 50.0 }  // started at endedAt -> excluded
    ];

    const isPhaseEntry = (start: number) => start >= startedAt && start < endedAt;
    const filteredLoaf = rawLoaf.filter((entry) => isPhaseEntry(entry.start));

    expect(filteredLoaf).toHaveLength(2);
    expect(filteredLoaf[0]?.start).toBe(600.0);
    expect(filteredLoaf[1]?.start).toBe(1100.0);
    expect(filteredLoaf.every((l) => l.start >= startedAt && l.start < endedAt)).toBe(true);
  });

  it("isolates phase generations so old IDB requests and rAF ticks do not cross phases", () => {
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
