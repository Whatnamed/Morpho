import { describe, expect, it } from "vitest";

import { inspectSafeImageDataUrl, validateImageInputCollection } from "./imageInputBounds";

describe("image input boundaries", () => {
  it("measures padded and unpadded safe raster data URLs without decoding them", () => {
    expect(inspectSafeImageDataUrl("data:image/png;base64,YQ==")).toEqual({
      mimeType: "image/png",
      decodedBytes: 1
    });
    expect(inspectSafeImageDataUrl("data:image/jpeg;base64,abc123")).toEqual({
      mimeType: "image/jpeg",
      decodedBytes: 4
    });
  });

  it("rejects active, malformed, per-image, aggregate, and count violations", () => {
    expect(inspectSafeImageDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBeUndefined();
    expect(inspectSafeImageDataUrl("data:image/png;base64,a")).toBeUndefined();
    expect(validateImageInputCollection(
      ["data:image/png;base64,AAAAAAAA"],
      { maxCount: 4, maxDecodedBytes: 5, maxTotalDecodedBytes: 20 }
    ).status).toBe("failed");
    expect(validateImageInputCollection(
      ["data:image/png;base64,AAAA", "data:image/png;base64,AAAA", "data:image/png;base64,AAAA"],
      { maxCount: 4, maxDecodedBytes: 4, maxTotalDecodedBytes: 8 }
    ).status).toBe("failed");
    expect(validateImageInputCollection(
      ["data:image/png;base64,AAAA", "data:image/png;base64,AAAA"],
      { maxCount: 1 }
    ).status).toBe("failed");
  });
});
