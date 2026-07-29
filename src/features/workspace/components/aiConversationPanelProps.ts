import type { ComponentProps } from "react";

import { createInitialWorkspace } from "@/domain/morpho/workspace";
import type { AiConversationPanel } from "./AiConversationPanel";

/**
 * Default props for rendering `AiConversationPanel` outside the app.
 *
 * Shared by `AiConversationPanel.test.ts` and the render-cost targets in
 * `performanceBenchmarks.ts`. Kept in one place so the panel's 40-odd required props
 * are satisfied once: when a prop is added, `tsc --noEmit` fails here rather than in
 * two copies that drift.
 *
 * Every callback is a no-op. This builds a renderable panel, not a working one.
 */
export function buildAiConversationPanelProps(
  overrides: Partial<ComponentProps<typeof AiConversationPanel>> = {}
): ComponentProps<typeof AiConversationPanel> {
  const workspace = createInitialWorkspace();
  return {
    workspace,
    selectedObjects: [],
    suggestions: [],
    draft: "",
    isOpen: true,
    isImageTaskContext: false,
    turnMode: "auto" as const,
    isStreaming: false,
    imageGenerationSettings: {
      modelId: "nano-banana-fast",
      modelLabel: "Nano Banana Fast",
      points: 1,
      aspectRatio: "1:1" as const,
      sizeOption: undefined,
      sizeOptions: [],
      capabilities: ["textToImage" as const]
    },
    directionPreviewCount: 2 as const,
    pendingConfirmation: null,
    showFailure: false,
    showRecoveryPending: false,
    onToggleOpen: () => undefined,
    onDraftChange: () => undefined,
    onTurnModeChange: () => undefined,
    onImageGenerationSettingsChange: () => undefined,
    onDirectionPreviewCountChange: () => undefined,
    onSuggestionClick: () => undefined,
    onSendMessage: () => undefined,
    onCancelRequest: () => undefined,
    onApplyProposal: () => undefined,
    onRejectProposal: () => undefined,
    onContinueProposalDiscussion: () => undefined,
    onRegenerateProposal: () => undefined,
    onSaveResearchProposalDraft: () => undefined,
    onSaveDesignDefinitionProposalDraft: () => undefined,
    onSaveConceptDirectionProposalDraft: () => undefined,
    onUpdatePendingKeyConclusion: () => undefined,
    onUpdatePendingComparison: () => undefined,
    onRequestComparisonAction: () => undefined,
    onLocateObject: () => undefined,
    onConfirmPending: () => undefined,
    onCancelPending: () => undefined,
    onFailureRetry: () => undefined,
    onOpenProjectRecords: () => undefined,
    ...overrides
  };
}
