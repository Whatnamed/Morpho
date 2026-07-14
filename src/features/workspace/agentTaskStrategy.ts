import type {
  AgentTaskStrategyKind,
  AiTaskMode,
  AiWorkIntent,
  MorphoObject,
  MorphoWorkspace
} from "@/domain/morpho/types";
import type { TaskContextKind } from "./taskContext";

export type AgentTaskStrategy = {
  kind: AgentTaskStrategyKind;
  contextKind: TaskContextKind;
  reason: string;
};

export type RequiredAgentReadToolName =
  | "read_project_memory"
  | "read_stage_record"
  | "search_project_conversation";

export function resolveRequiredAgentReadTools(draft: string): RequiredAgentReadToolName[] {
  const text = draft.trim();
  const required = new Set<RequiredAgentReadToolName>();
  const asksConversationHistory = /最早的?对话|第一次提到|以前为什么|最开始|历史聊天|聊天记录/i.test(text);
  if (asksConversationHistory) {
    required.add("search_project_conversation");
  }
  if (
    /项目记忆|稳定决定|偏好|避免项|开放问题|待确认问题|上下文/i.test(text) ||
    (/还记得/i.test(text) && !asksConversationHistory)
  ) {
    required.add("read_project_memory");
  }
  if (/阶段记录|做到哪|进度|当前状态|现在.*(?:情况|进展)/i.test(text)) {
    required.add("read_project_memory");
    required.add("read_stage_record");
  }
  return [...required];
}

export function getMissingRequiredAgentReadTools(
  required: readonly RequiredAgentReadToolName[],
  completed: ReadonlySet<RequiredAgentReadToolName>
): RequiredAgentReadToolName[] {
  return required.filter((toolName) => !completed.has(toolName));
}

export function buildRequiredAgentReadReminder(toolNames: readonly RequiredAgentReadToolName[]): string {
  return [
    "在给出最终回答前，必须先读取用户明确询问的真实项目来源。",
    `下一步先调用：${toolNames.join("、")}。`,
    "在这些读取完成前，不得断言没有、不存在或未记录。"
  ].join("\n");
}

export function resolveAgentTaskStrategy(input: {
  draft: string;
  taskMode: AiTaskMode;
  workIntent: AiWorkIntent;
  selectedObjects: readonly MorphoObject[];
  workspace: Pick<MorphoWorkspace, "workingState">;
  hasDeliveryDraftTarget?: boolean;
}): AgentTaskStrategy {
  const text = input.draft.trim();
  const selectedDirections = input.selectedObjects.filter((object) => object.type === "conceptDirection");
  const selectedImages = input.selectedObjects.filter((object) => object.type === "image");
  const hasDirectionContext =
    selectedDirections.length > 0 ||
    Boolean(input.workspace.workingState.primaryDirectionId) ||
    input.workspace.workingState.alternativeDirectionIds.length > 0;
  const hasImageContext =
    selectedImages.length > 0 || Boolean(input.workspace.workingState.currentDefaultReferenceId);
  const directionPreviewRequested = /预览|每个方向|各方向|方向.*(?:图|视觉)/i.test(text);
  const visualDevelopmentRequested = /继续发展|局部修改|场景|cmf|材质|细节|角度|示意|生成.*图/i.test(text);

  if (isHistoryOrMemoryRequest(text)) {
    return strategy("historyAndMemory", "general", "用户明确询问项目历史、项目记忆或阶段记录");
  }
  if (input.hasDeliveryDraftTarget || input.workIntent === "prepareDeliverySection") {
    return strategy("deliveryPreparation", "general", "当前有明确交付章节草稿目标");
  }
  if (input.workIntent === "comparison" || isExplicitComparison(text)) {
    return strategy("comparison", "comparison", "用户明确要求比较当前对象");
  }
  if (input.taskMode === "researchOperation" || (input.taskMode !== "imageGeneration" && isResearchRequest(text))) {
    return strategy("research", "research", "任务模式或用户输入明确要求研究/验证");
  }
  if (isDesignDefinitionIntent(input.workIntent, text)) {
    return strategy("designDefinition", "designDefinition", "用户正在创建或修订设计定义");
  }
  if (isConceptDirectionIntent(input.workIntent, text)) {
    return strategy("conceptDirection", "conceptDirection", "用户正在创建或修订概念方向");
  }
  if (hasImageContext && visualDevelopmentRequested) {
    return strategy("visualDevelopment", "visualDevelopment", "已有来源图且用户明确要求继续视觉发展");
  }
  if (
    hasDirectionContext &&
    (directionPreviewRequested || (selectedDirections.length > 0 && input.taskMode === "imageGeneration"))
  ) {
    return strategy("directionPreview", "directionPreview", "已选概念方向且用户要求视觉预览");
  }
  if (
    hasImageContext &&
    input.taskMode === "imageGeneration"
  ) {
    return strategy("visualDevelopment", "visualDevelopment", "已选来源图且用户要求继续视觉发展");
  }
  return strategy("discussion", "general", "没有更高确定性的任务策略，保持普通连续讨论");
}

function strategy(kind: AgentTaskStrategyKind, contextKind: TaskContextKind, reason: string): AgentTaskStrategy {
  return { kind, contextKind, reason };
}

function isHistoryOrMemoryRequest(text: string): boolean {
  return /最早的?对话|第一次提到|以前为什么|最开始|历史聊天|聊天记录|项目记忆|阶段记录|做到哪|进度|稳定决定|哪些问题.*(?:没|未)解决/i.test(text);
}

function isExplicitComparison(text: string): boolean {
  if (/(?:不要|别|无需|不是).{0,12}(?:比较|对比|compare)/i.test(text)) {
    return false;
  }
  return /比较|对比|compare/i.test(text);
}

function isResearchRequest(text: string): boolean {
  return /调研|研究|查证|验证来源|补充案例|竞品分析|事实依据/i.test(text);
}

function isDesignDefinitionIntent(workIntent: AiWorkIntent, text: string): boolean {
  return (
    workIntent === "createDesignDefinition" ||
    workIntent === "reviseDesignDefinition" ||
    /设计定义|design brief|核心问题|设计原则/i.test(text)
  );
}

function isConceptDirectionIntent(workIntent: AiWorkIntent, text: string): boolean {
  return (
    workIntent === "createConceptDirections" ||
    workIntent === "reviseConceptDirection" ||
    workIntent === "splitConceptDirection" ||
    workIntent === "mergeConceptDirections" ||
    /概念方向|方向方案|拆分方向|合并方向/i.test(text)
  );
}
