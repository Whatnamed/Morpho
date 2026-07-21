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
import { filterAgentRequestForConfig } from "@/server/ai/agentRoute";
import { aiAccessDeniedResponse, guardAiRoute, requireAiRouteUser } from "@/server/auth/aiAccess";
import { encodeAgentRouteSse, type AgentRouteStreamEvent } from "@/shared/agentStreamProtocol";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求不是有效 JSON。" }, { status: 400 });
  }

  const validated = validateAgentRouteRequest(body);
  if (validated.status === "failed") {
    return NextResponse.json({ error: validated.reason }, { status: 400 });
  }

  const access = validated.agentContinuation ? await requireAiRouteUser() : await guardAiRoute("text");
  if (access.status === "denied") {
    return aiAccessDeniedResponse(access);
  }

  const config = loadOpenAiCompatibleConfig(process.env);
  if (config.status === "failed") {
    return NextResponse.json({ error: config.reason }, { status: 503 });
  }

  const providerRequest = filterAgentRequestForConfig(validated.value, config.config);
  const providerAbortController = new AbortController();
  const attemptIds = [`provider-attempt-${crypto.randomUUID()}`, `provider-attempt-${crypto.randomUUID()}`] as const;
  let activeAttemptIndex: 0 | 1 = 0;
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
          ...(validated.agentTurnId ? { agentTurnId: validated.agentTurnId } : {}),
          attemptId: attemptIds[0],
          startedAt: new Date().toISOString()
        });
        try {
          const execution = await executeAgentRequestWithContextBudget(providerRequest, {
            limits: createAgentContextLimits(config.config.contextPolicy),
            baselineInputTokens: validated.contextBudgetBaselineTokens,
            execute: (preparedRequest, attempt) => {
              activeAttemptIndex = attempt.index;
              const attemptId = attemptIds[attempt.index];
              return streamOpenAiCompatibleResponse(
                config.config,
                preparedRequest,
                {
                  onEvent: (event) => {
                    if (event.type === "unknown") {
                      return;
                    }
                    enqueue(addProviderAttemptId(event, attemptId));
                  }
                },
                providerAbortController.signal
              );
            },
            onRetry: ({ failed, next }) => {
              activeAttemptIndex = next.index;
              enqueue({
                type: "turn-attempt-reset",
                attemptId: attemptIds[failed.index],
                nextAttemptId: attemptIds[next.index],
                message: "正在重新整理当前语境"
              });
            }
          });
          const completedAttemptId = attemptIds[execution.context.retried ? 1 : 0];
          enqueue({ type: "context", context: execution.context });
          enqueue({
            type: "turn-complete",
            attemptId: completedAttemptId,
            result: {
              ...execution.result,
              context: execution.context
            }
          });
        } catch (error) {
          enqueue({ ...providerErrorEvent(error), attemptId: attemptIds[activeAttemptIndex] });
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

function validateAgentRouteRequest(value: unknown):
  | {
      status: "ok";
      value: OpenAiCompatibleResponseRequest;
      agentTurnId?: string;
      agentContinuation: boolean;
      contextBudgetBaselineTokens?: number;
    }
  | { status: "failed"; reason: string } {
  if (!isRecord(value) || !Array.isArray(value.input) || value.input.length === 0) {
    return { status: "failed", reason: "input 缺失或为空。" };
  }

  const agentTurnId = typeof value.agentTurnId === "string" && value.agentTurnId.trim() ? value.agentTurnId : undefined;

  return {
    status: "ok",
    agentTurnId,
    agentContinuation: value.continuation === true && Boolean(agentTurnId),
    contextBudgetBaselineTokens: parseOptionalNonNegativeInteger(value.contextBudgetBaselineTokens),
    value: {
      input: value.input as OpenAiCompatibleResponseRequest["input"],
      tools: Array.isArray(value.tools) ? (value.tools as OpenAiCompatibleResponseRequest["tools"]) : undefined,
      previousResponseId: typeof value.previousResponseId === "string" ? value.previousResponseId : undefined
    }
  };
}

function parseOptionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
