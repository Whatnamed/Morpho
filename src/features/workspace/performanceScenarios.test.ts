import { describe, expect, it } from "vitest";

import { buildPerformanceScenarios } from "./performanceScenarios";

/**
 * These assertions exist because a scale fixture that silently fails to scale is the
 * worst possible input to a performance baseline: it produces fast, trustworthy-looking
 * numbers for work that never happened.
 */
describe("Performance scenarios", () => {
  const scenarios = buildPerformanceScenarios();
  const byKey = new Map(scenarios.map((scenario) => [scenario.key, scenario]));

  it("exposes every declared tier exactly once", () => {
    expect(scenarios.map((scenario) => scenario.key)).toEqual([
      "caseStudy",
      "objects100",
      "objects300",
      "objects500",
      "chatLong",
      "framesHeavy",
      "memoryHeavy",
      "compound500",
      "compound500Dangling",
      "compound500LatentMessageRefs"
    ]);
  });

  it("actually scales the object axis", () => {
    expect(byKey.get("objects100")?.scale.objects).toBe(100);
    expect(byKey.get("objects300")?.scale.objects).toBe(300);
    expect(byKey.get("objects500")?.scale.objects).toBe(500);

    // Canvas instances must scale with objects, otherwise the canvas-side targets
    // measure an empty page while the object map looks full.
    expect(byKey.get("objects500")?.scale.canvasInstances).toBeGreaterThan(0);
  });

  it("moves one axis at a time across the single-axis tiers", () => {
    const objects300 = byKey.get("objects300")?.scale;
    const chatLong = byKey.get("chatLong")?.scale;
    const framesHeavy = byKey.get("framesHeavy")?.scale;
    const memoryHeavy = byKey.get("memoryHeavy")?.scale;

    // Same baseline object count, different loaded axis.
    expect(chatLong?.objects).toBe(40);
    expect(framesHeavy?.objects).toBe(40);
    expect(memoryHeavy?.objects).toBe(40);
    expect(objects300?.objects).toBe(300);

    expect(chatLong?.messages).toBe(560); // 500 plain + 60 traced
    expect(framesHeavy?.contextFrames).toBeGreaterThanOrEqual(120);
    expect(memoryHeavy?.memoryRevisions).toBe(200);
  });

  it("keeps the rewired and dangling compound tiers identical in every measured dimension", () => {
    // The pair is only meaningful if size is held constant and resolvability is the
    // sole variable. If these ever diverge, the reported delta stops being "the price
    // of dangling refs" and becomes an uncontrolled comparison.
    expect(byKey.get("compound500Dangling")?.scale).toEqual(byKey.get("compound500")?.scale);
  });

  it("records that message-kind source refs are latent, not current", () => {
    // The shipped case study has none. This is the fact that stops 4C from optimizing
    // the O(entries x refs x messages) path on the strength of a synthetic fixture.
    expect(byKey.get("caseStudy")?.scale.messageSourceRefs).toBe(0);
    expect(byKey.get("compound500")?.scale.messageSourceRefs).toBe(0);

    // ...and the latent tier is the only place that path is exercised at all.
    const latent = byKey.get("compound500LatentMessageRefs")?.scale;
    expect(latent?.messageSourceRefs).toBe(400); // 200 entries x 2 injected refs
    expect(latent?.continuityEntries).toBe(byKey.get("compound500")?.scale.continuityEntries);
    expect(byKey.get("compound500LatentMessageRefs")?.note).toContain("LATENT");
  });

  it("gives the compound tiers a populated continuity graph", () => {
    const compound = byKey.get("compound500")?.scale;
    expect(compound?.continuityEntries).toBe(200);
    expect(compound?.continuitySourceRefs).toBeGreaterThan(0);
    expect(compound?.decisionRecords).toBe(200);
    expect(compound?.messages).toBe(560);
  });

  it("leaves the case study untouched as the only real project state", () => {
    const caseStudy = byKey.get("caseStudy")?.scale;
    expect(caseStudy?.objects).toBe(42);
    expect(caseStudy?.messages).toBe(184);
    expect(caseStudy?.continuityEntries).toBe(64);
  });
});
