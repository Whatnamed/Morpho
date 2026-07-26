import type { StorageWriteFailureKind } from "@/infrastructure/persistence/localProjectStore";

/**
 * What to tell the user when a local save fails.
 *
 * Two things decide the wording, and conflating them produces a wrong message:
 *
 * - `stage` says how much is actually at risk. A failed workspace write means
 *   the user's current work is unsaved. A failed catalog write means the work is
 *   already on disk and only the project list is stale — urgent backup language
 *   there would be crying wolf, and users who are warned wrongly stop reading.
 * - `kind` says what would fix it. "Storage is full" and "storage is blocked"
 *   need opposite actions, so a single generic sentence helps with neither.
 */
export type SaveFailureNotice = {
  title: string;
  body: string;
  /** Whether the user's current work is at risk and needs an immediate export. */
  isWorkAtRisk: boolean;
};

export function describeSaveFailure(
  kind: StorageWriteFailureKind,
  stage: "workspace" | "catalog" | undefined
): SaveFailureNotice {
  if (stage === "catalog") {
    return {
      title: "项目列表未能更新",
      body: "这个项目的内容已经保存到本机，只是项目列表暂时没有同步。重新打开页面后会自行修复。",
      isWorkAtRisk: false
    };
  }

  return {
    title: titleFor(kind),
    body: `当前修改尚未保存，请不要关闭这个页面。${nextStepFor(kind)}`,
    isWorkAtRisk: true
  };
}

function titleFor(kind: StorageWriteFailureKind): string {
  switch (kind) {
    case "quotaExceeded":
      return "保存失败：浏览器存储空间已满";
    case "storageUnavailable":
      return "保存失败：浏览器不允许保存本地数据";
    case "writeNotVerified":
      return "保存失败：写入后无法读回";
    case "unknown":
      return "保存失败";
  }
}

function nextStepFor(kind: StorageWriteFailureKind): string {
  switch (kind) {
    case "quotaExceeded":
      return "请先导出备份，再回到项目列表删除不再需要的项目腾出空间。";
    case "storageUnavailable":
      return "如果浏览器正处于隐私模式，或禁用了本站的数据存储，请先导出备份，再换一个普通窗口重新打开。";
    case "writeNotVerified":
      return "这个浏览器窗口无法可靠保存数据。请先导出备份，再换一个窗口继续。";
    case "unknown":
      return "请先导出备份，再重新加载页面。";
  }
}
