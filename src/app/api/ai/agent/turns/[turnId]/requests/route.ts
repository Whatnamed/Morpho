import { NextResponse } from "next/server";

import {
  acquireAgentTurnRequest,
  settleAgentTurnRequest,
  type AcquireAgentTurnRequestResult,
  type SettleAgentTurnRequestResult
} from "@/server/ai/agentTurnJournal";
import {
  invalidRequestResponse,
  isBoundedIdentifier,
  isRecord,
  isUuid,
  journalDeniedResponse,
  readBoundedJsonBody,
  unknownKeys
} from "@/server/ai/agentTurnRouteSupport";
import {
  APlusAgentProviderRequestError,
  buildAPlusExternalToolActionClaims,
  buildAPlusAgentProviderContract,
  hashAPlusAgentExternalRequest,
  normalizeAPlusProviderToolCalls,
  parseAPlusAgentProviderRequest
} from "@/server/ai/agentTurnProviderRequest";
import {
  loadOpenAiCompatibleConfig,
  type OpenAiCompatibleConfigResult
} from "@/server/ai/openaiCompatibleConfig";
import { withServerPromptCacheHint } from "@/server/ai/providerPromptCacheHint";
import {
  OpenAiCompatibleProviderError,
  streamOpenAiCompatibleResponse,
  type OpenAiCompatibleStreamHandlers
} from "@/server/ai/openaiCompatibleProvider";
import { registerAgentTurnExternalRequest } from "@/server/ai/agentTurnExternalCancellation";
import { requireAiRouteUser, type AiRouteUserAccessResult } from "@/server/auth/aiAccess";
import {
  encodeAgentTurnRequestSse,
  type AgentTurnRequestStreamEvent,
  type ServerExternalExecutionStatus
} from "@/shared/agentTurnJournalProtocol";

export const runtime = "nodejs";

export type AgentTurnRequestRouteDependencies = Readonly<{
  authenticate: () => Promise<AiRouteUserAccessResult>;
  loadConfig: () => OpenAiCompatibleConfigResult;
  acquireRequest: typeof acquireAgentTurnRequest;
  settleRequest: typeof settleAgentTurnRequest;
  streamProvider: typeof streamOpenAiCompatibleResponse;
  waitForSettlementRetry?: (delayMs: number) => Promise<void>;
}>;

type RouteContext = { params: Promise<{ turnId: string }> };

const defaultDependencies: AgentTurnRequestRouteDependencies = {
  authenticate: requireAiRouteUser,
  loadConfig: () => loadOpenAiCompatibleConfig(process.env),
  acquireRequest: acquireAgentTurnRequest,
  settleRequest: settleAgentTurnRequest,
  streamProvider: streamOpenAiCompatibleResponse
};

export function createAgentTurnRequestPostHandler(
  dependencies: AgentTurnRequestRouteDependencies = defaultDependencies
) {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    const { turnId } = await context.params;
    if (!isUuid(turnId)) {
      return invalidRequestResponse("serverTurnId 格式无效。");
    }
    const parsedBody = await readBoundedJsonBody(request);
    if (parsedBody.status === "failed") return parsedBody.response;
    if (!isRecord(parsedBody.value)) {
      return invalidRequestResponse("A+ Provider Request 必须是对象。");
    }
    const unknown = unknownKeys(parsedBody.value, [
      "localProjectId",
      "requestId",
      "stepSequence",
      "providerRequest"
    ]);
    if (unknown.length > 0) {
      return invalidRequestResponse(`请求包含不允许的字段：${unknown.join("、")}。`);
    }
    if (
      !isBoundedIdentifier(parsedBody.value.localProjectId) ||
      !isBoundedIdentifier(parsedBody.value.requestId) ||
      !Number.isSafeInteger(parsedBody.value.stepSequence) ||
      (parsedBody.value.stepSequence as number) < 1 ||
      (parsedBody.value.stepSequence as number) > 10_000
    ) {
      return invalidRequestResponse("localProjectId、requestId 或 stepSequence 格式无效。");
    }
    const providerRequest = parseAPlusAgentProviderRequest(parsedBody.value.providerRequest);
    if (providerRequest.status === "failed") {
      return invalidRequestResponse(providerRequest.reason, "invalid_provider_request");
    }
    const stepSequence = parsedBody.value.stepSequence as number;
    if (
      (stepSequence === 1 && providerRequest.value.continuationItems.length > 0) ||
      (stepSequence > 1 && providerRequest.value.continuationItems.length === 0)
    ) {
      return invalidRequestResponse(
        stepSequence === 1
          ? "首次 A+ Request 不能携带 Continuation Tool Items。"
          : "A+ Continuation 必须携带完整 Tool Call 和本地终态 Result。",
        "invalid_provider_continuation"
      );
    }

    const auth = await dependencies.authenticate();
    if (auth.status === "denied") {
      return NextResponse.json(
        {
          error: auth.error,
          code: auth.httpStatus === 401 ? "unauthenticated" : "auth_unavailable",
          recoverable: false
        },
        { status: auth.httpStatus }
      );
    }
    const config = dependencies.loadConfig();
    if (config.status === "failed") {
      return NextResponse.json(
        { error: config.reason, code: "provider_unavailable", recoverable: false },
        { status: 503 }
      );
    }

    let contract;
    try {
      contract = buildAPlusAgentProviderContract({
        localProjectId: parsedBody.value.localProjectId,
        request: providerRequest.value,
        webSearchEnabled: config.config.webSearchEnabled
      });
    } catch (error) {
      if (error instanceof APlusAgentProviderRequestError) {
        return NextResponse.json(
          { error: error.message, code: "invalid_provider_request", recoverable: false },
          { status: error.status }
        );
      }
      throw error;
    }
    const externalProviderRequest = withServerPromptCacheHint({
      config: config.config,
      request: contract.request,
      namespace: "agent",
      userId: auth.userId,
      localProjectId: parsedBody.value.localProjectId,
      promptContractVersion: providerRequest.value.promptContractVersion,
      toolProfile: contract.effectiveToolProfile,
      stableSystemPrefix: contract.stableSystemPrompt
    });
    const requestHash = hashAPlusAgentExternalRequest({
      model: config.config.model,
      reasoningEffort: config.config.reasoningEffort,
      providerRequest: externalProviderRequest
    });
    const identity = {
      serverTurnId: turnId,
      localProjectId: parsedBody.value.localProjectId,
      requestId: parsedBody.value.requestId,
      stepSequence
    };
    const acquired: AcquireAgentTurnRequestResult = await dependencies.acquireRequest({
      ...identity,
      requestHash
    });
    if (acquired.status === "denied") return journalDeniedResponse(acquired);
    if (!acquired.executionGranted) {
      return NextResponse.json({ ...acquired.snapshot, replayed: true });
    }

    return createProviderStreamResponse({
      identity,
      providerRequest: externalProviderRequest,
      config: config.config,
      dependencies
    });
  };
}

export const POST = createAgentTurnRequestPostHandler();

function createProviderStreamResponse(input: {
  identity: {
    serverTurnId: string;
    localProjectId: string;
    requestId: string;
    stepSequence: number;
  };
  providerRequest: Parameters<typeof streamOpenAiCompatibleResponse>[1];
  config: Parameters<typeof streamOpenAiCompatibleResponse>[0];
  dependencies: AgentTurnRequestRouteDependencies;
}): Response {
  const abortController = new AbortController();
  let closed = false;
  // Transport disconnect is only a display detach. External execution is
  // cancelled exclusively through the explicit cancellation endpoint.
  const unregister = registerAgentTurnExternalRequest(input.identity, abortController);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (event: AgentTurnRequestStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encodeAgentTurnRequestSse(event));
        } catch {
          closed = true;
        }
      };
      enqueue({
        type: "serverStatus",
        requestId: input.identity.requestId,
        stepSequence: input.identity.stepSequence,
        status: "providerRunning"
      });

      void (async () => {
        let activitySequence = 0;
        const handlers: OpenAiCompatibleStreamHandlers = {
          onEvent: (event) => {
            if (event.type === "unknown") return;
            activitySequence += 1;
            enqueue({
              type: "streamActivity",
              requestId: input.identity.requestId,
              stepSequence: input.identity.stepSequence,
              sequence: activitySequence,
              event
            });
          }
        };
        try {
          const result = await input.dependencies.streamProvider(
            input.config,
            input.providerRequest,
            handlers,
            abortController.signal
          );
          const toolCalls = normalizeAPlusProviderToolCalls(result.functionCalls);
          const toolCallIds = toolCalls.map((call) => call.callId);
          enqueue({
            type: "providerOutput",
            requestId: input.identity.requestId,
            stepSequence: input.identity.stepSequence,
            outputText: result.outputText,
            producedUserVisibleEffect: result.outputText.trim().length > 0,
            toolCallIds,
            toolCalls
          });
          const nextStatus: ServerExternalExecutionStatus = toolCallIds.length > 0
            ? "awaitingNextRequest"
            : "externallyCompleted";
          const settled = await settle(
            input,
            nextStatus,
            undefined,
            nextStatus === "awaitingNextRequest"
              ? buildAPlusExternalToolActionClaims(toolCalls)
              : undefined
          );
          if (settled.status === "ok") {
            enqueue({
              type: "serverStatus",
              requestId: input.identity.requestId,
              stepSequence: input.identity.stepSequence,
              status: nextStatus
            });
          } else {
            enqueue({
              type: "externalError",
              requestId: input.identity.requestId,
              stepSequence: input.identity.stepSequence,
              code: "journal_settlement_failed"
            });
          }
        } catch (error) {
          const cancelled = abortController.signal.aborted ||
            (error instanceof Error && error.name === "AbortError");
          const nextStatus = cancelled ? "externallyCancelled" as const : "externallyFailed" as const;
          const failureCode = cancelled ? undefined : boundedProviderFailureCode(error);
          const settled = await settle(input, nextStatus, failureCode);
          enqueue({
            type: "externalError",
            requestId: input.identity.requestId,
            stepSequence: input.identity.stepSequence,
            code: cancelled ? "provider_cancelled" : failureCode ?? "provider_failed"
          });
          if (settled.status === "ok") {
            enqueue({
              type: "serverStatus",
              requestId: input.identity.requestId,
              stepSequence: input.identity.stepSequence,
              status: nextStatus
            });
          }
        } finally {
          unregister();
          if (!closed) {
            try {
              controller.close();
            } catch {
              closed = true;
            }
          }
        }
      })();
    },
    cancel() {
      closed = true;
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

function settle(
  input: {
    identity: {
      serverTurnId: string;
      localProjectId: string;
      requestId: string;
      stepSequence: number;
    };
    dependencies: AgentTurnRequestRouteDependencies;
  },
  status: "awaitingNextRequest" | "externallyCompleted" | "externallyCancelled" | "externallyFailed",
  failureCode?: string,
  toolClaims?: Parameters<typeof settleAgentTurnRequest>[0]["toolClaims"]
): Promise<SettleAgentTurnRequestResult> {
  return settleWithBoundedRetry(input, status, failureCode, toolClaims);
}

async function settleWithBoundedRetry(
  input: {
    identity: {
      serverTurnId: string;
      localProjectId: string;
      requestId: string;
      stepSequence: number;
    };
    dependencies: AgentTurnRequestRouteDependencies;
  },
  status: "awaitingNextRequest" | "externallyCompleted" | "externallyCancelled" | "externallyFailed",
  failureCode?: string,
  toolClaims?: Parameters<typeof settleAgentTurnRequest>[0]["toolClaims"]
): Promise<SettleAgentTurnRequestResult> {
  const delays = [25, 75] as const;
  for (let attempt = 0; ; attempt += 1) {
    let result: SettleAgentTurnRequestResult;
    try {
      result = await input.dependencies.settleRequest({
        ...input.identity,
        status,
        ...(failureCode ? { failureCode } : {}),
        ...(toolClaims !== undefined ? { toolClaims } : {})
      });
    } catch {
      if (attempt >= delays.length) {
        return {
          status: "denied",
          httpStatus: 503,
          code: "journal_unavailable",
          error: "Server Turn Journal 结算暂时不可用。",
          recoverable: false
        };
      }
      await (input.dependencies.waitForSettlementRetry ?? wait)(delays[attempt]!);
      continue;
    }
    if (result.status === "ok" || result.httpStatus !== 503 || attempt >= delays.length) {
      return result;
    }
    await (input.dependencies.waitForSettlementRetry ?? wait)(delays[attempt]!);
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

function boundedProviderFailureCode(error: unknown): string {
  if (error instanceof OpenAiCompatibleProviderError) {
    if (error.code === "context_limit") return "provider_context_limit";
    if (error.code === "function_call_limit") return "provider_function_call_limit";
    return `provider_http_${Math.max(0, Math.min(999, error.status))}`;
  }
  return "provider_execution_failed";
}
