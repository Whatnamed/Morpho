import { NextResponse } from "next/server";

import {
  completeAgentTurnLease,
  hashAgentTurnLeaseValue,
  readAgentTurnClosureState
} from "@/server/auth/agentTurnLease";
import {
  resolveAgentContinuationSecret,
  verifyAgentContinuationToken
} from "@/server/ai/agentContinuationToken";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求不是有效 JSON。" }, { status: 400 });
  }
  if (!isRecord(body) || Object.keys(body).some((key) => ![
    "leaseId",
    "agentTurnId",
    "leaseSequence",
    "continuationToken",
    "closureRequestId"
  ].includes(key)) ||
    !isIdentifier(body.leaseId) || !isIdentifier(body.agentTurnId) ||
    !isIdentifier(body.closureRequestId) ||
    typeof body.leaseSequence !== "number" || !Number.isSafeInteger(body.leaseSequence) || body.leaseSequence < 1 ||
    typeof body.continuationToken !== "string") {
    return NextResponse.json({ error: "Summary Closure 参数无效。" }, { status: 400 });
  }
  const verified = verifyAgentContinuationToken({
    token: body.continuationToken,
    secret: resolveAgentContinuationSecret(process.env),
    leaseId: body.leaseId,
    agentTurnId: body.agentTurnId,
    expectedSequence: body.leaseSequence,
    now: Date.now()
  });
  if (verified.status === "failed" || !verified.claims.summary || !verified.claims.compactionReceipt) {
    return NextResponse.json(
      {
        error: "Summary Closure 缺少有效的签名 Summary Receipt。",
        reason: verified.status === "failed" ? verified.reason : "transcript_not_summary"
      },
      { status: 400 }
    );
  }
  const closureRequestHash = hashAgentTurnLeaseValue({
    leaseId: body.leaseId,
    agentTurnId: body.agentTurnId,
    leaseSequence: body.leaseSequence,
    continuationToken: body.continuationToken,
    closureRequestId: body.closureRequestId,
    outcome: "success",
    scope: "conversationSummary"
  });
  const recovery = await readAgentTurnClosureState({
    leaseId: body.leaseId,
    agentTurnId: body.agentTurnId,
    closureRequestId: body.closureRequestId,
    closureRequestHash
  });
  if (recovery.status === "denied") {
    return NextResponse.json({ error: recovery.error }, { status: recovery.httpStatus });
  }
  if (recovery.stateName === "conflict" || recovery.stateName === "invalid_lease") {
    return NextResponse.json(
      { error: recovery.stateName === "conflict" ? "Summary Closure 与已保存终态冲突。" : "Agent Turn Lease 无效。" },
      { status: recovery.stateName === "conflict" ? 409 : 403 }
    );
  }
  if (recovery.stateName !== "match") {
    const completed = await completeAgentTurnLease({
      leaseId: body.leaseId,
      agentTurnId: body.agentTurnId,
      outcome: "success",
      closureRequestId: body.closureRequestId,
      closureRequestHash
    });
    if (completed.status === "denied") {
      return NextResponse.json({ error: completed.error }, { status: completed.httpStatus });
    }
  }
  return NextResponse.json({ status: "success", replayed: recovery.stateName === "match" });
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
