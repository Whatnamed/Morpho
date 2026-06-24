import { describe, expect, it } from "vitest";

import { buildMorphoSystemPrompt, validateAiRouteRequest } from "./request";

describe("MiMo text route request conversion", () => {
  it("states that the current MiMo text route does not send image pixels", () => {
    const prompt = buildMorphoSystemPrompt({
      draft: "分析这张图",
      task: "general",
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

    expect(prompt).toContain("当前 MiMo 文本聊天尚未发送图片像素");
    expect(prompt).toContain("不能声称已经完成真实图像视觉分析");
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
});
