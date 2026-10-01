import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import { EXTERNAL_FROZEN_REQUEST_MAX_BYTES, isExternalResultManifest } from "@/shared/externalResultProtocol";
import { applyImageGenerationResultCommit, type ImageGenerationResultCommit } from "./imageGenerationResultCommit";
import { acknowledgePersistedExternalResult, downloadExternalResult, resultResource } from "./externalResultClient";
import type { WorkspaceVisualGenerationExecutionPorts } from "./workspaceVisualGenerationExecution";

type ImageCommitDraft = Omit<Extract<ImageGenerationResultCommit, { status: "succeeded" }>, "asset">;
type Intent = { effectId: string; requestBody: string; draft: ImageCommitDraft };
type IndexEntry = { key: string; effectId: string; expiresAt: number };
const PREFIX = "morpho.independent-image-delivery.v1.";
function readIndex(projectId: string): IndexEntry[] {
  const raw = localStorage.getItem(PREFIX + projectId);
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 32 || !value.every((v) => v && typeof v === "object" &&
    typeof v.key === "string" && v.key.startsWith(PREFIX) && typeof v.effectId === "string" && /^effect:[0-9a-f]{64}$/.test(v.effectId) &&
    Number.isFinite(v.expiresAt))) throw new Error("Independent image delivery record invalid.");
  return value as IndexEntry[];
}
async function remove(projectId: string, key: string): Promise<void> {
  localStorage.setItem(PREFIX + projectId, JSON.stringify(readIndex(projectId).filter((e) => e.key !== key)));
  await indexedDbBlobStore.delete(key);
}

/** Persist the exact confirmed independent input and local commit draft before handing it to Fetch. */
export async function prepareIndependentImageDelivery(projectId: string, clientRequestId: string, requestBody: string, draft: ImageCommitDraft): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(["image", clientRequestId])));
  const effectId = `effect:${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2,"0")).join("")}`;
  const key = `${PREFIX}${projectId}.${effectId}`;
  const blob = new Blob([JSON.stringify({ effectId, requestBody, draft } satisfies Intent)], { type: "application/json" });
  if (blob.size > EXTERNAL_FROZEN_REQUEST_MAX_BYTES) throw new Error("Independent image intent too large.");
  for (const entry of readIndex(projectId)) if (entry.expiresAt <= Date.now()) await remove(projectId, entry.key);
  const entries = readIndex(projectId);
  if (entries.length >= 32 && !entries.some((e) => e.key === key)) throw new Error("Independent image recovery capacity exceeded.");
  await indexedDbBlobStore.put(key, blob);
  try {
    if (!entries.some((e) => e.key === key)) entries.push({ key, effectId, expiresAt: Date.now() + 86_400_000 });
    localStorage.setItem(PREFIX + projectId, JSON.stringify(entries));
  } catch (error) { await indexedDbBlobStore.delete(key); throw error; }
  return key;
}
export async function completeIndependentImageDelivery(projectId: string, key: string): Promise<void> { await remove(projectId, key); }

/** One bounded read per pending result on reload. Never POST the saved request to a Provider. */
export async function resumeIndependentImageDeliveries(ports: WorkspaceVisualGenerationExecutionPorts): Promise<void> {
  const session = ports.getCurrentSession();
  for (const entry of readIndex(session.projectId)) {
    ports.assertCurrentSession(session);
    if (entry.expiresAt <= Date.now()) { await remove(session.projectId, entry.key); continue; }
    const raw = await indexedDbBlobStore.get(entry.key);
    if (!raw || raw.size > EXTERNAL_FROZEN_REQUEST_MAX_BYTES) continue;
    const intent = JSON.parse(await raw.text()) as Intent;
    if (intent.effectId !== entry.effectId || !intent.draft || intent.draft.status !== "succeeded") continue;
    const workspace = ports.commitWorkspace(session, (current) => ({ workspace: current, value: current }));
    const operation = workspace.operations[intent.draft.operationId];
    if (!operation || operation.status === "cancelled") continue;
    const response = await ports.fetch(resultResource({ effectId: entry.effectId, kind: "image" }));
    if (response.status === 410) { await remove(session.projectId, entry.key); continue; }
    if (!response.ok) continue;
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || !("result" in value) || !isExternalResultManifest(value.result) ||
      value.result.kind !== "image" || value.result.effectId !== entry.effectId) continue;
    const delivery = value.result;
    const providerTaskId = response.headers.get("X-Morpho-Provider-Task-Id") || intent.draft.providerTaskId;
    const blob = await downloadExternalResult(delivery, ports.fetch);
    ports.assertCurrentSession(session);
    const existing = Object.values(workspace.objects).find((o) => o.type === "image" &&
      o.generation?.clientRequestId === intent.draft.generation.clientRequestId);
    if (!existing) {
      const saved = await ports.saveGeneratedAsset(new File([blob], "recovered-image", { type: blob.type }));
      if (saved.status !== "ok") continue;
      ports.assertCurrentSession(session);
      ports.commitWorkspace(session, (current) => {
        const result = applyImageGenerationResultCommit(current, { ...intent.draft, providerTaskId, asset: saved.asset,
          generation: { ...intent.draft.generation, providerTaskId, delivery } });
        return { workspace: result.workspace, value: undefined };
      });
    } else if (existing.type === "image" && existing.assetId) {
      const asset = workspace.assets[existing.assetId];
      if (!asset) continue;
      // Same verified result, same local asset identity; a prior failed transaction may be repaired.
      await indexedDbBlobStore.put(asset.storageKey, blob);
    }
    const persisted = ports.persistWorkspace?.();
    if (persisted?.phase !== "saved" || persisted.isDirty) continue;
    await acknowledgePersistedExternalResult(session.projectId, delivery, ports.fetch);
    await remove(session.projectId, entry.key);
  }
}
