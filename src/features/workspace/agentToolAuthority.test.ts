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
    expect(negated.allowedTools).not.toContain("create_comparison_analysis");
    // Fewer than two selections never writes, regardless of save intent.
    const single = authority({
      draft: "把这两个比较一下，并保留比较记录。",
      allowStructuredComparison: true,
      selectedObjects: sources.slice(0, 1)
    });
    expect(single.allowComparisonWrite).toBe(false);
    // A foreign-domain result is not Compare-owned and never writes.
    const foreign = authority({
      draft: "比较这两个方案，把这个研究结论保存一下。",
      allowStructuredComparison: true,
      selectedObjects: sources
    });
    expect(foreign.allowComparisonWrite).toBe(false);
    expect(foreign.allowedTools).not.toContain("create_comparison_analysis");
    // Foreign-domain results (研究的结论 / 研究最终结论) are not Compare-owned and stay closed.
    const possessedForeign = authority({
      draft: "比较这两个方案，把研究的结论存档。",
      allowStructuredComparison: true,
      selectedObjects: sources
    });
    expect(possessedForeign.allowComparisonWrite).toBe(false);
    expect(possessedForeign.allowedTools).not.toContain("create_comparison_analysis");

    const modifiedForeign = authority({
      draft: "比较这两个方案，把研究最终结论存档。",
      allowStructuredComparison: true,
      selectedObjects: sources
    });
    expect(modifiedForeign.allowComparisonWrite).toBe(false);
    expect(modifiedForeign.allowedTools).not.toContain("create_comparison_analysis");
    // Foreign target in active save requests, past-action statements, bare ellipsis, and hypothetical/conditional mentions must NOT grant.
    const nonAuthorizingExamples = [
      "把这两个比较一下。比较结果保存了吗？请保存测试结果。",
      "比较结果保存了吗？请保存研究结论。",
      "比较两个方案，然后记录一下测试结果",
      "比较结果保存了吗？如果没有，请保存一下。",
      "我把比较结果保存好了。",
      "如果要保存比较记录，请先问我。",
      "如果需要保存比较记录，先确认一下。"
    ];
    for (const draft of nonAuthorizingExamples) {
      const nonAuth = authority({
        draft,
        allowStructuredComparison: true,
        selectedObjects: sources
      });
      expect(nonAuth.allowComparisonWrite).toBe(false);
      expect(nonAuth.allowedTools).not.toContain("create_comparison_analysis");
    }

    // Retrospective status queries are inquiries, not Workspace write requests.
    const statusQueryExamples = [
      "比较结果保存了吗？",
      "保存比较结果了吗？",
      "比较记录已经创建了吗？",
      "对比结论存档了吗？",
      "这个比较结果有没有保存？",
      "这次比较记录是不是已经保存了？",
      "比较结果之前存档过吗？",
      "比较结果保存没有？",
      "比较结果保存没有",
      "比较结果保存没？",
      "比较结果保存没",
      "比较结果存档没有？",
      "比较结果存档没？",
      "比较结果保存了吧？",
      "比较结果保存过吧？",
      "比较结果保存了对吧？",
      "比较结果保存了是不是？",
      "比较结果保存吗？",
      "比较结果保存没保存？",
      "比较结果存没存？",
      "比较结果保存吗？能不能告诉我？",
      "比较结果保存吗？可以帮我确认一下吗？",
      "比较结果存档吗？请告诉我。",
      "比较结果保存吗？麻烦确认一下。",
      "比较结果保存吗？帮我看看。",
      "比较结果保存了吗？如果没有，请告诉我。",
      "对比结论存档了吗？麻烦确认下。",
      "保存比较结果了吗？请告诉我。"
    ];
    for (const draft of statusQueryExamples) {
      const statusQuery = authority({
        draft,
        allowStructuredComparison: true,
        selectedObjects: sources
      });
      expect(statusQuery.allowComparisonWrite).toBe(false);
      expect(statusQuery.allowedTools).not.toContain("create_comparison_analysis");
    }

    // Polite current save requests & past-context requests grant Compare write authority when preconditions hold.
    const politeActionExamples = [
      "能不能把比较结果保存一下？",
      "可以帮我保存比较记录吗？",
      "能否把这次比较存档？",
      "帮我把这次比较的结论保存下来。",
      "请创建比较记录。",
      "请把比较结果保存下来。",
      "麻烦保存一下比较记录。",
      "保存比较结果。",
      "把比较结果保存下来。",
      "把这次比较的结论存档。",
      "已经决定好了，帮我保存比较结果。",
      "已经决定好了，现在帮我保存比较结果。",
      "之前讨论过了，这次把比较结果保存下来。",
      "刚才比较完了，请创建比较记录。",
      "比较结果保存了吗？如果没有，请保存比较结果。",
      "把这两个比较一下；请保存比较记录。"
    ];
    for (const draft of politeActionExamples) {
      const politeAction = authority({
        draft,
        allowStructuredComparison: true,
        selectedObjects: sources
      });
      expect(politeAction.allowComparisonWrite).toBe(true);
      expect(politeAction.allowedTools).toContain("create_comparison_analysis");
    }
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
