import { describe, expect, it } from "vitest";

import type { AiTaskMode, AiWorkIntent, MorphoObject } from "@/domain/morpho/types";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { buildAgentPolicyBlocks, MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import {
  buildRequiredAgentReadReminder,
  getMissingRequiredAgentReadTools,
  resolveAgentTaskStrategy,
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
