import { describe, expect, it } from "vitest";

import { validateGrsImageRouteRequest } from "./request";

describe("GrsAI image route request validation", () => {
  it("normalizes nano-banana-2 requests to the native GrsAI profile", () => {
    const result = validateGrsImageRouteRequest(
      {
        prompt: "继续发展转角细节",
        images: ["data:image/png;base64,a", "data:image/png;base64,b", "data:image/png;base64,c", "data:image/png;base64,d", "data:image/png;base64,e"]
      },
      { model: "nano-banana-2" }
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.prompt).toBe("继续发展转角细节");
      expect(result.value.images).toHaveLength(4);
      expect(result.value.aspectRatio).toBe("4:3");
      expect(result.value.imageSize).toBe("1K");
      expect(result.value.replyType).toBe("json");
    }
  });

  it("keeps gpt-image-2 on its own request profile", () => {
    const result = validateGrsImageRouteRequest(
      {
        prompt: "继续发展转角细节"
      },
      { model: "gpt-image-2" }
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.imageSize).toBe("1024x768");
      expect(result.value.replyType).toBe("url");
    }
  });

  it("rejects empty prompts before calling GrsAI", () => {
    const result = validateGrsImageRouteRequest({ prompt: " " });

    expect(result.status).toBe("failed");
  });
});
