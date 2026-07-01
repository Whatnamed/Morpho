"use client";

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  T,
  createShapeId,
  resizeBox,
  type Geometry2d,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
  type TLShapePartial
} from "tldraw";

import type { CanvasInstance, MorphoObject, MorphoObjectType, MorphoWorkspace } from "../../../domain/morpho/types";
import { hasPendingDesignDefinitionRevisionProposal } from "../../../domain/morpho/derivedState";
import { getObjectTypeLabel } from "../workspaceUi";

export const MORPHO_SHAPE_TYPE = "morpho-object";

type MorphoShapeProps = {
  w: number;
  h: number;
  objectId: string;
  instanceId: string;
  morphoType: MorphoObjectType;
  title: string;
  summary: string;
  label: string;
  details: string[];
  imageVariant?: string;
  isDefaultReference?: boolean;
  isBeingLocallyEdited?: boolean;
  isInDesignTrace?: boolean;
  assetUrl?: string;
};

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [MORPHO_SHAPE_TYPE]: MorphoShapeProps;
  }
}

export type MorphoShape = TLShape<typeof MORPHO_SHAPE_TYPE>;

export class MorphoShapeUtil extends BaseBoxShapeUtil<MorphoShape> {
  static override type = MORPHO_SHAPE_TYPE;

  static override props: RecordProps<MorphoShape> = {
    w: T.number,
    h: T.number,
    objectId: T.string,
    instanceId: T.string,
    morphoType: T.literalEnum(
      "image",
      "file",
      "text",
      "link",
      "imageCollection",
      "research",
      "keyConclusion",
      "documentFragment",
      "designDefinition",
      "conceptDirection",
      "delivery"
    ),
    title: T.string,
    summary: T.string,
    label: T.string,
    details: T.arrayOf(T.string),
    imageVariant: T.string.optional(),
    isDefaultReference: T.boolean.optional(),
    isBeingLocallyEdited: T.boolean.optional(),
    isInDesignTrace: T.boolean.optional(),
    assetUrl: T.string.optional()
  };

  override canBind() {
    return false;
  }

  override canEdit() {
    return false;
  }

  override getDefaultProps(): MorphoShape["props"] {
    return {
      w: 240,
      h: 180,
      objectId: "",
      instanceId: "",
      morphoType: "keyConclusion",
      title: "",
      summary: "",
      label: "",
      details: []
    };
  }

  override getGeometry(shape: MorphoShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true
    });
  }

  override component(shape: MorphoShape) {
    return (
      <HTMLContainer
        className="morpho-shape-host"
        style={{
          width: shape.props.w,
          height: shape.props.h
        }}
      >
        <MorphoShapeCard shape={shape} />
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: MorphoShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }

  override onResize(shape: MorphoShape, info: TLResizeInfo<MorphoShape>) {
    return resizeBox(shape, info);
  }
}

export function isMorphoShape(shape: TLShape): shape is MorphoShape {
  return shape.type === MORPHO_SHAPE_TYPE;
}

export function createMorphoShapePartial(
  instance: CanvasInstance,
  object: MorphoObject,
  assetUrl?: string,
  workspace?: MorphoWorkspace,
  isInDesignTrace = false
): TLShapePartial<MorphoShape> {
  return {
    id: createShapeId(instance.id),
    type: MORPHO_SHAPE_TYPE,
    x: instance.position.x,
    y: instance.position.y,
    opacity: object.type === "conceptDirection" && object.status === "eliminated" ? 0.68 : 1,
    props: {
      ...getMorphoShapeProps(instance, object, assetUrl, workspace),
      isInDesignTrace
    }
  };
}

export function getMorphoShapeProps(
  instance: CanvasInstance,
  object: MorphoObject,
  assetUrl?: string,
  workspace?: MorphoWorkspace
): MorphoShapeProps {
  return {
    w: instance.size.w,
    h: instance.size.h,
    objectId: object.id,
    instanceId: instance.id,
    morphoType: object.type,
    title: object.title,
    summary: object.summary,
    label: getObjectTypeLabel(object),
    details: getDetails(object, workspace),
    imageVariant: object.type === "image" ? object.imageVariant : undefined,
    isDefaultReference: object.type === "image" ? object.isDefaultReference : undefined,
    assetUrl
  };
}

function getDetails(object: MorphoObject, workspace?: MorphoWorkspace): string[] {
  switch (object.type) {
    case "research":
      return [
        `发现：${object.findings[0] ?? "待补充"}`,
        `机会：${object.opportunities[0] ?? "待补充"}`,
        `约束：${object.constraints[0] ?? "待补充"}`,
        `待验证：${object.openQuestions[0] ?? "待补充"}`
      ];
    case "keyConclusion":
      return [object.body, `状态：${object.state}`, `置信度：${object.confidence}`];
    case "documentFragment":
      return [`来源文件：${object.source.fileTitle}`, object.body.slice(0, 160), "来源状态：查看详情"];
    case "designDefinition": {
      const details = [`核心问题：${object.problem}`, `原则：${object.principles.join(" / ")}`, `避免项：${object.avoid.join(" / ")}`];
      if (workspace && hasPendingDesignDefinitionRevisionProposal(workspace, object.id)) {
        details.push("有修订草稿");
      }
      return details;
    }
    case "conceptDirection":
      return [object.summary, `关键词：${object.keywords.join(" / ")}`];
    case "text":
      return [object.body];
    case "link":
      return [object.url, object.description ?? object.summary];
    case "imageCollection":
      return [object.summary, `成员：${object.memberObjectIds.length} 张`];
    case "delivery":
      return [object.summary, ...object.gaps.map((gap) => gap.label)];
    default:
      return [object.summary];
  }
}

function MorphoShapeCard({ shape }: { shape: MorphoShape }) {
  const props = shape.props;
  const classes = [
    "morpho-object",
    `morpho-object-${props.morphoType}`,
    props.isDefaultReference ? "is-default-reference" : "",
    props.isBeingLocallyEdited ? "is-local-editing" : "",
    props.isInDesignTrace ? "is-design-trace" : ""
  ]
    .filter(Boolean)
    .join(" ");

  if (props.morphoType === "image") {
    return (
      <article className={classes}>
        <div className="morpho-image-visual">
          {props.assetUrl ? (
            // Blob URLs come from browser-local IndexedDB and cannot be optimized by next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.assetUrl} alt="" />
          ) : (
            renderVisual(props.imageVariant)
          )}
        </div>
        {props.isBeingLocallyEdited ? (
          <div className="edit-annotation">
            <span />
            <p>转角连接件</p>
          </div>
        ) : null}
        <div className="morpho-image-caption">
          <RoleLabel label={props.label} />
          <strong>{props.title}</strong>
          <p>{props.summary}</p>
        </div>
      </article>
    );
  }

  if (
    props.morphoType === "research" ||
    props.morphoType === "designDefinition" ||
    props.morphoType === "keyConclusion" ||
    props.morphoType === "documentFragment" ||
    props.morphoType === "text"
  ) {
    return (
      <article className={classes}>
        <RoleLabel label={props.label} />
        <h3>{props.title}</h3>
        <div className="morpho-document-lines">
          {props.details.map((detail) => (
            <p key={detail}>{detail}</p>
          ))}
        </div>
      </article>
    );
  }

  if (props.morphoType === "delivery") {
    return (
      <article className={classes}>
        <RoleLabel label={props.label} />
        <h3>{props.title}</h3>
        <div className="delivery-wire">
          <div className="delivery-main-image">{renderVisual("rail")}</div>
          <div className="delivery-text-lines">
            <span />
            <span />
            <span />
          </div>
        </div>
        <p>{props.details[1] ?? props.summary}</p>
      </article>
    );
  }

  return (
    <article className={classes}>
      <RoleLabel label={props.label} />
      <h3>{props.title}</h3>
      <p>{props.summary}</p>
      {props.details.length > 1 ? <small>{props.details[1]}</small> : null}
    </article>
  );
}

function RoleLabel({ label }: { label: string }) {
  return (
    <div className="morpho-role-label">
      <span />
      {label}
    </div>
  );
}

function renderVisual(variant?: string) {
  if (variant === "cmf") {
    return (
      <svg viewBox="0 0 320 210" role="img" aria-label="CMF 小板">
        <rect width="320" height="210" fill="#E7E0D6" />
        <rect x="28" y="28" width="76" height="154" rx="8" fill="#D9D4CA" />
        <rect x="122" y="28" width="76" height="154" rx="8" fill="#A99782" />
        <rect x="216" y="28" width="76" height="154" rx="8" fill="#4D5A4A" />
        <path d="M39 157h54M133 157h54M227 157h54" stroke="#F6E1B6" strokeWidth="8" strokeLinecap="round" />
      </svg>
    );
  }

  if (variant === "scenario" || variant === "path") {
    return (
      <svg viewBox="0 0 340 230" role="img" aria-label="夜间起身路径">
        <defs>
          <linearGradient id="scenarioWall" x1="0" x2="1">
            <stop stopColor="#E8E0D5" />
            <stop offset="1" stopColor="#F8F2EA" />
          </linearGradient>
        </defs>
        <rect width="340" height="230" fill="url(#scenarioWall)" />
        <rect y="160" width="340" height="70" fill="#D4C9BC" />
        <path d="M34 145h242c18 0 30 10 30 24" fill="none" stroke="#596450" strokeWidth="14" strokeLinecap="round" />
        <path d="M39 145h238c16 0 25 8 25 21" fill="none" stroke="#FFD987" strokeWidth="4" strokeLinecap="round" opacity=".85" />
        <rect x="18" y="91" width="64" height="48" rx="6" fill="#B9AA98" opacity=".72" />
        <rect x="242" y="56" width="54" height="84" rx="6" fill="#CFC5B8" opacity=".92" />
        <circle cx="118" cy="138" r="11" fill="#7C6F60" opacity=".42" />
      </svg>
    );
  }

  if (variant === "supportIsland") {
    return (
      <svg viewBox="0 0 320 210" role="img" aria-label="家具化支撑岛">
        <rect width="320" height="210" fill="#E9E4DA" />
        <rect x="56" y="74" width="86" height="78" rx="16" fill="#9D8F7D" />
        <rect x="178" y="52" width="72" height="108" rx="20" fill="#646F5E" />
        <path d="M64 86h67M186 66h56" stroke="#FFE1A1" strokeWidth="5" strokeLinecap="round" />
        <path d="M24 168h272" stroke="#C8BCAD" strokeWidth="8" strokeLinecap="round" />
      </svg>
    );
  }

  if (variant === "softGuide") {
    return (
      <svg viewBox="0 0 320 210" role="img" aria-label="软性引导带">
        <rect width="320" height="210" fill="#ECE8E1" />
        <path d="M42 146c52-44 86-30 126-56 28-18 52-34 108-16" fill="none" stroke="#AFA28E" strokeWidth="18" strokeLinecap="round" />
        <path d="M42 146c52-44 86-30 126-56 28-18 52-34 108-16" fill="none" stroke="#F9DFA4" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }

  if (variant === "detail") {
    return (
      <svg viewBox="0 0 320 210" role="img" aria-label="转角连接细节">
        <rect width="320" height="210" fill="#EEE9E0" />
        <path d="M58 132h112c36 0 57-22 57-58v-8" fill="none" stroke="#53604E" strokeWidth="28" strokeLinecap="round" />
        <path d="M58 132h112c36 0 57-22 57-58v-8" fill="none" stroke="#FFE2A0" strokeWidth="6" strokeLinecap="round" />
        <circle cx="206" cy="96" r="26" fill="none" stroke="#8E4C24" strokeWidth="2" strokeDasharray="5 5" />
        <path d="M232 72l38-32" stroke="#8E4C24" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 340 230" role="img" aria-label="柔光轨道产品图">
      <defs>
        <linearGradient id="railWall" x1="0" x2="1">
          <stop stopColor="#E7E0D6" />
          <stop offset="1" stopColor="#F6F0E8" />
        </linearGradient>
        <filter id="softGlow">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <rect width="340" height="230" fill="url(#railWall)" />
      <rect y="170" width="340" height="60" fill="#D2C7BA" />
      <path d="M42 137h166c32 0 54-20 54-52v-26" fill="none" stroke="#52604F" strokeWidth="22" strokeLinecap="round" />
      <path d="M42 137h166c32 0 54-20 54-52v-26" fill="none" stroke="#FFE0A0" strokeWidth="5" strokeLinecap="round" />
      <path
        d="M42 138h166c32 0 54-20 54-52v-26"
        fill="none"
        stroke="#FFD37A"
        strokeWidth="13"
        strokeLinecap="round"
        opacity=".35"
        filter="url(#softGlow)"
      />
      <rect x="48" y="146" width="136" height="12" rx="6" fill="#8A7A67" opacity=".32" />
      <circle cx="263" cy="60" r="13" fill="#F9E1AA" opacity=".9" />
    </svg>
  );
}
