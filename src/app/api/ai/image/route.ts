import { NextResponse } from "next/server";

import { loadGrsImageConfig } from "@/server/image/config";
import { resolveGrsImageResult } from "@/server/image/grsProvider";
import { validateGrsImageRouteRequest } from "@/server/image/request";
import { aiAccessDeniedResponse, guardAiRoute, requireAiRouteUser } from "@/server/auth/aiAccess";
import { readBoundedJsonBody } from "@/server/http/boundedJsonBody";
import {
  IMAGE_PROVIDER_CANCELLED,
  IMAGE_PROVIDER_FAILED,
  IMAGE_PROVIDER_UNAVAILABLE
} from "@/server/ai/publicProviderError";

export const runtime = "nodejs";
const MAX_IMAGE_REQUEST_BODY_BYTES = 36 * 1024 * 1024;

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
      signal: request.signal
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
      return NextResponse.json(
        {
          error: IMAGE_PROVIDER_FAILED.message,
          code: IMAGE_PROVIDER_FAILED.code,
          recoverable: IMAGE_PROVIDER_FAILED.recoverable
        },
        { status: 502 }
      );
    }

    return new Response(result.blob, {
      headers: {
        "Content-Type": result.mimeType,
        "Cache-Control": "no-store",
        "X-Morpho-Image-Provider": "grsai",
        "X-Morpho-Client-Request-Id": validated.value.clientRequestId ?? "",
        "X-Morpho-Provider-Task-Id": result.providerTaskId ?? ""
      }
    });
  } catch {
    return NextResponse.json(
      {
        error: IMAGE_PROVIDER_FAILED.message,
        code: IMAGE_PROVIDER_FAILED.code,
        recoverable: IMAGE_PROVIDER_FAILED.recoverable
      },
      { status: 502 }
    );
  }
}
