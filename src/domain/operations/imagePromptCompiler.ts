import { getCurrentProjectMemoryRevision } from "../morpho/projectMemory";
import type { GrsImageEditMode } from "../morpho/grsImageModels";
import type { MorphoWorkspace } from "../morpho/types";
import type {
  VisualGenerationPlan,
  VisualGenerationPlanItem,
  VisualIntentItem,
  VisualReferenceResolution
} from "./types";
import { resolveVisualReferences } from "./visualReferenceResolver";

export const IMAGE_PROMPT_CONTRACT_VERSION = "morpho-image-prompt-v2";

export type CompiledImagePrompt = {
  prompt: string;
  promptContractVersion: typeof IMAGE_PROMPT_CONTRACT_VERSION;
  editMode: GrsImageEditMode;
  referenceResolution: VisualReferenceResolution;
};

export function compileImagePrompt(input: {
  workspace: MorphoWorkspace;
  intent: VisualIntentItem;
  referenceResolution: VisualReferenceResolution;
  modelId: string;
  currentUserInput: string;
}): CompiledImagePrompt {
  const designBrief = getCurrentProjectMemoryRevision(input.workspace.projectMemory, "designBrief");
  const userPreferences = getCurrentProjectMemoryRevision(input.workspace.projectMemory, "userPreferences");
  const direction = input.intent.targetDirectionId
    ? input.workspace.objects[input.intent.targetDirectionId]
    : undefined;
  const directionRevision =
    direction?.type === "conceptDirection"
      ? input.workspace.directionRevisions[direction.currentRevisionId]
      : undefined;
  const references = input.referenceResolution.resolvedObjectIds
    .map((objectId) => input.workspace.objects[objectId])
    .filter((object) => object?.type === "image")
    .map((object) => object.title);

  const rolePolicy = imageRolePolicy(input.intent.role);
  const taskPolicy = imageTaskPolicy(input.intent);
  const editMode = resolveImageEditMode(input.intent, input.referenceResolution);
  const sections = [
    `任务：${input.intent.title}`,
    `目的：${input.intent.purpose}`,
    "设计意图优先于渲染装饰：先保证结构、比例、部件关系和使用情境正确，再谈灯光、背景与风格；不要无意义地堆砌 studio lighting、premium render、futuristic 之类的装饰词。",
    `图片角色：${rolePolicy.label}`,
    `图像编辑能力：${editModeLabel(editMode)}`,
    rolePolicy.instruction,
    taskPolicy,
    line("当前用户要求（最高优先级）", input.currentUserInput),
    list("本轮要改变", input.intent.changeGoals),
    list("必须保留", input.intent.preserve),
    list("允许变化", input.intent.allowToChange),
    line("构图", input.intent.composition),
    line("视角", input.intent.viewpoint),
    list("产品形态", input.intent.productForm),
    list("材料与 CMF", input.intent.materialsAndCmf),
    list("环境与光线", input.intent.environmentAndLighting),
    list("避免", input.intent.avoid),
    line("用户补充", input.intent.userPromptRemainder),
    directionRevision
      ? [
          `目标方向：${directionRevision.title}`,
          `方向策略：${directionRevision.strategy}`,
          list("方向差异点", directionRevision.differentiators),
          list("方向视觉信号", directionRevision.visualSignals)
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    memorySection("当前 Design Brief", designBrief?.sections),
    memorySection("项目级用户偏好", userPreferences?.sections),
    references.length > 0 ? `参考图语义优先级已经由 Morpho 解析：${references.join("；")}` : "本轮无可用参考图。",
    input.intent.excludeDefaultReference ? "本轮明确排除项目默认参考。" : "",
    modelAdapterInstruction(input.modelId),
    "只生成本任务要求的新图，不覆盖来源图；没有蒙版或 inpainting 参数时，不保证未指定区域像素级不变，只能通过提示词尽量保持结构、比例、材质和构图。"
  ].filter(Boolean);

  return {
    prompt: sections.join("\n\n"),
    promptContractVersion: IMAGE_PROMPT_CONTRACT_VERSION,
    editMode,
    referenceResolution: input.referenceResolution
  };
}

export function compileVisualGenerationPlan(input: {
  workspace: MorphoWorkspace;
  kind: VisualGenerationPlan["kind"];
  intents: readonly VisualIntentItem[];
  selectedSourceObjectIds: readonly string[];
  projectReferenceObjectIds?: readonly string[];
  modelId: string;
  currentUserInput: string;
  providerReferenceLimit?: number;
}): VisualGenerationPlan {
  return {
    kind: input.kind,
    items: input.intents.map((intent): VisualGenerationPlanItem => {
      const referenceResolution = resolveVisualReferences({
        workspace: input.workspace,
        intent,
        selectedSourceObjectIds: input.selectedSourceObjectIds,
        projectReferenceObjectIds: input.projectReferenceObjectIds,
        providerLimit: input.providerReferenceLimit
      });
      const compiled = compileImagePrompt({
        workspace: input.workspace,
        intent,
        referenceResolution,
        modelId: input.modelId,
        currentUserInput: input.currentUserInput
      });
      return {
        id: intent.id,
        targetDirectionId: intent.targetDirectionId,
        visualBranchId: intent.visualBranchId,
        title: intent.title,
        purpose: intent.purpose,
        prompt: compiled.prompt,
        referenceObjectIds: referenceResolution.resolvedObjectIds,
        role: input.kind === "directionPreview" ? "conceptImage" : intent.role,
        editMode: compiled.editMode,
        visualIntent: intent,
        referenceResolution,
        promptContractVersion: compiled.promptContractVersion
      };
    })
  };
}

function imageTaskPolicy(intent: VisualIntentItem): string {
  const taskText = [intent.title, intent.purpose, ...intent.changeGoals].join(" ");
  if (/局部|仅修改|只改|替换|移除|增加细节/i.test(taskText)) {
    return "任务模板：定向修改。通过提示词尽量改变 changeGoals 指定内容并保留其余结构、比例、材质和构图；当前链路没有蒙版，不能承诺像素级局部锁定。";
  }
  if (intent.role === "sceneVisual") {
    return "任务模板：使用场景。用真实环境、人物关系与光线解释使用情境，同时维持产品主体、比例和关键结构。";
  }
  if (intent.role === "cmfStudy") {
    return "任务模板：CMF 研究。只研究材料、颜色、表面工艺与分区组合，产品几何和关键部件位置保持稳定。";
  }
  if (intent.role === "detailStudy") {
    return "任务模板：细节研究。聚焦指定连接、构造、界面或触点，用近景解释细节，不重做无关部分。";
  }
  if (intent.role === "preview" || /方向预览/i.test(taskText)) {
    return "任务模板：方向预览。优先让架构、比例、部件关系和形态语言差异清楚可比较。";
  }
  if (/继续|发展|延展|迭代|深化/i.test(taskText)) {
    return "任务模板：继续发展。沿来源图的产品身份和当前方向深化，形成可追溯的新方案，不退回为无关的新概念。";
  }
  return "任务模板：按本轮结构化视觉意图生成一个新的、可追溯的项目图像对象。";
}

function resolveImageEditMode(
  intent: VisualIntentItem,
  referenceResolution: VisualReferenceResolution
): GrsImageEditMode {
  if (referenceResolution.resolvedObjectIds.length === 0) {
    return "textToImage";
  }
  if (intent.editMode === "directedEdit" || intent.editMode === "maskedLocalEdit") {
    return "directedEdit";
  }
  const taskText = [intent.title, intent.purpose, ...intent.changeGoals].join(" ");
  return /局部|仅修改|只改|替换|移除|增加细节|定向修改/i.test(taskText) ? "directedEdit" : "imageToImage";
}

function editModeLabel(editMode: GrsImageEditMode): string {
  switch (editMode) {
    case "textToImage":
      return "文生图";
    case "imageToImage":
      return "图生图";
    case "directedEdit":
      return "定向修改（基于参考图的提示词编辑）";
    case "maskedLocalEdit":
      return "蒙版局部编辑（当前 Provider 不可用）";
  }
}

function imageRolePolicy(role: VisualIntentItem["role"]): { label: string; instruction: string } {
  switch (role) {
    case "sceneVisual":
      return {
        label: "使用场景",
        instruction: "让环境、人物和光线解释真实使用情境，同时保持产品主体可辨识且不改变核心结构。场景要体现尺度、动作和人与产品的真实关系（谁在用、在哪里、怎么拿/放/操作），不是把产品放进漂亮背景。"
      };
    case "cmfStudy":
      return {
        label: "CMF 研究",
        instruction: "重点比较材料、颜色、表面工艺和分区关系，保持产品几何与关键部件位置稳定。"
      };
    case "detailStudy":
      return {
        label: "关键细节",
        instruction: "聚焦指定连接、界面、构造或触点，以清晰近景解释细节，不重新设计无关部分。"
      };
    case "structureDiagram":
    case "interactionDiagram":
      return {
        label: "设计示意",
        instruction: "用清晰、克制的设计表达解释结构或交互逻辑，避免把示意图做成营销海报。"
      };
    case "primaryVisual":
      return {
        label: "主视觉",
        instruction: "稳定主体比例、架构和关键部件，以清晰完整的产品表达收束当前路线。"
      };
    case "conceptImage":
    case "preview":
      return {
        label: "方向预览 / 继续发展",
        instruction: "清楚展示方向的产品架构、比例和形态语言差异，避免只换背景、颜色或灯光。"
      };
    case "reference":
    case "deliveryAsset":
      return {
        label: "项目视觉素材",
        instruction: "按当前任务形成可追溯的新视觉对象，保持与指定来源和项目约束一致。"
      };
  }
}

function modelAdapterInstruction(modelId: string): string {
  if (/gpt-image/i.test(modelId)) {
    return "模型适配：使用明确的空间、材质、光线和保留/变化边界描述；文字元素仅在用户明确要求时出现。";
  }
  if (/nano-banana/i.test(modelId)) {
    return "模型适配：保持指令紧凑直接，先描述主体和结构，再描述本轮变化、视角、材质与场景。";
  }
  return "模型适配：遵循主体、保留项、变化项、构图、材质、场景和避免项的顺序。";
}

function memorySection(
  title: string,
  sections: Array<{ title: string; items: string[] }> | undefined
): string {
  const items = sections?.flatMap((section) => section.items.map((item) => `${section.title}：${item}`)) ?? [];
  return items.length > 0 ? `${title}：\n- ${items.join("\n- ")}` : "";
}

function list(title: string, values: readonly string[]): string {
  const items = values.map((value) => value.trim()).filter(Boolean);
  return items.length > 0 ? `${title}：${items.join("；")}` : "";
}

function line(title: string, value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? `${title}：${normalized}` : "";
}
