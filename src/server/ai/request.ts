import type { ProviderChatMessage, ProviderWebSearchOptions } from "./types";

export type AiRouteObjectSummary = {
  id: string;
  type: string;
  title: string;
  summary: string;
};

export type AiRouteAttachmentSummary = {
  id: string;
  kind: "image";
  objectId: string;
  mimeType: string;
  status: "metadataOnly";
};

export type AiRouteImageAttachment = {
  id: string;
  kind: "image";
  objectId: string;
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
  byteSize?: number;
  status: "ready";
};

export type AiRouteAttachment = AiRouteAttachmentSummary | AiRouteImageAttachment;

export type AiRouteRequest = {
  draft: string;
  task: string;
  taskMode: "chatAnalysis" | "imageGeneration" | "researchOperation";
  messages: Array<{
    role: "user" | "assistant";
    body: string;
  }>;
  objectSummaries: AiRouteObjectSummary[];
  attachments: AiRouteAttachment[];
  webSearch?: ProviderWebSearchOptions;
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
  const taskMode = isTaskMode(value.taskMode) ? value.taskMode : "chatAnalysis";
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.filter(isAttachment).map(normalizeAttachment).slice(0, taskMode === "imageGeneration" ? 0 : 3)
    : [];
  const webSearch = normalizeWebSearch(value.webSearch, taskMode);

  return {
    status: "ok",
    value: {
      draft: value.draft,
      task: typeof value.task === "string" ? value.task : "general",
      taskMode,
      messages,
      objectSummaries,
      attachments,
      webSearch,
      defaultReferenceStatus: typeof value.defaultReferenceStatus === "string" ? value.defaultReferenceStatus : undefined
    }
  };
}

export function buildProviderMessages(request: AiRouteRequest): ProviderChatMessage[] {
  const history = request.messages.map((message): ProviderChatMessage => ({
    role: message.role,
    content: message.body
  }));
  const readyImages = request.attachments.filter((attachment): attachment is AiRouteImageAttachment => attachment.status === "ready");
  const userContent =
    readyImages.length > 0
      ? [
          {
            type: "text" as const,
            text: request.draft
          },
          ...readyImages.map((attachment) => ({
            type: "image_url" as const,
            image_url: {
              url: attachment.dataUrl
            }
          }))
        ]
      : request.draft;

  return [...history, { role: "user", content: userContent }];
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
    `本次执行模式：${request.taskMode}`,
    request.defaultReferenceStatus ? `默认参考状态：${request.defaultReferenceStatus}` : "",
    "本次可用对象摘要：",
    objectLines,
    buildAttachmentCapabilityLine(request),
    request.webSearch?.enabled
      ? `本次已授权一次 MiMo web_search 补充：max_keyword=${request.webSearch.maxKeyword}, limit=${request.webSearch.limit}, force_search=${request.webSearch.forceSearch}。只可引用 provider 返回的 URL citation，不得编造来源。`
      : "本次未启用联网搜索；不得编造外部来源或把普通模型文本当作 citation。"
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

function isAttachment(value: unknown): value is AiRouteAttachment {
  return isAttachmentSummary(value) || isImageAttachment(value);
}

function isAttachmentSummary(value: unknown): value is AiRouteAttachmentSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.kind === "image" &&
    typeof value.objectId === "string" &&
    typeof value.mimeType === "string" &&
      value.status === "metadataOnly"
  );
}

function isImageAttachment(value: unknown): value is AiRouteImageAttachment {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.kind === "image" &&
    typeof value.objectId === "string" &&
    typeof value.mimeType === "string" &&
    value.status === "ready" &&
    typeof value.dataUrl === "string" &&
    /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(value.dataUrl)
  );
}

function normalizeAttachment(value: AiRouteAttachment): AiRouteAttachment {
  if (value.status === "ready") {
    return {
      id: value.id,
      kind: "image",
      objectId: value.objectId,
      mimeType: value.mimeType,
      dataUrl: value.dataUrl,
      width: typeof value.width === "number" ? value.width : undefined,
      height: typeof value.height === "number" ? value.height : undefined,
      byteSize: typeof value.byteSize === "number" ? value.byteSize : undefined,
      status: "ready"
    };
  }

  return {
    id: value.id,
    kind: value.kind,
    objectId: value.objectId,
    mimeType: value.mimeType,
    status: value.status
  };
}

function normalizeWebSearch(value: unknown, taskMode: AiRouteRequest["taskMode"]): ProviderWebSearchOptions | undefined {
  if (taskMode === "imageGeneration" || !isRecord(value) || value.enabled !== true) {
    return undefined;
  }

  return {
    enabled: true,
    maxKeyword: clampInteger(value.maxKeyword, 1, 2, 2),
    forceSearch: value.forceSearch === true,
    limit: clampInteger(value.limit, 1, 3, 3)
  };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function buildAttachmentCapabilityLine(request: AiRouteRequest): string {
  const readyImages = request.attachments.filter((attachment) => attachment.status === "ready");
  if (readyImages.length > 0) {
    return `本次已发送 ${readyImages.length} 张用户明确选择的图片像素，使用 MiMo OpenAI-compatible image_url 输入。只分析这些图片，不读取隐藏对象、未选旧图或整张画布。`;
  }

  return "本次没有发送图片像素；如讨论图片，只能基于对象标题、摘要和用户描述，不能声称完成真实视觉分析。";
}

function isTaskMode(value: unknown): value is AiRouteRequest["taskMode"] {
  return value === "chatAnalysis" || value === "imageGeneration" || value === "researchOperation";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
