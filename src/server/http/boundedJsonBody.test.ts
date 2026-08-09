import { describe, expect, it, vi } from "vitest";

import { readBoundedJsonBody } from "./boundedJsonBody";

describe("bounded JSON request reader", () => {
  it("accepts a chunked body while treating Content-Length only as an early hint", async () => {
    const request = streamedRequest(["{\"value\":", "42}"], { "Content-Length": "1" });

    await expect(readBoundedJsonBody(request, options(32))).resolves.toEqual({
      status: "ok",
      value: { value: 42 }
    });
  });

  it("cancels as soon as streamed bytes cross the hard limit", async () => {
    const cancel = vi.fn();
    const request = streamedRequest(["1234", "5678", "must-not-be-read"], {}, cancel);

    const result = await readBoundedJsonBody(request, options(5));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.response.status).toBe(413);
      await expect(result.response.json()).resolves.toMatchObject({ code: "body_too_large" });
    }
    expect(cancel).toHaveBeenCalledWith("request_body_too_large");
  });

  it("rejects a declared oversized body without pulling it", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull, cancel });
    const request = requestLike(body, { "Content-Length": "100" });

    const result = await readBoundedJsonBody(request, options(10));

    expect(result.status).toBe("failed");
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith("request_body_too_large");
  });

  it("rejects malformed JSON inside the byte budget", async () => {
    const result = await readBoundedJsonBody(streamedRequest(["{broken"]), options(32));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toMatchObject({ code: "invalid_json" });
    }
  });
});

function options(maxBytes: number) {
  return { maxBytes, tooLargeError: "too large" };
}

function streamedRequest(
  chunks: string[],
  headers: Record<string, string> = {},
  cancel = vi.fn()
): Request {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(chunk));
      }
    },
    cancel
  });
  return requestLike(body, headers);
}

function requestLike(body: ReadableStream<Uint8Array>, headers: Record<string, string>): Request {
  return { body, headers: new Headers(headers) } as Request;
}
