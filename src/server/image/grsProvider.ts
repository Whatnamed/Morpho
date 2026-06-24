import { getGrsRequestProfile } from "./profile";

export type GrsImageConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type GrsGenerateInput = {
  prompt: string;
  images: string[];
  aspectRatio: string;
  imageSize: string;
  replyType: string;
};

export type GrsGenerateRequest = {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    prompt: string;
    images: string[];
    aspectRatio: string;
    imageSize: string;
    replyType: string;
  };
};

export type GrsImageResult =
  | {
      status: "ok";
      blob: Blob;
      mimeType: string;
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
  signal?: AbortSignal;
};

const DEFAULT_MAX_POLLS = 12;
const DEFAULT_POLL_DELAY_MS = 1500;

export function createGrsGenerateRequest(config: GrsImageConfig, input: GrsGenerateInput): GrsGenerateRequest {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const profile = getGrsRequestProfile(config.model);

  return {
    url: `${baseUrl}/v1/api/generate`,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: {
      model: config.model,
      prompt: input.prompt,
      images: input.images,
      aspectRatio: input.aspectRatio,
      imageSize: profile.imageSize,
      replyType: profile.replyType
    }
  };
}

export async function resolveGrsImageResult(
  config: GrsImageConfig,
  input: GrsGenerateInput,
  options: ResolveGrsImageOptions = {}
): Promise<GrsImageResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
  const pollDelayMs = options.pollDelayMs ?? DEFAULT_POLL_DELAY_MS;
  const signal = options.signal;
  const request = createGrsGenerateRequest(config, input);

  const generateResponse = await safeFetch(fetchImpl, request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal
  });

  if (generateResponse.status === "cancelled") {
    return generateResponse;
  }

  if (!generateResponse.response.ok) {
    return { status: "failed", reason: `GrsAI generate returned ${generateResponse.response.status}.` };
  }

  const generatePayload = await readJson(generateResponse.response);
  const immediate = await resolvePayload(fetchImpl, generatePayload, signal);
  if (immediate.status !== "pending") {
    return immediate;
  }

  const taskId = extractTaskId(generatePayload);
  if (!taskId) {
    return { status: "failed", reason: "GrsAI did not return an image URL or task id." };
  }

  const resultUrl = `${config.baseUrl.replace(/\/$/, "")}/v1/api/result?id=${encodeURIComponent(taskId)}`;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    if (signal?.aborted) {
      return { status: "cancelled", reason: "GrsAI image request was cancelled." };
    }

    const resultResponse = await safeFetch(fetchImpl, resultUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal
    });

    if (resultResponse.status === "cancelled") {
      return resultResponse;
    }

    if (!resultResponse.response.ok) {
      return { status: "failed", reason: `GrsAI result returned ${resultResponse.response.status}.` };
    }

    const resultPayload = await readJson(resultResponse.response);
    const resolved = await resolvePayload(fetchImpl, resultPayload, signal);
    if (resolved.status !== "pending") {
      return resolved;
    }

    if (attempt < maxPolls - 1) {
      await delay(pollDelayMs, signal);
    }
  }

  return { status: "failed", reason: "GrsAI image task did not finish before the polling limit." };
}

async function resolvePayload(
  fetchImpl: typeof fetch,
  payload: unknown,
  signal: AbortSignal | undefined
): Promise<GrsImageResult | { status: "pending" }> {
  const status = extractStatus(payload);
  if (isFailureStatus(status)) {
    return { status: "failed", reason: "GrsAI image task failed." };
  }

  const imageUrl = extractImageUrl(payload);
  if (imageUrl) {
    return downloadImage(fetchImpl, imageUrl, signal);
  }

  if (isPendingStatus(status) || extractTaskId(payload)) {
    return { status: "pending" };
  }

  return { status: "failed", reason: "GrsAI response did not include a usable image URL." };
}

async function downloadImage(
  fetchImpl: typeof fetch,
  imageUrl: string,
  signal: AbortSignal | undefined
): Promise<GrsImageResult> {
  const response = await safeFetch(fetchImpl, imageUrl, { method: "GET", signal });

  if (response.status === "cancelled") {
    return response;
  }

  if (!response.response.ok) {
    return { status: "failed", reason: `Generated image URL returned ${response.response.status}.` };
  }

  const blob = await response.response.blob();
  if (blob.size === 0) {
    return { status: "failed", reason: "Generated image download was empty." };
  }

  return {
    status: "ok",
    blob,
    mimeType: response.response.headers.get("Content-Type") ?? (blob.type || "image/png")
  };
}

async function safeFetch(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit
): Promise<{ status: "ok"; response: Response } | { status: "cancelled"; reason: string }> {
  try {
    return { status: "ok", response: await fetchImpl(input, init) };
  } catch (error) {
    if (isAbortError(error)) {
      return { status: "cancelled", reason: "GrsAI image request was cancelled." };
    }

    throw error;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
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
  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of ["id", "taskId", "task_id"]) {
    const item = value[key];
    if (typeof item === "string" && item) {
      return item;
    }
  }

  if (isRecord(value.data)) {
    return extractTaskId(value.data);
  }

  return undefined;
}

function extractImageUrl(value: unknown): string | undefined {
  if (typeof value === "string" && isHttpUrl(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of ["url", "imageUrl", "image_url", "outputUrl"]) {
    const item = value[key];
    if (typeof item === "string" && isHttpUrl(item)) {
      return item;
    }
  }

  for (const key of ["result", "output", "data"]) {
    const nested = extractImageUrl(value[key]);
    if (nested) {
      return nested;
    }
  }

  for (const key of ["images", "results"]) {
    const item = value[key];
    if (Array.isArray(item)) {
      for (const entry of item) {
        const nested = extractImageUrl(entry);
        if (nested) {
          return nested;
        }
      }
    }
  }

  return undefined;
}

function isPendingStatus(status: string | undefined): boolean {
  return !status || ["pending", "processing", "running", "waiting", "queued", "created"].includes(status);
}

function isFailureStatus(status: string | undefined): boolean {
  return Boolean(status && ["failed", "failure", "error", "cancelled", "canceled"].includes(status));
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
