import { NextResponse } from "next/server";

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
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "@/features/workspace/agentPromptRegistry";
import {
  agentTurnLeaseDeniedResponse,
  continueAgentTurnLease,
  startAgentTurnLease
} from "@/server/auth/agentTurnLease";
import {
  encodeAgentRouteSse,
  type AgentProviderRequestState,
  type AgentRouteStreamEvent
} from "@/shared/agentStreamProtocol";
import type { AgentCanonicalRuntimeItem } from "@/shared/agentRuntimeItem";
import {
  buildAgentCacheItemManifest,
  compareAgentCacheManifests,
  hashAgentTools
} from "@/server/ai/agentCacheManifest";
import {
  AgentProviderContractError,
  buildAgentProviderContract,
  parseAgentRouteRequest
} from "@/server/ai/agentProviderContract";

export const runtime = "nodejs";
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
  const leaseAccess = validated.value.continuation
    ? await continueAgentTurnLease({
        leaseId: validated.value.leaseId!,
        agentTurnId: validated.value.agentTurnId,
        callKind: "provider"
      })
    : await startAgentTurnLease(validated.value.agentTurnId);
  if (leaseAccess.status === "denied") {
    return agentTurnLeaseDeniedResponse(leaseAccess);
  }
  const filteredToolProfile = contract.effectiveToolProfile;
  const requestState = buildProviderRequestState(
    contract.request,
    filteredToolProfile,
    contract.runtimeItem,
    validated.value.contextBudgetState?.generation
  );
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
          webSearchCallCount: leaseAccess.lease.webSearchCallCount
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
          enqueue({
            type: "turn-complete",
            attemptId: completedAttemptId,
            result: {
              ...execution.result,
              context: execution.context,
              providerDiagnostics: {
                ...execution.result.providerDiagnostics,
                toolProfile: filteredToolProfile,
                requestState,
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
          enqueue({ ...providerErrorEvent(error), attemptId: activeAttemptId });
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
        error.status === 401 || error.status === 403
          ? "OpenAI-compatible Provider 鉴权失败，请检查 MORPHO_AI_API_KEY。"
          : error.status === 400
            ? "OpenAI-compatible Provider 请求格式不兼容，请检查模型、tools 或图片输入。"
            : readableProviderDiagnostic(error.diagnostic) ?? "OpenAI-compatible Provider 调用失败，请稍后重试。",
      ...(error.code === "context_limit" ? { code: "context_limit" as const } : {})
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
  toolProfile: "standard" | "standardWithWebSearch",
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
