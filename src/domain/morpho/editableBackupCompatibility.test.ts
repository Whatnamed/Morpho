import { describe, expect, it } from "vitest";

import { canonicalizeEditableBackupWorkspaceCompatibility } from "./editableBackupCompatibility";

describe("editable backup compatibility", () => {
  it.each([
    ["variant", "derivedFromDirection"],
    ["split", "splitFromDirection"],
    ["merge", "mergedFromDirection"],
    ["revision", "supersedesDirection"]
  ] as const)("canonicalizes only retired lineage alias %s without mutating the input", (alias, canonical) => {
    const snapshot = compatibilityFixture(alias);
    const before = structuredClone(snapshot);

    const once = canonicalizeEditableBackupWorkspaceCompatibility(snapshot);
    const twice = canonicalizeEditableBackupWorkspaceCompatibility(once);

    expect(snapshot).toEqual(before);
    expect(directionLineageKind(once)).toBe(canonical);
    expect(twice).toEqual(once);
  });

  it("leaves unknown aliases and non-concept proposals untouched", () => {
    const snapshot = compatibilityFixture("futureLineageKind");
    const proposal = (snapshot.artifactProposals as Record<string, Record<string, unknown>>).proposal;
    proposal.type = "designDefinition";

    expect(canonicalizeEditableBackupWorkspaceCompatibility(snapshot)).toBe(snapshot);
    expect(directionLineageKind(snapshot)).toBe("futureLineageKind");
  });
});

function compatibilityFixture(lineageKind: string): Record<string, unknown> {
  return {
    schemaVersion: 17,
    artifactProposals: {
      proposal: {
        type: "conceptDirection",
        directions: [{ title: "Legacy direction", lineageKind }]
      }
    },
    untouched: { missingRequiredField: true }
  };
}

function directionLineageKind(snapshot: Record<string, unknown>): unknown {
  const proposals = snapshot.artifactProposals as Record<string, Record<string, unknown>>;
  const directions = proposals.proposal.directions as Array<Record<string, unknown>>;
  return directions[0]?.lineageKind;
}
