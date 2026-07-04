import type { MiMoFailureKind } from "./keyPool";

export class MiMoProviderError extends Error {
  constructor(
    readonly kind: MiMoFailureKind,
    readonly status?: number,
    readonly diagnostic?: string
  ) {
    super(`MiMo provider error: ${kind}${status ? ` (${status})` : ""}`);
    this.name = "MiMoProviderError";
  }
}

export function getMiMoRouteErrorMessage(
  error: unknown,
  context: { capability?: "text" | "multimodal"; webSearchEnabled?: boolean; attachmentCount?: number } = {}
): string {
  if (error instanceof MiMoProviderError) {
    if (error.kind === "authFailed") {
      return "MiMo Key 无效或权限不足，请检查 .env.local 中的 MiMo Key 配置。";
    }

    if (error.kind === "rateLimited") {
      return "MiMo 当前触发限流，请稍后重试；本次输入、选择和上下文已保留。";
    }

    if (error.kind === "requestInvalid") {
      const requestKind = [
        context.capability === "multimodal" ? `图片输入 ${context.attachmentCount ?? 0} 个` : "纯文本",
        context.webSearchEnabled ? "启用联网工具" : "未启用联网工具"
      ].join("，");
      return `MiMo 请求格式或模型配置不兼容（${requestKind}）。请优先检查本轮使用的模型名称、联网工具开关或图片输入设置；本次输入、选择和上下文已保留。`;
    }

    return "MiMo 服务暂时不可用，请稍后重试；本次输入、选择和上下文已保留。";
  }

  return "MiMo 网络连接失败，请检查本机网络或稍后重试；本次输入、选择和上下文已保留。";
}
