const PROPOSAL_DRAFT_HEIGHT = 168;
const SIBLING_PROPOSAL_GAP = 32;

export function getSiblingProposalPlacement(
  origin: { x: number; y: number },
  siblingIndex: number
): { x: number; y: number } {
  return {
    x: origin.x,
    y: origin.y + siblingIndex * (PROPOSAL_DRAFT_HEIGHT + SIBLING_PROPOSAL_GAP)
  };
}
