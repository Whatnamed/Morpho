import {
  buildContinuousConversationContext,
  type ConversationTokenLimits
} from "@/domain/morpho/conversationCompaction";
import { buildAgentDefaultMemoryContext } from "@/domain/morpho/projectMemory";
import {
  createProviderInputSnapshot,
  hashProviderImageDataUrl
} from "@/domain/morpho/providerInputSnapshot";
import type {
  AiTaskMode,
  AiWorkIntent,
  MorphoObject,
  MorphoWorkspace,
  ProviderInputSnapshotTextPart
} from "@/domain/morpho/types";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import { createAgentContextBudgetState } from "@/shared/providerInputBudget";
import type {
  APlusAgentProviderMessage,
  APlusAgentProviderRequest,
  APlusAgentImagePart,
  APlusAgentTextPart
} from "@/shared/agentTurnJournalProtocol";
import {
  collectAiProviderImageAttachments,
  resolveAiProviderImageObjectIds,
  shouldAttachImagesForAiProvider
} from "./aiAttachments";
import { resolveTaskModeForSend, resolveWorkIntentForSend } from "./aiTaskRouting";
import { appendAgentTurnMessages, createAgentTurnWorkLedger } from "./agentTurnMessages";
import { createAgentTrace } from "./agentMessageTrace";
import { resolveRequiredAgentMemoryUpdates } from "./agentMemoryUpdateGuard";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import {
  createRequiredAgentReadState,
  resolveAgentTaskStrategy,
  resolveRequiredAgentReadRequirements
} from "./agentTaskStrategy";
import type { AgentToolExecutorInput } from "./agentToolExecutors";
import type { AgentTurnHost } from "./agentTurnHost";
import { createAgentTurnRuntimeState, type AgentTurnRuntimeState } from "./agentTurnRuntimeState";
import { buildDeliverySectionContext } from "./deliveryPreparationUi";
import { collectDocumentExtractsForAi } from "./documentContext";
import {
  buildMorphoAgentUserInput,
  isExplicitComparisonRequest,
  type MorphoAgentTurnMode
} from "./morphoAgent";
import {
  appendAgentProviderContextFrames,
  providerContextFrameMessage,
  type ProviderContextFrameBuildInput
} from "./providerContextFrames";
import { buildProviderTaskContext, buildTaskContext, type ProviderTaskContext, type TaskContextResult } from "./taskContext";
import type {
  APlusTurnRecoveryFacts,
  APlusTurnRecoveryRuntime
} from "./agentTurnRecoveryStore";

export type APlusAgentTurnDeliveryDraftTarget = {
  deliveryObjectId: string;
  sectionId: string;
};

export type RunMorphoAgentTurnAPlusInput = {
  draft: string;
  taskMode: AiTaskMode;
  recommendedTaskMode: AiTaskMode;
  workIntent: AiWorkIntent;
  recommendedWorkIntent: AiWorkIntent;
  selectedObjectIds: string[];
  selectedObjects: MorphoObject[];
  pendingDeliveryDraftTarget: APlusAgentTurnDeliveryDraftTarget | null;
  directionPreviewCount: number;
  agentTurnMode: MorphoAgentTurnMode;
  imageGenerationModelId: string;
  readConversationTokenLimits: () => ConversationTokenLimits | undefined;
};

export type PreparedAgentTurnAPlus = Readonly<{
  providerRequest: APlusAgentProviderRequest;
  localAgentTurnId: string;
  userMessageId: string;
  assistantMessageId: string;
  createdAt: string;
  executionTaskMode: AiTaskMode;
  executionWorkIntent: AiWorkIntent;
  context: TaskContextResult;
  providerTaskContext: ProviderTaskContext;
  runtimeState: AgentTurnRuntimeState;
  requiredMemoryUpdates: ReturnType<typeof resolveRequiredAgentMemoryUpdates>;
  deliverySectionContext?: AgentToolExecutorInput["deliverySectionContext"];
  imageAttachmentObjectIds: string[];
  documentExtractObjectIds: string[];
  allowStructuredComparison: boolean;
  controller: AbortController;
}>;

export function createEmptyAgentTurnRecoveryFacts(): APlusTurnRecoveryFacts {
  return {
    requiredReadState: {
      requiredTools: [],
      requirements: [],
      completedTools: [],
      failedTools: [],
      reminderInserted: false,
      repairAttempted: false,
      exhausted: false
    },
    collectedCitations: [],
    hasWebSearchEvidence: false,
    memoryUpdateReminderInserted: false,
    handledMemoryCandidateIndexes: [],
    memoryUpdateEntryIds: [],
    memoryUpdateKeys: [],
    stageRecordUpdateKeys: [],
    finalText: "",
    pendingConfirmationCreated: false,
    hasAgentToolResult: false
  };
}

export function snapshotAgentTurnRuntimeFacts(
  state: AgentTurnRuntimeState
): APlusTurnRecoveryFacts {
  return {
    requiredReadState: {
      requiredTools: [...state.requiredReadState.requiredTools],
      requirements: structuredClone(state.requiredReadState.requirements),
      completedTools: [...state.requiredReadState.completedTools],
      failedTools: [...state.requiredReadState.failedTools],
      reminderInserted: state.requiredReadState.reminderInserted,
      repairAttempted: state.requiredReadState.repairAttempted,
      exhausted: state.requiredReadState.exhausted
    },
    collectedCitations: structuredClone(state.collectedCitations),
    hasWebSearchEvidence: state.hasWebSearchEvidence,
    memoryUpdateReminderInserted: state.memoryUpdateReminderInserted,
    handledMemoryCandidateIndexes: [...state.handledMemoryCandidateIndexes],
    memoryUpdateEntryIds: [...state.memoryUpdateEntryIds],
    memoryUpdateKeys: [...state.memoryUpdateKeys],
    stageRecordUpdateKeys: [...state.stageRecordUpdateKeys],
    finalText: state.finalText,
    pendingConfirmationCreated: state.pendingConfirmationCreated,
    hasAgentToolResult: state.hasAgentToolResult
  };
}

export function restoreAgentTurnRuntimeFacts(
  state: AgentTurnRuntimeState,
  facts: APlusTurnRecoveryFacts
): void {
  state.requiredReadState = {
    requiredTools: [...facts.requiredReadState.requiredTools],
    requirements: [...structuredClone(facts.requiredReadState.requirements)],
    completedTools: new Set(facts.requiredReadState.completedTools),
    failedTools: new Set(facts.requiredReadState.failedTools),
    reminderInserted: facts.requiredReadState.reminderInserted,
    repairAttempted: facts.requiredReadState.repairAttempted,
    exhausted: facts.requiredReadState.exhausted
  };
  state.collectedCitations = [...structuredClone(facts.collectedCitations)];
  state.hasWebSearchEvidence = facts.hasWebSearchEvidence;
  state.memoryUpdateReminderInserted = facts.memoryUpdateReminderInserted;
  state.handledMemoryCandidateIndexes.clear();
  facts.handledMemoryCandidateIndexes.forEach((index) => state.handledMemoryCandidateIndexes.add(index));
  state.memoryUpdateEntryIds.clear();
  facts.memoryUpdateEntryIds.forEach((id) => state.memoryUpdateEntryIds.add(id));
  state.memoryUpdateKeys.clear();
  facts.memoryUpdateKeys.forEach((key) => state.memoryUpdateKeys.add(key));
  state.stageRecordUpdateKeys.clear();
  facts.stageRecordUpdateKeys.forEach((key) => state.stageRecordUpdateKeys.add(key));
  state.finalText = facts.finalText;
  state.pendingConfirmationCreated = facts.pendingConfirmationCreated;
  state.hasAgentToolResult = facts.hasAgentToolResult;
}

export async function prepareAgentTurnProductAPlus(
  input: RunMorphoAgentTurnAPlusInput,
  host: AgentTurnHost
): Promise<PreparedAgentTurnAPlus> {
  const workspace = host.readWorkspace();
  const executionTaskMode = input.pendingDeliveryDraftTarget
    ? "chatAnalysis"
    : resolveTaskModeForSend({
        currentTaskMode: input.taskMode,
        recommendedTaskMode: input.recommendedTaskMode
      });
  const executionWorkIntent = input.pendingDeliveryDraftTarget
    ? "prepareDeliverySection"
    : resolveWorkIntentForSend({
        currentWorkIntent: input.workIntent,
        recommendedWorkIntent: input.recommendedWorkIntent
      });
  const strategy = resolveAgentTaskStrategy({
    draft: input.draft,
    taskMode: executionTaskMode,
    workIntent: executionWorkIntent,
    selectedObjects: input.selectedObjects,
    workspace,
    hasDeliveryDraftTarget: Boolean(input.pendingDeliveryDraftTarget)
  });
  const context = buildTaskContext(workspace, {
    kind: strategy.contextKind,
    draft: input.draft,
    selectedObjectIds: input.pendingDeliveryDraftTarget ? [] : input.selectedObjectIds
  });
  const providerTaskContext = buildProviderTaskContext(context);
  const controller = new AbortController();
  const createdAt = new Date(host.now()).toISOString();
  const suffix = host.randomSuffix();
  const localAgentTurnId = `a-plus-turn-${host.now()}-${suffix}`;
  const userMessageId = `ai-user-a-plus-${host.now()}-${suffix}`;
  const assistantMessageId = `ai-assistant-a-plus-${host.now()}-${suffix}`;

  const attachmentResult = !input.pendingDeliveryDraftTarget && shouldAttachImagesForAiProvider({
    draft: input.draft,
    taskMode: executionTaskMode,
    selectedObjects: input.selectedObjects
  })
    ? await collectAiProviderImageAttachments(
        workspace,
        resolveAiProviderImageObjectIds({
          contextImageObjectIds: context.imageObjectIds,
          selectedObjects: input.selectedObjects
        }),
        controller.signal
      )
    : { attachments: [], skippedObjectIds: [], entries: [], warning: undefined };
  const documentResult = input.pendingDeliveryDraftTarget
    ? { extracts: [], skipped: [], warning: undefined }
    : await collectDocumentExtractsForAi(
        workspace,
        context.documentObjectIds,
        indexedDbBlobStore,
        controller.signal
      );

  const userInput = buildMorphoAgentUserInput({
    draft: input.draft,
    context,
    providerTaskContext
  });
  const providerInputTextParts: ProviderInputSnapshotTextPart[] = userInput.content
    .filter((part): part is { type: "input_text"; text: string } => part.type === "input_text")
    .map((part) => ({ kind: "userDraft" as const, text: part.text }));
  if (documentResult.extracts.length > 0) {
    const documentText = `本轮本地文档提取：\n${documentResult.extracts
      .map((extract) => `- ${extract.title}（${extract.objectId}）\n${extract.text.slice(0, 2_200)}`)
      .join("\n\n")}`;
    userInput.content.push({ type: "input_text", text: documentText });
    providerInputTextParts.push({ kind: "documentExtract", text: documentText });
  }
  attachmentResult.attachments
    .filter((attachment) => attachment.status === "ready")
    .forEach((attachment) => {
      userInput.content.push({ type: "input_image", image_url: attachment.dataUrl });
    });
  const providerInputSnapshot = createProviderInputSnapshot({
    message: userInput,
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
    textParts: providerInputTextParts,
    attachmentRefs: attachmentResult.entries
      .filter((entry) => entry.status === "ready")
      .map((entry) => {
        const object = workspace.objects[entry.objectId];
        const asset = object && "assetId" in object && object.assetId
          ? workspace.assets[object.assetId]
          : undefined;
        const attachment = attachmentResult.attachments.find((candidate) =>
          candidate.id === entry.attachmentId || candidate.objectIds?.includes(entry.objectId)
        );
        return {
          objectId: entry.objectId,
          ...(asset?.id ? { assetId: asset.id } : {}),
          ...(attachment?.dataUrl
            ? { contentHash: hashProviderImageDataUrl(attachment.dataUrl) }
            : {}),
          ...(attachment?.mimeType
            ? { mimeType: attachment.mimeType }
            : asset?.mimeType
              ? { mimeType: asset.mimeType }
              : {})
        };
      })
  });

  const initialTrace = { ...createAgentTrace(createdAt), agentTurnId: localAgentTurnId };
  host.commitWorkspace((current) => ({
    workspace: appendAgentTurnMessages(current, {
      userMessageId,
      assistantMessageId,
      userBody: input.draft,
      assistantBody: "",
      createdAt,
      contextObjectIds: context.objectIds,
      workIntent: executionWorkIntent,
      taskMode: executionTaskMode,
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      taskStrategy: strategy.kind,
      providerInputSnapshot,
      agentTurnId: localAgentTurnId,
      agentTrace: initialTrace
    }),
    value: undefined
  }));

  const conversationBeforeFrames = buildContinuousConversationContext({
    workspace: host.readWorkspace(),
    limits: input.readConversationTokenLimits()
  });
  const frameInput: ProviderContextFrameBuildInput = {
    workspace: host.readWorkspace(),
    projectId: workspace.project.id,
    strategy: strategy.kind,
    mode: input.agentTurnMode,
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
    userMessageId,
    context,
    providerTaskContext,
    defaultMemoryContext: buildAgentDefaultMemoryContext(host.readWorkspace(), strategy.kind),
    summaryRevision: conversationBeforeFrames.summaryRevision,
    framePlacement: "beforeUser",
    attachmentCount: attachmentResult.attachments.length,
    documentSnapshotAvailable: documentResult.skipped.length === 0
  };
  host.commitWorkspace((current) => ({
    workspace: appendAgentProviderContextFrames(current, { ...frameInput, workspace: current }),
    value: undefined
  }));
  const preparedWorkspace = host.readWorkspace();
  const conversation = buildContinuousConversationContext({
    workspace: preparedWorkspace,
    limits: input.readConversationTokenLimits()
  });
  const history = conversation.messages
    .filter((message) => message.id !== userMessageId)
    .map<APlusAgentProviderMessage>((message) => ({
      role: message.role,
      content: [{
        type: message.role === "assistant" ? "output_text" : "input_text",
        text: message.body
      }]
    }));
  const frameMessages = (preparedWorkspace.ai.providerContextFrames ?? [])
    .slice(-24)
    .map(providerContextFrameMessage)
    .flatMap(toAPlusMessage);
  const currentUserMessage = toAPlusMessage(userInput);
  const providerMessages = [...frameMessages, ...history, ...currentUserMessage].slice(-96);

  host.abortSlot.set(controller);
  host.ui.setStreaming(true);
  host.ui.setDraft("");
  host.ui.setTaskMode("chatAnalysis");
  host.ui.openConversation();
  host.ui.setContextWarning(
    [
      context.defaultReference.status === "hidden" ? context.defaultReference.reason : "",
      attachmentResult.warning,
      documentResult.warning
    ].filter(Boolean).join(" ") || undefined
  );

  const requiredMemoryUpdates = resolveRequiredAgentMemoryUpdates(input.draft);
  const runtimeState = createAgentTurnRuntimeState({
    conversationContext: {
      ...(conversation.summaryRevision ? { summaryRevision: conversation.summaryRevision } : {}),
      messages: conversation.messages,
      rawMessageCount: conversation.totalUsableMessageCount,
      coveredMessageCount: conversation.coveredMessageCount,
      estimatedInputTokens: conversation.estimatedInputTokens,
      pressure: conversation.pressure
    },
    conversationInput: providerMessages,
    requiredReadState: createRequiredAgentReadState(
      resolveRequiredAgentReadRequirements(input.draft, {
        hasSelectedObject: input.selectedObjectIds.length > 0
      })
    ),
    contextBudgetState: createAgentContextBudgetState(conversation.estimatedInputTokens),
    agentWorkLedger: createAgentTurnWorkLedger()
  });
  const deliveryCandidate = input.pendingDeliveryDraftTarget
    ? preparedWorkspace.objects[input.pendingDeliveryDraftTarget.deliveryObjectId]
    : undefined;
  const deliverySectionContext = deliveryCandidate?.type === "delivery" && input.pendingDeliveryDraftTarget
    ? buildDeliverySectionContext(
        preparedWorkspace,
        deliveryCandidate,
        input.pendingDeliveryDraftTarget.sectionId
      )
    : undefined;

  return {
    providerRequest: {
      input: providerMessages,
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      mode: input.agentTurnMode,
      capabilityIntent: { comparisonAnalysis: isExplicitComparisonRequest(input.draft) }
    },
    localAgentTurnId,
    userMessageId,
    assistantMessageId,
    createdAt,
    executionTaskMode,
    executionWorkIntent,
    context,
    providerTaskContext,
    runtimeState,
    requiredMemoryUpdates,
    ...(deliverySectionContext ? { deliverySectionContext } : {}),
    imageAttachmentObjectIds: attachmentResult.entries
      .filter((entry) => entry.status === "ready")
      .map((entry) => entry.objectId),
    documentExtractObjectIds: documentResult.extracts.map((extract) => extract.objectId),
    allowStructuredComparison: isExplicitComparisonRequest(input.draft),
    controller
  };
}

/**
 * Rebuilds only the local execution adapters needed after a page refresh.
 * It deliberately does not append messages, recollect attachments, or mutate
 * Provider input; the exact original Provider contract lives in RecoveryStore.
 */
export function restorePreparedAgentTurnProductAPlus(
  runtime: APlusTurnRecoveryRuntime,
  host: AgentTurnHost
): Readonly<{
  input: RunMorphoAgentTurnAPlusInput;
  prepared: PreparedAgentTurnAPlus;
}> {
  const workspace = host.readWorkspace();
  const userMessageId = findTurnMessageId(workspace, runtime.localAgentTurnId, "user");
  const assistantMessageId = findTurnMessageId(workspace, runtime.localAgentTurnId, "assistant");
  const selectedObjects = runtime.input.selectedObjectIds
    .map((objectId) => workspace.objects[objectId])
    .filter((object): object is MorphoObject => Boolean(object));
  const turnInput: RunMorphoAgentTurnAPlusInput = {
    draft: runtime.input.draft,
    taskMode: runtime.input.taskMode,
    recommendedTaskMode: runtime.input.recommendedTaskMode,
    workIntent: runtime.input.workIntent,
    recommendedWorkIntent: runtime.input.recommendedWorkIntent,
    selectedObjectIds: [...runtime.input.selectedObjectIds],
    selectedObjects,
    pendingDeliveryDraftTarget: runtime.input.pendingDeliveryDraftTarget
      ? { ...runtime.input.pendingDeliveryDraftTarget }
      : null,
    directionPreviewCount: runtime.input.directionPreviewCount,
    agentTurnMode: runtime.input.agentTurnMode,
    imageGenerationModelId: runtime.input.imageGenerationModelId,
    readConversationTokenLimits: () => runtime.input.conversationTokenLimits
  };
  const strategy = resolveAgentTaskStrategy({
    draft: turnInput.draft,
    taskMode: runtime.executionTaskMode,
    workIntent: runtime.executionWorkIntent,
    selectedObjects,
    workspace,
    hasDeliveryDraftTarget: Boolean(turnInput.pendingDeliveryDraftTarget)
  });
  const context = buildTaskContext(workspace, {
    kind: strategy.contextKind,
    draft: turnInput.draft,
    selectedObjectIds: turnInput.pendingDeliveryDraftTarget
      ? []
      : turnInput.selectedObjectIds
  });
  const providerTaskContext = buildProviderTaskContext(context);
  const conversation = buildContinuousConversationContext({
    workspace,
    limits: runtime.input.conversationTokenLimits
  });
  const controller = new AbortController();
  const runtimeState = createAgentTurnRuntimeState({
    conversationContext: {
      ...(conversation.summaryRevision ? { summaryRevision: conversation.summaryRevision } : {}),
      messages: conversation.messages,
      rawMessageCount: conversation.totalUsableMessageCount,
      coveredMessageCount: conversation.coveredMessageCount,
      estimatedInputTokens: conversation.estimatedInputTokens,
      pressure: conversation.pressure
    },
    conversationInput: [...runtime.providerBaseRequest.input],
    requiredReadState: createRequiredAgentReadState(
      resolveRequiredAgentReadRequirements(turnInput.draft, {
        hasSelectedObject: turnInput.selectedObjectIds.length > 0
      })
    ),
    contextBudgetState: createAgentContextBudgetState(conversation.estimatedInputTokens),
    agentWorkLedger: createAgentTurnWorkLedger()
  });
  restoreAgentTurnRuntimeFacts(runtimeState, runtime.facts);
  const deliveryCandidate = turnInput.pendingDeliveryDraftTarget
    ? workspace.objects[turnInput.pendingDeliveryDraftTarget.deliveryObjectId]
    : undefined;
  const deliverySectionContext = deliveryCandidate?.type === "delivery" && turnInput.pendingDeliveryDraftTarget
    ? buildDeliverySectionContext(
        workspace,
        deliveryCandidate,
        turnInput.pendingDeliveryDraftTarget.sectionId
      )
    : undefined;

  host.abortSlot.set(controller);
  host.ui.setStreaming(true);
  host.ui.openConversation();
  const prepared: PreparedAgentTurnAPlus = {
    providerRequest: runtime.providerBaseRequest,
    localAgentTurnId: runtime.localAgentTurnId,
    userMessageId,
    assistantMessageId,
    createdAt: runtime.createdAt,
    executionTaskMode: runtime.executionTaskMode,
    executionWorkIntent: runtime.executionWorkIntent,
    context,
    providerTaskContext,
    runtimeState,
    requiredMemoryUpdates: resolveRequiredAgentMemoryUpdates(turnInput.draft),
    ...(deliverySectionContext ? { deliverySectionContext } : {}),
    imageAttachmentObjectIds: [...runtime.imageAttachmentObjectIds],
    documentExtractObjectIds: [...runtime.documentExtractObjectIds],
    allowStructuredComparison: runtime.allowStructuredComparison,
    controller
  };
  return { input: turnInput, prepared };
}

function findTurnMessageId(
  workspace: MorphoWorkspace,
  agentTurnId: string,
  role: "user" | "assistant"
): string {
  const messageId = workspace.ai.messages.find((message) =>
    message.agentTurnId === agentTurnId && message.role === role
  )?.id;
  if (!messageId) {
    throw new Error(`A+ Recovery 缺少 ${role} Message，不能伪造恢复引用。`);
  }
  return messageId;
}

function toAPlusMessage(value: unknown): APlusAgentProviderMessage[] {
  if (!isRecord(value) || (value.role !== "user" && value.role !== "assistant") || !Array.isArray(value.content)) {
    return [];
  }
  const content: Array<APlusAgentTextPart | APlusAgentImagePart> = [];
  value.content.forEach((part) => {
    if (!isRecord(part)) return;
    if (
      (part.type === "input_text" || part.type === "output_text") &&
      typeof part.text === "string"
    ) {
      content.push({ type: part.type, text: part.text });
      return;
    }
    if (part.type === "input_image" && typeof part.image_url === "string") {
      content.push({ type: "input_image", image_url: part.image_url });
    }
  });
  return content.length > 0 ? [{ role: value.role, content }] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
