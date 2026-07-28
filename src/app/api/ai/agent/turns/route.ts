import { NextResponse } from "next/server";

import {
  createAgentTurnJournal,
  type CreateAgentTurnJournalResult
} from "@/server/ai/agentTurnJournal";
import {
  invalidRequestResponse,
  isBoundedIdentifier,
  isRecord,
  journalDeniedResponse,
  readBoundedJsonBody,
  unknownKeys
} from "@/server/ai/agentTurnRouteSupport";
import { requireAiRouteUser, type AiRouteUserAccessResult } from "@/server/auth/aiAccess";

export const runtime = "nodejs";

export type CreateAgentTurnRouteDependencies = Readonly<{
  authenticate: () => Promise<AiRouteUserAccessResult>;
  createJournal: typeof createAgentTurnJournal;
}>;

const defaultDependencies: CreateAgentTurnRouteDependencies = {
  authenticate: requireAiRouteUser,
  createJournal: createAgentTurnJournal
};

export function createAgentTurnPostHandler(
  dependencies: CreateAgentTurnRouteDependencies = defaultDependencies
) {
  return async function POST(request: Request): Promise<Response> {
    const parsed = await readBoundedJsonBody(request);
    if (parsed.status === "failed") return parsed.response;
    if (!isRecord(parsed.value)) {
      return invalidRequestResponse("Server Turn 创建请求必须是对象。");
    }
    const unknown = unknownKeys(parsed.value, ["localProjectId", "creationIdempotencyKey"]);
    if (unknown.length > 0) {
      return invalidRequestResponse(`请求包含不允许的字段：${unknown.join("、")}。`);
    }
    if (
      !isBoundedIdentifier(parsed.value.localProjectId) ||
      !isBoundedIdentifier(parsed.value.creationIdempotencyKey)
    ) {
      return invalidRequestResponse("localProjectId 或 creationIdempotencyKey 格式无效。");
    }
    const auth = await dependencies.authenticate();
    if (auth.status === "denied") {
      return NextResponse.json(
        { error: auth.error, code: "unauthenticated", recoverable: false },
        { status: auth.httpStatus }
      );
    }
    const created: CreateAgentTurnJournalResult = await dependencies.createJournal({
      localProjectId: parsed.value.localProjectId,
      creationIdempotencyKey: parsed.value.creationIdempotencyKey
    });
    if (created.status === "denied") return journalDeniedResponse(created);
    return NextResponse.json({ ...created.snapshot, replayed: created.replayed }, { status: 200 });
  };
}

export const POST = createAgentTurnPostHandler();
