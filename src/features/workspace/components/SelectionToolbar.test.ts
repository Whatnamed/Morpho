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
    expect(html).toContain("局部改");
    expect(html).toContain("默认参考");
    expect(html).not.toContain(selected[0].title);
    expect(html).not.toContain("研究详情");
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

    expect(html).toContain("查看详情");
    expect(html).toContain("应用草案");
    expect(html).toContain("放弃草案");
  });
});
