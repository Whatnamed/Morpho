import { NextResponse } from "next/server";

import {
  refreshAgentTranscriptSnapshotToken,
  resolveAgentContinuationSecret
} from "@/server/ai/agentContinuationToken";
import type { AgentTranscriptManifest } from "@/shared/agentCompactionProtocol";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求不是有效 JSON。" }, { status: 400 });
  }
  if (!isRecord(body) || unknownKeys(body, ["projectId", "token", "transcriptManifest"]).length > 0 ||
    typeof body.projectId !== "string" || body.projectId.length < 1 || body.projectId.length > 160 ||
    typeof body.token !== "string" || body.token.length < 16 || body.token.length > 512_000) {
    return NextResponse.json({ error: "Snapshot Refresh 请求格式无效。" }, { status: 400 });
  }
  const refreshed = refreshAgentTranscriptSnapshotToken({
    token: body.token,
    secret: resolveAgentContinuationSecret(process.env),
    projectId: body.projectId,
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
    expiresAt: Date.now() + 24 * 60 * 60 * 1000
  });
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  const set = new Set(allowed);
  return Object.keys(value).filter((key) => !set.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
