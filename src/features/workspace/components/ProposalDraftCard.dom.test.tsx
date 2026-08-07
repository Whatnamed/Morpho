// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import type { ResearchAnalysisProposal } from "@/domain/operations/types";
import { ProposalDraftCard } from "./ProposalDraftCard";

const roots: Root[] = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await act(async () => root.unmount());
    }
  }
  document.body.replaceChildren();
});

describe("ProposalDraftCard review controls", () => {
  it("keeps sourceChanged as an explicit reviewed-source apply action", async () => {
    const onApply = vi.fn();
    const { container } = await renderCard({ reviewState: "sourceChanged" }, onApply);

    const applyButton = findButton(container, "已复核来源，仍然应用到画布");
    expect(applyButton.disabled).toBe(false);

    await act(async () => {
      applyButton.click();
    });

    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(true);
  });

  it("allows ready proposals without review marks and blocks unavailable bases", async () => {
    const readyApply = vi.fn();
    const ready = await renderCard({ reviewState: "ready" }, readyApply);
    const readyButton = findButton(ready.container, "保存到画布");

    await act(async () => {
      readyButton.click();
    });

    expect(readyApply).toHaveBeenCalledWith(false);

    const blocked = await renderCard({ reviewState: "baseSuperseded" }, vi.fn());
    expect(findButton(blocked.container, "保存到画布").disabled).toBe(true);

    const unavailable = await renderCard({ reviewState: "targetUnavailable" }, vi.fn());
    expect(findButton(unavailable.container, "保存到画布").disabled).toBe(true);
  });
});

async function renderCard(
  overrides: Pick<ResearchAnalysisProposal, "reviewState">,
  onApply: (allowSourceChanged?: boolean) => void
): Promise<{ container: HTMLDivElement }> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(
      createElement(ProposalDraftCard, {
        workspace: { objects: {}, citationSnapshots: {} } as MorphoWorkspace,
        proposal: {
          ...createResearchProposal(),
          ...overrides
        },
        onApply,
        onReject: () => undefined,
        onContinueDiscussion: () => undefined,
        onRegenerate: () => undefined,
        onSaveResearchDraft: () => undefined,
        onSaveDesignDefinitionDraft: () => undefined,
        onSaveConceptDirectionDraft: () => undefined
      })
    );
  });

  return { container };
}

function createResearchProposal(): ResearchAnalysisProposal {
  return {
    id: "proposal-review-controls",
    type: "researchAnalysis",
    operationId: "operation-review-controls",
    status: "pending",
    reviewState: "ready",
    sourceSnapshots: [],
    sourceObjectIds: [],
    citationIds: [],
    createdAt: "2026-08-07T00:00:00.000Z",
    title: "研究草案",
    summary: "用于固定 reviewState 行为的研究草案。",
    findings: [],
    opportunities: [],
    constraints: [],
    openQuestions: [],
    evidence: []
  };
}

function findButton(container: HTMLDivElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(label));
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}
