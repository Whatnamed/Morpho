import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import { CanvasContextMenu, SelectionToolbar } from "./SelectionToolbar";

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
    expect(html).toContain('aria-label="设为后续默认参考"');
    expect(html).toContain('aria-label="隐藏对象"');
    expect(html).toContain('aria-label="删除对象"');
    expect(html).not.toContain(">局部编辑<");
    expect(html).not.toContain(selected[0].title);
    expect(html).not.toContain("研究详情");
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

  it("offers stable layer operations in the Morpho context menu", () => {
    const workspace = createInitialWorkspace();
    const html = renderToStaticMarkup(
      createElement(CanvasContextMenu, {
        x: 100,
        y: 120,
        selectedObjects: [workspace.objects["image-soft-rail-v2"]],
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
        onReorderLayer: () => undefined
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
        onReorderLayer: () => undefined
      })
    );

    expect(html).toContain("查看详情");
    expect(html).toContain("应用草案");
    expect(html).toContain("放弃草案");
    expect(html).not.toContain("隐藏");
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
    expect(html).not.toContain(">查看方向详情<");
    expect(html).not.toContain(">修订方向<");
  });
});
