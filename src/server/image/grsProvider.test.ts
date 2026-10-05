import { afterEach, describe, expect, it, vi } from "vitest";

import { createGrsGenerateRequest, resolveGrsImageResult } from "./grsProvider";

describe("GrsAI image provider adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("sends nano-banana-2-lite with the lightweight nano-banana request shape", () => {
    const request = createGrsGenerateRequest(
      {
        apiKey: "secret-grs-key",
        baseUrl: "https://grs.example",
        model: "nano-banana-2-lite"
      },
      {
        modelId: "nano-banana-2-lite",
        prompt: "industrial design buoy",
        images: [],
        aspectRatio: "16:9",
        referenceObjectIds: []
      }
    );

    expect(request.body).toEqual({
      model: "nano-banana-2-lite",
      prompt: "industrial design buoy",
      images: [],
      aspectRatio: "16:9",
      replyType: "json"
    });
  });

  it("keeps the API key in headers and sends a client-selected model without secrets in the body", () => {
    const request = createGrsGenerateRequest(
      {
        apiKey: "secret-grs-key",
        baseUrl: "https://grs.example",
        model: "nano-banana-fast"
      },
      {
        modelId: "nano-banana-fast",
        prompt: "生成低施工夜间扶手方案",
        images: ["data:image/png;base64,aaa"],
        aspectRatio: "4:3",
        referenceObjectIds: []
      }
    );

    expect(request.url).toBe("https://grs.example/v1/api/generate");
    expect(request.headers.Authorization).toBe("Bearer secret-grs-key");
    expect(request.body).toMatchObject({
      model: "nano-banana-fast",
      prompt: "生成低施工夜间扶手方案",
      images: ["data:image/png;base64,aaa"],
      aspectRatio: "4:3",
      replyType: "json"
    });
    expect(request.body).not.toHaveProperty("imageSize");
    expect(JSON.stringify(request.body)).not.toContain("secret-grs-key");
  });

  it("sends nano-banana-2 with imageSize 1K and json reply type", () => {
    const request = createGrsGenerateRequest(
      {
        apiKey: "secret-grs-key",
        baseUrl: "https://grs.example",
        model: "nano-banana-fast"
      },
      {
        modelId: "nano-banana-2",
        prompt: "生成低施工夜间扶手方案",
        images: [],
        aspectRatio: "4:3",
        referenceObjectIds: []
      }
    );

    expect(request.body).toMatchObject({
      model: "nano-banana-2",
      aspectRatio: "4:3",
      imageSize: "1K",
      replyType: "json"
    });
  });

  it("keeps gpt-image-2 on the documented pixel aspect-ratio profile without imageSize", () => {
    const request = createGrsGenerateRequest(
      {
        apiKey: "secret-grs-key",
        baseUrl: "https://grs.example",
        model: "nano-banana-fast"
      },
      {
        modelId: "gpt-image-2",
        prompt: "生成方图",
        images: [],
        aspectRatio: "1:1",
        sizeOption: "1K",
        referenceObjectIds: []
      }
    );

    expect(request.body).toMatchObject({
      model: "gpt-image-2",
      aspectRatio: "1024x1024",
      replyType: "json"
    });
    expect(request.body).not.toHaveProperty("imageSize");
  });

  it("downloads a successful result URL from the GrsAI result list", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/generate")) {
        return jsonResponse({ status: "succeeded", results: [{ url: "https://cdn.example/result.png" }] });
      }

      return new Response(new Blob(["png"], { type: "image/png" }), {
        status: 200,
        headers: { "Content-Type": "image/png" }
      });
    };

    const result = await resolveGrsImageResult(
      {
        apiKey: "key",
        baseUrl: "https://grs.example",
        imageHostAllowlist: ["cdn.example"],
        model: "nano-banana-fast"
      },
      {
        modelId: "nano-banana-fast",
        prompt: "test",
        images: [],
        aspectRatio: "4:3",
        referenceObjectIds: []
      },
      { fetchImpl, maxPolls: 1, pollDelayMs: 0 }
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.mimeType).toBe("image/png");
      expect(result.blob.size).toBeGreaterThan(0);
    }
  });

  it("polls async task results with a maximum attempt limit", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1;
      const url = String(input);
      if (url.includes("/generate")) {
        return jsonResponse({ id: "task-a", status: "pending" });
      }

      return jsonResponse({ id: "task-a", status: "processing" });
    };

    const result = await resolveGrsImageResult(
      {
        apiKey: "key",
        baseUrl: "https://grs.example",
        imageHostAllowlist: ["cdn.example"],
        model: "nano-banana-fast"
      },
      {
        modelId: "nano-banana-fast",
        prompt: "test",
        images: [],
        aspectRatio: "4:3",
        referenceObjectIds: []
      },
      { fetchImpl, maxPolls: 2, pollDelayMs: 0 }
    );

    expect(result).toMatchObject({ status: "failed", failureCode: "external_execution_state_unknown" });
    expect(calls).toBe(3);
  });

  it("does not report success when the final remote image URL cannot be downloaded", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/generate")) {
        return jsonResponse({ status: "succeeded", url: "https://cdn.example/result.png" });
      }

      return new Response("missing", { status: 404 });
    };

    const result = await resolveGrsImageResult(
      {
        apiKey: "key",
        baseUrl: "https://grs.example",
        model: "nano-banana-fast"
      },
      {
        modelId: "nano-banana-fast",
        prompt: "test",
        images: [],
        aspectRatio: "4:3",
        referenceObjectIds: []
      },
      { fetchImpl, maxPolls: 1, pollDelayMs: 0 }
    );

    expect(result.status).toBe("failed");
  });

  it("does not repeat a generate POST after a network failure", async () => {
    let generateCalls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/generate")) {
        generateCalls += 1;
        if (generateCalls === 1) {
          throw new TypeError("fetch failed");
        }
        return jsonResponse({ status: "succeeded", url: "https://cdn.example/retry.png" });
      }

      return new Response(new Blob(["png"], { type: "image/png" }), {
        status: 200,
        headers: { "Content-Type": "image/png" }
      });
    };

    const result = await resolveGrsImageResult(
      {
        apiKey: "key",
        baseUrl: "https://grs-primary.example",
        fallbackBaseUrls: ["https://grs-fallback.example"],
        imageHostAllowlist: ["cdn.example"],
        model: "nano-banana-2-lite"
      },
      {
        modelId: "nano-banana-2-lite",
        prompt: "test retry",
        images: [],
        aspectRatio: "1:1",
        referenceObjectIds: []
      },
      { fetchImpl, maxPolls: 1, pollDelayMs: 0 }
    );

    expect(result).toMatchObject({ status: "failed", failureCode: "external_execution_state_unknown" });
    expect(generateCalls).toBe(1);
  });

  it("does not use the configured fallback host after primary response loss", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === "https://grs-primary.example/v1/api/generate") {
        throw new TypeError("primary connection failed");
      }
      if (url === "https://grs-fallback.example/v1/api/generate") {
        return jsonResponse({ status: "succeeded", url: "https://cdn.example/fallback.png" });
      }
      return new Response(new Blob(["png"], { type: "image/png" }), {
        status: 200,
        headers: { "Content-Type": "image/png" }
      });
    };

    const result = await resolveGrsImageResult(
      {
        apiKey: "key",
        baseUrl: "https://grs-primary.example",
        fallbackBaseUrls: ["https://grs-fallback.example"],
        imageHostAllowlist: ["cdn.example"],
        model: "nano-banana-2-lite"
      },
      {
        modelId: "nano-banana-2-lite",
        prompt: "fallback host test",
        images: [],
        aspectRatio: "1:1",
        referenceObjectIds: []
      },
      { fetchImpl, maxPolls: 1, pollDelayMs: 0 }
    );

    expect(result).toMatchObject({ status: "failed", failureCode: "external_execution_state_unknown" });
    expect(requestedUrls).toEqual(["https://grs-primary.example/v1/api/generate"]);
  });

  it("returns provider failure detail instead of a generic task failure", async () => {
    const result = await resolveGrsImageResult(
      {
        apiKey: "key",
        baseUrl: "https://grs.example",
        model: "nano-banana-2-lite"
      },
      {
        modelId: "nano-banana-2-lite",
        prompt: "test failure detail",
        images: [],
        aspectRatio: "1:1",
        referenceObjectIds: []
      },
      {
        fetchImpl: async () =>
          jsonResponse({
            status: "failed",
            message: "temporary upstream capacity limit"
          }),
        maxPolls: 1,
        pollDelayMs: 0
      }
    );

    expect(result).toEqual({
      status: "failed",
      reason: "GrsAI image task failed: temporary upstream capacity limit"
    });
  });

  it("rejects a provider-returned private image URL without requesting it", async () => {
    const requestedUrls: string[] = [];
    const result = await resolveGrsImageResult(
      {
        apiKey: "key",
        baseUrl: "https://grs.example",
        imageHostAllowlist: ["127.0.0.1"],
        model: "nano-banana-fast"
      },
      {
        modelId: "nano-banana-fast",
        prompt: "test",
        images: [],
        aspectRatio: "1:1",
        referenceObjectIds: []
      },
      {
        fetchImpl: async (input) => {
          requestedUrls.push(String(input));
          return jsonResponse({ status: "succeeded", url: "https://127.0.0.1/internal.png" });
        },
        maxPolls: 1,
        pollDelayMs: 0
      }
    );

    expect(result.status).toBe("failed");
    expect(requestedUrls).toEqual(["https://grs.example/v1/api/generate"]);
  });

  it("bounds a successful generate JSON response before parsing it", async () => {
    const oversized = oversizedStreamingResponse();
    let calls = 0;
    const result = await resolveGrsImageResult(
      {
        apiKey: "key",
        baseUrl: "https://grs.example",
        imageHostAllowlist: ["cdn.example"],
        model: "nano-banana-fast"
      },
      {
        modelId: "nano-banana-fast",
        prompt: "test oversized generate response",
        images: [],
        aspectRatio: "1:1",
        referenceObjectIds: []
      },
      {
        fetchImpl: async () => {
          calls += 1;
          return oversized.response;
        },

        maxPolls: 1,
        pollDelayMs: 0
      }
    );

    expect(result).toEqual({
      status: "failed",
      reason: "GrsAI generate response exceeded the 256 KiB limit.",
      failureCode: "external_execution_state_unknown"
    });
    expect(oversized.wasCancelled()).toBe(true);
    expect(calls).toBe(1);
  });

  it("bounds a polling result JSON response before parsing it", async () => {
    const oversized = oversizedStreamingResponse();
    let calls = 0;
    const result = await resolveGrsImageResult(
      {
        apiKey: "key",
        baseUrl: "https://grs.example",
        imageHostAllowlist: ["cdn.example"],
        model: "nano-banana-fast"
      },
      {
        modelId: "nano-banana-fast",
        prompt: "test oversized result response",
        images: [],
        aspectRatio: "1:1",
        referenceObjectIds: []
      },
      {
        fetchImpl: async () => {
          calls += 1;
          return calls === 1
            ? jsonResponse({ id: "task-oversized", status: "pending" })
            : oversized.response;
        },

        maxPolls: 1,
        pollDelayMs: 0
      }
    );

    expect(result).toEqual({
      status: "failed",
      reason: "GrsAI result response exceeded the 256 KiB limit.",
      failureCode: "external_execution_state_unknown"
    });
    expect(oversized.wasCancelled()).toBe(true);
    expect(calls).toBe(2);
  });

  it("bounds an error response instead of buffering or reflecting its full body", async () => {
    const oversized = oversizedStreamingResponse(400);
    const result = await resolveGrsImageResult(
      {
        apiKey: "key",
        baseUrl: "https://grs.example",
        model: "nano-banana-fast"
      },
      {
        modelId: "nano-banana-fast",
        prompt: "test oversized error response",
        images: [],
        aspectRatio: "1:1",
        referenceObjectIds: []
      },
      {
        fetchImpl: async () => oversized.response,

        maxPolls: 1,
        pollDelayMs: 0
      }
    );

    expect(result).toEqual({
      status: "failed",
      reason: "GrsAI generate response exceeded the 256 KiB limit."
    });
    expect(oversized.wasCancelled()).toBe(true);
  });

  it("fails closed on deeply nested provider JSON instead of recursing through it", async () => {
    let nested: unknown = { status: "pending" };
    for (let index = 0; index < 80; index += 1) {
      nested = { data: nested };
    }

    await expect(
      resolveGrsImageResult(grsConfig(), grsInput(), {
        fetchImpl: async () => jsonResponse(nested),

        maxPolls: 1,
        pollDelayMs: 0
      })
    ).resolves.toEqual({ status: "failed", reason: "GrsAI image request failed.", failureCode: "external_execution_state_unknown" });
  });

  it("fails an internally timed-out generate fetch without reporting user cancellation", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const resultPromise = resolveGrsImageResult(grsConfig(), grsInput(), {
      fetchImpl,

      overallDeadlineMs: 25
    });

    await vi.advanceTimersByTimeAsync(25);

    await expect(resultPromise).resolves.toEqual({
      status: "failed",
      failureCode: "external_execution_state_unknown",
      reason: "GrsAI image request exceeded its overall safety deadline."
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("applies the same deadline while reading generate and result JSON bodies", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({})));
    const resultPromise = resolveGrsImageResult(grsConfig(), grsInput(), {
      fetchImpl,

      overallDeadlineMs: 25
    });

    await vi.advanceTimersByTimeAsync(25);

    await expect(resultPromise).resolves.toEqual({
      status: "failed",
      failureCode: "external_execution_state_unknown",
      reason: "GrsAI image request exceeded its overall safety deadline."
    });
  });

  it("applies the same deadline while reading a polling result body", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ id: "task-hanging-result", status: "pending" })
        : new Response(new ReadableStream<Uint8Array>({}));
    });
    const resultPromise = resolveGrsImageResult(grsConfig(), grsInput(), {
      fetchImpl,

      maxPolls: 1,
      pollDelayMs: 0,
      overallDeadlineMs: 25
    });

    await vi.advanceTimersByTimeAsync(25);

    await expect(resultPromise).resolves.toEqual({
      status: "failed",
      failureCode: "external_execution_state_unknown",
      reason: "GrsAI image request exceeded its overall safety deadline."
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("applies the same deadline to the final image download", async () => {
    vi.useFakeTimers();
    let imageSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      if (String(input).includes("/generate")) {
        return Promise.resolve(jsonResponse({ status: "succeeded", url: "https://cdn.example/result.png" }));
      }
      imageSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>(() => undefined);
    });
    const resultPromise = resolveGrsImageResult(grsConfig(), grsInput(), {
      fetchImpl,

      overallDeadlineMs: 25
    });

    await vi.advanceTimersByTimeAsync(25);

    await expect(resultPromise).resolves.toEqual({
      status: "failed",
      reason: "GrsAI image request exceeded its overall safety deadline."
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(imageSignal?.aborted).toBe(true);
  });

  it("returns unknown immediately after response loss without backoff", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("network down");
    });
    const resultPromise = resolveGrsImageResult(grsConfig(), grsInput(), {
      fetchImpl,


      overallDeadlineMs: 25
    });

    await vi.advanceTimersByTimeAsync(25);

    await expect(resultPromise).resolves.toEqual({
      status: "failed",
      reason: "GrsAI image request failed.",
      failureCode: "external_execution_state_unknown"
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps an explicit caller abort distinct from the internal safety deadline", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const resultPromise = resolveGrsImageResult(grsConfig(), grsInput(), {
      fetchImpl,
      signal: controller.signal,
      overallDeadlineMs: 60_000
    });

    controller.abort();

    await expect(resultPromise).resolves.toEqual({
      status: "cancelled",
      reason: "GrsAI image request was cancelled."
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("disposes the safety deadline after a completed request", async () => {
    vi.useFakeTimers();
    const fetchImpl: typeof fetch = async (input) =>
      String(input).includes("/generate")
        ? jsonResponse({ status: "succeeded", url: "https://cdn.example/result.png" })
        : new Response(new Blob(["png"], { type: "image/png" }), {
            headers: { "Content-Type": "image/png" }
          });

    await expect(
      resolveGrsImageResult(grsConfig(), grsInput(), {
        fetchImpl,

        overallDeadlineMs: 25
      })
    ).resolves.toMatchObject({ status: "ok" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([408, 429, 500, 502, 503, 504])("does not repeat/fail over a generate POST after HTTP %s", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("ambiguous status", { status }));
    const result = await resolveGrsImageResult({ ...grsConfig(), fallbackBaseUrls: ["https://fallback.example"] }, grsInput(), { fetchImpl });
    expect(result).toMatchObject({ status: "failed", failureCode: "external_execution_state_unknown" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://grs.example/v1/api/generate");
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("polls only the known task, then downloads the same result without new generation", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: "task/same", status: "pending" }))
      .mockResolvedValueOnce(jsonResponse({ id: "task/same", status: "running" }))
      .mockResolvedValueOnce(jsonResponse({ id: "task/same", status: "succeeded", url: "https://cdn.example/result.png" }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.example/result-final.png" } }))
      .mockResolvedValueOnce(new Response("png", { headers: { "Content-Type": "image/png" } }));
    const result = await resolveGrsImageResult(grsConfig(), grsInput(), { fetchImpl, maxPolls: 2, pollDelayMs: 0 });
    expect(result).toMatchObject({ status: "ok", providerTaskId: "task/same" });
    expect(fetchImpl.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["https://grs.example/v1/api/generate", "POST"],
      ["https://grs.example/v1/api/result?id=task%2Fsame", "GET"],
      ["https://grs.example/v1/api/result?id=task%2Fsame", "GET"],
      ["https://cdn.example/result.png", "GET"],
      ["https://cdn.example/result-final.png", "GET"]
    ]);
  });

  it("recovers the D1 completed task from file4 using the narrow CDN policy with zero generate POSTs", async () => {
    const taskId = "15-dea8783d-4056-4e65-97a6-0807657a9a8b";
    const resultUrl = "https://file4.aitohumanize.com/file/4f4a014dbccf4f139e07127d07c11616.png";
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: taskId, status: "succeeded", results: [{ url: resultUrl }], progress: 100 }))
      .mockResolvedValueOnce(new Response("original-image", { headers: { "Content-Type": "image/png" } }));
    const beforeSubmit = vi.fn(async () => { throw new Error("Recovery must never acquire paid execution"); });
    const observe = vi.fn(async () => undefined);
    const result = await resolveGrsImageResult({ ...grsConfig(), imageHostAllowlist: ["file*.aitohumanize.com"] },
      grsInput(), { fetchImpl, resumeTaskId: taskId, maxPolls: 1, pollDelayMs: 0,
        effect: { beforeSubmit, observe, cancel: async () => undefined } });
    expect(result).toMatchObject({ status: "ok", providerTaskId: taskId, mimeType: "image/png" });
    if (result.status === "ok") expect(await result.blob.text()).toBe("original-image");
    expect(beforeSubmit).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      [`https://grs.example/v1/api/result?id=${taskId}`, "GET"], [resultUrl, "GET"]
    ]);
    expect(observe).toHaveBeenCalledWith({ kind: "succeeded", taskId });
  });

  it("keeps a confirmed known-task failure distinct from submission unknown", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: "task-failed", status: "pending" }))
      .mockResolvedValueOnce(jsonResponse({ id: "task-failed", status: "failed", message: "generation failed" }));
    const result = await resolveGrsImageResult(grsConfig(), grsInput(), { fetchImpl, maxPolls: 1, pollDelayMs: 0 });
    expect(result).toEqual({ status: "failed", reason: "GrsAI image task failed: generation failed" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not submit when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await resolveGrsImageResult(grsConfig(), grsInput(), { fetchImpl, signal: controller.signal });
    expect(result.status).toBe("cancelled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports successful-POST body loss and malformed JSON as unknown without regenerating", async () => {
    for (const response of [new Response("invalid JSON"), new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(new TypeError("body lost")); } }))]) {
      const fetchImpl = vi.fn<typeof fetch>(async () => response);
      const result = await resolveGrsImageResult(grsConfig(), grsInput(), { fetchImpl });
      expect(result).toMatchObject({ status: "failed", failureCode: "external_execution_state_unknown" });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

});

function grsConfig() {
  return {
    apiKey: "key",
    baseUrl: "https://grs.example",
    imageHostAllowlist: ["cdn.example"],
    model: "nano-banana-fast"
  };
}

function grsInput() {
  return {
    modelId: "nano-banana-fast",
    prompt: "deadline test",
    images: [],
    aspectRatio: "1:1" as const,
    referenceObjectIds: []
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function oversizedStreamingResponse(status = 200): {
  response: Response;
  wasCancelled(): boolean;
} {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(300 * 1024).fill(97));
    },
    cancel() {
      cancelled = true;
    }
  });
  return {
    response: new Response(body, {
      status,
      headers: { "Content-Type": "application/json" }
    }),
    wasCancelled: () => cancelled
  };
}
