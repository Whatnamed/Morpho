import { describe, expect, it } from "vitest";

import { normalizeSafeExternalNavigationUrl } from "./externalNavigationPolicy";

describe("external navigation policy", () => {
  it.each([
    "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "blob:https://example.com/id",
    "ftp://example.com/file", "mailto:test@example.com", "https://user:pass@example.com/",
    "https://localhost/", "https://api.localhost/", "http://0.0.0.0/", "http://127.8.9.10/",
    "http://10.1.2.3/", "http://172.16.0.1/", "http://172.31.255.255/", "http://192.168.1.1/",
    "http://169.254.2.3/", "http://2130706433/", "http://0177.0.0.1/", "http://0x7f000001/",
    "http://[::]/", "http://[::1]/", "http://[fc00::1]/", "http://[fd12::1]/", "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/", " https://example.com/", "https://example.com/\n"
  ])("rejects unsafe destination %s", (url) => {
    expect(normalizeSafeExternalNavigationUrl(url)).toBeUndefined();
  });

  it.each([
    ["https://Example.com/path?q=1#part", "example.com"],
    ["http://8.8.8.8/", "8.8.8.8"],
    ["https://[2606:4700:4700::1111]/", "2606:4700:4700::1111"]
  ])("normalizes public destination %s", (url, hostname) => {
    expect(normalizeSafeExternalNavigationUrl(url)).toMatchObject({ hostname });
  });
});
