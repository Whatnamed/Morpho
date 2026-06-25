import { describe, expect, it } from "vitest";

import { buildMorphoSystemPrompt, buildProviderMessages, validateAiRouteRequest } from "./request";

describe("MiMo chat route request conversion", () => {
  it("states when no image pixels are sent", () => {
    const prompt = buildMorphoSystemPrompt({
      draft: "Analyze this image",
      task: "general",
      taskMode: "chatAnalysis",
      messages: [],
      objectSummaries: [
        {
          id: "image-a",
          type: "image",
          title: "Reference image",
          summary: "A local imported image."
        }
      ],
      defaultReferenceStatus: "notRelevant",
      attachments: [
        {
          id: "asset-a",
          kind: "image",
          objectId: "image-a",
          mimeType: "image/png",
          status: "metadataOnly"
        }
      ]
    });

    expect(prompt).toContain("本次没有发送图片像素");
    expect(prompt).toContain("不能声称完成真实视觉分析");
  });

  it("keeps a sanitized attachment boundary out of provider messages", () => {
    const result = validateAiRouteRequest({
      draft: "Analyze this image",
      messages: [],
      objectSummaries: [],
      attachments: [
        {
          id: "asset-a",
          kind: "image",
          objectId: "image-a",
          objectIds: ["image-a"],
          mimeType: "image/png",
          representation: "single",
          status: "metadataOnly",
          apiKey: "must-not-survive"
        }
      ]
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(JSON.stringify(result.value.attachments)).not.toContain("must-not-survive");
      expect(result.value.attachments).toEqual([
        {
          id: "asset-a",
          kind: "image",
          objectId: "image-a",
          objectIds: ["image-a"],
          mimeType: "image/png",
          representation: "single",
          status: "metadataOnly"
        }
      ]);
    }
  });

  it("converts ready image attachments to OpenAI-compatible image_url parts", () => {
    const messages = buildProviderMessages({
      draft: "Analyze this image",
      task: "general",
      taskMode: "chatAnalysis",
      messages: [],
      objectSummaries: [],
      attachments: [
        {
          id: "asset-a",
          kind: "image",
          objectId: "image-a",
          objectIds: ["image-a"],
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,abc123",
          representation: "single",
          status: "ready"
        }
      ]
    });

    expect(messages[0]?.content).toEqual([
      { type: "text", text: "Analyze this image" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,abc123" } }
    ]);
  });

  it("keeps contact sheet metadata for diagnostics without sending it as text", () => {
    const result = validateAiRouteRequest({
      draft: "Compare these images",
      taskMode: "chatAnalysis",
      messages: [],
      objectSummaries: [],
      attachments: [
        {
          id: "sheet-a",
          kind: "image",
          objectId: "image-a",
          objectIds: ["image-a", "image-b", "image-c", "image-d"],
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,abc123",
          representation: "contactSheet",
          status: "ready"
        }
      ]
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.attachments[0]).toMatchObject({
        representation: "contactSheet",
        objectIds: ["image-a", "image-b", "image-c", "image-d"]
      });
      expect(buildMorphoSystemPrompt(result.value)).toContain("自动生成的总览图");
    }
  });

  it("normalizes web search options only for non-image modes", () => {
    const result = validateAiRouteRequest({
      draft: "Verify the latest source",
      taskMode: "researchOperation",
      messages: [],
      objectSummaries: [],
      attachments: [],
      webSearch: {
        enabled: true,
        forceSearch: true,
        maxKeyword: 99,
        limit: 99
      }
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.webSearch).toEqual({
        enabled: true,
        forceSearch: true,
        maxKeyword: 8,
        limit: 10
      });
    }

    expect(
      validateAiRouteRequest({
        draft: "Generate image",
        taskMode: "imageGeneration",
        messages: [],
        objectSummaries: [],
        attachments: [],
        webSearch: { enabled: true, forceSearch: true }
      })
    ).toMatchObject({
      status: "ok",
      value: {
        webSearch: undefined
      }
    });
  });
});
