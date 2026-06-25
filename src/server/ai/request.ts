import type { ProviderChatMessage, ProviderWebSearchOptions } from "./types";

export type AiRouteObjectSummary = {
  id: string;
  type: string;
  title: string;
  summary: string;
};

export type AiRouteAttachmentRepresentation = "single" | "contactSheet";

export type AiRouteAttachmentSummary = {
  id: string;
  kind: "image";
  objectId: string;
  objectIds?: string[];
  mimeType: string;
  representation?: AiRouteAttachmentRepresentation;
  status: "metadataOnly";
};

export type AiRouteImageAttachment = {
  id: string;
  kind: "image";
  objectId: string;
  objectIds?: string[];
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
  byteSize?: number;
  representation?: AiRouteAttachmentRepresentation;
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

  const taskMode = isTaskMode(value.taskMode) ? value.taskMode : "chatAnalysis";
  const messages = Array.isArray(value.messages) ? value.messages.filter(isMessage).slice(-12) : [];
  const objectSummaries = Array.isArray(value.objectSummaries)
    ? value.objectSummaries.filter(isObjectSummary).slice(0, 16)
    : [];
  const attachments = Array.isArray(value.attachments)
    ? taskMode === "imageGeneration"
      ? []
      : value.attachments.filter(isAttachment).map(normalizeAttachment)
    : [];

  return {
    status: "ok",
    value: {
      draft: value.draft,
      task: typeof value.task === "string" ? value.task : "general",
      taskMode,
      messages,
      objectSummaries,
      attachments,
      webSearch: normalizeWebSearch(value.webSearch, taskMode),
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
          .map((object) => `- ${object.id} / ${object.type} / ${object.title}: ${object.summary}`)
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
    buildWebSearchCapabilityLine(request),
    request.taskMode === "researchOperation"
      ? [
          "如果本次研究结果足够结构化，请在普通回答后附加一个 fenced JSON block，且只使用以下顶层字段：",
          "morphoResearchProposal: { title, summary, findings, opportunities, constraints, openQuestions, evidence }。",
          "evidence 每项包含 claim、sourceObjectIds、citationUrls、confidence，其中 confidence 为 supported、partial 或 needsVerification。",
          "如果无法可靠结构化，不要输出该 JSON block。"
        ].join("\n")
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildAttachmentCapabilityLine(request: AiRouteRequest): string {
  const readyImages = request.attachments.filter((attachment) => attachment.status === "ready");
  if (readyImages.length === 0) {
    return "本次没有发送图片像素；如果讨论图片，只能基于对象标题、摘要和用户描述，不能声称完成真实视觉分析。";
  }

  const representedObjectIds = new Set(readyImages.flatMap((attachment) => attachment.objectIds ?? [attachment.objectId]));
  const contactSheetCount = readyImages.filter((attachment) => attachment.representation === "contactSheet").length;
  return `本次已发送 ${representedObjectIds.size} 个显式选择的 active 图片对象像素，使用 MiMo OpenAI-compatible image_url 输入。${contactSheetCount > 0 ? `其中 ${contactSheetCount} 个输入是自动生成的总览图，用于覆盖较多参考。` : ""}只分析这些图片，不读取隐藏对象、未选旧图或整张画布。`;
}

function buildWebSearchCapabilityLine(request: AiRouteRequest): string {
  if (!request.webSearch?.enabled) {
    return "本次没有提供联网搜索工具；不得编造外部来源，也不得把普通模型文字当作 citation。";
  }

  return `本次可使用 MiMo web_search 工具。只有当外部事实、当前信息、来源验证、案例补充或研究依据会明显提升回答时才联网；普通创意讨论、改写和不依赖外部事实的视觉发散不要联网。force_search=${request.webSearch.forceSearch}。只可引用 provider 返回的 URL citation，不得编造来源。`;
}

function isMessage(value: unknown): value is AiRouteRequest["messages"][number] {
  return isRecord(value) && (value.role === "user" || value.role === "assistant") && typeof value.body === "string";
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
    isOptionalStringArray(value.objectIds) &&
    isOptionalRepresentation(value.representation) &&
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
    isOptionalStringArray(value.objectIds) &&
    isOptionalRepresentation(value.representation) &&
    /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(value.dataUrl)
  );
}

function normalizeAttachment(value: AiRouteAttachment): AiRouteAttachment {
  if (value.status === "ready") {
    return {
      id: value.id,
      kind: "image",
      objectId: value.objectId,
      objectIds: value.objectIds,
      mimeType: value.mimeType,
      dataUrl: value.dataUrl,
      width: typeof value.width === "number" ? value.width : undefined,
      height: typeof value.height === "number" ? value.height : undefined,
      byteSize: typeof value.byteSize === "number" ? value.byteSize : undefined,
      representation: value.representation,
      status: "ready"
    };
  }

  return {
    id: value.id,
    kind: value.kind,
    objectId: value.objectId,
    objectIds: value.objectIds,
    mimeType: value.mimeType,
    representation: value.representation,
    status: value.status
  };
}

function normalizeWebSearch(value: unknown, taskMode: AiRouteRequest["taskMode"]): ProviderWebSearchOptions | undefined {
  if (taskMode === "imageGeneration" || !isRecord(value) || value.enabled !== true) {
    return undefined;
  }

  return {
    enabled: true,
    forceSearch: value.forceSearch === true,
    maxKeyword: typeof value.maxKeyword === "number" ? clampInteger(value.maxKeyword, 1, 8, 2) : undefined,
    limit: typeof value.limit === "number" ? clampInteger(value.limit, 1, 10, 5) : undefined
  };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isTaskMode(value: unknown): value is AiRouteRequest["taskMode"] {
  return value === "chatAnalysis" || value === "imageGeneration" || value === "researchOperation";
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

function isOptionalRepresentation(value: unknown): value is AiRouteAttachmentRepresentation | undefined {
  return value === undefined || value === "single" || value === "contactSheet";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
