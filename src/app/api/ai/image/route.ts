import { EXTERNAL_REQUEST_MAX_BYTES } from "@/shared/externalResultProtocol";
import { externalResultStore, externalResultResponse, saveExternalResult, jsonResult, ExternalResultError, type ExternalResultPort } from "@/server/ai/externalResultStore";
import { NextResponse } from "next/server";
import { createEffectExecution, externalEffectId } from "@/server/ai/externalEffectJournal";
import { existingImageEffectResponse } from "@/server/ai/externalEffectObservation";

import { loadGrsImageConfig } from "@/server/image/config";
import { resolveGrsImageResult } from "@/server/image/grsProvider";
import { validateGrsImageRouteRequest } from "@/server/image/request";
import { aiAccessDeniedResponse, guardAiRoute, requireAiRouteUser } from "@/server/auth/aiAccess";
import { readBoundedJsonBody } from "@/server/http/boundedJsonBody";
import {
  EXTERNAL_EXECUTION_STATE_UNKNOWN,
  IMAGE_PROVIDER_CANCELLED,
  IMAGE_PROVIDER_FAILED,
  IMAGE_PROVIDER_UNAVAILABLE
} from "@/server/ai/publicProviderError";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_IMAGE_REQUEST_BODY_BYTES = EXTERNAL_REQUEST_MAX_BYTES;

export async function POST(request: Request) {
  const authenticated = await requireAiRouteUser();
  if (authenticated.status === "denied") {
    return aiAccessDeniedResponse(authenticated);
  }
  const parsed = await readBoundedJsonBody(request, {
    maxBytes: MAX_IMAGE_REQUEST_BODY_BYTES,
    tooLargeError: "AI 图像请求体超过允许大小。"
  });
  if (parsed.status === "failed") return parsed.response;

  const validated = validateGrsImageRouteRequest(parsed.value);
  if (validated.status === "failed") {
    return NextResponse.json({ error: validated.reason }, { status: 400 });
  }

  const clientKey = validated.value.clientRequestId ?? request.headers.get("X-Morpho-Effect-Key");
  if (!clientKey || !/^[A-Za-z0-9._:-]{1,160}$/.test(clientKey)) {
    return NextResponse.json({ code: "effect_identity_required", error: "生图请求缺少稳定执行身份。", recoverable: false }, { status: 400 });
  }
  const effectIdentity = { actorUserId: authenticated.userId,
    effectId: externalEffectId("image", clientKey), kind: "image" as const };
  try {
    const saved = await externalResultResponse(effectIdentity);
    if (saved) return saved;
    await externalResultStore.call("probe", effectIdentity);
    const existing = await existingImageEffectResponse(effectIdentity, request.signal);
    if (existing) return existing;
  } catch (error) {
    return NextResponse.json({ code: "effect_observation_unavailable", recoverable: false }, { status: 503 });
  }
  if (request.headers.get("X-Morpho-Effect-Contract") !== "1") {
    // A legacy independent request has no server registry. Absence is not evidence that it
    // never executed; only a new-contract producer may register a fresh paid effect.
    return NextResponse.json({ code: EXTERNAL_EXECUTION_STATE_UNKNOWN.code,
      error: EXTERNAL_EXECUTION_STATE_UNKNOWN.message, recoverable: false }, { status: 409 });
  }
  const config = loadGrsImageConfig(process.env);
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

  const access = await guardAiRoute("image");
  if (access.status === "denied") {
    return aiAccessDeniedResponse(access);
  }

  try {
    const result = await resolveGrsImageResult(config.config, validated.value, {
      signal: request.signal,
      effect: createEffectExecution(effectIdentity)
    });

    if (result.status === "cancelled") {
      return NextResponse.json(
        {
          error: IMAGE_PROVIDER_CANCELLED.message,
          code: IMAGE_PROVIDER_CANCELLED.code,
          recoverable: IMAGE_PROVIDER_CANCELLED.recoverable
        },
        { status: 499 }
      );
    }

    if (result.status === "failed") {
      const publicError = result.failureCode === EXTERNAL_EXECUTION_STATE_UNKNOWN.code
        ? EXTERNAL_EXECUTION_STATE_UNKNOWN : IMAGE_PROVIDER_FAILED;
      return NextResponse.json(
        {
          error: publicError.message,
          code: publicError.code,
          recoverable: publicError.recoverable
        },
        { status: 502 }
      );
    }

    const delivery = await saveExternalResult(externalResultStore, effectIdentity, result.blob);
    return NextResponse.json({ result: delivery }, { headers: { "Cache-Control": "no-store",
      "X-Morpho-Provider-Task-Id": result.providerTaskId ?? "" } });
  } catch (error) {
    return NextResponse.json(
      {
        error: EXTERNAL_EXECUTION_STATE_UNKNOWN.message,
        code: error instanceof ExternalResultError ? error.code : EXTERNAL_EXECUTION_STATE_UNKNOWN.code,
        recoverable: false
      },
      { status: 502 }
    );
  }
}
