import { describe, expect, it } from "vitest";

import { recordDesignDefinitionProposal } from "../../../domain/operations/operations";
import { createInitialWorkspace } from "../../../domain/morpho/workspace";

import { getMorphoShapeProps } from "./MorphoShapeUtil";

describe("MorphoShapeUtil", () => {
  it("keeps image canvas props focused on the visual without persistent title or summary details", () => {
    const workspace = createInitialWorkspace();
    const image = workspace.objects["image-soft-rail-v2"];
    const instance = workspace.canvas.instances.find((item) => item.objectId === "image-soft-rail-v2");

    if (!image || image.type !== "image" || !instance) {
      throw new Error("Expected seed workspace to include an image canvas instance.");
    }

    const props = getMorphoShapeProps(instance, image, undefined, workspace);

    expect(props.morphoType).toBe("image");
    expect(props.details).toEqual([]);
  });

  it("marks design definition cards when a pending revision draft exists", () => {
    const workspace = createInitialWorkspace();
    const instance = workspace.canvas.instances.find((item) => item.objectId === "definition-current");
    const currentDefinition =
      workspace.objects["definition-current"]?.type === "designDefinition"
        ? workspace.objects["definition-current"]
        : undefined;

    if (!instance || !currentDefinition) {
      throw new Error("Expected seed workspace to include the current design definition instance.");
    }

    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-card-revision",
      title: "当前设计定义 v2",
      summary: "收紧连续支撑与触感边界。",
      projectGoal: "保持居家感的同时提升夜间路径支撑可信度。",
      targetUsers: ["独居老人"],
      primaryScenarios: ["床边起身", "进入卫浴"],
      coreProblem: "如何在不增加器械感的前提下强化连续支撑。",
      designPrinciples: ["连续支撑", "柔和触感"],
      constraints: ["避免医院感"],
      avoidDirections: ["厚重器械感"],
      opportunities: ["统一转角与触感语言"],
      openQuestions: ["转角连接是否需要更明显的触感差异？"],
      sourceObjectIds: ["insight-continuous-support"],
      citations: [],
      basedOnDesignDefinitionId: "definition-current",
      basedOnRevisionId: currentDefinition.currentRevisionId,
      workIntent: "reviseDesignDefinition",
      changeNote: "收紧连续支撑边界。"
    });

    const props = getMorphoShapeProps(instance, currentDefinition, undefined, proposed.workspace);

    expect(props.details).toContain("有修订草稿");
  });

  it("does not mark design definition cards for create-definition proposals", () => {
    const workspace = createInitialWorkspace();
    const instance = workspace.canvas.instances.find((item) => item.objectId === "definition-current");
    const currentDefinition =
      workspace.objects["definition-current"]?.type === "designDefinition"
        ? workspace.objects["definition-current"]
        : undefined;

    if (!instance || !currentDefinition) {
      throw new Error("Expected seed workspace to include the current design definition instance.");
    }

    const proposed = recordDesignDefinitionProposal(workspace, {
      proposalId: "proposal-definition-card-create",
      title: "首版设计定义草案",
      summary: "一份无关的首版草案。",
      projectGoal: "测试首版创建语义。",
      targetUsers: ["测试用户"],
      primaryScenarios: ["测试场景"],
      coreProblem: "测试问题。",
      designPrinciples: ["测试原则"],
      constraints: [],
      avoidDirections: [],
      opportunities: [],
      openQuestions: [],
      sourceObjectIds: [],
      citations: [],
      workIntent: "createDesignDefinition"
    });

    const props = getMorphoShapeProps(instance, currentDefinition, undefined, proposed.workspace);

    expect(props.details).not.toContain("有修订草稿");
  });
});
