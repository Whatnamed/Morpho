import { NextResponse } from "next/server";

export type BoundedJsonBodyResult =
  | { status: "ok"; value: unknown }
  | { status: "failed"; response: NextResponse };

export type BoundedJsonBodyOptions = Readonly<{
  maxBytes: number;
  tooLargeError: string;
}>;

export async function readBoundedJsonBody(
  request: Request,
  options: BoundedJsonBodyOptions
): Promise<BoundedJsonBodyResult> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
    throw new Error("Bounded JSON maxBytes must be a positive safe integer.");
  }

  const contentLength = parseContentLength(request.headers.get("content-length"));
  if (contentLength !== undefined && contentLength > options.maxBytes) {
    await cancelBody(request.body);
    return tooLarge(options.tooLargeError);
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    if (reader) {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        totalBytes += next.value.byteLength;
        if (totalBytes > options.maxBytes) {
          await cancelReader(reader);
          return tooLarge(options.tooLargeError);
        }
        chunks.push(next.value);
      }
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { status: "ok", value: JSON.parse(raw) as unknown };
  } catch {
    return {
      status: "failed",
      response: NextResponse.json(
        { error: "请求不是有效 JSON。", code: "invalid_json" },
        { status: 400 }
      )
    };
  } finally {
    reader?.releaseLock();
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;
  try {
    await body.cancel("request_body_too_large");
  } catch {
    // The response still fails closed if an implementation cannot cancel.
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel("request_body_too_large");
  } catch {
    // The response still fails closed if an implementation cannot cancel.
  }
}

function tooLarge(error: string): BoundedJsonBodyResult {
  return {
    status: "failed",
    response: NextResponse.json({ error, code: "body_too_large" }, { status: 413 })
  };
}
