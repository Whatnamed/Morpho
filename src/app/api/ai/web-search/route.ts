import { NextResponse } from "next/server";

import { loadOpenAiCompatibleConfig } from "@/server/ai/openaiCompatibleConfig";
import { searchWebEvidence } from "@/server/ai/webSearch";
import { aiAccessDeniedResponse, guardAiRoute } from "@/server/auth/aiAccess";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (isExplicitlyDisabled(process.env.MORPHO_AI_WEB_SEARCH_ENABLED)) {
    return NextResponse.json({ error: "网页搜索已关闭。" }, { status: 403 });
  }

  const config = loadOpenAiCompatibleConfig(process.env);
  if (config.status === "ok" && !config.config.webSearchEnabled) {
    return NextResponse.json({ error: "网页搜索已关闭。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求不是有效 JSON。" }, { status: 400 });
  }

  if (!isRecord(body) || !Array.isArray(body.queries)) {
    return NextResponse.json({ error: "queries 缺失或格式无效。" }, { status: 400 });
  }

  const queries = body.queries.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 3);
  if (queries.length === 0) {
    return NextResponse.json({ error: "至少需要一个非空查询。" }, { status: 400 });
  }

  const access = await guardAiRoute("text");
  if (access.status === "denied") {
    return aiAccessDeniedResponse(access);
  }

  try {
    const sources = await searchWebEvidence({
      queries,
      maxSources: typeof body.maxSources === "number" ? body.maxSources : 5,
      signal: request.signal
    });

    return NextResponse.json({
      sources
    });
  } catch {
    return NextResponse.json({ error: "外部检索失败，请稍后重试。" }, { status: 502 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExplicitlyDisabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no";
}
