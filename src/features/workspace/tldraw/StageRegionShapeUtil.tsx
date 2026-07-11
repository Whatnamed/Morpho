"use client";

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  T,
  resizeBox,
  type Geometry2d,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
  type TLShapePartial
} from "tldraw";

import type { StageRegionKey, StageRegionRecord } from "@/domain/morpho/types";

export const STAGE_REGION_SHAPE_TYPE = "stageRegion";

type StageRegionShapeProps = {
  w: number;
  h: number;
  stageKey: StageRegionKey;
  title: string;
  memberObjectIds: string[];
};

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [STAGE_REGION_SHAPE_TYPE]: StageRegionShapeProps;
  }
}

export type StageRegionShape = TLShape<typeof STAGE_REGION_SHAPE_TYPE>;

export function isStageRegionShape(shape: TLShape): shape is StageRegionShape {
  return shape.type === STAGE_REGION_SHAPE_TYPE;
}

export function createStageRegionShapePartial(record: StageRegionRecord): TLShapePartial<StageRegionShape> {
  return {
    id: `shape:${record.id}` as StageRegionShape["id"],
    type: STAGE_REGION_SHAPE_TYPE,
    x: record.x,
    y: record.y,
    props: {
      w: record.w,
      h: record.h,
      stageKey: record.key,
      title: record.title,
      memberObjectIds: [...record.memberObjectIds]
    }
  };
}

/**
 * Lightweight page-space landmark. Not a MorphoObject, not a tldraw Frame
 * (no auto reparent / drag-in membership).
 */
export class StageRegionShapeUtil extends BaseBoxShapeUtil<StageRegionShape> {
  static override type = STAGE_REGION_SHAPE_TYPE;

  static override props: RecordProps<StageRegionShape> = {
    w: T.number,
    h: T.number,
    stageKey: T.literalEnum("research", "definition", "visual", "delivery"),
    title: T.string,
    memberObjectIds: T.arrayOf(T.string)
  };

  override canEdit = () => false;
  override canScroll = () => false;
  override canBind = () => false;
  override canReceiveNewChildrenOfType = () => false;
  override isAspectRatioLocked = () => false;
  override hideRotateHandle = () => true;

  getDefaultProps(): StageRegionShapeProps {
    return {
      w: 400,
      h: 320,
      stageKey: "research",
      title: "资料与研究",
      memberObjectIds: []
    };
  }

  getGeometry(shape: StageRegionShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true
    });
  }

  override onResize(shape: StageRegionShape, info: TLResizeInfo<StageRegionShape>) {
    return resizeBox(shape, info, {
      minWidth: 280,
      minHeight: 220
    });
  }

  /**
   * Move explicit members by the same delta inside one interactive translate.
   * tldraw batches the drag into a single history entry with these updates.
   */
  override onTranslate = (initial: StageRegionShape, current: StageRegionShape) => {
    const dx = current.x - initial.x;
    const dy = current.y - initial.y;
    if (dx === 0 && dy === 0) {
      return;
    }

    const members = new Set(current.props.memberObjectIds);
    if (members.size === 0) {
      return;
    }

    // Relative step from previous frame: current already moved; members need the
    // same step as this frame. We compute against the last applied position stored
    // on the util instance.
    const last = this.lastTranslateByShapeId.get(current.id) ?? { x: initial.x, y: initial.y };
    const stepX = current.x - last.x;
    const stepY = current.y - last.y;
    this.lastTranslateByShapeId.set(current.id, { x: current.x, y: current.y });
    if (stepX === 0 && stepY === 0) {
      return;
    }

    const updates: TLShapePartial[] = [];
    for (const shape of this.editor.getCurrentPageShapes()) {
      if (shape.type !== "morpho-object") {
        continue;
      }
      const objectId = (shape.props as { objectId?: string }).objectId;
      if (!objectId || !members.has(objectId)) {
        continue;
      }
      updates.push({
        id: shape.id,
        type: shape.type,
        x: shape.x + stepX,
        y: shape.y + stepY
      });
    }
    if (updates.length > 0) {
      this.editor.updateShapes(updates);
    }
  };

  override onTranslateStart = (shape: StageRegionShape) => {
    this.lastTranslateByShapeId.set(shape.id, { x: shape.x, y: shape.y });
  };

  override onTranslateEnd = (initial: StageRegionShape, current: StageRegionShape) => {
    this.lastTranslateByShapeId.delete(current.id);
    void initial;
  };

  private lastTranslateByShapeId = new Map<string, { x: number; y: number }>();

  override component(shape: StageRegionShape) {
    return (
      <HTMLContainer
        className={`stage-region-shape stage-region-${shape.props.stageKey}`}
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: "all"
        }}
      >
        <div className="stage-region-wash" aria-hidden="true" />
        <div className="stage-region-title">{shape.props.title}</div>
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: StageRegionShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
