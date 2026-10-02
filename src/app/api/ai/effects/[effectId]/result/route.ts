import { imageResultDeliveryErrorResponse } from "@/server/ai/imageResultDeliveryError";
import { requireAiRouteUser, aiAccessDeniedResponse } from "@/server/auth/aiAccess";
import { externalResultStore, externalResultResponse, ExternalResultError } from "@/server/ai/externalResultStore";
import { observeExternalEffect, retrieveExistingImage } from "@/server/ai/externalEffectObservation";
import { saveExternalResult } from "@/server/ai/externalResultStore";
import { readBoundedJsonBody } from "@/server/ai/agentTurnRouteSupport";
import type { EffectIdentity } from "@/server/ai/externalEffectJournal";

export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ effectId: string }> };

async function identity(request: Request, context: Context): Promise<EffectIdentity | Response> {
  const auth = await requireAiRouteUser();
  if (auth.status === "denied") return aiAccessDeniedResponse(auth);
  const { effectId } = await context.params;
  const kind = new URL(request.url).searchParams.get("kind");
  if (!/^effect:[0-9a-f]{64}$/.test(effectId) || !["image", "text", "compaction"].includes(kind ?? "")) {
    return Response.json({ code: "invalid_result_identity" }, { status: 400 });
  }
  return { actorUserId: auth.userId, effectId, kind: kind as EffectIdentity["kind"] };
}
function failure(error: unknown): Response {
  const code = error instanceof ExternalResultError ? error.code : "result_store_unavailable";
  return Response.json({ code, recoverable: false }, { status: code.includes("conflict") ? 409 : 503,
    headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const id = await identity(request, context);
  if (id instanceof Response) return id;
  try {
    const query = new URL(request.url).searchParams;
    if (query.has("chunk")) {
      const index = Number(query.get("chunk"));
      if (!Number.isSafeInteger(index) || index < 0 || index >= 32) return Response.json({ code: "invalid_result_chunk" }, { status: 400 });
      const row = await externalResultStore.call("chunk", id, { resultId: query.get("resultId"), index });
      if (row.state === "expired") return Response.json({ code: "external_result_expired" }, { status: 410 });
      if (typeof row.base64 !== "string") return Response.json({ code: "external_result_unavailable" }, { status: 503 });
      return new Response(Buffer.from(row.base64, "base64"), { headers: {
        "Content-Type": "application/octet-stream", "Cache-Control": "no-store"
      } });
    }
    const saved = await externalResultResponse(id, externalResultStore, id.kind === "image" ? () => retrieveExistingImage(id, request.signal) : undefined);
    if (saved) return saved;
    // A known task may retrieve its original result. No POST/re-admission or expiry resurrection.
    if (id.kind === "image") {
      const observed = await observeExternalEffect(id, { retrieveImage: true, signal: request.signal });
      if (observed.image) {
        await saveExternalResult(externalResultStore, id, observed.image);
        return (await externalResultResponse(id))!;
      }
    }
    return Response.json({ code: "external_result_unavailable", recoverable: false }, { status: 404 });
  } catch (error) {
    if (id.kind === "image" && error instanceof ExternalResultError) return imageResultDeliveryErrorResponse(error.code);
    return failure(error);
  }
}

/** Client persistence claim only; does not set Provider execution or P2 fulfillment. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const id = await identity(request, context);
  if (id instanceof Response) return id;
  const parsed = await readBoundedJsonBody(request, 2048);
  if (parsed.status === "failed") return parsed.response;
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value) ||
    Object.keys(parsed.value).some((key) => !["resultId", "version", "sha256"].includes(key)) ||
    !("resultId" in parsed.value) || typeof parsed.value.resultId !== "string" || !/^result:[0-9a-f]{64}$/.test(parsed.value.resultId) ||
    !("version" in parsed.value) || parsed.value.version !== 1 ||
    !("sha256" in parsed.value) || typeof parsed.value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(parsed.value.sha256)) {
    return Response.json({ code: "invalid_result_ack" }, { status: 400 });
  }
  try {
    const row = await externalResultStore.call("ack", id, parsed.value as Record<string, unknown>);
    if (row.state === "expired") return Response.json({ code: "external_result_expired" }, { status: 410 });
    return Response.json(row, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
