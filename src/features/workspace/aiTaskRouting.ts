import type { AiContextTask, AiTaskMode, AiWorkIntent, MorphoObject } from "@/domain/morpho/types";
import { stripUntrustedInstructionSegments } from "@/shared/userInstructionAuthority";

type ObjectTypeOnly = Pick<MorphoObject, "type">;

export type ResolveTaskModeInput = {
  currentTaskMode: AiTaskMode;
  recommendedTaskMode: AiTaskMode;
};

export type ExecutionModeSource = "userSelected" | "autoRecommended";

export type ResolveWorkIntentInput = {
  currentWorkIntent: AiWorkIntent;
  recommendedWorkIntent: AiWorkIntent;
};

export type RecommendAiWorkIntentInput = {
  draft: string;
  selectedObjects: readonly ObjectTypeOnly[];
  hasCurrentDesignDefinition: boolean;
};

export type AvailableAiWorkIntentInput = {
  taskMode: AiTaskMode;
  selectedObjects: readonly ObjectTypeOnly[];
  hasCurrentDesignDefinition: boolean;
};

const EXPLICIT_IMAGE_GENERATION_PATTERN =
  /继续发展(?:这张|图像|图片)?|生成(?:(?:[一二两三四五六七八九十\d]+张|几张|每个方向|每条方向|各方向|这些方向|这几个方向).*(?:图|图片|预览)|场景图|角度图|cmf图|细节图|预览图|效果图|新视觉方案)|出图|分别.*(?:生成|出).*(?:图|预览)|图像生成|图像任务|方向预览|改成.*场景/i;
const GENERIC_TEXT_GENERATION_PATTERN = /生成(?:一段|一份|文案|说明|文字|摘要|标题|图注|交付说明)/i;
const NEGATED_IMAGE_GENERATION_PATTERN =
  /(?:(?:(?:暂时不要|不需要|先不要|千万别|先别|不要|无需|无须|不必|不能|不得|禁止|暂不|先不)(?:(?!(?:而是|改为|转而)|[，。！？；;\n]).){0,16})|(?:不(?:再|立即|现在|马上|直接|自动|进行)?\s*)|(?:(?:^|[，。！？；;\s])别(?:再|立即|现在|马上|直接|自动|进行)?\s*))(?:生成(?:(?:(?!(?:而是|改为|转而)|[，。！？；;\n]).){0,14})?(?:图|图片|预览|场景|角度|cmf|细节|效果)|出图|(?:图像|图片|视觉)(?:生成|任务)|方向预览|继续发展(?:这张|图像|图片)?|改成(?:(?![，。！？；;\n]).){0,10}场景)/i;
const IMAGE_ANALYSIS_PATTERN = /分析这张图|比较这几张图|提取.*形态|视觉分析|看图|图片.*问题/i;
const RESEARCH_PATTERN = /调研|研究|整理研究|联网补充|补充来源|查资料|搜索资料|分析这些(?:资料|文件|pdf|pptx?|markdown)|看看这些(?:资料|文件)|帮我梳理|基于这些(?:材料|资料)|验证一下|查一下/i;
const MATERIAL_OBJECT_TYPES = new Set(["file", "text", "link", "research"]);
const COMPARISON_PATTERN = /比较|对比|compare/i;
const DESIGN_DEFINITION_MUTATION_PATTERN = /(?:形成|创建|生成|提炼|修改|修订|更新|调整|重写|改写|draft|rewrite|revise).{0,16}(?:设计定义|设计原则|核心问题)|(?:设计定义|设计原则|核心问题).{0,16}(?:修改|修订|更新|调整|重写|改写|rewrite|revise)/i;
const REVISE_PATTERN = /更新|修订|修改|调整|rewrite|revise/i;
const CREATE_PATTERN = /形成|创建|生成|提炼|draft/i;
const CONCEPT_DIRECTION_MUTATION_PATTERN = /(?:形成|创建|生成|提炼|发展|修改|修订|更新|调整|拆分|拆成|分成|合并|整合|重写|改写|扩展|draft|rewrite|revise).{0,16}(?:概念方向|方向方案|方向|方案|概念|路线)|(?:概念方向|方向方案|方向|方案|概念|路线).{0,16}(?:修改|修订|更新|调整|拆分|拆成|分成|合并|整合|重写|改写|扩展|rewrite|revise)/i;
const SPLIT_PATTERN = /拆分|split/i;
const MERGE_PATTERN = /合并|merge/i;
const DELIVERY_SECTION_DRAFT_PATTERN = /交付准备|交付说明|本节说明|章节说明|图注|待补内容|delivery/i;
const RESEARCH_NEGATION_PATTERN = /(?:不要|别|无需|无须|不必|不用|不需要|禁止|不得|不能|暂不|先不要|先别)\s*(?:联网|上网|研究|调研|查证|验证|搜索)/i;
const NEGATED_MUTATION_PATTERN = /(?:不要|别|无需|无须|不必|不用|不需要|禁止|不得|不能|暂不|先不要|先别)\s*(?:创建|形成|生成|提炼|发展|修改|修订|更新|调整|拆分|拆成|分成|合并|整合|重写|改写|扩展|draft|rewrite|revise)/i;

export function recommendAiTaskMode(draft: string, selectedObjectTypes: readonly string[]): AiTaskMode {
  const text = stripUntrustedInstructionSegments(draft).trim();
  const hasMaterialSelection = selectedObjectTypes.some((type) => MATERIAL_OBJECT_TYPES.has(type));

  if (!text) {
    return "chatAnalysis";
  }

  if (
    hasMaterialSelection &&
    isResearchTaskRequest(text)
  ) {
    return "researchOperation";
  }

  if (IMAGE_ANALYSIS_PATTERN.test(text)) {
    return "chatAnalysis";
  }

  if (isExplicitImageGenerationRequest(text, selectedObjectTypes)) {
    return "imageGeneration";
  }

  if (
    isResearchTaskRequest(text) &&
    /联网|搜索|查一下|验证|调研|研究/i.test(text)
  ) {
    return "researchOperation";
  }

  return "chatAnalysis";
}

/**
 * Recommendation-only heuristic for the composer. It may expose image
 * settings, but it must never mint authority for a paid image action. Paid
 * execution is authorized only by the explicit send-time task selection.
 */
export function isExplicitImageGenerationRequest(
  draft: string,
  selectedObjectTypes: readonly string[]
): boolean {
  const text = stripUntrustedInstructionSegments(draft).trim();
  if (
    !text ||
    GENERIC_TEXT_GENERATION_PATTERN.test(text) ||
    NEGATED_IMAGE_GENERATION_PATTERN.test(text)
  ) return false;
  const hasVisualSelection = selectedObjectTypes.some(
    (type) => type === "conceptDirection" || type === "image"
  );
  return EXPLICIT_IMAGE_GENERATION_PATTERN.test(text) &&
    (hasVisualSelection || /图|预览|场景|cmf|细节/i.test(text));
}

export function resolveTaskModeForSend(input: ResolveTaskModeInput): AiTaskMode {
  if (input.currentTaskMode !== "chatAnalysis") {
    return input.currentTaskMode;
  }

  return input.recommendedTaskMode;
}

export function resolveTaskModeSource(input: ResolveTaskModeInput): ExecutionModeSource {
  return input.currentTaskMode !== "chatAnalysis" ? "userSelected" : "autoRecommended";
}

export function isResearchTaskRequest(draft: string): boolean {
  const text = stripUntrustedInstructionSegments(draft).trim();
  return Boolean(text) && !RESEARCH_NEGATION_PATTERN.test(text) && RESEARCH_PATTERN.test(text);
}

export function recommendAiWorkIntent(input: RecommendAiWorkIntentInput): AiWorkIntent {
  const text = stripUntrustedInstructionSegments(input.draft).trim();
  const directionCount = input.selectedObjects.filter((object) => object.type === "conceptDirection").length;

  if (!text) {
    return "discussion";
  }

  // Auto routing only recommends mutation for a positive action. Any direct
  // negation keeps this turn in discussion; execution authority still makes
  // the final structured-state decision at send time.
  if (NEGATED_MUTATION_PATTERN.test(text)) {
    return "discussion";
  }

  if (directionCount > 1 && MERGE_PATTERN.test(text)) {
    return "mergeConceptDirections";
  }

  if (directionCount === 1 && SPLIT_PATTERN.test(text)) {
    return "splitConceptDirection";
  }

  if (directionCount === 1 && REVISE_PATTERN.test(text) && CONCEPT_DIRECTION_MUTATION_PATTERN.test(text)) {
    return "reviseConceptDirection";
  }

  if (COMPARISON_PATTERN.test(text) && input.selectedObjects.length > 1) {
    return "comparison";
  }

  if (DELIVERY_SECTION_DRAFT_PATTERN.test(text)) {
    return "prepareDeliverySection";
  }

  if (DESIGN_DEFINITION_MUTATION_PATTERN.test(text)) {
    if (input.hasCurrentDesignDefinition) {
      return "reviseDesignDefinition";
    }

    if (CREATE_PATTERN.test(text) || !input.hasCurrentDesignDefinition) {
      return "createDesignDefinition";
    }
  }

  if (
    CONCEPT_DIRECTION_MUTATION_PATTERN.test(text) &&
    input.hasCurrentDesignDefinition
  ) {
    if (directionCount > 1 && MERGE_PATTERN.test(text)) {
      return "mergeConceptDirections";
    }

    if (directionCount === 1 && REVISE_PATTERN.test(text)) {
      return "reviseConceptDirection";
    }

    if (directionCount === 1 && SPLIT_PATTERN.test(text)) {
      return "splitConceptDirection";
    }

    return "createConceptDirections";
  }

  return "discussion";
}

export function resolveWorkIntentForSend(input: ResolveWorkIntentInput): AiWorkIntent {
  if (input.currentWorkIntent !== "discussion") {
    return input.currentWorkIntent;
  }

  return input.recommendedWorkIntent;
}

export function resolveWorkIntentSource(input: ResolveWorkIntentInput): ExecutionModeSource {
  return input.currentWorkIntent !== "discussion" ? "userSelected" : "autoRecommended";
}

export function hasExplicitProposalRevisionRequest(draft: string): boolean {
  return /(?:修改|修订|更新|调整|改写|重写|缩短|改名|rename|rewrite|revise).{0,20}(?:草案|提案|标题|名称|摘要|方向|方案|设计定义|概念方向|内容|正文|描述|prompt|draft|proposal)/i.test(
    stripUntrustedInstructionSegments(draft)
  );
}

export function getAvailableAiWorkIntents(input: AvailableAiWorkIntentInput): AiWorkIntent[] {
  if (input.taskMode !== "chatAnalysis") {
    return ["discussion"];
  }

  const directionCount = input.selectedObjects.filter((object) => object.type === "conceptDirection").length;
  const intents: AiWorkIntent[] = ["discussion", "prepareDeliverySection"];

  if (input.selectedObjects.length > 1) {
    intents.push("comparison");
  }

  if (input.hasCurrentDesignDefinition) {
    intents.push("reviseDesignDefinition", "createConceptDirections");
  } else {
    intents.push("createDesignDefinition");
  }

  if (directionCount === 1) {
    intents.push("reviseConceptDirection", "splitConceptDirection");
  }

  if (directionCount > 1) {
    intents.push("mergeConceptDirections");
  }

  return Array.from(new Set(intents));
}

export function resolveAiContextTask(taskMode: AiTaskMode, workIntent: AiWorkIntent): AiContextTask {
  if (taskMode === "researchOperation") {
    return "research";
  }

  if (taskMode === "imageGeneration") {
    return "visualDevelopment";
  }

  switch (workIntent) {
    case "comparison":
      return "comparison";
    case "prepareDeliverySection":
      return "deliveryPreparation";
    case "createDesignDefinition":
    case "reviseDesignDefinition":
      return "designDefinition";
    case "createConceptDirections":
    case "reviseConceptDirection":
    case "splitConceptDirection":
    case "mergeConceptDirections":
      return "conceptDirection";
    case "discussion":
    default:
      return "general";
  }
}

export function expectsDesignDefinitionProposal(workIntent: AiWorkIntent): boolean {
  return workIntent === "createDesignDefinition" || workIntent === "reviseDesignDefinition";
}

export function expectsConceptDirectionProposal(workIntent: AiWorkIntent): boolean {
  return (
    workIntent === "createConceptDirections" ||
    workIntent === "reviseConceptDirection" ||
    workIntent === "splitConceptDirection" ||
    workIntent === "mergeConceptDirections"
  );
}
