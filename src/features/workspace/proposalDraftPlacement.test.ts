import { describe, expect, it } from "vitest";

import { getSiblingProposalPlacement } from "./proposalDraftPlacement";

describe("proposal draft placement", () => {
  it("stacks sibling proposal drafts vertically with a stable gap", () => {
    const origin = { x: 640, y: 320 };

    expect(getSiblingProposalPlacement(origin, 0)).toEqual({ x: 640, y: 320 });
    expect(getSiblingProposalPlacement(origin, 1)).toEqual({ x: 640, y: 520 });
    expect(getSiblingProposalPlacement(origin, 2)).toEqual({ x: 640, y: 720 });
  });
});
