import { describe, expect, it } from "vitest";

import type { StorageWriteFailureKind } from "@/infrastructure/persistence/localProjectStore";

import { describeSaveFailure } from "./saveFailureNotice";

const KINDS: StorageWriteFailureKind[] = ["quotaExceeded", "storageUnavailable", "writeNotVerified", "unknown"];

describe("describeSaveFailure", () => {
  it("tells the user their work is unsaved when the workspace write failed", () => {
    for (const kind of KINDS) {
      const notice = describeSaveFailure(kind, "workspace");

      expect(notice.isWorkAtRisk).toBe(true);
      expect(notice.body).toContain("当前修改尚未保存");
      expect(notice.body).toContain("不要关闭");
    }
  });

  it("does not claim lost work when only the project list failed", () => {
    // The workspace write already succeeded at this point; warning about
    // unsaved work here would be false and would teach the user to ignore it.
    const notice = describeSaveFailure("quotaExceeded", "catalog");

    expect(notice.isWorkAtRisk).toBe(false);
    expect(notice.body).toContain("已经保存");
    expect(notice.body).not.toContain("尚未保存");
  });

  it("names a different fix for each cause", () => {
    const bodies = KINDS.map((kind) => describeSaveFailure(kind, "workspace").body);

    expect(new Set(bodies).size).toBe(KINDS.length);
  });

  it("points a full origin at freeing space and a blocked one at the browser mode", () => {
    expect(describeSaveFailure("quotaExceeded", "workspace").body).toContain("删除不再需要的项目");
    expect(describeSaveFailure("storageUnavailable", "workspace").body).toContain("隐私模式");
  });

  it("gives every cause its own title", () => {
    const titles = KINDS.map((kind) => describeSaveFailure(kind, "workspace").title);

    expect(new Set(titles).size).toBe(KINDS.length);
    for (const title of titles) {
      expect(title).toContain("保存失败");
    }
  });

  it("treats a missing stage as a workspace write, the more dangerous reading", () => {
    expect(describeSaveFailure("unknown", undefined).isWorkAtRisk).toBe(true);
  });
});
