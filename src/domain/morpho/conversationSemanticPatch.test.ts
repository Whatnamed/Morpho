import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "./workspace";
import {
  buildSemanticPatchAuthorization,
  buildSemanticPatchSummary,
  parseProjectContinuityPatchPayload,
  sanitizeAssistantStreamForDisplay,
  stripProjectContinuityPatchBlock,
  validateConversationSemanticPatch
} from "./conversationSemanticPatch";

const draft = "夜间识别感比造型复杂度更重要，后面不要做得太科技化。";

describe("conversation semantic patch", () => {
  it("parses allowed patch fields, ignores provider summary, and builds deterministic local summary", () => {
    const parsed = parseProjectContinuityPatchPayload([
      "好的，我会按这个方向继续。",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "preference",
              scope: "project",
              summary: "用户想要降低成本并保持温和。",
              evidenceQuote: "夜间识别感比造型复杂度更重要",
              relatedObjectIds: [],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            }
          ]
        }
      }),
      "```"
    ].join("\n"));

    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") {
      throw new Error(parsed.reason);
    }
    expect(parsed.items[0]).not.toHaveProperty("summary");
    expect(buildSemanticPatchSummary(parsed.items[0])).toBe("明确偏好：夜间识别感比造型复杂度更重要");
  });

  it("rejects the entire patch block when any item attempts state mutation", () => {
    const parsed = parseProjectContinuityPatchPayload([
      "收到。",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "preference",
              scope: "project",
              evidenceQuote: "夜间识别感比造型复杂度更重要",
              relatedObjectIds: [],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            },
            {
              kind: "decisionReason",
              scope: "direction",
              evidenceQuote: "后面不要做得太科技化",
              setDirectionPrimary: "direction-soft-rail",
              relatedObjectIds: ["direction-soft-rail"],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            }
          ]
        }
      }),
      "```"
    ].join("\n"));

    expect(parsed).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("invalid semantic patch item")
    });
  });

  it("rejects extra top-level or item fields except provider summary", () => {
    const extraTopLevel = parseProjectContinuityPatchPayload([
      "收到。",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "preference",
              scope: "project",
              evidenceQuote: "夜间识别感比造型复杂度更重要",
              relatedObjectIds: [],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            }
          ],
          rawProviderPayload: "must not be stored or accepted"
        }
      }),
      "```"
    ].join("\n"));
    const extraItemField = parseProjectContinuityPatchPayload([
      "收到。",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "preference",
              scope: "project",
              summary: "provider summary is ignored",
              evidenceQuote: "夜间识别感比造型复杂度更重要",
              relatedObjectIds: [],
              relatedRevisionIds: [],
              relatedDecisionIds: [],
              rawPayload: "must not be accepted"
            }
          ]
        }
      }),
      "```"
    ].join("\n"));

    expect(extraTopLevel).toMatchObject({ status: "failed", reason: expect.stringContaining("unexpected top-level") });
    expect(extraItemField).toMatchObject({ status: "failed", reason: expect.stringContaining("invalid semantic patch item") });
  });

  it("validates quote containment and rejects unauthorized workspace refs without scanning the full workspace", () => {
    const workspace = createInitialWorkspace();
    const authorization = buildSemanticPatchAuthorization({
      taskMode: "chatAnalysis",
      draft,
      userMessageId: "ai-user-1",
      userMessageCreatedAt: "2026-06-30T09:00:00.000Z",
      currentFocusArea: workspace.projectContinuity.currentFocus.area,
      objectIds: ["image-soft-rail-v2"],
      revisionIds: ["definition-revision-current-1"],
      decisionIds: []
    });

    const valid = validateConversationSemanticPatch(
      {
        kind: "avoidance",
        scope: "project",
        evidenceQuote: "后面不要做得太科技化",
        relatedObjectIds: [],
        relatedRevisionIds: [],
        relatedDecisionIds: []
      },
      authorization
    );
    const fabricatedQuote = validateConversationSemanticPatch(
      {
        kind: "constraint",
        scope: "project",
        evidenceQuote: "用户要求降低成本",
        relatedObjectIds: [],
        relatedRevisionIds: [],
        relatedDecisionIds: []
      },
      authorization
    );
    const unauthorizedRef = validateConversationSemanticPatch(
      {
        kind: "preference",
        scope: "visual",
        evidenceQuote: "夜间识别感比造型复杂度更重要",
        relatedObjectIds: ["direction-furniture-island"],
        relatedRevisionIds: [],
        relatedDecisionIds: []
      },
      authorization
    );

    expect(valid.status).toBe("ok");
    expect(fabricatedQuote).toMatchObject({ status: "failed", reason: expect.stringContaining("evidenceQuote") });
    expect(unauthorizedRef).toMatchObject({ status: "failed", reason: expect.stringContaining("unauthorized object") });
  });

  it("requires real authorized decision refs for decision and rejection reasons", () => {
    const workspace = createInitialWorkspace();
    const authorization = buildSemanticPatchAuthorization({
      taskMode: "chatAnalysis",
      draft: "淘汰原因是它太像医疗器械。",
      userMessageId: "ai-user-decision-reason",
      userMessageCreatedAt: "2026-06-30T09:02:00.000Z",
      currentFocusArea: workspace.projectContinuity.currentFocus.area,
      objectIds: ["direction-soft-rail"],
      revisionIds: [],
      decisionIds: []
    });

    const objectOnly = validateConversationSemanticPatch(
      {
        kind: "rejectionReason",
        scope: "direction",
        evidenceQuote: "它太像医疗器械",
        relatedObjectIds: ["direction-soft-rail"],
        relatedRevisionIds: [],
        relatedDecisionIds: []
      },
      authorization
    );

    expect(objectOnly).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("requires an authorized decision source")
    });
  });

  it("does not write semantic entries when the same assistant reply contains a pending proposal block", () => {
    const workspace = createInitialWorkspace();
    const authorization = buildSemanticPatchAuthorization({
      taskMode: "chatAnalysis",
      draft,
      userMessageId: "ai-user-2",
      userMessageCreatedAt: "2026-06-30T09:01:00.000Z",
      currentFocusArea: workspace.projectContinuity.currentFocus.area,
      objectIds: [],
      revisionIds: [],
      decisionIds: []
    });
    const reply = [
      "我先给你一个草案。",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "preference",
              scope: "project",
              evidenceQuote: "夜间识别感比造型复杂度更重要",
              relatedObjectIds: [],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            }
          ]
        }
      }),
      "```",
      "```json",
      JSON.stringify({
        morphoDesignDefinitionProposal: {
          title: "定义草案",
          summary: "草案",
          projectGoal: "目标",
          coreProblem: "问题",
          designPrinciples: ["原则"]
        }
      }),
      "```"
    ].join("\n");
    const parsed = parseProjectContinuityPatchPayload(reply);

    expect(parsed.status).toBe("blockedByProposal");
    expect(validateConversationSemanticPatch(
      {
        kind: "preference",
        scope: "project",
        evidenceQuote: "夜间识别感比造型复杂度更重要",
        relatedObjectIds: [],
        relatedRevisionIds: [],
        relatedDecisionIds: []
      },
      authorization
    ).status).toBe("ok");
  });

  it("does not block semantic patches when the same reply contains a research proposal block", () => {
    const reply = [
      "研究结果如下。",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "constraint",
              scope: "project",
              evidenceQuote: "后面不要做得太科技化",
              relatedObjectIds: [],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            }
          ]
        }
      }),
      "```",
      "```json",
      JSON.stringify({
        morphoResearchProposal: {
          title: "研究草案",
          summary: "摘要",
          findings: ["发现"],
          opportunities: [],
          constraints: [],
          openQuestions: [],
          evidence: []
        }
      }),
      "```"
    ].join("\n");

    expect(parseProjectContinuityPatchPayload(reply)).toMatchObject({ status: "ok" });
  });

  it("allows research proposals to coexist with semantic patches while still suppressing design and direction proposals", () => {
    const researchReply = [
      "研究结果如下。",
      "```json",
      JSON.stringify({
        morphoResearchProposal: {
          title: "研究草案",
          summary: "摘要",
          findings: ["发现"],
          opportunities: [],
          constraints: [],
          openQuestions: [],
          evidence: []
        }
      }),
      "```",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "constraint",
              scope: "project",
              evidenceQuote: "后面不要做得太科技化",
              relatedObjectIds: [],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            }
          ]
        }
      }),
      "```"
    ].join("\n");
    const designReply = researchReply.replace("morphoResearchProposal", "morphoDesignDefinitionProposal");
    const directionReply = researchReply.replace("morphoResearchProposal", "morphoConceptDirectionProposal");

    expect(parseProjectContinuityPatchPayload(researchReply)).toMatchObject({ status: "ok" });
    expect(parseProjectContinuityPatchPayload(designReply)).toMatchObject({ status: "blockedByProposal" });
    expect(parseProjectContinuityPatchPayload(directionReply)).toMatchObject({ status: "blockedByProposal" });
  });

  it("hides complete and trailing semantic patch blocks during streaming without removing ordinary JSON", () => {
    const semanticPrefix = [
      "普通说明会继续显示。",
      "```json",
      '{"morphoProjectContinuityPatch":{"items":[{"kind":"preference"'
    ].join("\n");
    const completeSemantic = [
      semanticPrefix,
      ',"scope":"project","evidenceQuote":"夜间识别感比造型复杂度更重要","relatedObjectIds":[],"relatedRevisionIds":[],"relatedDecisionIds":[]}]}}',
      "```",
      "后续说明。"
    ].join("\n");
    const ordinaryJson = [
      "普通说明。",
      "```json",
      JSON.stringify({ morphoResearchProposal: { title: "研究", summary: "摘要", findings: ["发现"] } }),
      "```"
    ].join("\n");

    expect(sanitizeAssistantStreamForDisplay(semanticPrefix)).toBe("普通说明会继续显示。");
    expect(sanitizeAssistantStreamForDisplay(semanticPrefix)).not.toContain("morphoProjectContinuityPatch");
    expect(sanitizeAssistantStreamForDisplay(completeSemantic)).toBe("普通说明会继续显示。\n\n后续说明。");
    expect(sanitizeAssistantStreamForDisplay(ordinaryJson)).toContain("morphoResearchProposal");
    expect(stripProjectContinuityPatchBlock(ordinaryJson)).toContain("morphoResearchProposal");
  });

  it("strips a closed malformed semantic patch block from final visible text", () => {
    const reply = [
      "Visible explanation remains.",
      "```json",
      '{"morphoProjectContinuityPatch": invalid}',
      "```"
    ].join("\n");

    const stripped = stripProjectContinuityPatchBlock(reply);

    expect(stripped).toBe("Visible explanation remains.");
    expect(sanitizeAssistantStreamForDisplay(reply)).toBe("Visible explanation remains.");
    expect(stripped).not.toContain("morphoProjectContinuityPatch");
  });

  it("preserves prose around a closed malformed semantic patch block", () => {
    const reply = [
      "Before the technical block.",
      "```json",
      '{"morphoProjectContinuityPatch":{"items":[',
      "```",
      "After the technical block."
    ].join("\n");

    const stripped = stripProjectContinuityPatchBlock(reply);

    expect(stripped).toBe("Before the technical block.\n\nAfter the technical block.");
    expect(stripped).not.toContain("morphoProjectContinuityPatch");
  });

  it("strips only project-continuity JSON while preserving user-visible prose and other structured blocks", () => {
    const reply = [
      "已记录你的偏好。",
      "```json",
      JSON.stringify({ morphoProjectContinuityPatch: { items: [] } }),
      "```",
      "```json",
      JSON.stringify({ morphoResearchProposal: { title: "研究", summary: "摘要", findings: ["发现"] } }),
      "```"
    ].join("\n");

    const stripped = stripProjectContinuityPatchBlock(reply);

    expect(stripped).toContain("已记录你的偏好。");
    expect(stripped).not.toContain("morphoProjectContinuityPatch");
    expect(stripped).toContain("morphoResearchProposal");
  });
});
