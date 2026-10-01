import { requireAiRouteUser, aiAccessDeniedResponse } from "@/server/auth/aiAccess";
import { externalEffectJournal } from "@/server/ai/externalEffectJournal";
import { observeExternalEffect } from "@/server/ai/externalEffectObservation";

export const runtime = "nodejs";
type Context = { params: Promise<{ effectId: string }> };

/** Server facts only; no request body/config reconstruction or new paid admission. */
export async function GET(request: Request, context: Context): Promise<Response> {
  return handle(request, context, false);
}

/** The only client write is cancel intent, never an execution-state observation. */
export async function POST(request: Request, context: Context): Promise<Response> {
  return handle(request, context, true);
}

async function handle(request: Request, context: Context, cancel: boolean): Promise<Response> {
  const auth = await requireAiRouteUser();
  if (auth.status === "denied") return aiAccessDeniedResponse(auth);
  const { effectId } = await context.params;
  const kind = new URL(request.url).searchParams.get("kind");
  if (!/^effect:[0-9a-f]{64}$/.test(effectId) || !["text", "image", "compaction"].includes(kind ?? "")) {
    return Response.json({ code: "invalid_effect_identity" }, { status: 400 });
  }
  const identity = { actorUserId: auth.userId, effectId, kind: kind as "text" | "image" | "compaction" };
  try {
    if (cancel) {
      const result = await externalEffectJournal.call("cancel", identity);
      return Response.json({ effect: result.snapshot, cancelIntentRecorded: true,
        providerCancellationConfirmed: result.snapshot?.executionState === "cancelled" });
    }
    const result = await observeExternalEffect(identity, {
      retrieveImage: new URL(request.url).searchParams.get("result") === "image",
      signal: request.signal
    });
    if (result.image) return new Response(result.image, { headers: {
      "Content-Type": result.mimeType!, "Cache-Control": "no-store",
      "X-Morpho-Provider-Task-Id": result.effect?.taskId ?? ""
    } });
    return Response.json(result, { status: result.effect ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ code: "effect_observation_unavailable", recoverable: false }, { status: 503 });
  }
}
