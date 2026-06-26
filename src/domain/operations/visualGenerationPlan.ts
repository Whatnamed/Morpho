import type { ImageRole, MorphoObjectId, MorphoWorkspace } from "../morpho/types";
import type { VisualGenerationPlan, VisualGenerationPlanItem } from "./types";

export type ParseVisualGenerationPlanResult =
  | {
      status: "ok";
      plan: VisualGenerationPlan;
    }
  | {
      status: "failed";
      reason: string;
    };

export type ValidateVisualGenerationPlanInput = {
  plan: VisualGenerationPlan;
  allowedObjectIds: string[];
  selectedDirectionIds: string[];
  selectedImageIds: string[];
};

export type ValidateVisualGenerationPlanResult =
  | {
      status: "ok";
      plan: VisualGenerationPlan;
    }
  | {
      status: "blocked";
      reason: string;
    };

const ALLOWED_IMAGE_ROLES: ImageRole[] = ["conceptImage", "sceneVisual", "cmfStudy", "detailStudy", "preview"];

export function parseVisualGenerationPlanPayload(text: string): ParseVisualGenerationPlanResult {
  const jsonText = extractJsonBlock(text);
  if (!jsonText) {
    return { status: "failed", reason: "No structured Morpho visual generation plan JSON block was returned." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { status: "failed", reason: "The Morpho visual generation plan JSON block was not valid JSON." };
  }

  if (!isRecord(parsed) || !isRecord(parsed.morphoVisualGenerationPlan)) {
    return { status: "failed", reason: "The JSON block did not contain morphoVisualGenerationPlan." };
  }

  const rawPlan = parsed.morphoVisualGenerationPlan;
  const kind =
    rawPlan.kind === "directionPreview" || rawPlan.kind === "visualDevelopment" ? rawPlan.kind : "visualDevelopment";
  const items = parsePlanItems(rawPlan.items);
  if (items.length === 0) {
    return { status: "failed", reason: "The visual generation plan did not include valid items." };
  }

  return {
    status: "ok",
    plan: {
      kind,
      items
    }
  };
}

export function validateVisualGenerationPlan(
  workspace: MorphoWorkspace,
  input: ValidateVisualGenerationPlanInput
): ValidateVisualGenerationPlanResult {
  const allowedObjectIds = new Set(input.allowedObjectIds);
  const selectedDirectionIds = new Set(input.selectedDirectionIds);
  const selectedImageIds = new Set(input.selectedImageIds);
  const sanitizedItems: VisualGenerationPlanItem[] = [];

  if (input.plan.kind === "directionPreview" && input.plan.items.length > 3) {
    return { status: "blocked", reason: "方向预览首版最多一次生成 3 张图。" };
  }

  if (input.plan.kind === "directionPreview" && input.plan.items.length !== selectedDirectionIds.size) {
    return { status: "blocked", reason: "方向预览计划必须与已选方向一一对应。" };
  }

  for (const item of input.plan.items) {
    if (item.referenceObjectIds.some((objectId) => !allowedObjectIds.has(objectId))) {
      return { status: "blocked", reason: "视觉计划引用了本次未授权的对象 ID。" };
    }

    if (item.targetDirectionId) {
      const direction = workspace.objects[item.targetDirectionId];
      if (!direction || direction.type !== "conceptDirection" || direction.visibility !== "active") {
        return { status: "blocked", reason: "视觉计划引用了不可用的目标方向。" };
      }
    }

    if (input.plan.kind === "directionPreview") {
      if (!item.targetDirectionId || !selectedDirectionIds.has(item.targetDirectionId)) {
        return { status: "blocked", reason: "方向预览计划必须一张图对应一个已选概念方向。" };
      }
      if (item.visualBranchId) {
        return { status: "blocked", reason: "方向首张预览图不能自动创建或绑定视觉分支。" };
      }
    }

    if (input.plan.kind === "visualDevelopment") {
      if (selectedImageIds.size > 0 && item.referenceObjectIds.every((objectId) => !selectedImageIds.has(objectId))) {
        return { status: "blocked", reason: "图片视觉迭代必须引用至少一张已选来源图。" };
      }

      const referenceDirections = item.referenceObjectIds
        .map((objectId) => workspace.objects[objectId])
        .filter((object) => object?.type === "image")
        .map((object) => object.directionId)
        .filter((directionId): directionId is MorphoObjectId => Boolean(directionId));
      const uniqueReferenceDirections = [...new Set(referenceDirections)];
      if (!item.targetDirectionId && uniqueReferenceDirections.length > 1) {
        return { status: "blocked", reason: "图片来源跨多个方向时必须明确目标方向。" };
      }
      if (item.targetDirectionId && uniqueReferenceDirections.some((directionId) => directionId !== item.targetDirectionId)) {
        return { status: "blocked", reason: "视觉计划不能把其他方向的图片作为当前方向生成来源。" };
      }
    }

    if (item.visualBranchId) {
      const branch = workspace.visualBranches[item.visualBranchId];
      if (!branch || branch.archivedAt || (item.targetDirectionId && branch.directionId !== item.targetDirectionId)) {
        return { status: "blocked", reason: "视觉计划引用了不可用或跨方向的视觉分支。" };
      }
    }

    sanitizedItems.push({
      ...item,
      role: ALLOWED_IMAGE_ROLES.includes(item.role) ? item.role : inferImageRole(item.prompt)
    });
  }

  if (input.plan.kind === "directionPreview") {
    const targets = sanitizedItems.map((item) => item.targetDirectionId);
    if (new Set(targets).size !== sanitizedItems.length) {
      return { status: "blocked", reason: "方向预览计划不能为同一方向重复生成首版预览。" };
    }
  }

  return {
    status: "ok",
    plan: {
      ...input.plan,
      items: sanitizedItems
    }
  };
}

export function inferImageRole(prompt: string): ImageRole {
  if (/场景|scenario|使用情境/i.test(prompt)) {
    return "sceneVisual";
  }
  if (/cmf|材质|颜色|工艺/i.test(prompt)) {
    return "cmfStudy";
  }
  if (/细节|detail|连接|结构/i.test(prompt)) {
    return "detailStudy";
  }
  if (/概念|方向|preview|预览/i.test(prompt)) {
    return "conceptImage";
  }
  return "preview";
}

function extractJsonBlock(text: string): string | undefined {
  const fencedBlocks = Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))
    .map((match) => match[1]?.trim())
    .filter(Boolean);
  return fencedBlocks.find((block) => {
    if (!block) {
      return false;
    }

    try {
      const parsed = JSON.parse(block) as unknown;
      return isRecord(parsed) && isRecord(parsed.morphoVisualGenerationPlan);
    } catch {
      return false;
    }
  });
}

function parsePlanItems(value: unknown): VisualGenerationPlanItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item, index) => {
      const prompt = stringValue(item.prompt);
      return {
        id: stringValue(item.id) || `visual-plan-item-${index + 1}`,
        targetDirectionId: stringValue(item.targetDirectionId) || undefined,
        visualBranchId: stringValue(item.visualBranchId) || undefined,
        title: stringValue(item.title),
        purpose: stringValue(item.purpose),
        prompt,
        referenceObjectIds: stringArray(item.referenceObjectIds),
        role: parseImageRole(item.role) ?? inferImageRole(prompt)
      };
    })
    .filter((item) => item.title && item.purpose && item.prompt);
}

function parseImageRole(value: unknown): ImageRole | undefined {
  return typeof value === "string" && ALLOWED_IMAGE_ROLES.includes(value as ImageRole) ? (value as ImageRole) : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
