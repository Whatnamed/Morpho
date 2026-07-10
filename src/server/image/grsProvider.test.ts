import { describe, expect, it } from "vitest";

import { createGrsGenerateRequest, resolveGrsImageResult } from "./grsProvider";

describe("GrsAI image provider adapter", () => {
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

    expect(result.status).toBe("failed");
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
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
