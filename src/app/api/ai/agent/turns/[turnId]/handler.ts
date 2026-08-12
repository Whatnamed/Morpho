import { NextResponse } from "next/server";

import {
  readAgentTurnJournal,
  type ReadAgentTurnJournalResult
} from "@/server/ai/agentTurnJournal";
import {
  invalidRequestResponse,
  isBoundedIdentifier,
  isUuid,
  journalDeniedResponse
} from "@/server/ai/agentTurnRouteSupport";
import { requireAiRouteUser, type AiRouteUserAccessResult } from "@/server/auth/aiAccess";

export type ReadAgentTurnRouteDependencies = Readonly<{
  authenticate: () => Promise<AiRouteUserAccessResult>;
  readJournal: typeof readAgentTurnJournal;
}>;

type RouteContext = { params: Promise<{ turnId: string }> };

const defaultDependencies: ReadAgentTurnRouteDependencies = {
  authenticate: requireAiRouteUser,
  readJournal: readAgentTurnJournal
};

export function createAgentTurnGetHandler(
  dependencies: ReadAgentTurnRouteDependencies = defaultDependencies
) {
  return async function GET(request: Request, context: RouteContext): Promise<Response> {
    const { turnId } = await context.params;
    const localProjectId = new URL(request.url).searchParams.get("localProjectId");
    if (!isUuid(turnId) || !isBoundedIdentifier(localProjectId)) {
      return invalidRequestResponse("serverTurnId 或 localProjectId 格式无效。");
    }
    const auth = await dependencies.authenticate();
    if (auth.status === "denied") {
      return NextResponse.json(
        { error: auth.error, code: "unauthenticated", recoverable: false },
        { status: auth.httpStatus }
      );
    }
    const read: ReadAgentTurnJournalResult = await dependencies.readJournal({
      serverTurnId: turnId,
      localProjectId
    });
    return read.status === "denied"
      ? journalDeniedResponse(read)
      : NextResponse.json(read.snapshot);
  };
}
