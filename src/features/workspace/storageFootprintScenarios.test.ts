import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { measureWorkspaceFootprint } from "@/infrastructure/persistence/storageFootprint";
import { buildFootprintScenarios } from "./storageFootprintScenarios";

/**
 * The committed measurement report is the contract for these fixtures.
 *
 * `workspaceScaleFixtures.ts` now shares its builders with the performance
 * harness, so a change made for timing reasons could silently move the storage
 * baseline. This pins every scenario — not just the two headline ones — and fails
 * until `npm run measure:storage` is re-run and its diff reviewed.
 */
type GeneratedFootprintReport = {
  scenarios: { key: string; utf16Length: number }[];
};

const report = JSON.parse(
  readFileSync(resolve(process.cwd(), "docs/operations/storage-footprint.generated.json"), "utf8")
) as GeneratedFootprintReport;

describe("Storage footprint scenarios", () => {
  let scenarios: ReturnType<typeof buildFootprintScenarios>;
  let measured: GeneratedFootprintReport["scenarios"];

  beforeAll(() => {
    scenarios = buildFootprintScenarios();
    measured = scenarios.map((scenario) => ({
      key: scenario.key,
      utf16Length: measureWorkspaceFootprint(scenario.workspace).utf16Length
    }));
  }, 30_000);

  it("keeps every scenario identical to the committed measurement report", () => {
    expect(measured).toEqual(
      report.scenarios.map((scenario) => ({ key: scenario.key, utf16Length: scenario.utf16Length }))
    );
  });

  it("anchors the headline scenarios so a wrongly regenerated report cannot drift unnoticed", () => {
    // Hard-coded on purpose: the comparison above comes from the report itself, so
    // it would still pass if the report were regenerated from broken fixtures.
    // These two numbers are quoted in docs/architecture/decisions.md and must move
    // only alongside a recorded decision.
    const byKey = new Map(report.scenarios.map((scenario) => [scenario.key, scenario.utf16Length]));
    expect(byKey.get("blank")).toBe(2719);
    expect(byKey.get("caseStudy")).toBe(872672);
  });

  it("grows each scenario along a single axis from its baseline", () => {
    // Single-axis growth is what makes `diffFootprints` per-unit attribution valid.
    // Compound multi-axis fixtures belong to performanceScenarios.ts instead.
    const keys = new Set(scenarios.map((scenario) => scenario.key));

    for (const scenario of scenarios) {
      if (scenario.growth) {
        expect(keys.has(scenario.growth.baselineKey)).toBe(true);
        expect(scenario.growth.units).toBeGreaterThan(0);
      }
    }
  });
});
