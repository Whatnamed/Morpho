import { NextResponse } from "next/server";

import { loadOpenAiCompatibleConfig } from "@/server/ai/openaiCompatibleConfig";
import {
  OpenAiCompatibleProviderError,
  streamOpenAiCompatibleResponse,
  type OpenAiCompatibleResponseRequest,
  type ProviderCitation,
  type ResponseMessageInput
} from "@/server/ai/openaiCompatibleProvider";
import { withServerPromptCacheHint } from "@/server/ai/providerPromptCacheHint";
import {
  MORPHO_INDEPENDENT_CHAT_PROMPT_CONTRACT_VERSION,
  MORPHO_INDEPENDENT_CHAT_STABLE_SYSTEM_PREFIX,
  buildMorphoSystemPrompt,
  buildProviderMessages,
  validateAiRouteRequest
} from "@/server/ai/request";
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
  const providerRequest = buildServerChatProviderRequest({
    request: validated.value,
    includeWebSearch: Boolean(webSearch?.enabled),
    config: config.config,
    userId: access.userId
  });

  return new Response(
    createNdjsonChatStream({
      config: config.config,
      providerRequest,
      originalRequest: validated.value,
      userId: access.userId,
      signal: request.signal
    }),
    {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

function buildServerChatProviderRequest(input: {
  request: AiRouteRequest;
  includeWebSearch: boolean;
  config: Parameters<typeof streamOpenAiCompatibleResponse>[0];
  userId: string;
}): OpenAiCompatibleResponseRequest {
  return withServerPromptCacheHint({
    config: input.config,
    request: buildOpenAiCompatibleChatRequest(input.request, input.includeWebSearch),
    namespace: "chat",
    userId: input.userId,
    promptContractVersion: MORPHO_INDEPENDENT_CHAT_PROMPT_CONTRACT_VERSION,
    toolProfile: input.includeWebSearch ? "chatWithWebSearch" : "chat",
    stableSystemPrefix: MORPHO_INDEPENDENT_CHAT_STABLE_SYSTEM_PREFIX
  });
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
            type: message.role === "assistant" ? "output_text" as const : "input_text" as const,
            text: message.content
          }
        ]
      : message.content.map((part) =>
          part.type === "text"
            ? {
                type: message.role === "assistant" ? "output_text" as const : "input_text" as const,
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

function createNdjsonChatStream(input: {
  config: Parameters<typeof streamOpenAiCompatibleResponse>[0];
  providerRequest: OpenAiCompatibleResponseRequest;
  originalRequest: AiRouteRequest;
  userId: string;
  signal: AbortSignal;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const writeEvent = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      const runProviderStream = async (
        providerRequest: OpenAiCompatibleResponseRequest,
        leadingWarning?: string
      ) => {
        if (leadingWarning) {
          writeEvent({ type: "delta", text: `${leadingWarning}\n\n` });
        }

        const citations: ProviderCitation[] = [];
        const result = await streamOpenAiCompatibleResponse(
          input.config,
          providerRequest,
          {
            onTextDelta: (text) => {
              if (text) {
                writeEvent({ type: "delta", text });
              }
            },
            onCitations: (newCitations) => {
              citations.push(...newCitations);
            }
          },
          input.signal
        );

        const allCitations = dedupeCitations([...citations, ...result.citations]);
        if (allCitations.length > 0) {
          writeEvent({ type: "citations", citations: allCitations });
        }
      };

      try {
        try {
          await runProviderStream(input.providerRequest);
        } catch (error) {
          if (!shouldRetryTextOnlyAfterImageFailure(error, input.originalRequest)) {
            throw error;
          }

          await runProviderStream(
            buildServerChatProviderRequest({
              request: stripImageInputsFromAiRouteRequest(input.originalRequest),
              includeWebSearch: Boolean(input.originalRequest.webSearch?.enabled),
              config: input.config,
              userId: input.userId
            }),
            "图片像素没有被当前文本模型接受；这次先基于对象摘要和已解析文档继续回复。"
          );
        }

        writeEvent({ type: "done" });
      } catch (error) {
        writeEvent({
          type: "error",
          message: getOpenAiCompatibleChatRouteErrorMessage(error, {
            imageInputCount: input.originalRequest.attachments.filter((attachment) => attachment.status === "ready").length,
            webSearchEnabled: input.originalRequest.webSearch?.enabled === true,
            diagnostic: error instanceof OpenAiCompatibleProviderError ? error.diagnostic : undefined
          })
        });
      } finally {
        controller.close();
      }
    }
  });
}

function dedupeCitations(citations: ProviderCitation[]): ProviderCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = citation.url ?? `${citation.title}:${citation.snippet ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function shouldRetryTextOnlyAfterImageFailure(error: unknown, request: AiRouteRequest): boolean {
  const hasReadyImages = request.attachments.some((attachment) => attachment.status === "ready");
  if (!hasReadyImages || !(error instanceof OpenAiCompatibleProviderError)) {
    return false;
  }

  const diagnostic = (error.diagnostic ?? "").toLowerCase();
  return (
    [400, 413, 415, 422, 500, 502, 503, 504].includes(error.status) &&
    (diagnostic.includes("image") ||
      diagnostic.includes("input_image") ||
      diagnostic.includes("image_url") ||
      diagnostic.includes("unsupported") ||
      diagnostic.includes("bad gateway") ||
      error.status === 502)
  );
}

function stripImageInputsFromAiRouteRequest(request: AiRouteRequest): AiRouteRequest {
  const imageSourceIds = request.objectSummaries
    .filter((object) => object.type === "image")
    .map((object) => object.id);
  const originalUnavailable = request.comparisonContext?.unavailableImageObjectIds ?? [];

  return {
    ...request,
    attachments: request.attachments.filter((attachment) => attachment.status !== "ready"),
    comparisonContext: request.comparisonContext
      ? {
          ...request.comparisonContext,
          attachedImageObjectIds: [],
          unavailableImageObjectIds: [...new Set([...originalUnavailable, ...imageSourceIds])]
        }
      : request.comparisonContext
  };
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
