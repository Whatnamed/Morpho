import { describe, expect, it } from "vitest";

import { recordDesignDefinitionProposal } from "../../../domain/operations/operations";
import type { CanvasInstance, KeyConclusionObject, MorphoObjectType, ResearchObject } from "../../../domain/morpho/types";
import { createInitialWorkspace } from "../../../domain/morpho/workspace";

import {
  getAdaptiveMorphoShapeSize,
  getMorphoShapeProps,
  resolveAutoGrowHeight,
  shouldAutoGrowMorphoShape
} from "./MorphoShapeUtil";

describe("MorphoShapeUtil", () => {
  it("auto-grows every text-bearing canvas object while keeping image geometry stable", () => {
    const textTypes: MorphoObjectType[] = [
      "file",
      "text",
      "link",
      "imageCollection",
      "research",
      "keyConclusion",
      "documentFragment",
      "designDefinition",
      "conceptDirection",
      "delivery",
      "proposalDraft"
    ];

    expect(textTypes.every(shouldAutoGrowMorphoShape)).toBe(true);
    expect(shouldAutoGrowMorphoShape("image")).toBe(false);
    expect(resolveAutoGrowHeight(180, 240)).toBe(242);
    expect(resolveAutoGrowHeight(180, 179)).toBeNull();
    expect(resolveAutoGrowHeight(180, 182, 180)).toBeNull();
  });

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

  it("marks an object referenced from the detail bar for a local canvas highlight", () => {
    const workspace = createInitialWorkspace();
    const image = workspace.objects["image-soft-rail-v2"];
    const instance = workspace.canvas.instances.find((item) => item.objectId === "image-soft-rail-v2");

    if (!image || image.type !== "image" || !instance) {
      throw new Error("Expected seed workspace to include an image canvas instance.");
    }

    const props = getMorphoShapeProps(instance, image, undefined, workspace, true);

    expect(props.isDetailReferenceHighlighted).toBe(true);
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

  it("keeps design definition canvas cards to title and full summary, not full structured fields", () => {
    const workspace = createInitialWorkspace();
    const definition = workspace.objects["definition-current"];
    const instance = workspace.canvas.instances.find((item) => item.objectId === "definition-current");

    if (!definition || definition.type !== "designDefinition" || !instance) {
      throw new Error("Expected seed workspace to include the current design definition instance.");
    }

    const props = getMorphoShapeProps(instance, definition, undefined, workspace);

    expect(props.summary).toBe(definition.summary);
    expect(props.details.join("\n")).not.toContain(definition.problem);
    expect(props.details.join("\n")).not.toContain(definition.principles[0]);
    expect(props.details.join("\n")).not.toContain(definition.avoid[0]);
  });

  it("renders concept direction keywords with the correct user-facing label", () => {
    const workspace = createInitialWorkspace();
    const direction = workspace.objects["direction-soft-rail"];
    const instance = workspace.canvas.instances.find((item) => item.objectId === "direction-soft-rail");

    if (!direction || direction.type !== "conceptDirection" || !instance) {
      throw new Error("Expected seed workspace to include a concept direction instance.");
    }

    const props = getMorphoShapeProps(instance, direction, undefined, workspace);

    expect(props.details[1]).toBe(`关键词：${direction.keywords.join(" / ")}`);
    expect(props.details.join("")).not.toContain("鍏");
  });

  it("marks non-current design definitions without removing them from the canvas", () => {
    const workspace = createInitialWorkspace();
    const definition = workspace.objects["definition-current"];
    const instance = workspace.canvas.instances.find((item) => item.objectId === "definition-current");

    if (!definition || definition.type !== "designDefinition" || !instance) {
      throw new Error("Expected seed workspace to include the current design definition instance.");
    }

    const nonCurrent = { ...definition, isCurrentEffective: false };
    const props = getMorphoShapeProps(instance, nonCurrent, undefined, {
      ...workspace,
      objects: {
        ...workspace.objects,
        [nonCurrent.id]: nonCurrent
      }
    });

    expect(props.details).toContain("非当前定义");
  });

  it("includes non-current status chips in the adaptive design-definition height", () => {
    const workspace = createInitialWorkspace();
    const definition = workspace.objects["definition-current"];
    const instance = workspace.canvas.instances.find((item) => item.objectId === "definition-current");

    if (!definition || definition.type !== "designDefinition" || !instance) {
      throw new Error("Expected seed workspace to include the current design definition instance.");
    }

    const nonCurrent = {
      ...definition,
      isCurrentEffective: false,
      title: "方案 A｜声学生态风险预警浮标系统",
      summary:
        "以可部署的海上浮标为前端，识别并分级生态声学风险，将水下感知转化为船舶与管理者可执行的减速、绕行或复核建议，同时避免影响海洋生物。"
    };
    const compactInstance = {
      ...instance,
      size: { w: 340, h: 120 }
    };
    const currentSize = getAdaptiveMorphoShapeSize(compactInstance, nonCurrent, []);
    const nonCurrentSize = getAdaptiveMorphoShapeSize(compactInstance, nonCurrent, ["非当前定义"]);

    expect(nonCurrentSize.h).toBeGreaterThan(currentSize.h);
    expect(nonCurrentSize.h - currentSize.h).toBeGreaterThanOrEqual(20);
  });

  it("keeps research canvas cards as concise entry objects", () => {
    const research: ResearchObject = {
      id: "research-long",
      type: "research",
      title: "Ocean noise buoy research before design definition",
      summary: "Long research card",
      createdBy: "ai",
      visibility: "active",
      findings: [
        "Existing materials can support a first design definition if the project is framed as a dynamic monitoring, warning, and management buoy system for ocean-noise hotspots."
      ],
      opportunities: [
        "Define the buoy as a boundary node for a dynamic acoustic refuge, using color, light, and data-state visualization to communicate sea-area risk levels."
      ],
      constraints: [
        "The current local research supports why ocean-noise intervention matters and why a buoy can work as a system node, but it is not enough for a complete industrial-grade product definition."
      ],
      openQuestions: [
        "Who is the primary audience for the buoy: crew, port managers, marine protection organizations, research teams, or near-shore public users?"
      ],
      evidence: [],
      provenance: {
        operationId: "operation-research-long",
        proposalId: "proposal-research-long",
        sourceObjectIds: [],
        citationIds: [],
        didUseWebSearch: false
      }
    };

    const size = getAdaptiveMorphoShapeSize(
      {
        id: "canvas-research-long",
        objectId: research.id,
        position: { x: 0, y: 0 },
        size: { w: 320, h: 120 }
      },
      research
    );

    expect(size.w).toBe(320);
    expect(size.h).toBeGreaterThan(120);
    expect(size.h).toBeLessThanOrEqual(220);
  });

  it("keeps research detail sections out of the canvas card", () => {
    const workspace = createInitialWorkspace();
    const research = workspace.objects["research-night-path"];
    const instance = workspace.canvas.instances.find((item) => item.objectId === "research-night-path");

    if (!research || research.type !== "research" || !instance) {
      throw new Error("Expected seed workspace to include a research object.");
    }

    const props = getMorphoShapeProps(instance, research, undefined, workspace);

    expect(props.researchSections).toBeUndefined();
    expect(props.details).toHaveLength(4);
  });

  it("keeps key conclusion canvas cards focused on the conclusion text only", () => {
    const keyConclusion: KeyConclusionObject = {
      id: "key-no-repeat",
      type: "keyConclusion",
      title: "问题必须在起足够成立，因此后续设计无需再反复证明“海洋噪音值得做”。",
      summary: "问题必须在起足够成立，因此后续设计无需再反复证明“海洋噪音值得做”。",
      body: "问题必须在起足够成立，因此后续设计无需再反复证明“海洋噪音值得做”。",
      createdBy: "user",
      visibility: "active",
      state: "active",
      confidence: "partial",
      sourceObjectIds: ["research-night-path"],
      citationIds: [],
      confirmedAt: "2026-07-07T00:00:00.000Z",
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z"
    };
    const instance: CanvasInstance = {
      id: "canvas-key-no-repeat",
      objectId: keyConclusion.id,
      position: { x: 0, y: 0 },
      size: { w: 280, h: 120 }
    };

    const props = getMorphoShapeProps(instance, keyConclusion);

    expect(props.title).toBe(keyConclusion.title);
    expect(props.details).toEqual([]);
  });

  it("uses the research item type as the label for extracted key conclusions", () => {
    const workspace = createInitialWorkspace();
    const research = workspace.objects["research-night-path"];
    if (!research || research.type !== "research") {
      throw new Error("Expected seed workspace to include a research object.");
    }
    const cases = [
      ["发现第", "发现"],
      ["机会点第", "机会点"],
      ["约束第", "约束"],
      ["待验证问题第", "待验证"]
    ] as const;

    for (const [noteKind, expectedLabel] of cases) {
      const keyConclusion: KeyConclusionObject = {
        id: `key-${expectedLabel}-label`,
        type: "keyConclusion",
        title: "把海域风险转译成港航管理可以执行的避让建议。",
        summary: "把海域风险转译成港航管理可以执行的避让建议。",
        body: "把海域风险转译成港航管理可以执行的避让建议。",
        createdBy: "user",
        visibility: "active",
        state: "active",
        confidence: "partial",
        sourceObjectIds: [research.id],
        citationIds: [],
        confirmedAt: "2026-07-07T00:00:00.000Z",
        note: `用户从研究对象“${research.title}”的${noteKind} 1条中保留关键结论。`,
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T00:00:00.000Z"
      };
      const instance: CanvasInstance = {
        id: `canvas-${keyConclusion.id}`,
        objectId: keyConclusion.id,
        position: { x: 0, y: 0 },
        size: { w: 280, h: 116 }
      };

      expect(getMorphoShapeProps(instance, keyConclusion).label).toBe(expectedLabel);
    }
  });

  it("compacts previously auto-sized extracted key conclusion cards", () => {
    const keyConclusion: KeyConclusionObject = {
      id: "key-previously-tall",
      type: "keyConclusion",
      title: "围绕“时空动态管理”建立概念亮点，有助于避免落入静态设备或空泛环保装置的常见表达。",
      summary: "围绕“时空动态管理”建立概念亮点，有助于避免落入静态设备或空泛环保装置的常见表达。",
      body: "围绕“时空动态管理”建立概念亮点，有助于避免落入静态设备或空泛环保装置的常见表达。",
      createdBy: "user",
      visibility: "active",
      state: "active",
      confidence: "partial",
      sourceObjectIds: ["research-night-path"],
      citationIds: [],
      confirmedAt: "2026-07-07T00:00:00.000Z",
      note: "用户从研究对象“研究与分析”的发现第 1条中保留关键结论。",
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z"
    };
    const instance: CanvasInstance = {
      id: "canvas-key-previously-tall",
      objectId: keyConclusion.id,
      position: { x: 0, y: 0 },
      size: { w: 280, h: 218 }
    };

    const props = getMorphoShapeProps(instance, keyConclusion);

    expect(props.h).toBeLessThanOrEqual(156);
  });

  it("caps long extracted conclusion cards instead of growing into oversized notes", () => {
    const keyConclusion: KeyConclusionObject = {
      id: "key-too-long",
      type: "keyConclusion",
      title:
        "作用链闭环：浮标监测到高风险声学事件后，系统触发的是航线建议、速度限制、施工暂停还是仅数据上报？这个决定会改变产品定义。",
      summary:
        "作用链闭环：浮标监测到高风险声学事件后，系统触发的是航线建议、速度限制、施工暂停还是仅数据上报？这个决定会改变产品定义。",
      body:
        "作用链闭环：浮标监测到高风险声学事件后，系统触发的是航线建议、速度限制、施工暂停还是仅数据上报？这个决定会改变产品定义。",
      createdBy: "user",
      visibility: "active",
      state: "needsVerification",
      confidence: "needsVerification",
      sourceObjectIds: ["research-night-path"],
      citationIds: [],
      confirmedAt: "2026-07-07T00:00:00.000Z",
      note: "用户从研究对象“研究与分析”的待验证问题第 1条中保留关键结论。",
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z"
    };
    const props = getMorphoShapeProps(
      {
        id: "canvas-key-too-long",
        objectId: keyConclusion.id,
        position: { x: 0, y: 0 },
        size: { w: 320, h: 104 }
      },
      keyConclusion
    );

    expect(props.h).toBeLessThanOrEqual(156);
    expect(props.h).toBeGreaterThanOrEqual(118);
  });
});
