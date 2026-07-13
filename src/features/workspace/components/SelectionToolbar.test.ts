import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import {
  CanvasContextMenu,
  getDirectionMenuVerticalDirection,
  SelectionToolbar,
  shouldRenderGenericObjectActions
} from "./SelectionToolbar";

describe("SelectionToolbar", () => {
  it("renders action tools near the selection without repeating object titles", () => {
    const workspace = createInitialWorkspace();
    const selected = [workspace.objects["image-soft-rail-v2"]];

    const html = renderToStaticMarkup(
      createElement(SelectionToolbar, {
        selectedObjects: selected,
        placement: { x: 120, y: 220, placement: "above" },
        isDesignTraceActive: false,
        onAskAi: () => undefined,
        onToggleDesignTrace: () => undefined,
        onOpenResearchDetail: () => undefined,
        onAutoSelectResearch: () => undefined,
        onOpenDocumentReader: () => undefined,
        onOpenDeliveryPreparation: () => undefined,
        onLocalEdit: () => undefined,
        onReferenceIntent: () => undefined,
        onHide: () => undefined,
        onDelete: () => undefined,
        onOpenProposalDetail: () => undefined,
        onApplyProposal: () => undefined,
        onRejectProposal: () => undefined,
        onContinueProposalDiscussion: () => undefined,
        onOpenDesignDefinitionDetail: () => undefined,
        onOpenConceptDirectionDetail: () => undefined,
        onSetCurrentDesignDefinition: () => undefined,
        onReviseDirection: () => undefined,
        onSplitDirection: () => undefined,
        onMergeDirections: () => undefined,
        onCreateVisualBranch: () => undefined,
        onSetDirectionPrimary: () => undefined,
        onSetDirectionAlternative: () => undefined,
        onRestoreDirectionAsAlternative: () => undefined,
        onEliminateDirection: () => undefined,
        onReorderLayer: () => undefined
      })
    );

    expect(html).toContain("selection-toolbar");
    expect(html).toContain('aria-label="局部编辑"');
    expect(html).toContain('data-tooltip="局部编辑"');
    // Seed image is already the default reference: pin is active and toggles cancel.
    expect(html).toContain('aria-label="取消后续默认参考"');
    expect(html).toContain("is-active");
    expect(html).toContain("lucide-pin-off");
    expect(html).not.toContain('class="canvas-icon-button brand"');
    expect(html).not.toContain('class="canvas-icon-button brand is-active"');
    expect(html).toContain('aria-label="隐藏对象"');
    expect(html).toContain('aria-label="删除对象"');
    expect(html).not.toContain(">局部编辑<");
    expect(html).not.toContain(selected[0].title);
    expect(html).not.toContain("研究详情");
  });

  it("shows an inactive pin for images that are not the default reference", () => {
    const workspace = createInitialWorkspace();
    const selected = [workspace.objects["image-soft-rail-v2"]];
    if (!selected[0] || selected[0].type !== "image") {
      throw new Error("Expected seed image.");
    }

    const html = renderToStaticMarkup(
      createElement(SelectionToolbar, {
        selectedObjects: [{ ...selected[0], isDefaultReference: false }],
        placement: { x: 120, y: 220, placement: "above" },
        isDesignTraceActive: false,
        onAskAi: () => undefined,
        onToggleDesignTrace: () => undefined,
        onOpenResearchDetail: () => undefined,
        onAutoSelectResearch: () => undefined,
        onOpenDocumentReader: () => undefined,
        onOpenDeliveryPreparation: () => undefined,
        onLocalEdit: () => undefined,
        onReferenceIntent: () => undefined,
        onHide: () => undefined,
        onDelete: () => undefined,
        onOpenProposalDetail: () => undefined,
        onApplyProposal: () => undefined,
        onRejectProposal: () => undefined,
        onContinueProposalDiscussion: () => undefined,
        onOpenDesignDefinitionDetail: () => undefined,
        onOpenConceptDirectionDetail: () => undefined,
        onSetCurrentDesignDefinition: () => undefined,
        onReviseDirection: () => undefined,
        onSplitDirection: () => undefined,
        onMergeDirections: () => undefined,
        onCreateVisualBranch: () => undefined,
        onSetDirectionPrimary: () => undefined,
        onSetDirectionAlternative: () => undefined,
        onRestoreDirectionAsAlternative: () => undefined,
        onEliminateDirection: () => undefined,
        onReorderLayer: () => undefined
      })
    );

    expect(html).toContain('aria-label="设为后续默认参考"');
    expect(html).not.toContain('aria-label="取消后续默认参考"');
    expect(html).not.toMatch(/aria-label="设为后续默认参考"[^>]*is-active|is-active[^>]*aria-label="设为后续默认参考"/);
    expect(html).toContain("lucide-pin");
    expect(html).not.toContain("lucide-pin-off");
  });

  it("keeps detail actions neutral and changes the trace icon instead of adding an active fill", () => {
    const workspace = createInitialWorkspace();
    const selected = [workspace.objects["research-night-path"]];
    const html = renderToStaticMarkup(
      createElement(SelectionToolbar, {
        selectedObjects: selected,
        placement: { x: 120, y: 220, placement: "above" },
        isDesignTraceActive: true,
        onAskAi: () => undefined,
        onToggleDesignTrace: () => undefined,
        onOpenResearchDetail: () => undefined,
        onAutoSelectResearch: () => undefined,
        onOpenDocumentReader: () => undefined,
        onOpenDeliveryPreparation: () => undefined,
        onLocalEdit: () => undefined,
        onReferenceIntent: () => undefined,
        onHide: () => undefined,
        onDelete: () => undefined,
        onOpenProposalDetail: () => undefined,
        onApplyProposal: () => undefined,
        onRejectProposal: () => undefined,
        onContinueProposalDiscussion: () => undefined,
        onOpenDesignDefinitionDetail: () => undefined,
        onOpenConceptDirectionDetail: () => undefined,
        onSetCurrentDesignDefinition: () => undefined,
        onReviseDirection: () => undefined,
        onSplitDirection: () => undefined,
        onMergeDirections: () => undefined,
        onCreateVisualBranch: () => undefined,
        onSetDirectionPrimary: () => undefined,
        onSetDirectionAlternative: () => undefined,
        onRestoreDirectionAsAlternative: () => undefined,
        onEliminateDirection: () => undefined,
        onReorderLayer: () => undefined
      })
    );

    expect(html).toContain('aria-label="查看研究详情"');
    expect(html).not.toContain("canvas-icon-button brand");
    expect(html).toContain('aria-label="关闭链路"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("lucide-unlink");
  });

  it("offers setting a non-current design definition as current", () => {
    const workspace = createInitialWorkspace();
    const current = workspace.objects["definition-current"];
    if (!current || current.type !== "designDefinition") {
      throw new Error("Expected a design definition.");
    }

    const html = renderToStaticMarkup(
      createElement(SelectionToolbar, {
        selectedObjects: [{ ...current, id: "definition-alternative", isCurrentEffective: false }],
        placement: { x: 120, y: 220, placement: "above" },
        isDesignTraceActive: false,
        onAskAi: () => undefined,
        onToggleDesignTrace: () => undefined,
        onOpenResearchDetail: () => undefined,
        onAutoSelectResearch: () => undefined,
        onOpenDocumentReader: () => undefined,
        onOpenDeliveryPreparation: () => undefined,
        onLocalEdit: () => undefined,
        onReferenceIntent: () => undefined,
        onHide: () => undefined,
        onDelete: () => undefined,
        onOpenProposalDetail: () => undefined,
        onApplyProposal: () => undefined,
        onRejectProposal: () => undefined,
        onContinueProposalDiscussion: () => undefined,
        onOpenDesignDefinitionDetail: () => undefined,
        onOpenConceptDirectionDetail: () => undefined,
        onSetCurrentDesignDefinition: () => undefined,
        onReviseDirection: () => undefined,
        onSplitDirection: () => undefined,
        onMergeDirections: () => undefined,
        onCreateVisualBranch: () => undefined,
        onSetDirectionPrimary: () => undefined,
        onSetDirectionAlternative: () => undefined,
        onRestoreDirectionAsAlternative: () => undefined,
        onEliminateDirection: () => undefined,
        onReorderLayer: () => undefined
      })
    );

    expect(html).toContain('aria-label="查看设计定义详情"');
    expect(html).toContain('aria-label="设为当前设计定义"');
  });

  it("offers research detail only for a selected research object", () => {
    const workspace = createInitialWorkspace();
    const selected = [workspace.objects["research-night-path"]];

    const html = renderToStaticMarkup(
      createElement(SelectionToolbar, {
        selectedObjects: selected,
        placement: { x: 120, y: 220, placement: "above" },
        isDesignTraceActive: false,
        onAskAi: () => undefined,
        onToggleDesignTrace: () => undefined,
        onOpenResearchDetail: () => undefined,
        onAutoSelectResearch: () => undefined,
        onOpenDocumentReader: () => undefined,
        onOpenDeliveryPreparation: () => undefined,
        onLocalEdit: () => undefined,
        onReferenceIntent: () => undefined,
        onHide: () => undefined,
        onDelete: () => undefined,
        onOpenProposalDetail: () => undefined,
        onApplyProposal: () => undefined,
        onRejectProposal: () => undefined,
        onContinueProposalDiscussion: () => undefined,
        onOpenDesignDefinitionDetail: () => undefined,
        onOpenConceptDirectionDetail: () => undefined,
        onSetCurrentDesignDefinition: () => undefined,
        onReviseDirection: () => undefined,
        onSplitDirection: () => undefined,
        onMergeDirections: () => undefined,
        onCreateVisualBranch: () => undefined,
        onSetDirectionPrimary: () => undefined,
        onSetDirectionAlternative: () => undefined,
        onRestoreDirectionAsAlternative: () => undefined,
        onEliminateDirection: () => undefined,
        onReorderLayer: () => undefined
      })
    );

    expect(html).toContain("研究详情");
    expect(html).toContain("AI 代选");
  });

  const contextMenuHandlers = {
    onClose: () => undefined,
    onCopySummary: () => undefined,
    onAskAi: () => undefined,
    onLocalEdit: () => undefined,
    onReferenceIntent: () => undefined,
    onHide: () => undefined,
    onDelete: () => undefined,
    onOpenProposalDetail: () => undefined,
    onApplyProposal: () => undefined,
    onRejectProposal: () => undefined,
    onContinueProposalDiscussion: () => undefined,
    onOpenDesignDefinitionDetail: () => undefined,
    onOpenConceptDirectionDetail: () => undefined,
    onReorderLayer: () => undefined,
    onClearSelection: () => undefined,
    onFocusOverview: () => undefined,
    onFitStage: () => undefined,
    onToggleStageLock: () => undefined,
    onResetStageStyle: () => undefined,
    onPasteHere: () => undefined,
    onImportFiles: () => undefined,
    onSelectAllVisible: () => undefined
  };

  it("offers stable layer operations in the Morpho context menu", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(CanvasContextMenu, {
        x: 100,
        y: 120,
        kind: "object",
        selectedObjects: [workspace.objects["image-soft-rail-v2"]],
        hasSelection: true,
        ...contextMenuHandlers
      })
    );

    expect(html).toContain("画布对象菜单");
    expect(html).toContain("上移一层");
    expect(html).toContain("下移一层");
    expect(html).toContain("置于顶层");
    expect(html).toContain("置于底层");
  });

  it("offers proposal actions in the Morpho context menu for real proposal draft objects", () => {
    const html = renderToStaticMarkup(
      createElement(CanvasContextMenu, {
        x: 100,
        y: 120,
        kind: "object",
        selectedObjects: [
          {
            id: "proposal-definition-a",
            type: "proposalDraft",
            title: "Definition draft",
            summary: "Short summary",
            createdBy: "ai",
            visibility: "active",
            proposalId: "proposal-definition-a",
            proposalType: "designDefinition"
          }
        ],
        hasSelection: true,
        ...contextMenuHandlers
      })
    );

    expect(html).toContain("查看详情");
    expect(html).toContain("应用草案");
    expect(html).toContain("放弃草案");
    expect(html).not.toContain("隐藏");
  });

  it("shows a canvas menu on empty right-click with optional clear-selection", () => {
    const empty = renderToStaticMarkup(
      createElement(CanvasContextMenu, {
        x: 40,
        y: 50,
        kind: "empty",
        selectedObjects: [],
        hasSelection: false,
        ...contextMenuHandlers
      })
    );
    expect(empty).toContain("画布菜单");
    expect(empty).toContain("粘贴");
    expect(empty).toContain("导入文件");
    expect(empty).toContain("全选可见对象");
    expect(empty).toContain("询问 AI");
    expect(empty).toContain("查看全局");
    expect(empty).not.toContain("取消选择");

    const withSelection = renderToStaticMarkup(
      createElement(CanvasContextMenu, {
        x: 40,
        y: 50,
        kind: "empty",
        selectedObjects: [],
        hasSelection: true,
        ...contextMenuHandlers
      })
    );
    expect(withSelection).toContain("取消选择");
  });

  it("shows stage-specific actions when right-clicking a stage region", () => {
    const html = renderToStaticMarkup(
      createElement(CanvasContextMenu, {
        x: 40,
        y: 50,
        kind: "stage",
        selectedObjects: [],
        hasSelection: false,
        stage: { id: "stage-research", title: "资料与研究", locked: false, canFit: true },
        ...contextMenuHandlers
      })
    );
    expect(html).toContain("资料与研究分区菜单");
    expect(html).toContain("粘贴到此处");
    expect(html).toContain("导入文件");
    expect(html).toContain("适应内容");
    expect(html).toContain("锁定分区");
    expect(html).toContain("恢复默认样式");
    expect(html).not.toContain("删除");
  });

  it("offers proposal actions directly in the selection toolbar", () => {
    const html = renderToStaticMarkup(
      createElement(SelectionToolbar, {
        selectedObjects: [
          {
            id: "proposal-direction-a",
            type: "proposalDraft",
            title: "Direction draft",
            summary: "Three directions",
            createdBy: "ai",
            visibility: "active",
            proposalId: "proposal-direction-a",
            proposalType: "conceptDirection"
          }
        ],
        placement: { x: 120, y: 220, placement: "above" },
        isDesignTraceActive: false,
        onAskAi: () => undefined,
        onToggleDesignTrace: () => undefined,
        onOpenResearchDetail: () => undefined,
        onAutoSelectResearch: () => undefined,
        onOpenDocumentReader: () => undefined,
        onOpenDeliveryPreparation: () => undefined,
        onLocalEdit: () => undefined,
        onReferenceIntent: () => undefined,
        onHide: () => undefined,
        onDelete: () => undefined,
        onOpenProposalDetail: () => undefined,
        onApplyProposal: () => undefined,
        onRejectProposal: () => undefined,
        onContinueProposalDiscussion: () => undefined,
        onOpenDesignDefinitionDetail: () => undefined,
        onOpenConceptDirectionDetail: () => undefined,
        onSetCurrentDesignDefinition: () => undefined,
        onReviseDirection: () => undefined,
        onSplitDirection: () => undefined,
        onMergeDirections: () => undefined,
        onCreateVisualBranch: () => undefined,
        onSetDirectionPrimary: () => undefined,
        onSetDirectionAlternative: () => undefined,
        onRestoreDirectionAsAlternative: () => undefined,
        onEliminateDirection: () => undefined,
        onReorderLayer: () => undefined
      })
    );

    expect(html).toContain('aria-label="查看草案详情"');
    expect(html).toContain('aria-label="应用草案"');
    expect(html).toContain('aria-label="放弃草案"');
  });

  it("offers a direct detail action for a selected concept direction", () => {
    const workspace = createInitialWorkspace();
    const direction = workspace.objects["direction-soft-rail"];
    if (!direction || direction.type !== "conceptDirection") {
      throw new Error("Expected concept direction.");
    }

    const html = renderToStaticMarkup(
      createElement(SelectionToolbar, {
        selectedObjects: [direction],
        placement: { x: 120, y: 220, placement: "above" },
        isDesignTraceActive: false,
        onAskAi: () => undefined,
        onToggleDesignTrace: () => undefined,
        onOpenResearchDetail: () => undefined,
        onAutoSelectResearch: () => undefined,
        onOpenDocumentReader: () => undefined,
        onOpenDeliveryPreparation: () => undefined,
        onLocalEdit: () => undefined,
        onReferenceIntent: () => undefined,
        onHide: () => undefined,
        onDelete: () => undefined,
        onOpenProposalDetail: () => undefined,
        onApplyProposal: () => undefined,
        onRejectProposal: () => undefined,
        onContinueProposalDiscussion: () => undefined,
        onOpenDesignDefinitionDetail: () => undefined,
        onOpenConceptDirectionDetail: () => undefined,
        onSetCurrentDesignDefinition: () => undefined,
        onReviseDirection: () => undefined,
        onSplitDirection: () => undefined,
        onMergeDirections: () => undefined,
        onCreateVisualBranch: () => undefined,
        onSetDirectionPrimary: () => undefined,
        onSetDirectionAlternative: () => undefined,
        onRestoreDirectionAsAlternative: () => undefined,
        onEliminateDirection: () => undefined,
        onReorderLayer: () => undefined
      })
    );

    expect(html).toContain('aria-label="查看方向详情"');
    expect(html).toContain('data-tooltip="查看方向详情"');
    expect(html).toContain('aria-label="更多方向操作"');
    expect(html).toContain('data-menu-direction="down"');
    expect(html).not.toContain(">查看方向详情<");
    expect(html).not.toContain(">修订方向<");
    expect(html).not.toContain('aria-label="隐藏对象"');
    expect(html).not.toContain('aria-label="删除对象"');
  });

  it("keeps hide and delete in the direction menu only, while ordinary objects retain generic actions", () => {
    const workspace = createInitialWorkspace();
    const direction = workspace.objects["direction-soft-rail"]!;
    const image = workspace.objects["image-soft-rail-v2"]!;
    expect(shouldRenderGenericObjectActions([direction])).toBe(false);
    expect(shouldRenderGenericObjectActions([image])).toBe(true);
  });

  it("opens a direction more menu upward when its toolbar is placed below the selection", () => {
    expect(getDirectionMenuVerticalDirection({ x: 12, y: 12, placement: "below" })).toBe("up");
    expect(getDirectionMenuVerticalDirection({ x: 12, y: 12, placement: "above" })).toBe("down");
  });
});
