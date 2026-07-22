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
  /** Only set after the server has confirmed the filtered provider tools. */
  toolProfile?: ProviderToolProfile;
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

export type ProviderToolProfile = "standard" | "standardWithWebSearch";

export type ProviderRequestBoundaryState = {
  promptContractVersion: string;
  toolProfile?: ProviderToolProfile;
  summaryRevisionId?: string;
  latestUserMessageId?: string;
  providerInputPrefixHash?: string;
  attachmentBoundary?: ProviderInputCacheBoundaryReason;
};

export type ProviderRuntimeConfiguration = {
  mode: MorphoAgentTurnMode;
  toolProfile: ProviderToolProfile;
  promptContractVersion: string;
};

export function appendAgentProviderContextFrames(
  workspace: MorphoWorkspace,
  input: ProviderContextFrameBuildInput
): MorphoWorkspace {
  const previousFrames = workspace.ai.providerContextFrames ?? [];
  let next = workspace;
  if (input.summaryRevision) {
    next = ensureAgentConversationSummaryBaselines(next, {
      projectId: input.projectId,
      promptContractVersion: input.promptContractVersion,
      summaryRevision: input.summaryRevision,
      mode: input.mode,
      toolProfile: input.toolProfile
    });
  }
  next = appendAgentProviderStateFrames(next, {
    ...input,
    workspace: next,
    framePlacement: input.framePlacement ?? "beforeUser"
  });
  const nextFrames = next.ai.providerContextFrames ?? previousFrames;
  const turnContext = createTurnContextFrame(
    input,
    nextFrames
  );
  const appendedFrames = appendProviderContextFrame(nextFrames, turnContext);
  return appendedFrames.length === nextFrames.length
    ? next
    : { ...next, ai: { ...next.ai, providerContextFrames: appendedFrames } };
}

export function appendAgentProviderStateFrames(
  workspace: MorphoWorkspace,
  input: ProviderContextFrameBuildInput
): MorphoWorkspace {
  const previousFrames = workspace.ai.providerContextFrames ?? [];
  const projectState = createProjectStateFrame(input, previousFrames);
  const runtimeConfiguration = createRuntimeConfigurationFrame(input, previousFrames);
  const additions = [projectState, runtimeConfiguration]
    .filter((frame): frame is ProviderContextFrame => Boolean(frame))
    .filter((frame) => !hasMatchingSummaryBaseline(previousFrames, frame, input.summaryRevision?.id));
  const nextFrames = additions.reduce(
    (frames, frame) => appendProviderContextFrame(frames, frame),
    [...previousFrames]
  );
  return nextFrames.length === previousFrames.length
    ? workspace
    : { ...workspace, ai: { ...workspace.ai, providerContextFrames: nextFrames } };
}

function hasMatchingSummaryBaseline(
  frames: readonly ProviderContextFrame[],
  frame: ProviderContextFrame,
  summaryRevisionId: string | undefined
): boolean {
  if (!summaryRevisionId || (frame.kind !== "projectState" && frame.kind !== "runtimeConfiguration")) {
    return false;
  }
  return frames.some(
    (candidate) =>
      candidate.kind === frame.kind &&
      candidate.placement === "conversationBaseline" &&
      candidate.summaryRevisionId === summaryRevisionId &&
      candidate.contentHash === frame.contentHash
  );
}

export function ensureAgentConversationSummaryBaselines(
  workspace: MorphoWorkspace,
  input: {
    projectId: string;
    promptContractVersion: string;
    summaryRevision: ConversationSummaryRevision;
    mode?: MorphoAgentTurnMode;
    toolProfile?: ProviderToolProfile;
  }
): MorphoWorkspace {
  const previousFrames = workspace.ai.providerContextFrames ?? [];
  let frames = [...previousFrames];
  const summaryExists = frames.some(
    (frame) => frame.kind === "conversationSummary" && frame.summaryRevisionId === input.summaryRevision.id
  );
  if (!summaryExists) {
    frames = appendProviderContextFrame(
      frames,
      createConversationSummaryFrame({
        projectId: input.projectId,
        promptContractVersion: input.promptContractVersion,
        summaryRevision: input.summaryRevision
      }, frames)
    );
  }

  const hasProjectBaseline = frames.some(
    (frame) =>
      frame.kind === "projectState" &&
      frame.placement === "conversationBaseline" &&
      frame.summaryRevisionId === input.summaryRevision.id
  );
  if (!hasProjectBaseline) {
    frames = appendProviderContextFrame(
      frames,
      createProjectStateFrame(
        {
          workspace,
          projectId: input.projectId,
          promptContractVersion: input.promptContractVersion,
          framePlacement: "conversationBaseline",
          summaryRevisionId: input.summaryRevision.id
        },
        frames
      )
    );
  }

  const runtime = input.toolProfile && input.mode
    ? {
        mode: input.mode,
        toolProfile: input.toolProfile,
        promptContractVersion: input.promptContractVersion
      }
    : getLatestProviderRuntimeConfiguration(frames);
  const hasRuntimeBaseline = frames.some(
    (frame) =>
      frame.kind === "runtimeConfiguration" &&
      frame.placement === "conversationBaseline" &&
      frame.summaryRevisionId === input.summaryRevision.id
  );
  if (runtime && !hasRuntimeBaseline) {
    const runtimeFrame = createRuntimeConfigurationFrame(
      {
        projectId: input.projectId,
        promptContractVersion: runtime.promptContractVersion,
        mode: runtime.mode,
        toolProfile: runtime.toolProfile,
        framePlacement: "conversationBaseline",
        summaryRevisionId: input.summaryRevision.id
      },
      frames
    );
    if (runtimeFrame) {
      frames = appendProviderContextFrame(frames, runtimeFrame);
    }
  }

  return frames.length === previousFrames.length
    ? workspace
    : { ...workspace, ai: { ...workspace.ai, providerContextFrames: frames } };
}

export function appendAgentProviderRuntimeConfigurationFrame(
  workspace: MorphoWorkspace,
  input: {
    projectId: string;
    promptContractVersion: string;
    mode: MorphoAgentTurnMode;
    toolProfile: ProviderToolProfile;
    userMessageId?: string;
    framePlacement?: ProviderContextFramePlacement;
    summaryRevisionId?: string;
  }
): MorphoWorkspace {
  const frames = workspace.ai.providerContextFrames ?? [];
  const runtime = createRuntimeConfigurationFrame(input, frames);
  if (!runtime) {
    return workspace;
  }
  const nextFrames = appendProviderContextFrame(frames, runtime);
  return nextFrames.length === frames.length
    ? workspace
    : { ...workspace, ai: { ...workspace.ai, providerContextFrames: nextFrames } };
}

export function getLatestProviderRuntimeConfiguration(
  frames: readonly ProviderContextFrame[]
): ProviderRuntimeConfiguration | undefined {
  const latest = latestFrame(frames, "runtimeConfiguration");
  if (!latest) {
    return undefined;
  }
  const mode = latest.renderedText.match(/Agent 模式[:：]\s*(auto|confirm)/)?.[1] as MorphoAgentTurnMode | undefined;
  const toolProfile = latest.renderedText.match(
    /Provider Tool Profile[:：]\s*(standardWithWebSearch|standard)/
  )?.[1] as ProviderToolProfile | undefined;
  const promptContractVersion = latest.renderedText.match(/Prompt Contract[:：]\s*(\S+)/)?.[1];
  return mode && toolProfile && promptContractVersion
    ? { mode, toolProfile, promptContractVersion }
    : undefined;
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
  history: readonly {
    id?: string;
    role: "user" | "assistant";
    providerInputSnapshot?: ProviderInputSnapshot;
  }[],
  options: {
    currentPromptContractVersion?: string;
    currentToolProfile?: ProviderToolProfile;
    frames?: readonly ProviderContextFrame[];
    previousRequestState?: ProviderRequestBoundaryState;
    currentRequestState?: ProviderRequestBoundaryState;
  } = {}
): ProviderInputCacheBoundaryReason[] {
  const reasons = new Set<ProviderInputCacheBoundaryReason>();
  const latestUser = [...history].reverse().find((message) => message.role === "user");
  const current = options.currentRequestState;
  const previous = options.previousRequestState;
  const currentPromptContractVersion = current?.promptContractVersion ?? options.currentPromptContractVersion;
  const currentToolProfile = current?.toolProfile ?? options.currentToolProfile;
  const attachmentBoundary = current?.attachmentBoundary ?? latestUser?.providerInputSnapshot?.cacheBoundaryReason;
  const crossedIntoCurrentUser =
    !previous ||
    !current?.latestUserMessageId ||
    previous.latestUserMessageId !== current.latestUserMessageId;

  if (latestUser && !latestUser.providerInputSnapshot) {
    reasons.add("legacyProviderInput");
  }
  if (attachmentBoundary && crossedIntoCurrentUser) {
    reasons.add(attachmentBoundary);
  }
  if (
    latestUser?.providerInputSnapshot &&
    currentPromptContractVersion &&
    latestUser.providerInputSnapshot.promptContractVersion !== currentPromptContractVersion
  ) {
    reasons.add("promptContractChanged");
  }
  if (
    previous?.promptContractVersion &&
    currentPromptContractVersion &&
    previous.promptContractVersion !== currentPromptContractVersion
  ) {
    reasons.add("promptContractChanged");
  }
  const previousToolProfile = previous?.toolProfile ?? latestProviderToolProfile(options.frames ?? []);
  if (currentToolProfile && previousToolProfile && previousToolProfile !== currentToolProfile) {
    reasons.add("toolProfileChanged");
  }
  if (
    previous &&
    previous.summaryRevisionId !== current?.summaryRevisionId
  ) {
    reasons.add("compaction");
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
  input: Pick<ProviderContextFrameBuildInput, "workspace" | "projectId" | "promptContractVersion"> & {
    userMessageId?: string;
    framePlacement?: ProviderContextFramePlacement;
    summaryRevisionId?: string;
  },
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
    ...(input.framePlacement !== "conversationBaseline" && input.userMessageId
      ? { anchorMessageId: input.userMessageId }
      : {}),
    ...(input.summaryRevisionId ? { summaryRevisionId: input.summaryRevisionId } : {})
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
  input: Pick<ProviderContextFrameBuildInput, "projectId" | "promptContractVersion" | "mode"> & {
    toolProfile?: ProviderToolProfile;
    userMessageId?: string;
    framePlacement?: ProviderContextFramePlacement;
    summaryRevisionId?: string;
  },
  previousFrames: readonly ProviderContextFrame[]
): ProviderContextFrame | undefined {
  if (!input.toolProfile) {
    return undefined;
  }
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
    ...(input.framePlacement !== "conversationBaseline" && input.userMessageId
      ? { anchorMessageId: input.userMessageId }
      : {}),
    ...(input.summaryRevisionId ? { summaryRevisionId: input.summaryRevisionId } : {})
  });
}

function createConversationSummaryFrame(
  input: Pick<ProviderContextFrameBuildInput, "projectId" | "promptContractVersion"> & {
    summaryRevision: ConversationSummaryRevision;
  },
  previousFrames: readonly ProviderContextFrame[]
): ProviderContextFrame {
  const summary = input.summaryRevision.summary;
  return createProviderContextFrame({
    projectId: input.projectId,
    kind: "conversationSummary",
    createdAt: input.summaryRevision.createdAt,
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
    summaryRevisionId: input.summaryRevision.id
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

function latestProviderToolProfile(frames: readonly ProviderContextFrame[]): ProviderToolProfile | undefined {
  const latest = latestFrame(frames, "runtimeConfiguration");
  const profile = latest?.renderedText.match(
    /Provider Tool Profile[:：]\s*(standardWithWebSearch|standard)/
  )?.[1];
  return profile === "standard" || profile === "standardWithWebSearch" ? profile : undefined;
}

function extractDefaultReferenceObjectId(defaultReference: string): string | undefined {
  const match = defaultReference.match(/\(([A-Za-z0-9._:-]+)\)/);
  return match?.[1];
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export { buildProviderContextFrameTimeline, providerContextFrameMessage };
