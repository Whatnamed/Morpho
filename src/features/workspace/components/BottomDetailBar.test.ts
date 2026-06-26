import { describe, expect, it } from "vitest";

import {
  buildDesignDefinitionInfoMeta,
  buildDesignDefinitionVersionDetail
} from "./BottomDetailBar";

describe("BottomDetailBar design definition text", () => {
  it("shows the revision-draft badge only when a pending revision draft exists", () => {
    expect(buildDesignDefinitionInfoMeta(true)).toBe("有修订草稿");
    expect(buildDesignDefinitionInfoMeta(false)).toBeUndefined();
  });

  it("keeps version detail neutral unless a pending revision draft exists", () => {
    expect(buildDesignDefinitionVersionDetail(2, true)).toBe("当前设计定义共有 2 个修订，当前有修订草稿待应用。");
    expect(buildDesignDefinitionVersionDetail(2, false)).toBe("当前设计定义共有 2 个修订。");
  });
});
