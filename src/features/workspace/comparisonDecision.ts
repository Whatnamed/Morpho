import type { PendingComparisonConfirmation } from "./components/AiConversationPanel";

export function resolveComparisonWritebackSourceObjectIds(confirmation: PendingComparisonConfirmation): string[] {
  return confirmation.kind === "compareCreateKeyConclusion"
    ? confirmation.keyConclusionSourceObjectIds
    : confirmation.comparisonSourceObjectIds;
}
