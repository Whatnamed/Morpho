"use client";

import {
  BookOpen,
  Copy,
  EyeOff,
  Flag,
  GitBranch,
  GitCompare,
  MessageSquareText,
  PackageOpen,
  PenLine,
  Sparkles,
  Trash2
} from "lucide-react";

import type { CanvasLayerReorderAction } from "@/domain/morpho/workspace";
import type { MorphoObject } from "@/domain/morpho/types";
import type { SelectionToolbarPlacement } from "../selectionToolbar";

export type SelectionToolbarProps = {
  selectedObjects: MorphoObject[];
  placement: SelectionToolbarPlacement | null;
  isDesignTraceActive: boolean;
  onAskAi: () => void;
  onToggleDesignTrace: () => void;
  onOpenDocumentReader: () => void;
  onOpenDeliveryPreparation: () => void;
  onLocalEdit: () => void;
  onReferenceIntent: () => void;
  onHide: () => void;
  onDelete: () => void;
  onReviseDirection: () => void;
  onSplitDirection: () => void;
  onMergeDirections: () => void;
  onCreateVisualBranch: () => void;
  onSetDirectionPrimary: () => void;
  onSetDirectionAlternative: () => void;
  onRestoreDirectionAsAlternative: () => void;
  onEliminateDirection: () => void;
  onReorderLayer: (action: CanvasLayerReorderAction) => void;
};

export function SelectionToolbar({
  selectedObjects,
  placement,
  isDesignTraceActive,
  onAskAi,
  onToggleDesignTrace,
  onOpenDocumentReader,
  onOpenDeliveryPreparation,
  onLocalEdit,
  onReferenceIntent,
  onReviseDirection,
  onSplitDirection,
  onMergeDirections,
  onCreateVisualBranch,
  onSetDirectionPrimary,
  onSetDirectionAlternative,
  onRestoreDirectionAsAlternative,
  onEliminateDirection
}: SelectionToolbarProps) {
  if (!placement || selectedObjects.length === 0) {
    return null;
  }

  const primary = selectedObjects[0];
  const onlyOne = selectedObjects.length === 1;
  const selectedDirections = selectedObjects.filter((object) => object.type === "conceptDirection");
  const showDirectionActions = onlyOne && primary.type === "conceptDirection";
  const showMergeDirectionsAction = selectedDirections.length >= 2 && selectedDirections.length === selectedObjects.length;

  return (
    <div
      className={`selection-toolbar ${placement.placement}`}
      aria-label="选中对象工具"
      style={{ left: placement.x, top: placement.y }}
    >
      <button type="button" onClick={onAskAi}>
        <MessageSquareText size={15} />
        问 AI
      </button>
      {onlyOne && primary.type === "file" ? (
        <button type="button" onClick={onOpenDocumentReader}>
          <BookOpen size={15} />
          读文本
        </button>
      ) : null}
      {onlyOne && primary.type === "documentFragment" ? (
        <button type="button" onClick={onOpenDocumentReader}>
          <BookOpen size={15} />
          回原文
        </button>
      ) : null}
      {onlyOne && primary.type === "delivery" ? (
        <button className="brand" type="button" onClick={onOpenDeliveryPreparation}>
          <PackageOpen size={15} />
          交付
        </button>
      ) : null}
      <button className={isDesignTraceActive ? "brand" : ""} type="button" onClick={onToggleDesignTrace}>
        <GitBranch size={15} />
        链路
      </button>
      {onlyOne && primary.type === "image" ? (
        <>
          <button type="button" onClick={onLocalEdit}>
            <PenLine size={15} />
            局部改
          </button>
          <button className="brand" type="button" onClick={onReferenceIntent}>
            <Sparkles size={15} />
            默认参考
          </button>
        </>
      ) : null}
      {showDirectionActions ? (
        <>
          {primary.status !== "primary" && primary.status !== "eliminated" ? (
            <button type="button" onClick={onSetDirectionPrimary}>
              <Flag size={15} />
              主方向
            </button>
          ) : null}
          {primary.status !== "alternative" && primary.status !== "eliminated" ? (
            <button type="button" onClick={onSetDirectionAlternative}>
              <GitCompare size={15} />
              备选
            </button>
          ) : null}
          {primary.status === "eliminated" ? (
            <button type="button" onClick={onRestoreDirectionAsAlternative}>
              <GitCompare size={15} />
              恢复
            </button>
          ) : (
            <button type="button" onClick={onEliminateDirection}>
              <Trash2 size={15} />
              淘汰
            </button>
          )}
          <button type="button" onClick={onReviseDirection}>
            <PenLine size={15} />
            修订
          </button>
          <button type="button" onClick={onSplitDirection}>
            <GitBranch size={15} />
            拆分
          </button>
          <button type="button" onClick={onCreateVisualBranch}>
            <Sparkles size={15} />
            分支
          </button>
        </>
      ) : null}
      {showMergeDirectionsAction ? (
        <button type="button" onClick={onMergeDirections}>
          <GitCompare size={15} />
          合并
        </button>
      ) : null}
    </div>
  );
}

export type CanvasContextMenuProps = {
  x: number;
  y: number;
  selectedObjects: MorphoObject[];
  onClose: () => void;
  onCopySummary: () => void;
  onAskAi: () => void;
  onLocalEdit: () => void;
  onReferenceIntent: () => void;
  onHide: () => void;
  onDelete: () => void;
  onReorderLayer: (action: CanvasLayerReorderAction) => void;
};

export function CanvasContextMenu({
  x,
  y,
  selectedObjects,
  onClose,
  onCopySummary,
  onAskAi,
  onLocalEdit,
  onReferenceIntent,
  onHide,
  onDelete,
  onReorderLayer
}: CanvasContextMenuProps) {
  if (selectedObjects.length === 0) {
    return null;
  }

  const primary = selectedObjects[0];

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      className="canvas-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      aria-label="画布对象菜单"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button type="button" role="menuitem" onClick={() => run(onCopySummary)}>
        <Copy size={15} />
        复制摘要
      </button>
      <button type="button" role="menuitem" onClick={() => run(onAskAi)}>
        <MessageSquareText size={15} />
        询问 AI
      </button>
      {primary.type === "image" ? (
        <>
          <button type="button" role="menuitem" onClick={() => run(onLocalEdit)}>
            <PenLine size={15} />
            局部修改
          </button>
          <button type="button" role="menuitem" onClick={() => run(onReferenceIntent)}>
            <Sparkles size={15} />
            设为后续默认参考
          </button>
        </>
      ) : null}
      <hr />
      <button type="button" role="menuitem" onClick={() => run(() => onReorderLayer("bringForward"))}>
        上移一层
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => onReorderLayer("sendBackward"))}>
        下移一层
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => onReorderLayer("bringToFront"))}>
        置于顶层
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => onReorderLayer("sendToBack"))}>
        置于底层
      </button>
      <hr />
      <button type="button" role="menuitem" onClick={() => run(onHide)}>
        <EyeOff size={15} />
        隐藏
      </button>
      <button className="danger" type="button" role="menuitem" onClick={() => run(onDelete)}>
        <Trash2 size={15} />
        删除
      </button>
    </div>
  );
}
