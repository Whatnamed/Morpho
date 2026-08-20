import type {
  AgentTaskStrategyKind,
  AiTaskMode,
  AiWorkIntent,
  MorphoObject,
  MorphoWorkspace,
  ProjectMemoryKey,
  StageRecordKey
} from "@/domain/morpho/types";
import type { TaskContextKind } from "./taskContext";
import {
  isUserActionExplicitlyDisallowed,
  stripUntrustedInstructionSegments
} from "@/shared/userInstructionAuthority";
import { isExplicitComparisonRequest } from "./morphoAgent";

export type AgentTaskStrategy = {
  kind: AgentTaskStrategyKind;
  contextKind: TaskContextKind;
  reason: string;
};

export type RequiredAgentReadToolName =
  | "read_project_memory"
  | "read_stage_record"
  | "search_project_conversation";

export type RequiredAgentReadRequirement =
  | {
      tool: "read_project_memory";
      requiredKeys: ProjectMemoryKey[];
    }
  | {
      tool: "read_stage_record";
      requiredStages: StageRecordKey[];
    }
  | {
      tool: "search_project_conversation";
      requiredMode: "earliest" | "latest" | "keyword";
      keyword?: string;
    };

export type AgentReadIntent = {
  history: boolean;
  memory: boolean;
  stage: boolean;
  objectRevision: boolean;
};

export type RequiredAgentReadState = {
  requiredTools: RequiredAgentReadToolName[];
  requirements: RequiredAgentReadRequirement[];
  completedTools: Set<RequiredAgentReadToolName>;
  failedTools: Set<RequiredAgentReadToolName>;
  reminderInserted: boolean;
  repairAttempted: boolean;
  exhausted: boolean;
};

export function createRequiredAgentReadState(
  required: readonly (RequiredAgentReadToolName | RequiredAgentReadRequirement)[]
): RequiredAgentReadState {
  const requirements = required.flatMap((item) =>
    typeof item === "string" ? [defaultRequirement(item)] : [item]
  );
  return {
    requiredTools: [...new Set(requirements.map((item) => item.tool))],
    requirements,
    completedTools: new Set(),
    failedTools: new Set(),
    reminderInserted: false,
    repairAttempted: false,
    exhausted: false
  };
}

export function completeRequiredAgentRead(
  state: RequiredAgentReadState,
  toolName: RequiredAgentReadToolName
): RequiredAgentReadState {
  const completedTools = new Set(state.completedTools);
  const failedTools = new Set(state.failedTools);
  completedTools.add(toolName);
  failedTools.delete(toolName);
  return { ...state, completedTools, failedTools };
}

export function failRequiredAgentRead(
  state: RequiredAgentReadState,
  toolName: RequiredAgentReadToolName
): { state: RequiredAgentReadState; retry: boolean } {
  const failedTools = new Set(state.failedTools);
  failedTools.add(toolName);
  if (!state.repairAttempted) {
    return {
      retry: true,
      state: { ...state, failedTools, repairAttempted: true, reminderInserted: true }
    };
  }
  return {
    retry: false,
    state: { ...state, failedTools, exhausted: true }
  };
}

export function advanceRequiredAgentReadState(
  state: RequiredAgentReadState
): {
  state: RequiredAgentReadState;
  action: "complete" | "remind" | "exhausted";
  missingTools: RequiredAgentReadToolName[];
} {
  const missingTools = getMissingRequiredAgentReadTools(state.requiredTools, state.completedTools);
  if (missingTools.length === 0) {
    return { state, action: "complete", missingTools };
  }
  if (state.exhausted || state.reminderInserted) {
    return { state: { ...state, exhausted: true }, action: "exhausted", missingTools };
  }
  return {
    state: { ...state, reminderInserted: true },
    action: "remind",
    missingTools
  };
}

export function buildRequiredAgentReadFailureNotice(
  state: RequiredAgentReadState
): string {
  const failed = [...state.failedTools];
  const missing = getMissingRequiredAgentReadTools(state.requiredTools, state.completedTools);
  const tools = [...new Set([...failed, ...missing])];
  return `读取失败，无法确认相关项目记录（${tools.join("、") || "所需来源"}）。本轮不会据此断言不存在或未记录。`;
}

export function resolveAgentReadIntent(
  draft: string,
  input: { hasSelectedObject?: boolean } = {}
): AgentReadIntent {
  const text = draft.replace(/\s+/g, " ").trim();
  const objectRevision = Boolean(input.hasSelectedObject && /上一版|前一版/.test(text));
  const history = !objectRevision && /最早的?对话|最早聊了什么|一开始怎么说|第一次提到|最初怎么确定|我们之前聊过|回顾一下聊天|以前为什么(?:这样)?决定|当时怎么讨论|项目是怎么开始|经历过哪些变化|最开始|历史聊天|聊天记录/.test(text);
  const memory = /你记得我喜欢什么|之前说过不要|稳定要求|当前设计原则|还有哪些问题没解决|项目里记住了什么|项目记忆|稳定决定|偏好|避免项|开放问题|待确认问题|上下文/.test(text) || (/还记得/.test(text) && !history);
  const stage = /现在做到哪|当前项目进度|哪些阶段完成|接下来要做|调研阶段.*得出|方向阶段.*结论|交付还缺|阶段记录|做到哪|进度|当前状态|现在.*(?:情况|进展)/.test(text);
  return { history, memory, stage, objectRevision };
}

export function resolveRequiredAgentReadTools(
  draft: string,
  input: { hasSelectedObject?: boolean } = {}
): RequiredAgentReadToolName[] {
  return resolveRequiredAgentReadRequirements(draft, input).map((requirement) => requirement.tool);
}

export function resolveRequiredAgentReadRequirements(
  draft: string,
  input: { hasSelectedObject?: boolean } = {}
): RequiredAgentReadRequirement[] {
  const intent = resolveAgentReadIntent(draft, input);
  const requirements: RequiredAgentReadRequirement[] = [];
  if (intent.history) {
    const keyword = extractConversationKeyword(draft);
    requirements.push({
      tool: "search_project_conversation",
      requiredMode: keyword ? "keyword" : /最早|一开始|最开始|项目是怎么开始/.test(draft) ? "earliest" : "latest",
      ...(keyword ? { keyword } : {})
    });
  }
  if (intent.memory || intent.stage) {
    requirements.push({
      tool: "read_project_memory",
      requiredKeys: resolveRequiredMemoryKeys(draft, intent.stage)
    });
  }
  if (intent.stage) {
    requirements.push({
      tool: "read_stage_record",
      requiredStages: resolveRequiredStages(draft)
    });
  }
  return requirements;
}

export function validateRequiredAgentReadCall(
  state: RequiredAgentReadState,
  toolName: RequiredAgentReadToolName,
  args: unknown
): { satisfied: true } | { satisfied: false; reason: string } {
  const requirement = state.requirements.find((candidate) => candidate.tool === toolName);
  if (!requirement) {
    return { satisfied: true };
  }
  const record = isRecord(args) ? args : {};
  if (requirement.tool === "read_project_memory") {
    const keys = stringSet(record.keys);
    const missing = keys ? requirement.requiredKeys.filter((key) => !keys.has(key)) : [];
    return missing.length === 0
      ? { satisfied: true }
      : { satisfied: false, reason: `项目记忆读取范围不足，仍需 keys: ${missing.join(", ")}。` };
  }
  if (requirement.tool === "read_stage_record") {
    const stages = stringSet(record.stages);
    const missing = stages ? requirement.requiredStages.filter((stage) => !stages.has(stage)) : [];
    return missing.length === 0
      ? { satisfied: true }
      : { satisfied: false, reason: `阶段记录读取范围不足，仍需 stages: ${missing.join(", ")}。` };
  }
  if (record.mode !== requirement.requiredMode) {
    return {
      satisfied: false,
      reason: `聊天查询模式不足，需要 mode: ${requirement.requiredMode}。`
    };
  }
  if (
    requirement.requiredMode === "keyword" &&
    requirement.keyword &&
    (typeof record.keyword !== "string" ||
      !record.keyword.toLocaleLowerCase().includes(requirement.keyword.toLocaleLowerCase()))
  ) {
    return {
      satisfied: false,
      reason: `聊天查询缺少关键词：${requirement.keyword}。`
    };
  }
  return { satisfied: true };
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
  const text = stripUntrustedInstructionSegments(input.draft).trim();
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
  const readIntent = resolveAgentReadIntent(text, { hasSelectedObject: input.selectedObjects.length > 0 });

  if ((readIntent.history || readIntent.memory || readIntent.stage) && !readIntent.objectRevision) {
    return strategy("historyAndMemory", "general", "用户明确询问项目历史、项目记忆或阶段记录");
  }
  if (input.hasDeliveryDraftTarget || input.workIntent === "prepareDeliverySection") {
    return strategy("deliveryPreparation", "general", "当前有明确交付章节草稿目标");
  }
  if (input.workIntent === "comparison" || isExplicitComparisonRequest(text)) {
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

function isResearchRequest(text: string): boolean {
  return /调研|研究|查证|验证来源|补充案例|竞品分析|事实依据/i.test(text) &&
    !/(?:不要|别|无需|不需要|禁止|不得|不能)\s*(?:联网|研究|调研|查证|验证)/i.test(text);
}

function isDesignDefinitionIntent(workIntent: AiWorkIntent, text: string): boolean {
  if (isUserActionExplicitlyDisallowed(text, "designDefinition")) {
    return false;
  }
  return (
    workIntent === "createDesignDefinition" ||
    workIntent === "reviseDesignDefinition" ||
    /(?:创建|形成|修改|修订|更新|调整|重写|改写).{0,16}(?:设计定义|design brief|核心问题|设计原则)|(?:设计定义|design brief|核心问题|设计原则).{0,16}(?:修改|修订|更新|调整|重写|改写)/i.test(text)
  );
}

function isConceptDirectionIntent(workIntent: AiWorkIntent, text: string): boolean {
  if (isUserActionExplicitlyDisallowed(text, "conceptDirection")) {
    return false;
  }
  return (
    workIntent === "createConceptDirections" ||
    workIntent === "reviseConceptDirection" ||
    workIntent === "splitConceptDirection" ||
    workIntent === "mergeConceptDirections" ||
    /(?:创建|形成|修改|修订|更新|调整|拆分|拆成|合并|整合|重写|改写).{0,16}(?:概念方向|方向方案|方向|方案)|(?:概念方向|方向方案|方向|方案).{0,16}(?:修改|修订|更新|调整|拆分|拆成|合并|整合|重写|改写)/i.test(text)
  );
}

function defaultRequirement(tool: RequiredAgentReadToolName): RequiredAgentReadRequirement {
  if (tool === "read_project_memory") {
    return { tool, requiredKeys: [] };
  }
  if (tool === "read_stage_record") {
    return { tool, requiredStages: [] };
  }
  return { tool, requiredMode: "latest" };
}

function resolveRequiredMemoryKeys(draft: string, stage: boolean): ProjectMemoryKey[] {
  const keys = new Set<ProjectMemoryKey>();
  if (/喜欢|偏好|不要|避免|反感|稳定要求/.test(draft)) {
    keys.add("userPreferences");
  }
  if (/约束|限制|设计原则|当前设计原则/.test(draft)) {
    keys.add("designBrief");
  }
  if (/开放问题|待确认问题|哪些问题没解决|还有哪些问题/.test(draft)) {
    keys.add("openQuestions");
  }
  if (/决定|为什么淘汰|稳定决定/.test(draft)) {
    keys.add("decisionLog");
  }
  if (stage || keys.size === 0) {
    keys.add("projectOverview");
  }
  return [...keys];
}

function resolveRequiredStages(draft: string): StageRecordKey[] {
  const stages = new Set<StageRecordKey>();
  if (/开始|输入/.test(draft)) stages.add("startAndInput");
  if (/探索/.test(draft)) stages.add("exploration");
  if (/调研|研究/.test(draft)) stages.add("research");
  if (/设计定义/.test(draft)) stages.add("designDefinition");
  if (/方向|视觉/.test(draft)) stages.add("directionAndVisual");
  if (/交付/.test(draft)) stages.add("deliveryPreparation");
  if (stages.size === 0) {
    return [
      "startAndInput",
      "exploration",
      "research",
      "designDefinition",
      "directionAndVisual",
      "deliveryPreparation"
    ];
  }
  return [...stages];
}

function extractConversationKeyword(draft: string): string | undefined {
  const match = draft.match(/第一次提到\s*([^，。！？?,]{1,80}?)(?:是|在|什么|何时|时候|[？?]|$)/);
  return match?.[1]?.trim() || undefined;
}

function stringSet(value: unknown): Set<string> | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? new Set(value)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
