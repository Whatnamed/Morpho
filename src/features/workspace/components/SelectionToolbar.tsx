"use client";

import {
  BadgeCheck,
  BookOpen,
  CircleOff,
  ClipboardPaste,
  Copy,
  EyeOff,
  FileUp,
  FileX2,
  Flag,
  GitBranch,
  GitBranchPlus,
  GitCompare,
  GitMerge,
  Info,
  ListChecks,
  LockKeyhole,
  LockKeyholeOpen,
  MessageSquareText,
  MoreHorizontal,
  PackageOpen,
  PenLine,
  Pin,
  PinOff,
  RotateCcw,
  Scan,
  ScanSearch,
  Sparkles,
  Trash2,
  Unlink,
  X
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

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
  onMeasure?: (size: { w: number; h: number }) => void;
  isMeasuring?: boolean;
};

export function shouldRenderGenericObjectActions(selectedObjects: MorphoObject[]): boolean {
  return !(selectedObjects.length === 1 && selectedObjects[0]?.type === "conceptDirection");
}

export function getDirectionMenuVerticalDirection(placement: SelectionToolbarPlacement): "up" | "down" {
  return placement.placement === "below" ? "up" : "down";
}

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
  onDelete,
  onMeasure,
  isMeasuring = false
}: SelectionToolbarProps) {
  const [isDirectionMenuOpen, setIsDirectionMenuOpen] = useState(false);
  const [directionMenuOffset, setDirectionMenuOffset] = useState({ x: 0, y: 0 });
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const directionMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isDirectionMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setIsDirectionMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDirectionMenuOpen(false);
    };
    document.addEventListener("pointerdown", close, { capture: true });
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close, { capture: true });
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isDirectionMenuOpen]);

  useLayoutEffect(() => {
    const root = toolbarRef.current;
    if (!root || !onMeasure) return;
    let last = "";
    const report = () => {
      const { width, height } = root.getBoundingClientRect();
      const next = `${Math.round(width)}:${Math.round(height)}`;
      if (next !== last) {
        last = next;
        onMeasure({ w: Math.round(width), h: Math.round(height) });
      }
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(root);
    return () => observer.disconnect();
  }, [onMeasure]);

  useLayoutEffect(() => {
    if (!isDirectionMenuOpen) return;
    const keepInViewport = () => {
      const menu = directionMenuRef.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      const margin = 12;
      const x = rect.left < margin ? margin - rect.left : rect.right > window.innerWidth - margin ? window.innerWidth - margin - rect.right : 0;
      const y = rect.top < margin ? margin - rect.top : rect.bottom > window.innerHeight - margin ? window.innerHeight - margin - rect.bottom : 0;
      setDirectionMenuOffset((current) => (current.x === x && current.y === y ? current : { x, y }));
    };
    keepInViewport();
    window.addEventListener("resize", keepInViewport);
    return () => window.removeEventListener("resize", keepInViewport);
  }, [isDirectionMenuOpen, placement?.placement]);

  if (!placement || selectedObjects.length === 0) {
    return null;
  }

  const primary = selectedObjects[0];
  const onlyOne = selectedObjects.length === 1;
  const selectedDirections = selectedObjects.filter((object) => object.type === "conceptDirection");
  const showDirectionActions = onlyOne && primary.type === "conceptDirection";
  const showMergeDirectionsAction = selectedDirections.length >= 2 && selectedDirections.length === selectedObjects.length;
  const showGenericObjectActions = shouldRenderGenericObjectActions(selectedObjects);

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
      ref={toolbarRef}
      className={`selection-toolbar ${placement.placement}`}
      aria-label="选中对象工具"
      style={{ left: placement.x, top: placement.y, visibility: isMeasuring ? "hidden" : "visible" }}
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
            <Info size={15} />
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
          <CanvasIconButton label="查看研究详情" onClick={onOpenResearchDetail}>
            <BookOpen size={15} />
          </CanvasIconButton>
          <CanvasIconButton label="AI 代选" onClick={onAutoSelectResearch}>
            <ListChecks size={15} />
          </CanvasIconButton>
        </div>
      ) : null}
      {onlyOne && primary.type === "delivery" ? (
        <div className="selection-toolbar-group" role="group" aria-label="交付">
          <CanvasIconButton label="打开交付准备" onClick={onOpenDeliveryPreparation}>
            <PackageOpen size={15} />
          </CanvasIconButton>
        </div>
      ) : null}
      {onlyOne && primary.type === "proposalDraft" ? (
        <div className="selection-toolbar-group" role="group" aria-label="草案">
          <CanvasIconButton label="查看草案详情" onClick={onOpenProposalDetail}>
            <Info size={15} />
          </CanvasIconButton>
          <CanvasIconButton label="继续讨论草案" onClick={onContinueProposalDiscussion}>
            <MessageSquareText size={15} />
          </CanvasIconButton>
          <CanvasIconButton label="应用草案" onClick={onApplyProposal}>
            <BadgeCheck size={15} />
          </CanvasIconButton>
          <CanvasIconButton label="放弃草案" danger onClick={onRejectProposal}>
            <FileX2 size={15} />
          </CanvasIconButton>
        </div>
      ) : null}
      {onlyOne && primary.type === "designDefinition" ? (
        <div className="selection-toolbar-group" role="group" aria-label="设计定义">
          <CanvasIconButton label="查看设计定义详情" onClick={onOpenDesignDefinitionDetail}>
            <Info size={15} />
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
              <CanvasIconButton
                label={primary.isDefaultReference ? "取消后续默认参考" : "设为后续默认参考"}
                active={primary.isDefaultReference}
                pressed={primary.isDefaultReference}
                onPointerDownCapture={(event) => {
                  if (event.button !== 0) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  onReferenceIntent();
                }}
                onClick={(event) => {
                  if (event.detail === 0) {
                    onReferenceIntent();
                  }
                }}
              >
            {primary.isDefaultReference ? <PinOff size={15} /> : <Pin size={15} />}
          </CanvasIconButton>
        </div>
      ) : null}
      {showDirectionActions ? (
        <>
          <div className="selection-toolbar-group" role="group" aria-label="方向">
            <CanvasIconButton label="查看方向详情" onClick={onOpenConceptDirectionDetail}>
              <Info size={15} />
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
            ) : null}
          </div>
          <span className="selection-toolbar-divider" aria-hidden="true" />
          <div
            className="selection-toolbar-group is-secondary canvas-toolbar-menu-anchor"
            role="group"
            aria-label="方向更多操作"
            data-menu-direction={getDirectionMenuVerticalDirection(placement)}
          >
            <CanvasIconButton
              label="更多方向操作"
              active={isDirectionMenuOpen}
              aria-haspopup="menu"
              aria-expanded={isDirectionMenuOpen}
              onClick={() => setIsDirectionMenuOpen((value) => !value)}
            >
              {isDirectionMenuOpen ? <X size={16} /> : <MoreHorizontal size={16} />}
            </CanvasIconButton>
            {isDirectionMenuOpen ? (
              <div
                ref={directionMenuRef}
                className="canvas-toolbar-menu"
                role="menu"
                aria-label="方向更多操作"
                style={{ transform: `translate(${directionMenuOffset.x}px, ${directionMenuOffset.y}px)` }}
              >
                <button type="button" role="menuitem" onClick={() => { onReviseDirection(); setIsDirectionMenuOpen(false); }}><PenLine size={15} />修订方向</button>
                <button type="button" role="menuitem" onClick={() => { onSplitDirection(); setIsDirectionMenuOpen(false); }}><GitBranch size={15} />拆分方向</button>
                <button type="button" role="menuitem" onClick={() => { onCreateVisualBranch(); setIsDirectionMenuOpen(false); }}><GitBranchPlus size={15} />创建视觉分支</button>
                <button type="button" role="menuitem" onClick={() => { onHide(); setIsDirectionMenuOpen(false); }}><EyeOff size={15} />隐藏</button>
                <hr />
                {primary.status !== "eliminated" ? <button type="button" role="menuitem" className="is-eliminate" onClick={() => { onEliminateDirection(); setIsDirectionMenuOpen(false); }}><CircleOff size={15} />淘汰方向</button> : null}
                <button type="button" role="menuitem" className="danger" onClick={() => { onDelete(); setIsDirectionMenuOpen(false); }}><Trash2 size={15} />删除</button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      {showMergeDirectionsAction ? (
        <div className="selection-toolbar-group" role="group" aria-label="合并方向">
          <CanvasIconButton label="合并方向" onClick={onMergeDirections}>
            <GitMerge size={15} />
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
          {isDesignTraceActive ? <Unlink size={15} /> : <GitBranch size={15} />}
        </CanvasIconButton>
      </div>
      {showGenericObjectActions ? (
        <>
          <span className="selection-toolbar-divider" aria-hidden="true" />
          <div className="selection-toolbar-group is-secondary" role="group" aria-label="对象显示与删除">
            <CanvasIconButton label="隐藏对象" onClick={onHide}>
              <EyeOff size={15} />
            </CanvasIconButton>
            <CanvasIconButton label="删除对象" danger onClick={onDelete}>
              <Trash2 size={15} />
            </CanvasIconButton>
          </div>
        </>
      ) : null}
    </div>
  );
}

export type CanvasContextMenuKind = "object" | "stage" | "empty";

export type CanvasContextMenuStageInfo = {
  id: string;
  title: string;
  locked: boolean;
  canFit: boolean;
};

export type CanvasContextMenuProps = {
  x: number;
  y: number;
  /** Hit target: object card, stage region, or empty canvas. */
  kind: CanvasContextMenuKind;
  selectedObjects: MorphoObject[];
  stage?: CanvasContextMenuStageInfo | null;
  hasSelection: boolean;
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
  onClearSelection: () => void;
  onFocusOverview: () => void;
  onFitStage: () => void;
  onToggleStageLock: () => void;
  onResetStageStyle: () => void;
  onPasteHere: () => void;
  onImportFiles: () => void;
  onSelectAllVisible: () => void;
};

function ContextMenuShell({
  x,
  y,
  label,
  children
}: {
  x: number;
  y: number;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="canvas-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      aria-label={label}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}

export function CanvasContextMenu({
  x,
  y,
  kind,
  selectedObjects,
  stage = null,
  hasSelection,
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
  onReorderLayer,
  onClearSelection,
  onFocusOverview,
  onFitStage,
  onToggleStageLock,
  onResetStageStyle,
  onPasteHere,
  onImportFiles,
  onSelectAllVisible
}: CanvasContextMenuProps) {
  const run = (action: () => void) => {
    action();
    onClose();
  };

  if (kind === "empty") {
    return (
      <ContextMenuShell x={x} y={y} label="画布菜单">
        <button type="button" role="menuitem" onClick={() => run(onPasteHere)}>
          <ClipboardPaste size={15} />
          粘贴
        </button>
        <button type="button" role="menuitem" onClick={() => run(onImportFiles)}>
          <FileUp size={15} />
          导入文件…
        </button>
        <hr />
        <button type="button" role="menuitem" onClick={() => run(onAskAi)}>
          <MessageSquareText size={15} />
          询问 AI
        </button>
        <button type="button" role="menuitem" onClick={() => run(onFocusOverview)}>
          <ScanSearch size={15} />
          查看全局
        </button>
        <button type="button" role="menuitem" onClick={() => run(onSelectAllVisible)}>
          <Copy size={15} />
          全选可见对象
        </button>
        {hasSelection ? (
          <button type="button" role="menuitem" onClick={() => run(onClearSelection)}>
            <CircleOff size={15} />
            取消选择
          </button>
        ) : null}
      </ContextMenuShell>
    );
  }

  if (kind === "stage" && stage) {
    return (
      <ContextMenuShell x={x} y={y} label={`${stage.title}分区菜单`}>
        <button type="button" role="menuitem" onClick={() => run(onPasteHere)}>
          <ClipboardPaste size={15} />
          粘贴到此处
        </button>
        <button type="button" role="menuitem" onClick={() => run(onImportFiles)}>
          <FileUp size={15} />
          导入文件…
        </button>
        <hr />
        <button type="button" role="menuitem" disabled={!stage.canFit} onClick={() => run(onFitStage)}>
          <Scan size={15} />
          适应内容
        </button>
        <button type="button" role="menuitem" onClick={() => run(onToggleStageLock)}>
          {stage.locked ? <LockKeyholeOpen size={15} /> : <LockKeyhole size={15} />}
          {stage.locked ? "解锁分区" : "锁定分区"}
        </button>
        <button type="button" role="menuitem" onClick={() => run(onResetStageStyle)}>
          <RotateCcw size={15} />
          恢复默认样式
        </button>
        <hr />
        <button type="button" role="menuitem" onClick={() => run(onAskAi)}>
          <MessageSquareText size={15} />
          询问 AI
        </button>
      </ContextMenuShell>
    );
  }

  if (selectedObjects.length === 0) {
    // Object kind without resolved objects — fall back to empty canvas actions.
    return (
      <ContextMenuShell x={x} y={y} label="画布菜单">
        <button type="button" role="menuitem" onClick={() => run(onPasteHere)}>
          <ClipboardPaste size={15} />
          粘贴
        </button>
        <button type="button" role="menuitem" onClick={() => run(onImportFiles)}>
          <FileUp size={15} />
          导入文件…
        </button>
        <hr />
        <button type="button" role="menuitem" onClick={() => run(onAskAi)}>
          <MessageSquareText size={15} />
          询问 AI
        </button>
        <button type="button" role="menuitem" onClick={() => run(onFocusOverview)}>
          <ScanSearch size={15} />
          查看全局
        </button>
      </ContextMenuShell>
    );
  }

  const primary = selectedObjects[0];
  const multi = selectedObjects.length > 1;

  if (primary.type === "proposalDraft" && !multi) {
    return (
      <ContextMenuShell x={x} y={y} label="画布草案菜单">
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
      </ContextMenuShell>
    );
  }

  return (
    <ContextMenuShell x={x} y={y} label={multi ? "画布多选菜单" : "画布对象菜单"}>
      {!multi ? (
        <>
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
                定向修改
              </button>
              <button type="button" role="menuitem" onClick={() => run(onReferenceIntent)}>
                <Pin size={15} />
                {primary.isDefaultReference ? "取消后续默认参考" : "设为后续默认参考"}
              </button>
            </>
          ) : null}
          <hr />
        </>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={() => run(onAskAi)}>
            <MessageSquareText size={15} />
            询问 AI
          </button>
          <hr />
        </>
      )}
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
        {multi ? "隐藏所选" : "隐藏"}
      </button>
      <button className="danger" type="button" role="menuitem" onClick={() => run(onDelete)}>
        <Trash2 size={15} />
        {multi ? "删除所选" : "删除"}
      </button>
    </ContextMenuShell>
  );
}
