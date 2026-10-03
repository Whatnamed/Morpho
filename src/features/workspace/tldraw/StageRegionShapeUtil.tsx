"use client";

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  T,
  resizeBox,
  track,
  useEditor,
  type Geometry2d,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
  type TLShapePartial
} from "tldraw";
import { LockKeyhole } from "lucide-react";
import type { CSSProperties } from "react";

import type { StageRegionBorderStyle, StageRegionColorKey, StageRegionKey, StageRegionRecord } from "@/domain/morpho/types";
import { getStageRegionColorPreset, normalizeStageRegionRecord } from "@/domain/morpho/stageRegions";

export const STAGE_REGION_SHAPE_TYPE = "stageRegion";

type StageRegionShapeProps = {
  w: number;
  h: number;
  stageKey: StageRegionKey;
  title: string;
  memberObjectIds: string[];
  colorKey: StageRegionColorKey;
  fillOpacity: number;
  backgroundVisible: boolean;
  borderStyle: StageRegionBorderStyle;
  locked: boolean;
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
  const normalized = normalizeStageRegionRecord(record);
  return {
    id: `shape:${normalized.id}` as StageRegionShape["id"],
    type: STAGE_REGION_SHAPE_TYPE,
    x: normalized.x,
    y: normalized.y,
    // Do not use tldraw's native lock here: native locked shapes cannot be
    // selected again with the default editor options, which would strand this
    // stage's unlock control. The custom `locked` prop blocks drag and resize.
    isLocked: false,
    props: {
      w: normalized.w,
      h: normalized.h,
      stageKey: normalized.key,
      title: normalized.title,
      memberObjectIds: [...normalized.memberObjectIds],
      colorKey: normalized.colorKey,
      fillOpacity: normalized.fillOpacity,
      backgroundVisible: normalized.backgroundVisible,
      borderStyle: normalized.borderStyle,
      locked: normalized.locked
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
    memberObjectIds: T.arrayOf(T.string),
    colorKey: T.literalEnum("warmSand", "mistBlue", "sage", "violetGray", "clay", "warmGray"),
    fillOpacity: T.number,
    backgroundVisible: T.boolean,
    borderStyle: T.literalEnum("none", "solid", "dashed"),
    locked: T.boolean
  };

  override canEdit = () => false;
  override canScroll = () => false;
  override canBind = () => false;
  override canReceiveNewChildrenOfType = () => false;
  override isAspectRatioLocked = () => false;
  override hideRotateHandle = () => true;
  override canResize = (shape: StageRegionShape) => !shape.props.locked;

  getDefaultProps(): StageRegionShapeProps {
    return {
      w: 400,
      h: 320,
      stageKey: "research",
      title: "资料与研究",
      memberObjectIds: [],
      colorKey: "warmSand",
      fillOpacity: 16,
      backgroundVisible: true,
      borderStyle: "solid",
      locked: false
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

  /** A region drag moves only the landmark. Select members explicitly for a joint drag. */
  override onTranslate = (initial: StageRegionShape, current: StageRegionShape) => {
    if (current.props.locked) return { id: current.id, type: "stageRegion" as const, x: initial.x, y: initial.y };
  };

  override component(shape: StageRegionShape) {
    return <StageRegionCard shape={shape} />;
  }

  override getIndicatorPath(shape: StageRegionShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

const StageRegionCard = track(function StageRegionCard({ shape }: { shape: StageRegionShape }) {
  const editor = useEditor();
  const selected = editor.getSelectedShapes();
  const memberCount = selected.filter((candidate) => candidate.type === "morpho-object" && shape.props.memberObjectIds.includes(candidate.props.objectId)).length;
  const jointlySelected = selected.some((candidate) => candidate.id === shape.id) && memberCount > 0;
  const color = getStageRegionColorPreset(shape.props.colorKey);
  const fill = shape.props.backgroundVisible ? `color-mix(in srgb, ${color.fill} ${shape.props.fillOpacity}%, transparent)` : "transparent";
  const borderColor = shape.props.borderStyle === "none" ? "transparent" : color.border;
  return (
    <HTMLContainer
      className={`stage-region-shape stage-region-${shape.props.stageKey} is-border-${shape.props.borderStyle}`}
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "all",
        "--stage-region-fill": fill,
        "--stage-region-border": borderColor,
        "--stage-region-title": color.title
      } as CSSProperties}
    >
      <div className="stage-region-wash" aria-hidden="true" />
      <div className="stage-region-title">
        <span>{shape.props.title}</span>
        <span className="drawer-muted">{jointlySelected ? `拖动地标与 ${memberCount} 个已选成员一起移动` : "拖动仅移动地标"}</span>
        {shape.props.locked ? <LockKeyhole size={11} aria-label="已锁定分区" /> : null}
      </div>
    </HTMLContainer>
  );
});
