import { NextResponse } from "next/server";

import { readAgentTurnJournal, type ReadAgentTurnJournalResult } from "@/server/ai/agentTurnJournal";
import { requestAgentTurnExternalCancellation } from "@/server/ai/agentTurnExternalCancellation";
import {
  invalidRequestResponse,
  isBoundedIdentifier,
  isRecord,
  isUuid,
  journalDeniedResponse,
  readBoundedJsonBody,
  unknownKeys
} from "@/server/ai/agentTurnRouteSupport";
import { requireAiRouteUser, type AiRouteUserAccessResult } from "@/server/auth/aiAccess";

export const runtime = "nodejs";
const MAX_CANCELLATION_BODY_BYTES = 16 * 1024;

type RouteContext = { params: Promise<{ turnId: string }> };

export type AgentTurnCancellationRouteDependencies = Readonly<{
  authenticate: () => Promise<AiRouteUserAccessResult>;
  readTurn: (input: {
    serverTurnId: string;
    localProjectId: string;
  }) => Promise<ReadAgentTurnJournalResult>;
  cancelExternal: (input: {
    serverTurnId: string;
    requestId: string;
    stepSequence: number;
  }) => boolean;
}>;

const defaultDependencies: AgentTurnCancellationRouteDependencies = {
  authenticate: requireAiRouteUser,
  readTurn: readAgentTurnJournal,
  cancelExternal: requestAgentTurnExternalCancellation
};

export function createAgentTurnCancellationPostHandler(
  dependencies: AgentTurnCancellationRouteDependencies = defaultDependencies
) {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    const { turnId } = await context.params;
    if (!isUuid(turnId)) return invalidRequestResponse("serverTurnId 格式无效。");
    const auth = await dependencies.authenticate();
    if (auth.status === "denied") {
      return NextResponse.json(
        {
          error: auth.error,
          code: auth.httpStatus === 401 ? "unauthenticated" : "auth_unavailable",
          recoverable: false
        },
        { status: auth.httpStatus }
      );
    }
    const parsed = await readBoundedJsonBody(request, MAX_CANCELLATION_BODY_BYTES);
    if (parsed.status === "failed") return parsed.response;
    if (!isRecord(parsed.value)) return invalidRequestResponse("取消请求必须是对象。");
    const unknown = unknownKeys(parsed.value, ["localProjectId", "requestId", "stepSequence"]);
    if (unknown.length > 0) {
      return invalidRequestResponse(`请求包含不允许的字段：${unknown.join("、")}。`);
    }
    if (
      !isBoundedIdentifier(parsed.value.localProjectId) ||
      !isBoundedIdentifier(parsed.value.requestId) ||
      !Number.isSafeInteger(parsed.value.stepSequence) ||
      (parsed.value.stepSequence as number) < 1 ||
      (parsed.value.stepSequence as number) > 10_000
    ) {
      return invalidRequestResponse("取消请求身份无效。");
    }
    const journal = await dependencies.readTurn({
      serverTurnId: turnId,
      localProjectId: parsed.value.localProjectId
    });
    if (journal.status === "denied") return journalDeniedResponse(journal);
    if (
      journal.snapshot.latestRequestId !== parsed.value.requestId ||
      journal.snapshot.latestStepSequence !== parsed.value.stepSequence
    ) {
      return NextResponse.json(
        {
          error: "取消请求不是当前最新的外部执行。",
          code: "request_not_latest",
          recoverable: false
        },
        { status: 409 }
      );
    }
    if (journal.snapshot.status !== "providerRunning") {
      return NextResponse.json({
        accepted: false,
        observed: false,
        status: journal.snapshot.status
      });
    }
    const observed = dependencies.cancelExternal({
      serverTurnId: turnId,
      requestId: parsed.value.requestId,
      stepSequence: parsed.value.stepSequence as number
    });
    return NextResponse.json({ accepted: true, observed, status: journal.snapshot.status });
  };
}

export const POST = createAgentTurnCancellationPostHandler();
