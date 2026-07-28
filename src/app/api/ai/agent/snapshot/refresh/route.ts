import { NextResponse } from "next/server";

import {
  refreshAgentTranscriptSnapshotToken,
  resolveAgentContinuationSecret
} from "@/server/ai/agentContinuationToken";
import type { AgentTranscriptManifest } from "@/shared/agentCompactionProtocol";
import { requireAiRouteUser } from "@/server/auth/aiAccess";

export const runtime = "nodejs";
export const MAX_AGENT_SNAPSHOT_REFRESH_BODY_BYTES = 1024 * 1024;

export async function POST(request: Request) {
  let body: unknown;
  try {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_AGENT_SNAPSHOT_REFRESH_BODY_BYTES) {
      return NextResponse.json({ error: "Snapshot Refresh 请求体超过允许大小。" }, { status: 413 });
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_AGENT_SNAPSHOT_REFRESH_BODY_BYTES) {
      return NextResponse.json({ error: "Snapshot Refresh 请求体超过允许大小。" }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "请求不是有效 JSON。" }, { status: 400 });
  }
  if (!isRecord(body) || unknownKeys(body, ["projectId", "token", "transcriptManifest"]).length > 0 ||
    typeof body.projectId !== "string" || body.projectId.length < 1 || body.projectId.length > 160 ||
    typeof body.token !== "string" || body.token.length < 16 || body.token.length > 512_000) {
    return NextResponse.json({ error: "Snapshot Refresh 请求格式无效。" }, { status: 400 });
  }
  const userAccess = await requireAiRouteUser();
  if (userAccess.status === "denied") {
    return NextResponse.json({ error: userAccess.error }, { status: userAccess.httpStatus });
  }
  const refreshed = refreshAgentTranscriptSnapshotToken({
    token: body.token,
    secret: resolveAgentContinuationSecret(process.env),
    projectId: body.projectId,
    userId: userAccess.userId,
    now: Date.now(),
    ...(body.transcriptManifest ? { transcriptManifest: body.transcriptManifest as AgentTranscriptManifest } : {})
  });
  if (refreshed.status === "failed") {
    return NextResponse.json(
      { error: "Transcript Snapshot 无法验证或已超过刷新期限。", reason: refreshed.reason },
      { status: refreshed.reason === "secret_missing" ? 503 : 400 }
    );
  }
  return NextResponse.json({
    transcriptSnapshotToken: refreshed.token,
    transcriptManifestHash: refreshed.claims.transcriptManifest.manifestHash,
    expiresAt: refreshed.claims.exp
  });
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  const set = new Set(allowed);
  return Object.keys(value).filter((key) => !set.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
