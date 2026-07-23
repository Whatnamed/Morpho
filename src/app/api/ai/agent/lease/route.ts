import { NextResponse } from "next/server";

import {
  completeAgentTurnLease,
  type AgentTurnLeaseOutcome
} from "@/server/auth/agentTurnLease";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求不是有效 JSON。" }, { status: 400 });
  }
  if (!isRecord(body) || Object.keys(body).some((key) => !["leaseId", "agentTurnId", "outcome"].includes(key))) {
    return NextResponse.json({ error: "Agent Turn Lease 请求字段无效。" }, { status: 400 });
  }
  if (!isIdentifier(body.leaseId) || !isIdentifier(body.agentTurnId) || !isOutcome(body.outcome)) {
    return NextResponse.json({ error: "Agent Turn Lease 参数无效。" }, { status: 400 });
  }
  const result = await completeAgentTurnLease({
    leaseId: body.leaseId,
    agentTurnId: body.agentTurnId,
    outcome: body.outcome
  });
  return result.status === "completed"
    ? NextResponse.json({ status: result.statusName })
    : NextResponse.json({ error: result.error }, { status: result.httpStatus });
}

function isOutcome(value: unknown): value is AgentTurnLeaseOutcome {
  return value === "success" ||
    value === "cancelledBeforeExecution" ||
    value === "failedBeforeExecution" ||
    value === "partialSuccess" ||
    value === "pendingConfirmation";
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
