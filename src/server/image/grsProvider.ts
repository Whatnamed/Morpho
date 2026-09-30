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
      failureCode?: "external_execution_state_unknown";
    }
  | {
      status: "cancelled";
      reason: string;
    };

export type ResolveGrsImageOptions = {
  fetchImpl?: typeof fetch;
  maxPolls?: number;
  pollDelayMs?: number;
  overallDeadlineMs?: number;
  signal?: AbortSignal;
};

const DEFAULT_MAX_POLLS = 12;
const DEFAULT_POLL_DELAY_MS = 1500;
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
  const observation = { submitted: false, resultKnown: false };
  try {
    return await resolveGrsImageResultWithBudget(config, input, options, budget, observation);
  } catch (error) {
    if (options.signal?.aborted) {
      return { status: "cancelled", reason: "GrsAI image request was cancelled." };
    }
    if (error instanceof ProviderResponseBoundaryError && error.code === "provider_deadline_exceeded") {
      return failedObservation("GrsAI image request exceeded its overall safety deadline.", observation);
    }
    return failedObservation("GrsAI image request failed.", observation);
  } finally {
    budget.dispose();
  }
}

async function resolveGrsImageResultWithBudget(
  config: GrsImageConfig,
  input: GrsGenerateInput,
  options: ResolveGrsImageOptions,
  budget: ProviderRequestBudget,
  observation: { submitted: boolean; resultKnown: boolean }
): Promise<GrsImageResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
  const pollDelayMs = options.pollDelayMs ?? DEFAULT_POLL_DELAY_MS;
  const signal = options.signal;
  const request = createGrsGenerateRequest(config, input);
  budget.throwIfUnavailable();
  observation.submitted = true;
  const generateResponse = await safeFetch(fetchImpl, request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: budget.signal
  }, budget);
  if (generateResponse.status === "cancelled") return generateResponse;

  if (!generateResponse.response.ok) {
    observation.resultKnown = ![408, 429].includes(generateResponse.response.status) && generateResponse.response.status < 500;
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
      return responseReadFailure("generate", error, !observation.resultKnown, signal);
    }
    const reason = detail
      ? `GrsAI generate returned ${generateResponse.response.status}: ${detail}`
      : `GrsAI generate returned ${generateResponse.response.status}.`;
    return {
      status: "failed",
      reason,
      ...(!observation.resultKnown ? { failureCode: "external_execution_state_unknown" as const } : {})
    };
  }

  let generatePayload: unknown;
  try {
    generatePayload = await readJson(generateResponse.response, budget);
  } catch (error) {
    return responseReadFailure("generate", error, true, signal);
  }
  observation.resultKnown = Boolean(extractImageUrl(generatePayload)) || isFailureStatus(extractStatus(generatePayload));
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
    return failedObservation("GrsAI did not return an image URL or task id.", observation);
  }

  const resultUrl = `${config.baseUrl.replace(/\/$/, "")}/v1/api/result?id=${encodeURIComponent(taskId)}`;
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
      return failedObservation(`GrsAI result returned ${resultResponse.response.status}.`, observation);
    }

    let resultPayload: unknown;
    try {
      resultPayload = await readJson(resultResponse.response, budget);
    } catch (error) {
      return responseReadFailure("result", error, true, signal);
    }
    observation.resultKnown = Boolean(extractImageUrl(resultPayload)) || isFailureStatus(extractStatus(resultPayload));
    budget.throwIfUnavailable();
    const resolved = await resolvePayload(fetchImpl, resultPayload, signal, budget.deadlineSignal, taskId, allowedImageHosts);
    if (resolved.status !== "pending") {
      return resolved;
    }

    if (attempt < maxPolls - 1) {
      await budget.wait(pollDelayMs);
    }
  }

  return failedObservation("GrsAI image task did not finish before the polling limit.", observation);
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

  return { status: "failed", reason: "GrsAI response did not include a usable image URL.", failureCode: "external_execution_state_unknown" };
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
    if (isAbortError(error) && budget.signal.aborted) {
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

function responseReadFailure(
  scope: "generate" | "result",
  error: unknown,
  executionUnknown: boolean,
  signal: AbortSignal | undefined
): GrsImageResult {
  if (error instanceof ProviderResponseBoundaryError) {
    throw error;
  }
  if (isAbortError(error) && signal?.aborted) {
    return { status: "cancelled", reason: "GrsAI image request was cancelled." };
  }
  if (error instanceof GrsProviderResponseTooLargeError) {
    return {
      status: "failed",
      ...(executionUnknown ? { failureCode: "external_execution_state_unknown" as const } : {}),
      reason: `GrsAI ${scope} response exceeded the ${Math.floor(error.maxBytes / 1024)} KiB limit.`
    };
  }
  return {
    status: "failed",
    reason: `GrsAI ${scope} response could not be read.`,
    ...(executionUnknown ? { failureCode: "external_execution_state_unknown" as const } : {})
  };
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

function failedObservation(
  reason: string,
  observation: { submitted: boolean; resultKnown: boolean }
): GrsImageResult {
  return {
    status: "failed",
    reason,
    ...(observation.submitted && !observation.resultKnown
      ? { failureCode: "external_execution_state_unknown" as const } : {})
  };
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
