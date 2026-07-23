import { describe, expect, it } from "vitest";

import {
  canonicalAgentRuntimeMessage,
  resolveCanonicalAgentRuntimeItem
} from "./agentRuntimeItem";

describe("canonical Agent runtime item", () => {
  it("reuses the exact item within one profile and records A to B to A as a new occurrence", () => {
    const a1 = resolveCanonicalAgentRuntimeItem({
      projectId: "project-ocean-buoy",
      mode: "auto",
      effectiveToolProfile: "standard",
      promptContractVersion: "morpho-agent-test"
    });
    const repeatedA = resolveCanonicalAgentRuntimeItem({
      projectId: "project-ocean-buoy",
      mode: "auto",
      effectiveToolProfile: "standard",
      promptContractVersion: "morpho-agent-test",
      previous: a1
    });
    const b = resolveCanonicalAgentRuntimeItem({
      projectId: "project-ocean-buoy",
      mode: "auto",
      effectiveToolProfile: "standardWithWebSearch",
      promptContractVersion: "morpho-agent-test",
      previous: a1
    });
    const a2 = resolveCanonicalAgentRuntimeItem({
      projectId: "project-ocean-buoy",
      mode: "auto",
      effectiveToolProfile: "standard",
      promptContractVersion: "morpho-agent-test",
      previous: b
    });

    expect(repeatedA).toEqual(a1);
    expect(a2.contentHash).toBe(a1.contentHash);
    expect(a2.id).not.toBe(a1.id);
    expect(a2.predecessorItemId).toBe(b.id);
    expect(a2.sequence).toBe(3);
    expect(canonicalAgentRuntimeMessage(a1).content[0].text).toBe(a1.renderedText);
  });
});
