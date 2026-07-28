import { NextResponse } from "next/server";

import { normalizeProviderOutputSnapshot } from "@/domain/morpho/providerInputSnapshot";
import { requireAiRouteUser } from "@/server/auth/aiAccess";
import {
  AGENT_TURN_CLOSURE_TOKEN_TTL_MS,
  issueAgentTurnClosureToken,
  resolveAgentContinuationSecret,
  verifyAgentContinuationToken,
  verifyAgentPendingFunctionCallClosureBinding,
  verifyAgentTranscriptSnapshotToken,
  verifyAgentTurnClosureToken
} from "@/server/ai/agentContinuationToken";

export const runtime = "nodejs";

/**
 * Confirm-mode function calls end locally after terminal outputs are produced;
 * there is deliberately no extra Provider request just to obtain a no-call
 * Closure Token. This endpoint proves that exact signed continuation and
 * replaces only its Closure Token with a pending-confirmation-bound proof.
 */
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
    "closureToken",
    "continuationToken",
    "continuationInput",
    "projectId",
    "userMessageId",
    "assistantMessageId",
    "transcriptSnapshotToken",
    "transcriptManifestHash",
    "providerOutputSnapshot"
  ].includes(key)) ||
    !isIdentifier(body.leaseId) || !isIdentifier(body.agentTurnId) ||
    !isIdentifier(body.projectId) || !isIdentifier(body.userMessageId) ||
    !isIdentifier(body.assistantMessageId) ||
    !isBoundedToken(body.closureToken) || !isBoundedToken(body.continuationToken) ||
    !isBoundedToken(body.transcriptSnapshotToken) ||
    !isHash(body.transcriptManifestHash) ||
    !Array.isArray(body.continuationInput) || body.continuationInput.length < 1 || body.continuationInput.length > 1_024 ||
    typeof body.leaseSequence !== "number" || !Number.isSafeInteger(body.leaseSequence) || body.leaseSequence < 1 ||
    !normalizeProviderOutputSnapshot(body.providerOutputSnapshot)) {
    return NextResponse.json({ error: "Pending Closure Proof 参数无效。" }, { status: 400 });
  }

  const userAccess = await requireAiRouteUser();
  if (userAccess.status === "denied") {
    return NextResponse.json({ error: userAccess.error }, { status: userAccess.httpStatus });
  }

  const now = Date.now();
  const secret = resolveAgentContinuationSecret(process.env);
  const providerOutputSnapshot = normalizeProviderOutputSnapshot(body.providerOutputSnapshot)!;
  const incompleteClosure = verifyAgentTurnClosureToken({
    token: body.closureToken,
    secret,
    userId: userAccess.userId,
    projectId: body.projectId,
    leaseId: body.leaseId,
    agentTurnId: body.agentTurnId,
    currentUserMessageId: body.userMessageId,
    assistantMessageId: body.assistantMessageId,
    transcriptManifestHash: body.transcriptManifestHash,
    providerOutputSnapshotHash: providerOutputSnapshot.contentHash,
    allowIncompleteTerminalFunctionCalls: true,
    now
  });
  if (incompleteClosure.status === "failed" || incompleteClosure.claims.terminalFunctionCalls ||
    incompleteClosure.claims.requiredOutcome !== undefined || incompleteClosure.claims.terminalOutputHash !== undefined ||
    incompleteClosure.claims.leaseSequence !== body.leaseSequence) {
    return NextResponse.json(
      { error: "Pending Closure 缺少匹配的未完成 Closure Token。", reason: incompleteClosure.status === "failed" ? incompleteClosure.reason : "token_scope" },
      { status: incompleteClosure.status === "failed" && incompleteClosure.reason === "secret_missing" ? 503 : 400 }
    );
  }

  const continuation = verifyAgentContinuationToken({
    token: body.continuationToken,
    secret,
    leaseId: body.leaseId,
    agentTurnId: body.agentTurnId,
    expectedSequence: body.leaseSequence,
    now
  });
  if (continuation.status === "failed" || continuation.claims.summary ||
    continuation.claims.sequence !== incompleteClosure.claims.leaseSequence) {
    return NextResponse.json(
      { error: "Pending Closure 缺少匹配的 Provider continuation。", reason: continuation.status === "failed" ? continuation.reason : "token_scope" },
      { status: continuation.status === "failed" && continuation.reason === "secret_missing" ? 503 : 400 }
    );
  }

  const snapshot = verifyAgentTranscriptSnapshotToken({
    token: body.transcriptSnapshotToken,
    secret,
    projectId: body.projectId,
    userId: userAccess.userId,
    now
  });
  if (snapshot.status === "failed" || snapshot.claims.transcriptManifest.manifestHash !== body.transcriptManifestHash ||
    snapshot.claims.transcriptManifest.manifestHash !== incompleteClosure.claims.transcriptManifestHash) {
    return NextResponse.json(
      { error: "Pending Closure Snapshot 与 Closure Token 不一致。", reason: snapshot.status === "failed" ? snapshot.reason : "token_scope" },
      { status: snapshot.status === "failed" && snapshot.reason === "secret_missing" ? 503 : 400 }
    );
  }

  const binding = verifyAgentPendingFunctionCallClosureBinding({
    claims: continuation.claims,
    parsedInput: body.continuationInput
  });
  if (binding.status === "failed") {
    return NextResponse.json(
      { error: "Pending Closure 的工具输出未完整绑定到 Provider Call。", reason: binding.reason },
      { status: 400 }
    );
  }

  const closureToken = issueAgentTurnClosureToken({
    secret: secret!,
    userId: incompleteClosure.claims.userId,
    projectId: incompleteClosure.claims.projectId,
    leaseId: incompleteClosure.claims.leaseId,
    agentTurnId: incompleteClosure.claims.agentTurnId,
    leaseSequence: incompleteClosure.claims.leaseSequence,
    currentUserMessageId: incompleteClosure.claims.currentUserMessageId,
    assistantMessageId: incompleteClosure.claims.assistantMessageId,
    transcriptManifestHash: incompleteClosure.claims.transcriptManifestHash,
    providerOutputSnapshotHash: incompleteClosure.claims.providerOutputSnapshotHash,
    terminalFunctionCalls: true,
    requiredOutcome: "pendingConfirmation",
    terminalOutputHash: binding.terminalOutputHash,
    now
  });
  return NextResponse.json({
    status: "pendingConfirmation",
    closureToken,
    terminalOutputHash: binding.terminalOutputHash,
    expiresAt: now + AGENT_TURN_CLOSURE_TOKEN_TTL_MS
  });
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
