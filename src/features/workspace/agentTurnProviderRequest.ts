import { MORPHO_AGENT_CONTEXT_POLICY } from "@/domain/morpho/agentContextPolicy";
import {
  applyConversationSummaryRevision,
  buildContinuousConversationContext,
  buildConversationCompactionPlan,
  classifyConversationPressure,
  getUsableConversationMessages,
  sanitizeConversationSummaryStreamForDisplay,
  type ConversationTokenLimits
} from "@/domain/morpho/conversationCompaction";
import { buildProviderContextFrameTimeline } from "@/domain/morpho/providerContextFrame";
import { sanitizeConversationAssistantStreamForDisplay } from "@/domain/morpho/conversationCheckpoint";
import { buildAgentDefaultMemoryContext } from "@/domain/morpho/projectMemory";
import type {
  AgentTaskStrategyKind,
  MorphoWorkspace,
  ProviderContextFrame,
  ProviderInputSnapshot
} from "@/domain/morpho/types";
import type { ResponseMessageInput } from "@/server/ai/openaiCompatibleProvider";
import {
  advanceAgentContextBudgetGeneration,
  buildServerManagedPrefixItems,
  estimateProviderInputTimelineBudget,
  updateAgentContextBudgetBaseline
} from "@/shared/providerInputBudget";
import { updateAiMessage } from "./aiConversationMessages";
import {
  applyAgentStreamEventsToTrace,
  compactHistoricalProviderDiagnostics,
  createAgentTrace,
  finishLocalAgentToolActivity,
  startLocalAgentToolActivity
} from "./agentMessageTrace";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import {
  consumeAgentTurnStream,
  createAgentAttemptGuard,
  createAgentStreamEventBatcher
} from "./agentStreamClient";
import {
  prepareAgentDurableCheckpoint,
  requestConversationSummary
} from "./agentTurnLeaseClient";
import {
  buildConversationCompactionTailItems
} from "./conversationSummaryAgentRequest";
import type { AgentTurnRuntimeState, AgentTurnState } from "./agentTurnState";
import type { AgentRouteResult, MorphoAgentTurnMode } from "./morphoAgent";
import {
  appendAgentProviderContextFrames,
  appendAgentProviderRuntimeConfigurationFrame,
  appendAgentProviderStateFrames,
  compactHistoricalProviderRequestState,
  ensureAgentConversationSummaryBaselines,
  getProviderInputReplayBoundaryReasons,
  providerContextFrameContinuationMarker,
  toProviderRequestBoundaryState,
  type ProviderContextFrameBuildInput,
  type ProviderRequestBoundaryState
} from "./providerContextFrames";
import {
  type AgentCompactionReceipt,
  AGENT_CONTEXT_STATE_MARKER_TYPE,
  buildCompactionTranscriptMarker,
  buildAgentTranscriptManifest,
  parseAgentTranscriptMessageItem,
  type AgentContextStateMarker,
  type AgentContextMarkerCausalBinding
} from "@/shared/agentCompactionProtocol";
import { buildProviderTaskContext, buildTaskContext, type TaskContextResult } from "./taskContext";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";

export type AgentTurnStreamFlushSlot = {
  get: () => (() => void) | null;
  set: (value: (() => void) | null) => void;
};

export type AgentTurnProviderRequestAdapterInput = {
  agentTurnId: string;
  userMessageId: string;
  assistantMessageId: string;
  agentTurnMode: MorphoAgentTurnMode;
  allowStructuredComparison: boolean;
  draft: string;
  strategyKind: AgentTaskStrategyKind;
  context: TaskContextResult;
  conversationLaneKey: string;
  providerInputSnapshot: ProviderInputSnapshot;
  providerFrameInput: ProviderContextFrameBuildInput;
  stableSystemPrompt: string;
  userInput: ResponseMessageInput;
  initialTools: readonly unknown[];
  outputTokenReserve: number;
  conversationTokenLimits?: ConversationTokenLimits;
  turnCreatedAt: string;
  signal: AbortSignal;
  turnState: AgentTurnState;
  runtimeState: AgentTurnRuntimeState;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  readWorkspace: () => MorphoWorkspace;
  streamFlushSlot: AgentTurnStreamFlushSlot;
  fetch: typeof fetch;
  nowIso: () => string;
};

export type AgentTurnProviderRequestAdapter = {
  estimateBudget: (dynamicInput: readonly unknown[]) => ReturnType<typeof estimateProviderInputTimelineBudget>;
  request: (input: Array<unknown>, continuation?: boolean) => Promise<AgentRouteResult>;
  appendProjectStateFrame: (causalBinding?: AgentContextMarkerCausalBinding) => void;
  compactBeforeContinuation: () => Promise<AgentCompactionResult>;
};

export type AgentCompactionResult =
  | { status: "compacted"; pressure: "normal" | "prepare" | "compact" }
  | { status: "not_needed"; reason: string }
  | { status: "blocked"; reason: string };

export class AgentContextCompactionError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "AgentContextCompactionError";
  }
}

export type CompactionProgressMetrics = {
  totalInputTokens: number;
  projectedInputItemCount: number;
};

export function classifyCompactionProgress(
  before: CompactionProgressMetrics,
  after: CompactionProgressMetrics
): { status: "progress" } | { status: "blocked"; reason: string } {
  const tokenIncreased = after.totalInputTokens > before.totalInputTokens;
  const itemCountIncreased = after.projectedInputItemCount > before.projectedInputItemCount;
  if (tokenIncreased || itemCountIncreased) {
    return {
      status: "blocked",
      reason: `压缩后${tokenIncreased ? " token" : ""}${tokenIncreased && itemCountIncreased ? " 和" : ""}${itemCountIncreased ? " Item" : ""} 数量增加，未继续发送。`
    };
  }
  const tokenDecreased = after.totalInputTokens < before.totalInputTokens;
  const itemCountDecreased = after.projectedInputItemCount < before.projectedInputItemCount;
  return tokenDecreased || itemCountDecreased
    ? { status: "progress" }
    : { status: "blocked", reason: "压缩后 token 和 Item 数量均没有下降，已安全停止继续发送。" };
}

export function buildAgentCompactionContextMarkers(
  workspace: MorphoWorkspace,
  options: AgentCompactionContextOptions = {}
): ReturnType<typeof providerContextFrameContinuationMarker>[] {
  const inputMarkers = contextMarkersFromProviderInput(options.providerInput ?? []);
  const markers = selectAgentCompactionContextFrames(workspace, options)
    .filter((frame) => !isFreshUnboundContextFrame(frame, options, inputMarkers))
    .map((frame) => inputMarkers.get(providerContextFrameContinuationMarker(frame).contentHash) ??
      providerContextFrameContinuationMarker(frame));
  return [
    ...markers.filter((marker) => !contextMarkerFollowsCompactedTail(marker)),
    ...markers.filter(contextMarkerFollowsCompactedTail)
  ];
}

export function buildAgentCompactionFreshContextFrames(
  workspace: MorphoWorkspace,
  options: AgentCompactionContextOptions = {}
): ProviderContextFrame[] {
  const inputMarkers = contextMarkersFromProviderInput(options.providerInput ?? []);
  return selectAgentCompactionContextFrames(workspace, options)
    .filter((frame) => isFreshUnboundContextFrame(frame, options, inputMarkers));
}

type AgentCompactionContextOptions = {
  sourceMessageIds?: readonly string[];
  providerInput?: readonly unknown[];
  freshAnchorMessageIds?: readonly string[];
};

function selectAgentCompactionContextFrames(
  workspace: MorphoWorkspace,
  options: AgentCompactionContextOptions
): ProviderContextFrame[] {
  const frames = workspace.ai.providerContextFrames ?? [];
  const usableMessages = getUsableConversationMessages(workspace.ai.messages);
  const coveredIds = new Set([
    ...usableMessages
      .slice(0, workspace.ai.conversationCompaction.coveredMessageCount)
      .map((message) => message.id),
    ...(options.sourceMessageIds ?? [])
  ]);
  const activeMessageIds = new Set(
    usableMessages.filter((message) => !coveredIds.has(message.id)).map((message) => message.id)
  );
  const timeline = buildProviderContextFrameTimeline({
    frames,
    activeMessageIds,
    summaryCoveredMessageIds: coveredIds,
    activeSummaryRevisionId: workspace.ai.conversationCompaction.summaryRevisionId
  }).filter((frame) => frame.kind !== "conversationSummary");
  const latestStateFrames = (["projectState", "runtimeConfiguration"] as const).flatMap((kind) => {
    const latest = [...frames]
      .filter((frame) => frame.kind === kind)
      .sort((left, right) => left.sequence - right.sequence)
      .at(-1);
    return latest ? [latest] : [];
  });
  return [...new Map(
    [...timeline, ...latestStateFrames]
      .sort((left, right) => left.sequence - right.sequence)
      .map((frame) => [frame.id, frame])
  ).values()];
}

function contextMarkersFromProviderInput(
  input: readonly unknown[]
): Map<string, AgentContextStateMarker> {
  return new Map(input.flatMap((item): Array<[string, AgentContextStateMarker]> => {
    if (
      typeof item !== "object" || item === null || Array.isArray(item) ||
      !("type" in item) || item.type !== AGENT_CONTEXT_STATE_MARKER_TYPE ||
      !("contentHash" in item) || typeof item.contentHash !== "string"
    ) {
      return [];
    }
    return [[item.contentHash, item as AgentContextStateMarker]];
  }));
}

function isFreshUnboundContextFrame(
  frame: ProviderContextFrame,
  options: AgentCompactionContextOptions,
  inputMarkers: ReadonlyMap<string, AgentContextStateMarker>
): boolean {
  if (!frame.anchorMessageId || !options.freshAnchorMessageIds?.includes(frame.anchorMessageId)) {
    return false;
  }
  const marker = inputMarkers.get(providerContextFrameContinuationMarker(frame).contentHash);
  return !marker?.causalBindingHash;
}

export function rebuildAgentPostCompactionTranscript(input: {
  contextMarkers: readonly ReturnType<typeof providerContextFrameContinuationMarker>[];
  receipt: AgentCompactionReceipt;
  summary: Parameters<typeof buildCompactionTranscriptMarker>[0]["summary"];
  retainedTailItems: readonly unknown[];
}): unknown[] {
  const before = input.contextMarkers.filter((marker) => !contextMarkerFollowsCompactedTail(marker));
  const after = input.contextMarkers.filter(contextMarkerFollowsCompactedTail);
  return [
    ...before,
    buildCompactionTranscriptMarker({
      descriptor: input.receipt,
      summary: input.summary,
      summaryHash: input.receipt.summaryHash,
      summaryRevisionId: input.receipt.summaryRevisionId,
      retainedTail: input.retainedTailItems
    }),
    ...after
  ];
}

function contextMarkerFollowsCompactedTail(marker: AgentContextStateMarker): boolean {
  return Boolean(marker.causalBindingHash) ||
    marker.placement === "afterUser" ||
    marker.placement === "afterAssistant";
}

export function estimateAgentTurnProviderBudget(input: {
  dynamicInput: readonly unknown[];
  stableSystemPrompt: string;
  runtimeItemText?: string;
  tools: readonly unknown[];
  responseReserveTokens: number;
}) {
  return estimateProviderInputTimelineBudget({
    input: [
      ...buildServerManagedPrefixItems({
        stableSystemPrompt: input.stableSystemPrompt,
        runtimeItemText: input.runtimeItemText
      }),
      ...input.dynamicInput
    ],
    tools: input.tools,
    responseReserveTokens: input.responseReserveTokens
  });
}

export function createAgentTurnProviderRequestAdapter(
  input: AgentTurnProviderRequestAdapterInput
): AgentTurnProviderRequestAdapter {
  const estimateBudget = (dynamicInput: readonly unknown[]) =>
    estimateAgentTurnProviderBudget({
      dynamicInput,
      stableSystemPrompt: input.stableSystemPrompt,
      runtimeItemText: input.turnState.canonicalRuntimeItem?.renderedText,
      tools: input.initialTools,
      responseReserveTokens: input.outputTokenReserve
    });

  return {
    estimateBudget,
    request: (conversationInput, continuation = false) =>
      requestAgentTurnProvider(input, conversationInput, continuation),
    appendProjectStateFrame: (causalBinding) =>
      appendProjectStateFrameToConversationInput(input, causalBinding),
    compactBeforeContinuation: () =>
      compactConversationBeforeContinuation(input, estimateBudget)
  };
}

export async function requestAgentTurnProvider(
  input: AgentTurnProviderRequestAdapterInput,
  conversationInput: Array<unknown>,
  continuation = false
): Promise<AgentRouteResult> {
  const { runtimeState, turnState } = input;
  const candidateBudget = estimateAgentTurnProviderBudget({
    dynamicInput: conversationInput,
    stableSystemPrompt: input.stableSystemPrompt,
    runtimeItemText: turnState.canonicalRuntimeItem?.renderedText,
    tools: input.initialTools,
    responseReserveTokens: input.outputTokenReserve
  });
  if (candidateBudget.projectedInputItemCount > 1_024) {
    throw new AgentContextCompactionError("Provider Input Item 数量超过 1024，未发送请求。");
  }
  if (classifyConversationPressure(
    candidateBudget.estimatedOccupancyTokens,
    input.conversationTokenLimits ?? MORPHO_AGENT_CONTEXT_POLICY,
    candidateBudget.projectedInputItemCount
  ) === "compact") {
    throw new AgentContextCompactionError("当前 Provider 输入仍处于 compact，未发送请求。");
  }
  const exactContinuation = continuation && !turnState.providerTranscriptReset;
  turnState.providerTranscriptReset = false;
  const leaseContinuation = !exactContinuation && Boolean(turnState.agentTurnLeaseId);
  if (!exactContinuation && !leaseContinuation) {
    const preparedRequestState = await prepareAgentDurableCheckpoint({
      projectId: turnState.workspaceAtAgentStart.project.id,
      requestState: turnState.latestProviderRequestState,
      legacyTranscriptManifest: buildAgentTranscriptManifest(
        conversationInput.filter((item) =>
          parseAgentTranscriptMessageItem(item)?.messageId !== input.userMessageId
        )
      ),
      signal: input.signal,
      fetch: input.fetch
    });
    if (preparedRequestState !== turnState.latestProviderRequestState) {
      turnState.latestProviderRequestState = preparedRequestState;
      input.commitWorkspace((current) => ({
        workspace: {
          ...current,
          ai: {
            ...current.ai,
            ...(preparedRequestState
              ? { latestProviderRequestState: preparedRequestState }
              : {})
          }
        },
        value: undefined
      }));
    }
  }
  const currentRequestState: ProviderRequestBoundaryState = {
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
    ...(runtimeState.conversationContext.summaryRevision
      ? { summaryRevisionId: runtimeState.conversationContext.summaryRevision.id }
      : {}),
    latestUserMessageId: input.userMessageId,
    budgetGeneration: runtimeState.contextBudgetState.generation,
    ...(turnState.latestProviderRequestState?.transcriptSnapshotToken
      ? {
          transcriptSnapshotToken: turnState.latestProviderRequestState.transcriptSnapshotToken,
          ...(turnState.latestProviderRequestState.transcriptManifestHash
            ? { transcriptManifestHash: turnState.latestProviderRequestState.transcriptManifestHash }
            : {}),
          ...(turnState.latestProviderRequestState.transcriptSnapshotExpiresAt
            ? {
                transcriptSnapshotExpiresAt:
                  turnState.latestProviderRequestState.transcriptSnapshotExpiresAt
              }
            : {})
        }
      : {}),
    ...(turnState.latestProviderRequestState?.transcriptStartMessageId
      ? { transcriptStartMessageId: turnState.latestProviderRequestState.transcriptStartMessageId }
      : !turnState.latestProviderRequestState?.transcriptSnapshotToken
        ? { transcriptStartMessageId: input.userMessageId }
        : {}),
    ...(!exactContinuation && input.providerInputSnapshot.cacheBoundaryReason
      ? { attachmentBoundary: input.providerInputSnapshot.cacheBoundaryReason }
      : {})
  };
  const providerInputBoundaryReasons = new Set(
    getProviderInputReplayBoundaryReasons(
      [
        ...runtimeState.conversationContext.messages,
        {
          id: input.userMessageId,
          role: "user",
          providerInputSnapshot: input.providerInputSnapshot
        }
      ],
      {
        frames: turnState.workspaceAtAgentStart.ai.providerContextFrames ?? [],
        previousRequestState: turnState.latestProviderRequestState,
        currentRequestState
      }
    )
  );
  const response = await input.fetch("/api/ai/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: conversationInput,
      projectId: turnState.workspaceAtAgentStart.project.id,
      agentTurnId: input.agentTurnId,
      assistantMessageId: input.assistantMessageId,
      currentUserMessageId: input.userMessageId,
      continuation: exactContinuation,
      ...(leaseContinuation ? { leaseContinuation: true } : {}),
      ...((exactContinuation || leaseContinuation) && turnState.agentTurnLeaseId
        ? { leaseId: turnState.agentTurnLeaseId }
        : {}),
      ...((exactContinuation || leaseContinuation) && turnState.nextAgentLeaseSequence !== undefined
        ? { leaseSequence: turnState.nextAgentLeaseSequence }
        : {}),
      ...((exactContinuation || leaseContinuation) && turnState.agentContinuationToken
        ? { continuationToken: turnState.agentContinuationToken }
        : {}),
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      mode: input.agentTurnMode,
      capabilityIntent: { comparisonAnalysis: input.allowStructuredComparison },
      ...(turnState.canonicalRuntimeItem
        ? { previousRuntimeItem: turnState.canonicalRuntimeItem }
        : {}),
      ...(runtimeState.pendingServerDirective
        ? { directive: runtimeState.pendingServerDirective }
        : {}),
      contextBudgetState: runtimeState.contextBudgetState,
      diagnostics: {
        promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
        contextFrameCount: turnState.workspaceAtAgentStart.ai.providerContextFrames?.length ?? 0,
        appendedContextFrameCount:
          turnState.workspaceAtAgentStart.ai.providerContextFrames?.filter(
            (frame) => frame.anchorMessageId === input.userMessageId
          ).length ?? 0,
        ...(runtimeState.conversationContext.summaryRevision
          ? {
              conversationSummaryRevisionId:
                runtimeState.conversationContext.summaryRevision.id
            }
          : {}),
        ...(turnState.latestProviderRequestState
          ? { previousRequestState: turnState.latestProviderRequestState }
          : {}),
        requestState: currentRequestState,
        providerInputBoundaryReasons: [...providerInputBoundaryReasons]
      }
    }),
    signal: input.signal
  });
  runtimeState.pendingServerDirective = undefined;
  const attemptGuard = createAgentAttemptGuard();
  const requestStreamKey = `legacy-${runtimeState.requestSequence++}`;
  let activeAttemptInputTokens = 0;
  const batcher = createAgentStreamEventBatcher({
    onFlush: (events) => {
      const nowIso = input.nowIso();
      const bodyChanged = events.some(
        (event) => event.type === "final-delta" || event.type === "turn-attempt-reset"
      );
      input.commitWorkspace((current) => {
        const message = current.ai.messages.find(
          (candidate) => candidate.id === input.assistantMessageId
        );
        if (!message) {
          return { workspace: current, value: undefined };
        }
        const trace = applyAgentStreamEventsToTrace(
          message.agentTrace ?? {
            ...createAgentTrace(input.turnCreatedAt),
            agentTurnId: input.agentTurnId
          },
          events,
          nowIso
        );
        const body = bodyChanged
          ? sanitizeConversationSummaryStreamForDisplay(
              sanitizeConversationAssistantStreamForDisplay(
                [...runtimeState.streamedFinalTextByAttempt.values()].join("")
              )
            )
          : message.body;
        return {
          workspace: updateAiMessage(
            current,
            input.assistantMessageId,
            body,
            "streaming",
            { agentTrace: trace }
          ),
          value: undefined
        };
      });
    }
  });
  const flushBatch = () => batcher.flush();
  input.streamFlushSlot.set(flushBatch);
  let completeResult: AgentRouteResult;
  try {
    completeResult = await consumeAgentTurnStream(response, {
      signal: input.signal,
      onEvent: (event) => {
        if (!attemptGuard.accept(event)) {
          return;
        }
        if (event.type === "turn-complete" && event.continuationToken) {
          turnState.agentContinuationToken = event.continuationToken;
        }
        if (event.type === "turn-complete" && event.turnClosureToken) {
          turnState.turnClosureToken = event.turnClosureToken;
        }
        if (event.type === "turn-complete" && event.transcriptSnapshotToken &&
          event.transcriptManifestHash) {
          turnState.latestProviderRequestState = {
            ...currentRequestState,
            transcriptSnapshotToken: event.transcriptSnapshotToken,
            transcriptManifestHash: event.transcriptManifestHash
          };
        }
        if (event.type === "turn-complete" && event.transcriptManifestHash) {
          turnState.latestProviderTranscriptManifestHash = event.transcriptManifestHash;
        }
        if (event.type === "turn-complete" && event.assistantProviderOutputSnapshot) {
          turnState.latestAssistantProviderOutputSnapshot = event.assistantProviderOutputSnapshot;
          input.commitWorkspace((current) => {
            const assistant = current.ai.messages.find((message) => message.id === input.assistantMessageId);
            return {
              workspace: assistant
                ? updateAiMessage(current, input.assistantMessageId, assistant.body, assistant.status ?? "streaming", {
                    providerOutputSnapshot: event.assistantProviderOutputSnapshot
                  })
                : current,
              value: undefined
            };
          });
        }
        if (event.type === "turn-complete" && event.verifiedImageReferences) {
          input.commitWorkspace((current) => ({
            workspace: {
              ...current,
              ai: {
                ...current.ai,
                messages: current.ai.messages.map((message) => {
                  const verified = event.verifiedImageReferences?.find((item) => item.messageId === message.id);
                  return verified && message.providerInputSnapshot
                    ? {
                        ...message,
                        providerInputSnapshot: {
                          ...message.providerInputSnapshot,
                          attachmentRefs: verified.attachmentRefs
                        }
                      }
                    : message;
                })
              }
            },
            value: undefined
          }));
        }
        if (event.type === "turn-start") {
          if (event.leaseId) {
            turnState.agentTurnLeaseId = event.leaseId;
          }
          if (event.nextProviderSequence !== undefined) {
            turnState.nextAgentLeaseSequence = event.nextProviderSequence;
          }
          const serverToolProfile = event.effectiveToolProfile;
          if (
            serverToolProfile &&
            serverToolProfile !== "conversationSummary" &&
            event.runtimeItem
          ) {
            turnState.canonicalRuntimeItem = event.runtimeItem;
            turnState.workspaceAtAgentStart = input.commitWorkspace((current) => {
              const next = runtimeState.conversationContext.summaryRevision
                ? ensureAgentConversationSummaryBaselines(current, {
                    projectId: current.project.id,
                    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
                    summaryRevision: runtimeState.conversationContext.summaryRevision,
                    mode: input.agentTurnMode,
                    toolProfile: serverToolProfile,
                    runtimeItem: event.runtimeItem
                  })
                : appendAgentProviderRuntimeConfigurationFrame(current, {
                    projectId: current.project.id,
                    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
                    mode: input.agentTurnMode,
                    toolProfile: serverToolProfile,
                    runtimeItem: event.runtimeItem,
                    userMessageId: input.userMessageId,
                    framePlacement: "beforeUser"
                  });
              return { workspace: next, value: next };
            });
          }
          return;
        }
        if (event.type === "turn-attempt-reset") {
          runtimeState.streamedFinalTextByAttempt.delete(event.attemptId);
          activeAttemptInputTokens = 0;
          batcher.push(event);
          return;
        }
        if (event.type === "usage") {
          activeAttemptInputTokens = Math.max(
            activeAttemptInputTokens,
            event.usage.inputTokens
          );
          return;
        }
        if (event.type === "context") {
          if (
            event.context.pressure === "compact" ||
            (event.context.pressure === "prepare" && runtimeState.highestPressure === "normal")
          ) {
            runtimeState.highestPressure = event.context.pressure;
          }
          return;
        }
        if (event.type === "final-delta") {
          const attemptId =
            event.attemptId ?? attemptGuard.getActiveAttemptId() ?? requestStreamKey;
          runtimeState.streamedFinalTextByAttempt.set(
            attemptId,
            `${runtimeState.streamedFinalTextByAttempt.get(attemptId) ?? ""}${event.delta}`
          );
          batcher.push(event);
          return;
        }
        if (
          event.type === "reasoning-start" ||
          event.type === "reasoning-delta" ||
          event.type === "reasoning-end" ||
          event.type === "commentary-start" ||
          event.type === "commentary-delta" ||
          event.type === "commentary-end" ||
          event.type === "provider-tool-start" ||
          event.type === "provider-tool-update" ||
          event.type === "provider-tool-end"
        ) {
          batcher.push(event);
        }
      }
    });
  } finally {
    batcher.flush();
    if (input.streamFlushSlot.get() === flushBatch) {
      input.streamFlushSlot.set(null);
    }
  }
  runtimeState.contextBudgetState = updateAgentContextBudgetBaseline(
    runtimeState.contextBudgetState,
    Math.max(activeAttemptInputTokens, completeResult.usage?.inputTokens ?? 0)
  );
  const serverRequestState = toProviderRequestBoundaryState(
    completeResult.providerDiagnostics?.requestState
  );
  const providerDiagnostics = compactHistoricalProviderDiagnostics(
    completeResult.providerDiagnostics
  );
  if (serverRequestState || providerDiagnostics) {
    if (serverRequestState) {
      turnState.latestProviderRequestState = serverRequestState;
    }
    input.commitWorkspace((current) => {
      const assistant = current.ai.messages.find(
        (message) => message.id === input.assistantMessageId
      );
      if (!assistant?.agentTrace) {
        return { workspace: current, value: undefined };
      }
      const updated = updateAiMessage(
        current,
        input.assistantMessageId,
        assistant.body,
        "streaming",
        {
          agentTrace: {
            ...assistant.agentTrace,
            ...(serverRequestState
              ? {
                  providerRequestState:
                    compactHistoricalProviderRequestState(serverRequestState)
                }
              : {}),
            ...(providerDiagnostics ? { providerDiagnostics } : {})
          }
        }
      );
      return {
        workspace: {
          ...updated,
          ai: {
            ...updated.ai,
            ...(serverRequestState
              ? { latestProviderRequestState: serverRequestState }
              : {})
          }
        },
        value: undefined
      };
    });
  }
  runtimeState.latestProviderResponseId =
    completeResult.responseId || runtimeState.latestProviderResponseId;
  if (
    completeResult.context?.pressure === "compact" ||
    (completeResult.context?.pressure === "prepare" &&
      runtimeState.highestPressure === "normal")
  ) {
    runtimeState.highestPressure = completeResult.context.pressure;
  }
  return completeResult;
}

export function appendProjectStateFrameToConversationInput(
  input: AgentTurnProviderRequestAdapterInput,
  causalBinding?: AgentContextMarkerCausalBinding
): void {
  const { context, runtimeState, turnState } = input;
  if (context.kind === "comparison") {
    return;
  }
  const current = input.readWorkspace();
  const refreshedContext = buildTaskContext(current, {
    kind: context.kind,
    draft: input.draft,
    selectedObjectIds: context.objectIds
  });
  const refreshedProviderTaskContext = buildProviderTaskContext(refreshedContext);
  const beforeIds = new Set(
    (current.ai.providerContextFrames ?? []).map((frame) => frame.id)
  );
  const nextWorkspace = input.commitWorkspace((currentWorkspace) => {
    const next = appendAgentProviderStateFrames(currentWorkspace, {
      workspace: currentWorkspace,
      projectId: currentWorkspace.project.id,
      strategy: input.strategyKind,
      mode: input.agentTurnMode,
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      userMessageId: input.userMessageId,
      context: refreshedContext,
      providerTaskContext: refreshedProviderTaskContext,
      defaultMemoryContext: buildAgentDefaultMemoryContext(
        currentWorkspace,
        input.strategyKind
      ),
      summaryRevision: runtimeState.conversationContext.summaryRevision,
      framePlacement: "afterUser"
    });
    return { workspace: next, value: next };
  });
  turnState.workspaceAtAgentStart = nextWorkspace;
  const addedFrames = (nextWorkspace.ai.providerContextFrames ?? []).filter(
    (frame) => !beforeIds.has(frame.id)
  );
  if (addedFrames.length === 0) {
    return;
  }
  runtimeState.conversationInput = [
    ...runtimeState.conversationInput,
    ...addedFrames.map((frame) => providerContextFrameContinuationMarker(frame, causalBinding))
  ];
}

export async function compactConversationBeforeContinuation(
  input: AgentTurnProviderRequestAdapterInput,
  estimateBudget: AgentTurnProviderRequestAdapter["estimateBudget"]
): Promise<AgentCompactionResult> {
  const { runtimeState, turnState } = input;
  if (runtimeState.continuationCompactionCount >= 2) {
    return { status: "blocked", reason: "本回合已达到最多两次额外压缩，已安全停止继续发送。" };
  }
  const currentWorkspace = input.readWorkspace();
  const continuationBudget = estimateBudget(runtimeState.conversationInput);
  if (
    continuationBudget.estimatedOccupancyTokens <
      (input.conversationTokenLimits?.compactTokens ?? MORPHO_AGENT_CONTEXT_POLICY.compactTokens) &&
    continuationBudget.projectedInputItemCount <
      (input.conversationTokenLimits?.compactItemCount ?? MORPHO_AGENT_CONTEXT_POLICY.compactItemCount)
  ) {
    return { status: "not_needed", reason: "当前 Provider 输入未达到压缩阈值。" };
  }
  const plan = buildConversationCompactionPlan({
    workspace: currentWorkspace,
    providerTimelineBudget: continuationBudget,
    limits: input.conversationTokenLimits,
    force: "compact"
  });
  if (!plan) {
    return { status: "blocked", reason: "当前上下文没有完整且安全的压缩边界，已停止继续发送。" };
  }
  const compactionContextOptions = {
    sourceMessageIds: plan.sourceMessages.map((message) => message.id),
    providerInput: runtimeState.conversationInput
  };
  const retainedTailItems = buildConversationCompactionTailItems({
    messages: plan.remainingMessages,
    continuationItems: runtimeState.turnContinuationItems,
    contextFrames: buildAgentCompactionFreshContextFrames(currentWorkspace, compactionContextOptions)
  });
  const contextMarkers = buildAgentCompactionContextMarkers(currentWorkspace, compactionContextOptions);
  runtimeState.continuationCompactionCount += 1;

  const activityId = `${input.agentTurnId}:continuation-summary`;
  input.commitWorkspace((current) => {
    const assistant = current.ai.messages.find(
      (message) => message.id === input.assistantMessageId
    );
    if (!assistant?.agentTrace) {
      return { workspace: current, value: undefined };
    }
    return {
      workspace: updateAiMessage(
        current,
        input.assistantMessageId,
        assistant.body,
        "streaming",
        {
          agentTrace: startLocalAgentToolActivity(
            assistant.agentTrace,
            {
              toolCallId: activityId,
              toolName: "compact_conversation_history",
              activityKind: "contextRead",
              label: "整理讨论上下文",
              detail: "继续执行前整理较早对话"
            },
            input.nowIso()
          )
        }
      ),
      value: undefined
    };
  });
  if (!turnState.agentTurnLeaseId) {
    throw new Error("继续执行前缺少有效的 Agent Turn Lease。");
  }
  const summaryRequest = await requestConversationSummary(
    plan,
    input.signal,
    {
      projectId: currentWorkspace.project.id,
      agentTurnId: input.agentTurnId,
      mode: input.agentTurnMode,
      leaseId: turnState.agentTurnLeaseId,
      leaseSequence: turnState.nextAgentLeaseSequence,
      continuationToken: turnState.agentContinuationToken,
      retainedTailItems,
      contextMarkers,
      previousTranscriptManifestHash:
        turnState.latestProviderTranscriptManifestHash ??
        turnState.latestProviderRequestState?.transcriptManifestHash,
      previousTranscriptSnapshotToken: turnState.latestProviderRequestState?.transcriptSnapshotToken,
      onTranscriptSnapshotRefreshed: (token, manifestHash) => {
        if (!turnState.latestProviderRequestState) {
          return;
        }
        turnState.latestProviderRequestState = {
          ...turnState.latestProviderRequestState,
          transcriptSnapshotToken: token,
          transcriptManifestHash: manifestHash
        };
        input.commitWorkspace((current) => ({
          workspace: {
            ...current,
            ai: {
              ...current.ai,
              latestProviderRequestState: turnState.latestProviderRequestState
            }
          },
          value: undefined
        }));
      },
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
    input.fetch
  );
  turnState.providerTranscriptReset = true;
  turnState.agentTurnLeaseId = summaryRequest.leaseId ?? turnState.agentTurnLeaseId;
  const parsedSummary = summaryRequest.parsed;
  if (parsedSummary.status !== "ok" || !summaryRequest.compactionReceipt) {
    return { status: "blocked", reason: "继续执行前的对话摘要未通过校验，原始历史已保留。" };
  }
  const compactedWorkspace = input.commitWorkspace((current) => {
    const applied = applyConversationSummaryRevision(current, {
      summary: parsedSummary.summary,
      sourceMessageIds: plan.sourceMessages.map((message) => message.id),
      expectedPreviousRevisionId: plan.previousSummaryRevision?.id,
      estimatedInputTokens: plan.estimatedInputTokens,
      now: input.nowIso()
    });
    if (applied.status !== "applied") {
      throw new Error(applied.reason);
    }
    const framed = ensureAgentConversationSummaryBaselines(applied.workspace, {
      projectId: applied.workspace.project.id,
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      summaryRevision: applied.revision,
      mode: input.agentTurnMode
    });
    const assistant = framed.ai.messages.find(
      (message) => message.id === input.assistantMessageId
    );
    const next = assistant?.agentTrace
      ? updateAiMessage(
          framed,
          input.assistantMessageId,
          assistant.body,
          "streaming",
          {
            agentTrace: finishLocalAgentToolActivity(
              assistant.agentTrace,
              activityId,
              { state: "done", detail: "原始历史仍可查询" },
              input.nowIso()
            )
          }
        )
      : framed;
    return { workspace: next, value: next };
  });
  const refreshed = buildContinuousConversationContext({
    workspace: compactedWorkspace,
    limits: input.conversationTokenLimits
  });
  const framedCompactedWorkspace = input.commitWorkspace((current) => {
    const next = appendAgentProviderContextFrames(current, {
      ...input.providerFrameInput,
      workspace: current,
      defaultMemoryContext: buildAgentDefaultMemoryContext(current, input.strategyKind),
      summaryRevision: refreshed.summaryRevision
    });
    return { workspace: next, value: next };
  });
  turnState.workspaceAtAgentStart = framedCompactedWorkspace;
  const refreshedHistory = refreshed.messages.filter(
    (message) => message.id !== input.userMessageId
  );
  runtimeState.conversationContext = {
    laneKey: input.conversationLaneKey,
    summaryRevision: refreshed.summaryRevision,
    messages: refreshedHistory,
    rawMessageCount: refreshedHistory.length,
    coveredMessageCount: refreshed.coveredMessageCount,
    estimatedInputTokens: refreshed.estimatedInputTokens,
    pressure: refreshed.pressure
  };
  runtimeState.conversationInput = rebuildAgentPostCompactionTranscript({
    contextMarkers,
    receipt: summaryRequest.compactionReceipt,
    summary: parsedSummary.summary,
    retainedTailItems
  });
  const refreshedBudget = estimateBudget(runtimeState.conversationInput);
  runtimeState.contextBudgetState = advanceAgentContextBudgetGeneration(
    runtimeState.contextBudgetState,
    refreshedBudget.totalInputTokens
  );
  const refreshedPressure = classifyConversationPressure(
    refreshedBudget.estimatedOccupancyTokens,
    input.conversationTokenLimits ?? MORPHO_AGENT_CONTEXT_POLICY,
    refreshedBudget.projectedInputItemCount
  );
  runtimeState.lastCompactionItemCount = refreshedBudget.projectedInputItemCount;
  runtimeState.lastCompactionTokenCount = refreshedBudget.totalInputTokens;
  const progress = classifyCompactionProgress(continuationBudget, refreshedBudget);
  if (progress.status === "blocked") {
    return progress;
  }
  runtimeState.conversationContext = {
    ...runtimeState.conversationContext,
    estimatedInputTokens: refreshedBudget.totalInputTokens,
    pressure: refreshedPressure
  };
  runtimeState.highestPressure = runtimeState.conversationContext.pressure;
  return { status: "compacted", pressure: refreshedPressure };
}
