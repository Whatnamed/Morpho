import { NextResponse } from "next/server";

import { loadAiConfig } from "@/server/ai/config";
import { getMiMoRouteErrorMessage } from "@/server/ai/errors";
import { streamMiMoChat } from "@/server/ai/mimoProvider";
import { buildMorphoSystemPrompt, buildProviderMessages, validateAiRouteRequest } from "@/server/ai/request";
import { aiAccessDeniedResponse, guardAiRoute } from "@/server/auth/aiAccess";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求不是有效 JSON。" }, { status: 400 });
  }

  const validated = validateAiRouteRequest(body);
  if (validated.status === "failed") {
    return NextResponse.json({ error: validated.reason }, { status: 400 });
  }

  const access = await guardAiRoute("text");
  if (access.status === "denied") {
    return aiAccessDeniedResponse(access);
  }

  const config = loadAiConfig(process.env);
  if (config.status === "failed") {
    return NextResponse.json({ error: config.reason }, { status: 503 });
  }

  const capability = validated.value.attachments.some((attachment) => attachment.status === "ready") ? "multimodal" : "text";
  const webSearch = config.config.webSearchEnabled ? validated.value.webSearch : undefined;

  try {
    const stream = await streamMiMoChat(config.config, {
      messages: buildProviderMessages(validated.value),
      systemPrompt: buildMorphoSystemPrompt(validated.value),
      stream: true,
      capability,
      webSearch,
      signal: request.signal
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: getMiMoRouteErrorMessage(error, {
          capability,
          webSearchEnabled: webSearch?.enabled === true,
          attachmentCount: validated.value.attachments.filter((attachment) => attachment.status === "ready").length
        })
      },
      { status: 502 }
    );
  }
}
