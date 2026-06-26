import { describe, expect, it } from "vitest";

import {
  buildConceptDirectionLineageDetail,
  buildConceptDirectionVersionDetail,
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

describe("BottomDetailBar concept direction text", () => {
  it("shows current revision count and current revision id", () => {
    expect(buildConceptDirectionVersionDetail(["direction-a-r1", "direction-a-r2"], "direction-a-r2")).toBe(
      "当前方向共有 2 个修订，当前修订为 direction-a-r2。"
    );
  });

  it("summarizes lineage records connected to the selected direction", () => {
    expect(
      buildConceptDirectionLineageDetail("direction-merged", [
        {
          id: "lineage-a",
          kind: "mergedFromDirection",
          fromDirectionId: "direction-a",
          toDirectionId: "direction-merged",
          createdAt: "2026-06-26T00:00:00.000Z",
          note: "方向 AB 合并了方向 A。"
        },
        {
          id: "lineage-b",
          kind: "mergedFromDirection",
          fromDirectionId: "direction-b",
          toDirectionId: "direction-merged",
          createdAt: "2026-06-26T00:00:00.000Z",
          note: "方向 AB 合并了方向 B。"
        }
      ])
    ).toBe("mergedFromDirection：方向 AB 合并了方向 A。 mergedFromDirection：方向 AB 合并了方向 B。");
  });
});
