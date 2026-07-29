import { describe, expect, it } from "vitest";

import { sha256Hex } from "./agentProtocolHash";
import { hashProductValue } from "./agentProductHash";

describe("Morpho product SHA-256", () => {
  it("matches the browser-safe SHA-256 implementation against known vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("uses a domain and canonical structure so equivalent objects replay exactly", () => {
    const first = hashProductValue({ b: 2, a: 1 }, "morpho-test-domain-v1");
    const reordered = hashProductValue({ a: 1, b: 2 }, "morpho-test-domain-v1");

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(reordered).toBe(first);
    expect(hashProductValue({ a: 1, b: 3 }, "morpho-test-domain-v1")).not.toBe(first);
    expect(hashProductValue({ a: 1, b: 2 }, "morpho-other-domain-v1")).not.toBe(first);
  });
});
