import { externalResultStore, externalResultResponse, saveExternalResult, jsonResult, ExternalResultError, type ExternalResultPort } from "@/server/ai/externalResultStore";
import { createHash } from "node:crypto";
import { createEffectExecution, externalEffectId, type EffectIdentity, type EffectExecution } from "@/server/ai/externalEffectJournal";
import { existingImageEffectResponse, retrieveExistingImage } from "@/server/ai/externalEffectObservation";
import { NextResponse } from "next/server";

import {
  acquireAgentTurnExternalAction,
  hashAgentTurnExternalActionContract,
  settleAgentTurnExternalAction,
  type AcquireAgentTurnExternalActionResult,
  type SettleAgentTurnExternalActionResult
} from "@/server/ai/agentTurnExternalActionJournal";
import {
  invalidRequestResponse,
  isBoundedIdentifier,
  isRecord,
  isUuid,
  journalDeniedResponse,
  readBoundedJsonBody,
  unknownKeys
} from "@/server/ai/agentTurnRouteSupport";
import { loadGrsImageConfig } from "@/server/image/config";
import { resolveGrsImageResult } from "@/server/image/grsProvider";
import { validateGrsImageRouteRequest } from "@/server/image/request";
import { requireAiRouteUser, type AiRouteUserAccessResult } from "@/server/auth/aiAccess";
import { hashAPlusExternalToolActionClaim } from "@/server/ai/agentTurnProviderRequest";
import {
  EXTERNAL_EXECUTION_STATE_UNKNOWN,
  IMAGE_PROVIDER_CANCELLED,
  IMAGE_PROVIDER_FAILED,
  IMAGE_PROVIDER_UNAVAILABLE
} from "@/server/ai/publicProviderError";

type RouteContext = { params: Promise<{ turnId: string }> };

export type AgentTurnImageActionDependencies = Readonly<{
  authenticate: () => Promise<AiRouteUserAccessResult>;
  acquire: typeof acquireAgentTurnExternalAction;
  settle: typeof settleAgentTurnExternalAction;
  loadConfig: typeof loadGrsImageConfig;
  generate: typeof resolveGrsImageResult;
  results?: ExternalResultPort;
  retrieveImage?: typeof retrieveExistingImage;
  createEffect?: (identity: EffectIdentity) => EffectExecution;
  observeExisting?: typeof existingImageEffectResponse;
  waitForSettlementRetry?: (delayMs: number) => Promise<void>;
}>;

const defaultDependencies: AgentTurnImageActionDependencies = {
  authenticate: requireAiRouteUser,
  acquire: acquireAgentTurnExternalAction,
  settle: settleAgentTurnExternalAction,
  loadConfig: loadGrsImageConfig,
  generate: resolveGrsImageResult,
  results: externalResultStore,
  retrieveImage: retrieveExistingImage,
  createEffect: createEffectExecution,
  observeExisting: existingImageEffectResponse
};

export function createAgentTurnImageActionPostHandler(
  dependencies: AgentTurnImageActionDependencies = defaultDependencies
) {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    const { turnId } = await context.params;
    if (!isUuid(turnId)) return invalidRequestResponse("serverTurnId 格式无效。");
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
    const parsed = await readBoundedJsonBody(request);
    if (parsed.status === "failed") return parsed.response;
    if (!isRecord(parsed.value) || !isRecord(parsed.value.input)) {
      return invalidRequestResponse("Image Action 必须包含 input 对象。");
    }
    const unknown = unknownKeys(parsed.value, [
      "localProjectId", "requestId", "stepSequence", "actionId", "claimCallId", "input"
    ]);
    if (unknown.length > 0) {
      return invalidRequestResponse(`请求包含不允许的字段：${unknown.join("、")}。`);
    }
    if (
      !isBoundedIdentifier(parsed.value.localProjectId) ||
      !isBoundedIdentifier(parsed.value.requestId) ||
      !isBoundedIdentifier(parsed.value.actionId) ||
      !isBoundedIdentifier(parsed.value.claimCallId) ||
      !Number.isSafeInteger(parsed.value.stepSequence) ||
      (parsed.value.stepSequence as number) < 1 ||
      (parsed.value.stepSequence as number) > 10_000
    ) return invalidRequestResponse("Image Action 身份无效。");
    const effectIdentity: EffectIdentity = {
      actorUserId: auth.userId,
      effectId: externalEffectId("a-plus", turnId, parsed.value.localProjectId, "image", parsed.value.actionId),
      kind: "image"
    };
    try {
      if (dependencies.results) {
        const saved = await externalResultResponse(effectIdentity, dependencies.results,
          dependencies.retrieveImage ? () => dependencies.retrieveImage!(effectIdentity, request.signal) : undefined);
        if (saved) return saved;
        await dependencies.results.call("probe", effectIdentity);
      }
      const existing = await dependencies.observeExisting?.(effectIdentity, request.signal);
      if (existing) return existing;
    } catch {
      return NextResponse.json({ code: "effect_observation_unavailable", recoverable: false }, { status: 503 });
    }
    const inputUnknown = unknownKeys(parsed.value.input, [
      "modelId", "prompt", "images", "aspectRatio", "sizeOption",
      "referenceObjectIds", "directionObjectId", "visualBranchId", "operationId", "clientRequestId"
    ]);
    if (inputUnknown.length > 0) {
      return invalidRequestResponse(`Image input 包含不允许的字段：${inputUnknown.join("、")}。`);
    }
    const payloadBoundary = validateImagePayloadBoundary(parsed.value.input);
    if (payloadBoundary) return invalidRequestResponse(payloadBoundary, "invalid_image_payload");
    const validated = validateGrsImageRouteRequest(parsed.value.input);
    if (validated.status === "failed") return invalidRequestResponse(validated.reason, "invalid_image_request");
    const config = dependencies.loadConfig(process.env);
    if (config.status === "failed") {
      return NextResponse.json(
        {
          error: IMAGE_PROVIDER_UNAVAILABLE.message,
          code: IMAGE_PROVIDER_UNAVAILABLE.code,
          recoverable: IMAGE_PROVIDER_UNAVAILABLE.recoverable
        },
        { status: 503 }
      );
    }
    const identity = {
      serverTurnId: turnId,
      localProjectId: parsed.value.localProjectId,
      requestId: parsed.value.requestId,
      stepSequence: parsed.value.stepSequence as number,
      actionId: parsed.value.actionId,
      actionKind: "image" as const
    };
    const actionHash = hashAgentTurnExternalActionContract({
      version: 1,
      kind: "image",
      provider: {
        baseUrl: config.config.baseUrl.replace(/\/$/, ""),
        fallbackBaseUrls: config.config.fallbackBaseUrls ?? [],
        imageHostAllowlist: config.config.imageHostAllowlist ?? [],
        configuredModel: config.config.model
      },
      request: {
        modelId: validated.value.modelId,
        prompt: validated.value.prompt,
        images: validated.value.images.map(hashImageDataUrl),
        aspectRatio: validated.value.aspectRatio,
        sizeOption: validated.value.sizeOption,
        referenceObjectIds: validated.value.referenceObjectIds,
        ...(validated.value.directionObjectId
          ? { directionObjectId: validated.value.directionObjectId }
          : {}),
        ...(validated.value.operationId
          ? { operationId: validated.value.operationId }
          : {}),
        ...(validated.value.clientRequestId
          ? { clientRequestId: validated.value.clientRequestId }
          : {})
      }
    });
    const acquired: AcquireAgentTurnExternalActionResult = await dependencies.acquire({
      ...identity,
      actionHash,
      claimCallId: parsed.value.claimCallId,
      claimHash: hashAPlusExternalToolActionClaim({
        actionKind: "image",
        toolCallId: parsed.value.claimCallId
      })
    });
    if (acquired.status === "denied") return journalDeniedResponse(acquired);
    if (!acquired.executionGranted) return imageReplayResponse(acquired);

    try {
      const result = await dependencies.generate(config.config, validated.value, {
        signal: request.signal,
        effect: dependencies.createEffect?.(effectIdentity)
      });
      if (result.status === "cancelled") {
        const settled = await settleWithRetry(dependencies, {
          ...identity,
          actionHash,
          status: "externallyCancelled"
        });
        if (settled.status === "denied") return journalDeniedResponse(settled);
        return NextResponse.json(
          {
            error: IMAGE_PROVIDER_CANCELLED.message,
            code: IMAGE_PROVIDER_CANCELLED.code,
            recoverable: IMAGE_PROVIDER_CANCELLED.recoverable,
            action: settled.snapshot
          },
          { status: 499 }
        );
      }
      if (result.status === "failed") {
        const publicError = result.failureCode === EXTERNAL_EXECUTION_STATE_UNKNOWN.code
          ? EXTERNAL_EXECUTION_STATE_UNKNOWN : IMAGE_PROVIDER_FAILED;
        const settled = await settleWithRetry(dependencies, {
          ...identity,
          actionHash,
          status: "externallyFailed",
          failureCode: publicError.code
        });
        if (settled.status === "denied") return journalDeniedResponse(settled);
        return NextResponse.json(
          {
            error: publicError.message,
            code: publicError.code,
            recoverable: publicError.recoverable,
            action: settled.snapshot
          },
          { status: 502 }
        );
      }
      const delivery = dependencies.results ? await saveExternalResult(dependencies.results,
        effectIdentity, result.blob, { ...identity, actionHash }) : undefined;
      const settled = await settleWithRetry(dependencies, {
        ...identity,
        actionHash,
        status: "externallyCompleted"
      });
      if (settled.status === "denied") return journalDeniedResponse(settled);
      if (delivery) return NextResponse.json({ result: delivery }, { headers: { "Cache-Control": "no-store",
        "X-Morpho-Provider-Task-Id": result.providerTaskId ?? "" } });
      return new Response(result.blob, {
        headers: {
          "Content-Type": result.mimeType,
          "Cache-Control": "no-store",
          "X-Morpho-Image-Provider": "grsai",
          "X-Morpho-Client-Request-Id": validated.value.clientRequestId ?? "",
          "X-Morpho-Provider-Task-Id": result.providerTaskId ?? "",
          "X-Morpho-A-Plus-Action-Id": identity.actionId
        }
      });
    } catch (error) {
      if (error instanceof ExternalResultError) {
        return NextResponse.json({ code: error.code, recoverable: false, deliveryPending: true,
          error: "同一图像结果尚未完成交付；保留原 Action，只查询同一任务。" }, { status: 503 });
      }
      const cancelled = request.signal.aborted || (error instanceof Error && error.name === "AbortError");
      const settled = await settleWithRetry(dependencies, {
        ...identity,
        actionHash,
        status: cancelled ? "externallyCancelled" : "externallyFailed",
        failureCode: error instanceof ExternalResultError ? error.code : EXTERNAL_EXECUTION_STATE_UNKNOWN.code
      });
      if (settled.status === "denied") return journalDeniedResponse(settled);
      return NextResponse.json(
        {
          error: cancelled ? IMAGE_PROVIDER_CANCELLED.message : EXTERNAL_EXECUTION_STATE_UNKNOWN.message,
          code: cancelled ? "image_cancelled" : error instanceof ExternalResultError ? error.code : EXTERNAL_EXECUTION_STATE_UNKNOWN.code,
          recoverable: false,
          action: settled.snapshot
        },
        { status: cancelled ? 499 : 502 }
      );
    }
  };
}


function imageReplayResponse(
  acquired: Extract<AcquireAgentTurnExternalActionResult, { status: "ok" }>
): Response {
  if (acquired.snapshot.status === "running") {
    return NextResponse.json({ replayed: true, action: acquired.snapshot }, { status: 202 });
  }
  return NextResponse.json(
    {
      error: acquired.snapshot.status === "externallyCompleted"
        ? "图像已生成，但二进制结果不能从 Journal 重放。"
        : "Image Action 已终止。",
      code: acquired.snapshot.status === "externallyCompleted"
        ? "external_action_result_unavailable"
        : acquired.snapshot.failureCode ?? "external_action_terminal",
      recoverable: false,
      action: acquired.snapshot
    },
    { status: 409 }
  );
}

function validateImagePayloadBoundary(value: Record<string, unknown>): string | undefined {
  if (typeof value.prompt !== "string" || value.prompt.trim().length < 1 || value.prompt.length > 16_000) {
    return "Image prompt 为空或超过 16000 字符。";
  }
  return undefined;
}

function hashImageDataUrl(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function settleWithRetry(
  dependencies: AgentTurnImageActionDependencies,
  input: Parameters<typeof settleAgentTurnExternalAction>[0]
): Promise<SettleAgentTurnExternalActionResult> {
  const delays = [25, 75] as const;
  for (let attempt = 0; ; attempt += 1) {
    let result: SettleAgentTurnExternalActionResult;
    try {
      result = await dependencies.settle(input);
    } catch {
      result = {
        status: "denied",
        httpStatus: 503,
        code: "external_action_unavailable",
        error: "External Action 结算暂时不可用。",
        recoverable: false
      };
    }
    if (result.status === "ok" || result.httpStatus !== 503 || attempt >= delays.length) return result;
    await (dependencies.waitForSettlementRetry ?? wait)(delays[attempt]!);
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
