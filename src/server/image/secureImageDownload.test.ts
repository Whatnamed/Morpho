import { describe, expect, it, vi } from "vitest";

import { downloadSecureProviderImage } from "./secureImageDownload";

const allowedHosts = new Set(["cdn.example"]);

describe("secure provider image download", () => {
  it.each([
    "http://cdn.example/result.png",
    "https://user:pass@cdn.example/result.png",
    "https://cdn.example:8443/result.png",
    "https://127.0.0.1/result.png",
    "https://[::1]/result.png",
    "https://metadata.google.internal/result.png",
    "https://unlisted.example/result.png"
  ])("rejects untrusted URL %s before fetch", async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await downloadSecureProviderImage(url, { fetchImpl, allowedHosts });

    expect(result.status).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("revalidates every redirect target", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1/metadata" }
    }));

    const result = await downloadSecureProviderImage("https://cdn.example/result.png", {
      fetchImpl,
      allowedHosts
    });

    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("不允许") });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual", credentials: "omit" });
  });

  it("cancels an oversized streaming image body", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(6));
      },
      cancel
    });
    const result = await downloadSecureProviderImage("https://cdn.example/result.png", {
      allowedHosts,
      maxBytes: 10,
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { "content-type": "image/png" }
      })
    });

    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("超过允许大小") });
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects non-image content and accepts a bounded image", async () => {
    await expect(downloadSecureProviderImage("https://cdn.example/not-image", {
      allowedHosts,
      fetchImpl: async () => new Response("html", {
        headers: { "content-type": "text/html" }
      })
    })).resolves.toMatchObject({ status: "failed", reason: expect.stringContaining("图片类型") });

    const result = await downloadSecureProviderImage("https://cdn.example/result.png", {
      allowedHosts,
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" }
      })
    });
    expect(result).toMatchObject({ status: "ok", mimeType: "image/png" });
  });
});
