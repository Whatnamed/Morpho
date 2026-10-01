/** UTF-8 wire limits. Keep SQL constants in the P3B migration covered by schema tests. */
export const EXTERNAL_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
export const EXTERNAL_FROZEN_REQUEST_MAX_BYTES = 8 * 1024 * 1024;
export const EXTERNAL_RECOVERY_RUNTIME_MAX_BYTES = 32 * 1024 * 1024;
export const EXTERNAL_INPUT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const EXTERNAL_INPUT_IMAGES_MAX_BYTES = 2.5 * 1024 * 1024;
export const EXTERNAL_IMAGE_RESULT_MAX_BYTES = 16 * 1024 * 1024;
export const EXTERNAL_JSON_RESULT_MAX_BYTES = 8 * 1024 * 1024;
export const EXTERNAL_RESULT_CHUNK_BYTES = 512 * 1024;
export const EXTERNAL_RESULT_RETENTION_HOURS = 24;
export const EXTERNAL_INVOCATION_SECONDS = 300;
export const EXTERNAL_PROVIDER_BUDGET_MS = 240_000;
export const EXTERNAL_ESCROW_WRITE_BUDGET_MS = 45_000;

export type ExternalResultManifest = Readonly<{
  effectId: string;
  resultId: string;
  version: 1;
  kind: "image" | "text" | "compaction";
  sha256: string;
  byteLength: number;
  mimeType: string;
  chunkCount: number;
  expiresAt: string;
}>;

export function isExternalResultManifest(value: unknown): value is ExternalResultManifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return typeof m.effectId === "string" && /^effect:[0-9a-f]{64}$/.test(m.effectId) &&
    typeof m.resultId === "string" && /^result:[0-9a-f]{64}$/.test(m.resultId) && m.version === 1 &&
    ["image", "text", "compaction"].includes(String(m.kind)) &&
    typeof m.sha256 === "string" && /^[0-9a-f]{64}$/.test(m.sha256) &&
    Number.isSafeInteger(m.byteLength) && Number(m.byteLength) > 0 &&
    Number(m.byteLength) <= (m.kind === "image" ? EXTERNAL_IMAGE_RESULT_MAX_BYTES : EXTERNAL_JSON_RESULT_MAX_BYTES) &&
    m.chunkCount === Math.ceil(Number(m.byteLength) / EXTERNAL_RESULT_CHUNK_BYTES) &&
    typeof m.mimeType === "string" && (m.kind === "image"
      ? /^image\/(png|jpeg|webp|gif|avif)$/.test(m.mimeType) : m.mimeType === "application/json") &&
    typeof m.expiresAt === "string" && Number.isFinite(Date.parse(m.expiresAt));
}

export function resultAckIdentity(m: ExternalResultManifest) {
  return { resultId: m.resultId, version: m.version, sha256: m.sha256 };
}

export function assertExternalRequestBody(body: string): void {
  if (new TextEncoder().encode(body).byteLength > EXTERNAL_REQUEST_MAX_BYTES) {
    throw Object.assign(new Error("请求超过 4 MiB；请减少本次资料后再发送。"), { code: "request_body_too_large" });
  }
}
