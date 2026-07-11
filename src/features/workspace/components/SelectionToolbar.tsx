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
import { CanvasIconButton } from "./CanvasIconButton";

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
  onEliminateDirection,
  onHide,
  onDelete
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
        <CanvasIconButton label="问 AI" onClick={onAskAi}>
          <MessageSquareText size={15} />
        </CanvasIconButton>
      </div>

      {hasObjectActions ? <span className="selection-toolbar-divider" aria-hidden="true" /> : null}

      {onlyOne && primary.type === "file" ? (
        <div className="selection-toolbar-group" role="group" aria-label="文件">
          <CanvasIconButton label="阅读文本" onClick={onOpenDocumentReader}>
            <BookOpen size={15} />
          </CanvasIconButton>
        </div>
      ) : null}
      {onlyOne && primary.type === "documentFragment" ? (
        <div className="selection-toolbar-group" role="group" aria-label="文档片段">
          <CanvasIconButton label="回到原文" onClick={onOpenDocumentReader}>
            <BookOpen size={15} />
          </CanvasIconButton>
        </div>
      ) : null}
      {onlyOne && primary.type === "research" ? (
        <div className="selection-toolbar-group" role="group" aria-label="研究">
          <CanvasIconButton label="查看研究详情" className="brand" onClick={onOpenResearchDetail}>
            <BookOpen size={15} />
          </CanvasIconButton>
          <CanvasIconButton label="AI 代选" onClick={onAutoSelectResearch}>
            <Sparkles size={15} />
          </CanvasIconButton>
        </div>
      ) : null}
      {onlyOne && primary.type === "delivery" ? (
        <div className="selection-toolbar-group" role="group" aria-label="交付">
          <CanvasIconButton label="打开交付准备" className="brand" onClick={onOpenDeliveryPreparation}>
            <PackageOpen size={15} />
          </CanvasIconButton>
        </div>
      ) : null}
      {onlyOne && primary.type === "proposalDraft" ? (
        <div className="selection-toolbar-group" role="group" aria-label="草案">
          <CanvasIconButton label="查看草案详情" className="brand" onClick={onOpenProposalDetail}>
            <BookOpen size={15} />
          </CanvasIconButton>
          <CanvasIconButton label="继续讨论草案" onClick={onContinueProposalDiscussion}>
            <MessageSquareText size={15} />
          </CanvasIconButton>
          <CanvasIconButton label="应用草案" onClick={onApplyProposal}>
            <Sparkles size={15} />
          </CanvasIconButton>
          <CanvasIconButton label="放弃草案" danger onClick={onRejectProposal}>
            <Trash2 size={15} />
          </CanvasIconButton>
        </div>
      ) : null}
      {onlyOne && primary.type === "designDefinition" ? (
        <div className="selection-toolbar-group" role="group" aria-label="设计定义">
          <CanvasIconButton label="查看设计定义详情" className="brand" onClick={onOpenDesignDefinitionDetail}>
            <BookOpen size={15} />
          </CanvasIconButton>
          {!primary.isCurrentEffective ? (
            <CanvasIconButton label="设为当前设计定义" onClick={onSetCurrentDesignDefinition}>
              <Flag size={15} />
            </CanvasIconButton>
          ) : null}
        </div>
      ) : null}
      {onlyOne && primary.type === "image" ? (
        <div className="selection-toolbar-group" role="group" aria-label="图像">
          <CanvasIconButton label="局部编辑" onClick={onLocalEdit}>
            <PenLine size={15} />
          </CanvasIconButton>
          <CanvasIconButton label="设为后续默认参考" className="brand" onClick={onReferenceIntent}>
            <Sparkles size={15} />
          </CanvasIconButton>
        </div>
      ) : null}
      {showDirectionActions ? (
        <>
          <div className="selection-toolbar-group" role="group" aria-label="方向">
            <CanvasIconButton label="查看方向详情" className="brand" onClick={onOpenConceptDirectionDetail}>
              <BookOpen size={15} />
            </CanvasIconButton>
            {primary.status !== "primary" && primary.status !== "eliminated" ? (
              <CanvasIconButton label="设为主方向" onClick={onSetDirectionPrimary}>
                <Flag size={15} />
              </CanvasIconButton>
            ) : null}
            {primary.status !== "alternative" && primary.status !== "eliminated" ? (
              <CanvasIconButton label="设为备选方向" onClick={onSetDirectionAlternative}>
                <GitCompare size={15} />
              </CanvasIconButton>
            ) : null}
            {primary.status === "eliminated" ? (
              <CanvasIconButton label="恢复为备选方向" onClick={onRestoreDirectionAsAlternative}>
                <GitCompare size={15} />
              </CanvasIconButton>
            ) : (
              <CanvasIconButton label="淘汰方向" danger onClick={onEliminateDirection}>
                <Trash2 size={15} />
              </CanvasIconButton>
            )}
          </div>
          <span className="selection-toolbar-divider" aria-hidden="true" />
          <div className="selection-toolbar-group is-secondary" role="group" aria-label="方向发展">
            <CanvasIconButton label="修订方向" onClick={onReviseDirection}>
              <PenLine size={15} />
            </CanvasIconButton>
            <CanvasIconButton label="拆分方向" onClick={onSplitDirection}>
              <GitBranch size={15} />
            </CanvasIconButton>
            <CanvasIconButton label="创建视觉分支" onClick={onCreateVisualBranch}>
              <Sparkles size={15} />
            </CanvasIconButton>
          </div>
        </>
      ) : null}
      {showMergeDirectionsAction ? (
        <div className="selection-toolbar-group" role="group" aria-label="合并方向">
          <CanvasIconButton label="合并方向" onClick={onMergeDirections}>
            <GitCompare size={15} />
          </CanvasIconButton>
        </div>
      ) : null}

      <span className="selection-toolbar-divider" aria-hidden="true" />
      <div className="selection-toolbar-group is-secondary" role="group" aria-label="追溯">
        <CanvasIconButton
          label={isDesignTraceActive ? "关闭链路" : "查看链路"}
          active={isDesignTraceActive}
          pressed={isDesignTraceActive}
          onClick={onToggleDesignTrace}
        >
          <GitBranch size={15} />
        </CanvasIconButton>
      </div>
      <span className="selection-toolbar-divider" aria-hidden="true" />
      <div className="selection-toolbar-group is-secondary" role="group" aria-label="对象显示与删除">
        <CanvasIconButton label="隐藏对象" onClick={onHide}>
          <EyeOff size={15} />
        </CanvasIconButton>
        <CanvasIconButton label="删除对象" danger onClick={onDelete}>
          <Trash2 size={15} />
        </CanvasIconButton>
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
