import type { CanvasPoint } from "../../domain/morpho/types";

export type PendingImageGenerationSlot = {
  id: string;
  operationId: string;
  planItemId: string;
  title: string;
  role: string;
  position: CanvasPoint;
  size: { w: number; h: number };
};

export function buildPendingImageGenerationSlots(input: {
  operationId: string;
  items: Array<{ id: string; title: string; role: string }>;
  placements: ReadonlyMap<string, CanvasPoint>;
  size: { w: number; h: number };
}): PendingImageGenerationSlot[] {
  return input.items.flatMap((item): PendingImageGenerationSlot[] => {
    const position = input.placements.get(item.id);
    if (!position) {
      return [];
    }

    return [
      {
        id: `${input.operationId}:${item.id}`,
        operationId: input.operationId,
        planItemId: item.id,
        title: item.title,
        role: item.role,
        position: { ...position },
        size: { ...input.size }
      }
    ];
  });
}

export function removePendingImageGenerationSlot(
  slots: PendingImageGenerationSlot[],
  operationId: string,
  planItemId: string
): PendingImageGenerationSlot[] {
  return slots.filter((slot) => slot.operationId !== operationId || slot.planItemId !== planItemId);
}
