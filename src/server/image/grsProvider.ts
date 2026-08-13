import { getGrsRequestProfile } from "./profile";
import type { GrsImageAspectRatio } from "@/domain/morpho/grsImageModels";
import { buildAllowedImageHosts, downloadSecureProviderImage } from "./secureImageDownload";
import {
  createProviderRequestBudget,
  PROVIDER_OVERALL_DEADLINE_MS,
  ProviderResponseBoundaryError,
  type ProviderRequestBudget
} from "../ai/providerResponseBoundary";
import { visitProviderResponseRecords } from "../ai/providerResponseTraversal";

export type GrsImageConfig = {
  apiKey: string;
  baseUrl: string;
  fallbackBaseUrls?: string[];
  imageHostAllowlist?: string[];
  model: string;
};

export type GrsGenerateInput = {
  modelId: string;
  prompt: string;
  images: string[];
  aspectRatio: GrsImageAspectRatio;
  sizeOption?: string;
  referenceObjectIds: string[];
  directionObjectId?: string;
  operationId?: string;
  clientRequestId?: string;
};

export type GrsGenerateRequest = {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    prompt: string;
    images: string[];
    aspectRatio: string;
    imageSize?: string;
    replyType: string;
  };
};

export type GrsImageResult =
  | {
      status: "ok";
      blob: Blob;
      mimeType: string;
      providerTaskId?: string;
    }
  | {
      status: "failed";
      reason: string;
    }
  | {
      status: "cancelled";
      reason: string;
    };

export type ResolveGrsImageOptions = {
  fetchImpl?: typeof fetch;
  maxPolls?: number;
  pollDelayMs?: number;
  generateAttempts?: number;
  retryDelayMs?: number;
  overallDeadlineMs?: number;
  signal?: AbortSignal;
};

const DEFAULT_MAX_POLLS = 12;
const DEFAULT_POLL_DELAY_MS = 1500;
const DEFAULT_GENERATE_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_GRS_JSON_RESPONSE_BYTES = 256 * 1024;

export function createGrsGenerateRequest(config: GrsImageConfig, input: GrsGenerateInput): GrsGenerateRequest {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const profile = getGrsRequestProfile({
    modelId: input.modelId || config.model,
    aspectRatio: input.aspectRatio,
    sizeOption: input.sizeOption
  });
  const body: GrsGenerateRequest["body"] = {
    model: profile.modelId,
    prompt: input.prompt,
    images: input.images,
    aspectRatio: profile.aspectRatio,
    replyType: profile.replyType
  };

  if (profile.imageSize) {
    body.imageSize = profile.imageSize;
  }

  return {
    url: `${baseUrl}/v1/api/generate`,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body
  };
}

export async function resolveGrsImageResult(
  config: GrsImageConfig,
  input: GrsGenerateInput,
  options: ResolveGrsImageOptions = {}
): Promise<GrsImageResult> {
  const budget = createProviderRequestBudget(
    options.signal,
    options.overallDeadlineMs ?? PROVIDER_OVERALL_DEADLINE_MS
  );
  try {
    return await resolveGrsImageResultWithBudget(config, input, options, budget);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) {
      return { status: "cancelled", reason: "GrsAI image request was cancelled." };
    }
    if (error instanceof ProviderResponseBoundaryError && error.code === "provider_deadline_exceeded") {
      return { status: "failed", reason: "GrsAI image request exceeded its overall safety deadline." };
    }
    return { status: "failed", reason: "GrsAI image request failed." };
  } finally {
    budget.dispose();
  }
}

async function resolveGrsImageResultWithBudget(
  config: GrsImageConfig,
  input: GrsGenerateInput,
  options: ResolveGrsImageOptions,
  budget: ProviderRequestBudget
): Promise<GrsImageResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
  const pollDelayMs = options.pollDelayMs ?? DEFAULT_POLL_DELAY_MS;
  const generateAttempts = Math.max(1, options.generateAttempts ?? DEFAULT_GENERATE_ATTEMPTS);
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const signal = options.signal;
  const baseUrls = uniqueBaseUrls(config.baseUrl, config.fallbackBaseUrls);
  const attemptBaseUrls =
    baseUrls.length > 1
      ? baseUrls.slice(0, Math.max(generateAttempts, baseUrls.length))
      : Array.from({ length: generateAttempts }, () => config.baseUrl);

  let generateResponse: Awaited<ReturnType<typeof safeFetch>> | undefined;
  let activeBaseUrl = config.baseUrl;
  for (let attempt = 0; attempt < attemptBaseUrls.length; attempt += 1) {
    const attemptBaseUrl = attemptBaseUrls[attempt] ?? config.baseUrl;
    const request = createGrsGenerateRequest({ ...config, baseUrl: attemptBaseUrl }, input);
    try {
      generateResponse = await safeFetch(fetchImpl, request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: budget.signal
      }, budget);
    } catch (error) {
      if (error instanceof ProviderResponseBoundaryError) throw error;
      if (attempt < attemptBaseUrls.length - 1 && !signal?.aborted) {
        await budget.wait(retryDelayMs);
        continue;
      }
      const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
      return {
        status: "failed",
        reason: `GrsAI network request failed after ${attempt + 1} attempts${detail}`
      };
    }

    if (
      generateResponse.status === "ok" &&
      !generateResponse.response.ok &&
      isTransientHttpStatus(generateResponse.response.status) &&
      attempt < attemptBaseUrls.length - 1
    ) {
      await budget.wait(retryDelayMs);
      continue;
    }
    activeBaseUrl = attemptBaseUrl;
    break;
  }

  if (!generateResponse) {
    return { status: "failed", reason: "GrsAI image request did not start." };
  }

  if (generateResponse.status === "cancelled") {
    return generateResponse;
  }

  if (!generateResponse.response.ok) {
    let detail = "";
    try {
      const errorBody = await readBoundedResponseText(generateResponse.response, budget);
      if (errorBody) {
        try {
          const parsed = JSON.parse(errorBody) as unknown;
          detail = extractFailureDetail(parsed) ?? errorBody.substring(0, 200);
        } catch {
          detail = errorBody.substring(0, 200);
        }
      }
    } catch (error) {
      return responseReadFailure("generate", error);
    }
    const reason = detail
      ? `GrsAI generate returned ${generateResponse.response.status}: ${detail}`
      : `GrsAI generate returned ${generateResponse.response.status}.`;
    return { status: "failed", reason };
  }

  let generatePayload: unknown;
  try {
    generatePayload = await readJson(generateResponse.response, budget);
  } catch (error) {
    return responseReadFailure("generate", error);
  }
  const allowedImageHosts = buildAllowedImageHosts(config);
  budget.throwIfUnavailable();
  const immediate = await resolvePayload(
    fetchImpl,
    generatePayload,
    signal,
    budget.deadlineSignal,
    extractTaskId(generatePayload),
    allowedImageHosts
  );
  if (immediate.status !== "pending") {
    return immediate;
  }

  const taskId = extractTaskId(generatePayload);
  if (!taskId) {
    return { status: "failed", reason: "GrsAI did not return an image URL or task id." };
  }

  const resultUrl = `${activeBaseUrl.replace(/\/$/, "")}/v1/api/result?id=${encodeURIComponent(taskId)}`;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    if (signal?.aborted) {
      return { status: "cancelled", reason: "GrsAI image request was cancelled." };
    }

    budget.throwIfUnavailable();
    const resultResponse = await safeFetch(fetchImpl, resultUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: budget.signal
    }, budget);

    if (resultResponse.status === "cancelled") {
      return resultResponse;
    }

    if (!resultResponse.response.ok) {
      return { status: "failed", reason: `GrsAI result returned ${resultResponse.response.status}.` };
    }

    let resultPayload: unknown;
    try {
      resultPayload = await readJson(resultResponse.response, budget);
    } catch (error) {
      return responseReadFailure("result", error);
    }
    budget.throwIfUnavailable();
    const resolved = await resolvePayload(fetchImpl, resultPayload, signal, budget.deadlineSignal, taskId, allowedImageHosts);
    if (resolved.status !== "pending") {
      return resolved;
    }

    if (attempt < maxPolls - 1) {
      await budget.wait(pollDelayMs);
    }
  }

  return { status: "failed", reason: "GrsAI image task did not finish before the polling limit." };
}

async function resolvePayload(
  fetchImpl: typeof fetch,
  payload: unknown,
  signal: AbortSignal | undefined,
  deadlineSignal: AbortSignal,
  providerTaskId: string | undefined,
  allowedImageHosts: ReadonlySet<string>
): Promise<GrsImageResult | { status: "pending" }> {
  const status = extractStatus(payload);
  if (isFailureStatus(status)) {
    const detail = extractFailureDetail(payload);
    return {
      status: "failed",
      reason: detail ? `GrsAI image task failed: ${detail}` : "GrsAI image task failed."
    };
  }

  const imageUrl = extractImageUrl(payload);
  if (imageUrl) {
    return downloadImage(fetchImpl, imageUrl, signal, deadlineSignal, providerTaskId, allowedImageHosts);
  }

  if (isPendingStatus(status) || extractTaskId(payload)) {
    return { status: "pending" };
  }

  return { status: "failed", reason: "GrsAI response did not include a usable image URL." };
}

async function downloadImage(
  fetchImpl: typeof fetch,
  imageUrl: string,
  signal: AbortSignal | undefined,
  deadlineSignal: AbortSignal,
  providerTaskId: string | undefined,
  allowedImageHosts: ReadonlySet<string>
): Promise<GrsImageResult> {
  const result = await downloadSecureProviderImage(imageUrl, {
    fetchImpl,
    allowedHosts: allowedImageHosts,
    signal,
    deadlineSignal
  });
  return result.status === "ok" ? { ...result, providerTaskId } : result;
}

async function safeFetch(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  budget: ProviderRequestBudget
): Promise<{ status: "ok"; response: Response } | { status: "cancelled"; reason: string }> {
  try {
    return { status: "ok", response: await budget.race(fetchImpl(input, init)) };
  } catch (error) {
    if (isAbortError(error)) {
      return { status: "cancelled", reason: "GrsAI image request was cancelled." };
    }

    throw error;
  }
}

async function readJson(response: Response, budget: ProviderRequestBudget): Promise<unknown> {
  const text = await readBoundedResponseText(response, budget);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function readBoundedResponseText(
  response: Response,
  budget: ProviderRequestBudget,
  maxBytes = MAX_GRS_JSON_RESPONSE_BYTES
): Promise<string> {
  const declaredLength = readContentLength(response.headers.get("content-length"));
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    await cancelResponseBody(response);
    throw new GrsProviderResponseTooLargeError(maxBytes);
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await budget.race(reader.read());
      if (done) {
        return text + decoder.decode();
      }
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new GrsProviderResponseTooLargeError(maxBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The deadline or size boundary remains authoritative if cancellation races the body.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The connection may already be closed; the size check still fails closed.
  }
}

function readContentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function responseReadFailure(scope: "generate" | "result", error: unknown): GrsImageResult {
  if (error instanceof ProviderResponseBoundaryError) {
    throw error;
  }
  if (isAbortError(error)) {
    return { status: "cancelled", reason: "GrsAI image request was cancelled." };
  }
  if (error instanceof GrsProviderResponseTooLargeError) {
    return {
      status: "failed",
      reason: `GrsAI ${scope} response exceeded the ${Math.floor(error.maxBytes / 1024)} KiB limit.`
    };
  }
  return { status: "failed", reason: `GrsAI ${scope} response could not be read.` };
}

class GrsProviderResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super("GrsAI response exceeded the configured byte limit.");
    this.name = "GrsProviderResponseTooLargeError";
  }
}

function extractStatus(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const direct = typeof value.status === "string" ? value.status : undefined;
  if (direct) {
    return direct.toLowerCase();
  }

  if (isRecord(value.data) && typeof value.data.status === "string") {
    return value.data.status.toLowerCase();
  }

  return undefined;
}

function extractTaskId(value: unknown): string | undefined {
  return findProviderString(value, ["id", "taskId", "task_id"]);
}

function extractImageUrl(value: unknown): string | undefined {
  if (typeof value === "string" && isHttpUrl(value)) {
    return value;
  }

  return findProviderString(value, ["url", "imageUrl", "image_url", "outputUrl"], isHttpUrl);
}

function isPendingStatus(status: string | undefined): boolean {
  return !status || ["pending", "processing", "running", "waiting", "queued", "created"].includes(status);
}

function isFailureStatus(status: string | undefined): boolean {
  return Boolean(status && ["failed", "failure", "error", "cancelled", "canceled"].includes(status));
}

function extractFailureDetail(value: unknown): string | undefined {
  return findProviderString(
    value,
    ["message", "error", "msg", "reason"],
    (candidate) => candidate.trim().length > 0
  )?.trim();
}

function findProviderString(
  value: unknown,
  keys: readonly string[],
  accept: (candidate: string) => boolean = (candidate) => candidate.length > 0
): string | undefined {
  let match: string | undefined;
  visitProviderResponseRecords(value, (record) => {
    if (match) return;
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === "string" && accept(candidate)) {
        match = candidate;
        return;
      }
    }
  });
  return match;
}

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function uniqueBaseUrls(primary: string, fallbacks: readonly string[] | undefined): string[] {
  return [...new Set([primary, ...(fallbacks ?? [])].map((value) => value.replace(/\/$/, "")).filter(Boolean))];
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
