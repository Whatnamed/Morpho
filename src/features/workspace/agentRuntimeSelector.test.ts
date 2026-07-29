import { describe, expect, it } from "vitest";

import {
  isAPlusAgentRuntimeSelected,
  resolveAgentRuntimeSelection
} from "./agentRuntimeSelector";

describe("temporary A+ Stage 3 runtime selector", () => {
  it.each([undefined, "", "b", "a-plus", "true", "A-PLUS-STAGE3"])(
    "keeps the existing B-style runtime active for %s",
    (configured) => {
      expect(resolveAgentRuntimeSelection(configured)).toBe("b");
    }
  );

  it("enables A+ only through the one exact injected Stage 3 value", () => {
    expect(resolveAgentRuntimeSelection("a-plus-stage3")).toBe("a-plus-stage3");
    expect(isAPlusAgentRuntimeSelected({ selection: "a-plus-stage3" })).toBe(true);
    expect(isAPlusAgentRuntimeSelected({ selection: "b" })).toBe(false);
  });
});
