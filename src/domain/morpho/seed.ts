import { createDefaultStageRecords, createEmptyProjectWorkingState, reconcileWorkspaceDerivedState } from "./derivedState";
import type { MorphoObject, MorphoObjectId, MorphoWorkspace, ObjectVisibility } from "./types";

type SeedObject = MorphoObject extends infer ObjectUnion
  ? ObjectUnion extends MorphoObject
    ? Omit<ObjectUnion, "visibility"> & { visibility?: ObjectVisibility }
    : never
  : never;

const NOW = "2026-06-23T00:00:00.000Z";
const DEFINITION_REVISION_ID = "definition-revision-current-1";
const DIRECTION_SOFT_RAIL_REVISION_ID = "direction-revision-soft-rail-1";
const DIRECTION_SUPPORT_ISLAND_REVISION_ID = "direction-revision-support-island-1";
const DIRECTION_SOFT_GUIDE_REVISION_ID = "direction-revision-soft-guide-1";
const BRANCH_SOFT_RAIL_CORE_ID = "visual-branch-soft-rail-core";
const BRANCH_SOFT_RAIL_DETAIL_ID = "visual-branch-soft-rail-detail";
const BRANCH_SOFT_RAIL_SCENARIO_ID = "visual-branch-soft-rail-scenario";

function withActiveVisibility(objects: Record<MorphoObjectId, SeedObject>): Record<MorphoObjectId, MorphoObject> {
  return Object.fromEntries(
    Object.entries(objects).map(([id, object]) => [
      id,
      {
        ...object,
        visibility: object.visibility ?? "active",
        createdAt: object.createdAt ?? NOW,
        updatedAt: object.updatedAt ?? NOW
      } as MorphoObject
    ])
  );
}

const baseWorkspace: MorphoWorkspace = {
  schemaVersion: 5,
  project: {
    id: "project-nightrail",
    title: "夜航 / Nightrail",
    subtitle: "为独居老人夜间起身与卫浴路径设计一套低施工、非医疗化的连续辅助系统。",
    currentFocus: "direction_visual_development",
    createdAt: NOW,
    updatedAt: NOW,
    lastOpenedAt: NOW
  },
  objects: withActiveVisibility({
    "file-course-brief": {
      id: "file-course-brief",
      type: "file",
      title: "课程要求.pdf",
      summary: "夜间居家安全与低施工改造方向的课程任务说明。",
      createdBy: "user",
      fileKind: "pdf",
      sourceLabel: "用户导入"
    },
    "file-path-references": {
      id: "file-path-references",
      type: "file",
      title: "夜间起身路径参考 / 6 张",
      summary: "床边、过道、门口和卫浴转角的动作路径参考。",
      createdBy: "user",
      fileKind: "imageSet",
      sourceLabel: "用户导入"
    },
    "research-night-path": {
      id: "research-night-path",
      type: "research",
      title: "研究与分析",
      summary: "基于课程要求与路径参考形成的候选理解。",
      createdBy: "ai",
      findings: ["夜间动作不是单点站立，而是床边、过道、转角与卫浴入口之间的连续转移。"],
      opportunities: ["把低位导光和触摸导向合并为一条安静的居家轨道。"],
      constraints: ["租住和老房场景不适合大面积开墙、布线或重型五金。"],
      openQuestions: ["如何在不产生医院感的前提下给出可信支撑？"]
    },
    "insight-continuous-support": {
      id: "insight-continuous-support",
      type: "keyConclusion",
      title: "连续支撑比单点扶手更符合真实动作路径",
      summary: "夜间起身的风险集中在路径转换，而不只在卫浴内。",
      body: "起身、转身、走向卫浴、进入门口和转角的动作连续发生，因此需要连续支撑与导向，而不是只在终点补一个扶手。",
      createdBy: "user",
      state: "active",
      confidence: "supported",
      sourceObjectIds: ["research-night-path", "file-path-references"],
      citationIds: [],
      confirmedAt: NOW
    },
    "insight-nonmedical": {
      id: "insight-nonmedical",
      type: "keyConclusion",
      title: "安全产品需要降低“医疗器械感”",
      summary: "居家接受度来自家具感和低干扰，而不是显眼的辅助器械语言。",
      body: "如果支撑系统看起来像医院扶手或康复器械，用户会排斥长期保留，因此语义要更接近日常家具与暖光环境。",
      createdBy: "user",
      state: "active",
      confidence: "supported",
      sourceObjectIds: ["research-night-path", "file-course-brief"],
      citationIds: [],
      confirmedAt: NOW
    },
    "insight-low-construction": {
      id: "insight-low-construction",
      type: "keyConclusion",
      title: "租住 / 老房场景不适合大施工",
      summary: "低施工安装是方向成立的基础约束。",
      body: "不依赖重新布线、墙体改造或复杂五金，是这个项目能真实落地的前提。",
      createdBy: "user",
      state: "active",
      confidence: "supported",
      sourceObjectIds: ["research-night-path", "file-course-brief"],
      citationIds: [],
      confirmedAt: NOW
    },
    "definition-current": {
      id: "definition-current",
      type: "designDefinition",
      title: "当前设计定义",
      summary: "把已保留结论收束为后续方向与视觉发展的共同依据。",
      createdBy: "user",
      problem: "让独居老人从床边到卫浴的最后几米更容易辨认、扶持与转身。",
      principles: ["低施工", "连续支撑", "低干扰照明", "居家语气"],
      avoid: ["医院感", "复杂电子交互", "厚重外露五金"],
      currentRevisionId: DEFINITION_REVISION_ID,
      revisionIds: [DEFINITION_REVISION_ID],
      isCurrentEffective: true
    },
    "direction-soft-rail": {
      id: "direction-soft-rail",
      type: "conceptDirection",
      title: "方向 A：柔光轨道",
      summary: "把低位导光、可触摸导向与隐藏支撑整合为连续墙面轨道。",
      createdBy: "ai",
      status: "primary",
      keywords: ["连续轨道", "低位柔光", "隐藏支撑"],
      currentRevisionId: DIRECTION_SOFT_RAIL_REVISION_ID,
      revisionIds: [DIRECTION_SOFT_RAIL_REVISION_ID],
      lineageRootId: "direction-soft-rail"
    },
    "direction-support-island": {
      id: "direction-support-island",
      type: "conceptDirection",
      title: "方向 B：家具化支撑岛",
      summary: "把局部支撑隐藏在床边和门口的家具化节点中。",
      createdBy: "ai",
      status: "alternative",
      keywords: ["家具节点", "柔性扶持", "局部介入"],
      currentRevisionId: DIRECTION_SUPPORT_ISLAND_REVISION_ID,
      revisionIds: [DIRECTION_SUPPORT_ISLAND_REVISION_ID],
      lineageRootId: "direction-support-island"
    },
    "direction-soft-guide": {
      id: "direction-soft-guide",
      type: "conceptDirection",
      title: "方向 C：软性引导带",
      summary: "用织物和软性材料做轻量引导，但支撑可信度不足。",
      createdBy: "ai",
      status: "eliminated",
      keywords: ["软性材料", "触摸提示", "支撑不足"],
      currentRevisionId: DIRECTION_SOFT_GUIDE_REVISION_ID,
      revisionIds: [DIRECTION_SOFT_GUIDE_REVISION_ID],
      lineageRootId: "direction-soft-guide"
    },
    "image-path-reference": {
      id: "image-path-reference",
      type: "image",
      title: "夜间过道参考",
      summary: "普通卧室通向卫浴的低照度路径。",
      createdBy: "user",
      role: "reference",
      imageVariant: "path"
    },
    "image-soft-rail-preview": {
      id: "image-soft-rail-preview",
      type: "image",
      title: "柔光轨道预览",
      summary: "方向 A 的早期视觉预览。",
      createdBy: "ai",
      role: "preview",
      imageVariant: "rail",
      directionId: "direction-soft-rail",
      visualBranchId: BRANCH_SOFT_RAIL_CORE_ID
    },
    "image-soft-rail-v2": {
      id: "image-soft-rail-v2",
      type: "image",
      title: "柔光轨道 v2",
      summary: "当前主方向的核心产品图，作为后续相关生成的默认一致性基线。",
      createdBy: "ai",
      role: "main",
      imageVariant: "rail",
      directionId: "direction-soft-rail",
      visualBranchId: BRANCH_SOFT_RAIL_CORE_ID,
      isDefaultReference: true
    },
    "image-rail-detail": {
      id: "image-rail-detail",
      type: "image",
      title: "转角连接与触感截面",
      summary: "围绕柔光轨道 v2 衍生的细节图。",
      createdBy: "ai",
      role: "detail",
      imageVariant: "detail",
      directionId: "direction-soft-rail",
      visualBranchId: BRANCH_SOFT_RAIL_DETAIL_ID
    },
    "image-night-scenario": {
      id: "image-night-scenario",
      type: "image",
      title: "夜间使用场景",
      summary: "老人从卧室走向卫浴时的低位柔光路径表达。",
      createdBy: "ai",
      role: "scenario",
      imageVariant: "scenario",
      directionId: "direction-soft-rail",
      visualBranchId: BRANCH_SOFT_RAIL_SCENARIO_ID
    },
    "image-cmf-board": {
      id: "image-cmf-board",
      type: "image",
      title: "CMF 小板",
      summary: "暖灰、砂岩、深橄榄、柔光白的材质基线。",
      createdBy: "ai",
      role: "cmf",
      imageVariant: "cmf",
      directionId: "direction-soft-rail",
      visualBranchId: BRANCH_SOFT_RAIL_DETAIL_ID
    },
    "image-support-island-preview": {
      id: "image-support-island-preview",
      type: "image",
      title: "家具化支撑岛预览",
      summary: "方向 B 的备选预览图。",
      createdBy: "ai",
      role: "preview",
      imageVariant: "supportIsland",
      directionId: "direction-support-island"
    },
    "image-soft-guide-preview": {
      id: "image-soft-guide-preview",
      type: "image",
      title: "软性引导带预览",
      summary: "方向 C 的已淘汰预览图，保留作为历史判断依据。",
      createdBy: "ai",
      role: "preview",
      imageVariant: "softGuide",
      directionId: "direction-soft-guide"
    },
    "delivery-board-a1": {
      id: "delivery-board-a1",
      type: "delivery",
      title: "A1 展板 / 核心方案",
      summary: "整理核心方案、主图、细节引用和图注，不承担最终排版。",
      createdBy: "user",
      format: "board",
      references: ["delivery-ref-board-main", "delivery-ref-board-detail"],
      gaps: [{ id: "gap-install-diagram", label: "待补：安装逻辑示意" }]
    },
    "delivery-ppt-six": {
      id: "delivery-ppt-six",
      type: "delivery",
      title: "6 页汇报 PPT",
      summary: "准备页面主题与素材清单，后续带到外部工具精排。",
      createdBy: "user",
      format: "presentation",
      references: ["delivery-ref-ppt-main", "delivery-ref-ppt-scenario"],
      gaps: [{ id: "gap-night-scene", label: "待补：夜间使用场景" }]
    }
  }),
  assets: {},
  relations: [
    {
      id: "rel-research-course",
      kind: "source",
      fromObjectId: "file-course-brief",
      toObjectId: "research-night-path",
      note: "课程要求参与了研究与分析。"
    },
    {
      id: "rel-research-path",
      kind: "source",
      fromObjectId: "file-path-references",
      toObjectId: "research-night-path",
      note: "路径参考参与了研究与分析。"
    },
    {
      id: "rel-insight-definition",
      kind: "supports",
      fromObjectId: "insight-continuous-support",
      toObjectId: "definition-current",
      note: "关键结论进入当前设计定义。"
    },
    {
      id: "rel-insight-nonmedical-definition",
      kind: "supports",
      fromObjectId: "insight-nonmedical",
      toObjectId: "definition-current",
      note: "关键结论进入当前设计定义。"
    },
    {
      id: "rel-insight-low-definition",
      kind: "supports",
      fromObjectId: "insight-low-construction",
      toObjectId: "definition-current",
      note: "关键结论进入当前设计定义。"
    },
    {
      id: "rel-direction-definition",
      kind: "supports",
      fromObjectId: "definition-current",
      toObjectId: "direction-soft-rail",
      note: "主方向基于当前设计定义继续发展。"
    },
    {
      id: "rel-direction-b-definition",
      kind: "supports",
      fromObjectId: "definition-current",
      toObjectId: "direction-support-island",
      note: "备选方向基于当前设计定义展开。"
    },
    {
      id: "rel-direction-c-definition",
      kind: "supports",
      fromObjectId: "definition-current",
      toObjectId: "direction-soft-guide",
      note: "已淘汰方向保留其定义来源。"
    },
    {
      id: "rel-preview-direction",
      kind: "belongsToDirection",
      fromObjectId: "image-soft-rail-preview",
      toObjectId: "direction-soft-rail",
      note: "预览图属于方向 A。"
    },
    {
      id: "rel-v2-version",
      kind: "version",
      fromObjectId: "image-soft-rail-preview",
      toObjectId: "image-soft-rail-v2",
      note: "柔光轨道 v2 从预览图继续发展。"
    },
    {
      id: "rel-v2-default",
      kind: "defaultReference",
      fromObjectId: "image-soft-rail-v2",
      toObjectId: "direction-soft-rail",
      note: "柔光轨道 v2 是后续默认参考。"
    },
    {
      id: "rel-detail-version",
      kind: "version",
      fromObjectId: "image-soft-rail-v2",
      toObjectId: "image-rail-detail",
      note: "细节图从默认参考衍生。"
    },
    {
      id: "rel-scenario-version",
      kind: "version",
      fromObjectId: "image-soft-rail-v2",
      toObjectId: "image-night-scenario",
      note: "场景图从默认参考衍生。"
    },
    {
      id: "rel-board-main-ref",
      kind: "deliveryReference",
      fromObjectId: "image-soft-rail-v2",
      toObjectId: "delivery-board-a1",
      note: "主图作为交付模块的稳定引用。"
    }
  ],
  deliveryReferences: {
    "delivery-ref-board-main": {
      id: "delivery-ref-board-main",
      sourceObjectId: "image-soft-rail-v2",
      createdAt: NOW,
      snapshot: {
        sourceType: "image",
        title: "柔光轨道 v2",
        summary: "当前主方向的核心产品图，作为后续相关生成的默认一致性基线。",
        caption: "主图作为 A1 展板核心方案图。",
        previewAsset: {
          alt: "柔光轨道 v2 的交付引用快照"
        }
      }
    },
    "delivery-ref-board-detail": {
      id: "delivery-ref-board-detail",
      sourceObjectId: "image-rail-detail",
      createdAt: NOW,
      snapshot: {
        sourceType: "image",
        title: "转角连接与触感截面",
        summary: "围绕柔光轨道 v2 衍生的细节图。",
        caption: "说明转角连接和触感截面。",
        previewAsset: {
          alt: "转角连接与触感截面的交付引用快照"
        }
      }
    },
    "delivery-ref-ppt-main": {
      id: "delivery-ref-ppt-main",
      sourceObjectId: "image-soft-rail-v2",
      createdAt: NOW,
      snapshot: {
        sourceType: "image",
        title: "柔光轨道 v2",
        summary: "当前主方向的核心产品图，作为后续相关生成的默认一致性基线。",
        caption: "汇报 PPT 的核心产品图。",
        previewAsset: {
          alt: "柔光轨道 v2 的 PPT 引用快照"
        }
      }
    },
    "delivery-ref-ppt-scenario": {
      id: "delivery-ref-ppt-scenario",
      sourceObjectId: "image-night-scenario",
      createdAt: NOW,
      snapshot: {
        sourceType: "image",
        title: "夜间使用场景",
        summary: "老人从卧室走向卫浴时的低位柔光路径表达。",
        caption: "夜间路径中的使用情境。",
        previewAsset: {
          alt: "夜间使用场景的 PPT 引用快照"
        }
      }
    }
  },
  decisionRecords: [
    {
      id: "decision-default-reference-1",
      kind: "setDefaultReference",
      createdAt: NOW,
      summary: "设置后续默认参考：柔光轨道 v2",
      reason: "把主方向核心产品图作为后续视觉延展的一致性基线。",
      objectSnapshot: {
        id: "image-soft-rail-v2",
        type: "image",
        title: "柔光轨道 v2"
      },
      relatedObjectIds: ["image-soft-rail-v2", "direction-soft-rail"]
    },
    {
      id: "decision-direction-soft-guide-1",
      kind: "setDirectionStatus",
      createdAt: NOW,
      summary: "方向 C：软性引导带 -> eliminated",
      reason: "软性材料在真实起身与转角支撑中的可信度不足。",
      objectSnapshot: {
        id: "direction-soft-guide",
        type: "conceptDirection",
        title: "方向 C：软性引导带"
      },
      relatedObjectIds: ["direction-soft-guide"]
    }
  ],
  operations: {},
  artifactProposals: {},
  citationSnapshots: {},
  designDefinitionRevisions: {
    [DEFINITION_REVISION_ID]: {
      id: DEFINITION_REVISION_ID,
      designDefinitionId: "definition-current",
      revisionNumber: 1,
      title: "当前设计定义",
      summary: "把已保留结论收束为后续方向与视觉发展的共同依据。",
      projectGoal: "为独居老人夜间起身与卫浴路径建立低施工、连续支撑且低干扰的居家辅助系统。",
      targetUsers: ["独居老人", "需要夜间低照度活动的人"],
      primaryScenarios: ["夜间起身离床", "转向卫浴入口", "回到床边"],
      coreProblem: "让独居老人从床边到卫浴的最后几米更容易辨认、扶持与转身。",
      designPrinciples: ["低施工", "连续支撑", "低干扰照明", "居家语气"],
      constraints: ["适配租住和老房场景", "不依赖重型施工", "避免医院器械感"],
      avoidDirections: ["医院感", "复杂电子交互", "厚重外露五金"],
      opportunities: ["把低位导光和可触摸导向整合为连续轨道语言"],
      openQuestions: ["如何在转角与卫浴入口同时给出可信支撑与柔和引导？"],
      sourceObjectIds: [
        "research-night-path",
        "insight-continuous-support",
        "insight-nonmedical",
        "insight-low-construction"
      ],
      citationIds: [],
      createdAt: NOW,
      isCurrent: true
    }
  },
  directionRevisions: {
    [DIRECTION_SOFT_RAIL_REVISION_ID]: {
      id: DIRECTION_SOFT_RAIL_REVISION_ID,
      directionId: "direction-soft-rail",
      revisionNumber: 1,
      title: "方向 A：柔光轨道",
      summary: "把低位导光、可触摸导向与隐藏支撑整合为连续墙面轨道。",
      conceptStatement: "以连续墙面轨道把导向、照明和支撑合成一个日常家具化元素。",
      keywords: ["连续轨道", "低位柔光", "隐藏支撑"],
      strategy: "优先把路径安全变成连续语言，而不是在单点堆叠部件。",
      differentiators: ["支撑与光一体化", "更接近日常家居表面", "适合最后几米路径"],
      visualSignals: ["暖灰轨道", "低位光带", "柔和转角连接"],
      risks: ["转角安装复杂度", "隐藏支撑可信度表达"],
      openQuestions: ["如何让转角连接在视觉上更安静、在触感上更明确？"],
      sourceObjectIds: ["definition-current"],
      citationIds: [],
      basedOnDefinitionRevisionId: DEFINITION_REVISION_ID,
      createdAt: NOW,
      isCurrent: true
    },
    [DIRECTION_SUPPORT_ISLAND_REVISION_ID]: {
      id: DIRECTION_SUPPORT_ISLAND_REVISION_ID,
      directionId: "direction-support-island",
      revisionNumber: 1,
      title: "方向 B：家具化支撑岛",
      summary: "把局部支撑隐藏在床边和门口的家具化节点中。",
      conceptStatement: "以局部节点替代连续轨道，用家具化构件嵌入关键动作点。",
      keywords: ["家具节点", "柔性扶持", "局部介入"],
      strategy: "减弱系统存在感，把支撑嵌入床边与门口界面。",
      differentiators: ["更易接受", "局部改造量小", "更接近家具语言"],
      visualSignals: ["家具化立边", "温和块面", "局部支撑岛"],
      risks: ["路径连续性弱", "转身阶段支撑中断"],
      openQuestions: ["如何避免局部节点之间的支撑断裂？"],
      sourceObjectIds: ["definition-current"],
      citationIds: [],
      basedOnDefinitionRevisionId: DEFINITION_REVISION_ID,
      createdAt: NOW,
      isCurrent: true
    },
    [DIRECTION_SOFT_GUIDE_REVISION_ID]: {
      id: DIRECTION_SOFT_GUIDE_REVISION_ID,
      directionId: "direction-soft-guide",
      revisionNumber: 1,
      title: "方向 C：软性引导带",
      summary: "用织物和软性材料做轻量引导，但支撑可信度不足。",
      conceptStatement: "通过织物、软质包覆和触摸提示建立更温和的夜间路径提示。",
      keywords: ["软性材料", "触摸提示", "支撑不足"],
      strategy: "强调柔和触感和存在感极低的引导语义。",
      differentiators: ["情绪更温和", "材料更软", "视觉存在感最低"],
      visualSignals: ["织物包覆", "细窄引导带", "柔性触摸提示"],
      risks: ["支撑不可信", "长期维护成本高"],
      openQuestions: ["如何补足支撑可信度？"],
      sourceObjectIds: ["definition-current"],
      citationIds: [],
      basedOnDefinitionRevisionId: DEFINITION_REVISION_ID,
      createdAt: NOW,
      isCurrent: true
    }
  },
  directionLineage: [],
  visualBranches: {
    [BRANCH_SOFT_RAIL_CORE_ID]: {
      id: BRANCH_SOFT_RAIL_CORE_ID,
      directionId: "direction-soft-rail",
      label: "核心产品图",
      rootObjectId: "image-soft-rail-preview",
      createdAt: NOW
    },
    [BRANCH_SOFT_RAIL_DETAIL_ID]: {
      id: BRANCH_SOFT_RAIL_DETAIL_ID,
      directionId: "direction-soft-rail",
      label: "细节与结构",
      rootObjectId: "image-rail-detail",
      createdAt: NOW
    },
    [BRANCH_SOFT_RAIL_SCENARIO_ID]: {
      id: BRANCH_SOFT_RAIL_SCENARIO_ID,
      directionId: "direction-soft-rail",
      label: "场景表达",
      rootObjectId: "image-night-scenario",
      createdAt: NOW
    }
  },
  workingState: createEmptyProjectWorkingState(NOW),
  stageRecords: createDefaultStageRecords(NOW),
  canvas: {
    view: { x: -760, y: -160, zoom: 0.72 },
    instances: [
      {
        id: "canvas-file-course",
        objectId: "file-course-brief",
        position: { x: 60, y: 210 },
        size: { w: 220, h: 132 }
      },
      {
        id: "canvas-file-path",
        objectId: "file-path-references",
        position: { x: 72, y: 405 },
        size: { w: 260, h: 170 }
      },
      {
        id: "canvas-research",
        objectId: "research-night-path",
        position: { x: 390, y: 230 },
        size: { w: 310, h: 300 }
      },
      {
        id: "canvas-insight-support",
        objectId: "insight-continuous-support",
        position: { x: 410, y: 590 },
        size: { w: 260, h: 112 }
      },
      {
        id: "canvas-insight-nonmedical",
        objectId: "insight-nonmedical",
        position: { x: 700, y: 610 },
        size: { w: 250, h: 112 }
      },
      {
        id: "canvas-insight-low",
        objectId: "insight-low-construction",
        position: { x: 700, y: 745 },
        size: { w: 250, h: 112 }
      },
      {
        id: "canvas-definition",
        objectId: "definition-current",
        position: { x: 820, y: 245 },
        size: { w: 340, h: 330 }
      },
      {
        id: "canvas-direction-a",
        objectId: "direction-soft-rail",
        position: { x: 1240, y: 250 },
        size: { w: 270, h: 184 }
      },
      {
        id: "canvas-direction-b",
        objectId: "direction-support-island",
        position: { x: 1210, y: 570 },
        size: { w: 248, h: 168 }
      },
      {
        id: "canvas-direction-c",
        objectId: "direction-soft-guide",
        position: { x: 1200, y: 790 },
        size: { w: 248, h: 168 }
      },
      {
        id: "canvas-image-reference",
        objectId: "image-path-reference",
        position: { x: 1020, y: 60 },
        size: { w: 245, h: 178 }
      },
      {
        id: "canvas-image-preview-a",
        objectId: "image-soft-rail-preview",
        position: { x: 1540, y: 245 },
        size: { w: 230, h: 178 }
      },
      {
        id: "canvas-image-main",
        objectId: "image-soft-rail-v2",
        position: { x: 1820, y: 220 },
        size: { w: 360, h: 290 }
      },
      {
        id: "canvas-image-detail",
        objectId: "image-rail-detail",
        position: { x: 2235, y: 196 },
        size: { w: 235, h: 188 }
      },
      {
        id: "canvas-image-scenario",
        objectId: "image-night-scenario",
        position: { x: 2220, y: 440 },
        size: { w: 250, h: 192 }
      },
      {
        id: "canvas-image-cmf",
        objectId: "image-cmf-board",
        position: { x: 1820, y: 560 },
        size: { w: 275, h: 195 }
      },
      {
        id: "canvas-image-b",
        objectId: "image-support-island-preview",
        position: { x: 1505, y: 570 },
        size: { w: 220, h: 172 }
      },
      {
        id: "canvas-image-c",
        objectId: "image-soft-guide-preview",
        position: { x: 1490, y: 790 },
        size: { w: 220, h: 172 }
      },
      {
        id: "canvas-delivery-board",
        objectId: "delivery-board-a1",
        position: { x: 2630, y: 245 },
        size: { w: 330, h: 320 }
      },
      {
        id: "canvas-delivery-ppt",
        objectId: "delivery-ppt-six",
        position: { x: 2630, y: 620 },
        size: { w: 310, h: 230 }
      }
    ]
  },
  ai: {
    messages: [
      {
        id: "ai-msg-1",
        role: "assistant",
        body: "柔光轨道 v2 已经把低位导向、隐藏支撑和暖光氛围合在同一条路线里。下一步可以继续优化转角连接，或补一张夜间使用场景。",
        createdAt: NOW,
        status: "done",
        taskMode: "chatAnalysis",
        recommendedTaskMode: "imageGeneration"
      }
    ]
  },
  ui: {
    activeDrawer: null,
    aiOpen: true,
    lastSelectionIds: ["image-soft-rail-v2"],
    canvasView: { x: -760, y: -160, zoom: 0.72 }
  }
};

export const nightrailWorkspace: MorphoWorkspace = reconcileWorkspaceDerivedState(baseWorkspace);
