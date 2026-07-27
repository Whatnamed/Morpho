import { NextResponse } from "next/server";

import { readAgentTurnLeaseState } from "@/server/auth/agentTurnLease";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求不是有效 JSON。" }, { status: 400 });
  }
  if (
    !isRecord(body) ||
    Object.keys(body).some((key) => !["leaseId", "agentTurnId"].includes(key)) ||
    !isIdentifier(body.leaseId) ||
    !isIdentifier(body.agentTurnId)
  ) {
    return NextResponse.json({ error: "Agent Turn Lease 状态请求参数无效。" }, { status: 400 });
  }
  const result = await readAgentTurnLeaseState({
    leaseId: body.leaseId,
    agentTurnId: body.agentTurnId
  });
  return result.status === "allowed"
    ? NextResponse.json({
        active: true,
        expiresAt: result.state.expiresAt,
        providerCallCount: result.state.providerCallCount,
        webSearchCallCount: result.state.webSearchCallCount,
        nextProviderSequence: result.state.nextProviderSequence
      })
    : NextResponse.json({ error: result.error, ...(result.reason ? { reason: result.reason } : {}) }, {
        status: result.httpStatus
      });
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
