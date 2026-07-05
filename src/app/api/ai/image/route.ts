import { NextResponse } from "next/server";

import { loadGrsImageConfig } from "@/server/image/config";
import { resolveGrsImageResult } from "@/server/image/grsProvider";
import { validateGrsImageRouteRequest } from "@/server/image/request";
import { aiAccessDeniedResponse, guardAiRoute } from "@/server/auth/aiAccess";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求不是有效 JSON。" }, { status: 400 });
  }

  const validated = validateGrsImageRouteRequest(body);
  if (validated.status === "failed") {
    return NextResponse.json({ error: validated.reason }, { status: 400 });
  }

  const access = await guardAiRoute("image");
  if (access.status === "denied") {
    return aiAccessDeniedResponse(access);
  }

  const config = loadGrsImageConfig(process.env);
  if (config.status === "failed") {
    return NextResponse.json({ error: config.reason }, { status: 503 });
  }

  try {
    const result = await resolveGrsImageResult(config.config, validated.value, {
      signal: request.signal
    });

    if (result.status === "cancelled") {
      return NextResponse.json({ error: result.reason }, { status: 499 });
    }

    if (result.status === "failed") {
      return NextResponse.json({ error: result.reason }, { status: 502 });
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
    return NextResponse.json({ error: "GrsAI 图像任务失败，请检查网络、模型配置或稍后重试。" }, { status: 502 });
  }
}
