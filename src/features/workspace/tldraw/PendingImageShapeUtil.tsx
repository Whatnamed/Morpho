"use client";

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  T,
  type Geometry2d,
  type RecordProps,
  type TLShape,
  type TLShapePartial
} from "tldraw";

import type { PendingImageGenerationSlot } from "../pendingImageGenerationSlots";

export const PENDING_IMAGE_SHAPE_TYPE = "pendingImage";

type PendingImageShapeProps = {
  w: number;
  h: number;
  slotId: string;
  title: string;
  roleLabel: string;
};

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [PENDING_IMAGE_SHAPE_TYPE]: PendingImageShapeProps;
  }
}

export type PendingImageShape = TLShape<typeof PENDING_IMAGE_SHAPE_TYPE>;

export function isPendingImageShape(shape: TLShape): shape is PendingImageShape {
  return shape.type === PENDING_IMAGE_SHAPE_TYPE;
}

export function pendingImageShapeId(slotId: string): PendingImageShape["id"] {
  return `shape:pending-${slotId}` as PendingImageShape["id"];
}

export function pendingSlotRoleLabel(role: string): string {
  switch (role) {
    case "sceneVisual":
      return "正在生成场景图";
    case "detailStudy":
      return "正在生成细节图";
    case "cmfStudy":
      return "正在生成 CMF";
    case "conceptImage":
      return "正在生成概念图";
    case "preview":
      return "正在生成预览";
    default:
      return "正在生成";
  }
}

export function createPendingImageShapePartial(slot: PendingImageGenerationSlot): TLShapePartial<PendingImageShape> {
  return {
    id: pendingImageShapeId(slot.id),
    type: PENDING_IMAGE_SHAPE_TYPE,
    x: slot.position.x,
    y: slot.position.y,
    // Locked + non-interactive: ephemeral placeholder, not a Morpho object.
    isLocked: true,
    props: {
      w: slot.size.w,
      h: slot.size.h,
      slotId: slot.id,
      title: slot.title,
      roleLabel: pendingSlotRoleLabel(slot.role)
    }
  };
}

/**
 * Page-space loading card that rides the tldraw camera like real image objects.
 * Not persisted to Morpho workspace.
 */
export class PendingImageShapeUtil extends BaseBoxShapeUtil<PendingImageShape> {
  static override type = PENDING_IMAGE_SHAPE_TYPE;

  static override props: RecordProps<PendingImageShape> = {
    w: T.number,
    h: T.number,
    slotId: T.string,
    title: T.string,
    roleLabel: T.string
  };

  override canEdit = () => false;
  override canScroll = () => false;
  override canBind = () => false;
  override canReceiveNewChildrenOfType = () => false;
  override isAspectRatioLocked = () => true;
  override hideRotateHandle = () => true;
  override canResize = () => false;

  getDefaultProps(): PendingImageShapeProps {
    return {
      w: 280,
      h: 280,
      slotId: "",
      title: "生成中",
      roleLabel: "正在生成"
    };
  }

  getGeometry(shape: PendingImageShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true
    });
  }

  override component(shape: PendingImageShape) {
    return (
      <HTMLContainer
        className="pending-generation-shape"
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: "none"
        }}
      >
        <div className="pending-generation-slot" aria-busy="true" aria-label={`${shape.props.roleLabel}：${shape.props.title}`}>
          <span className="pending-generation-shimmer" aria-hidden="true" />
          <span className="pending-generation-grain" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <div className="pending-generation-copy">
            <span>{shape.props.roleLabel}</span>
            <strong>{shape.props.title}</strong>
          </div>
        </div>
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: PendingImageShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

type PendingSlotEditor = {
  getCurrentPageShapes: () => TLShape[];
  createShapes: (partials: TLShapePartial[]) => unknown;
  updateShapes: (partials: TLShapePartial[]) => unknown;
  deleteShapes: (ids: TLShape["id"][]) => unknown;
  run: (fn: () => void, opts?: { history: "ignore"; ignoreShapeLock?: boolean }) => unknown;
};

export function syncPendingImageSlotsToEditor(
  editor: PendingSlotEditor,
  slots: PendingImageGenerationSlot[],
  runOptions: { history: "ignore" }
) {
  const existing = editor.getCurrentPageShapes().filter(isPendingImageShape);
  const bySlotId = new Map(existing.map((shape) => [shape.props.slotId, shape]));
  const nextIds = new Set(slots.map((slot) => slot.id));
  const toDelete = existing.filter((shape) => !nextIds.has(shape.props.slotId)).map((shape) => shape.id);
  const toCreate: TLShapePartial[] = [];
  const toUpdate: TLShapePartial[] = [];

  for (const slot of slots) {
    const partial = createPendingImageShapePartial(slot);
    const current = bySlotId.get(slot.id);
    if (!current) {
      toCreate.push(partial);
      continue;
    }
    if (
      Math.abs(current.x - slot.position.x) > 0.01 ||
      Math.abs(current.y - slot.position.y) > 0.01 ||
      Math.abs(current.props.w - slot.size.w) > 0.01 ||
      Math.abs(current.props.h - slot.size.h) > 0.01 ||
      current.props.title !== slot.title ||
      current.props.roleLabel !== pendingSlotRoleLabel(slot.role)
    ) {
      toUpdate.push({
        id: current.id,
        type: PENDING_IMAGE_SHAPE_TYPE,
        x: slot.position.x,
        y: slot.position.y,
        props: {
          w: slot.size.w,
          h: slot.size.h,
          slotId: slot.id,
          title: slot.title,
          roleLabel: pendingSlotRoleLabel(slot.role)
        }
      });
    }
  }

  if (toCreate.length === 0 && toUpdate.length === 0 && toDelete.length === 0) {
    return;
  }

  editor.run(() => {
    if (toCreate.length > 0) {
      editor.createShapes(toCreate);
    }
    if (toUpdate.length > 0) {
      editor.updateShapes(toUpdate);
    }
    if (toDelete.length > 0) {
      editor.deleteShapes(toDelete);
    }
  }, { ...runOptions, ignoreShapeLock: true });
}
