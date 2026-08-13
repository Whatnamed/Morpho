export const PROVIDER_BUFFERED_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
export const PROVIDER_DIAGNOSTIC_MAX_BYTES = 16 * 1024;
export const PROVIDER_SSE_TOTAL_MAX_BYTES = 32 * 1024 * 1024;
export const PROVIDER_SSE_PENDING_MAX_BYTES = 1024 * 1024;
export const PROVIDER_SSE_MAX_EVENT_COUNT = 32_768;
export const PROVIDER_RESPONSE_MAX_STRUCTURE_DEPTH = 64;
export const PROVIDER_RESPONSE_MAX_STRUCTURE_NODES = 65_536;
export const PROVIDER_OVERALL_DEADLINE_MS = 15 * 60 * 1000;
export const PROVIDER_DIAGNOSTIC_MAX_CHARS = 800;

export type ProviderResponseBoundaryCode =
  | "provider_deadline_exceeded"
  | "provider_response_too_large";

export class ProviderResponseBoundaryError extends Error {
  constructor(readonly code: ProviderResponseBoundaryCode) {
    super(
      code === "provider_deadline_exceeded"
        ? "Provider request exceeded its overall safety deadline."
        : "Provider response exceeded its transport safety limit."
    );
    this.name = "ProviderResponseBoundaryError";
  }
}

export type ProviderRequestBudget = {
  readonly signal: AbortSignal;
  /** Aborts only when this budget's internal deadline expires. */
  readonly deadlineSignal: AbortSignal;
  race<T>(operation: Promise<T>): Promise<T>;
  wait(delayMs: number): Promise<void>;
  throwIfUnavailable(): void;
  dispose(): void;
};

export function createProviderRequestBudget(
  externalSignal?: AbortSignal,
  deadlineMs = PROVIDER_OVERALL_DEADLINE_MS
): ProviderRequestBudget {
  const controller = new AbortController();
  const deadlineController = new AbortController();
  let abortKind: "external" | "deadline" | undefined;
  let deadlineError: ProviderResponseBoundaryError | undefined;
  let disposed = false;

  const abortFromExternal = () => {
    if (abortKind) return;
    abortKind = "external";
    controller.abort(externalAbortReason(externalSignal));
  };
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }

  const deadline = setTimeout(() => {
    if (abortKind) return;
    abortKind = "deadline";
    deadlineError = new ProviderResponseBoundaryError("provider_deadline_exceeded");
    deadlineController.abort(deadlineError);
    controller.abort(deadlineError);
  }, deadlineMs);

  const abortReason = (): unknown => {
    if (abortKind === "external") return externalAbortReason(externalSignal);
    if (abortKind === "deadline") return deadlineError ?? new ProviderResponseBoundaryError("provider_deadline_exceeded");
    return controller.signal.reason ?? createAbortError();
  };

  const throwIfUnavailable = () => {
    if (externalSignal?.aborted || controller.signal.aborted) throw abortReason();
  };

  return {
    signal: controller.signal,
    deadlineSignal: deadlineController.signal,
    race<T>(operation: Promise<T>): Promise<T> {
      try {
        throwIfUnavailable();
      } catch (error) {
        return Promise.reject(error);
      }
      return new Promise<T>((resolve, reject) => {
        const abort = () => {
          controller.signal.removeEventListener("abort", abort);
          reject(abortReason());
        };
        controller.signal.addEventListener("abort", abort, { once: true });
        operation.then(
          (value) => {
            controller.signal.removeEventListener("abort", abort);
            resolve(value);
          },
          (error) => {
            controller.signal.removeEventListener("abort", abort);
            reject(abortKind ? abortReason() : error);
          }
        );
      });
    },
    wait(delayMs: number): Promise<void> {
      try {
        throwIfUnavailable();
      } catch (error) {
        return Promise.reject(error);
      }
      return new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", abort);
          reject(abortReason());
        };
        const timer = setTimeout(() => {
          controller.signal.removeEventListener("abort", abort);
          resolve();
        }, delayMs);
        controller.signal.addEventListener("abort", abort, { once: true });
      });
    },
    throwIfUnavailable,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearTimeout(deadline);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  };
}

export async function readBoundedProviderJson(
  response: Response,
  budget: ProviderRequestBudget,
  maxBytes = PROVIDER_BUFFERED_RESPONSE_MAX_BYTES
): Promise<unknown> {
  const bytes = await readBoundedProviderBody(response, budget, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function readBoundedProviderDiagnostic(
  response: Response,
  budget: ProviderRequestBudget,
  maxBytes = PROVIDER_DIAGNOSTIC_MAX_BYTES
): Promise<string | undefined> {
  const contentLength = responseContentLength(response);
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = contentLength !== undefined && contentLength > maxBytes;
  try {
    while (totalBytes < maxBytes) {
      const next = await budget.race(reader.read());
      if (next.done) break;
      if (!next.value) continue;
      const remaining = maxBytes - totalBytes;
      const chunk = next.value.byteLength > remaining ? next.value.slice(0, remaining) : next.value;
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
      if (next.value.byteLength > remaining) {
        truncated = true;
        break;
      }
    }
    if (totalBytes === maxBytes) truncated = true;
    if (truncated) cancelReader(reader);
  } catch (error) {
    cancelReader(reader);
    throw error;
  } finally {
    releaseReader(reader);
  }
  const diagnostic = new TextDecoder().decode(joinChunks(chunks, totalBytes)).trim();
  return diagnostic.slice(0, PROVIDER_DIAGNOSTIC_MAX_CHARS) || undefined;
}

export async function assertProviderContentLengthWithinLimit(
  response: Response,
  maxBytes: number
): Promise<void> {
  const contentLength = responseContentLength(response);
  if (contentLength === undefined || contentLength <= maxBytes) return;
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // The boundary failure remains authoritative even if cancellation races the transport.
  }
  throw new ProviderResponseBoundaryError("provider_response_too_large");
}

async function readBoundedProviderBody(
  response: Response,
  budget: ProviderRequestBudget,
  maxBytes: number
): Promise<Uint8Array> {
  await assertProviderContentLengthWithinLimit(response, maxBytes);
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await budget.race(reader.read());
      if (next.done) return joinChunks(chunks, totalBytes);
      if (!next.value) continue;
      totalBytes += next.value.byteLength;
      if (totalBytes > maxBytes) {
        cancelReader(reader);
        throw new ProviderResponseBoundaryError("provider_response_too_large");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    cancelReader(reader);
    throw error;
  } finally {
    releaseReader(reader);
  }
}

function responseContentLength(response: Response): number | undefined {
  const raw = response.headers.get("Content-Length");
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function joinChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best-effort after the boundary has already failed closed.
  }
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // A timed-out pending read may release only after cancellation reaches the transport.
  }
}

function externalAbortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason instanceof Error ? signal.reason : createAbortError();
}

function createAbortError(): DOMException {
  return new DOMException("The provider request was aborted.", "AbortError");
}
