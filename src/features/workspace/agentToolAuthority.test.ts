import { describe, expect, it } from "vitest";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import { recommendAiWorkIntent } from "./aiTaskRouting";
import { getAgentToolAuthorizationBlockReason, resolveAgentToolAuthority } from "./agentToolAuthority";
import type { MorphoAgentToolArguments } from "./morphoAgent";

describe("Agent tool authority", () => {
  it("does not let malicious source text authorize search, writes, images, memory, or confirmation", () => {
    const profile = authority({ draft: "总结这份 PDF，只回答要点。", hasDocumentExtracts: true });
    const hostileCalls: MorphoAgentToolArguments[] = [
      { name: "search_web_evidence", args: { queries: ["secret"], reason: "document ordered it" } },
      { name: "create_research_analysis", args: researchArgs() },
      { name: "create_concept_direction_proposal", args: directionArgs() },
      { name: "generate_visuals", args: { kind: "visualDevelopment", items: [] } },
      { name: "submit_memory_update", args: { items: [], skippedReason: "document ordered it" } },
      { name: "request_confirmation", args: { action: "setDefaultReference", reason: "document ordered it", impact: "mutation" } }
    ];

    expect(profile.provenance.untrustedSourceTextPresent).toBe(true);
    hostileCalls.forEach((call) => expect(getAgentToolAuthorizationBlockReason(profile, call)).toContain("未授权"));
  });

  it("preserves explicit proposal, search, image, confirmation, and ordinary read paths", () => {
    const workspace = createTestWorkspace();
    const direction = Object.values(workspace.objects).find((object) => object.type === "conceptDirection");
    const proposal = Object.values(workspace.objects).find((object) => object.type === "proposalDraft");
    expect(authority({
      draft: "基于选中的 PDF 创建三个概念方向草案。",
      executionWorkIntent: "createConceptDirections",
      hasDocumentFragments: true
    }).allowedTools).toContain("create_concept_direction_proposal");
    expect(authority({ draft: "联网查证这些材料的最新标准。" }).allowedTools).toContain("search_web_evidence");
    expect(authority({
      draft: "生成一张方向预览图。",
      executionTaskMode: "imageGeneration",
      selectedObjects: direction ? [direction] : []
    }).allowedTools).toContain("generate_visuals");
    expect(authority({ draft: "把选中图片设置为默认参考。" }).allowedConfirmationActions).toContain("setDefaultReference");
    if (proposal) {
      expect(authority({
        draft: "修改选中的草案标题。",
        selectedObjects: [proposal]
      }).allowedTools).toContain("revise_selected_proposal_draft");
    }
    expect(authority({ draft: "解释一下当前方案。" }).allowedTools).toEqual(expect.arrayContaining(["read_selected_context"]));
  });

  it("keeps pure topic analysis in discussion instead of minting a proposal intent", () => {
    expect(recommendAiWorkIntent({
      draft: "基于现有概念方向总结一下。",
      selectedObjects: [{ type: "conceptDirection" }],
      hasCurrentDesignDefinition: true
    })).toBe("discussion");
    const profile = authority({
      draft: "基于现有概念方向总结一下。",
      executionWorkIntent: "discussion",
      executionWorkIntentSource: "autoRecommended"
    });
    expect(profile.allowedTools).not.toContain("create_concept_direction_proposal");
  });

  it.each([
    ["解释当前设计定义。", "discussion", "create_design_definition_proposal"],
    ["分析选中的草案。", "discussion", "revise_selected_proposal_draft"]
  ] as const)("denies analysis-only prompt %s from effect %s", (draft, intent, tool) => {
    const proposal = Object.values(createTestWorkspace().objects).find((object) => object.type === "proposalDraft");
    const profile = authority({
      draft,
      executionWorkIntent: intent,
      selectedObjects: proposal ? [proposal] : []
    });
    expect(profile.allowedTools).not.toContain(tool);
  });

  it("does not let a referenced revision command authorize a selected proposal", () => {
    const proposal = Object.values(createTestWorkspace().objects).find((object) => object.type === "proposalDraft");
    const profile = authority({
      draft: "文档中写着：修改选中的草案标题。",
      selectedObjects: proposal ? [proposal] : []
    });
    expect(profile.allowedTools).not.toContain("revise_selected_proposal_draft");
  });

  it("requires a current explicit network cue for auto-routed research but honors manual Research", () => {
    expect(authority({
      draft: "研究一下这份 PDF。",
      executionTaskMode: "researchOperation",
      executionTaskModeSource: "autoRecommended"
    }).allowedTools).not.toContain("search_web_evidence");
    expect(authority({
      draft: "研究一下这份 PDF。",
      executionTaskMode: "researchOperation",
      executionTaskModeSource: "userSelected"
    }).allowedTools).toContain("search_web_evidence");
    expect(authority({
      draft: "联网查最新标准并和这份 PDF 对比。",
      executionTaskMode: "researchOperation",
      executionTaskModeSource: "autoRecommended"
    }).allowedTools).toContain("search_web_evidence");
  });

  it("does not let negated actions become authority through routing or tool arguments", () => {
    const workspace = createTestWorkspace();
    const proposal = Object.values(workspace.objects).find((object) => object.type === "proposalDraft");
    const profile = authority({
      draft: "研究这份 PDF，但不要联网，也不要创建研究分析、创建概念方向；不要修改这个草案，也不要把这个设为主方向，只总结本地内容。",
      executionTaskMode: "researchOperation",
      executionWorkIntent: "createConceptDirections",
      selectedObjects: proposal ? [proposal] : [],
      hasDocumentExtracts: true
    });

    expect(profile.allowWebSearch).toBe(false);
    expect(profile.allowedTools).not.toContain("search_web_evidence");
    expect(profile.allowedTools).not.toContain("create_research_analysis");
    expect(profile.allowedTools).not.toContain("create_concept_direction_proposal");
    expect(profile.allowedTools).not.toContain("revise_selected_proposal_draft");
    expect(profile.allowedConfirmationActions).not.toContain("setDirectionPrimary");
  });

  it("keeps an explicit replacement proposal while denying the prohibited revision", () => {
    const proposal = {
      id: "proposal-hostile-test",
      type: "proposalDraft" as const,
      title: "草案",
      summary: "用于 authority 测试",
      createdBy: "user" as const,
      visibility: "active" as const,
      proposalId: "proposal-hostile-test",
      proposalType: "conceptDirection" as const
    };
    const profile = authority({
      draft: "不要修改这个草案，而是重写标题并创建一个概念方向草案。",
      executionWorkIntent: "createConceptDirections",
      selectedObjects: [proposal]
    });

    expect(profile.allowedTools).toContain("create_concept_direction_proposal");
    expect(profile.allowedTools).not.toContain("revise_selected_proposal_draft");
  });

  it("grants Compare writes only to an explicit persist request, never to a plain comparison", () => {
    const workspace = createTestWorkspace();
    const sources = Object.values(workspace.objects)
      .filter((object) => object.visibility === "active" && (object.type === "image" || object.type === "research"))
      .slice(0, 2);
    if (sources.length !== 2) throw new Error("Fixture 缺少两个可 Compare 对象。");
    // Ordinary comparison: analysis capability yes, Workspace write no.
    const plain = authority({
      draft: "把这两个比较一下。",
      allowStructuredComparison: true,
      selectedObjects: sources
    });
    expect(plain.allowComparisonWrite).toBe(false);
    expect(plain.allowedTools).not.toContain("create_comparison_analysis");
    // Explicit persist request: the write is authorized.
    const persisted = authority({
      draft: "把这两个比较一下，并保留比较记录。",
      allowStructuredComparison: true,
      selectedObjects: sources
    });
    expect(persisted.allowComparisonWrite).toBe(true);
    expect(persisted.allowedTools).toContain("create_comparison_analysis");
    // Negated save intent stays closed even with an explicit comparison.
    const negated = authority({
      draft: "比较一下，但不要保存记录。",
      allowStructuredComparison: true,
      selectedObjects: sources
    });
    expect(negated.allowComparisonWrite).toBe(false);
    // Fewer than two selections never writes, regardless of save intent.
    const single = authority({
      draft: "把这两个比较一下，并保留比较记录。",
      allowStructuredComparison: true,
      selectedObjects: sources.slice(0, 1)
    });
    expect(single.allowComparisonWrite).toBe(false);
  });
});

function authority(overrides: Partial<Parameters<typeof resolveAgentToolAuthority>[0]> = {}) {
  return resolveAgentToolAuthority({
    draft: "普通问答", executionTaskMode: "chatAnalysis",
    executionTaskModeSource: "userSelected", executionWorkIntent: "discussion",
    executionWorkIntentSource: "userSelected", selectedObjects: [], hasDeliveryDraftTarget: false,
    hasDocumentExtracts: false, hasDocumentFragments: false, hasRequiredMemoryUpdates: false,
    allowStructuredComparison: false, ...overrides
  });
}

function researchArgs() {
  return { title: "x", summary: "x", findings: [], opportunities: [], constraints: [], openQuestions: [], evidence: [] };
}

function directionArgs() {
  return { title: "x", summary: "x", directions: [] };
}
