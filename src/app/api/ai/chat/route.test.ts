import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

vi.mock("@/server/ai/openaiCompatibleConfig", () => ({
  loadOpenAiCompatibleConfig: () => ({
    status: "ok",
    config: {
      apiKey: "test-key",
      baseUrl: "https://api.aijws.com/v1",
      model: "gpt-5.4",
      webSearchEnabled: true
    }
  })
}));

const guardAiRouteMock = vi.fn();

vi.mock("@/server/auth/aiAccess", () => ({
  guardAiRoute: (...args: unknown[]) => guardAiRouteMock(...args),
  aiAccessDeniedResponse: (result: { error: string; httpStatus: number }) =>
    Response.json({ error: result.error }, { status: result.httpStatus })
}));

const streamOpenAiCompatibleResponseMock = vi.fn();

vi.mock("@/server/ai/openaiCompatibleProvider", () => ({
  streamOpenAiCompatibleResponse: (...args: unknown[]) => streamOpenAiCompatibleResponseMock(...args),
  OpenAiCompatibleProviderError: class OpenAiCompatibleProviderError extends Error {
    constructor(
      readonly status: number,
      readonly diagnostic?: string
    ) {
      super(`provider ${status}`);
    }
  }
}));

describe("AI chat route", () => {
  beforeEach(() => {
    guardAiRouteMock.mockReset();
    guardAiRouteMock.mockResolvedValue({
      status: "allowed",
      usage: {
        role: "tester",
        accessStatus: "active",
        dailyTextLimit: 20,
        dailyImageLimit: 4,
        textRequestCount: 1,
        imageRequestCount: 0,
        usageDate: "2026-07-05"
      }
    });
    streamOpenAiCompatibleResponseMock.mockReset();
    streamOpenAiCompatibleResponseMock.mockImplementation(async (...args: unknown[]) => {
      const handlers = args[2] as {
        onTextDelta?: (text: string) => void;
        onCitations?: (citations: Array<{ title: string; url?: string }>) => void;
      };
      handlers.onTextDelta?.("continued analysis");
      handlers.onCitations?.([{ title: "Source", url: "https://example.com" }]);
      return {
      responseId: "resp_123",
      outputText: "continued analysis",
      functionCalls: [],
      citations: [{ title: "Source", url: "https://example.com" }],
      webSearchCallCount: 0,
      outputItems: []
      };
    });
  });

  it("returns JSON 401 for unauthenticated requests before provider execution", async () => {
    guardAiRouteMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 401,
      error: "please sign in"
    });

    const response = await POST(makeRequest({ draft: "continue", messages: [], objectSummaries: [], attachments: [] }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "please sign in" });
    expect(streamOpenAiCompatibleResponseMock).not.toHaveBeenCalled();
  });

  it("returns JSON 429 when text quota is exhausted before provider execution", async () => {
    guardAiRouteMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 429,
      error: "quota exhausted"
    });

    const response = await POST(makeRequest({ draft: "continue", messages: [], objectSummaries: [], attachments: [] }));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "quota exhausted" });
    expect(streamOpenAiCompatibleResponseMock).not.toHaveBeenCalled();
  });

  it("routes chat, image input, and web-search intent through the AiJWS-compatible provider", async () => {
    const response = await POST(makeImageRequest());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("\"type\":\"delta\"");
    expect(streamOpenAiCompatibleResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://api.aijws.com/v1",
        model: "gpt-5.4"
      }),
      expect.objectContaining({
        input: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({ type: "input_image", image_url: "data:image/png;base64,abc123" })
            ])
          })
        ]),
        tools: [expect.objectContaining({ type: "web_search_preview" })]
      }),
      expect.any(Object),
      expect.any(AbortSignal)
    );
  });

  it("falls back to text-only context when AiJWS rejects image input", async () => {
    const { OpenAiCompatibleProviderError } = await import("@/server/ai/openaiCompatibleProvider");
    streamOpenAiCompatibleResponseMock
      .mockRejectedValueOnce(new OpenAiCompatibleProviderError(400, "unsupported image input"))
      .mockImplementationOnce(async (...args: unknown[]) => {
        const handlers = args[2] as { onTextDelta?: (text: string) => void };
        handlers.onTextDelta?.("Text-only fallback answer.");
        return {
          responseId: "resp_text_only",
          outputText: "Text-only fallback answer.",
          functionCalls: [],
          citations: [],
          webSearchCallCount: 0,
          outputItems: []
        };
      });

    const response = await POST(makeImageRequest());

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Text-only fallback answer.");
    expect(streamOpenAiCompatibleResponseMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(streamOpenAiCompatibleResponseMock.mock.calls[0][1])).toContain("input_image");
    expect(JSON.stringify(streamOpenAiCompatibleResponseMock.mock.calls[1][1])).not.toContain("input_image");
  });
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function makeImageRequest(): Request {
  return makeRequest({
    draft: "analyze this image and search for supporting sources",
    messages: [],
    objectSummaries: [{ id: "image-a", type: "image", title: "Image A", summary: "Selected image." }],
    attachments: [
      {
        id: "asset-a",
        kind: "image",
        objectId: "image-a",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,abc123",
        status: "ready"
      }
    ],
    webSearch: {
      enabled: true,
      forceSearch: true
    },
    comparisonContext: {
      sourceObjectIds: ["image-a"],
      attachedImageObjectIds: ["image-a"],
      unavailableImageObjectIds: [],
      attachedDocumentObjectIds: [],
      unavailableDocumentObjectIds: [],
      backgroundObjectIds: [],
      documentFragmentExtracts: []
    }
  });
}
