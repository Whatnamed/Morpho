import type { ComponentProps } from "react";

import { createTestWorkspace } from "@/test/createTestWorkspace";
import type { AiConversationPanel } from "@/features/workspace/components/AiConversationPanel";

export function buildAiConversationPanelProps(
  overrides: Partial<ComponentProps<typeof AiConversationPanel>> = {}
): ComponentProps<typeof AiConversationPanel> {
  const workspace = createTestWorkspace();
  return {
    workspace,
    selectedObjects: [],
    suggestions: [],
    draft: "",
    isOpen: true,
    isImageTaskContext: false,
    isImageGenerationAuthorized: false,
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
    onImageGenerationAuthorizationChange: () => undefined,
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
    onFailureEdit: () => undefined,
    onOpenProjectRecords: () => undefined,
    ...overrides
  };
}
