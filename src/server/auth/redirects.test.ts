import { describe, expect, it } from "vitest";

import { sanitizeNextPath } from "./redirects";

describe("auth redirects", () => {
  it("keeps only same-origin product paths as login return targets", () => {
    expect(sanitizeNextPath("/projects/project-a")).toBe("/projects/project-a");
    expect(sanitizeNextPath("https://evil.example/projects/project-a")).toBe("/");
    expect(sanitizeNextPath("//evil.example/projects/project-a")).toBe("/");
    expect(sanitizeNextPath("/login")).toBe("/");
    expect(sanitizeNextPath(undefined)).toBe("/");
  });
});
