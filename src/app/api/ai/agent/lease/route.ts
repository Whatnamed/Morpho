import { NextResponse } from "next/server";

import {
  completeAgentTurnLease,
  type AgentTurnLeaseOutcome
} from "@/server/auth/agentTurnLease";
import { requireAiRouteUser } from "@/server/auth/aiAccess";
import {
  finalizeAgentTranscriptSnapshotOutcomeToken,
  resolveAgentContinuationSecret
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
    "outcome",
    "projectId",
    "userMessageId",
    "assistantMessageId",
    "transcriptSnapshotToken",
    "successProviderOutputSnapshot"
  ].includes(key))) {
    return NextResponse.json({ error: "Agent Turn Lease 请求字段无效。" }, { status: 400 });
  }
  if (!isIdentifier(body.leaseId) || !isIdentifier(body.agentTurnId) || !isOutcome(body.outcome)) {
    return NextResponse.json({ error: "Agent Turn Lease 参数无效。" }, { status: 400 });
  }
  const userAccess = await requireAiRouteUser();
  if (userAccess.status === "denied") {
    return NextResponse.json({ error: userAccess.error }, { status: userAccess.httpStatus });
  }
  const snapshotFields = [
    body.projectId,
    body.userMessageId,
    body.assistantMessageId,
    body.transcriptSnapshotToken
  ];
  const hasSnapshotProofInput = snapshotFields.some((value) => value !== undefined) ||
    body.successProviderOutputSnapshot !== undefined;
  if (hasSnapshotProofInput && (
    !isIdentifier(body.projectId) ||
    !isIdentifier(body.userMessageId) ||
    !isIdentifier(body.assistantMessageId) ||
    typeof body.transcriptSnapshotToken !== "string" ||
    body.transcriptSnapshotToken.length < 16 || body.transcriptSnapshotToken.length > 512_000
  )) {
    return NextResponse.json({ error: "Agent Turn Outcome Snapshot 参数无效。" }, { status: 400 });
  }
  const outcomeSnapshot = hasSnapshotProofInput
    ? finalizeAgentTranscriptSnapshotOutcomeToken({
        token: body.transcriptSnapshotToken as string,
        secret: resolveAgentContinuationSecret(process.env),
        projectId: body.projectId as string,
        userId: userAccess.userId,
        agentTurnId: body.agentTurnId,
        userMessageId: body.userMessageId as string,
        assistantMessageId: body.assistantMessageId as string,
        outcome: body.outcome,
        ...(body.successProviderOutputSnapshot !== undefined
          ? { successProviderOutputSnapshot: body.successProviderOutputSnapshot }
          : {}),
        now: Date.now()
      })
    : undefined;
  if (outcomeSnapshot?.status === "failed") {
    return NextResponse.json(
      { error: "Agent Turn Outcome 无法绑定到当前服务端 Transcript。", reason: outcomeSnapshot.reason },
      { status: outcomeSnapshot.reason === "secret_missing" ? 503 : 400 }
    );
  }
  const result = await completeAgentTurnLease({
    leaseId: body.leaseId,
    agentTurnId: body.agentTurnId,
    outcome: body.outcome
  });
  return result.status === "completed"
    ? NextResponse.json({
        status: result.statusName,
        ...(outcomeSnapshot?.status === "ok"
          ? {
              outcomeItem: outcomeSnapshot.outcomeItem,
              transcriptSnapshotToken: outcomeSnapshot.token,
              transcriptManifestHash: outcomeSnapshot.claims.transcriptManifest.manifestHash,
              expiresAt: outcomeSnapshot.claims.exp
            }
          : {})
      })
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
