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

export type AiRouteTaskContext = {
  kind: string;
  objectIds: string[];
  imageObjectIds: string[];
  documentObjectIds: string[];
  truncated: boolean;
  defaultReference?: string;
  designDefinition?: AiRouteDesignDefinitionContext;
  directions: AiRouteDirectionContext[];
  visualBranches: AiRouteVisualBranchContext[];
  projectContinuity?: AiRouteProjectContinuityContext;
  skipped: Array<{ objectId: string; reason: string }>;
};

export type AiRouteDesignDefinitionContext = {
  objectId: string;
  revisionId: string;
  revisionNumber: number;
  title: string;
  summary: string;
  projectGoal: string;
  targetUsers: string[];
  primaryScenarios: string[];
  coreProblem: string;
  designPrinciples: string[];
  constraints: string[];
  avoidDirections: string[];
  opportunities: string[];
  openQuestions: string[];
  sourceObjectIds: string[];
  previousRevisionId?: string;
  changeNote?: string;
};

export type AiRouteDirectionContext = {
  objectId: string;
  revisionId: string;
  revisionNumber: number;
  title: string;
  summary: string;
  conceptStatement: string;
  keywords: string[];
  strategy: string;
  differentiators: string[];
  visualSignals: string[];
  risks: string[];
  openQuestions: string[];
  sourceObjectIds: string[];
  basedOnDefinitionRevisionId?: string;
  previousRevisionId?: string;
  changeNote?: string;
};

export type AiRouteVisualBranchContext = {
  id: string;
  directionId: string;
  label: string;
  rootObjectId?: string;
};

export type AiRouteContinuitySourceRef = {
  kind: string;
  id: string;
  snapshot?: {
    title: string;
    objectType?: string;
    revisionNumber?: number;
    status?: string;
    visibility?: string;
    summarySnippet?: string;
  };
  sourceAvailability?: "active" | "hidden" | "missing";
};

export type AiRouteContinuityEntry = {
  id: string;
  stage: string;
  category: string;
  summary: string;
  validity: string;
  sourceRefs: AiRouteContinuitySourceRef[];
};

export type AiRouteProjectContinuityContext = {
  currentFocus: {
    area: string;
    updatedAt: string;
    sourceKind: string;
    sourceObjectIds: string[];
    sourceOperationId?: string;
    note: string;
  };
  relevantStageRecords: AiRouteContinuityEntry[];
  relevantProjectMemoryViews: Array<{
    key: string;
    title: string;
    items: Array<{
      id: string;
      title: string;
      summary: string;
      validity: string;
      sourceRefs: AiRouteContinuitySourceRef[];
    }>;
  }>;
  reviewRequiredItems: AiRouteContinuityEntry[];
  omitted: Array<{ id: string; reason: string }>;
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
  taskContext?: AiRouteTaskContext;
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
  const taskContext = normalizeTaskContext(value.taskContext);

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
      defaultReferenceStatus: typeof value.defaultReferenceStatus === "string" ? value.defaultReferenceStatus : undefined,
      taskContext
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
    buildTaskContextPromptBlock(request),
    buildAttachmentCapabilityLine(request),
    buildDocumentCapabilityLine(request),
    buildWebSearchCapabilityLine(request),
    buildConversationSemanticPatchInstruction(request),
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

function buildTaskContextPromptBlock(request: AiRouteRequest): string {
  const context = request.taskContext;
  if (!context) {
    return "";
  }

  const lines = [
    "Structured task context:",
    `kind: ${context.kind}`,
    `objectIds: ${context.objectIds.join(", ") || "none"}`,
    `imageObjectIds: ${context.imageObjectIds.join(", ") || "none"}`,
    `documentObjectIds: ${context.documentObjectIds.join(", ") || "none"}`,
    `defaultReference: ${context.defaultReference ?? "none"}`,
    `truncated: ${context.truncated ? "true" : "false"}`
  ];

  if (context.designDefinition) {
    const definition = context.designDefinition;
    lines.push(
      `designDefinition: ${definition.objectId} / r${definition.revisionNumber} / ${definition.title}`,
      `summary: ${definition.summary}`,
      `projectGoal: ${definition.projectGoal}`,
      `targetUsers: ${definition.targetUsers.join("; ")}`,
      `primaryScenarios: ${definition.primaryScenarios.join("; ")}`,
      `coreProblem: ${definition.coreProblem}`,
      `designPrinciples: ${definition.designPrinciples.join("; ")}`,
      `constraints: ${definition.constraints.join("; ")}`,
      `avoidDirections: ${definition.avoidDirections.join("; ")}`,
      `opportunities: ${definition.opportunities.join("; ")}`,
      `openQuestions: ${definition.openQuestions.join("; ")}`,
      `definitionSourceObjectIds: ${definition.sourceObjectIds.join(", ")}`
    );
  }

  for (const direction of context.directions) {
    lines.push(
      `direction: ${direction.objectId} / r${direction.revisionNumber} / ${direction.title}`,
      `summary: ${direction.summary}`,
      `conceptStatement: ${direction.conceptStatement}`,
      `keywords: ${direction.keywords.join("; ")}`,
      `strategy: ${direction.strategy}`,
      `differentiators: ${direction.differentiators.join("; ")}`,
      `visualSignals: ${direction.visualSignals.join("; ")}`,
      `risks: ${direction.risks.join("; ")}`,
      `openQuestions: ${direction.openQuestions.join("; ")}`,
      `directionSourceObjectIds: ${direction.sourceObjectIds.join(", ")}`
    );
  }

  for (const branch of context.visualBranches) {
    lines.push(`visualBranch: ${branch.id} / ${branch.directionId} / ${branch.label}${branch.rootObjectId ? ` / root=${branch.rootObjectId}` : ""}`);
  }

  appendProjectContinuityPromptLines(lines, context.projectContinuity);

  if (context.skipped.length > 0) {
    lines.push(`skipped: ${context.skipped.map((skip) => `${skip.objectId}:${skip.reason}`).join("; ")}`);
  }

  return lines.join("\n");
}

function appendProjectContinuityPromptLines(lines: string[], continuity: AiRouteProjectContinuityContext | undefined): void {
  if (!continuity) {
    return;
  }

  lines.push(
    "Project continuity:",
    `currentFocus: ${continuity.currentFocus.area} / ${continuity.currentFocus.note} / updatedAt=${continuity.currentFocus.updatedAt}`,
    "validityRule: current can be used as stable context only when included by Morpho; hidden sources are marked with sourceAvailability=hidden and must not be treated as active inputs; reviewRequired must be marked as needing review; superseded and sourceUnavailable must not be treated as current facts."
  );

  for (const entry of continuity.relevantStageRecords) {
    lines.push(
      `continuityRecord: [${entry.validity}] ${entry.stage}/${entry.category} ${entry.id}: ${entry.summary}; sources=${summarizeContinuitySources(entry.sourceRefs)}`
    );
  }

  for (const view of continuity.relevantProjectMemoryViews) {
    for (const item of view.items) {
      lines.push(`memoryView:${view.key}: [${item.validity}] ${item.title}: ${item.summary}`);
    }
  }

  for (const item of continuity.reviewRequiredItems) {
    lines.push(`reviewContinuity: [${item.validity}] ${item.stage}/${item.category} ${item.id}: ${item.summary}`);
  }

  if (continuity.omitted.length > 0 || continuity.truncated) {
    lines.push(
      `continuityOmitted: ${continuity.omitted.map((item) => `${item.id}:${item.reason}`).join("; ") || "none"}; truncated=${continuity.truncated ? "true" : "false"}`
    );
  }
}

function summarizeContinuitySources(sourceRefs: AiRouteContinuitySourceRef[]): string {
  return sourceRefs.map((ref) => `${ref.kind}:${ref.id}`).join(", ") || "none";
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

function buildConversationSemanticPatchInstruction(request: AiRouteRequest): string {
  if (request.taskMode !== "chatAnalysis" && request.taskMode !== "researchOperation") {
    return "";
  }

  return [
    "仅当当前用户消息明确、无歧义地表达可长期使用的偏好、约束、避免项、待确认问题、已存在决定的理由或淘汰理由时，才可在普通回答后附加 morphoProjectContinuityPatch。",
    "morphoProjectContinuityPatch 只能包含 items，最多 3 项；每项只能包含 kind, scope, evidenceQuote, relatedObjectIds, relatedRevisionIds, relatedDecisionIds。",
    "kind 只能是 preference、constraint、avoidance、openQuestion、decisionReason、rejectionReason；scope 只能是 project、designDefinition、direction、visual。",
    "provider 不得生成 summary；Morpho 会只用 evidenceQuote 在本地确定性生成长期记录摘要，任何 summary 字段都会被忽略。",
    "evidenceQuote 必须是当前用户消息中的直接原话，不要从语气、暗示、模型建议、临时生成要求或未确认草案中推断。",
    "patch 不得改变任何项目对象、方向状态、默认参考、revision、VisualBranch、交付引用或 Current Focus，也不得输出 setDirectionPrimary、setDefaultReference、hideObject、deleteObject 等状态命令。",
    "如果不确定，不要输出 morphoProjectContinuityPatch；如果本回复还输出设计定义或概念方向的待应用 Proposal JSON，也不要输出 semantic patch。研究任务中的结构化研究草案不会自动成立为长期项目事实，因此不作为全局抑制条件。"
  ].join("\n");
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

function normalizeTaskContext(value: unknown): AiRouteTaskContext | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return undefined;
  }

  return {
    kind: trimString(value.kind, 80),
    objectIds: stringArray(value.objectIds).slice(0, 16),
    imageObjectIds: stringArray(value.imageObjectIds).slice(0, 16),
    documentObjectIds: stringArray(value.documentObjectIds).slice(0, 8),
    truncated: value.truncated === true,
    defaultReference: typeof value.defaultReference === "string" ? trimString(value.defaultReference, 240) : undefined,
    designDefinition: normalizeDesignDefinitionContext(value.designDefinition),
    directions: Array.isArray(value.directions) ? value.directions.map(normalizeDirectionContext).filter(isDefined).slice(0, 6) : [],
    visualBranches: Array.isArray(value.visualBranches)
      ? value.visualBranches.map(normalizeVisualBranchContext).filter(isDefined).slice(0, 8)
      : [],
    projectContinuity: normalizeProjectContinuityContext(value.projectContinuity),
    skipped: Array.isArray(value.skipped) ? value.skipped.map(normalizeSkippedContext).filter(isDefined).slice(0, 12) : []
  };
}

function normalizeDesignDefinitionContext(value: unknown): AiRouteDesignDefinitionContext | undefined {
  if (!isRecord(value) || typeof value.objectId !== "string" || typeof value.revisionId !== "string") {
    return undefined;
  }

  return {
    objectId: trimString(value.objectId, 120),
    revisionId: trimString(value.revisionId, 120),
    revisionNumber: numberValue(value.revisionNumber),
    title: stringField(value.title, 160),
    summary: stringField(value.summary, 400),
    projectGoal: stringField(value.projectGoal, 400),
    targetUsers: stringArray(value.targetUsers).slice(0, 8).map((item) => trimString(item, 160)),
    primaryScenarios: stringArray(value.primaryScenarios).slice(0, 8).map((item) => trimString(item, 160)),
    coreProblem: stringField(value.coreProblem, 400),
    designPrinciples: stringArray(value.designPrinciples).slice(0, 8).map((item) => trimString(item, 160)),
    constraints: stringArray(value.constraints).slice(0, 8).map((item) => trimString(item, 160)),
    avoidDirections: stringArray(value.avoidDirections).slice(0, 8).map((item) => trimString(item, 160)),
    opportunities: stringArray(value.opportunities).slice(0, 8).map((item) => trimString(item, 160)),
    openQuestions: stringArray(value.openQuestions).slice(0, 8).map((item) => trimString(item, 160)),
    sourceObjectIds: stringArray(value.sourceObjectIds).slice(0, 16),
    previousRevisionId: typeof value.previousRevisionId === "string" ? trimString(value.previousRevisionId, 120) : undefined,
    changeNote: typeof value.changeNote === "string" ? trimString(value.changeNote, 240) : undefined
  };
}

function normalizeDirectionContext(value: unknown): AiRouteDirectionContext | undefined {
  if (!isRecord(value) || typeof value.objectId !== "string" || typeof value.revisionId !== "string") {
    return undefined;
  }

  return {
    objectId: trimString(value.objectId, 120),
    revisionId: trimString(value.revisionId, 120),
    revisionNumber: numberValue(value.revisionNumber),
    title: stringField(value.title, 160),
    summary: stringField(value.summary, 400),
    conceptStatement: stringField(value.conceptStatement, 400),
    keywords: stringArray(value.keywords).slice(0, 5).map((item) => trimString(item, 120)),
    strategy: stringField(value.strategy, 400),
    differentiators: stringArray(value.differentiators).slice(0, 8).map((item) => trimString(item, 160)),
    visualSignals: stringArray(value.visualSignals).slice(0, 8).map((item) => trimString(item, 160)),
    risks: stringArray(value.risks).slice(0, 8).map((item) => trimString(item, 160)),
    openQuestions: stringArray(value.openQuestions).slice(0, 8).map((item) => trimString(item, 160)),
    sourceObjectIds: stringArray(value.sourceObjectIds).slice(0, 16),
    basedOnDefinitionRevisionId:
      typeof value.basedOnDefinitionRevisionId === "string" ? trimString(value.basedOnDefinitionRevisionId, 120) : undefined,
    previousRevisionId: typeof value.previousRevisionId === "string" ? trimString(value.previousRevisionId, 120) : undefined,
    changeNote: typeof value.changeNote === "string" ? trimString(value.changeNote, 240) : undefined
  };
}

function normalizeVisualBranchContext(value: unknown): AiRouteVisualBranchContext | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.directionId !== "string" || typeof value.label !== "string") {
    return undefined;
  }

  return {
    id: trimString(value.id, 120),
    directionId: trimString(value.directionId, 120),
    label: trimString(value.label, 160),
    rootObjectId: typeof value.rootObjectId === "string" ? trimString(value.rootObjectId, 120) : undefined
  };
}

function normalizeSkippedContext(value: unknown): { objectId: string; reason: string } | undefined {
  if (!isRecord(value) || typeof value.objectId !== "string" || typeof value.reason !== "string") {
    return undefined;
  }

  return {
    objectId: trimString(value.objectId, 120),
    reason: trimString(value.reason, 240)
  };
}

function normalizeProjectContinuityContext(value: unknown): AiRouteProjectContinuityContext | undefined {
  if (!isRecord(value) || !isRecord(value.currentFocus)) {
    return undefined;
  }

  return {
    currentFocus: {
      area: stringField(value.currentFocus.area, 80),
      updatedAt: stringField(value.currentFocus.updatedAt, 80),
      sourceKind: stringField(value.currentFocus.sourceKind, 80),
      sourceObjectIds: stringArray(value.currentFocus.sourceObjectIds).slice(0, 8),
      sourceOperationId:
        typeof value.currentFocus.sourceOperationId === "string"
          ? trimString(value.currentFocus.sourceOperationId, 120)
          : undefined,
      note: stringField(value.currentFocus.note, 220)
    },
    relevantStageRecords: Array.isArray(value.relevantStageRecords)
      ? value.relevantStageRecords.map(normalizeContinuityEntry).filter(isDefined).slice(0, 6)
      : [],
    relevantProjectMemoryViews: Array.isArray(value.relevantProjectMemoryViews)
      ? value.relevantProjectMemoryViews.map(normalizeProjectMemoryView).filter(isDefined).slice(0, 4)
      : [],
    reviewRequiredItems: Array.isArray(value.reviewRequiredItems)
      ? value.reviewRequiredItems.map(normalizeContinuityEntry).filter(isDefined).slice(0, 4)
      : [],
    omitted: Array.isArray(value.omitted) ? value.omitted.map(normalizeContinuityOmitted).filter(isDefined).slice(0, 12) : [],
    truncated: value.truncated === true
  };
}

function normalizeContinuityEntry(value: unknown): AiRouteContinuityEntry | undefined {
  if (!isRecord(value) || typeof value.id !== "string") {
    return undefined;
  }

  return {
    id: trimString(value.id, 160),
    stage: stringField(value.stage, 80),
    category: stringField(value.category, 80),
    summary: stringField(value.summary, 220),
    validity: stringField(value.validity, 80),
    sourceRefs: Array.isArray(value.sourceRefs) ? value.sourceRefs.map(normalizeContinuitySourceRef).filter(isDefined).slice(0, 8) : []
  };
}

function normalizeProjectMemoryView(value: unknown): AiRouteProjectContinuityContext["relevantProjectMemoryViews"][number] | undefined {
  if (!isRecord(value) || typeof value.key !== "string" || typeof value.title !== "string") {
    return undefined;
  }

  return {
    key: trimString(value.key, 80),
    title: trimString(value.title, 120),
    items: Array.isArray(value.items)
      ? value.items
          .map((item) => {
            if (!isRecord(item) || typeof item.id !== "string") {
              return undefined;
            }
            return {
              id: trimString(item.id, 160),
              title: stringField(item.title, 160),
              summary: stringField(item.summary, 220),
              validity: stringField(item.validity, 80),
              sourceRefs: Array.isArray(item.sourceRefs)
                ? item.sourceRefs.map(normalizeContinuitySourceRef).filter(isDefined).slice(0, 8)
                : []
            };
          })
          .filter(isDefined)
          .slice(0, 5)
      : []
  };
}

function normalizeContinuitySourceRef(value: unknown): AiRouteContinuitySourceRef | undefined {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.id !== "string") {
    return undefined;
  }
  if (!isContinuitySourceRefKind(value.kind)) {
    return undefined;
  }

  const snapshot = isRecord(value.snapshot)
    ? {
        title: stringField(value.snapshot.title, 160),
        objectType: typeof value.snapshot.objectType === "string" ? trimString(value.snapshot.objectType, 80) : undefined,
        revisionNumber:
          typeof value.snapshot.revisionNumber === "number" && Number.isFinite(value.snapshot.revisionNumber)
            ? Math.max(0, Math.trunc(value.snapshot.revisionNumber))
            : undefined,
        status: typeof value.snapshot.status === "string" ? trimString(value.snapshot.status, 120) : undefined,
        visibility: typeof value.snapshot.visibility === "string" ? trimString(value.snapshot.visibility, 80) : undefined,
        summarySnippet:
          typeof value.snapshot.summarySnippet === "string" ? trimString(value.snapshot.summarySnippet, 220) : undefined
      }
    : undefined;

  return {
    kind: trimString(value.kind, 80),
    id: trimString(value.id, 160),
    snapshot,
    sourceAvailability:
      value.sourceAvailability === "active" || value.sourceAvailability === "hidden" || value.sourceAvailability === "missing"
        ? value.sourceAvailability
        : undefined
  };
}

function isContinuitySourceRefKind(value: string): boolean {
  return (
    value === "object" ||
    value === "revision" ||
    value === "operation" ||
    value === "branch" ||
    value === "decision" ||
    value === "citation" ||
    value === "deliveryReference" ||
    value === "message"
  );
}

function normalizeContinuityOmitted(value: unknown): { id: string; reason: string } | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.reason !== "string") {
    return undefined;
  }

  return {
    id: trimString(value.id, 160),
    reason: trimString(value.reason, 180)
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function stringField(value: unknown, maxLength: number): string {
  return typeof value === "string" ? trimString(value, maxLength) : "";
}

function trimString(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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
