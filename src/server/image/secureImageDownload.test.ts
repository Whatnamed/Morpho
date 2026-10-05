import { describe, expect, it, vi } from "vitest";

import { downloadSecureProviderImage } from "./secureImageDownload";

const allowedHosts = new Set(["cdn.example"]);
const grsFamily = new Set(["file*.aitohumanize.com"]);

describe("secure provider image download", () => {
  it.each(["file1.aitohumanize.com", "file4.aitohumanize.com", "file27.aitohumanize.com"])(
    "accepts the narrow GrsAI family member %s", async (host) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" }
      }));
      const result = await downloadSecureProviderImage(`https://${host}/result.png`, {
        fetchImpl, allowedHosts: grsFamily
      });
      expect(result.status).toBe("ok");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    "https://aitohumanize.com/result.png",
    "https://foo.aitohumanize.com/result.png",
    "https://evil.file4.aitohumanize.com/result.png",
    "https://file4.aitohumanize.com.evil.test/result.png",
    "https://file.aitohumanize.com/result.png",
    "http://file4.aitohumanize.com/result.png",
    "https://user:pass@file4.aitohumanize.com/result.png",
    "https://file4.aitohumanize.com:8443/result.png",
    "https://127.0.0.1/result.png",
    "https://[::1]/result.png",
    "https://localhost/result.png",
    "https://cdn.local/result.png",
    "https://metadata.google.internal/result.png"
  ])("family policy rejects %s before fetch, even if forbidden hosts are also listed exactly", async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const allowed = new Set([...grsFamily, "127.0.0.1", "[::1]", "localhost", "cdn.local", "metadata.google.internal"]);
    expect((await downloadSecureProviderImage(url, { fetchImpl, allowedHosts: allowed })).status).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not interpret other tokens as wildcards", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await downloadSecureProviderImage("https://cdn.example/result.png", {
      fetchImpl, allowedHosts: new Set(["*.example", "cdn.*", "file*.example", "*.aitohumanize.com"])
    });
    expect(result.status).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the same family policy after every redirect", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://file27.aitohumanize.com/result.png" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }));
    expect((await downloadSecureProviderImage("https://file1.aitohumanize.com/result.png", {
      fetchImpl, allowedHosts: grsFamily
    })).status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const badRedirect = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 302, headers: { location: "https://file4.aitohumanize.com.evil.test/result.png" }
    }));
    expect((await downloadSecureProviderImage("https://file4.aitohumanize.com/result.png", {
      fetchImpl: badRedirect, allowedHosts: grsFamily
    })).status).toBe("failed");
    expect(badRedirect).toHaveBeenCalledTimes(1);
  });

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
