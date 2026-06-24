import { describe, expect, it } from "vitest";

import { loadGrsImageConfig } from "./config";

describe("GrsAI image config", () => {
  it("loads server-only GrsAI environment variables", () => {
    const result = loadGrsImageConfig({
      MORPHO_GRS_API_KEY: "secret",
      MORPHO_GRS_BASE_URL: "https://grs.example",
      MORPHO_GRS_IMAGE_MODEL: "image-model"
    });

    expect(result).toEqual({
      status: "ok",
      config: {
        apiKey: "secret",
        baseUrl: "https://grs.example",
        model: "image-model"
      }
    });
  });

  it("fails clearly when required GrsAI environment variables are missing", () => {
    const result = loadGrsImageConfig({});

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toContain("MORPHO_GRS_API_KEY");
      expect(result.reason).not.toContain("secret");
    }
  });
});
