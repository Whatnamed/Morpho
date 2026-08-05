export type ManualCompactCommandResult =
  | { matched: true }
  | { matched: false };

export function parseManualCompactCommand(draft: string): ManualCompactCommandResult {
  return draft.trim().toLowerCase() === "/compact"
    ? { matched: true }
    : { matched: false };
}

export function getManualCompactionStatusText(
  status: "running" | "completed" | "notNeeded" | "failed"
): string {
  switch (status) {
    case "running":
      return "正在压缩当前上下文…";
    case "completed":
      return "上下文压缩完成。已保留当前项目状态、选中对象、待继续问题和最近讨论。";
    case "notNeeded":
      return "当前讨论还很短，无需压缩。";
    case "failed":
      return "上下文压缩未完成：模型没有返回可用的讨论摘要，请稍后重试。";
  }
}
