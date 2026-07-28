import { NextResponse } from "next/server";

import { normalizeProviderOutputSnapshot } from "@/domain/morpho/providerInputSnapshot";
import {
  completeAgentTurnLease,
  hashAgentTurnLeaseValue,
  readAgentTurnClosureState,
  type AgentTurnLeaseOutcome
} from "@/server/auth/agentTurnLease";
import { requireAiRouteUser } from "@/server/auth/aiAccess";
import {
  finalizeAgentTranscriptSnapshotOutcomeToken,
  resolveAgentContinuationSecret,
  verifyAgentTranscriptSnapshotToken,
  verifyAgentTurnClosureToken
} from "@/server/ai/agentContinuationToken";

export const runtime = "nodejs";

const PROOF_OUTCOMES = new Set<AgentTurnLeaseOutcome>([
  "success",
  "partialSuccess",
  "pendingConfirmation"
]);

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
    "closureRequestId",
    "closureToken",
    "projectId",
    "userMessageId",
    "assistantMessageId",
    "transcriptSnapshotToken",
    "transcriptManifestHash",
    "providerOutputSnapshot"
  ].includes(key))) {
    return NextResponse.json({ error: "Agent Turn Lease 请求字段无效。" }, { status: 400 });
  }
  if (!isIdentifier(body.leaseId) || !isIdentifier(body.agentTurnId) ||
    !isIdentifier(body.closureRequestId) || !isOutcome(body.outcome)) {
    return NextResponse.json({ error: "Agent Turn Lease 参数无效。" }, { status: 400 });
  }

  const proofRequired = PROOF_OUTCOMES.has(body.outcome);
  const proofFieldsValid = isIdentifier(body.projectId) &&
    isIdentifier(body.userMessageId) &&
    isIdentifier(body.assistantMessageId) &&
    isBoundedToken(body.closureToken) &&
    isBoundedToken(body.transcriptSnapshotToken) &&
    isHash(body.transcriptManifestHash) &&
    Boolean(normalizeProviderOutputSnapshot(body.providerOutputSnapshot));
  if (proofRequired && !proofFieldsValid) {
    return NextResponse.json(
      { error: "Agent Turn Closure 缺少服务端签名 Proof。", reason: "closure_proof_missing" },
      { status: 400 }
    );
  }
  if (!proofRequired && [
    body.projectId,
    body.userMessageId,
    body.assistantMessageId,
    body.closureToken,
    body.transcriptSnapshotToken,
    body.transcriptManifestHash,
    body.providerOutputSnapshot
  ].some((value) => value !== undefined)) {
    return NextResponse.json(
      { error: "执行前终止不能携带执行后 Closure Proof。" },
      { status: 400 }
    );
  }

  const userAccess = await requireAiRouteUser();
  if (userAccess.status === "denied") {
    return NextResponse.json({ error: userAccess.error }, { status: userAccess.httpStatus });
  }

  const closureRequestHash = hashAgentTurnLeaseValue({
    leaseId: body.leaseId,
    agentTurnId: body.agentTurnId,
    outcome: body.outcome,
    closureRequestId: body.closureRequestId,
    closureToken: body.closureToken ?? null,
    projectId: body.projectId ?? null,
    userMessageId: body.userMessageId ?? null,
    assistantMessageId: body.assistantMessageId ?? null,
    transcriptSnapshotToken: body.transcriptSnapshotToken ?? null,
    transcriptManifestHash: body.transcriptManifestHash ?? null,
    providerOutputSnapshot: body.providerOutputSnapshot ?? null
  });
  const recovery = await readAgentTurnClosureState({
    leaseId: body.leaseId,
    agentTurnId: body.agentTurnId,
    closureRequestId: body.closureRequestId,
    closureRequestHash
  });
  if (recovery.status === "denied") {
    return NextResponse.json({ error: recovery.error, reason: recovery.reason }, { status: recovery.httpStatus });
  }
  if (recovery.stateName === "conflict") {
    return NextResponse.json(
      { error: "Agent Turn Closure 请求与已保存终态冲突。", reason: "closure_conflict" },
      { status: 409 }
    );
  }
  if (recovery.stateName === "invalid_lease") {
    return NextResponse.json({ error: "Agent Turn Lease 无效或不属于当前用户。" }, { status: 403 });
  }
  const replayed = recovery.stateName === "match";
  if (replayed && recovery.outcome !== body.outcome) {
    return NextResponse.json(
      { error: "Agent Turn Closure Outcome 与已保存终态冲突。", reason: "closure_conflict" },
      { status: 409 }
    );
  }

  let outcomeSnapshot: ReturnType<typeof finalizeAgentTranscriptSnapshotOutcomeToken> | undefined;
  if (proofRequired && proofFieldsValid) {
    const providerOutputSnapshot = normalizeProviderOutputSnapshot(body.providerOutputSnapshot)!;
    const secret = resolveAgentContinuationSecret(process.env);
    const closure = verifyAgentTurnClosureToken({
      token: body.closureToken as string,
      secret,
      userId: userAccess.userId,
      projectId: body.projectId as string,
      leaseId: body.leaseId,
      agentTurnId: body.agentTurnId,
      currentUserMessageId: body.userMessageId as string,
      assistantMessageId: body.assistantMessageId as string,
      transcriptManifestHash: body.transcriptManifestHash as string,
      providerOutputSnapshotHash: providerOutputSnapshot.contentHash,
      now: Date.now(),
      ...(replayed ? { allowExpired: true } : {})
    });
    if (closure.status === "failed") {
      return NextResponse.json(
        { error: "Agent Turn Closure Token 无效。", reason: closure.reason },
        { status: closure.reason === "secret_missing" ? 503 : 400 }
      );
    }
    const snapshotProof = verifyAgentTranscriptSnapshotToken({
      token: body.transcriptSnapshotToken as string,
      secret,
      projectId: body.projectId as string,
      userId: userAccess.userId,
      now: Date.now()
    });
    if (snapshotProof.status === "failed" ||
      snapshotProof.claims.transcriptManifest.manifestHash !== body.transcriptManifestHash) {
      return NextResponse.json(
        {
          error: "Agent Turn Snapshot 与 Closure Token 不一致。",
          reason: snapshotProof.status === "failed" ? snapshotProof.reason : "token_scope"
        },
        { status: 400 }
      );
    }
    outcomeSnapshot = finalizeAgentTranscriptSnapshotOutcomeToken({
      token: body.transcriptSnapshotToken as string,
      secret,
      projectId: body.projectId as string,
      userId: userAccess.userId,
      agentTurnId: body.agentTurnId,
      userMessageId: body.userMessageId as string,
      assistantMessageId: body.assistantMessageId as string,
      outcome: body.outcome,
      ...(body.outcome === "success"
        ? { successProviderOutputSnapshot: providerOutputSnapshot }
        : {}),
      now: Date.now()
    });
    if (outcomeSnapshot.status === "failed") {
      return NextResponse.json(
        { error: "Agent Turn Outcome 无法绑定到当前服务端 Transcript。", reason: outcomeSnapshot.reason },
        { status: outcomeSnapshot.reason === "secret_missing" ? 503 : 400 }
      );
    }
  }

  if (!replayed) {
    const result = await completeAgentTurnLease({
      leaseId: body.leaseId,
      agentTurnId: body.agentTurnId,
      outcome: body.outcome,
      closureRequestId: body.closureRequestId,
      closureRequestHash
    });
    if (result.status === "denied") {
      return NextResponse.json(
        { error: result.error, reason: result.reason },
        { status: result.httpStatus }
      );
    }
  }

  return NextResponse.json({
    status: body.outcome,
    replayed,
    ...(outcomeSnapshot?.status === "ok"
      ? {
          outcomeItem: outcomeSnapshot.outcomeItem,
          transcriptSnapshotToken: outcomeSnapshot.token,
          transcriptManifestHash: outcomeSnapshot.claims.transcriptManifest.manifestHash,
          expiresAt: outcomeSnapshot.claims.exp
        }
      : {})
  });
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

function isBoundedToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 512_000;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
