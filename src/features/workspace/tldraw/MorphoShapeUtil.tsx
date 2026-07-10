"use client";

import { useLayoutEffect, useRef } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  T,
  createShapeId,
  resizeBox,
  useEditor,
  type Geometry2d,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
  type TLShapePartial
} from "tldraw";

import type { CanvasInstance, MorphoObject, MorphoObjectType, MorphoWorkspace } from "../../../domain/morpho/types";
import { hasPendingDesignDefinitionRevisionProposal } from "../../../domain/morpho/derivedState";
import { deriveDeliveryPreparationSignals } from "../../../domain/morpho/deliveryPreparation";
import { getResearchItemParts } from "../../../domain/operations/researchItems";
import { getObjectTypeLabel } from "../workspaceUi";

export const MORPHO_SHAPE_TYPE = "morpho-object";

type ResearchShapeSection = {
  label: string;
  items: string[];
  omittedCount: number;
};

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
  researchSections?: ResearchShapeSection[];
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
      "delivery",
      "proposalDraft"
    ),
    title: T.string,
    summary: T.string,
    label: T.string,
    details: T.arrayOf(T.string),
    imageVariant: T.string.optional(),
    isDefaultReference: T.boolean.optional(),
    isBeingLocallyEdited: T.boolean.optional(),
    isInDesignTrace: T.boolean.optional(),
    assetUrl: T.string.optional(),
    researchSections: T.arrayOf(
      T.object({
        label: T.string,
        items: T.arrayOf(T.string),
        omittedCount: T.number
      })
    ).optional()
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
    return <MorphoShapeContainer shape={shape} />;
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

function MorphoShapeContainer({ shape }: { shape: MorphoShape }) {
  const editor = useEditor();
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!shouldAutoGrowMorphoShape(shape.props.morphoType)) {
      return;
    }

    let cancelled = false;
    const synchronizeHeight = () => {
      if (cancelled) {
        return;
      }
      const content = contentRef.current?.firstElementChild;
      if (!(content instanceof HTMLElement)) {
        return;
      }
      const nextHeight = resolveAutoGrowHeight(shape.props.h, content.scrollHeight);
      if (!nextHeight) {
        return;
      }
      editor.run(
        () => {
          editor.updateShape<MorphoShape>({
            id: shape.id,
            type: shape.type,
            props: { h: nextHeight }
          });
        },
        { history: "ignore" }
      );
    };

    synchronizeHeight();
    const frame = window.requestAnimationFrame(synchronizeHeight);
    void document.fonts?.ready.then(synchronizeHeight);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [editor, shape]);

  return (
    <HTMLContainer
      className="morpho-shape-host"
      style={{
        width: shape.props.w,
        height: shape.props.h
      }}
    >
      <div className="morpho-shape-content" ref={contentRef}>
        <MorphoShapeCard shape={shape} />
      </div>
    </HTMLContainer>
  );
}

export function shouldAutoGrowMorphoShape(type: MorphoObjectType): boolean {
  return type !== "image";
}

export function resolveAutoGrowHeight(currentHeight: number, contentScrollHeight: number): number | null {
  const requiredHeight = Math.ceil(contentScrollHeight + 2);
  return requiredHeight > currentHeight + 1 ? requiredHeight : null;
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
  const details = getDetails(object, workspace);
  const adaptiveSize = getAdaptiveMorphoShapeSize(instance, object, details);

  return {
    w: adaptiveSize.w,
    h: adaptiveSize.h,
    objectId: object.id,
    instanceId: instance.id,
    morphoType: object.type,
    title: object.title,
    summary: object.summary,
    label: getMorphoShapeLabel(object),
    details,
    imageVariant: object.type === "image" ? object.imageVariant : undefined,
    isDefaultReference: object.type === "image" ? object.isDefaultReference : undefined,
    assetUrl
  };
}

export function getAdaptiveMorphoShapeSize(
  instance: CanvasInstance,
  object: MorphoObject,
  details = getDetails(object)
): { w: number; h: number } {
  if (!isContentHeightAdaptiveObject(object)) {
    return instance.size;
  }

  if (object.type === "research") {
    return getResearchShapeSize(instance, object);
  }

  if (object.type === "designDefinition") {
    return getDesignDefinitionShapeSize(instance, object, details);
  }

  if (object.type === "keyConclusion") {
    return getKeyConclusionShapeSize(instance, object);
  }

  const width = Math.max(instance.size.w, 260);
  const contentWidth = Math.max(160, width - 40);
  const titleLineCount = estimateLineCount(object.title, Math.max(10, Math.floor(contentWidth / 18)));
  const detailLineCount = details.reduce(
    (total, detail) => total + estimateLineCount(detail, Math.max(14, Math.floor(contentWidth / 10.5))),
    0
  );
  const detailGapHeight = Math.max(0, details.length - 1) * 9;
  const estimatedHeight = 18 + 12 + 12 + titleLineCount * 25 + 13 + detailLineCount * 18 + detailGapHeight + 18;

  return {
    w: width,
    h: Math.max(instance.size.h, Math.ceil(estimatedHeight))
  };
}

function getDesignDefinitionShapeSize(
  instance: CanvasInstance,
  object: Extract<MorphoObject, { type: "designDefinition" }>,
  details: string[]
): { w: number; h: number } {
  const width = Math.max(instance.size.w, 320);
  const contentWidth = Math.max(190, width - 40);
  const titleLineCount = estimateLineCount(object.title, Math.max(12, Math.floor(contentWidth / 14)));
  const summaryLineCount = object.summary.trim()
    ? estimateLineCount(object.summary, Math.max(16, Math.floor(contentWidth / 11)))
    : 0;
  const detailLineCount = details.reduce(
    (total, detail) => total + estimateLineCount(detail, Math.max(14, Math.floor(contentWidth / 11))),
    0
  );
  const estimatedHeight =
    36 +
    10 +
    12 +
    titleLineCount * 25 +
    (summaryLineCount > 0 ? 13 + summaryLineCount * 19 : 0) +
    (detailLineCount > 0 ? details.length * 10 + detailLineCount * 20 : 0) +
    4;
  const compactHeight = Math.max(150, Math.ceil(estimatedHeight));
  const shouldShrinkLegacyFullDefinitionCard = instance.size.h > 280 && compactHeight < 240;

  return {
    w: width,
    h: shouldShrinkLegacyFullDefinitionCard ? compactHeight : Math.max(instance.size.h, compactHeight)
  };
}

function getKeyConclusionShapeSize(instance: CanvasInstance, object: Extract<MorphoObject, { type: "keyConclusion" }>): { w: number; h: number } {
  const width = Math.max(instance.size.w, 300);
  const contentWidth = Math.max(176, width - 42);
  const parts = getResearchItemParts(object.title);
  const titleLineCount = estimateLineCount(parts.title, Math.max(12, Math.floor(contentWidth / 12)));
  const detailLineCount = parts.detail ? estimateLineCount(parts.detail, Math.max(14, Math.floor(contentWidth / 11))) : 0;
  const estimatedHeight = 16 + 12 + 9 + titleLineCount * 18 + (parts.detail ? 5 + detailLineCount * 17 : 0) + 16;
  const extractedLabel = getResearchExtractedKeyConclusionLabel(object.note);
  const compactHeight = extractedLabel
    ? Math.min(156, Math.max(108, Math.ceil(estimatedHeight)))
    : Math.ceil(estimatedHeight);
  const isPreviouslyAutoSizedExtraction =
    Boolean(extractedLabel) &&
    instance.size.w >= 280 &&
    instance.size.w <= 340 &&
    instance.size.h > compactHeight &&
    instance.size.h <= 260;

  return {
    w: width,
    h: isPreviouslyAutoSizedExtraction ? compactHeight : Math.max(instance.size.h, compactHeight)
  };
}

function getResearchShapeSize(instance: CanvasInstance, object: Extract<MorphoObject, { type: "research" }>): { w: number; h: number } {
  const width = Math.max(instance.size.w, 320);
  const contentWidth = Math.max(190, width - 40);
  const titleLineCount = estimateLineCount(object.title, Math.max(12, Math.floor(contentWidth / 14)));
  const summaryLineCount = Math.min(3, estimateLineCount(object.summary, Math.max(16, Math.floor(contentWidth / 11))));
  const estimatedHeight = 16 + 12 + titleLineCount * 20 + (object.summary.trim() ? 8 + summaryLineCount * 17 : 0) + 18;
  const compactHeight = Math.min(220, Math.max(124, Math.ceil(estimatedHeight)));
  const isGeneratedDefaultResearchSize = instance.size.w >= 300 && instance.size.w <= 340 && instance.size.h === 210;

  return {
    w: width,
    h: isGeneratedDefaultResearchSize ? compactHeight : Math.max(instance.size.h, compactHeight)
  };
}

function getMorphoShapeLabel(object: MorphoObject): string {
  if (object.type !== "keyConclusion") {
    return getObjectTypeLabel(object);
  }

  return getResearchExtractedKeyConclusionLabel(object.note) ?? getObjectTypeLabel(object);
}

function getResearchExtractedKeyConclusionLabel(note?: string): string | undefined {
  if (!note) {
    return undefined;
  }

  if (note.includes("发现第")) {
    return "发现";
  }
  if (note.includes("机会点第")) {
    return "机会点";
  }
  if (note.includes("约束第")) {
    return "约束";
  }
  if (note.includes("待验证问题第")) {
    return "待验证";
  }

  return undefined;
}

function isContentHeightAdaptiveObject(object: MorphoObject): boolean {
  return (
    object.type === "research" ||
    object.type === "designDefinition" ||
    object.type === "keyConclusion" ||
    object.type === "documentFragment" ||
    object.type === "text"
  );
}

function estimateLineCount(text: string, charsPerLine: number): number {
  if (!text.trim()) {
    return 1;
  }

  return Math.max(
    1,
    text
      .split(/\r?\n/)
      .reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charsPerLine)), 0)
  );
}

export function getResearchShapeSections(object: Extract<MorphoObject, { type: "research" }>): ResearchShapeSection[] {
  return [
    createResearchShapeSection("发现", object.findings),
    createResearchShapeSection("机会", object.opportunities),
    createResearchShapeSection("约束", object.constraints),
    createResearchShapeSection("待验证", object.openQuestions)
  ];
}

function createResearchShapeSection(label: string, sourceItems: string[]): ResearchShapeSection {
  const items = sourceItems.length > 0 ? sourceItems.slice(0, 1) : ["待补充"];

  return {
    label,
    items,
    omittedCount: Math.max(0, sourceItems.length - items.length)
  };
}

function getDetails(object: MorphoObject, workspace?: MorphoWorkspace): string[] {
  switch (object.type) {
    case "image":
      return [];
    case "research":
      return [
        `发现：${object.findings[0] ?? "待补充"}`,
        `机会：${object.opportunities[0] ?? "待补充"}`,
        `约束：${object.constraints[0] ?? "待补充"}`,
        `待验证：${object.openQuestions[0] ?? "待补充"}`
      ];
    case "keyConclusion":
      return [];
    case "documentFragment":
      return [`来源文件：${object.source.fileTitle}`, object.body.slice(0, 160), "来源状态：查看详情"];
    case "designDefinition": {
      const details: string[] = [];
      if (!object.isCurrentEffective) {
        details.push("非当前定义");
      }
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
      if (!workspace) {
        return [object.summary];
      }
      const signals = deriveDeliveryPreparationSignals(workspace, object.id);
      return [
        `形式：${object.format === "board" ? "展板" : "演示文稿"}`,
        `章节：${object.sections.length} · 引用：${object.references.length}`,
        `开放待补：${object.gaps.filter((gap) => gap.status === "open").length}`,
        `来源待复核：${
          signals.sourceHiddenReferenceIds.length +
          signals.sourceMissingReferenceIds.length +
          signals.assetMissingReferenceIds.length +
          signals.sourceUpdatedReferenceIds.length
        }`
      ];
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
      <article className={classes} aria-label={props.title}>
        <div className="morpho-image-visual">
          {props.assetUrl ? (
            // Blob URLs come from browser-local IndexedDB and cannot be optimized by next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.assetUrl} alt="" />
          ) : (
            renderVisual(props.imageVariant)
          )}
        </div>
        <div className="morpho-image-label">
          <span>{props.label}</span>
          <strong>{props.title}</strong>
        </div>
        {props.isBeingLocallyEdited ? (
          <div className="edit-annotation">
            <span />
            <p>局部编辑中</p>
          </div>
        ) : null}
      </article>
    );
  }

  if (
    props.morphoType === "research"
  ) {
    return (
      <article className={classes}>
        <RoleLabel label={props.label} />
        <h3>{props.title}</h3>
        {props.summary ? <p className="morpho-research-summary">{props.summary}</p> : null}
      </article>
    );
  }

  if (
    props.morphoType === "keyConclusion"
  ) {
    const parts = getResearchItemParts(props.title);

    return (
      <article className={classes}>
        <RoleLabel label={props.label} />
        <h3 className="morpho-key-title">{parts.title}</h3>
        {parts.detail ? <p className="morpho-key-detail">{parts.detail}</p> : null}
      </article>
    );
  }

  if (props.morphoType === "designDefinition") {
    return (
      <article className={classes}>
        <RoleLabel label={props.label} />
        <h3>{props.title}</h3>
        {props.summary ? <p className="morpho-definition-summary">{props.summary}</p> : null}
        {props.details.map((detail) => (
          <span className="morpho-definition-status" key={detail}>
            {detail}
          </span>
        ))}
      </article>
    );
  }

  if (props.morphoType === "proposalDraft") {
    return (
      <article className={classes}>
        <div className="morpho-proposal-header">
          <RoleLabel label={props.label} />
          <span>待确认</span>
        </div>
        <h3>{props.title}</h3>
        {props.summary ? <p className="morpho-proposal-summary">{props.summary}</p> : null}
      </article>
    );
  }

  if (
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
      <svg viewBox="0 0 320 210" role="img" aria-label="CMF 灏忔澘">
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
      <svg viewBox="0 0 320 210" role="img" aria-label="家居化支撑岛">
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
      <svg viewBox="0 0 320 210" role="img" aria-label="杞€у紩瀵煎甫">
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
