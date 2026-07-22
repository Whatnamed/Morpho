import type {
  AgentTaskStrategyKind,
  ConversationSummaryRevision,
  MorphoWorkspace,
  ProviderContextFrame,
  ProviderContextFramePlacement,
  ProviderContextFrameSourceRef,
  ProviderInputCacheBoundaryReason,
  ProviderInputSnapshot
} from "@/domain/morpho/types";
import {
  appendProviderContextFrame,
  buildProviderContextFrameTimeline,
  createProviderContextFrame,
  nextProviderContextFrameSequence,
  providerContextFrameMessage
} from "@/domain/morpho/providerContextFrame";
import { providerInputSnapshotText } from "@/domain/morpho/providerInputSnapshot";
import type { ResponseMessageInput } from "@/server/ai/openaiCompatibleProvider";
import type { TaskContextResult, ProviderTaskContext } from "./taskContext";
import type { MorphoAgentTurnMode } from "./morphoAgent";
import { buildAgentDefaultMemoryContext } from "@/domain/morpho/projectMemory";
import { buildAgentStrategyPolicyBlocks } from "./agentPromptRegistry";
import type { AgentDefaultMemoryContext } from "@/domain/morpho/projectMemory";

export type ProviderContextFrameBuildInput = {
  workspace: MorphoWorkspace;
  projectId: string;
  strategy: AgentTaskStrategyKind;
  mode: MorphoAgentTurnMode;
  toolProfile: "standard" | "standardWithWebSearch";
  promptContractVersion: string;
  userMessageId: string;
  context: TaskContextResult;
  providerTaskContext: ProviderTaskContext;
  defaultMemoryContext: AgentDefaultMemoryContext;
  summaryRevision?: ConversationSummaryRevision;
  framePlacement?: ProviderContextFramePlacement;
  attachmentCount?: number;
  documentSnapshotAvailable?: boolean;
  cacheBoundaryReason?: ProviderInputCacheBoundaryReason;
};

export function appendAgentProviderContextFrames(
  workspace: MorphoWorkspace,
  input: ProviderContextFrameBuildInput
): MorphoWorkspace {
  const previousFrames = workspace.ai.providerContextFrames ?? [];
  const next = appendAgentProviderStateFrames(workspace, {
    ...input,
    framePlacement: input.framePlacement ?? "beforeUser"
  });
  const beforeAdditionIds = new Set(previousFrames.map((frame) => frame.id));
  const stateFrames = (next.ai.providerContextFrames ?? []).filter((frame) => !beforeAdditionIds.has(frame.id));
  const summary = input.summaryRevision
    ? createConversationSummaryFrame(input, next.ai.providerContextFrames ?? [])
    : undefined;
  const turnContext = createTurnContextFrame(
    input,
    summary
      ? [...(next.ai.providerContextFrames ?? previousFrames), summary]
      : next.ai.providerContextFrames ?? previousFrames
  );
  const additions = [...stateFrames, ...(summary ? [summary] : []), turnContext];
  const nextFrames = additions.reduce(
    (frames, frame) => appendProviderContextFrame(frames, frame),
    next.ai.providerContextFrames ?? previousFrames
  );
  return nextFrames.length === previousFrames.length
    ? workspace
    : { ...next, ai: { ...next.ai, providerContextFrames: nextFrames } };
}

export function appendAgentProviderStateFrames(
  workspace: MorphoWorkspace,
  input: ProviderContextFrameBuildInput
): MorphoWorkspace {
  const previousFrames = workspace.ai.providerContextFrames ?? [];
  const projectState = createProjectStateFrame(input, previousFrames);
  const runtimeConfiguration = createRuntimeConfigurationFrame(input, previousFrames);
  const additions = [projectState, runtimeConfiguration];
  const nextFrames = additions.reduce(
    (frames, frame) => appendProviderContextFrame(frames, frame),
    [...previousFrames]
  );
  return nextFrames.length === previousFrames.length
    ? workspace
    : { ...workspace, ai: { ...workspace.ai, providerContextFrames: nextFrames } };
}

export function buildAgentProviderInput(input: {
  stableSystemPrompt: string;
  frames: readonly ProviderContextFrame[];
  history: Array<{
    id: string;
    role: "user" | "assistant";
    body: string;
    providerInputSnapshot?: ProviderInputSnapshot;
  }>;
  currentUserMessageId: string;
  userInput: ResponseMessageInput;
  activeSummaryRevisionId?: string;
}): ResponseMessageInput[] {
  const activeMessageIds = new Set(input.history.map((message) => message.id));
  activeMessageIds.add(input.currentUserMessageId);
  const frames = buildProviderContextFrameTimeline({
    frames: input.frames,
    activeMessageIds,
    activeSummaryRevisionId: input.activeSummaryRevisionId
  });
  const messages: ResponseMessageInput[] = [
    {
      role: "system",
      content: [{ type: "input_text", text: input.stableSystemPrompt }]
    }
  ];
  frames
    .filter((frame) => frame.placement === "conversationBaseline" || !frame.anchorMessageId)
    .forEach((frame) => messages.push(providerContextFrameMessage(frame)));

  const beforeByAnchor = new Map<string, ProviderContextFrame[]>();
  const afterByAnchor = new Map<string, ProviderContextFrame[]>();
  for (const frame of frames) {
    if (!frame.anchorMessageId || frame.placement === "conversationBaseline") {
      continue;
    }
    const target = frame.placement === "afterUser" || frame.placement === "afterAssistant"
      ? afterByAnchor
      : beforeByAnchor;
    const anchored = target.get(frame.anchorMessageId) ?? [];
    anchored.push(frame);
    target.set(frame.anchorMessageId, anchored);
  }

  for (const message of input.history) {
    beforeByAnchor.get(message.id)?.forEach((frame) => messages.push(providerContextFrameMessage(frame)));
    messages.push(providerHistoryMessage(message));
    afterByAnchor.get(message.id)?.forEach((frame) => messages.push(providerContextFrameMessage(frame)));
  }
  beforeByAnchor.get(input.currentUserMessageId)?.forEach((frame) => messages.push(providerContextFrameMessage(frame)));
  messages.push(input.userInput);
  afterByAnchor.get(input.currentUserMessageId)?.forEach((frame) => messages.push(providerContextFrameMessage(frame)));
  return messages;
}

export function getProviderInputReplayBoundaryReasons(
  history: readonly { role: "user" | "assistant"; providerInputSnapshot?: ProviderInputSnapshot }[],
  options: {
    currentPromptContractVersion?: string;
    currentToolProfile?: "standard" | "standardWithWebSearch";
    frames?: readonly ProviderContextFrame[];
  } = {}
): ProviderInputCacheBoundaryReason[] {
  const reasons = new Set<ProviderInputCacheBoundaryReason>();
  for (const message of history) {
    if (message.role === "user" && !message.providerInputSnapshot) {
      reasons.add("legacyProviderInput");
    }
    const reason = message.providerInputSnapshot?.cacheBoundaryReason;
    if (reason) {
      reasons.add(reason);
    }
    if (
      message.providerInputSnapshot &&
      options.currentPromptContractVersion &&
      message.providerInputSnapshot.promptContractVersion !== options.currentPromptContractVersion
    ) {
      reasons.add("promptContractChanged");
    }
  }
  if (options.currentToolProfile && options.frames?.some((frame) => {
    if (frame.kind !== "runtimeConfiguration") {
      return false;
    }
    const profile = frame.renderedText.match(/Provider Tool Profile[:：]\s*(standardWithWebSearch|standard)/)?.[1];
    return profile !== undefined && profile !== options.currentToolProfile;
  })) {
    reasons.add("toolProfileChanged");
  }
  return [...reasons];
}

function providerHistoryMessage(message: {
  role: "user" | "assistant";
  body: string;
  providerInputSnapshot?: ProviderInputSnapshot;
}): ResponseMessageInput {
  if (message.role === "user" && message.providerInputSnapshot) {
    const textParts = providerInputSnapshotText(message.providerInputSnapshot);
    if (textParts.length > 0) {
      return {
        role: "user",
        content: textParts.map((text) => ({ type: "input_text" as const, text }))
      };
    }
  }
  return {
    role: message.role,
    content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: message.body }]
  };
}

function createProjectStateFrame(
  input: ProviderContextFrameBuildInput,
  previousFrames: readonly ProviderContextFrame[]
): ProviderContextFrame {
  const stableMemoryContext = buildStableProjectMemoryContext(input.workspace);
  const memoryRevisionIds = stableMemoryContext.documents
    .map((document) => document.revisionId)
    .filter((id): id is string => Boolean(id))
    .sort();
  const stageRevisionIds: string[] = [];
  const currentDefinition = Object.values(input.workspace.designDefinitionRevisions).find((revision) => revision.isCurrent);
  const primaryDirection = input.workspace.workingState.primaryDirectionId
    ? input.workspace.objects[input.workspace.workingState.primaryDirectionId]
    : undefined;
  const defaultReference = input.workspace.workingState.currentDefaultReferenceId
    ? input.workspace.objects[input.workspace.workingState.currentDefaultReferenceId]
    : undefined;
  const deliveries = Object.values(input.workspace.objects)
    .filter((object) => object.type === "delivery" && object.visibility === "active")
    .map((object) => object.title)
    .sort();
  const previous = latestFrame(previousFrames, "projectState");
  const sequence = nextProviderContextFrameSequence(previousFrames);
  const placement = input.framePlacement ?? "beforeUser";
  return createProviderContextFrame({
    projectId: input.projectId,
    kind: "projectState",
    createdAt: new Date().toISOString(),
    sequence,
    placement,
    promptContractVersion: input.promptContractVersion,
    projectMemoryRevisionIds: memoryRevisionIds,
    stageRecordRevisionIds: stageRevisionIds,
    ...(currentDefinition ? { designDefinitionRevisionId: currentDefinition.id } : {}),
    directionRevisionIds: primaryDirection?.type === "conceptDirection" && primaryDirection.currentRevisionId
      ? [primaryDirection.currentRevisionId]
      : [],
    ...(defaultReference?.type === "image" ? { defaultReferenceObjectId: defaultReference.id } : {}),
    selectedObjectIds: [],
    relatedObjectIds: uniqueIds([
      ...(currentDefinition?.sourceObjectIds ?? []),
      ...(primaryDirection ? [primaryDirection.id] : []),
      ...(defaultReference?.type === "image" ? [defaultReference.id] : [])
    ]),
    renderedText: [
      `项目：${input.workspace.project.title}`,
      `项目副标题：${input.workspace.project.subtitle || "无"}`,
      `当前工作重点：${input.workspace.projectContinuity.currentFocus.note}`,
      renderMemoryDocuments(stableMemoryContext),
      currentDefinition
        ? `当前设计定义：${currentDefinition.title}（${currentDefinition.summary}）`
        : "当前没有已应用设计定义。",
      primaryDirection?.type === "conceptDirection"
        ? `当前主方向：${primaryDirection.title}（${primaryDirection.summary}）`
        : "当前没有已确定主方向。",
      defaultReference?.type === "image"
        ? `当前后续默认参考：${defaultReference.title}（${defaultReference.id}）`
        : "当前没有可用的后续默认参考。",
      deliveries.length > 0 ? `已有交付准备：${deliveries.join("；")}` : "当前没有交付准备包。"
    ].join("\n"),
    supersedesFrameId: previous?.id,
    sourceRefs: buildStableProjectStateSourceRefs(memoryRevisionIds, currentDefinition?.id, primaryDirection?.id),
    reason: "项目结构化状态或长期项目事实发生变化",
    anchorMessageId: input.userMessageId
  });
}

function createTurnContextFrame(
  input: ProviderContextFrameBuildInput,
  previousFrames: readonly ProviderContextFrame[]
): ProviderContextFrame {
  const selected = [...input.context.semanticSummaries]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((summary) => `${summary.title}（${summary.id}）：${summary.summary}`);
  const relatedIds = uniqueIds([
    ...input.context.objectIds,
    ...input.context.documentObjectIds,
    ...input.context.imageObjectIds,
    ...input.context.visualBranches.map((branch) => branch.id)
  ]);
  const sequence = nextProviderContextFrameSequence(previousFrames);
  const taskMemory = renderMemoryDocuments(input.defaultMemoryContext);
  return createProviderContextFrame({
    projectId: input.projectId,
    kind: "turnContext",
    createdAt: new Date().toISOString(),
    sequence,
    placement: input.framePlacement ?? "beforeUser",
    promptContractVersion: input.promptContractVersion,
    taskStrategy: input.strategy,
    projectMemoryRevisionIds: input.defaultMemoryContext.documents
      .map((document) => document.revisionId)
      .filter((id): id is string => Boolean(id)),
    stageRecordRevisionIds: input.defaultMemoryContext.stageRecords
      .map((record) => record.revisionId)
      .filter((id): id is string => Boolean(id)),
    directionRevisionIds: input.context.directionRevisions.map((revision) => revision.id).sort(),
    defaultReferenceObjectId: extractDefaultReferenceObjectId(input.providerTaskContext.defaultReference),
    selectedObjectIds: [...input.context.objectIds].sort(),
    relatedObjectIds: relatedIds,
    renderedText: [
      `本轮任务策略：${input.strategy}`,
      `操作模式：${input.mode}`,
      `本轮范围：${input.context.scopeNote}`,
      `本轮默认参考授权：${input.context.defaultReference.reason}`,
      `本轮图片授权对象数：${input.context.imageObjectIds.length}；实际图片输入数：${input.attachmentCount ?? 0}`,
      `本轮文档对象数：${input.context.documentObjectIds.length}；文档快照：${input.documentSnapshotAvailable === false ? "不可重放" : "已纳入"}`,
      ...(input.cacheBoundaryReason ? [`本轮缓存边界：${input.cacheBoundaryReason}`] : []),
      taskMemory,
      selected.length > 0 ? `本轮相关对象：\n- ${selected.join("\n- ")}` : "本轮没有显式对象摘要。",
      ...buildAgentStrategyPolicyBlocks(input.strategy)
    ].join("\n"),
    sourceRefs: relatedIds.map((id) => ({ kind: "object", id })),
    reason: "为当前用户回合提供授权范围和任务语义",
    anchorMessageId: input.userMessageId
  });
}

function createRuntimeConfigurationFrame(
  input: ProviderContextFrameBuildInput,
  previousFrames: readonly ProviderContextFrame[]
): ProviderContextFrame {
  const previous = latestFrame(previousFrames, "runtimeConfiguration");
  return createProviderContextFrame({
    projectId: input.projectId,
    kind: "runtimeConfiguration",
    createdAt: new Date().toISOString(),
    sequence: nextProviderContextFrameSequence(previousFrames) + 1,
    placement: input.framePlacement ?? "beforeUser",
    promptContractVersion: input.promptContractVersion,
    projectMemoryRevisionIds: [],
    stageRecordRevisionIds: [],
    directionRevisionIds: [],
    selectedObjectIds: [],
    relatedObjectIds: [],
    renderedText: [
      `Agent 模式：${input.mode}`,
      `Provider Tool Profile：${input.toolProfile}`,
      `Prompt Contract：${input.promptContractVersion}`
    ].join("\n"),
    supersedesFrameId: previous?.id,
    sourceRefs: [],
    reason: "会改变 Agent 执行语义的运行配置发生变化",
    anchorMessageId: input.userMessageId
  });
}

function createConversationSummaryFrame(
  input: ProviderContextFrameBuildInput,
  previousFrames: readonly ProviderContextFrame[]
): ProviderContextFrame {
  const summary = input.summaryRevision!.summary;
  return createProviderContextFrame({
    projectId: input.projectId,
    kind: "conversationSummary",
    createdAt: input.summaryRevision!.createdAt,
    sequence: nextProviderContextFrameSequence(previousFrames),
    placement: "conversationBaseline",
    promptContractVersion: input.promptContractVersion,
    projectMemoryRevisionIds: [],
    stageRecordRevisionIds: [],
    directionRevisionIds: [],
    selectedObjectIds: [],
    relatedObjectIds: summary.referencedObjects,
    renderedText: [
      `项目聊天摘要目标：${summary.threadGoal}`,
      `已建立上下文：${summary.establishedContext.join("；") || "无"}`,
      `决定及原因：${summary.decisionsAndReasons.join("；") || "无"}`,
      `当前工作：${summary.activeWork.join("；") || "无"}`,
      `未解决问题：${summary.unresolvedQuestions.join("；") || "无"}`,
      `下一轮锚点：${summary.nextTurnAnchor ?? "无"}`
    ].join("\n"),
    sourceRefs: summary.referencedObjects.map((id) => ({ kind: "object", id })),
    reason: "Conversation Summary revision 已成为当前活动输入的一部分",
    summaryRevisionId: input.summaryRevision!.id
  });
}

function buildStableProjectMemoryContext(workspace: MorphoWorkspace): AgentDefaultMemoryContext {
  const base = buildAgentDefaultMemoryContext(workspace, "historyAndMemory");
  const delivery = buildAgentDefaultMemoryContext(workspace, "deliveryPreparation");
  const documents = [...base.documents];
  const outputPlan = delivery.documents.find((document) => document.key === "outputPlan");
  if (outputPlan && !documents.some((document) => document.key === outputPlan.key)) {
    documents.push(outputPlan);
  }
  return { documents, stageRecords: [] };
}

function renderMemoryDocuments(context: AgentDefaultMemoryContext): string {
  return context.documents
    .filter((document) => !document.empty)
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((document) => {
      const sections = document.sections
        .map((section) => `${section.title}：${section.items.join("；")}`)
        .join("；");
      return `${document.title}：${sections || "暂无"}`;
    })
    .join("\n") || "当前没有可用的长期项目记忆文档。";
}

function buildStableProjectStateSourceRefs(
  memoryRevisionIds: readonly string[],
  designDefinitionRevisionId: string | undefined,
  primaryDirectionId: string | undefined
): ProviderContextFrameSourceRef[] {
  return [
    ...memoryRevisionIds.map((id) => ({ kind: "projectMemoryRevision", id })),
    ...(designDefinitionRevisionId ? [{ kind: "designDefinitionRevision", id: designDefinitionRevisionId }] : []),
    ...(primaryDirectionId ? [{ kind: "object", id: primaryDirectionId }] : [])
  ];
}

function latestFrame(
  frames: readonly ProviderContextFrame[],
  kind: ProviderContextFrame["kind"]
): ProviderContextFrame | undefined {
  return [...frames].sort((left, right) => left.sequence - right.sequence).reverse().find((frame) => frame.kind === kind);
}

function extractDefaultReferenceObjectId(defaultReference: string): string | undefined {
  const match = defaultReference.match(/\(([A-Za-z0-9._:-]+)\)/);
  return match?.[1];
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export { buildProviderContextFrameTimeline, providerContextFrameMessage };
