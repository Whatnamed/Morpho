import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { assertCleanWorktree, isWorktreeClean, worktreeSourceDigest } from "../../scripts/build-provenance.mjs";

it("counts untracked source as dirty while excluding ignored files and local evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "morpho-build-provenance-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "--quiet");
    await writeFile(join(root, ".gitignore"), ".next/\n");
    git("add", ".gitignore");
    git("-c", "user.name=Morpho Tests", "-c", "user.email=morpho@example.invalid", "-c", "commit.gpgSign=false", "commit", "--quiet", "-m", "Fixture");
    const cleanSourceTree = await worktreeSourceDigest(root);

    await mkdir(join(root, ".next"));
    await mkdir(join(root, "output"));
    await writeFile(join(root, ".next", "BUILD_ID"), "build");
    await writeFile(join(root, "output", "evidence.json"), "{}");
    expect(() => assertCleanWorktree(root)).not.toThrow();
    expect(await worktreeSourceDigest(root)).toEqual(cleanSourceTree);

    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "new-input.ts"), "export const input = 1;");
    expect(isWorktreeClean(root)).toBe(false);
    expect(() => assertCleanWorktree(root)).toThrow("?? src/new-input.ts");
    expect(await worktreeSourceDigest(root)).toMatchObject({ fileCount: cleanSourceTree.fileCount + 1 });

    git("add", "src/new-input.ts");
    expect(() => assertCleanWorktree(root)).toThrow("A  src/new-input.ts");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
