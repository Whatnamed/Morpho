import { NextResponse } from "next/server";

import { loadOpenAiCompatibleConfig } from "@/server/ai/openaiCompatibleConfig";
import {
  executeOpenAiCompatibleResponse,
  OpenAiCompatibleProviderError,
  type OpenAiCompatibleResponseRequest,
  type ResponseMessageInput
} from "@/server/ai/openaiCompatibleProvider";
import { buildMorphoSystemPrompt, buildProviderMessages, validateAiRouteRequest } from "@/server/ai/request";
import type { AiRouteRequest } from "@/server/ai/request";
import type { ProviderChatMessage } from "@/server/ai/types";
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

  const config = loadOpenAiCompatibleConfig(process.env);
  if (config.status === "failed") {
    return NextResponse.json({ error: config.reason }, { status: 503 });
  }

  const webSearch = config.config.webSearchEnabled ? validated.value.webSearch : undefined;
  const imageInputCount = validated.value.attachments.filter((attachment) => attachment.status === "ready").length;

  try {
    const result = await executeOpenAiCompatibleResponse(
      config.config,
      buildOpenAiCompatibleChatRequest(validated.value, Boolean(webSearch?.enabled)),
      request.signal
    );

    return new Response(createNdjsonChatStream(result), {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: getOpenAiCompatibleChatRouteErrorMessage(error, {
          imageInputCount,
          webSearchEnabled: webSearch?.enabled === true,
          diagnostic: error instanceof OpenAiCompatibleProviderError ? error.diagnostic : undefined
        })
      },
      { status: 502 }
    );
  }
}

function buildOpenAiCompatibleChatRequest(request: AiRouteRequest, includeWebSearch: boolean): OpenAiCompatibleResponseRequest {
  return {
    input: [
      convertProviderMessageToResponseInput({
        role: "system",
        content: buildMorphoSystemPrompt(request)
      }),
      ...buildProviderMessages(request).map(convertProviderMessageToResponseInput)
    ],
    tools: includeWebSearch
      ? [
          {
            type: "web_search_preview",
            search_context_size: "medium"
          }
        ]
      : undefined
  };
}

function convertProviderMessageToResponseInput(message: ProviderChatMessage): ResponseMessageInput {
  const content =
    typeof message.content === "string"
      ? [
          {
            type: "input_text" as const,
            text: message.content
          }
        ]
      : message.content.map((part) =>
          part.type === "text"
            ? {
                type: "input_text" as const,
                text: part.text
              }
            : {
                type: "input_image" as const,
                image_url: part.image_url.url
              }
        );

  return {
    role: message.role,
    content
  };
}

function createNdjsonChatStream(result: Awaited<ReturnType<typeof executeOpenAiCompatibleResponse>>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      if (result.outputText) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", text: result.outputText })}\n`));
      }

      if (result.citations.length > 0) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "citations", citations: result.citations })}\n`));
      }

      controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done" })}\n`));
      controller.close();
    }
  });
}

function getOpenAiCompatibleChatRouteErrorMessage(
  error: unknown,
  context: { imageInputCount: number; webSearchEnabled: boolean; diagnostic?: string }
): string {
  if (error instanceof OpenAiCompatibleProviderError) {
    if (error.status === 401 || error.status === 403) {
      return "AiJWS 鉴权失败，请检查 MORPHO_AI_API_KEY。";
    }

    if (error.status === 400) {
      const imageHint = context.imageInputCount > 0 ? `本次包含图片输入 ${context.imageInputCount} 个；` : "";
      const searchHint = context.webSearchEnabled ? "本次启用了联网搜索；" : "";
      return `${imageHint}${searchHint}AiJWS 请求格式不兼容，请检查模型、tools 或图片输入。`;
    }

    if (context.diagnostic) {
      return `AiJWS 调用失败：${context.diagnostic}`;
    }
  }

  return "AiJWS 网络调用失败，请稍后重试。";
}
