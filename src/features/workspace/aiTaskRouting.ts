import type { AiTaskMode } from "@/domain/morpho/types";

export type ResolveTaskModeInput = {
  currentTaskMode: AiTaskMode;
  recommendedTaskMode: AiTaskMode;
};

const EXPLICIT_IMAGE_GENERATION_PATTERN =
  /继续发展(?:这张|图像|图片)?|生成(?:一张|新的|场景|角度|cmf|细节|预览|效果图|新视觉|视觉方案)|出图|图像生成|图像任务|使用场景图|场景图|角度图|cmf图|细节图/i;
const GENERIC_TEXT_GENERATION_PATTERN = /生成(?:一段|一份|文案|说明|文字|摘要|标题|图注|交付说明)/i;
const IMAGE_ANALYSIS_PATTERN = /分析这张图|比较这(?:两|几)张图|提取.*形态|形态语言|视觉分析|看图|图片.*问题/i;
const RESEARCH_PATTERN = /调研|研究|整理研究|联网补充|补充来源|查资料|搜索资料|基于已选资料/i;

export function recommendAiTaskMode(draft: string, selectedObjectTypes: readonly string[]): AiTaskMode {
  void selectedObjectTypes;
  const text = draft.trim();

  if (!text) {
    return "chatAnalysis";
  }

  if (RESEARCH_PATTERN.test(text)) {
    return "researchOperation";
  }

  if (IMAGE_ANALYSIS_PATTERN.test(text)) {
    return "chatAnalysis";
  }

  if (!GENERIC_TEXT_GENERATION_PATTERN.test(text) && EXPLICIT_IMAGE_GENERATION_PATTERN.test(text)) {
    return "imageGeneration";
  }

  return "chatAnalysis";
}

export function resolveTaskModeForSend(input: ResolveTaskModeInput): AiTaskMode {
  return input.currentTaskMode;
}
