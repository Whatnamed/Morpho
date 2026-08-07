import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Agent Runtime architecture boundary", () => {
  it("exposes one canonical client runtime with no selector or public B entry", () => {
    const workspaceClient = source("src/features/workspace/WorkspaceClient.tsx");

    expect(workspaceClient).toContain('from "./useWorkspaceAgentRuntimeController"');
    expect(workspaceClient).toContain("useWorkspaceAgentRuntimeController({");
    expect(workspaceClient).not.toContain('from "./agentTurnRunner"');
    expect(workspaceClient).not.toContain("runMorphoAgentTurn(");
    expect(source("src/features/workspace/useWorkspaceAgentRuntimeController.ts")).toContain("runMorphoAgentTurn(");
    expect(exists("src/features/workspace/agentTurnRunner.ts")).toBe(true);
    expect(exists("src/features/workspace/agentTurnRunnerAPlus.ts")).toBe(false);
    expect(exists("src/features/workspace/agentRuntimeSelector.ts")).toBe(false);
    expect(source(".env.example")).not.toContain("NEXT_PUBLIC_MORPHO_AGENT_RUNTIME");
  });

  it("removes B routes and preserves the A+ journal plus independent AI routes", () => {
    expect(exists("src/app/api/ai/agent/route.ts")).toBe(false);
    expect(filesUnder(resolve(ROOT, "src/app/api/ai/agent/lease"))).toEqual([]);
    expect(filesUnder(resolve(ROOT, "src/app/api/ai/agent/snapshot"))).toEqual([]);
    expect(exists("src/app/api/ai/web-search/route.ts")).toBe(false);

    expect(exists("src/app/api/ai/agent/turns/route.ts")).toBe(true);
    expect(exists("src/app/api/ai/agent/turns/[turnId]/route.ts")).toBe(true);
    expect(exists("src/app/api/ai/agent/turns/[turnId]/requests/route.ts")).toBe(true);
    expect(exists("src/app/api/ai/chat/route.ts")).toBe(true);
    expect(exists("src/app/api/ai/image/route.ts")).toBe(true);
  });

  it("keeps retired proof protocols out of active production source", () => {
    const productionFiles = filesUnder(resolve(ROOT, "src"))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => relative(ROOT, file).replaceAll("\\", "/") !== "src/domain/morpho/workspace.ts");
    const activeSource = productionFiles.map((file) => readFileSync(file, "utf8")).join("\n");

    [
      "agentCompactionProtocol",
      "AgentTurnLease",
      "agentTurnLease",
      "continuationToken",
      "turnClosureToken",
      "transcriptSnapshotToken",
      "latestProviderRequestState",
      "agentTurnOutcomeItem",
      "morpho_compaction_transcript",
      "morpho_context_state"
    ].forEach((retiredName) => expect(activeSource).not.toContain(retiredName));
  });

  it("normalizes legacy local proof fields without keeping them in canonical types", () => {
    const workspaceNormalizer = source("src/domain/morpho/workspace.ts");
    const workspaceTypes = source("src/domain/morpho/types.ts");

    expect(workspaceNormalizer).toContain("_legacyOutcomeItem");
    expect(workspaceNormalizer).toContain("_legacyClosureRecovery");
    expect(workspaceNormalizer).toContain("_legacyProviderRequestState");
    expect(workspaceTypes).not.toContain("AgentTurnClosureRecovery");
    expect(workspaceTypes).not.toContain("latestProviderRequestState");
    expect(workspaceTypes).not.toContain("agentTurnOutcomeItem");
  });
});

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function exists(path: string): boolean {
  return existsSync(resolve(ROOT, path));
}

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  }).filter((path) => /\.(?:ts|tsx)$/.test(path));
}
