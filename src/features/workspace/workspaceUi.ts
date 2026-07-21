import type { AiWorkIntent, ImageRole, MorphoObject, MorphoObjectId } from "@/domain/morpho/types";

export type Suggestion = {
  label: string;
  prompt: string;
  workIntent?: AiWorkIntent;
};

type SuggestionContext = {
  hasCurrentDesignDefinition?: boolean;
};

export function getObjectTypeLabel(object: MorphoObject): string {
  switch (object.type) {
    case "image":
      return object.isDefaultReference ? "后续默认参考" : imageRoleLabel(object.role);
    case "file":
      return object.fileKind === "imageSet" ? "资料集合" : "文件";
    case "text":
      return "文本";
    case "link":
      return "链接";
    case "imageCollection":
      return "图片合集";
    case "research":
      return "研究与分析";
    case "documentFragment":
      return "文档片段";
    case "keyConclusion":
      return "关键结论";
    case "proposalDraft":
      return "待确认草案";
    case "designDefinition":
      return "设计定义";
    case "conceptDirection":
      return directionStatusLabel(object.status);
    case "delivery":
      return "交付准备";
    default:
      return "对象";
  }
}

export function imageRoleLabel(role: ImageRole): string {
  switch (role) {
    case "reference":
      return "参考图";
    case "preview":
      return "预览";
    case "conceptImage":
      return "概念图";
    case "primaryVisual":
      return "主视觉";
    case "sceneVisual":
      return "场景视觉";
    case "cmfStudy":
      return "CMF 研究";
    case "detailStudy":
      return "细节研究";
    case "structureDiagram":
      return "结构示意";
    case "interactionDiagram":
      return "交互示意";
    case "deliveryAsset":
      return "交付素材";
    default:
      return "图片";
  }
}

export function directionStatusLabel(status: string): string {
  switch (status) {
    case "pendingPreview":
      return "待预览方向";
    case "primary":
      return "主方向";
    case "alternative":
      return "备选方向";
    case "eliminated":
      return "已淘汰方向";
    case "needsReview":
      return "待复核方向";
    default:
      return "方向";
  }
}

export function getSuggestionsForSelection(objects: MorphoObject[], context: SuggestionContext = {}): Suggestion[] {
  const revisesCurrentDesignDefinition = Boolean(context.hasCurrentDesignDefinition);
  const designDefinitionIntent: AiWorkIntent = revisesCurrentDesignDefinition
    ? "reviseDesignDefinition"
    : "createDesignDefinition";

  if (objects.length === 0) {
    return [];
  }

  if (objects.length > 1) {
    return [
      {
        label: "比较这些对象",
        prompt: "比较这些对象在当前项目中的价值、差异和风险，并说明下一步最值得继续发展的部分。",
        workIntent: "comparison"
      },
      {
        label: "提炼共同线索",
        prompt: "从这些对象里提炼共同线索，说明哪些内容可以成为更稳定的项目依据。"
      },
      {
        label: "生成多参考方向",
        prompt: "把这些对象作为明确参考，生成几条有差异的后续方向建议，但不要自动改项目状态。",
        workIntent: "createConceptDirections"
      }
    ];
  }

  const [object] = objects;

  switch (object.type) {
    case "image":
      return [
        {
          label: "继续发展",
          prompt: `基于“${object.title}”继续发展，保留当前结构语言和整体气质。`
        },
        {
          label: "定向修改",
          prompt: `保留“${object.title}”的整体比例和主要结构，只调整局部细节，让它更完整。`
        },
        {
          label: "生成使用场景",
          prompt: `基于“${object.title}”生成一个更真实的使用场景，但不要改变这个对象的项目状态。`
        },
        {
          label: "设为后续默认参考",
          prompt: `将“${object.title}”设为后续默认参考，但不要替换已有图片、版本链或交付引用。`
        }
      ];
    case "file":
      return [
        {
          label: "整理资料重点",
          prompt: `基于“${object.title}”整理当前可用的资料重点、限制和待确认问题。`
        },
        {
          label: "补充研究问题",
          prompt: `围绕“${object.title}”补充下一轮研究最值得验证的问题。`
        }
      ];
    case "text":
      return [
        {
          label: "整理为研究依据",
          prompt: `把“${object.title}”整理成更清晰的研究依据或项目输入。`
        },
        {
          label: revisesCurrentDesignDefinition ? "继续修改定义" : "形成设计定义",
          prompt: revisesCurrentDesignDefinition
            ? `基于“${object.title}”以及当前设计定义，形成一版设计定义修订草案。`
            : `基于“${object.title}”形成一版可确认的设计定义草案。`,
          workIntent: designDefinitionIntent
        }
      ];
    case "link":
      return [
        {
          label: "说明来源价值",
          prompt: `结合“${object.title}”的标题、链接和摘要，说明它对当前项目的价值与边界。`
        },
        {
          label: "补充可验证信息",
          prompt: `围绕“${object.title}”补充当前最需要验证的信息，但不要自动写入项目事实。`
        }
      ];
    case "imageCollection":
      return [
        {
          label: "比较合集成员",
          prompt: `比较“${object.title}”中的成员，找出共性、差异和可以继续发展的部分。`
        }
      ];
    case "research":
      return [
        {
          label: "保留关键结论",
          prompt: `从“${object.title}”中提炼值得保留为关键结论的内容，并说明证据边界。`
        },
        {
          label: revisesCurrentDesignDefinition ? "继续修改定义" : "形成设计定义",
          prompt: revisesCurrentDesignDefinition
            ? `基于“${object.title}”以及当前已有定义依据，形成一版设计定义修订草案。`
            : `基于“${object.title}”以及当前已有依据，形成一版设计定义草案。`,
          workIntent: designDefinitionIntent
        },
        {
          label: "生成多个方向",
          prompt: `基于“${object.title}”以及当前设计定义，提出几个真正有差异的概念方向草案。`,
          workIntent: "createConceptDirections"
        }
      ];
    case "keyConclusion":
      return [
        {
          label: revisesCurrentDesignDefinition ? "继续修改定义" : "形成设计定义",
          prompt: revisesCurrentDesignDefinition
            ? `基于“${object.title}”以及当前已确认结论，形成一版设计定义修订草案。`
            : `基于“${object.title}”以及当前已确认结论，形成一版设计定义草案。`,
          workIntent: designDefinitionIntent
        },
        {
          label: "生成方向草案",
          prompt: `基于“${object.title}”以及当前设计定义，提出几个概念方向草案。`,
          workIntent: "createConceptDirections"
        }
      ];
    case "designDefinition":
      return [
        {
          label: "检查定义缺口",
          prompt: `检查“${object.title}”目前还缺哪些约束、边界或待验证问题。`,
          workIntent: "reviseDesignDefinition"
        },
        {
          label: "生成方向草案",
          prompt: `基于“${object.title}”提出几个策略差异清楚的概念方向草案。`,
          workIntent: "createConceptDirections"
        }
      ];
    case "conceptDirection":
      return [
        {
          label: "继续发展这个方向",
          prompt: `围绕“${object.title}”继续发展，说明它最值得保留和最需要修正的部分。`,
          workIntent: "reviseConceptDirection"
        },
        {
          label: "比较与当前定义",
          prompt: `比较“${object.title}”与当前设计定义的契合点、偏离点和下一步建议。`,
          workIntent: "comparison"
        }
      ];
    case "delivery":
      return [
        {
          label: "检查交付缺口",
          prompt: `检查“${object.title}”还缺哪些内容、说明或引用。`
        },
        {
          label: "整理交付结构",
          prompt: `整理“${object.title}”的内容结构，但不要做最终排版。`
        }
      ];
    default:
      return [];
  }
}

export function compactObjectList(objects: Record<MorphoObjectId, MorphoObject>, ids: MorphoObjectId[]) {
  return ids
    .map((id) => objects[id])
    .filter((object): object is MorphoObject => Boolean(object) && object.visibility === "active");
}
