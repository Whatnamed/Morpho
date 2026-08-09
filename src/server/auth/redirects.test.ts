import { describe, expect, it } from "vitest";

import { sanitizeNextPath } from "./redirects";

describe("auth redirects", () => {
  it("keeps only same-origin product paths as login return targets", () => {
    expect(sanitizeNextPath("/projects/project-a")).toBe("/projects/project-a");
    expect(sanitizeNextPath("/projects/project-a?view=canvas#selection")).toBe(
      "/projects/project-a?view=canvas#selection"
    );
    expect(sanitizeNextPath("/projects/project%20a?source=a%2Fb")).toBe(
      "/projects/project%20a?source=a%2Fb"
    );
    expect(sanitizeNextPath("https://evil.example/projects/project-a")).toBe("/");
    expect(sanitizeNextPath("//evil.example/projects/project-a")).toBe("/");
    expect(sanitizeNextPath("/login")).toBe("/");
    expect(sanitizeNextPath("/login?next=/projects/project-a")).toBe("/");
    expect(sanitizeNextPath("/login#return")).toBe("/");
    expect(sanitizeNextPath("/login/")).toBe("/");
    expect(sanitizeNextPath(undefined)).toBe("/");
  });

  it.each([
    "/\\\\evil.example/projects/project-a",
    "/%5C%5Cevil.example/projects/project-a",
    "/%255C%255Cevil.example/projects/project-a",
    "/%2F%2Fevil.example/projects/project-a",
    "/%252F%252Fevil.example/projects/project-a",
    "/%2e%2e/%2Fevil.example/projects/project-a",
    "/%252e%252e/%252Fevil.example/projects/project-a",
    "/%09/evil.example",
    "/%2509/evil.example",
    "/bad%encoding"
  ])("rejects separator, control-character, and decoding bypass %s", (value) => {
    expect(sanitizeNextPath(value)).toBe("/");
  });

  it("fails closed for excessive or recursively encoded return targets", () => {
    expect(sanitizeNextPath(`/${"a".repeat(4_096)}`)).toBe("/");
    let deeplyEncodedBackslash = "\\evil.example";
    for (let pass = 0; pass < 9; pass += 1) {
      deeplyEncodedBackslash = encodeURIComponent(deeplyEncodedBackslash);
    }
    expect(sanitizeNextPath(`/${deeplyEncodedBackslash}`)).toBe("/");
  });
});
