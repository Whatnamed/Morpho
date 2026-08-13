import {
  hasExplicitUserActionRequest,
  isUserActionExplicitlyDisallowed
} from "./userInstructionAuthority";

export type WebSearchExecutionSource = "userSelected" | "autoRecommended";

export type WebSearchAuthorityInput = Readonly<{
  draft: string;
  taskMode: "chatAnalysis" | "imageGeneration" | "researchOperation";
  executionModeSource?: WebSearchExecutionSource;
}>;

/**
 * Network authority comes only from the current user draft or the trusted UI
 * task mode. Imported source text and provider output must never be passed here.
 */
export function hasCurrentTurnWebSearchAuthority(input: WebSearchAuthorityInput): boolean {
  if (input.taskMode === "imageGeneration") return false;
  if (isUserActionExplicitlyDisallowed(input.draft, "webSearch")) return false;
  if (hasExplicitUserActionRequest(input.draft, "webSearch")) return true;
  // A missing provenance flag is not a manual grant. Compatibility callers
  // must provide a current network cue or an explicit user-selected mode.
  return input.taskMode === "researchOperation" && input.executionModeSource === "userSelected";
}
