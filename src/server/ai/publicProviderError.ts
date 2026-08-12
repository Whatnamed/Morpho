import { OpenAiCompatibleProviderError } from "./openaiCompatibleProvider";

export type PublicProviderError = Readonly<{
  code: string;
  message: string;
  recoverable: boolean;
}>;

export const TEXT_PROVIDER_UNAVAILABLE: PublicProviderError = {
  code: "provider_unavailable",
  message: "文本 AI 服务暂时不可用，请稍后重试。",
  recoverable: false
};

export const IMAGE_PROVIDER_UNAVAILABLE: PublicProviderError = {
  code: "image_provider_unavailable",
  message: "图像服务暂时不可用，请稍后重试。",
  recoverable: false
};

export const IMAGE_PROVIDER_CANCELLED: PublicProviderError = {
  code: "image_cancelled",
  message: "图像任务已取消。",
  recoverable: false
};

export const IMAGE_PROVIDER_FAILED: PublicProviderError = {
  code: "image_generation_failed",
  message: "图像任务失败，请稍后重试。",
  recoverable: false
};

export function getPublicTextProviderError(error: unknown): PublicProviderError {
  const code = getPublicTextProviderFailureCode(error);
  if (code === "provider_context_limit") {
    return { code, message: "对话内容超过模型上下文限制，本轮未完成。", recoverable: false };
  }
  if (code === "provider_function_call_limit") {
    return { code, message: "模型返回的工具调用过多，本轮未完成。", recoverable: false };
  }
  if (code === "provider_response_too_large") {
    return { code, message: "模型响应超过安全上限，本轮未完成。", recoverable: false };
  }
  if (code === "provider_deadline_exceeded") {
    return { code, message: "模型响应超时，请稍后重试。", recoverable: true };
  }

  const status = error instanceof OpenAiCompatibleProviderError ? error.status : undefined;
  return {
    code,
    message: "文本 AI 服务暂时不可用，请稍后重试。",
    recoverable: status !== 400 && status !== 401 && status !== 403 && status !== 413 && status !== 415 && status !== 422
  };
}

export function getPublicTextProviderFailureCode(error: unknown): string {
  if (error instanceof OpenAiCompatibleProviderError) {
    if (error.code === "context_limit") return "provider_context_limit";
    if (error.code === "function_call_limit") return "provider_function_call_limit";
    if (error.code === "provider_deadline_exceeded") return "provider_deadline_exceeded";
    if (error.code === "provider_response_too_large") return "provider_response_too_large";
    return `provider_http_${Math.max(0, Math.min(999, error.status))}`;
  }
  return "provider_execution_failed";
}
