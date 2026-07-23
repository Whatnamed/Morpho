import { NextResponse } from "next/server";

import { loadOpenAiCompatibleConfig } from "@/server/ai/openaiCompatibleConfig";
import { searchWebEvidence } from "@/server/ai/webSearch";
import { aiAccessDeniedResponse, guardAiRoute } from "@/server/auth/aiAccess";
import {
  agentTurnLeaseDeniedResponse,
  continueAgentTurnLease
} from "@/server/auth/agentTurnLease";

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

  if (
    !isRecord(body) ||
    Object.keys(body).some((key) => !["queries", "maxSources", "agentContinuation", "agentTurnId", "leaseId"].includes(key)) ||
    !Array.isArray(body.queries)
  ) {
    return NextResponse.json({ error: "queries 缺失或格式无效。" }, { status: 400 });
  }

  const queries = body.queries.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0 && item.trim().length <= 300
  );
  if (queries.length === 0 || queries.length > 3 || queries.length !== body.queries.length) {
    return NextResponse.json({ error: "至少需要一个非空查询。" }, { status: 400 });
  }

  const isAgentContinuation = body.agentContinuation === true;
  const agentTurnId = isIdentifier(body.agentTurnId) ? body.agentTurnId : undefined;
  const leaseId = isIdentifier(body.leaseId) ? body.leaseId : undefined;
  if (isAgentContinuation && (!agentTurnId || !leaseId)) {
    return NextResponse.json({ error: "Agent 网页搜索必须携带有效 Turn Lease。" }, { status: 400 });
  }
  if (!isAgentContinuation && (body.agentTurnId !== undefined || body.leaseId !== undefined)) {
    return NextResponse.json({ error: "独立网页搜索不能伪造 Agent continuation。" }, { status: 400 });
  }
  if (isAgentContinuation) {
    const leaseAccess = await continueAgentTurnLease({
      leaseId: leaseId!,
      agentTurnId: agentTurnId!,
      callKind: "web_search"
    });
    if (leaseAccess.status === "denied") {
      return agentTurnLeaseDeniedResponse(leaseAccess);
    }
  } else {
    const quotaAccess = await guardAiRoute("text");
    if (quotaAccess.status === "denied") {
      return aiAccessDeniedResponse(quotaAccess);
    }
  }

  try {
    const result = await searchWebEvidence({
      queries,
      maxSources: typeof body.maxSources === "number" && Number.isInteger(body.maxSources)
        ? Math.min(5, Math.max(1, body.maxSources))
        : 5,
      signal: request.signal
    });

    return NextResponse.json(result);
  } catch (error) {
    if (request.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      return NextResponse.json({ error: "检索已取消。" }, { status: 499 });
    }
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

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(value);
}
