import type { ProviderChatMessage } from "./types";

export type AiRouteObjectSummary = {
  id: string;
  type: string;
  title: string;
  summary: string;
};

export type AiRouteRequest = {
  draft: string;
  task: string;
  messages: Array<{
    role: "user" | "assistant";
    body: string;
  }>;
  objectSummaries: AiRouteObjectSummary[];
  defaultReferenceStatus?: string;
};

export type AiRouteValidationResult =
  | {
      status: "ok";
      value: AiRouteRequest;
    }
  | {
      status: "failed";
      reason: string;
    };

export function validateAiRouteRequest(value: unknown): AiRouteValidationResult {
  if (!isRecord(value)) {
    return { status: "failed", reason: "请求格式无效。" };
  }

  if (typeof value.draft !== "string" || !value.draft.trim()) {
    return { status: "failed", reason: "消息内容为空。" };
  }

  const messages = Array.isArray(value.messages)
    ? value.messages.filter(isMessage).slice(-12)
    : [];
  const objectSummaries = Array.isArray(value.objectSummaries)
    ? value.objectSummaries.filter(isObjectSummary).slice(0, 8)
    : [];

  return {
    status: "ok",
    value: {
      draft: value.draft,
      task: typeof value.task === "string" ? value.task : "general",
      messages,
      objectSummaries,
      defaultReferenceStatus: typeof value.defaultReferenceStatus === "string" ? value.defaultReferenceStatus : undefined
    }
  };
}

export function buildProviderMessages(request: AiRouteRequest): ProviderChatMessage[] {
  const history = request.messages.map((message): ProviderChatMessage => ({
    role: message.role,
    content: message.body
  }));

  return [...history, { role: "user", content: request.draft }];
}

export function buildMorphoSystemPrompt(request: AiRouteRequest): string {
  const objectLines =
    request.objectSummaries.length > 0
      ? request.objectSummaries
          .map((object) => `- ${object.id} · ${object.type} · ${object.title}: ${object.summary}`)
          .join("\n")
      : "- 本次没有显式对象。";

  return [
    "你是 Morpho 的连续工作台 AI，只能回复文本、分析、提出建议和生成可编辑草稿。",
    "你不能直接创建、删除、隐藏对象，不能更改方向状态，不能替换默认参考，不能创建交付引用，不能写入项目记忆。",
    `本次任务类型：${request.task}`,
    request.defaultReferenceStatus ? `默认参考状态：${request.defaultReferenceStatus}` : "",
    "本次可用对象摘要：",
    objectLines,
    "如果没有收到图片像素，请明确说明本次只基于标题、摘要和用户描述。"
  ]
    .filter(Boolean)
    .join("\n");
}

function isMessage(value: unknown): value is AiRouteRequest["messages"][number] {
  return (
    isRecord(value) &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.body === "string"
  );
}

function isObjectSummary(value: unknown): value is AiRouteObjectSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.title === "string" &&
    typeof value.summary === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
