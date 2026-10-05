// Eval-only export/rehydration of native Recovery bytes; never manufacture an old intent.
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import { EXTERNAL_FROZEN_REQUEST_MAX_BYTES } from "@/shared/externalResultProtocol";
import type { MorphoWorkspace } from "@/domain/morpho/types";

const prefix = "morpho.independent-image-delivery.v1.";
export const hashBlob = async (blob: Blob) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, "0")).join("");
const stringHash = (value: string) => hashBlob(new Blob([value]));
export type CapturedIntent = {
  key: string; byteLength: number; sha256: string; mimeType: string; base64: string;
  effectId: string; requestBodySha256: string; draftSha256: string; operationId: string; clientRequestId: string;
};
export type RecoveryCapture = {
  version: 1; projectId: string; workspaceKey: string; workspaceValue: string;
  catalogKey: string; catalogValue: string; indexKey: string; indexValue: string;
  intents: CapturedIntent[];
};
const decode = (intent: CapturedIntent) => new Blob([Uint8Array.from(atob(intent.base64), c => c.charCodeAt(0))], { type: intent.mimeType });
async function encode(blob: Blob): Promise<string> {
  return new Promise((yes, no) => { const reader = new FileReader(); reader.onload = () => yes(String(reader.result).split(",")[1]); reader.onerror = () => no(reader.error); reader.readAsDataURL(blob); });
}
function index(capture: RecoveryCapture): Array<{ key: string; effectId: string; expiresAt: number }> {
  const value = JSON.parse(capture.indexValue) as Array<{ key: string; effectId: string; expiresAt: number }>;
  if (!Array.isArray(value) || value.length > 32 || value.some(e => e.key !== `${prefix}${capture.projectId}.${e.effectId}` || !/^effect:[0-9a-f]{64}$/.test(e.effectId) || !Number.isFinite(e.expiresAt))) throw Error("Invalid captured intent index");
  return value;
}
export async function validateRecoveryCapture(capture: RecoveryCapture): Promise<void> {
  if (capture.version !== 1 || capture.indexKey !== prefix + capture.projectId) throw Error("Invalid Recovery capture");
  const workspace = JSON.parse(capture.workspaceValue) as MorphoWorkspace;
  if (workspace.project.id !== capture.projectId) throw Error("Recovery project mismatch");
  const entries = index(capture);
  if (entries.length !== capture.intents.length || new Set(entries.map(e => e.key)).size !== entries.length) throw Error("Missing or duplicate original intent blob");
  for (const entry of entries) {
    const stored = capture.intents.find(i => i.key === entry.key);
    if (!stored) throw Error("Missing original intent blob");
    const blob = decode(stored);
    if (blob.size > EXTERNAL_FROZEN_REQUEST_MAX_BYTES || blob.size !== stored.byteLength || await hashBlob(blob) !== stored.sha256) throw Error("Intent byte length / hash mismatch");
    const intent = JSON.parse(await blob.text());
    const body = JSON.parse(intent.requestBody);
    if (intent.effectId !== entry.effectId || stored.effectId !== entry.effectId ||
      intent.effectId !== "effect:" + await stringHash(JSON.stringify(["image", body.clientRequestId])) ||
      await stringHash(intent.requestBody) !== stored.requestBodySha256 ||
      await stringHash(JSON.stringify(intent.draft)) !== stored.draftSha256 ||
      intent.draft.status !== "succeeded" || intent.draft.operationId !== stored.operationId ||
      body.operationId !== stored.operationId || intent.draft.generation.operationId !== stored.operationId ||
      body.clientRequestId !== stored.clientRequestId || intent.draft.generation.clientRequestId !== stored.clientRequestId ||
      workspace.operations[stored.operationId]?.type !== "imageGeneration") throw Error("Intent body / draft / operation identity mismatch");
  }
}
export async function captureRecoveryState(keys: { workspaceKey: string; catalogKey: string }): Promise<RecoveryCapture> {
  const workspaceValue = localStorage.getItem(keys.workspaceKey)!;
  const ws = JSON.parse(workspaceValue) as MorphoWorkspace;
  const indexKey = prefix + ws.project.id;
  const capture: RecoveryCapture = { version: 1, projectId: ws.project.id, workspaceKey: keys.workspaceKey, catalogKey: keys.catalogKey, workspaceValue,
    catalogValue: localStorage.getItem(keys.catalogKey)!, indexKey, indexValue: localStorage.getItem(indexKey) ?? "[]", intents: [] };
  for (const entry of index(capture)) {
    const blob = await indexedDbBlobStore.get(entry.key);
    if (!blob) throw Error("Pending index has no original intent blob");
    const intent = JSON.parse(await blob.text());
    capture.intents.push({ key: entry.key, byteLength: blob.size, sha256: await hashBlob(blob), mimeType: blob.type,
      base64: await encode(blob), effectId: intent.effectId, requestBodySha256: await stringHash(intent.requestBody),
      draftSha256: await stringHash(JSON.stringify(intent.draft)), operationId: intent.draft.operationId,
      clientRequestId: intent.draft.generation.clientRequestId });
  }
  await validateRecoveryCapture(capture);
  return capture;
}
export async function rehydrateRecoveryCapture(capture: RecoveryCapture): Promise<void> {
  await validateRecoveryCapture(capture); // Complete validation before any writes or recovery/network.
  for (const intent of capture.intents) await indexedDbBlobStore.put(intent.key, decode(intent));
  localStorage.setItem(capture.workspaceKey, capture.workspaceValue);
  localStorage.setItem(capture.catalogKey, capture.catalogValue);
  localStorage.setItem(capture.indexKey, capture.indexValue);
}
export async function verifyStoredRecovery(capture: RecoveryCapture): Promise<void> {
  await validateRecoveryCapture(capture);
  if (localStorage.getItem(capture.indexKey) !== capture.indexValue) throw Error("Original pending index changed");
  for (const intent of capture.intents) {
    const blob = await indexedDbBlobStore.get(intent.key);
    if (!blob || blob.size !== intent.byteLength || await hashBlob(blob) !== intent.sha256) throw Error("Stored original intent missing / corrupt / hash mismatch");
  }
}
