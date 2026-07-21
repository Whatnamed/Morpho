import type {
  AgentTaskStrategyKind,
  MorphoWorkspace,
  ProviderContextFrame,
  ProviderContextFrameSourceRef,
  ConversationSummaryRevision
} from "@/domain/morpho/types";
import {
  appendProviderContextFrame,
  buildProviderContextFrameTimeline,
  createProviderContextFrame,
  providerContextFrameMessage
} from "@/domain/morpho/providerContextFrame";
import type { ResponseMessageInput } from "@/server/ai/openaiCompatibleProvider";
import type { TaskContextResult, ProviderTaskContext } from "./taskContext";
import type { MorphoAgentTurnMode } from "./morphoAgent";
import { buildAgentDefaultMemoryPromptBlock } from "./morphoAgent";
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
};

export function appendAgentProviderContextFrames(
  workspace: MorphoWorkspace,
  input: ProviderContextFrameBuildInput
): MorphoWorkspace {
  const previousFrames = workspace.ai.providerContextFrames ?? [];
  const next = appendAgentProviderStateFrames(workspace, input);
  const previousAfterState = next.ai.providerContextFrames ?? [];
  const turnContext = createTurnContextFrame(input);
  const summary = input.summaryRevision ? createConversationSummaryFrame(input) : undefined;
  const additions = [...(previousAfterState.slice(previousFrames.length)), ...(summary ? [summary] : []), turnContext];
  const nextFrames = additions.reduce(
    (frames, frame) => appendProviderContextFrame(frames, frame),
    previousAfterState
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
    previousFrames
  );
  return nextFrames.length === previousFrames.length
    ? workspace
    : { ...workspace, ai: { ...workspace.ai, providerContextFrames: nextFrames } };
}

export function buildAgentProviderInput(input: {
  stableSystemPrompt: string;
  frames: readonly ProviderContextFrame[];
  history: Array<{ id: string; role: "user" | "assistant"; body: string }>;
  currentUserMessageId: string;
  userInput: ResponseMessageInput;
}): ResponseMessageInput[] {
  const activeMessageIds = new Set(input.history.map((message) => message.id));
  activeMessageIds.add(input.currentUserMessageId);
  const frames = buildProviderContextFrameTimeline({
    frames: input.frames,
    activeMessageIds
  });
  const messages: ResponseMessageInput[] = [
    {
      role: "system",
      content: [{ type: "input_text", text: input.stableSystemPrompt }]
    }
  ];
  const leadingFrames = frames.filter((frame) => !frame.anchorMessageId);
  leadingFrames.forEach((frame) => messages.push(providerContextFrameMessage(frame)));
  const framesByAnchor = new Map<string, ProviderContextFrame[]>();
  for (const frame of frames) {
    if (!frame.anchorMessageId) {
      continue;
    }
    const anchored = framesByAnchor.get(frame.anchorMessageId) ?? [];
    anchored.push(frame);
    framesByAnchor.set(frame.anchorMessageId, anchored);
  }
  for (const message of input.history) {
    framesByAnchor.get(message.id)?.forEach((frame) => messages.push(providerContextFrameMessage(frame)));
    messages.push({
      role: message.role,
      content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: message.body }]
    });
  }
  framesByAnchor.get(input.currentUserMessageId)?.forEach((frame) => messages.push(providerContextFrameMessage(frame)));
  messages.push(input.userInput);
  return messages;
}

function createProjectStateFrame(
  input: ProviderContextFrameBuildInput,
  previousFrames: readonly ProviderContextFrame[]
): ProviderContextFrame {
  const memoryRevisionIds = input.defaultMemoryContext.documents
    .map((document) => document.revisionId)
    .filter((id): id is string => Boolean(id))
    .sort();
  const stageRevisionIds = input.defaultMemoryContext.stageRecords
    .map((record) => record.revisionId)
    .filter((id): id is string => Boolean(id))
    .sort();
  const directionRevisionIds = input.providerTaskContext.directions.map((direction) => direction.revisionId).sort();
  const previous = latestFrame(previousFrames, "projectState");
  return createProviderContextFrame({
    projectId: input.projectId,
    kind: "projectState",
    createdAt: new Date().toISOString(),
    promptContractVersion: input.promptContractVersion,
    projectMemoryRevisionIds: memoryRevisionIds,
    stageRecordRevisionIds: stageRevisionIds,
    designDefinitionRevisionId: input.providerTaskContext.designDefinition?.revisionId,
    directionRevisionIds,
    defaultReferenceObjectId: extractDefaultReferenceObjectId(input.providerTaskContext.defaultReference),
    selectedObjectIds: [],
    relatedObjectIds: uniqueIds([
      ...(input.providerTaskContext.designDefinition?.sourceObjectIds ?? []),
      ...input.providerTaskContext.directions.flatMap((direction) => direction.sourceObjectIds)
    ]),
    renderedText: [
      `项目：${input.workspace.project.title}`,
      `当前工作重点：${input.providerTaskContext.projectContinuity.currentFocus.note}`,
      buildAgentDefaultMemoryPromptBlock(input.defaultMemoryContext),
      input.providerTaskContext.designDefinition
        ? `当前设计定义：${input.providerTaskContext.designDefinition.title}（${input.providerTaskContext.designDefinition.summary}）`
        : "当前没有已应用设计定义。",
      input.providerTaskContext.directions.length > 0
        ? `当前相关方向：${input.providerTaskContext.directions.map((direction) => `${direction.title}：${direction.summary}`).join("；")}`
        : "当前没有相关方向。",
      `当前默认参考：${input.providerTaskContext.defaultReference}`
    ].join("\n"),
    supersedesFrameId: previous?.id,
    sourceRefs: buildSourceRefs(memoryRevisionIds, stageRevisionIds, input.providerTaskContext),
    reason: "项目结构化状态或默认上下文发生变化",
    anchorMessageId: input.userMessageId
  });
}

function createTurnContextFrame(input: ProviderContextFrameBuildInput): ProviderContextFrame {
  const selected = [...input.context.semanticSummaries]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((summary) => `${summary.title}（${summary.id}）：${summary.summary}`);
  const relatedIds = uniqueIds([
    ...input.context.objectIds,
    ...input.context.documentObjectIds,
    ...input.context.imageObjectIds,
    ...input.context.visualBranches.map((branch) => branch.id)
  ]);
  return createProviderContextFrame({
    projectId: input.projectId,
    kind: "turnContext",
    createdAt: new Date().toISOString(),
    promptContractVersion: input.promptContractVersion,
    taskStrategy: input.strategy,
    projectMemoryRevisionIds: [],
    stageRecordRevisionIds: [],
    directionRevisionIds: input.context.directionRevisions.map((revision) => revision.id).sort(),
    defaultReferenceObjectId: extractDefaultReferenceObjectId(input.providerTaskContext.defaultReference),
    selectedObjectIds: [...input.context.objectIds].sort(),
    relatedObjectIds: relatedIds,
    renderedText: [
      `本轮任务策略：${input.strategy}`,
      `操作模式：${input.mode}`,
      `本轮范围：${input.context.scopeNote}`,
      `本轮默认参考授权：${input.context.defaultReference.reason}`,
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
    promptContractVersion: input.promptContractVersion,
    taskStrategy: input.strategy,
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

function createConversationSummaryFrame(input: ProviderContextFrameBuildInput): ProviderContextFrame {
  const summary = input.summaryRevision!.summary;
  return createProviderContextFrame({
    projectId: input.projectId,
    kind: "conversationSummary",
    createdAt: new Date().toISOString(),
    promptContractVersion: input.promptContractVersion,
    taskStrategy: input.strategy,
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
    anchorMessageId: input.userMessageId
  });
}

function buildSourceRefs(
  memoryRevisionIds: readonly string[],
  stageRevisionIds: readonly string[],
  context: ProviderTaskContext
): ProviderContextFrameSourceRef[] {
  return [
    ...memoryRevisionIds.map((id) => ({ kind: "projectMemoryRevision", id })),
    ...stageRevisionIds.map((id) => ({ kind: "stageRecordRevision", id })),
    ...(context.designDefinition ? [{ kind: "designDefinitionRevision", id: context.designDefinition.revisionId }] : []),
    ...context.directions.map((direction) => ({ kind: "directionRevision", id: direction.revisionId }))
  ];
}

function latestFrame(
  frames: readonly ProviderContextFrame[],
  kind: ProviderContextFrame["kind"]
): ProviderContextFrame | undefined {
  return [...frames].reverse().find((frame) => frame.kind === kind);
}

function extractDefaultReferenceObjectId(defaultReference: string): string | undefined {
  const match = defaultReference.match(/\(([A-Za-z0-9._:-]+)\)/);
  return match?.[1];
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export { buildProviderContextFrameTimeline, providerContextFrameMessage };
