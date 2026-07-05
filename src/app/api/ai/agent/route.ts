import { NextResponse } from "next/server";

import { loadOpenAiCompatibleConfig } from "@/server/ai/openaiCompatibleConfig";
import {
  executeOpenAiCompatibleResponse,
  OpenAiCompatibleProviderError,
  type OpenAiCompatibleResponseRequest
} from "@/server/ai/openaiCompatibleProvider";

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

  const config = loadOpenAiCompatibleConfig(process.env);
  if (config.status === "failed") {
    return NextResponse.json({ error: config.reason }, { status: 503 });
  }

  try {
    const result = await executeOpenAiCompatibleResponse(config.config, validated.value, request.signal);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OpenAiCompatibleProviderError) {
      return NextResponse.json(
        {
          error:
            error.status === 401 || error.status === 403
                ? "OpenAI-compatible Provider 鉴权失败，请检查 MORPHO_AI_API_KEY。"
              : error.status === 400
                ? "OpenAI-compatible Provider 请求格式不兼容，请检查模型、tools 或图片输入。"
                : readableProviderDiagnostic(error.diagnostic) ?? "OpenAI-compatible Provider 调用失败，请稍后重试。"
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ error: "OpenAI-compatible Provider 网络调用失败。" }, { status: 502 });
  }
}

function validateAgentRouteRequest(value: unknown):
  | { status: "ok"; value: OpenAiCompatibleResponseRequest }
  | { status: "failed"; reason: string } {
  if (!isRecord(value) || !Array.isArray(value.input) || value.input.length === 0) {
    return { status: "failed", reason: "input 缺失或为空。" };
  }

  return {
    status: "ok",
    value: {
      input: value.input as OpenAiCompatibleResponseRequest["input"],
      tools: Array.isArray(value.tools) ? (value.tools as OpenAiCompatibleResponseRequest["tools"]) : undefined,
      previousResponseId: typeof value.previousResponseId === "string" ? value.previousResponseId : undefined
    }
  };
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
