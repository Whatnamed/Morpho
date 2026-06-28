import type { AiWorkIntent } from "@/domain/morpho/types";

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

export type AiRouteDocumentExtract = {
  objectId: string;
  title: string;
  fileName?: string;
  text: string;
  charCount: number;
  pageCount?: number;
  truncated: boolean;
};

export type AiRouteRequest = {
  draft: string;
  task: string;
  taskMode: "chatAnalysis" | "imageGeneration" | "researchOperation";
  workIntent?: AiWorkIntent;
  messages: Array<{
    role: "user" | "assistant";
    body: string;
  }>;
  objectSummaries: AiRouteObjectSummary[];
  attachments: AiRouteAttachment[];
  documentExtracts?: AiRouteDocumentExtract[];
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
    ? value.attachments.filter(isAttachment).map(normalizeAttachment)
    : [];
  const documentExtracts =
    !Array.isArray(value.documentExtracts)
      ? []
      : value.documentExtracts.filter(isDocumentExtract).slice(0, 8);

  return {
    status: "ok",
    value: {
      draft: value.draft,
      task: typeof value.task === "string" ? value.task : "general",
      taskMode,
      workIntent: isWorkIntent(value.workIntent) ? value.workIntent : "discussion",
      messages,
      objectSummaries,
      attachments,
      documentExtracts,
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
  const textWithDocuments = [buildDocumentExtractPromptBlock(request), request.draft].filter(Boolean).join("\n\n");
  const userContent =
    readyImages.length > 0
      ? [
          {
            type: "text" as const,
            text: textWithDocuments
          },
          ...readyImages.map((attachment) => ({
            type: "image_url" as const,
            image_url: {
              url: attachment.dataUrl
            }
          }))
        ]
      : textWithDocuments;

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
    `本次工作意图：${request.workIntent ?? "discussion"}`,
    request.defaultReferenceStatus ? `默认参考状态：${request.defaultReferenceStatus}` : "",
    "本次可用对象摘要：",
    objectLines,
    buildAttachmentCapabilityLine(request),
    buildDocumentCapabilityLine(request),
    buildWebSearchCapabilityLine(request),
    buildStructuredProposalInstruction(request)
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDocumentExtractPromptBlock(request: AiRouteRequest): string {
  const documentExtracts = request.documentExtracts ?? [];
  if (documentExtracts.length === 0) {
    return "";
  }

  return [
    "本次选中资料的本地解析文本如下。它们是 local project sources，不是联网 citation；引用时必须使用 objectId，不得编造 URL。",
    ...documentExtracts.map((extract) =>
      [
        `## ${extract.objectId} / ${extract.title}${extract.fileName ? ` / ${extract.fileName}` : ""}`,
        `chars=${extract.charCount}${extract.pageCount ? ` pages=${extract.pageCount}` : ""}${
          extract.truncated ? " truncated=true" : ""
        }`,
        extract.text
      ].join("\n")
    )
  ].join("\n\n");
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

function buildDocumentCapabilityLine(request: AiRouteRequest): string {
  const documentExtracts = request.documentExtracts ?? [];
  if (documentExtracts.length === 0) {
    return "本次没有发送本地解析文档正文；未解析或解析失败的文件不能被当作已读资料。";
  }

  const truncatedCount = documentExtracts.filter((extract) => extract.truncated).length;
  return `本次发送 ${documentExtracts.length} 个选中 parsed 文件的 documentExtract 文本。它们只能作为本地来源 objectId 使用，不等同网络 citation。${
    truncatedCount > 0 ? `${truncatedCount} 个文档已按长度截断。` : ""
  }`;
}

function buildWebSearchCapabilityLine(request: AiRouteRequest): string {
  if (!request.webSearch?.enabled) {
    return "本次没有提供联网搜索工具；不得编造外部来源，也不得把普通模型文字当作 citation。";
  }

  return `本次可使用 MiMo web_search 工具。只有当外部事实、当前信息、来源验证、案例补充或研究依据会明显提升回答时才联网；普通创意讨论、改写和不依赖外部事实的视觉发散不要联网。force_search=${request.webSearch.forceSearch}。只可引用 provider 返回的 URL citation，不得编造来源。`;
}

function buildStructuredProposalInstruction(request: AiRouteRequest): string {
  if (request.taskMode === "imageGeneration") {
    return [
      "本次你只负责形成受控图像生成计划，不直接生成图片，也不能声称已出图。",
      "如果生成目标明确，请在普通回答后附加一个 fenced JSON block，且只使用以下顶层字段：",
      "morphoVisualGenerationPlan: { kind, items }。",
      "kind 只能是 directionPreview 或 visualDevelopment。",
      "items 每项包含 id, targetDirectionId?, visualBranchId?, title, purpose, prompt, referenceObjectIds, role。",
      "role 只能是 conceptImage、sceneVisual、cmfStudy、detailStudy 或 preview。",
      "referenceObjectIds、targetDirectionId、visualBranchId 只能来自本次可用对象摘要；不得编造图片、方向、分支或来源。",
      "方向预览可以按用户请求为同一方向输出多项，但每项 role 必须是 conceptImage，且不要自动创建视觉分支。",
      "如果本次发送了图片像素或 contact sheet，只能把它们作为视觉计划依据；GrsAI 生成阶段会由 Morpho 另行选择必要参考图。",
      "如果本次发送了本地 documentExtract，它们只用于理解项目资料和约束，不能作为网页 citation。"
    ].join("\n");
  }

  if (request.taskMode === "researchOperation") {
    return [
      "如果本次研究结果足够结构化，请在普通回答后附加一个 fenced JSON block，且只使用以下顶层字段：",
      "morphoResearchProposal: { title, summary, findings, opportunities, constraints, openQuestions, evidence }。",
      "evidence 每项包含 claim、sourceObjectIds、citationUrls、confidence，其中 confidence 为 supported、partial 或 needsVerification。",
      "如果无法可靠结构化，不要输出该 JSON block。"
    ].join("\n");
  }

  if (request.workIntent === "createDesignDefinition" || request.workIntent === "reviseDesignDefinition") {
    return [
      "如果你已经形成可保存的设计定义草案，请在普通回答后附加一个 fenced JSON block，且只使用以下顶层字段：",
      "morphoDesignDefinitionProposal: { title, summary, projectGoal, targetUsers, primaryScenarios, coreProblem, designPrinciples, constraints, avoidDirections, opportunities, openQuestions, changeNote }。",
      "不要自动声明已应用该定义；这只是候选草案。",
      "如果无法可靠结构化，不要输出该 JSON block。"
    ].join("\n");
  }

  if (
    request.workIntent === "createConceptDirections" ||
    request.workIntent === "reviseConceptDirection" ||
    request.workIntent === "splitConceptDirection" ||
    request.workIntent === "mergeConceptDirections"
  ) {
    return [
      "如果你已经形成可保存的概念方向草案，请在普通回答后附加一个 fenced JSON block，且只使用以下顶层字段：",
      "morphoConceptDirectionProposal: { title, summary, directions }。",
      "directions 为数组，每项包含 title, summary, conceptStatement, keywords, strategy, differentiators, visualSignals, risks, openQuestions，可选 basedOnDirectionId, lineageKind。",
      "不要自动指定主方向；新方向默认只是待预览候选。",
      "如果无法可靠结构化，不要输出该 JSON block。"
    ].join("\n");
  }

  return "";
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

function isDocumentExtract(value: unknown): value is AiRouteDocumentExtract {
  return (
    isRecord(value) &&
    typeof value.objectId === "string" &&
    typeof value.title === "string" &&
    typeof value.text === "string" &&
    typeof value.charCount === "number" &&
    value.text.length > 0 &&
    (value.fileName === undefined || typeof value.fileName === "string") &&
    (value.pageCount === undefined || typeof value.pageCount === "number") &&
    typeof value.truncated === "boolean"
  );
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

function isWorkIntent(value: unknown): value is AiWorkIntent {
  return (
    value === "discussion" ||
    value === "comparison" ||
    value === "createDesignDefinition" ||
    value === "reviseDesignDefinition" ||
    value === "createConceptDirections" ||
    value === "reviseConceptDirection" ||
    value === "splitConceptDirection" ||
    value === "mergeConceptDirections"
  );
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
