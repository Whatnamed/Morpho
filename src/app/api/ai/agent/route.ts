import { NextResponse } from "next/server";

import { parseConversationSummaryPayload } from "@/domain/morpho/conversationCompaction";
import { loadOpenAiCompatibleConfig } from "@/server/ai/openaiCompatibleConfig";
import {
  OpenAiCompatibleProviderError,
  streamOpenAiCompatibleResponse,
  type OpenAiCompatibleAgentStreamEvent,
  type OpenAiCompatibleResponseRequest
} from "@/server/ai/openaiCompatibleProvider";
import {
  createAgentContextLimits,
  executeAgentRequestWithContextBudget
} from "@/server/ai/agentContextBudget";
import {
  buildPromptCacheKey,
  hashStablePrefix
} from "@/server/ai/promptCache";
import { classifyProviderCacheStatus } from "@/server/ai/providerTokenUsage";
import {
  AGENT_COMPACTION_TRANSCRIPT_MARKER_TYPE,
  AGENT_COMPACTION_RECEIPT_VERSION,
  AGENT_TRANSCRIPT_MESSAGE_TYPE,
  buildAgentContextMarkerManifest,
  buildAgentDurableTranscriptManifest,
  createAgentTranscriptMessageItem,
  buildConversationSummaryRevisionId,
  buildAgentTranscriptManifest,
  hashConversationSummaryForReceipt,
  hashSourceMessageIds,
  parseAgentCompactionSourceEnvelope,
  parseAgentTranscriptMessageItem,
  readAgentContextStateMarkerCandidate,
  type AgentContextStateMarker,
  type AgentTranscriptManifestItem
} from "@/shared/agentCompactionProtocol";
import {
  createProviderOutputSnapshot,
  parseProviderInputSnapshotDurableReferences
} from "@/domain/morpho/providerInputSnapshot";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "@/features/workspace/agentPromptRegistry";
import {
  agentTurnLeaseDeniedResponse,
  continueAgentTurnLease,
  hashAgentTurnLeaseValue,
  markAgentTurnProviderFailure,
  startAgentTurnLease
} from "@/server/auth/agentTurnLease";
import {
  encodeAgentRouteSse,
  type AgentProviderRequestState,
  type AgentRouteStreamEvent
} from "@/shared/agentStreamProtocol";
import type { AgentCanonicalRuntimeItem, AgentToolProfile } from "@/shared/agentRuntimeItem";
import {
  buildAgentCacheItemManifest,
  compareAgentCacheManifests,
  hashAgentTools
} from "@/server/ai/agentCacheManifest";
import {
  AgentProviderContractError,
  buildAgentProviderContract,
  normalizeProviderOutputItemsForBinding,
  parseAgentContextStateMarker,
  parseAgentRouteRequest
} from "@/server/ai/agentProviderContract";
import {
  agentContinuationFailureMessage,
  AGENT_CONTINUATION_TOKEN_TTL_MS,
  AGENT_TRANSCRIPT_SNAPSHOT_TTL_MS,
  hashAgentContinuationItems,
  issueAgentContinuationToken,
  issueAgentTurnClosureToken,
  issueAgentTranscriptSnapshotToken,
  resolveAgentContinuationSecret,
  verifyAgentCompactionBinding,
  verifyAgentCompactionSourceBinding,
  verifyAgentContinuationBinding,
  verifyAgentContinuationToken,
  verifyAgentTranscriptSnapshotToken,
  type AgentContinuationClaims
} from "@/server/ai/agentContinuationToken";
import type { AgentTranscriptManifest } from "@/shared/agentCompactionProtocol";
import { requireAiRouteUser } from "@/server/auth/aiAccess";

export const runtime = "nodejs";

function collectVerifiedImageReferences(items: readonly unknown[]) {
  return items.flatMap((item) => {
    const transcriptMessage = parseAgentTranscriptMessageItem(item);
    if (!transcriptMessage || transcriptMessage.role !== "user" ||
      transcriptMessage.replayMode !== "liveInput" || !transcriptMessageHasImageBytes(transcriptMessage)) {
      return [];
    }
    const attachmentRefs = transcriptMessage.durableProviderItems.flatMap((providerItem) => {
      if (!providerItem || typeof providerItem !== "object" || !("content" in providerItem) ||
        !Array.isArray(providerItem.content)) {
        return [];
      }
      return providerItem.content.flatMap((part) =>
        part && typeof part === "object" && "text" in part && typeof part.text === "string"
          ? parseProviderInputSnapshotDurableReferences(part.text)
          : []
      );
    });
    return attachmentRefs.length > 0 ? [{ messageId: transcriptMessage.messageId, attachmentRefs }] : [];
  });
}
export const MAX_AGENT_REQUEST_BODY_BYTES = 36 * 1024 * 1024;

export async function POST(request: Request) {
  let body: unknown;
  try {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_AGENT_REQUEST_BODY_BYTES) {
      return NextResponse.json({ error: "Agent 请求体超过允许大小。" }, { status: 413 });
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_AGENT_REQUEST_BODY_BYTES) {
      return NextResponse.json({ error: "Agent 请求体超过允许大小。" }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "请求不是有效 JSON。" }, { status: 400 });
  }

  const validated = parseAgentRouteRequest(body);
  if (validated.status === "failed") {
    return NextResponse.json({ error: validated.reason }, { status: 400 });
  }

  const userAccess = await requireAiRouteUser();
  if (userAccess.status === "denied") {
    return NextResponse.json({ error: userAccess.error }, { status: userAccess.httpStatus });
  }

  const config = loadOpenAiCompatibleConfig(process.env);
  if (config.status === "failed") {
    return NextResponse.json({ error: config.reason }, { status: 503 });
  }

  let contract;
  try {
    contract = buildAgentProviderContract({
      request: validated.value,
      webSearchEnabled: config.config.webSearchEnabled
    });
  } catch (error) {
    if (error instanceof AgentProviderContractError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  const filteredToolProfile = contract.effectiveToolProfile;
  const continuationSecret = resolveAgentContinuationSecret(process.env);
  const transcriptManifest = buildAgentTranscriptManifest(contract.request.input);
  const durableInputManifest = buildAgentDurableTranscriptManifest(validated.value.input);
  const previousCompactionSummary = readPreviousCompactionSummaryBinding(validated.value.input) ??
    readVerifiedPreviousSnapshotSummary({
      state: validated.value.diagnostics?.previousRequestState,
      secret: continuationSecret,
      projectId: validated.value.projectId,
      userId: userAccess.userId,
      now: Date.now()
    });
  const requestContextMarkers = contextMarkersForSnapshot(validated.value.input);
  const requestContextMarkerManifest = buildAgentContextMarkerManifest(requestContextMarkers);
  const requestState = {
    ...buildProviderRequestState(
    contract.request,
    filteredToolProfile,
    contract.runtimeItem,
    validated.value.contextBudgetState?.generation
    ),
    transcriptManifestHash: durableInputManifest.manifestHash
  };
  const requestHash = hashAgentTurnLeaseValue({
    input: contract.request.input,
    tools: contract.request.tools ?? [],
    directive: validated.value.directive?.kind ?? null,
    compactionDescriptor: validated.value.compactionDescriptor ?? null
  });
  const requestManifestHash = hashAgentTurnLeaseValue(requestState.cacheItemManifest ?? []);
  const isSummaryRequest = validated.value.directive?.kind === "conversationSummary";
  const continuationKind = isSummaryRequest
    ? "conversationSummary" as const
    : validated.value.continuation
      ? "providerContinuation" as const
      : "postCompaction" as const;
  let continuationClaims: AgentContinuationClaims | undefined;
  // A continuation may only replay what the server itself produced. The lease
  // sequence proves ordering; the signed binding proves causality.
  if (validated.value.continuation || validated.value.leaseContinuation) {
    const verified = verifyAgentContinuationToken({
      token: validated.value.continuationToken,
      secret: continuationSecret,
      leaseId: validated.value.leaseId!,
      agentTurnId: validated.value.agentTurnId,
      expectedSequence: validated.value.leaseSequence!,
      now: Date.now()
    });
    if (verified.status === "failed") {
      return NextResponse.json(
        { error: agentContinuationFailureMessage(verified.reason), reason: verified.reason },
        { status: verified.reason === "secret_missing" ? 503 : 400 }
      );
    }
    continuationClaims = verified.claims;
    if (continuationKind === "providerContinuation") {
      if (verified.claims.summary) {
        return NextResponse.json(
          {
            error: agentContinuationFailureMessage("transcript_not_summary"),
            reason: "transcript_not_summary"
          },
          { status: 400 }
        );
      }
      const bound = verifyAgentContinuationBinding({
        claims: verified.claims,
        parsedInput: validated.value.input
      });
      if (bound.status === "failed") {
        return NextResponse.json(
          { error: agentContinuationFailureMessage(bound.reason), reason: bound.reason },
          { status: 400 }
        );
      }
    }
    if (continuationKind === "postCompaction") {
      const bound = verifyAgentCompactionBinding({
        claims: verified.claims,
        parsedInput: validated.value.input,
        now: Date.now()
      });
      if (bound.status === "failed") {
        return NextResponse.json(
          { error: agentContinuationFailureMessage(bound.reason), reason: bound.reason },
          { status: 400 }
        );
      }
    }
  }
  if (!validated.value.continuation && !validated.value.leaseContinuation && hasContextStateMarker(validated.value.input)) {
    return NextResponse.json(
      { error: agentContinuationFailureMessage("context_marker_forged"), reason: "context_marker_forged" },
      { status: 400 }
    );
  }
  const durableReplayBinding = verifyAgentDurableTranscriptRequest({
    input: validated.value.input,
    compactionRetainedTail: validated.value.compactionRetainedTail,
    previousRequestState: validated.value.diagnostics?.previousRequestState,
    secret: continuationSecret,
    projectId: validated.value.projectId,
    userId: userAccess.userId,
    currentUserMessageId: validated.value.currentUserMessageId,
    summaryRequest: isSummaryRequest,
    continuation: validated.value.continuation,
    leaseContinuation: validated.value.leaseContinuation,
    now: Date.now()
  });
  if (durableReplayBinding.status === "failed") {
    return NextResponse.json(
      { error: agentContinuationFailureMessage(durableReplayBinding.reason), reason: durableReplayBinding.reason },
      { status: durableReplayBinding.reason === "secret_missing" ? 503 : 400 }
    );
  }
  if (isSummaryRequest) {
    const snapshot = !continuationClaims && validated.value.previousTranscriptSnapshotToken
      ? verifyAgentTranscriptSnapshotToken({
          token: validated.value.previousTranscriptSnapshotToken,
          secret: continuationSecret,
          projectId: validated.value.projectId,
          userId: userAccess.userId,
          now: Date.now()
        })
      : undefined;
    const snapshotManifest: AgentTranscriptManifest | undefined = snapshot?.status === "ok"
      ? snapshot.claims.transcriptManifest
      : undefined;
    if (!continuationClaims && !snapshotManifest) {
      const reason = snapshot?.status === "failed" ? snapshot.reason : "compaction_source_unverified";
      return NextResponse.json(
        { error: agentContinuationFailureMessage(reason), reason },
        { status: reason === "secret_missing" ? 503 : 400 }
      );
    }
    const sourceManifest = continuationClaims?.transcriptManifest ?? snapshotManifest;
    if (!sourceManifest) {
      return NextResponse.json(
        { error: agentContinuationFailureMessage("compaction_source_unverified"), reason: "compaction_source_unverified" },
        { status: 400 }
      );
    }
    if (!summarySourceMetadataMatches(validated.value.input, validated.value.compactionDescriptor!)) {
      return NextResponse.json(
        { error: agentContinuationFailureMessage("compaction_source_forged"), reason: "compaction_source_forged" },
        { status: 400 }
      );
    }
    const sourceBinding = verifyAgentCompactionSourceBinding({
      claims: continuationClaims ?? {
        v: 5,
        leaseId: "snapshot",
        agentTurnId: validated.value.agentTurnId,
        sequence: validated.value.leaseSequence ?? 1,
        summary: true,
        inputItemCount: validated.value.input.length,
        inputHash: hashAgentContinuationItems(validated.value.input),
        outputHash: hashAgentContinuationItems([]),
        callIds: [],
        transcriptManifest: sourceManifest,
        prefixContextMarkerHashes: snapshot?.status === "ok"
          ? snapshot.claims.contextMarkerHashes
          : [],
        appendableContextMarkerHashes: [],
        compactionContextMarkerHashes: snapshot?.status === "ok"
          ? snapshot.claims.contextMarkerHashes
          : [],
        prefixContextMarkerManifest: snapshot?.status === "ok"
          ? snapshot.claims.contextMarkerManifest ?? []
          : [],
        appendableContextMarkerManifest: [],
        compactionContextMarkerManifest: snapshot?.status === "ok"
          ? snapshot.claims.contextMarkerManifest ?? []
          : [],
        exp: Date.now() + 1
      },
      parsedInput: validated.value.input,
      descriptor: validated.value.compactionDescriptor!,
      transcriptManifest: sourceManifest,
      contextMarkers: validated.value.compactionContextMarkers ?? [],
      retainedTail: validated.value.compactionRetainedTail ?? [],
      allowFreshUserTail: !continuationClaims,
      ...(snapshot?.status === "ok" && snapshot.claims.previousSummaryHash
        ? {
            previousSummaryHash: snapshot.claims.previousSummaryHash,
            previousSummaryRevisionId: snapshot.claims.previousSummaryRevisionId
          }
        : {})
    });
    if (sourceBinding.status === "failed") {
      return NextResponse.json(
        { error: agentContinuationFailureMessage(sourceBinding.reason), reason: sourceBinding.reason },
        { status: 400 }
      );
    }
  }
  const leaseAccess = validated.value.continuation || validated.value.leaseContinuation
    ? await continueAgentTurnLease({
        leaseId: validated.value.leaseId!,
        agentTurnId: validated.value.agentTurnId,
        continuationKind,
        expectedSequence: validated.value.leaseSequence!,
        requestHash,
        requestManifestHash,
        runtimeItemId: contract.runtimeItem.id
      })
    : await startAgentTurnLease({
        agentTurnId: validated.value.agentTurnId,
        initialRequestHash: requestHash,
        requestManifestHash,
        runtimeItemId: contract.runtimeItem.id
      });
  if (leaseAccess.status === "denied") {
    return agentTurnLeaseDeniedResponse(leaseAccess);
  }
  const continuationInputHash = hashAgentContinuationItems(validated.value.input);
  const cacheManifestDiagnostics = compareAgentCacheManifests({
    previous: contract.request.diagnostics?.previousRequestState,
    current: requestState
  });
  const providerInputBoundaryReasons = resolveProviderInputBoundaryReasons(
    contract.request.diagnostics?.previousRequestState,
    requestState,
    contract.request.diagnostics?.providerInputBoundaryReasons
  );
  const generatedPromptCacheKey =
    config.config.promptCache?.supportsPromptCacheKey &&
    config.config.promptCache.promptCacheKeyEnabled
      ? buildPromptCacheKey({
          projectId: validated.value.projectId,
          model: config.config.model,
          promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
          toolProfile: filteredToolProfile
        })
      : undefined;
  const providerRequest: OpenAiCompatibleResponseRequest = {
    ...contract.request,
    ...(generatedPromptCacheKey ? { promptCacheKey: generatedPromptCacheKey } : {}),
    ...(config.config.promptCache?.supportsPromptCacheRetention && config.config.promptCache.promptCacheRetention
      ? { promptCacheRetention: config.config.promptCache.promptCacheRetention }
      : {}),
    diagnostics: {
      ...contract.request.diagnostics,
      toolProfile: filteredToolProfile,
      stablePrefixHash: hashStablePrefix(
        `${firstSystemPrompt(contract.request)}\n${contract.runtimeItem.renderedText}`
      ),
      requestState,
      ...cacheManifestDiagnostics,
      providerInputBoundaryReasons,
      providerCacheKeyEnabled: config.config.promptCache?.promptCacheKeyEnabled ?? false,
      ...(config.config.promptCache?.promptCacheRetention
        ? { providerCacheRetention: config.config.promptCache.promptCacheRetention }
        : {})
    }
  };
  const providerAbortController = new AbortController();
  const contextAttemptIds: [string, string | undefined] = [`provider-attempt-${crypto.randomUUID()}`, undefined];
  let activeAttemptId = contextAttemptIds[0];
  let streamClosed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
    request.signal.removeEventListener("abort", abortFromRequest);
  };
  const abortFromRequest = () => {
    cleanup();
    providerAbortController.abort(request.signal.reason);
  };
  if (request.signal.aborted) {
    abortFromRequest();
  } else {
    request.signal.addEventListener("abort", abortFromRequest, { once: true });
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (event: AgentRouteStreamEvent) => {
        if (streamClosed) {
          return;
        }
        try {
          controller.enqueue(encodeAgentRouteSse(event));
        } catch {
          streamClosed = true;
        }
      };
      heartbeat = setInterval(() => enqueue({ type: "heartbeat" }), 12_000);
      void (async () => {
        enqueue({
          type: "turn-start",
          agentTurnId: validated.value.agentTurnId,
          attemptId: contextAttemptIds[0],
          startedAt: new Date().toISOString(),
          effectiveToolProfile: filteredToolProfile,
          runtimeItem: contract.runtimeItem,
          leaseId: leaseAccess.lease.id,
          leaseExpiresAt: leaseAccess.lease.expiresAt,
          providerCallCount: leaseAccess.lease.providerCallCount,
          webSearchCallCount: leaseAccess.lease.webSearchCallCount,
          nextProviderSequence: leaseAccess.lease.nextProviderSequence
        });
        try {
          const execution = await executeAgentRequestWithContextBudget(providerRequest, {
            limits: createAgentContextLimits(config.config.contextPolicy),
            budgetState: validated.value.contextBudgetState,
            execute: (preparedRequest, attempt) => {
              let attemptId = contextAttemptIds[attempt.index] ?? `provider-attempt-${crypto.randomUUID()}`;
              contextAttemptIds[attempt.index] = attemptId;
              activeAttemptId = attemptId;
              return streamOpenAiCompatibleResponse(
                config.config,
                preparedRequest,
                {
                  onEvent: (event) => {
                    if (event.type === "unknown") {
                      return;
                    }
                    enqueue(addProviderAttemptId(event, attemptId));
                  },
                  onBufferedFallback: ({ semanticEventsEmitted }) => {
                    if (!semanticEventsEmitted) {
                      return;
                    }
                    const nextAttemptId = `provider-attempt-${crypto.randomUUID()}`;
                    enqueue({
                      type: "turn-attempt-reset",
                      attemptId,
                      nextAttemptId,
                      message: "正在切换为完整响应重试"
                    });
                    attemptId = nextAttemptId;
                    activeAttemptId = nextAttemptId;
                    contextAttemptIds[attempt.index] = nextAttemptId;
                  }
                },
                providerAbortController.signal
              );
            },
            onRetry: ({ failed, next }) => {
              const failedAttemptId = contextAttemptIds[failed.index] ?? activeAttemptId;
              const nextAttemptId = `provider-attempt-${crypto.randomUUID()}`;
              contextAttemptIds[next.index] = nextAttemptId;
              activeAttemptId = nextAttemptId;
              enqueue({
                type: "turn-attempt-reset",
                attemptId: failedAttemptId,
                nextAttemptId,
                message: "正在重新整理当前语境"
              });
            }
          });
          const completedAttemptId = activeAttemptId;
          enqueue({ type: "context", context: execution.context });
          const boundOutputItems = normalizeProviderOutputItemsForBinding(execution.result.outputItems);
          const continuationTranscriptManifest = boundOutputItems
            ? buildAgentTranscriptManifest([
                ...validated.value.input,
                ...boundOutputItems
              ])
            : undefined;
          const closedAssistantText = execution.result.outputText.trim() ||
            (!isSummaryRequest ? "已完成当前执行。" : "");
          const assistantProviderOutputSnapshot = closedAssistantText
            ? createProviderOutputSnapshot(closedAssistantText)
            : undefined;
          const verifiedImageReferences = collectVerifiedImageReferences(validated.value.input);
          const closedTranscriptManifest = !isSummaryRequest
            ? buildAgentDurableTranscriptManifest([
                ...validated.value.input,
                ...(assistantProviderOutputSnapshot && validated.value.assistantMessageId
                  ? [createAgentTranscriptMessageItem({
                      messageId: validated.value.assistantMessageId,
                      role: "assistant",
                      providerItems: [{
                        role: "assistant" as const,
                        content: [{ type: "output_text" as const, text: assistantProviderOutputSnapshot.text }]
                      }]
                    })]
                  : [])
              ])
            : undefined;
          const snapshotIssuedAt = Date.now();
          const closedTranscriptSnapshotToken = continuationSecret && closedTranscriptManifest
            ? issueAgentTranscriptSnapshotToken({
                secret: continuationSecret,
                projectId: validated.value.projectId,
                userId: userAccess.userId,
                transcriptManifest: closedTranscriptManifest,
                contextMarkerManifest: requestContextMarkerManifest,
                ...(previousCompactionSummary ?? {}),
                now: snapshotIssuedAt
              })
            : undefined;
          const completedRequestState = closedTranscriptManifest
            ? {
                ...requestState,
                transcriptManifestHash: closedTranscriptManifest.manifestHash,
                ...(closedTranscriptSnapshotToken
                  ? {
                      transcriptSnapshotToken: closedTranscriptSnapshotToken,
                      transcriptSnapshotExpiresAt:
                        snapshotIssuedAt + AGENT_TRANSCRIPT_SNAPSHOT_TTL_MS
                    }
                  : {})
              }
            : requestState;
          const parsedSummary = isSummaryRequest
            ? parseConversationSummaryPayload(execution.result.outputText)
            : undefined;
          const compactionReceipt = isSummaryRequest &&
            validated.value.compactionDescriptor &&
            parsedSummary?.status === "ok"
             ? {
                 receiptVersion: AGENT_COMPACTION_RECEIPT_VERSION,
                 ...validated.value.compactionDescriptor,
                summaryHash: hashConversationSummaryForReceipt(parsedSummary.summary),
                summaryRevisionId: buildConversationSummaryRevisionId({
                  previousSummaryRevisionId: validated.value.compactionDescriptor.previousSummaryRevisionId,
                  sourceMessageIdsHash: validated.value.compactionDescriptor.sourceMessageIdsHash,
                  summaryHash: hashConversationSummaryForReceipt(parsedSummary.summary)
                }),
                leaseId: leaseAccess.lease.id,
                agentTurnId: validated.value.agentTurnId,
                sequence: leaseAccess.lease.nextProviderSequence,
                expiresAt: Date.now() + AGENT_CONTINUATION_TOKEN_TTL_MS
              }
            : undefined;
          const continuationToken = continuationSecret && boundOutputItems &&
            (!isSummaryRequest || compactionReceipt)
            ? issueAgentContinuationToken({
                secret: continuationSecret,
                leaseId: leaseAccess.lease.id,
                agentTurnId: validated.value.agentTurnId,
                sequence: leaseAccess.lease.nextProviderSequence,
                summary: isSummaryRequest,
                inputItemCount: validated.value.input.length,
                inputHash: continuationInputHash,
                outputHash: hashAgentContinuationItems(boundOutputItems),
                callIds: execution.result.functionCalls.map((call) => call.callId),
                 transcriptManifest: continuationTranscriptManifest ?? buildAgentTranscriptManifest([]),
                 prefixContextMarkerManifest: buildAgentContextMarkerManifest(
                   contextMarkersFromInput(validated.value.input)
                 ),
                 appendableContextMarkerManifest: isSummaryRequest
                   ? buildAgentContextMarkerManifest(validated.value.compactionContextMarkers ?? [])
                   : [],
                 compactionContextMarkerManifest: isSummaryRequest
                   ? buildAgentContextMarkerManifest(validated.value.compactionContextMarkers ?? [])
                   : requestContextMarkerManifest,
                 ...(previousCompactionSummary ?? {}),
                 ...(compactionReceipt ? { compactionReceipt } : {}),
                now: Date.now()
              })
            : undefined;
          const turnClosureToken = continuationSecret &&
            !isSummaryRequest &&
            closedTranscriptManifest &&
            assistantProviderOutputSnapshot &&
            validated.value.currentUserMessageId &&
            validated.value.assistantMessageId
            ? issueAgentTurnClosureToken({
                secret: continuationSecret,
                userId: userAccess.userId,
                projectId: validated.value.projectId,
                leaseId: leaseAccess.lease.id,
                agentTurnId: validated.value.agentTurnId,
                leaseSequence: leaseAccess.lease.nextProviderSequence,
                currentUserMessageId: validated.value.currentUserMessageId,
                assistantMessageId: validated.value.assistantMessageId,
                transcriptManifestHash: closedTranscriptManifest.manifestHash,
                providerOutputSnapshotHash: assistantProviderOutputSnapshot.contentHash,
                terminalFunctionCalls: execution.result.functionCalls.length === 0,
                now: Date.now()
              })
            : undefined;
          enqueue({
            type: "turn-complete",
            attemptId: completedAttemptId,
            ...(continuationToken ? { continuationToken } : {}),
            ...(continuationTranscriptManifest
              ? { transcriptManifestHash: continuationTranscriptManifest.manifestHash }
              : {}),
            ...(closedTranscriptSnapshotToken
              ? { transcriptSnapshotToken: closedTranscriptSnapshotToken }
              : {}),
            ...(turnClosureToken ? { turnClosureToken } : {}),
            ...(assistantProviderOutputSnapshot
              ? { assistantProviderOutputSnapshot }
              : {}),
            ...(verifiedImageReferences.length > 0 ? { verifiedImageReferences } : {}),
            ...(compactionReceipt ? { compactionReceipt } : {}),
            result: {
              ...execution.result,
              context: execution.context,
              providerDiagnostics: {
                ...execution.result.providerDiagnostics,
                toolProfile: filteredToolProfile,
                requestState: completedRequestState,
                ...cacheManifestDiagnostics,
                providerInputBoundaryReasons,
                providerCacheKeyEnabled: config.config.promptCache?.promptCacheKeyEnabled ?? false,
                ...(config.config.promptCache?.promptCacheRetention
                  ? { providerCacheRetention: config.config.promptCache.promptCacheRetention }
                  : {}),
                cacheStatus: classifyProviderCacheStatus(
                  execution.result.usage?.inputTokens ?? 0,
                  execution.result.usage?.cachedInputTokens
                ),
                compactedThisTurn: execution.context.compacted || execution.context.retried
              }
            }
          });
        } catch (error) {
          const providerFailureOutcome = error instanceof DOMException && error.name === "AbortError"
            ? "cancelledDuringProvider" as const
            : "failedDuringProvider" as const;
          const failureProof = await markAgentTurnProviderFailure({
            leaseId: leaseAccess.lease.id,
            agentTurnId: validated.value.agentTurnId,
            outcome: providerFailureOutcome,
            expectedProviderSequence: leaseAccess.lease.nextProviderSequence
          });
          const event = providerErrorEvent(error);
          enqueue({
            ...event,
            error: failureProof.status === "marked"
              ? event.error
              : `${event.error} Provider 失败终态未能建立，Lease 保持待恢复状态。`,
            ...(failureProof.status === "marked" ? { providerFailureOutcome } : {}),
            attemptId: activeAttemptId
          });
        } finally {
          cleanup();
          if (!streamClosed) {
            try {
              controller.close();
            } catch {
              streamClosed = true;
            }
          }
        }
      })();
    },
    cancel() {
      streamClosed = true;
      cleanup();
      providerAbortController.abort(new DOMException("The Agent stream consumer cancelled the response.", "AbortError"));
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

function addProviderAttemptId(
  event: Exclude<OpenAiCompatibleAgentStreamEvent, { type: "unknown" }>,
  attemptId: string
): AgentRouteStreamEvent {
  return { ...event, attemptId };
}

function providerErrorEvent(error: unknown): Extract<AgentRouteStreamEvent, { type: "turn-error" }> {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      type: "turn-error",
      error: "当前 Agent 回合已取消。已完成的过程和结果会保留。",
      code: "interrupted"
    };
  }

  if (error instanceof OpenAiCompatibleProviderError) {
    return {
      type: "turn-error",
      error:
        error.code === "function_call_limit"
          ? "本次 Provider 返回超过 64 个工具调用，未执行。"
          : error.status === 401 || error.status === 403
          ? "OpenAI-compatible Provider 鉴权失败，请检查 MORPHO_AI_API_KEY。"
          : error.status === 400
            ? "OpenAI-compatible Provider 请求格式不兼容，请检查模型、tools 或图片输入。"
            : readableProviderDiagnostic(error.diagnostic) ?? "OpenAI-compatible Provider 调用失败，请稍后重试。",
      ...(error.code === "context_limit"
        ? { code: "context_limit" as const }
        : error.code === "function_call_limit"
          ? { code: "function_call_limit" as const }
          : {})
    };
  }

  return {
    type: "turn-error",
    error: "OpenAI-compatible Provider 网络调用失败，请稍后重试。"
  };
}

function firstSystemPrompt(request: OpenAiCompatibleResponseRequest): string {
  const system = request.input.find(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "role" in item &&
      item.role === "system" &&
      "content" in item &&
      Array.isArray(item.content)
  ) as { content: Array<{ text?: unknown }> } | undefined;
  return system?.content.map((part) => (typeof part.text === "string" ? part.text : "")).join("\n") ?? "";
}

function buildProviderRequestState(
  request: OpenAiCompatibleResponseRequest,
  toolProfile: AgentToolProfile,
  runtimeItem: AgentCanonicalRuntimeItem,
  budgetGeneration?: number
): AgentProviderRequestState {
  const supplied = request.diagnostics?.requestState;
  return {
    promptContractVersion:
      typeof supplied?.promptContractVersion === "string" && supplied.promptContractVersion.trim()
        ? supplied.promptContractVersion
        : MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
    toolProfile,
    ...(typeof supplied?.summaryRevisionId === "string" && supplied.summaryRevisionId
      ? { summaryRevisionId: supplied.summaryRevisionId }
      : {}),
    ...(typeof supplied?.latestUserMessageId === "string" && supplied.latestUserMessageId
      ? { latestUserMessageId: supplied.latestUserMessageId }
      : {}),
    providerInputPrefixHash: hashStablePrefix(
      JSON.stringify(request.input, (key, value) => key === "image_url" ? "[image-input]" : value)
    ),
    runtimeItem,
    cacheItemManifest: buildAgentCacheItemManifest(request.input),
    toolsHash: hashAgentTools(request.tools),
    ...(budgetGeneration !== undefined ? { budgetGeneration } : {}),
    ...(isProviderInputBoundaryReason(supplied?.attachmentBoundary)
      ? { attachmentBoundary: supplied.attachmentBoundary }
      : {}),
    ...(typeof supplied?.transcriptManifestHash === "string" && supplied.transcriptManifestHash
      ? { transcriptManifestHash: supplied.transcriptManifestHash }
      : {}),
    ...(typeof supplied?.transcriptSnapshotToken === "string" && supplied.transcriptSnapshotToken
      ? { transcriptSnapshotToken: supplied.transcriptSnapshotToken }
      : {}),
    ...(typeof supplied?.transcriptSnapshotExpiresAt === "number" &&
    Number.isSafeInteger(supplied.transcriptSnapshotExpiresAt) &&
    supplied.transcriptSnapshotExpiresAt > 0
      ? { transcriptSnapshotExpiresAt: supplied.transcriptSnapshotExpiresAt }
      : {}),
    ...(typeof supplied?.transcriptStartMessageId === "string" && supplied.transcriptStartMessageId
      ? { transcriptStartMessageId: supplied.transcriptStartMessageId }
      : {})
  };
}

function resolveProviderInputBoundaryReasons(
  previous: AgentProviderRequestState | undefined,
  current: AgentProviderRequestState,
  supplied: readonly string[] | undefined
): string[] {
  const reasons = new Set<string>(
    (supplied ?? []).filter((reason) =>
      reason === "imageInput" ||
      reason === "legacyProviderInput" ||
      reason === "documentSnapshotUnavailable"
    )
  );
  const crossedIntoCurrentUser =
    !previous ||
    !current.latestUserMessageId ||
    previous.latestUserMessageId !== current.latestUserMessageId;
  if (current.attachmentBoundary && crossedIntoCurrentUser) {
    reasons.add(current.attachmentBoundary);
  }
  if (previous?.promptContractVersion && previous.promptContractVersion !== current.promptContractVersion) {
    reasons.add("promptContractChanged");
  }
  if (previous?.toolProfile && previous.toolProfile !== current.toolProfile) {
    reasons.add("toolProfileChanged");
  }
  if (previous && previous.summaryRevisionId !== current.summaryRevisionId) {
    reasons.add("compaction");
  }
  return [...reasons];
}

function isProviderInputBoundaryReason(value: unknown): value is NonNullable<AgentProviderRequestState["attachmentBoundary"]> {
  return value === "imageInput" ||
    value === "legacyProviderInput" ||
    value === "documentSnapshotUnavailable" ||
    value === "toolProfileChanged" ||
    value === "promptContractChanged" ||
    value === "compaction";
}

function readableProviderDiagnostic(diagnostic: string | undefined): string | undefined {
  const trimmed = diagnostic?.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase();
  if (normalized.includes("<!doctype html") || normalized.includes("<html") || normalized.includes("bad gateway")) {
    return "OpenAI-compatible Provider 暂时不可用或上游返回 502，请稍后重试。";
  }

  return trimmed.slice(0, 240);
}

function contextMarkersFromInput(input: readonly unknown[]): AgentContextStateMarker[] {
  return input.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item) ||
      !("type" in item) || item.type !== "morpho_context_state") {
      return [];
    }
    const marker = parseAgentContextStateMarker(item as Record<string, unknown>);
    return marker ? [marker] : [];
  });
}

function contextMarkersForSnapshot(input: readonly unknown[]): AgentContextStateMarker[] {
  const markers = input.flatMap(contextMarkersFromSnapshotItem);
  const unique = markers.filter((marker, index) =>
    markers.findIndex((candidate) => candidate.contentHash === marker.contentHash) === index
  );
  return [
    ...unique.filter((marker) => !contextMarkerFollowsCompactedTail(marker)),
    ...unique.filter(contextMarkerFollowsCompactedTail)
  ];
}

function contextMarkerFollowsCompactedTail(marker: AgentContextStateMarker): boolean {
  return marker.causalBindingHash !== undefined ||
    marker.placement === "afterUser" ||
    marker.placement === "afterAssistant";
}

function contextMarkersFromSnapshotItem(item: unknown): AgentContextStateMarker[] {
  if (
    typeof item === "object" && item !== null && !Array.isArray(item) &&
    "type" in item && item.type === AGENT_COMPACTION_TRANSCRIPT_MARKER_TYPE &&
    "retainedTail" in item && Array.isArray(item.retainedTail)
  ) {
    return item.retainedTail.flatMap(contextMarkersFromSnapshotItem);
  }
  const candidate = typeof item === "object" && item !== null && !Array.isArray(item) &&
    "type" in item && item.type === "morpho_context_state"
    ? item as Record<string, unknown>
    : readAgentContextStateMarkerCandidate(item);
  if (!candidate) {
    return [];
  }
  const marker = parseAgentContextStateMarker(candidate);
  return marker ? [marker] : [];
}

function readVerifiedPreviousSnapshotSummary(input: {
  state?: AgentProviderRequestState;
  secret?: string;
  projectId: string;
  userId: string;
  now: number;
}): { previousSummaryHash: string; previousSummaryRevisionId: string } | undefined {
  if (!input.state?.transcriptSnapshotToken || !input.state.transcriptManifestHash) {
    return undefined;
  }
  const verified = verifyAgentTranscriptSnapshotToken({
    token: input.state.transcriptSnapshotToken,
    secret: input.secret,
    projectId: input.projectId,
    userId: input.userId,
    now: input.now
  });
  if (
    verified.status !== "ok" ||
    verified.claims.transcriptManifest.manifestHash !== input.state.transcriptManifestHash ||
    !verified.claims.previousSummaryHash ||
    !verified.claims.previousSummaryRevisionId
  ) {
    return undefined;
  }
  return {
    previousSummaryHash: verified.claims.previousSummaryHash,
    previousSummaryRevisionId: verified.claims.previousSummaryRevisionId
  };
}

function transcriptMessageHasImageBytes(
  message: NonNullable<ReturnType<typeof parseAgentTranscriptMessageItem>>
): boolean {
  return Boolean(message?.providerItems.some((providerItem) =>
    typeof providerItem === "object" && providerItem !== null && !Array.isArray(providerItem) &&
    "content" in providerItem && Array.isArray(providerItem.content) &&
    providerItem.content.some((part) =>
      typeof part === "object" && part !== null && !Array.isArray(part) &&
      "type" in part && part.type === "input_image" &&
      "image_url" in part && typeof part.image_url === "string"
    )
  ));
}

function sameTranscriptManifestItem(
  left: AgentTranscriptManifestItem,
  right: AgentTranscriptManifestItem | undefined
): boolean {
  if (!right) {
    return false;
  }
  return left.kind === right.kind &&
    left.hash === right.hash &&
    left.role === right.role &&
    left.callId === right.callId &&
    left.messageId === right.messageId &&
    left.anchorMessageId === right.anchorMessageId;
}

function verifyAgentDurableTranscriptRequest(input: {
  input: readonly unknown[];
  compactionRetainedTail?: readonly unknown[];
  previousRequestState?: AgentProviderRequestState;
  secret?: string;
  projectId: string;
  userId: string;
  currentUserMessageId?: string;
  summaryRequest: boolean;
  continuation: boolean;
  leaseContinuation: boolean;
  now: number;
}): { status: "ok" } | {
  status: "failed";
  reason: "secret_missing" | "durable_replay_unverified" | "live_input_invalid";
} {
  const transcriptMessages = collectAgentTranscriptMessages([
    ...input.input,
    ...(input.compactionRetainedTail ?? [])
  ]);
  const liveMessages = transcriptMessages.filter((message) => message.replayMode === "liveInput");
  const messageIds = transcriptMessages.map((message) => message.messageId);
  const duplicateMessageId = new Set(messageIds).size !== messageIds.length;
  const currentLive = liveMessages[0];
  const summaryWithoutFreshInput = input.summaryRequest && !input.currentUserMessageId;
  const signedLegacyContinuationWithoutLiveInput =
    (input.continuation || input.leaseContinuation) &&
    !input.currentUserMessageId &&
    liveMessages.length === 0;
  if (
    (summaryWithoutFreshInput || signedLegacyContinuationWithoutLiveInput
      ? liveMessages.length !== 0
      : !input.currentUserMessageId || liveMessages.length !== 1 ||
        currentLive?.role !== "user" ||
        currentLive.messageId !== input.currentUserMessageId ||
        transcriptMessages.at(-1)?.messageId !== input.currentUserMessageId ||
        transcriptMessages.some((message) =>
          message.messageId !== input.currentUserMessageId && message.replayMode !== "durableReplay"
        ))
  ) {
    return { status: "failed", reason: "live_input_invalid" };
  }
  if (duplicateMessageId) {
    return { status: "failed", reason: "durable_replay_unverified" };
  }
  if (input.summaryRequest || input.continuation || input.leaseContinuation) {
    return { status: "ok" };
  }
  if (hasUnwrappedConversationOrProviderMessage(input.input)) {
    return { status: "failed", reason: "durable_replay_unverified" };
  }
  const replayMessages = transcriptMessages.filter((message) => message.replayMode === "durableReplay");
  const hasPreviousSnapshot = Boolean(
    input.previousRequestState?.transcriptSnapshotToken || input.previousRequestState?.transcriptManifestHash
  );
  if (replayMessages.length === 0 && !hasPreviousSnapshot) {
    return { status: "ok" };
  }
  if (!input.secret) {
    return { status: "failed", reason: "secret_missing" };
  }
  const snapshot = verifyAgentTranscriptSnapshotToken({
    token: input.previousRequestState?.transcriptSnapshotToken,
    secret: input.secret,
    projectId: input.projectId,
    userId: input.userId,
    now: input.now
  });
  if (snapshot.status !== "ok" ||
    snapshot.claims.transcriptManifest.manifestHash !== input.previousRequestState?.transcriptManifestHash) {
    return { status: "failed", reason: "durable_replay_unverified" };
  }
  const actual = buildAgentDurableTranscriptManifest(replayMessages).items;
  const signed = snapshot.claims.transcriptManifest.items;
  if (actual.length !== signed.length || actual.some((item, index) =>
    !sameTranscriptManifestItem(item, signed[index])
  )) {
    return { status: "failed", reason: "durable_replay_unverified" };
  }
  return { status: "ok" };
}

function hasUnwrappedConversationOrProviderMessage(items: readonly unknown[]) {
  return items.some((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return false;
    }
    if ("type" in item && item.type === AGENT_TRANSCRIPT_MESSAGE_TYPE) {
      return false;
    }
    if (readAgentContextStateMarkerCandidate(item)) {
      return false;
    }
    return ("type" in item && item.type === "message") ||
      ("role" in item && (item.role === "user" || item.role === "assistant"));
  });
}

function collectAgentTranscriptMessages(
  items: readonly unknown[]
): NonNullable<ReturnType<typeof parseAgentTranscriptMessageItem>>[] {
  return items.flatMap((item) => {
    const message = parseAgentTranscriptMessageItem(item);
    if (message) {
      return [message];
    }
    if (
      typeof item === "object" && item !== null && !Array.isArray(item) &&
      "type" in item && item.type === AGENT_COMPACTION_TRANSCRIPT_MARKER_TYPE &&
      "retainedTail" in item && Array.isArray(item.retainedTail)
    ) {
      return collectAgentTranscriptMessages(item.retainedTail);
    }
    return [];
  });
}

function readPreviousCompactionSummaryBinding(
  input: readonly unknown[]
): { previousSummaryHash: string; previousSummaryRevisionId: string } | undefined {
  const markers = input.filter((item) =>
    typeof item === "object" && item !== null && !Array.isArray(item) &&
    "type" in item && item.type === AGENT_COMPACTION_TRANSCRIPT_MARKER_TYPE
  );
  if (markers.length !== 1) {
    return undefined;
  }
  const marker = markers[0];
  if (
    typeof marker !== "object" || marker === null || Array.isArray(marker) ||
    !("summaryHash" in marker) || typeof marker.summaryHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(marker.summaryHash) ||
    !("summaryRevisionId" in marker) || typeof marker.summaryRevisionId !== "string" ||
    !marker.summaryRevisionId
  ) {
    return undefined;
  }
  return {
    previousSummaryHash: marker.summaryHash,
    previousSummaryRevisionId: marker.summaryRevisionId
  };
}

function hasContextStateMarker(input: readonly unknown[]): boolean {
  return input.some((item) =>
    typeof item === "object" && item !== null && !Array.isArray(item) &&
    "type" in item && item.type === "morpho_context_state"
  );
}

function summarySourceMetadataMatches(
  input: readonly unknown[],
  descriptor: {
    sourceStartMessageId: string;
    sourceEndMessageId: string;
    sourceMessageCount: number;
    sourceMessageIdsHash: string;
  }
): boolean {
  const structuredSource = parseAgentCompactionSourceEnvelope(input[0]);
  if (structuredSource) {
    return structuredSource.sourceStartMessageId === descriptor.sourceStartMessageId &&
      structuredSource.sourceEndMessageId === descriptor.sourceEndMessageId &&
      structuredSource.sourceMessageCount === descriptor.sourceMessageCount &&
      structuredSource.sourceMessageIdsHash === descriptor.sourceMessageIdsHash;
  }
  const first = input[0];
  if (typeof first !== "object" || first === null || Array.isArray(first) ||
    !("content" in first) || !Array.isArray(first.content)) {
    return false;
  }
  const text = first.content
    .filter((part): part is { text: string } => typeof part === "object" && part !== null &&
      !Array.isArray(part) && "text" in part && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  const match = text.match(/sourceMessageIds:\s*(\[[^\n]+\])/);
  if (!match) {
    return false;
  }
  let ids: unknown;
  try {
    ids = JSON.parse(match[1]!);
  } catch {
    return false;
  }
  return Array.isArray(ids) &&
    ids.length === descriptor.sourceMessageCount &&
    ids.every((id) => typeof id === "string") &&
    ids[0] === descriptor.sourceStartMessageId &&
    ids.at(-1) === descriptor.sourceEndMessageId &&
    hashSourceMessageIds(ids) === descriptor.sourceMessageIdsHash;
}
