import { externalResultStore, saveExternalResult, externalResultResponse } from "./externalResultStore";
import "server-only";

import { loadGrsImageConfig } from "@/server/image/config";
import { resolveGrsImageResult } from "@/server/image/grsProvider";
import type { ExternalEffectSnapshot, ExternalObservation } from "@/shared/externalEffectProtocol";
import {
  digest, externalEffectJournal, providerNamespace, sameProviderNamespace,
  type EffectIdentity, type EffectJournalPort
} from "./externalEffectJournal";

/** Pure observation/same-task retrieval. Does not register effects, reserve quota or acquire a POST. */
export async function observeExternalEffect(
  identity: EffectIdentity,
  options: {
    retrieveImage?: boolean;
    signal?: AbortSignal;
    journal?: EffectJournalPort;
    loadConfig?: typeof loadGrsImageConfig;
    query?: typeof resolveGrsImageResult;
  } = {}
): Promise<{ effect: ExternalEffectSnapshot | null; image?: Blob; mimeType?: string; limit?: string }> {
  const journal = options.journal ?? externalEffectJournal;
  let { snapshot: effect } = await journal.call("read", identity);
  if (!effect) return { effect: null, limit: "legacy_identity_unavailable" };
  if (effect.kind !== "image" || !effect.taskId || !effect.attemptId || !effect.namespace) {
    return { effect, limit: "provider_lookup_not_guaranteed" };
  }
  const config = (options.loadConfig ?? loadGrsImageConfig)(process.env);
  if (config.status !== "ok" ||
    !sameProviderNamespace(providerNamespace("grsai", config.config), effect.namespace)) {
    return { effect, limit: "provider_namespace_unavailable" };
  }
  const attemptId = effect.attemptId;
  const observe = async (observation: ExternalObservation) => {
    const result = await journal.call("observe", identity, {
      attemptId,
      observationId: digest(JSON.stringify([attemptId, observation])),
      observation
    });
    effect = result.snapshot;
  };
  const result = await (options.query ?? resolveGrsImageResult)(config.config, {
    modelId: config.config.model, prompt: "", images: [], aspectRatio: "1:1", referenceObjectIds: []
  }, {
    resumeTaskId: effect.taskId,
    maxPolls: 1,
    downloadResult: options.retrieveImage === true,
    signal: options.signal,
    effect: {
      beforeSubmit: async () => { throw new Error("Observation cannot submit a paid execution."); },
      observe,
      // Disconnecting an observer is not an explicit cancel command.
      cancel: async () => undefined
    }
  });
  return {
    effect,
    ...(result.status === "ok" ? { image: result.blob, mimeType: result.mimeType } : {})
  };
}

export async function existingImageEffectResponse(
  identity: EffectIdentity, signal?: AbortSignal
): Promise<Response | undefined> {
  const result = await observeExternalEffect(identity, { retrieveImage: true, signal });
  if (!result.effect) return undefined;
  if (result.image) {
    await saveExternalResult(externalResultStore, identity, result.image);
    return (await externalResultResponse(identity))!;
  }
  const state = result.effect.executionState;
  return Response.json({
    effect: result.effect,
    ...(result.limit ? { observationLimit: result.limit } : {}),
    code: state === "succeeded" ? "external_action_result_unavailable"
      : state === "failed" ? "image_generation_failed"
      : state === "cancelled" ? "provider_cancelled"
      : state === "running" ? "external_execution_running" : "external_execution_state_unknown",
    error: state === "running" ? "图像仍在外部执行；只能继续观察同一任务。"
      : "无法交付同一执行的图像结果；不会重新提交生成。",
    recoverable: false
  }, { status: state === "running" ? 202 : 409 });
}

/** Trusted namespace and known task only; beforeSubmit rejects paid POST. */
export async function retrieveExistingImage(identity: EffectIdentity, signal?: AbortSignal): Promise<Blob | undefined> {
  return (await observeExternalEffect(identity, { retrieveImage: true, signal })).image;
}
