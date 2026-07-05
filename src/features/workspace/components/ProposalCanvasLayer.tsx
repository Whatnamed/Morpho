"use client";

import type { ArtifactProposal } from "@/domain/operations/types";
import type { CanvasView } from "@/domain/morpho/types";

type ProposalCanvasLayerProps = {
  proposals: ArtifactProposal[];
  view: CanvasView;
  activeProposalId: string | null;
  onFocusProposal: (proposalId: string) => void;
  onApplyProposal: (proposalId: string) => void;
  onRejectProposal: (proposalId: string) => void;
  onContinueDiscussion: (proposalId: string) => void;
};

export function ProposalCanvasLayer({
  proposals,
  view,
  activeProposalId,
  onFocusProposal,
  onApplyProposal,
  onRejectProposal,
  onContinueDiscussion
}: ProposalCanvasLayerProps) {
  if (proposals.length === 0) {
    return null;
  }

  return (
    <div className="proposal-canvas-layer" aria-label="画布草案">
      {proposals.map((proposal) => {
        if (!proposal.canvasPlacement) {
          return null;
        }
        const left = proposal.canvasPlacement.x * view.zoom + view.x;
        const top = proposal.canvasPlacement.y * view.zoom + view.y;

        return (
          <article
            key={proposal.id}
            className={`proposal-canvas-card${proposal.id === activeProposalId ? " is-active" : ""}`}
            style={{
              left,
              top,
              transform: `scale(${Math.max(0.72, Math.min(view.zoom, 1))})`,
              transformOrigin: "top left"
            }}
          >
            <button type="button" className="proposal-canvas-hitbox" onClick={() => onFocusProposal(proposal.id)}>
              <span className="proposal-canvas-kind">{formatProposalKind(proposal.type)}</span>
              <strong>{proposal.title}</strong>
              <p>{proposal.summary}</p>
            </button>
            <div className="proposal-canvas-actions">
              <button type="button" className="plain-button" onClick={() => onContinueDiscussion(proposal.id)}>
                继续讨论
              </button>
              <button type="button" className="plain-button" onClick={() => onRejectProposal(proposal.id)}>
                丢弃
              </button>
              <button type="button" className="brand-button" onClick={() => onApplyProposal(proposal.id)}>
                应用
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function formatProposalKind(type: ArtifactProposal["type"]): string {
  switch (type) {
    case "researchAnalysis":
      return "研究草案";
    case "designDefinition":
      return "设计定义草案";
    case "conceptDirection":
      return "方向草案";
    case "deliveryPlan":
    default:
      return "草案";
  }
}
