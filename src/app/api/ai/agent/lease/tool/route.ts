import { NextResponse } from "next/server";

import { markAgentTurnToolExecutionStarted } from "@/server/auth/agentTurnLease";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求不是有效 JSON。" }, { status: 400 });
  }
  if (!isRecord(body) || Object.keys(body).some((key) => key !== "leaseId" && key !== "agentTurnId") ||
    !isIdentifier(body.leaseId) || !isIdentifier(body.agentTurnId)) {
    return NextResponse.json({ error: "Agent Tool Lease 参数无效。" }, { status: 400 });
  }
  const result = await markAgentTurnToolExecutionStarted({
    leaseId: body.leaseId,
    agentTurnId: body.agentTurnId
  });
  return result.status === "marked"
    ? NextResponse.json({ status: "marked" })
    : NextResponse.json({ error: result.error }, { status: result.httpStatus });
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
