"use client";

import type { ComponentProps } from "react";

import { ProposalDraftCard } from "./ProposalDraftCard";

type ProposalReviewPanelProps = ComponentProps<typeof ProposalDraftCard>;

export function ProposalReviewPanel(props: ProposalReviewPanelProps) {
  return (
    <aside className="proposal-review-panel" aria-label="画布草案审阅">
      <ProposalDraftCard {...props} />
    </aside>
  );
}
