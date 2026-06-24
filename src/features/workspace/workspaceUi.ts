import type { ImageRole, MorphoObject, MorphoObjectId } from "@/domain/morpho/types";

export type Suggestion = {
  label: string;
  prompt: string;
};

export function getObjectTypeLabel(object: MorphoObject): string {
  switch (object.type) {
    case "image":
      return object.isDefaultReference ? "后续默认参考" : imageRoleLabel(object.role);
    case "file":
      return object.fileKind === "imageSet" ? "资料合集" : "文件";
    case "text":
      return "文本";
    case "link":
      return "链接";
    case "imageCollection":
      return "图片合集";
    case "research":
      return "研究与分析";
    case "insight":
      return "关键结论";
    case "designDefinition":
      return "设计定义";
    case "conceptDirection":
      return directionStatusLabel(object.status);
    case "delivery":
      return "交付准备";
  }
}

export function imageRoleLabel(role: ImageRole): string {
  switch (role) {
    case "reference":
      return "参考图";
    case "preview":
      return "预览";
    case "main":
      return "主图";
    case "scenario":
      return "场景";
    case "cmf":
      return "CMF";
    case "detail":
      return "细节";
    case "diagram":
      return "设计示意";
    default:
      return "图片";
  }
}

export function directionStatusLabel(status: string): string {
  switch (status) {
    case "pendingPreview":
      return "待预览";
    case "primary":
      return "主方向";
    case "alternative":
      return "备选";
    case "eliminated":
      return "已淘汰";
    case "needsReview":
      return "待复核";
    default:
      return "方向";
  }
}

export function getSuggestionsForSelection(objects: MorphoObject[]): Suggestion[] {
  if (objects.length === 0) {
    return [];
  }

  if (objects.length > 1) {
    return [
      {
        label: "比较这些方案",
        prompt: "比较这些对象在连续支撑、居家感和安装复杂度上的差异，并说明各自适合继续发展的部分。"
      },
      {
        label: "找共同线索",
        prompt: "从这些对象里找出共同线索，说明哪些内容可以成为后续方向的稳定依据。"
      },
      {
        label: "作为多参考生成",
        prompt: "把这些对象作为多参考，生成一组保持低施工与居家语气的新视觉方向。"
      }
    ];
  }

  const [object] = objects;
  switch (object.type) {
    case "image":
      return [
        {
          label: "继续发展",
          prompt: `基于“${object.title}”继续发展，保留低位导向与暖光氛围。`
        },
        {
          label: "局部修改",
          prompt: "保留整体比例与柔光轨道语言，把转角连接件做得更一体化、少一些外露五金感。"
        },
        {
          label: "生成使用场景",
          prompt: `基于“${object.title}”生成夜间使用场景，保持普通居家空间和低干扰照明。`
        },
        {
          label: "设为后续默认参考",
          prompt: `将“${object.title}”设为后续默认参考，但不要替换已有图或交付引用。`
        }
      ];
    case "file":
      return [
        {
          label: "读取并整理要求",
          prompt: `读取“${object.title}”，整理项目要求、限制和需要确认的问题。`
        },
        {
          label: "提取项目限制",
          prompt: `从“${object.title}”中提取会影响夜航方案的现实限制。`
        }
      ];
    case "text":
      return [
        {
          label: "整理为说明",
          prompt: `整理“${object.title}”中的可用信息，提取对当前项目有帮助的线索。`
        }
      ];
    case "link":
      return [
        {
          label: "说明来源价值",
          prompt: `基于链接“${object.title}”的标题和摘要，说明它可能支持当前项目的哪些判断。`
        }
      ];
    case "imageCollection":
      return [
        {
          label: "比较合集成员",
          prompt: `比较“${object.title}”中的图片成员，找出共同线索和差异。`
        }
      ];
    case "research":
      return [
        {
          label: "保留关键结论",
          prompt: "从这份研究与分析里挑出值得保留为关键结论的内容，并说明证据边界。"
        },
        {
          label: "继续补资料",
          prompt: "指出这份研究与分析还缺哪些居家路径资料。"
        }
      ];
    case "insight":
    case "designDefinition":
    case "conceptDirection":
      return [
        {
          label: "生成预览",
          prompt: `基于“${object.title}”生成有差异的方向预览，不要自动设为主方向。`
        },
        {
          label: "检查关系",
          prompt: `检查“${object.title}”和当前设计定义、主方向之间的关系。`
        }
      ];
    case "delivery":
      return [
        {
          label: "检查交付缺口",
          prompt: `检查“${object.title}”目前还缺哪些素材、图注和说明。`
        },
        {
          label: "整理本页内容",
          prompt: `整理“${object.title}”的内容结构，但不要做最终展板排版。`
        }
      ];
  }
}

export function compactObjectList(objects: Record<MorphoObjectId, MorphoObject>, ids: MorphoObjectId[]) {
  return ids
    .map((id) => objects[id])
    .filter((object): object is MorphoObject => Boolean(object) && object.visibility === "active");
}
