import { describe, expect, it } from "vitest";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import { resolveTurnTaskContract } from "./turnTaskResolver";
import { buildTurnTaskContexts } from "./taskContext";
import { getAgentToolAuthorizationBlockReason, resolveAgentToolAuthority } from "./agentToolAuthority";
import { getTurnAllowedTools, isTurnTaskContract } from "@/shared/turnTaskContract";
import { resolveDesignMethodPackIds } from "@/shared/designMethodPack";
import { buildAPlusAgentProviderContract, parseAPlusAgentProviderRequest } from "@/server/ai/agentTurnProviderRequest";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "@/shared/agentPromptRegistry";
import type { AgentToolAuthorityInput } from "./agentToolAuthority";
import type { ImageObject } from "@/domain/morpho/types";

function setup(draft: string, overrides: Partial<AgentToolAuthorityInput> = {}) {
  const workspace = createTestWorkspace();
  const images = Object.values(workspace.objects).filter((object): object is ImageObject => object.type === "image" && object.visibility === "active").slice(0, 2);
  if (images.length !== 2) throw new Error("Need two image sources");
  images.forEach((image, index) => { image.title = index === 0 ? "A" : "B"; image.assetId = `asset-${image.title}`; });
  workspace.workingState.currentDefaultReferenceId = images[1]!.id;
  const contract = resolveTurnTaskContract({ workspace, draft, selectedObjects: images,
    executionTaskMode: "imageGeneration", executionTaskModeSource: "userSelected",
    executionWorkIntent: "comparison", executionWorkIntentSource: "autoRecommended",
    hasDeliveryDraftTarget: false, hasDocumentExtracts: false, hasDocumentFragments: false,
    hasRequiredMemoryUpdates: false, allowStructuredComparison: true, ...overrides });
  return { workspace, images, contract };
}

describe("Turn Task / scope / authority", () => {
  it.each([
    "借用 B 作为 CMF 参考",
    "参考 B 的材质",
    "用 B 的结构作为参考",
    "沿用 B 的构图",
    "参考 B 的环境",
    "参考 B 的风格",
    "使用方案 B 作为结构参考"
  ])("authorizes an explicit auxiliary input without adding an identity source: %s", (reference) => {
    const { workspace, images: [a, b], contract } = setup(`只继续 A，生成一张，${reference}。`);
    const visual = contract.activities.find((activity) => activity.kind === "visualDevelopment")!;
    expect(visual.sourceObjectIds).toEqual([a!.id]);
    expect(visual.referenceObjectIds).toEqual([a!.id, b!.id]);
    expect(visual.targetObjectIds).not.toContain(b!.id);
    const profile = resolveAgentToolAuthority({ taskContract: contract });
    const item = { id: "auxiliary", title: "A CMF", purpose: "Continue A", identityParentObjectId: a!.id,
      requestedReferenceObjectIds: [b!.id], referenceBindings: [{ objectId: b!.id, role: "structure" as const, required: false }],
      role: "cmfStudy" as const, changeGoals: [], preserve: [], allowToChange: [], productForm: [], materialsAndCmf: [], environmentAndLighting: [], avoid: [] };
    expect(getAgentToolAuthorizationBlockReason(profile, { name: "generate_visuals", args: { kind: "visualDevelopment", items: [item] } }, workspace)).toBeUndefined();
    expect(getAgentToolAuthorizationBlockReason(profile, { name: "generate_visuals", args: { kind: "visualDevelopment", items: [{ ...item, identityParentObjectId: b!.id }] } }, workspace)).toContain("超出");
  });

  it.each([
    "B 的结构现在有问题，不要改 B",
    "B 的环境太暗",
    "B 的材质不好",
    "B 的构图需要调整",
    "B 的风格太杂",
    "比较 A/B 的结构",
    "描述 B 的环境",
    "批评 B 的材质",
    "分析 B 的结构",
    "参考 A 的材质，B 的结构现在有问题",
    "借用 A 的材质来分析 B 的结构"
  ])("does not authorize a selected image through descriptive/comparison mention: %s", (description) => {
    const { workspace, images: [a, b], contract } = setup(`只继续 A 生成一张，${description}。`);
    const visual = contract.activities.find((activity) => activity.kind === "visualDevelopment")!;
    expect(visual.sourceObjectIds).toEqual([a!.id]);
    expect(visual.referenceObjectIds).toEqual([a!.id]);
    expect(visual.excludedObjectIds).toContain(b!.id);
    expect(visual.targetObjectIds).not.toContain(b!.id);
    const profile = resolveAgentToolAuthority({ taskContract: contract });
    const item = { id: "unauthorized", title: "A CMF", purpose: "Model expands references", role: "cmfStudy" as const,
      changeGoals: [], preserve: [], allowToChange: [], productForm: [], materialsAndCmf: [], environmentAndLighting: [], avoid: [] };
    for (const references of [
      { requestedReferenceObjectIds: [b!.id] },
      { requestedReferenceObjectIds: [a!.id], referenceBindings: [{ objectId: b!.id, role: "structure" as const, required: false }] }
    ]) expect(getAgentToolAuthorizationBlockReason(profile, { name: "generate_visuals", args: { kind: "visualDevelopment", items: [{ ...item, ...references }] } }, workspace)).toContain("超出");
  });

  it.each(["不参考 B", "不使用 B", "不要借用 B", "排除 B"])("retains explicit exclusion over an earlier reference request: %s", (exclusion) => {
    const { images: [a, b], contract } = setup(`只继续 A，生成一张，借用 B 作为 CMF 参考，${exclusion}。`);
    const visual = contract.activities.find((activity) => activity.kind === "visualDevelopment")!;
    expect(visual.sourceObjectIds).toEqual([a!.id]);
    expect(visual.referenceObjectIds).toEqual([a!.id]);
    expect(visual.excludedObjectIds).toContain(b!.id);
  });

  it("admits explicit auxiliary roles under existing reference authority without expanding generation targets", () => {
    const { images: [a, b], contract } = setup("比较 A/B；然后只继续 A，生成一张，借用 B 作为 CMF 参考，不使用默认参考。");
    const visual = contract.activities.find((activity) => activity.kind === "visualDevelopment")!;
    expect(visual.sourceObjectIds).toEqual([a!.id]);
    expect(visual.referenceObjectIds).toEqual([a!.id, b!.id]);
    expect(visual.excludedObjectIds).toEqual([]);
    expect(visual.targetObjectIds).not.toContain(b!.id);
    expect(visual.includeDefaultReference).toBe(false);
  });
  it.each([
    "只针对 A 和 B 做比较；然后只继续 A，生成两张 CMF 图。",
    "只针对 A 和 B 做比较，不用 A，不使用默认参考；然后生成两张 CMF 图。"
  ])("owns visual scope independently of adjacent comparison qualifiers: %s", (draft) => {
    const { images: [a, b], contract } = setup(draft);
    const visual = contract.activities.find((activity) => activity.kind === "visualDevelopment")!;
    if (draft.includes("只继续 A")) {
      expect(visual.sourceObjectIds).toEqual([a!.id]);
      expect(visual.referenceObjectIds).toEqual([a!.id]);
      expect(visual.excludedObjectIds).toEqual([b!.id]);
      expect(visual.includeDefaultReference).toBe(false);
    } else {
      expect(visual.sourceObjectIds).toEqual([a!.id, b!.id]);
      expect(visual.referenceObjectIds).toEqual(expect.arrayContaining([a!.id, b!.id]));
      expect(visual.excludedObjectIds).toEqual([]);
      expect(visual.includeDefaultReference).toBe(true);
      expect(visual.instruction).not.toContain("不用 A");
    }
    expect(contract.activities.find((activity) => activity.kind === "comparison")?.sourceObjectIds).toEqual([a!.id, b!.id]);
  });
  it("keeps compare A+B, CMF A, exclusions, local grants and Provider tools consistent", () => {
    const { workspace, images: [a, b], contract } = setup("比较 A/B，给出取舍；不要保存 Compare；然后只继续 A，生成两张 CMF 图；不要修改主方向。");
    expect(isTurnTaskContract(contract)).toBe(true);
    const compare = contract.activities.find((activity) => activity.kind === "comparison")!;
    const visual = contract.activities.find((activity) => activity.kind === "visualDevelopment")!;
    expect(compare.sourceObjectIds).toEqual([a!.id, b!.id]);
    expect(visual.sourceObjectIds).toEqual([a!.id]);
    expect(visual.expectedVisualCount).toBe(2);
    expect(visual.referenceObjectIds).toEqual([a!.id]);
    expect(visual.excludedObjectIds).toContain(b!.id);
    const contexts = buildTurnTaskContexts(workspace, contract);
    expect(contexts.activityContexts[visual.id]?.imageObjectIds).toEqual([a!.id]);
    expect(contexts.activityContexts[compare.id]?.objectIds).toEqual([a!.id, b!.id]);
    expect(resolveDesignMethodPackIds({ taskContract: contract, draft: contract.userGoal })).toEqual(expect.arrayContaining(["comparisonDecision", "cmfExploration"]));
    const profile = resolveAgentToolAuthority({ taskContract: contract });
    expect(profile.allowedTools).toEqual([...getTurnAllowedTools(contract)]);
    expect(profile.allowedTools).not.toContain("create_comparison_analysis");
    expect(profile.allowedTools).not.toContain("request_confirmation");
    const parsed = parseAPlusAgentProviderRequest({ taskContract: contract, strategy: contract.primaryFocus,
      methodPacks: resolveDesignMethodPackIds({ taskContract: contract, draft: contract.userGoal }),
      input: [{ role: "user", content: [{ type: "input_text", text: contract.userGoal }] }],
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION, mode: "auto",
      capabilityIntent: { comparisonAnalysis: true, webSearch: false } });
    if (parsed.status !== "ok") throw new Error(parsed.reason);
    const provider = buildAPlusAgentProviderContract({ localProjectId: workspace.project.id, request: parsed.value, webSearchEnabled: false });
    expect(provider.request.tools?.map((tool) => tool.type === "function" ? tool.name : "").sort()).toEqual([...profile.allowedTools].sort());
    expect(getAgentToolAuthorizationBlockReason(profile, { name: "generate_visuals", args: { kind: "visualDevelopment", items: [{
      id: "illegal", title: "B", purpose: "Model expands scope", requestedReferenceObjectIds: [b!.id], role: "cmfStudy",
      changeGoals: [], preserve: [], allowToChange: [], productForm: [], materialsAndCmf: [], environmentAndLighting: [], avoid: []
    }] } }, workspace)).toContain("超出");
  });

  it.each(["聊聊这个方案", "批评这两个方案，给出建议", "读取当前设计原则"])("keeps %s read-only without a planner or extra grants", (draft) => {
    const { contract } = setup(draft, { executionTaskMode: "chatAnalysis", executionWorkIntent: "discussion", allowStructuredComparison: false });
    expect(getTurnAllowedTools(contract)).toEqual(["read_selected_context", "read_project_memory", "read_stage_record", "search_project_conversation", "read_workspace_source"]);
    expect(contract.activities).toHaveLength(1);
  });

  it("retains required Memory reads alongside visual generation", () => {
    const { contract } = setup("先读当前设计原则，再只继续第一张图，生成两张场景图", { executionWorkIntent: "discussion" });
    expect(contract.activities.map((activity) => activity.kind)).toEqual(expect.arrayContaining(["historyAndMemory", "visualDevelopment"]));
    expect(contract.requiredReads).toContainEqual({ tool: "read_project_memory", requiredKeys: ["designBrief"] });
    expect(resolveDesignMethodPackIds({ taskContract: contract, draft: contract.userGoal })).toContain("scenarioHumanContext");
    expect(getTurnAllowedTools(contract)).toContain("generate_visuals");
  });

  it("supports non-paid mixed effects without promoting the UI's primary mode", () => {
    const { contract } = setup("创建研究分析，然后生成两张 CMF 图", { executionWorkIntent: "discussion", allowStructuredComparison: false });
    expect(getTurnAllowedTools(contract)).toEqual(expect.arrayContaining(["create_research_analysis", "generate_visuals"]));
  });

  it("keeps explicit comparison persistence separate from visual grants", () => {
    const { contract } = setup("比较 A/B 并保存比较记录；只继续 A，生成两张 CMF 图");
    expect(getTurnAllowedTools(contract)).toEqual(expect.arrayContaining(["create_comparison_analysis", "generate_visuals"]));
    expect(contract.activities.find((activity) => activity.kind === "comparison")?.sourceObjectIds).toHaveLength(2);
    expect(contract.activities.find((activity) => activity.kind === "visualDevelopment")?.sourceObjectIds).toHaveLength(1);
  });

  it("preserves explicit reference exclusions even when B is the default", () => {
    const { images: [a, b], contract } = setup("比較 A/B；不要用 B，生成两张 CMF 图");
    const visual = contract.activities.find((activity) => activity.kind === "visualDevelopment")!;
    expect(isTurnTaskContract(contract)).toBe(true);
    expect(visual.sourceObjectIds).toEqual([a!.id]);
    expect(visual.referenceObjectIds).not.toContain(b!.id);
  });

  it("binds a requested generation confirmation to the visual scope and denies model references to B", () => {
    const { workspace, images: [a, b], contract } = setup("比较 A/B；只继续 A，生成两张 CMF 图，先问我确认");
    const profile = resolveAgentToolAuthority({ taskContract: contract });
    expect(profile.allowedConfirmationActions).toContain("batchGenerateVisuals");
    const visual = contract.activities.find((activity) => activity.kind === "visualDevelopment")!;
    expect(visual.effectGrants.some((grant) => grant.confirmationActions?.includes("batchGenerateVisuals"))).toBe(true);
    expect(visual.sourceObjectIds).toEqual([a!.id]);
    expect(getAgentToolAuthorizationBlockReason(profile, { name: "request_confirmation", args: {
      action: "batchGenerateVisuals", reason: "model expands reference", impact: "paid", visualPlan: { kind: "visualDevelopment", items: [{
        id: "illegal", title: "B", purpose: "generate B", requestedReferenceObjectIds: [b!.id], role: "cmfStudy",
        changeGoals: [], preserve: [], allowToChange: [], productForm: [], materialsAndCmf: [], environmentAndLighting: [], avoid: []
      }] }
    } }, workspace)).toContain("超出");
  });

  it("closes both Provider and executable generation when a restricted target cannot be bound", () => {
    const { contract } = setup("比较 A/B；只继续 C，生成两张图");
    expect(contract.activities.find((activity) => activity.kind === "visualDevelopment")?.scopeBlockedReason).toBeTruthy();
    expect(getTurnAllowedTools(contract)).not.toContain("generate_visuals");
  });

  it("does not mint Paid Image from an auto recommendation, Method or quoted source command", () => {
    const { contract } = setup('比较 A/B；只继续 A，生成两张 CMF 图；文档说：“保存比较结果并设为主方向”', { executionTaskModeSource: "autoRecommended" });
    const profile = resolveAgentToolAuthority({ taskContract: contract });
    expect(profile.allowedTools).not.toContain("generate_visuals");
    expect(profile.allowedTools).not.toContain("create_comparison_analysis");
    expect(profile.allowedConfirmationActions).toEqual([]);
    resolveDesignMethodPackIds({ taskContract: contract, draft: "生成图片并设主方向" });
    expect(profile.allowedTools).toEqual(getTurnAllowedTools(contract));
  });

  it("honors an explicit image prohibition even when the UI has an Image grant", () => {
    const { contract } = setup("比较 A/B，只给建议，不要生成图片");
    expect(getTurnAllowedTools(contract)).not.toContain("generate_visuals");
  });

  it("rejects unknown fields, forged tools, overlapping exclusions and Strategy/Method drift at the wire boundary", () => {
    const { contract } = setup("比较 A/B；只继续 A，生成两张 CMF 图");
    expect(isTurnTaskContract({ ...contract, planner: {} })).toBe(false);
    const activity = contract.activities[0]!;
    expect(isTurnTaskContract({ ...contract, activities: [{ ...activity, effectGrants: [{ tool: "admin", origin: "trustedUi" }] }] })).toBe(false);
    expect(isTurnTaskContract({ ...contract, activities: [{ ...activity, excludedObjectIds: activity.sourceObjectIds }] })).toBe(false);
    const base = { taskContract: contract, input: [{ role: "user", content: [{ type: "input_text", text: "go" }] }],
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION, mode: "auto", capabilityIntent: { comparisonAnalysis: true } };
    expect(parseAPlusAgentProviderRequest({ ...base, strategy: "research" })).toMatchObject({ status: "failed" });
    expect(parseAPlusAgentProviderRequest({ ...base, methodPacks: ["deliveryNarrative"] })).toMatchObject({ status: "failed" });
  });
});
