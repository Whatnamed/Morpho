import { NextResponse } from "next/server";

import { loadAiConfig } from "@/server/ai/config";
import { getMiMoRouteErrorMessage } from "@/server/ai/errors";
import { streamMiMoChat } from "@/server/ai/mimoProvider";
import { buildMorphoSystemPrompt, buildProviderMessages, validateAiRouteRequest } from "@/server/ai/request";

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

  const config = loadAiConfig(process.env);
  if (config.status === "failed") {
    return NextResponse.json({ error: config.reason }, { status: 503 });
  }

  try {
    const stream = await streamMiMoChat(config.config, {
      messages: buildProviderMessages(validated.value),
      systemPrompt: buildMorphoSystemPrompt(validated.value),
      stream: true,
      capability: validated.value.attachments.some((attachment) => attachment.status === "ready") ? "multimodal" : "text",
      webSearch: config.config.webSearchEnabled ? validated.value.webSearch : undefined,
      signal: request.signal
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: getMiMoRouteErrorMessage(error) }, { status: 502 });
  }
}
