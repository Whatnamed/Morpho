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
  onOpenResearchDetail: () => void;
  onAutoSelectResearch: () => void;
  onOpenDocumentReader: () => void;
  onOpenDeliveryPreparation: () => void;
  onLocalEdit: () => void;
  onReferenceIntent: () => void;
  onHide: () => void;
  onDelete: () => void;
  onOpenProposalDetail: () => void;
  onApplyProposal: () => void;
  onRejectProposal: () => void;
  onContinueProposalDiscussion: () => void;
  onOpenDesignDefinitionDetail: () => void;
  onOpenConceptDirectionDetail: () => void;
  onSetCurrentDesignDefinition: () => void;
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
  onOpenResearchDetail,
  onAutoSelectResearch,
  onOpenDocumentReader,
  onOpenDeliveryPreparation,
  onLocalEdit,
  onReferenceIntent,
  onOpenProposalDetail,
  onApplyProposal,
  onRejectProposal,
  onContinueProposalDiscussion,
  onOpenDesignDefinitionDetail,
  onOpenConceptDirectionDetail,
  onSetCurrentDesignDefinition,
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

  const hasObjectActions =
    (onlyOne &&
      (primary.type === "file" ||
        primary.type === "documentFragment" ||
        primary.type === "research" ||
        primary.type === "delivery" ||
        primary.type === "proposalDraft" ||
        primary.type === "designDefinition" ||
        primary.type === "image" ||
        primary.type === "conceptDirection")) ||
    showMergeDirectionsAction;

  return (
    <div
      className={`selection-toolbar ${placement.placement}`}
      aria-label="选中对象工具"
      style={{ left: placement.x, top: placement.y }}
      onPointerDown={(event) => {
        // Keep tldraw from treating toolbar clicks as canvas selection/drag.
        event.stopPropagation();
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
      }}
    >
      <div className="selection-toolbar-group" role="group" aria-label="对话">
        <button type="button" onClick={onAskAi}>
          <MessageSquareText size={15} />
          问 AI
        </button>
      </div>

      {hasObjectActions ? <span className="selection-toolbar-divider" aria-hidden="true" /> : null}

      {onlyOne && primary.type === "file" ? (
        <div className="selection-toolbar-group" role="group" aria-label="文件">
          <button type="button" onClick={onOpenDocumentReader}>
            <BookOpen size={15} />
            读文本
          </button>
        </div>
      ) : null}
      {onlyOne && primary.type === "documentFragment" ? (
        <div className="selection-toolbar-group" role="group" aria-label="文档片段">
          <button type="button" onClick={onOpenDocumentReader}>
            <BookOpen size={15} />
            回原文
          </button>
        </div>
      ) : null}
      {onlyOne && primary.type === "research" ? (
        <div className="selection-toolbar-group" role="group" aria-label="研究">
          <button className="brand" type="button" onClick={onOpenResearchDetail}>
            <BookOpen size={15} />
            研究详情
          </button>
          <button type="button" onClick={onAutoSelectResearch}>
            <Sparkles size={15} />
            AI 代选
          </button>
        </div>
      ) : null}
      {onlyOne && primary.type === "delivery" ? (
        <div className="selection-toolbar-group" role="group" aria-label="交付">
          <button className="brand" type="button" onClick={onOpenDeliveryPreparation}>
            <PackageOpen size={15} />
            交付
          </button>
        </div>
      ) : null}
      {onlyOne && primary.type === "proposalDraft" ? (
        <div className="selection-toolbar-group" role="group" aria-label="草案">
          <button className="brand" type="button" onClick={onOpenProposalDetail}>
            <BookOpen size={15} />
            查看详情
          </button>
          <button type="button" onClick={onContinueProposalDiscussion}>
            <MessageSquareText size={15} />
            继续讨论
          </button>
          <button type="button" onClick={onApplyProposal}>
            <Sparkles size={15} />
            应用草案
          </button>
          <button className="danger" type="button" onClick={onRejectProposal}>
            <Trash2 size={15} />
            放弃草案
          </button>
        </div>
      ) : null}
      {onlyOne && primary.type === "designDefinition" ? (
        <div className="selection-toolbar-group" role="group" aria-label="设计定义">
          <button className="brand" type="button" onClick={onOpenDesignDefinitionDetail}>
            <BookOpen size={15} />
            查看详情
          </button>
          {!primary.isCurrentEffective ? (
            <button type="button" onClick={onSetCurrentDesignDefinition}>
              <Flag size={15} />
              设为当前定义
            </button>
          ) : null}
        </div>
      ) : null}
      {onlyOne && primary.type === "image" ? (
        <div className="selection-toolbar-group" role="group" aria-label="图像">
          <button type="button" onClick={onLocalEdit}>
            <PenLine size={15} />
            局部改
          </button>
          <button className="brand" type="button" onClick={onReferenceIntent}>
            <Sparkles size={15} />
            默认参考
          </button>
        </div>
      ) : null}
      {showDirectionActions ? (
        <>
          <div className="selection-toolbar-group" role="group" aria-label="方向">
            <button className="brand" type="button" onClick={onOpenConceptDirectionDetail}>
              <BookOpen size={15} />
              详情
            </button>
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
          </div>
          <span className="selection-toolbar-divider" aria-hidden="true" />
          <div className="selection-toolbar-group is-secondary" role="group" aria-label="方向发展">
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
          </div>
        </>
      ) : null}
      {showMergeDirectionsAction ? (
        <div className="selection-toolbar-group" role="group" aria-label="合并方向">
          <button type="button" onClick={onMergeDirections}>
            <GitCompare size={15} />
            合并
          </button>
        </div>
      ) : null}

      <span className="selection-toolbar-divider" aria-hidden="true" />
      <div className="selection-toolbar-group is-secondary" role="group" aria-label="追溯">
        <button className={isDesignTraceActive ? "brand" : ""} type="button" onClick={onToggleDesignTrace}>
          <GitBranch size={15} />
          链路
        </button>
      </div>
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
  onOpenProposalDetail: () => void;
  onApplyProposal: () => void;
  onRejectProposal: () => void;
  onContinueProposalDiscussion: () => void;
  onOpenDesignDefinitionDetail: () => void;
  onOpenConceptDirectionDetail: () => void;
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
  onOpenProposalDetail,
  onApplyProposal,
  onRejectProposal,
  onContinueProposalDiscussion,
  onOpenDesignDefinitionDetail,
  onOpenConceptDirectionDetail,
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

  if (primary.type === "proposalDraft") {
    return (
      <div
        className="canvas-context-menu"
        style={{ left: x, top: y }}
        role="menu"
        aria-label="画布草案菜单"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button type="button" role="menuitem" onClick={() => run(onOpenProposalDetail)}>
          <BookOpen size={15} />
          查看详情
        </button>
        <button type="button" role="menuitem" onClick={() => run(onContinueProposalDiscussion)}>
          <MessageSquareText size={15} />
          继续讨论
        </button>
        <button type="button" role="menuitem" onClick={() => run(onApplyProposal)}>
          <Sparkles size={15} />
          应用草案
        </button>
        <button className="danger" type="button" role="menuitem" onClick={() => run(onRejectProposal)}>
          <Trash2 size={15} />
          放弃草案
        </button>
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
      </div>
    );
  }

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
      {primary.type === "designDefinition" ? (
        <button type="button" role="menuitem" onClick={() => run(onOpenDesignDefinitionDetail)}>
          <BookOpen size={15} />
          查看详情
        </button>
      ) : null}
      {primary.type === "conceptDirection" ? (
        <button type="button" role="menuitem" onClick={() => run(onOpenConceptDirectionDetail)}>
          <BookOpen size={15} />
          查看详情
        </button>
      ) : null}
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
