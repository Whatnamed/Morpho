import { describe, expect, it } from "vitest";

import { buildMorphoSystemPrompt, buildProviderMessages, validateAiRouteRequest } from "./request";

describe("MiMo text route request conversion", () => {
  it("states when no image pixels are sent", () => {
    const prompt = buildMorphoSystemPrompt({
      draft: "分析这张图",
      task: "general",
      taskMode: "chatAnalysis",
      messages: [],
      objectSummaries: [
        {
          id: "image-a",
          type: "image",
          title: "参考图",
          summary: "一张本地导入图片"
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

  it("keeps a sanitized future attachment boundary out of provider messages", () => {
    const result = validateAiRouteRequest({
      draft: "分析这张图",
      messages: [],
      objectSummaries: [],
      attachments: [
        {
          id: "asset-a",
          kind: "image",
          objectId: "image-a",
          mimeType: "image/png",
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
          mimeType: "image/png",
          status: "metadataOnly"
        }
      ]);
    }
  });

  it("converts ready image attachments to OpenAI-compatible image_url parts", () => {
    const messages = buildProviderMessages({
      draft: "分析这张图",
      task: "general",
      taskMode: "chatAnalysis",
      messages: [],
      objectSummaries: [],
      attachments: [
        {
          id: "asset-a",
          kind: "image",
          objectId: "image-a",
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,abc123",
          status: "ready"
        }
      ]
    });

    expect(messages[0]?.content).toEqual([
      { type: "text", text: "分析这张图" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,abc123" } }
    ]);
  });

  it("normalizes web search options only for non-image modes", () => {
    const result = validateAiRouteRequest({
      draft: "请联网核实这个案例来源",
      taskMode: "researchOperation",
      messages: [],
      objectSummaries: [],
      attachments: [],
      webSearch: {
        enabled: true,
        maxKeyword: 9,
        limit: 8,
        forceSearch: true
      }
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.webSearch).toEqual({
        enabled: true,
        maxKeyword: 2,
        limit: 3,
        forceSearch: true
      });
    }
  });
});
