import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { withPreservedNextBuildDirectory } from "../../scripts/build-cloudflare.mjs";

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe("Cloudflare build isolation", () => {
  it("restores an existing standard .next after a successful Cloudflare build", async () => {
    const root = createRootWithStandardBuild("standard-success");

    await withPreservedNextBuildDirectory(root, () => {
      expect(existsSync(join(root, ".next"))).toBe(false);
      mkdirSync(join(root, ".next"));
      writeFileSync(join(root, ".next", "BUILD_ID"), "cloudflare");
    });

    expect(readFileSync(join(root, ".next", "BUILD_ID"), "utf8")).toBe("standard-success");
    expect(existsSync(join(root, ".next.morpho-standard-backup"))).toBe(false);
  });

  it("restores an existing standard .next when the Cloudflare build fails", async () => {
    const root = createRootWithStandardBuild("standard-failure");

    await expect(withPreservedNextBuildDirectory(root, () => {
      mkdirSync(join(root, ".next"));
      writeFileSync(join(root, ".next", "BUILD_ID"), "partial-cloudflare");
      throw new Error("simulated build failure");
    })).rejects.toThrow("simulated build failure");

    expect(readFileSync(join(root, ".next", "BUILD_ID"), "utf8")).toBe("standard-failure");
    expect(existsSync(join(root, ".next.morpho-standard-backup"))).toBe(false);
  });

  it("leaves no .next when no standard build existed before the Cloudflare build", async () => {
    const root = mkdtempSync(join(tmpdir(), "morpho-cf-build-"));
    roots.push(root);

    await withPreservedNextBuildDirectory(root, () => {
      mkdirSync(join(root, ".next"));
      writeFileSync(join(root, ".next", "BUILD_ID"), "cloudflare-only");
    });

    expect(existsSync(join(root, ".next"))).toBe(false);
  });
});

function createRootWithStandardBuild(buildId: string): string {
  const root = mkdtempSync(join(tmpdir(), "morpho-cf-build-"));
  roots.push(root);
  mkdirSync(join(root, ".next"));
  writeFileSync(join(root, ".next", "BUILD_ID"), buildId);
  return root;
}
