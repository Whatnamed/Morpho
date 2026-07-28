import { MORPHO_AGENT_CONTEXT_POLICY } from "@/domain/morpho/agentContextPolicy";
import {
  applyConversationSummaryRevision,
  buildContinuousConversationContext,
  buildConversationCompactionPlan,
  classifyConversationPressure,
  sanitizeConversationSummaryStreamForDisplay,
  type ConversationTokenLimits
} from "@/domain/morpho/conversationCompaction";
import {
  buildConversationLaneKey,
  resolveConversationLaneAnchors,
  sanitizeConversationAssistantStreamForDisplay
} from "@/domain/morpho/conversationCheckpoint";
import { buildAgentDefaultMemoryContext } from "@/domain/morpho/projectMemory";
import { createProviderInputSnapshot } from "@/domain/morpho/providerInputSnapshot";
import type {
  AiTaskMode,
  AiWorkIntent,
  MorphoObject,
  ProviderInputSnapshotTextPart
} from "@/domain/morpho/types";
import { compileVisualGenerationPlan } from "@/domain/operations/imagePromptCompiler";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import { createAgentContextBudgetState } from "@/shared/providerInputBudget";
import { hashAgentProviderItems } from "@/shared/agentCompactionProtocol";
import {
  collectAiProviderImageAttachments,
  resolveAiProviderImageObjectIds,
  shouldAttachImagesForAiProvider
} from "./aiAttachments";
import {
  resolveTaskModeForSend,
  resolveWorkIntentForSend
} from "./aiTaskRouting";
import { storeMessageCitations, updateAiMessage } from "./aiConversationMessages";
import {
  buildPendingAgentActionConfirmation,
  buildRequestedAgentActionConfirmation
} from "./agentConfirmation";
import {
  finishAgentToolActivityInWorkspace,
  finishLocalAgentToolActivity,
  createAgentTrace,
  startLocalAgentToolActivity
} from "./agentMessageTrace";
import {
  resolveRequiredAgentMemoryUpdates,
  shouldPromptForMemoryUpdate
} from "./agentMemoryUpdateGuard";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import { AgentTurnStreamError } from "./agentStreamClient";
import {
  advanceRequiredAgentReadState,
  buildRequiredAgentReadFailureNotice,
  createRequiredAgentReadState,
  failRequiredAgentRead,
  resolveAgentTaskStrategy,
  resolveRequiredAgentReadRequirements,
  type RequiredAgentReadToolName
} from "./agentTaskStrategy";
import {
  executeAgentTool,
  type AgentToolBatchState,
  type AgentToolExecutorInput
} from "./agentToolExecutors";
import { buildAgentToolActivityDescriptor, sanitizeAgentActivityDetail } from "./agentToolActivity";
import type { AgentTurnHost } from "./agentTurnHost";
import {
  closeAgentTurnLease as closeAgentTurnLeaseWithState,
  AgentWebSearchLeaseRecoveryError,
  requestAgentWebSearch as requestAgentWebSearchWithLease,
  requestConversationSummary
} from "./agentTurnLeaseClient";
import {
  assertAgentTurnActive,
  buildAgentEmergencyFinalizationRequest,
  completeUnresolvedAgentFunctionCalls,
  isRepeatedAgentToolCall,
  mergeAgentSearchCitations,
  normalizeAgentTurnErrorMessage,
  shouldFinalizeAgentTurn
} from "./agentTurnLimits";
import {
  appendAgentTurnMessages,
  createAgentTurnWorkLedger,
  finalizeAgentTurn,
  resolveAgentTurnOutcome
} from "./agentTurnMessages";
import { createAgentTurnRuntimeState, createAgentTurnState } from "./agentTurnState";
import {
  createAgentTurnProviderRequestAdapter,
  AgentContextCompactionError,
  buildAgentCompactionContextMarkers,
  buildAgentCompactionFreshContextFrames,
  estimateAgentTurnProviderBudget,
  rebuildAgentPostCompactionTranscript
} from "./agentTurnProviderRequest";
import {
  buildMorphoAgentToolArgumentRepairOutputs,
  buildMorphoAgentStableSystemPrompt,
  buildMorphoAgentTools,
  buildMorphoAgentUserInput,
  buildToolResultOutput,
  isExplicitComparisonRequest,
  normalizeGenerateVisualsForSelectedDirections,
  parseMorphoAgentToolCallBatch,
  resolveAgentToolExecutionPolicy,
  type AgentRouteResult,
  type MorphoAgentTurnMode
} from "./morphoAgent";
import {
  appendAgentProviderContextFrames,
  buildAgentProviderInput,
  compactHistoricalProviderRequestState,
  ensureAgentConversationSummaryBaselines,
  getLatestProviderRequestState,
  type ProviderContextFrameBuildInput
} from "./providerContextFrames";
import { buildDeliverySectionContext } from "./deliveryPreparationUi";
import { collectDocumentExtractsForAi } from "./documentContext";
import { buildAgentVisualGenerationBatch, resolveExpectedVisualGenerationCount } from "./agentVisualGenerationBatch";
import { buildProviderTaskContext, buildTaskContext } from "./taskContext";
import { buildConversationCompactionTailItems } from "./conversationSummaryAgentRequest";

const MAX_AGENT_TOOL_ARGUMENT_REPAIR_ATTEMPTS = 3;

export type AgentTurnDeliveryDraftTarget = {
  deliveryObjectId: string;
  sectionId: string;
};

export type RunMorphoAgentTurnInput = {
  draft: string;
  taskMode: AiTaskMode;
  recommendedTaskMode: AiTaskMode;
  workIntent: AiWorkIntent;
  recommendedWorkIntent: AiWorkIntent;
  selectedObjectIds: string[];
  selectedObjects: MorphoObject[];
  pendingDeliveryDraftTarget: AgentTurnDeliveryDraftTarget | null;
  directionPreviewCount: number;
  agentTurnMode: MorphoAgentTurnMode;
  imageGenerationModelId: string;
  readConversationTokenLimits: () => ConversationTokenLimits | undefined;
};

export async function runMorphoAgentTurn(
  input: RunMorphoAgentTurnInput,
  host: AgentTurnHost
): Promise<void> {
  const {
    draft,
    taskMode,
    recommendedTaskMode,
    workIntent,
    recommendedWorkIntent,
    selectedObjectIds,
    selectedObjects,
    pendingDeliveryDraftTarget,
    directionPreviewCount,
    agentTurnMode,
    imageGenerationModelId,
    readConversationTokenLimits
  } = input;
  const workspace = host.readWorkspace();
  const commitWorkspaceNow = host.commitWorkspace;
  const readWorkspaceNow = host.readWorkspace;
  const executeAgentVisualGenerationPlan = host.executeVisualGenerationPlan;
  const fetch = host.fetch;
  const effectiveImageGenerationSettings = { modelId: imageGenerationModelId };
  const setContextWarning = host.ui.setContextWarning;
  const setIsAiStreaming = host.ui.setStreaming;
  const setAiDraft = host.ui.setDraft;
  const setTaskMode = host.ui.setTaskMode;
  const setPendingConfirmation = host.ui.setPendingConfirmation;
  const setSelectedObjectIds = host.ui.selectObjects;
  const setActiveProposalId = host.ui.openProposal;
  const setPendingDeliveryDraftTarget = (_value: null) =>
    host.ui.clearPendingDeliveryDraftTarget();
  const setAiOpen = (open: boolean) => {
    if (open) {
      host.ui.openConversation();
    }
  };
  const setShowFailure = (visible: boolean) => {
    if (visible) {
      host.ui.showFailure();
    }
  };
  const abortControllerRef = {
    get current() {
      return host.abortSlot.get();
    },
    set current(value: AbortController | null) {
      host.abortSlot.set(value);
    }
  };
  const agentStreamFlushRef = {
    get current() {
      return host.streamFlushSlot.get();
    },
    set current(value: (() => void) | null) {
      host.streamFlushSlot.set(value);
    }
  };

  const executionTaskMode = pendingDeliveryDraftTarget
    ? "chatAnalysis"
    : resolveTaskModeForSend({ currentTaskMode: taskMode, recommendedTaskMode });
  const executionWorkIntent = pendingDeliveryDraftTarget
    ? "prepareDeliverySection"
    : resolveWorkIntentForSend({
        currentWorkIntent: workIntent,
        recommendedWorkIntent
      });
  const strategy = resolveAgentTaskStrategy({
    draft,
    taskMode: executionTaskMode,
    workIntent: executionWorkIntent,
    selectedObjects,
    workspace,
    hasDeliveryDraftTarget: Boolean(pendingDeliveryDraftTarget)
  });
  const selectedDirectionCount = selectedObjects.filter((object) => object.type === "conceptDirection").length;
  const directionPreviewCountContract =
    strategy.kind === "directionPreview"
      ? resolveExpectedVisualGenerationCount({
          draft,
          kind: "directionPreview",
          selectedDirectionCount,
          defaultPreviewCount: directionPreviewCount
        })
      : undefined;
  const context = buildTaskContext(workspace, {
    kind: strategy.contextKind,
    draft,
    selectedObjectIds: pendingDeliveryDraftTarget ? [] : selectedObjectIds
  });
  const providerTaskContext = buildProviderTaskContext(context);
  const deliveryCandidate = pendingDeliveryDraftTarget
    ? workspace.objects[pendingDeliveryDraftTarget.deliveryObjectId]
    : undefined;
  const deliveryObject = deliveryCandidate?.type === "delivery" ? deliveryCandidate : undefined;
  const deliverySectionContext =
    deliveryObject && pendingDeliveryDraftTarget
      ? buildDeliverySectionContext(workspace, deliveryObject, pendingDeliveryDraftTarget.sectionId)
      : undefined;
  if (pendingDeliveryDraftTarget && !deliverySectionContext) {
    setContextWarning("请先选择一个至少包含一项交付引用的章节，再生成本节说明草稿。");
    setPendingDeliveryDraftTarget(null);
    return;
  }

  const conversationLaneAnchors = resolveConversationLaneAnchors(
    workspace,
    pendingDeliveryDraftTarget ? [] : selectedObjectIds
  );
  const conversationLaneKey = buildConversationLaneKey({
    currentFocus: workspace.projectContinuity.currentFocus,
    taskKind: context.kind,
    anchorObjectIds: conversationLaneAnchors.anchorObjectIds,
    targetDirectionIds: conversationLaneAnchors.targetDirectionIds,
    visualBranchId: conversationLaneAnchors.visualBranchId
  });
  const controller = new AbortController();
  const now = new Date(host.now()).toISOString();
  const userMessageId = `ai-user-agent-${host.now()}`;
  const assistantMessageId = `ai-assistant-agent-${host.now()}`;

  const attachmentResult = !pendingDeliveryDraftTarget && shouldAttachImagesForAiProvider({
    draft,
    taskMode: executionTaskMode,
    selectedObjects
  })
    ? await collectAiProviderImageAttachments(
        workspace,
        resolveAiProviderImageObjectIds({
          contextImageObjectIds: context.imageObjectIds,
          selectedObjects
        }),
        controller.signal
      )
    : { attachments: [], skippedObjectIds: [], entries: [], warning: undefined };
  const documentResult = pendingDeliveryDraftTarget
    ? { extracts: [], skipped: [], warning: undefined }
    : await collectDocumentExtractsForAi(
        workspace,
        context.documentObjectIds,
        indexedDbBlobStore,
          controller.signal
        );
  const conversationTokenLimits = readConversationTokenLimits();
  const directionContractText = directionPreviewCountContract?.source === "default"
    ? `本轮界面数量选择：${selectedDirectionCount} 个方向，每方向 ${directionPreviewCountContract.requestedPreviewCount} 张，共 ${directionPreviewCountContract.totalItems} 张。`
    : undefined;
  const documentSnapshotText = documentResult.extracts.length > 0
    ? `本轮本地文档提取：\n${documentResult.extracts
        .map((extract) => `- ${extract.title}（${extract.objectId}）\n${extract.text.slice(0, 2200)}`)
        .join("\n\n")}`
    : undefined;
  const userInput = buildMorphoAgentUserInput({
    draft,
    context,
    providerTaskContext
  });
  const providerInputTextParts: ProviderInputSnapshotTextPart[] = userInput.content
    .filter((part): part is { type: "input_text"; text: string } => part.type === "input_text")
    .map((part) => ({ kind: "userDraft" as const, text: part.text }));
  if (directionContractText) {
    userInput.content.push({ type: "input_text", text: directionContractText });
    providerInputTextParts.push({ kind: "turnContract", text: directionContractText });
  }
  if (documentSnapshotText) {
    userInput.content.push({ type: "input_text", text: documentSnapshotText });
    providerInputTextParts.push({ kind: "documentExtract", text: documentSnapshotText });
  }
  attachmentResult.attachments
    .filter((attachment) => attachment.status === "ready")
    .forEach((attachment) => {
      userInput.content.push({
        type: "input_image",
        image_url: attachment.dataUrl
      });
    });
  const providerInputSnapshot = createProviderInputSnapshot({
    message: userInput,
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
    textParts: providerInputTextParts,
    attachmentRefs: attachmentResult.entries
      .filter((entry) => entry.status === "ready")
      .map((entry) => {
        const object = workspace.objects[entry.objectId];
        const asset = object && "assetId" in object && object.assetId ? workspace.assets[object.assetId] : undefined;
        return {
          objectId: entry.objectId,
          ...(asset?.id ? { assetId: asset.id } : {}),
          ...(asset?.mimeType ? { mimeType: asset.mimeType } : {})
        };
      }),
    ...(attachmentResult.attachments.length > 0
      ? { cacheBoundaryReason: "imageInput" as const }
      : documentResult.skipped.length > 0
        ? { cacheBoundaryReason: "documentSnapshotUnavailable" as const }
        : {})
  });

  abortControllerRef.current = controller;
  setIsAiStreaming(true);
  setAiDraft("");
  setTaskMode("chatAnalysis");
  setAiOpen(true);
  setContextWarning(
    [
      context.defaultReference.status === "hidden" ? context.defaultReference.reason : "",
      attachmentResult.warning,
      documentResult.warning
    ]
      .filter(Boolean)
      .join(" ") || undefined
  );
  const agentTurnId = `agent-turn-${host.now()}-${host.randomSuffix()}`;
  const turnState = createAgentTurnState(workspace);
  // Signed proof of the previous Provider response. Every continuation in this
  // turn has to return it so the server can verify the transcript is really its
  // own output rather than something the client assembled.
  // A compaction rebuilds the transcript, so the next request is a fresh one even
  // though the turn continues. Claiming exact continuation there would be a lie.
  // Web search consumes a lease sequence before it can fail. One resynchronization
  // per turn lets a lost response recover; Provider continuations stay strict.

  const requestAgentWebSearch = (queries: string[]) =>
    requestAgentWebSearchWithLease({
      queries,
      agentTurnId,
      signal: controller.signal,
      state: turnState,
      fetch
    });

  async function closeAgentTurnLease(
    outcome: "success" | "cancelledBeforeExecution" | "failedBeforeExecution" | "partialSuccess" | "pendingConfirmation"
  ): Promise<void> {
    await closeAgentTurnLeaseWithState({ state: turnState, agentTurnId, outcome, fetch });
  }

  const initialAgentTrace = {
    ...createAgentTrace(now),
    agentTurnId
  };
  turnState.workspaceAtAgentStart = commitWorkspaceNow((current) => {
    const next = appendAgentTurnMessages(current, {
      userMessageId,
      assistantMessageId,
      userBody: draft,
      assistantBody: "",
      createdAt: now,
      contextObjectIds: context.objectIds,
      conversationLaneKey,
      workIntent: executionWorkIntent,
      taskMode: executionTaskMode,
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      taskStrategy: strategy.kind,
      providerInputSnapshot,
      agentTurnId,
      agentTrace: initialAgentTrace
    });
    return { workspace: next, value: next };
  });
  const outputTokenReserve = conversationTokenLimits?.responseReserveTokens ?? MORPHO_AGENT_CONTEXT_POLICY.responseReserveTokens;
  const stableSystemPrompt = buildMorphoAgentStableSystemPrompt();
  turnState.latestProviderRequestState = getLatestProviderRequestState(turnState.workspaceAtAgentStart);
  turnState.canonicalRuntimeItem = turnState.latestProviderRequestState?.runtimeItem;
  const preCompactionConversation = buildContinuousConversationContext({
    workspace: turnState.workspaceAtAgentStart,
    limits: conversationTokenLimits
  });
  let providerFrameInput: ProviderContextFrameBuildInput = {
    workspace: turnState.workspaceAtAgentStart,
    projectId: turnState.workspaceAtAgentStart.project.id,
    strategy: strategy.kind,
    mode: agentTurnMode,
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
    userMessageId,
    context,
    providerTaskContext,
    defaultMemoryContext: buildAgentDefaultMemoryContext(turnState.workspaceAtAgentStart, strategy.kind),
    summaryRevision: preCompactionConversation.summaryRevision,
    framePlacement: "beforeUser",
    attachmentCount: attachmentResult.attachments.length,
    documentSnapshotAvailable: documentResult.skipped.length === 0,
    ...(providerInputSnapshot.cacheBoundaryReason
      ? { cacheBoundaryReason: providerInputSnapshot.cacheBoundaryReason }
      : {})
  };
  turnState.workspaceAtAgentStart = commitWorkspaceNow((current) => {
    const next = appendAgentProviderContextFrames(current, { ...providerFrameInput, workspace: current });
    return { workspace: next, value: next };
  });
  const preCompactionHistory = preCompactionConversation.messages.filter((message) => message.id !== userMessageId);
  const preCompactionInput = buildAgentProviderInput({
    stableSystemPrompt,
    frames: turnState.workspaceAtAgentStart.ai.providerContextFrames ?? [],
    history: preCompactionHistory,
    currentUserMessageId: userMessageId,
    currentStrategy: strategy.kind,
    userInput,
    activeSummaryRevisionId: preCompactionConversation.summaryRevision?.id,
    serverManagedPrefix: false
  });
  const allowStructuredComparison = isExplicitComparisonRequest(draft);
  // Web search is estimated as enabled. That over-counts when the server has it
  // off, which compacts slightly early rather than slightly late; the server
  // remains the authority and still fails closed above the window.
  const initialTools = buildMorphoAgentTools(true);
  /**
   * Estimate the payload the server will actually send: the stable System prompt
   * and canonical Runtime item are prepended server-side, so a client estimate
   * that omits them decides to compact later than it should.
   */
  const estimateTurnProviderBudget = (dynamicInput: readonly unknown[]) =>
    estimateAgentTurnProviderBudget({
      dynamicInput,
      stableSystemPrompt,
      runtimeItemText: turnState.canonicalRuntimeItem?.renderedText,
      tools: initialTools,
      responseReserveTokens: outputTokenReserve
    });
  const preCompactionBudget = estimateTurnProviderBudget(preCompactionInput);
  const automaticCompactionPlan = buildConversationCompactionPlan({
    workspace: turnState.workspaceAtAgentStart,
    providerTimelineBudget: preCompactionBudget,
    limits: conversationTokenLimits
  });
  let automaticPostCompactionInput: unknown[] | undefined;
  if (automaticCompactionPlan) {
    const automaticContextOptions = {
      sourceMessageIds: automaticCompactionPlan.sourceMessages.map((message) => message.id),
      providerInput: preCompactionInput,
      freshAnchorMessageIds: [userMessageId]
    };
    const automaticFreshContextFrames = buildAgentCompactionFreshContextFrames(
      turnState.workspaceAtAgentStart,
      automaticContextOptions
    );
    const automaticRetainedTailItems = buildConversationCompactionTailItems({
      messages: automaticCompactionPlan.remainingMessages,
      continuationItems: [],
      contextFrames: automaticFreshContextFrames
    });
    const automaticContextMarkers = buildAgentCompactionContextMarkers(
      turnState.workspaceAtAgentStart,
      automaticContextOptions
    );
    const compactionActivityId = `${agentTurnId}:conversation-summary`;
    commitWorkspaceNow((current) => {
      const assistant = current.ai.messages.find((message) => message.id === assistantMessageId);
      if (!assistant?.agentTrace) {
        return { workspace: current, value: undefined };
      }
      return {
        workspace: updateAiMessage(current, assistantMessageId, assistant.body, "streaming", {
          agentTrace: startLocalAgentToolActivity(
            assistant.agentTrace,
            {
              toolCallId: compactionActivityId,
              toolName: "compact_conversation_history",
              activityKind: "contextRead",
              label: "整理讨论上下文",
              detail: `整理 ${automaticCompactionPlan.sourceMessageCount} 条较早消息`
            },
            new Date(host.now()).toISOString()
          )
        }),
        value: undefined
      };
    });
    try {
        const summaryRequest = await requestConversationSummary(
          automaticCompactionPlan,
          controller.signal,
        {
          projectId: turnState.workspaceAtAgentStart.project.id,
          agentTurnId,
          mode: agentTurnMode,
          leaseId: turnState.agentTurnLeaseId,
          leaseSequence: turnState.nextAgentLeaseSequence,
          continuationToken: turnState.agentContinuationToken,
          retainedTailItems: automaticRetainedTailItems,
          contextMarkers: automaticContextMarkers,
          previousTranscriptManifestHash:
            turnState.latestProviderTranscriptManifestHash ??
            turnState.latestProviderRequestState?.transcriptManifestHash,
          previousTranscriptSnapshotToken: turnState.latestProviderRequestState?.transcriptSnapshotToken,
          onLeaseStarted: (leaseId) => {
            turnState.agentTurnLeaseId = leaseId;
          },
          onLeaseSequence: (sequence) => {
            turnState.nextAgentLeaseSequence = sequence;
          },
          onContinuationToken: (token) => {
            turnState.agentContinuationToken = token;
          }
          },
          fetch
        );
      turnState.agentTurnLeaseId = summaryRequest.leaseId ?? turnState.agentTurnLeaseId;
      const parsedSummary = summaryRequest.parsed;
      if (parsedSummary.status !== "ok" || !summaryRequest.compactionReceipt) {
        throw new Error("连续对话摘要未通过校验。");
      }
      turnState.workspaceAtAgentStart = commitWorkspaceNow((current) => {
        const applied = applyConversationSummaryRevision(current, {
          summary: parsedSummary.summary,
          sourceMessageIds: automaticCompactionPlan.sourceMessages.map((message) => message.id),
          expectedPreviousRevisionId: automaticCompactionPlan.previousSummaryRevision?.id,
          estimatedInputTokens: automaticCompactionPlan.estimatedInputTokens,
          now: new Date(host.now()).toISOString()
        });
        if (applied.status !== "applied") {
          throw new Error(applied.reason);
        }
        const framed = ensureAgentConversationSummaryBaselines(applied.workspace, {
          projectId: applied.workspace.project.id,
          promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
          summaryRevision: applied.revision,
          mode: agentTurnMode
        });
        const assistant = framed.ai.messages.find((message) => message.id === assistantMessageId);
        const completed = assistant?.agentTrace
          ? updateAiMessage(framed, assistantMessageId, assistant.body, "streaming", {
              agentTrace: finishLocalAgentToolActivity(
                assistant.agentTrace,
                compactionActivityId,
                { state: "done", detail: "原始历史仍可查询" },
                new Date(host.now()).toISOString()
              )
            })
          : framed;
        return { workspace: completed, value: completed };
      });
      automaticPostCompactionInput = rebuildAgentPostCompactionTranscript({
        contextMarkers: automaticContextMarkers,
        receipt: summaryRequest.compactionReceipt,
        summary: parsedSummary.summary,
        retainedTailItems: automaticRetainedTailItems
      });
      turnState.providerTranscriptReset = true;
    } catch (error) {
      const isCancelled = error instanceof DOMException && error.name === "AbortError";
      await closeAgentTurnLease(isCancelled ? "cancelledBeforeExecution" : "failedBeforeExecution");
      const message = error instanceof Error ? error.message : "连续对话压缩失败。";
      commitWorkspaceNow((current) => ({
        workspace: finalizeAgentTurn(current, {
          agentTurnId,
          userMessageId,
          assistantMessageId,
          outcome: isCancelled ? "cancelledBeforeExecution" : "failedBeforeExecution",
          assistantBody: `连续对话压缩失败，原始历史未丢失。${message}`,
          assistantStatus: isCancelled ? "cancelled" : "failed",
          traceStatus: isCancelled ? "cancelled" : "failed",
          summary: isCancelled ? "自动压缩已取消，本轮未进入有效上下文。" : "自动压缩失败，本轮未进入有效上下文。",
          completedAt: new Date(host.now()).toISOString()
        }),
        value: undefined
      }));
      setAiDraft(draft);
      setShowFailure(true);
      abortControllerRef.current = null;
      setIsAiStreaming(false);
      return;
    }
  }
  const continuousConversation = buildContinuousConversationContext({
    workspace: turnState.workspaceAtAgentStart,
    limits: conversationTokenLimits
  });
  const baseHistory = continuousConversation.messages.filter((message) => message.id !== userMessageId);
  let initialConversationContext = {
    laneKey: conversationLaneKey,
    summaryRevision: continuousConversation.summaryRevision,
    messages: baseHistory,
    rawMessageCount: baseHistory.length,
    coveredMessageCount: continuousConversation.coveredMessageCount,
    estimatedInputTokens: continuousConversation.estimatedInputTokens,
    pressure: continuousConversation.pressure
  };
  providerFrameInput = {
    ...providerFrameInput,
    workspace: turnState.workspaceAtAgentStart,
    defaultMemoryContext: buildAgentDefaultMemoryContext(turnState.workspaceAtAgentStart, strategy.kind),
    summaryRevision: continuousConversation.summaryRevision
  };
  turnState.workspaceAtAgentStart = commitWorkspaceNow((current) => {
    const next = appendAgentProviderContextFrames(current, { ...providerFrameInput, workspace: current });
    return { workspace: next, value: next };
  });
  const initialConversationInput: Array<unknown> = buildAgentProviderInput({
    stableSystemPrompt,
    frames: turnState.workspaceAtAgentStart.ai.providerContextFrames ?? [],
    history: baseHistory,
    currentUserMessageId: userMessageId,
    currentStrategy: strategy.kind,
    userInput,
    activeSummaryRevisionId: initialConversationContext.summaryRevision?.id,
    serverManagedPrefix: false
  });
  const effectiveConversationInput = automaticPostCompactionInput ?? initialConversationInput;
  const effectiveProviderBudget = estimateTurnProviderBudget(effectiveConversationInput);
  const effectiveConversation = buildContinuousConversationContext({
    workspace: turnState.workspaceAtAgentStart,
    limits: conversationTokenLimits
  });
  initialConversationContext = {
    ...initialConversationContext,
    summaryRevision: effectiveConversation.summaryRevision,
    messages: effectiveConversation.messages.filter((message) => message.id !== userMessageId),
    rawMessageCount: effectiveConversation.messages.filter((message) => message.id !== userMessageId).length,
    coveredMessageCount: effectiveConversation.coveredMessageCount,
    estimatedInputTokens: effectiveProviderBudget.totalInputTokens,
    pressure: classifyConversationPressure(
      effectiveProviderBudget.estimatedOccupancyTokens,
      conversationTokenLimits ?? MORPHO_AGENT_CONTEXT_POLICY,
      effectiveProviderBudget.projectedInputItemCount
    )
  };
  const requiredReadRequirements = resolveRequiredAgentReadRequirements(draft, {
    hasSelectedObject: selectedObjects.length > 0
  });
  const requiredReadTools = requiredReadRequirements.map((requirement) => requirement.tool);
  const requiredMemoryUpdates = resolveRequiredAgentMemoryUpdates(draft);
  const runtimeState = createAgentTurnRuntimeState({
    conversationContext: initialConversationContext,
    conversationInput: effectiveConversationInput,
    requiredReadState: createRequiredAgentReadState(requiredReadRequirements),
    contextBudgetState: createAgentContextBudgetState(effectiveProviderBudget.totalInputTokens),
    agentWorkLedger: createAgentTurnWorkLedger()
  });
  const agentTurnStartedAt = host.now();
  const markAgentWorkUnresolved = (key: string, reason: string) =>
    runtimeState.agentWorkLedger.markUnresolved(key, reason);
  const resolveAgentWorkForTool = (toolName: string) =>
    runtimeState.agentWorkLedger.resolveForTool(toolName);

  const providerRequestAdapter = createAgentTurnProviderRequestAdapter({
    agentTurnId,
    userMessageId,
    assistantMessageId,
    agentTurnMode,
    allowStructuredComparison,
    draft,
    strategyKind: strategy.kind,
    context,
    conversationLaneKey,
    providerInputSnapshot,
    providerFrameInput,
    stableSystemPrompt,
    userInput,
    initialTools,
    outputTokenReserve,
    conversationTokenLimits,
    turnCreatedAt: now,
    signal: controller.signal,
    turnState,
    runtimeState,
    commitWorkspace: commitWorkspaceNow,
    readWorkspace: readWorkspaceNow,
    streamFlushSlot: {
      get: () => agentStreamFlushRef.current,
      set: (value) => {
        agentStreamFlushRef.current = value;
      }
    },
    fetch,
    nowIso: () => new Date(host.now()).toISOString()
  });
  const ensureProviderInputReady = async (continuation: boolean): Promise<void> => {
    if (!continuation) {
      return;
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const budget = providerRequestAdapter.estimateBudget(runtimeState.conversationInput);
      const pressure = classifyConversationPressure(
        budget.estimatedOccupancyTokens,
        conversationTokenLimits ?? MORPHO_AGENT_CONTEXT_POLICY,
        budget.projectedInputItemCount
      );
      runtimeState.conversationContext = {
        ...runtimeState.conversationContext,
        estimatedInputTokens: budget.totalInputTokens,
        pressure
      };
      runtimeState.highestPressure = pressure;
      if (budget.projectedInputItemCount <= 1_024 && pressure !== "compact") {
        return;
      }
      const result = await providerRequestAdapter.compactBeforeContinuation();
      if (result.status !== "compacted") {
        throw new AgentContextCompactionError(result.reason);
      }
    }
    throw new AgentContextCompactionError("压缩后 Provider 输入仍未低于共享 Context 边界，未发送请求。");
  };
  try {
    while (true) {
      assertAgentTurnActive(controller.signal);
      if (
        shouldFinalizeAgentTurn({
          emergencyGuardTriggered: runtimeState.emergencyGuardTriggered,
          modelTurnCount: runtimeState.modelTurnCount,
          elapsedMs: host.now() - agentTurnStartedAt
        })
      ) {
        const guardActivityId = `${agentTurnId}:emergency-final`;
        commitWorkspaceNow((current) => {
          const message = current.ai.messages.find((candidate) => candidate.id === assistantMessageId);
          if (!message?.agentTrace) {
            return { workspace: current, value: undefined };
          }
          const next = updateAiMessage(current, assistantMessageId, message.body, "streaming", {
            agentTrace: startLocalAgentToolActivity(
              message.agentTrace,
              {
                toolCallId: guardActivityId,
                toolName: "emergency_finalization",
                activityKind: "analysis",
                label: "整理已获得的结果"
              },
              new Date(host.now()).toISOString()
            )
          });
          return { workspace: next, value: undefined };
        });
        const finalizationRequest = buildAgentEmergencyFinalizationRequest(runtimeState.conversationInput);
        runtimeState.pendingServerDirective = { kind: "finalize" };
        const finalization = await providerRequestAdapter.request(
          runtimeState.conversationInput,
          finalizationRequest.continuation
        );
        if (finalization.functionCalls.length > 0) {
          const blockedFinalizationCalls = finalization.functionCalls.map((call) =>
            buildToolResultOutput(call.callId, {
              status: "blocked",
              reason: "本轮已进入最终整理，不再执行新的工具调用。"
            })
          );
          runtimeState.conversationInput = [
            ...runtimeState.conversationInput,
            ...finalization.outputItems,
            ...blockedFinalizationCalls
          ];
          runtimeState.turnContinuationItems.push(...finalization.outputItems, ...blockedFinalizationCalls);
        }
        runtimeState.finalText = finalization.outputText.trim() || runtimeState.finalText || "已停止继续执行，并保留已完成结果。";
        commitWorkspaceNow((current) => {
          const message = current.ai.messages.find((candidate) => candidate.id === assistantMessageId);
          if (!message?.agentTrace) {
            return { workspace: current, value: undefined };
          }
          const next = updateAiMessage(current, assistantMessageId, message.body, "streaming", {
            agentTrace: finishLocalAgentToolActivity(
              message.agentTrace,
              guardActivityId,
              { state: "done" },
              new Date(host.now()).toISOString()
            )
          });
          return { workspace: next, value: undefined };
        });
        break;
      }
      let result: AgentRouteResult;
      try {
        await ensureProviderInputReady(runtimeState.modelTurnCount > 0);
        result = await providerRequestAdapter.request(
          runtimeState.conversationInput,
          runtimeState.modelTurnCount > 0
        );
      } catch (error) {
        if (
          error instanceof AgentTurnStreamError &&
          error.code === "context_limit"
        ) {
          const compaction = await providerRequestAdapter.compactBeforeContinuation();
          if (compaction.status !== "compacted") {
            throw new AgentContextCompactionError(compaction.reason);
          }
          await ensureProviderInputReady(true);
          result = await providerRequestAdapter.request(
            runtimeState.conversationInput,
            runtimeState.modelTurnCount > 0
          );
        } else {
          throw error;
        }
      }
      runtimeState.modelTurnCount += 1;
      runtimeState.collectedCitations = mergeAgentSearchCitations(runtimeState.collectedCitations, result.citations);
      runtimeState.hasWebSearchEvidence ||= result.webSearchCallCount > 0;

      runtimeState.conversationInput = [...runtimeState.conversationInput, ...result.outputItems];
      runtimeState.turnContinuationItems.push(...result.outputItems);

      if (result.functionCalls.length === 0) {
        const readTransition = advanceRequiredAgentReadState(runtimeState.requiredReadState);
        runtimeState.requiredReadState = readTransition.state;
        if (readTransition.action === "remind") {
          runtimeState.pendingServerDirective = { kind: "requiredRead", tools: readTransition.missingTools };
          continue;
        }
        if (readTransition.action === "exhausted") {
          markAgentWorkUnresolved("requiredRead", "本轮所需的项目资料读取未能完成。");
          runtimeState.finalText = [
            result.outputText.trim(),
            buildRequiredAgentReadFailureNotice(runtimeState.requiredReadState)
          ].filter(Boolean).join("\n\n");
          break;
        }
        if (
          shouldPromptForMemoryUpdate({
            candidates: requiredMemoryUpdates,
            reminderInserted: runtimeState.memoryUpdateReminderInserted,
            handledCandidateIndexes: runtimeState.handledMemoryCandidateIndexes
          })
        ) {
          runtimeState.memoryUpdateReminderInserted = true;
          runtimeState.pendingServerDirective = {
            kind: "memoryUpdate",
            memoryKinds: requiredMemoryUpdates
              .filter((_candidate, index) => !runtimeState.handledMemoryCandidateIndexes.has(index))
              .map((candidate) => candidate.kind)
          };
          continue;
        }
        runtimeState.finalText = result.outputText.trim() || "本次 Agent 未返回可显示文本。";
        break;
      }

      let toolOutputs: ReturnType<typeof buildToolResultOutput>[] = [];
      const parsedCallBatch = parseMorphoAgentToolCallBatch(result.functionCalls);
      const invalidCalls = parsedCallBatch.filter((entry) => entry.status === "invalid");
      if (invalidCalls.length > 0) {
        for (const entry of invalidCalls) {
          markAgentWorkUnresolved(`repair:${entry.call.name}`, "工具参数不符合 schema，等待一次修复。");
        }
        runtimeState.toolArgumentRepairCount += 1;
        if (runtimeState.toolArgumentRepairCount > MAX_AGENT_TOOL_ARGUMENT_REPAIR_ATTEMPTS) {
          throw new Error("Agent 连续返回不符合工具 schema 的参数，已停止本轮以避免重复执行。");
        }
        const repairOutputs = buildMorphoAgentToolArgumentRepairOutputs(parsedCallBatch);
        runtimeState.conversationInput = [...runtimeState.conversationInput, ...repairOutputs];
        runtimeState.turnContinuationItems.push(...repairOutputs);
        runtimeState.pendingServerDirective = {
          kind: "toolArgumentRepair",
          callIds: invalidCalls.map((entry) => entry.call.callId)
        };
        for (const entry of invalidCalls) {
          if (requiredReadTools.includes(entry.call.name as RequiredAgentReadToolName)) {
            runtimeState.requiredReadState = failRequiredAgentRead(
              runtimeState.requiredReadState,
              entry.call.name as RequiredAgentReadToolName
            ).state;
          }
        }
        const repairActivityId = `${agentTurnId}:tool-argument-repair:${runtimeState.toolArgumentRepairCount}`;
        commitWorkspaceNow((current) => {
          const message = current.ai.messages.find((candidate) => candidate.id === assistantMessageId);
          if (!message?.agentTrace) {
            return { workspace: current, value: undefined };
          }
          const started = startLocalAgentToolActivity(
            message.agentTrace,
            {
              toolCallId: repairActivityId,
              toolName: "tool_argument_repair",
              activityKind: "analysis",
              label: "校正工具参数",
              detail: sanitizeAgentActivityDetail(invalidCalls.map((entry) => entry.error).join("；"))
            },
            new Date(host.now()).toISOString()
          );
          const next = updateAiMessage(current, assistantMessageId, message.body, "streaming", {
            agentTrace: finishLocalAgentToolActivity(
              started,
              repairActivityId,
              { state: "done" },
              new Date(host.now()).toISOString()
            )
          });
          return { workspace: next, value: undefined };
        });
        continue;
      }
      runtimeState.toolArgumentRepairCount = 0;
      const parsedCalls = parsedCallBatch.flatMap((entry) => {
        if (entry.status !== "valid") {
          return [];
        }
        return [
          {
            call: entry.call,
            parsed:
              entry.parsed.name === "generate_visuals"
                ? {
                    ...entry.parsed,
                    args: normalizeGenerateVisualsForSelectedDirections(
                      entry.parsed.args,
                      selectedDirectionCount
                    )
                  }
                : entry.parsed
          }
        ];
      });
      const visualWorkspace = readWorkspaceNow();
      const projectReferenceObjectIds = Object.values(visualWorkspace.objects)
        .filter(
          (object) =>
            object.type === "image" &&
            object.visibility === "active" &&
            object.role === "reference"
        )
        .map((object) => object.id);
      const visualCalls = parsedCalls.flatMap(({ call, parsed }) =>
        parsed.name === "generate_visuals"
          ? [
              {
                callId: call.callId,
                plan: compileVisualGenerationPlan({
                  workspace: visualWorkspace,
                  kind: parsed.args.kind,
                  intents: parsed.args.items,
                  selectedSourceObjectIds: context.objectIds,
                  projectReferenceObjectIds,
                  modelId: effectiveImageGenerationSettings.modelId,
                  currentUserInput: draft
                })
              }
            ]
          : []
      );
      const visualBatch =
        visualCalls.length > 0
          ? buildAgentVisualGenerationBatch({
              calls: visualCalls,
              expected: resolveExpectedVisualGenerationCount({
                draft,
                kind: visualCalls[0]!.plan.kind,
                selectedDirectionCount,
                defaultPreviewCount: directionPreviewCount
              })
            })
          : null;
      const toolBatchState: AgentToolBatchState = {
        visualBatch,
        pendingAgentActionCreated: false
      };
      const toolExecutorInput: Omit<AgentToolExecutorInput, "callId"> = {
        context,
        providerTaskContext,
        runtimeState,
        batchState: toolBatchState,
        commitWorkspace: commitWorkspaceNow,
        readWorkspace: readWorkspaceNow,
        draft,
        modelOutputText: result.outputText,
        userMessageId,
        assistantMessageId,
        userMessageCreatedAt: now,
        selectedObjectIds,
        selectedObjects,
        allowStructuredComparison,
        imageAttachmentObjectIds: attachmentResult.entries
          .filter((entry) => entry.status === "ready")
          .map((entry) => entry.objectId),
        documentExtractObjectIds: documentResult.extracts.map((extract) => extract.objectId),
        deliverySectionContext,
        requiredMemoryUpdates,
        imageGenerationModelId: effectiveImageGenerationSettings.modelId,
        signal: controller.signal,
        requestWebSearch: requestAgentWebSearch,
        executeVisualGenerationPlan: executeAgentVisualGenerationPlan,
        ui: {
          selectObjects: setSelectedObjectIds,
          focusObject: (objectId) => {
            host.ui.focusObject(objectId);
          },
          openProposal: setActiveProposalId,
          clearPendingDeliveryDraftTarget: () => {
            setPendingDeliveryDraftTarget(null);
          },
          requestConfirmation: (args, compiledVisualPlan) => {
            setPendingConfirmation(
              buildRequestedAgentActionConfirmation({
                args,
                compiledVisualPlan,
                workspace: readWorkspaceNow(),
                draft,
                contextObjectIds: context.objectIds,
                selectedObjects
              })
            );
          }
        }
      };

      for (const { call, parsed } of parsedCalls) {
        if (controller.signal.aborted) {
          toolOutputs = completeUnresolvedAgentFunctionCalls({
            calls: parsedCalls.map((entry) => entry.call),
            outputs: toolOutputs,
            status: "cancelled",
            reason: "用户取消了当前 Agent 回合。"
          });
          runtimeState.conversationInput = [...runtimeState.conversationInput, ...toolOutputs];
          runtimeState.turnContinuationItems.push(...toolOutputs);
          throw new DOMException("当前 Agent 回合已取消。", "AbortError");
        }
        assertAgentTurnActive(controller.signal);
        const repetition = isRepeatedAgentToolCall(runtimeState.previousToolSignature, runtimeState.repeatedToolCallCount, parsed);
        runtimeState.previousToolSignature = repetition.signature;
        runtimeState.repeatedToolCallCount = repetition.repeatCount;
        if (repetition.exceeded) {
          markAgentWorkUnresolved("guard:repeatedToolCall", "检测到连续重复调用，本轮已停止继续使用工具。");
          toolOutputs.push(
            buildToolResultOutput(call.callId, {
              status: "blocked",
              reason: "检测到连续重复调用，已停止继续使用工具并整理已有结果。"
            })
          );
          runtimeState.emergencyGuardTriggered = true;
          break;
        }
        const activity = buildAgentToolActivityDescriptor(parsed, {
          workspace: readWorkspaceNow(),
          selectedObjects
        });
        commitWorkspaceNow((current) => {
          const message = current.ai.messages.find((candidate) => candidate.id === assistantMessageId);
          if (!message?.agentTrace) {
            return { workspace: current, value: undefined };
          }
          const next = updateAiMessage(current, assistantMessageId, message.body, "streaming", {
            agentTrace: startLocalAgentToolActivity(
              message.agentTrace,
              {
                toolCallId: call.callId,
                toolName: parsed.name,
                activityKind: activity.activityKind,
                label: activity.label,
                detail: activity.detail
              },
              new Date(host.now()).toISOString()
            )
          });
          return { workspace: next, value: undefined };
        });
        if (parsed.name === "generate_visuals" && visualBatch?.status === "blocked") {
          markAgentWorkUnresolved(`tool:${parsed.name}`, visualBatch.reason);
          toolOutputs.push(
            buildToolResultOutput(call.callId, {
              status: "blocked",
              reason: visualBatch.reason
            })
          );
          commitWorkspaceNow((current) => {
            const next = finishAgentToolActivityInWorkspace(current, assistantMessageId, call.callId, "failed");
            return { workspace: next, value: undefined };
          });
          continue;
        }
        const executionPolicy = resolveAgentToolExecutionPolicy({
          name: parsed.name,
          mode: agentTurnMode,
          explicitUserCommand: parsed.name !== "submit_memory_update" || requiredMemoryUpdates.length > 0
        });
        if (executionPolicy === "requireConfirmation") {
          const confirmationPlan =
            parsed.name === "generate_visuals" && visualBatch?.status === "ok" ? visualBatch.plan : undefined;
          setPendingConfirmation(
            buildPendingAgentActionConfirmation({
              parsed,
              compiledVisualPlan: confirmationPlan,
              draft,
              contextObjectIds: context.objectIds,
              citations: runtimeState.collectedCitations,
              selectedObjects,
              selectedObjectIds,
              userMessageId,
              assistantMessageId,
              imageAttachmentObjectIds: attachmentResult.entries
                .filter((entry) => entry.status === "ready")
                .map((entry) => entry.objectId),
              documentExtractObjectIds: documentResult.extracts.map((extract) => extract.objectId),
              documentFragmentExtractObjectIds: context.documentFragmentExtracts.map((fragment) => fragment.objectId)
            })
          );
          toolOutputs.push(
            buildToolResultOutput(call.callId, {
              status: "pendingConfirmation",
              action: parsed.name,
              reason: "用户已切换为先确认模式，项目写入、生成或分析必须等待确认。",
              impact: "确认前不会创建、修改或生成任何项目对象。"
            })
          );
          runtimeState.finalText = result.outputText.trim() || "已准备确认卡。确认前不会改变项目状态。";
          toolBatchState.pendingAgentActionCreated = true;
          runtimeState.pendingConfirmationCreated = true;
          commitWorkspaceNow((current) => {
            const next = finishAgentToolActivityInWorkspace(current, assistantMessageId, call.callId, "done");
            return { workspace: next, value: undefined };
          });
          break;
        }
        try {
          const output = await executeAgentTool({
            ...toolExecutorInput,
            callId: call.callId,
            parsed
          });
          toolOutputs.push(buildToolResultOutput(call.callId, output));
        } catch (error) {
          if (error instanceof AgentWebSearchLeaseRecoveryError) {
            throw error;
          }
          const reason = error instanceof Error ? normalizeAgentTurnErrorMessage(error.message) : "该操作未能完成。";
          markAgentWorkUnresolved(`tool:${parsed.name}`, reason);
          if (requiredReadTools.includes(parsed.name as RequiredAgentReadToolName)) {
            const readFailure = failRequiredAgentRead(
              runtimeState.requiredReadState,
              parsed.name as RequiredAgentReadToolName
            );
            runtimeState.requiredReadState = readFailure.state;
            if (readFailure.retry) {
              runtimeState.pendingServerDirective = {
                kind: "requiredRead",
                tools: [parsed.name as RequiredAgentReadToolName]
              };
            }
          }
          toolOutputs.push(
            buildToolResultOutput(call.callId, {
              status: "failed",
              reason
            })
          );
          commitWorkspaceNow((current) => {
            const next = finishAgentToolActivityInWorkspace(
              current,
              assistantMessageId,
              call.callId,
              "failed",
              sanitizeAgentActivityDetail(reason)
            );
            return { workspace: next, value: undefined };
          });
          continue;
        }
        runtimeState.hasAgentToolResult = true;
        resolveAgentWorkForTool(parsed.name);
        commitWorkspaceNow((current) => {
          const next = finishAgentToolActivityInWorkspace(current, assistantMessageId, call.callId, "done");
          return { workspace: next, value: undefined };
        });
      }

      if (runtimeState.emergencyGuardTriggered || toolBatchState.pendingAgentActionCreated) {
        toolOutputs = completeUnresolvedAgentFunctionCalls({
          calls: parsedCalls.map((entry) => entry.call),
          outputs: toolOutputs,
          status: "skippedDueToEarlierGuard",
          reason: runtimeState.emergencyGuardTriggered
            ? "前序调用触发重复或安全边界，后续调用未执行。"
            : "前序调用进入待确认状态，后续调用未执行。"
        });
      }

      if (runtimeState.emergencyGuardTriggered) {
        runtimeState.conversationInput = [...runtimeState.conversationInput, ...toolOutputs];
        runtimeState.turnContinuationItems.push(...toolOutputs);
          providerRequestAdapter.appendProjectStateFrame({
            outputHash: hashAgentProviderItems(result.outputItems),
            callIds: result.functionCalls.map((call) => call.callId),
            terminalOutputHash: hashAgentProviderItems(toolOutputs)
          });
        continue;
      }

      if (toolOutputs.length === 0) {
        break;
      }

      if (toolBatchState.pendingAgentActionCreated) {
        runtimeState.conversationInput = [...runtimeState.conversationInput, ...toolOutputs];
        runtimeState.turnContinuationItems.push(...toolOutputs);
        break;
      }

      runtimeState.conversationInput = [...runtimeState.conversationInput, ...toolOutputs];
      runtimeState.turnContinuationItems.push(...toolOutputs);
      providerRequestAdapter.appendProjectStateFrame({
        outputHash: hashAgentProviderItems(result.outputItems),
        callIds: result.functionCalls.map((call) => call.callId),
        terminalOutputHash: hashAgentProviderItems(toolOutputs)
      });
      if (runtimeState.highestPressure === "compact") {
        const compaction = await providerRequestAdapter.compactBeforeContinuation();
        if (compaction.status === "blocked") {
          throw new AgentContextCompactionError(compaction.reason);
        }
      }
    }
    const turnOutcome = resolveAgentTurnOutcome({
      pendingConfirmation: runtimeState.pendingConfirmationCreated,
      unresolvedCount: runtimeState.agentWorkLedger.unresolvedCount(),
      hasToolResult: runtimeState.hasAgentToolResult
    });
    const turnOutcomeSummary = turnOutcome === "partialSuccess"
      ? "本轮已保留成功取得的工具结果；至少一个步骤失败或被阻断，未完成部分需要后续重试。"
      : turnOutcome === "pendingConfirmation"
        ? "本轮已停在待确认状态；确认前不把相关动作视为已完成。"
        : turnOutcome === "failedBeforeExecution"
          ? "本轮所需执行未成功完成，未把用户请求作为有效完成上下文。"
          : undefined;
    commitWorkspaceNow((current) => {
      const replyText = runtimeState.finalText || "已完成当前执行。";
      const completedAt = new Date(host.now()).toISOString();
      let nextWorkspace = finalizeAgentTurn(
        current,
        {
          agentTurnId,
          userMessageId,
          assistantMessageId,
          outcome: turnOutcome,
          assistantBody: sanitizeConversationSummaryStreamForDisplay(
            sanitizeConversationAssistantStreamForDisplay(replyText)
          ) || "已完成当前执行。",
          assistantStatus: turnOutcome === "failedBeforeExecution" ? "failed" : "done",
          traceStatus: turnOutcome === "failedBeforeExecution" ? "failed" : "done",
          ...(turnOutcomeSummary ? { summary: turnOutcomeSummary } : {}),
          completedAt,
          ...(runtimeState.latestProviderResponseId ? { responseId: runtimeState.latestProviderResponseId } : {}),
          ...(turnState.latestProviderRequestState
            ? { providerRequestState: compactHistoricalProviderRequestState(turnState.latestProviderRequestState) }
            : {})
        }
      );
      if (runtimeState.memoryUpdateEntryIds.size > 0) {
        nextWorkspace = {
          ...nextWorkspace,
          ai: {
            ...nextWorkspace.ai,
            messages: nextWorkspace.ai.messages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    continuityEntryIds: [...runtimeState.memoryUpdateEntryIds],
                    memoryUpdateKeys: [...runtimeState.memoryUpdateKeys],
                    stageRecordUpdateKeys: [...runtimeState.stageRecordUpdateKeys]
                  }
                : message
            )
          }
        };
      }
      if (runtimeState.collectedCitations.length > 0) {
        nextWorkspace = storeMessageCitations(nextWorkspace, {
          messageId: assistantMessageId,
          operationId: assistantMessageId,
          citations: runtimeState.collectedCitations
        });
      }
      return { workspace: nextWorkspace, value: undefined };
    });
    await closeAgentTurnLease(turnOutcome);
  } catch (error) {
    const isCancelled = error instanceof DOMException && error.name === "AbortError";
    const message = isCancelled
      ? "当前 Agent 回合已取消。原输入、选择和已完成步骤已保留。"
      : error instanceof Error
        ? error.message
        : "当前 Agent 回合失败。";
    if (abortControllerRef.current === controller || abortControllerRef.current === null) {
      setAiDraft(draft);
    }
    const turnOutcome = runtimeState.hasAgentToolResult
      ? "partialSuccess" as const
      : isCancelled
        ? "cancelledBeforeExecution" as const
        : "failedBeforeExecution" as const;
    const turnOutcomeSummary = turnOutcome === "partialSuccess"
      ? "本轮在中断前已保留部分工具结果；其余步骤未完成。"
      : message;
    commitWorkspaceNow((current) => {
      const next = finalizeAgentTurn(
        current,
        {
          agentTurnId,
          userMessageId,
          assistantMessageId,
          outcome: turnOutcome,
          assistantBody: turnOutcome === "partialSuccess" ? turnOutcomeSummary : message,
          assistantStatus: turnOutcome === "partialSuccess" ? "done" : isCancelled ? "cancelled" : "failed",
          traceStatus: turnOutcome === "partialSuccess" ? "done" : isCancelled ? "cancelled" : "failed",
          summary: turnOutcomeSummary,
          completedAt: new Date(host.now()).toISOString(),
          ...(runtimeState.latestProviderResponseId ? { responseId: runtimeState.latestProviderResponseId } : {}),
          ...(turnState.latestProviderRequestState
            ? { providerRequestState: compactHistoricalProviderRequestState(turnState.latestProviderRequestState) }
            : {})
        }
      );
      return { workspace: next, value: undefined };
    });
    await closeAgentTurnLease(turnOutcome);
    setShowFailure(true);
  } finally {
    if (abortControllerRef.current === controller) {
      abortControllerRef.current = null;
      setIsAiStreaming(false);
    } else if (abortControllerRef.current === null) {
      setIsAiStreaming(false);
    }
  }
}
