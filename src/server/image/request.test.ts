import { describe, expect, it } from "vitest";

import { GRS_REFERENCE_IMAGE_LIMIT } from "../../domain/morpho/imageLimits";
import { validateGrsImageRouteRequest } from "./request";

describe("GrsAI image route request validation", () => {
  it("normalizes nano-banana-2 requests to the native GrsAI profile", () => {
    const result = validateGrsImageRouteRequest({
      modelId: "nano-banana-2",
      prompt: "继续发展转角细节",
      images: [
        "data:image/png;base64,a",
        "data:image/png;base64,b",
        "data:image/png;base64,c",
        "data:image/png;base64,d"
      ],
      aspectRatio: "3:4",
      sizeOption: "4K",
      referenceObjectIds: ["image-a"],
      directionObjectId: "direction-a",
      clientRequestId: "client-request-a"
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.modelId).toBe("nano-banana-2");
      expect(result.value.prompt).toBe("继续发展转角细节");
      expect(result.value.images).toHaveLength(GRS_REFERENCE_IMAGE_LIMIT);
      expect(result.value.aspectRatio).toBe("3:4");
      expect(result.value.sizeOption).toBe("4K");
      expect(result.value.referenceObjectIds).toEqual(["image-a"]);
      expect(result.value.directionObjectId).toBe("direction-a");
      expect(result.value.clientRequestId).toBe("client-request-a");
    }
  });

  it("blocks requests that exceed the shared Grs reference image limit", () => {
    const result = validateGrsImageRouteRequest({
      prompt: "生成参考图",
      images: Array.from({ length: GRS_REFERENCE_IMAGE_LIMIT + 3 }, (_, index) => `data:image/png;base64,${index}`)
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toContain(String(GRS_REFERENCE_IMAGE_LIMIT));
      expect(result.reason).toContain("GrsAI");
      expect(result.reason).toContain("参考图最多只能使用");
    }
  });

  it("falls back to gpt-image-2 when the client omits modelId", () => {
    const result = validateGrsImageRouteRequest({
      prompt: "生成一张夜间使用场景",
      aspectRatio: "1:1"
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.modelId).toBe("gpt-image-2");
      expect(result.value.sizeOption).toBe("1K");
    }
  });

  it("rejects unknown or maintenance model ids before calling GrsAI", () => {
    expect(validateGrsImageRouteRequest({ modelId: "gpt-image-2-vip", prompt: "test" }).status).toBe("failed");
    expect(validateGrsImageRouteRequest({ modelId: "gpt-5.5", prompt: "test" }).status).toBe("failed");
  });

  it("rejects empty prompts before calling GrsAI", () => {
    const result = validateGrsImageRouteRequest({ prompt: " " });

    expect(result.status).toBe("failed");
  });
});
