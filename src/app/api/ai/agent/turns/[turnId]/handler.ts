import { NextResponse } from "next/server";
import { externalEffectId, type EffectIdentity } from "@/server/ai/externalEffectJournal";
import { observeExternalEffect } from "@/server/ai/externalEffectObservation";

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
  observeEffect?: (identity: EffectIdentity) => ReturnType<typeof observeExternalEffect>;
}>;

type RouteContext = { params: Promise<{ turnId: string }> };

const defaultDependencies: ReadAgentTurnRouteDependencies = {
  authenticate: requireAiRouteUser,
  readJournal: readAgentTurnJournal,
  observeEffect: observeExternalEffect
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
    if (read.status === "denied") return journalDeniedResponse(read);
    let externalEffect;
    if (read.snapshot.latestRequestId) {
      try {
        externalEffect = (await dependencies.observeEffect?.({
          actorUserId: auth.userId,
          effectId: externalEffectId("a-plus", turnId, localProjectId,
            "text", read.snapshot.latestRequestId, read.snapshot.latestStepSequence),
          kind: "text"
        }))?.effect;
      } catch {
        // Old Journal query remains available when the additive observation contract is unavailable.
      }
    }
    return NextResponse.json({ ...read.snapshot, ...(externalEffect ? { externalEffect } : {}) });
  };
}
