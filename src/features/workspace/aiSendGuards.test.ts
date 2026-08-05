import { describe, expect, it, vi } from "vitest";

import { createInitialWorkspace, hideObject } from "../../domain/morpho/workspace";
import {
  buildSameReplyStructuredWritePolicy,
  prepareAiSendBeforeProvider
} from "./aiSendGuards";

describe("workspace AI send guards", () => {
  it("suppresses compare, semantic patch, and decision entry when a comparison reply contains a proposal block", () => {
    const reply = [
      "Compare prose.",
      "```json",
      JSON.stringify({
        morphoConceptDirectionProposal: {
          title: "Unexpected direction proposal",
          summary: "Should block all same-reply structured writes.",
          directions: []
        }
      }),
      "```",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "decisionReason",
              scope: "project",
              evidenceQuote: "Compare prose.",
              relatedObjectIds: ["direction-soft-rail"]
            }
          ]
        }
      }),
      "```"
    ].join("\n");

    expect(buildSameReplyStructuredWritePolicy(reply, "comparison")).toEqual({
      hasBlockingProposalBlock: true,
      allowComparisonAnalysis: false,
      allowSemanticPatch: false,
      allowComparisonDecisionEntry: false
    });
  });

  it("allows structured writes for comparison replies without design or direction proposal blocks", () => {
    expect(buildSameReplyStructuredWritePolicy("Plain comparison response.", "comparison")).toEqual({
      hasBlockingProposalBlock: false,
      allowComparisonAnalysis: true,
      allowSemanticPatch: true,
      allowComparisonDecisionEntry: true
    });
  });

  it("blocks invalid comparison selections before provider calls or message append side effects", () => {
    const workspace = createInitialWorkspace();
    const providerFetch = vi.fn();
    const appendMessages = vi.fn();

    const preflight = prepareAiSendBeforeProvider({
      workspace,
      selectedObjectIds: ["direction-soft-rail"],
      executionWorkIntent: "comparison",
      draft: "compare this"
    });
    if (preflight.status === "ready") {
      appendMessages();
      providerFetch();
    }

    expect(preflight).toMatchObject({
      status: "blocked",
      aiOpen: true,
      aiDraft: "compare this"
    });
    expect(preflight.status === "blocked" ? preflight.contextWarning : "").toContain("Compare");
    expect(appendMessages).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("blocks hidden, missing, duplicate, oversized, and unparsed file comparison selections locally", () => {
    const workspace = createInitialWorkspace();
    const hiddenWorkspace = hideObject(workspace, "direction-soft-rail");
    const invalidSelections = [
      ["direction-soft-rail", "direction-soft-rail"],
      ["direction-soft-rail", "missing-id"],
      ["direction-soft-rail", "direction-support-island", "image-soft-rail-v2", "image-night-scenario", "image-cmf-board"],
      ["direction-soft-rail", "file-course-brief"]
    ];

    expect(
      prepareAiSendBeforeProvider({
        workspace: hiddenWorkspace,
        selectedObjectIds: ["direction-soft-rail", "direction-support-island"],
        executionWorkIntent: "comparison",
        draft: "compare"
      })
    ).toMatchObject({ status: "blocked" });

    for (const selectedObjectIds of invalidSelections) {
      expect(
        prepareAiSendBeforeProvider({
          workspace,
          selectedObjectIds,
          executionWorkIntent: "comparison",
          draft: "compare"
        })
      ).toMatchObject({ status: "blocked" });
    }
  });
});
