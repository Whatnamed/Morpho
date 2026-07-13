import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseWorkspace } from "../workspace";
import {
  CURRENT_CASE_STUDY_ID,
  CURRENT_CASE_STUDY_VERSION,
  currentCaseStudyAssetManifest,
  currentCaseStudyWorkspace
} from "./currentCaseStudy";
import diagnostics from "./currentCaseDiagnostics.generated.json";

describe("current case study", () => {
  it("keeps the generated workspace parseable with its stable deployment id", () => {
    const parsed = parseWorkspace(JSON.stringify(currentCaseStudyWorkspace));

    expect(parsed).toMatchObject({ status: "ok" });
    expect(currentCaseStudyWorkspace.project.id).toBe(CURRENT_CASE_STUDY_ID);
    expect(diagnostics.caseStudyVersion).toBe(CURRENT_CASE_STUDY_VERSION);
    expect(currentCaseStudyWorkspace.project.title).toBe(diagnostics.project.title);
  });

  it("preserves the generated object and conversation diagnostics", () => {
    const objectTypes = Object.values(currentCaseStudyWorkspace.objects).reduce<Record<string, number>>((counts, object) => {
      counts[object.type] = (counts[object.type] ?? 0) + 1;
      return counts;
    }, {});
    const messages = currentCaseStudyWorkspace.ai.messages;

    expect(objectTypes).toEqual(diagnostics.objectTypes);
    expect(messages.filter((message) => message.role === "user")).toHaveLength(diagnostics.chat.userMessageCount);
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(diagnostics.chat.assistantMessageCount);
    expect(messages.some((message) => (message.agentTrace?.parts.length ?? 0) > 0)).toBe(true);
    expect(messages.some((message) => (message.citationIds?.length ?? 0) > 0)).toBe(true);
    expect(currentCaseStudyWorkspace.ai.conversationCheckpoints).toHaveLength(diagnostics.chat.checkpointCount);
  });

  it("ships every generated binary asset with matching size and hash", async () => {
    expect(currentCaseStudyAssetManifest.assets).toHaveLength(diagnostics.assetCount);

    for (const manifestAsset of currentCaseStudyAssetManifest.assets) {
      const asset = currentCaseStudyWorkspace.assets[manifestAsset.assetId];
      const file = await readFile(resolve(process.cwd(), "public", manifestAsset.publicPath.slice(1)));
      const hash = createHash("sha256").update(file).digest("hex");

      expect(asset).toBeDefined();
      expect(asset?.storageKey).toBe(manifestAsset.runtimeStorageKey);
      expect(file.byteLength).toBe(manifestAsset.size);
      expect(hash).toBe(manifestAsset.contentHash);
    }
  });

  it("does not retain non-deployable local URLs or user-local paths", () => {
    const serialized = JSON.stringify(currentCaseStudyWorkspace);

    expect(serialized).not.toMatch(/\bblob:/i);
    expect(serialized).not.toMatch(/\b(?:localhost|127\.0\.0\.1)\b/i);
    expect(serialized).not.toMatch(/[a-z]:\\users\\/i);
  });
});
