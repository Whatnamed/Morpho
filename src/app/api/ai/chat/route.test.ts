import { beforeEach, describe, expect, it, vi } from "vitest";

import { MiMoProviderError } from "@/server/ai/errors";

import { POST } from "./route";

vi.mock("@/server/ai/config", () => ({
  loadAiConfig: () => ({
    status: "ok",
    config: {
      provider: "mimo",
      apiKey: "test-key",
      baseUrl: "https://example.test",
      model: "test-model",
      webSearchEnabled: true
    }
  })
}));

const streamMiMoChatMock = vi.fn();

vi.mock("@/server/ai/mimoProvider", () => ({
  streamMiMoChat: (...args: unknown[]) => streamMiMoChatMock(...args)
}));

describe("AI chat route", () => {
  beforeEach(() => {
    streamMiMoChatMock.mockReset();
  });

  it("returns provider request diagnostics with modality and web search context", async () => {
    streamMiMoChatMock.mockRejectedValueOnce(new MiMoProviderError("requestInvalid", 400));

    const response = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          draft: "分析这张图并联网补充依据",
          messages: [],
          objectSummaries: [],
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
          }
        })
      })
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("图片输入 1 个")
    });
    expect(streamMiMoChatMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        capability: "multimodal",
        webSearch: expect.objectContaining({ enabled: true })
      })
    );
  });
});
