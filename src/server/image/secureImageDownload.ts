export type SecureImageDownloadOptions = Readonly<{
  fetchImpl: typeof fetch;
  allowedHosts: ReadonlySet<string>;
  signal?: AbortSignal;
  /** Internal workflow deadline; kept distinct from caller cancellation. */
  deadlineSignal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}>;

export type SecureImageDownloadResult =
  | { status: "ok"; blob: Blob; mimeType: string }
  | { status: "failed"; reason: string }
  | { status: "cancelled"; reason: string };

export const MAX_REMOTE_IMAGE_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 3;
const SAFE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif"
]);

export async function downloadSecureProviderImage(
  imageUrl: string,
  options: SecureImageDownloadOptions
): Promise<SecureImageDownloadResult> {
  const controller = new AbortController();
  let abortKind: "parent" | "deadline" | "timeout" | undefined;
  let timedOut = false;
  const abortFromParent = () => {
    if (abortKind) return;
    abortKind = "parent";
    controller.abort(options.signal?.reason ?? createAbortError());
  };
  const abortFromDeadline = () => {
    if (abortKind) return;
    abortKind = "deadline";
    controller.abort(options.deadlineSignal?.reason ?? createAbortError());
  };
  if (options.signal?.aborted) {
    abortFromParent();
  } else {
    options.signal?.addEventListener("abort", abortFromParent, { once: true });
  }
  if (!controller.signal.aborted) {
    if (options.deadlineSignal?.aborted) {
      abortFromDeadline();
    } else {
      options.deadlineSignal?.addEventListener("abort", abortFromDeadline, { once: true });
    }
  }
  const timeout = setTimeout(() => {
    if (abortKind) return;
    abortKind = "timeout";
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    let current = parseTrustedImageUrl(imageUrl, options.allowedHosts);
    if (!current) return failed("Provider 返回的图片 URL 不在允许的 HTTPS 主机范围内。");

    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await raceWithSignal(options.fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: { Accept: "image/png,image/jpeg,image/webp,image/gif,image/avif" },
        signal: controller.signal
      }), controller.signal);

      if (isRedirect(response.status)) {
        void response.body?.cancel().catch(() => undefined);
        if (redirectCount >= maxRedirects) return failed("Generated image URL 重定向次数超过上限。");
        const location = response.headers.get("location");
        if (!location) return failed("Generated image URL 返回了无目标重定向。");
        current = parseTrustedImageUrl(new URL(location, current).toString(), options.allowedHosts);
        if (!current) return failed("Generated image URL 重定向到了不允许的主机。");
        continue;
      }

      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        return failed(`Generated image URL returned ${response.status}.`);
      }

      const mimeType = normalizeImageMimeType(response.headers.get("content-type"));
      if (!mimeType || !SAFE_IMAGE_MIME_TYPES.has(mimeType)) {
        void response.body?.cancel().catch(() => undefined);
        return failed("Generated image URL 未返回受支持的图片类型。");
      }
      const maximumBytes = options.maxBytes ?? MAX_REMOTE_IMAGE_BYTES;
      const declaredLength = readContentLength(response.headers.get("content-length"));
      if (declaredLength !== undefined && declaredLength > maximumBytes) {
        void response.body?.cancel().catch(() => undefined);
        return failed("Generated image download 超过允许大小。");
      }
      if (!response.body) return failed("Generated image download 没有响应体。");

      const bytes = await readBoundedBody(response.body, maximumBytes, (operation) => raceWithSignal(operation, controller.signal));
      if (bytes.byteLength === 0) return failed("Generated image download was empty.");
      const blobBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(blobBuffer).set(bytes);
      return {
        status: "ok",
        blob: new Blob([blobBuffer], { type: mimeType }),
        mimeType
      };
    }
  } catch (error) {
    if (abortKind === "parent") {
      return { status: "cancelled", reason: "GrsAI image request was cancelled." };
    }
    if (abortKind === "deadline") {
      throw options.deadlineSignal?.reason ?? createAbortError();
    }
    if (timedOut || abortKind === "timeout") return failed("Generated image download timed out.");
    if (error instanceof ImageBodyTooLargeError) {
      return failed("Generated image download 超过允许大小。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromParent);
    options.deadlineSignal?.removeEventListener("abort", abortFromDeadline);
  }
}

export function buildAllowedImageHosts(input: {
  baseUrl: string;
  fallbackBaseUrls?: readonly string[];
  imageHostAllowlist?: readonly string[];
}): Set<string> {
  const hosts = new Set<string>();
  for (const value of [input.baseUrl, ...(input.fallbackBaseUrls ?? [])]) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:") hosts.add(normalizeHostname(parsed.hostname));
    } catch {
      // The provider request path reports malformed base URLs separately.
    }
  }
  for (const value of input.imageHostAllowlist ?? []) {
    const normalized = normalizeHostname(value);
    if (normalized) hosts.add(normalized);
  }
  return hosts;
}

function parseTrustedImageUrl(value: string, allowedHosts: ReadonlySet<string>): URL | undefined {
  try {
    const parsed = new URL(value);
    const hostname = normalizeHostname(parsed.hostname);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== "443") ||
      isForbiddenHostname(hostname) ||
      !allowedHosts.has(hostname)
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

async function readBoundedBody(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
  read: <T>(operation: Promise<T>) => Promise<T>
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await read(reader.read());
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        void reader.cancel("image body too large").catch(() => undefined);
        throw new ImageBodyTooLargeError();
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      void reader.cancel(error).catch(() => undefined);
    } catch {
      // The abort or size boundary remains authoritative if stream cancellation races it.
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A raced pending read may still own the stream lock.
    }
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function raceWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? createAbortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

function normalizeImageMimeType(value: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function readContentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, "");
}

function isForbiddenHostname(hostname: string): boolean {
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return true;
  }
  const unwrapped = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (unwrapped.includes(":")) return true;
  return /^\d+(?:\.\d+){3}$/.test(unwrapped);
}

function failed(reason: string): Extract<SecureImageDownloadResult, { status: "failed" }> {
  return { status: "failed", reason };
}

class ImageBodyTooLargeError extends Error {}

function createAbortError(): DOMException {
  return new DOMException("The image request was aborted.", "AbortError");
}
