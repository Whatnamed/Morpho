import { describe, expect, it } from "vitest";

import type { AiTaskMode, AiWorkIntent, MorphoObject } from "@/domain/morpho/types";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { buildAgentPolicyBlocks, MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import {
  advanceRequiredAgentReadState,
  buildRequiredAgentReadReminder,
  buildRequiredAgentReadFailureNotice,
  completeRequiredAgentRead,
  createRequiredAgentReadState,
  failRequiredAgentRead,
  getMissingRequiredAgentReadTools,
  resolveAgentReadIntent,
  resolveAgentTaskStrategy,
  resolveRequiredAgentReadRequirements,
  validateRequiredAgentReadCall,
  resolveRequiredAgentReadTools
} from "./agentTaskStrategy";

describe("Agent task strategy and prompt registry", () => {
  const workspace = createInitialWorkspace();

  it.each([
    ["historyAndMemory", "你还记得最早的对话吗？", "chatAnalysis", "discussion", []],
    ["research", "请查证竞品的夜间照明方案", "researchOperation", "discussion", []],
    ["designDefinition", "修订设计定义里的核心问题", "chatAnalysis", "reviseDesignDefinition", []],
    ["conceptDirection", "把当前概念方向拆成两个", "chatAnalysis", "splitConceptDirection", []],
    ["comparison", "对比这两个对象", "chatAnalysis", "comparison", [object("image-soft-rail-v2")]],
    ["deliveryPreparation", "生成本节说明", "chatAnalysis", "prepareDeliverySection", []],
    ["directionPreview", "为四个方向各生成 3 张预览", "imageGeneration", "discussion", []],
    ["visualDevelopment", "生成一张 CMF 研究图", "imageGeneration", "discussion", [object("image-soft-rail-v2")]],
    ["discussion", "我们先聊聊下一步", "chatAnalysis", "discussion", []]
  ] as const)("resolves %s from explicit mode, intent, objects, state, and user input", (
    expected,
    draft,
    taskMode,
    workIntent,
    selectedObjects
  ) => {
    expect(resolve({ draft, taskMode, workIntent, selectedObjects })).toMatchObject({ kind: expected });
  });

  it("does not route a negated comparison request into comparison", () => {
    expect(resolve({ draft: "不要比较，继续讨论", selectedObjects: [object("image-soft-rail-v2")] })).toMatchObject({
      kind: "discussion"
    });
  });

  it("does not route explicitly negated proposal actions into proposal strategies", () => {
    expect(resolve({
      draft: "不要形成设计定义，只总结当前结论。",
      workIntent: "discussion"
    })).toMatchObject({ kind: "discussion" });
    expect(resolve({
      draft: "不要创建概念方向，只分析这些材料。",
      workIntent: "discussion"
    })).toMatchObject({ kind: "discussion" });
  });

  it("uses current project direction and default reference when selection is empty", () => {
    expect(resolve({ draft: "给当前方向生成预览", taskMode: "imageGeneration" })).toMatchObject({
      kind: "directionPreview",
      contextKind: "directionPreview"
    });
    const withoutDirection = {
      ...workspace,
      workingState: {
        ...workspace.workingState,
        primaryDirectionId: undefined,
        alternativeDirectionIds: []
      }
    };
    expect(
      resolveAgentTaskStrategy({
        draft: "继续生成细节图",
        taskMode: "imageGeneration",
        workIntent: "discussion",
        selectedObjects: [],
        workspace: withoutDirection
      })
    ).toMatchObject({ kind: "visualDevelopment" });
  });

  it("assembles one versioned, non-contradictory policy contract for every strategy", () => {
    const strategies = [
      "discussion",
      "research",
      "designDefinition",
      "conceptDirection",
      "directionPreview",
      "visualDevelopment",
      "comparison",
      "deliveryPreparation",
      "historyAndMemory"
    ] as const;

    for (const strategy of strategies) {
      const blocks = buildAgentPolicyBlocks(strategy);
      expect(blocks.filter((block) => block.includes(MORPHO_AGENT_PROMPT_CONTRACT_VERSION))).toHaveLength(1);
      expect(blocks.join("\n")).toContain("只能通过工具写入项目");
      expect(blocks.join("\n")).not.toMatch(/AI不能写项目记忆|AI 不能写项目记忆/);
    }
  });

  it("blocks source-free final answers for explicit history, memory, and progress questions", () => {
    const required = resolveRequiredAgentReadTools("你还记得最早的对话和现在项目进度吗？");
    expect(required).toEqual([
      "search_project_conversation",
      "read_project_memory",
      "read_stage_record"
    ]);
    const completed = new Set(["read_project_memory"] as const);
    const missing = getMissingRequiredAgentReadTools(required, completed);

    expect(missing).toEqual(["search_project_conversation", "read_stage_record"]);
    expect(buildRequiredAgentReadReminder(missing)).toContain("不得断言没有、不存在或未记录");
  });

  it("bounds required reads to one reminder and one failed retry", () => {
    let state = createRequiredAgentReadState(["read_project_memory"]);
    const reminder = advanceRequiredAgentReadState(state);
    expect(reminder.action).toBe("remind");
    state = reminder.state;
    const exhaustedWithoutCall = advanceRequiredAgentReadState(state);
    expect(exhaustedWithoutCall.action).toBe("exhausted");

    state = createRequiredAgentReadState(["read_stage_record"]);
    const firstFailure = failRequiredAgentRead(state, "read_stage_record");
    expect(firstFailure.retry).toBe(true);
    const secondFailure = failRequiredAgentRead(firstFailure.state, "read_stage_record");
    expect(secondFailure.retry).toBe(false);
    expect(secondFailure.state.exhausted).toBe(true);
    expect(buildRequiredAgentReadFailureNotice(secondFailure.state)).toContain("读取失败，无法确认");
    expect(
      completeRequiredAgentRead(firstFailure.state, "read_stage_record").completedTools.has("read_stage_record")
    ).toBe(true);
  });

  it("does not require memory reads for a conversation-history-only question", () => {
    expect(resolveRequiredAgentReadTools("你还记得最早的对话是什么吗？")).toEqual([
      "search_project_conversation"
    ]);
  });

  it("requires current memory and stage reads for the reported project-progress question", () => {
    expect(
      resolveRequiredAgentReadTools(
        "你看看项目记忆和阶段记录，告诉我项目现在做到哪了、已经形成了哪些稳定决定、还有哪些问题没解决"
      )
    ).toEqual(["read_project_memory", "read_stage_record"]);
  });

  it("requires structured memory keys, stages, and conversation query semantics", () => {
    expect(resolveRequiredAgentReadRequirements(
      "你记得我喜欢什么、之前说过不要什么，还有哪些开放问题？"
    )).toEqual([
      {
        tool: "read_project_memory",
        requiredKeys: ["userPreferences", "openQuestions"]
      }
    ]);
    expect(resolveRequiredAgentReadRequirements(
      "调研阶段得出了什么，方向阶段当前状态如何？"
    )).toEqual([
      {
        tool: "read_project_memory",
        requiredKeys: ["projectOverview"]
      },
      {
        tool: "read_stage_record",
        requiredStages: ["research", "directionAndVisual"]
      }
    ]);
    expect(resolveRequiredAgentReadRequirements("第一次提到海洋浮标是什么时候？")).toEqual([
      {
        tool: "search_project_conversation",
        requiredMode: "keyword",
        keyword: "海洋浮标"
      }
    ]);
  });

  it("does not complete a required read when the tool arguments miss its scope", () => {
    const requirements = resolveRequiredAgentReadRequirements(
      "你记得我喜欢什么、之前说过不要什么，还有哪些开放问题？"
    );
    const state = createRequiredAgentReadState(requirements);

    expect(validateRequiredAgentReadCall(state, "read_project_memory", {
      keys: ["userPreferences"]
    })).toMatchObject({
      satisfied: false,
      reason: expect.stringContaining("openQuestions")
    });
    expect(validateRequiredAgentReadCall(state, "read_project_memory", {
      keys: ["userPreferences", "openQuestions"]
    })).toMatchObject({ satisfied: true });
  });

  it("expands history, memory, and stage phrases without routing selected-object revisions to chat history", () => {
    expect(resolveRequiredAgentReadTools("项目是怎么开始的，经历过哪些变化？")).toEqual(["search_project_conversation"]);
    expect(resolveRequiredAgentReadTools("你记得我喜欢什么，之前说过不要什么？")).toEqual(["read_project_memory"]);
    expect(resolveRequiredAgentReadTools("当前项目进度如何，接下来要做什么？")).toEqual([
      "read_project_memory",
      "read_stage_record"
    ]);
    expect(resolveAgentReadIntent("看一下上一版为什么这样做", { hasSelectedObject: true })).toMatchObject({
      history: false,
      objectRevision: true
    });
    expect(
      resolve({
        draft: "看一下上一版为什么这样做",
        selectedObjects: [object("image-soft-rail-v2")]
      })
    ).toMatchObject({ kind: "discussion" });
  });

  function object(id: string): MorphoObject {
    const candidate = workspace.objects[id];
    if (!candidate) {
      throw new Error(`Missing object fixture ${id}.`);
    }
    return candidate;
  }

  function resolve(input: {
    draft: string;
    taskMode?: AiTaskMode;
    workIntent?: AiWorkIntent;
    selectedObjects?: readonly MorphoObject[];
  }) {
    return resolveAgentTaskStrategy({
      draft: input.draft,
      taskMode: input.taskMode ?? "chatAnalysis",
      workIntent: input.workIntent ?? "discussion",
      selectedObjects: input.selectedObjects ?? [],
      workspace
    });
  }
});
