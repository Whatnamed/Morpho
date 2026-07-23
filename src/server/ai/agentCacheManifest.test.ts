import { describe, expect, it } from "vitest";

import {
  buildAgentCacheItemManifest,
  compareAgentCacheManifests,
  hashAgentTools
} from "./agentCacheManifest";
import type { OpenAiCompatibleResponseRequest } from "./openaiCompatibleProvider";

describe("Agent cache item manifest", () => {
  it("locates the first prefix mismatch without retaining prompt, user, document, key or base64 bodies", () => {
    const firstInput: OpenAiCompatibleResponseRequest["input"] = [
      { role: "system", content: [{ type: "input_text", text: "SECRET_SYSTEM_PROMPT" }] },
      { role: "system", content: [{ type: "input_text", text: "runtime standard" }] },
      {
        role: "user",
        content: [{ type: "input_text", text: "PRIVATE_DOCUMENT_BODY" }]
      },
      {
        role: "user",
        content: [{ type: "input_image", image_url: "data:image/png;base64,VERY_SECRET_BASE64" }]
      }
    ];
    const secondInput: OpenAiCompatibleResponseRequest["input"] = [
      ...firstInput.slice(0, 2),
      { role: "user", content: [{ type: "input_text", text: "CHANGED_PRIVATE_BODY" }] }
    ];
    const previousManifest = buildAgentCacheItemManifest(firstInput);
    const currentManifest = buildAgentCacheItemManifest(secondInput);
    const diagnostics = compareAgentCacheManifests({
      previous: {
        promptContractVersion: "test",
        cacheItemManifest: previousManifest,
        toolsHash: hashAgentTools([]),
        summaryRevisionId: "summary-a"
      },
      current: {
        promptContractVersion: "test",
        cacheItemManifest: currentManifest,
        toolsHash: hashAgentTools([]),
        summaryRevisionId: "summary-b",
        budgetGeneration: 2
      }
    });
    const serialized = JSON.stringify({ previousManifest, currentManifest, diagnostics });

    expect(diagnostics).toMatchObject({
      commonPrefixItemCount: 2,
      firstMismatchKind: "userMessage",
      previousSummaryRevisionId: "summary-a",
      currentSummaryRevisionId: "summary-b",
      budgetGeneration: 2
    });
    expect(serialized).not.toContain("SECRET_SYSTEM_PROMPT");
    expect(serialized).not.toContain("PRIVATE_DOCUMENT_BODY");
    expect(serialized).not.toContain("VERY_SECRET_BASE64");
    expect(serialized).not.toContain("API_KEY");
  });

  it("detects a changed image body without persisting either base64 value", () => {
    const previous = buildAgentCacheItemManifest([{
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }]
    }]);
    const current = buildAgentCacheItemManifest([{
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/png;base64,BBBB" }]
    }]);
    const diagnostics = compareAgentCacheManifests({
      previous: { promptContractVersion: "test", cacheItemManifest: previous },
      current: { promptContractVersion: "test", cacheItemManifest: current }
    });

    expect(diagnostics).toMatchObject({ commonPrefixItemCount: 0, firstMismatchKind: "imageMessage" });
    expect(JSON.stringify({ previous, current })).not.toContain("AAAA");
    expect(JSON.stringify({ previous, current })).not.toContain("BBBB");
  });
});
