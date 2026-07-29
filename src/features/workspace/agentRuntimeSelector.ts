import type { AgentTurnHost } from "./agentTurnHost";
import { runMorphoAgentTurn } from "./agentTurnRunner";
import {
  acknowledgeMorphoAgentPendingConfirmationAPlus,
  cancelMorphoAgentTurnAPlus,
  recoverMorphoAgentTurnAPlus,
  runManualCompactionTurnAPlus,
  runMorphoAgentTurnAPlus,
  type AgentTurnRunnerAPlusDependencies
} from "./agentTurnRunnerAPlus";
import type { RunMorphoAgentTurnAPlusInput } from "./agentTurnProductPreparationAPlus";
import { runManualCompactionTurn } from "./manualCompactionTurn";

export type AgentRuntimeSelection = "b" | "a-plus-stage3";

export type AgentRuntimeSelectorOptions = Readonly<{
  selection?: AgentRuntimeSelection;
  aPlusDependencies?: AgentTurnRunnerAPlusDependencies;
}>;

export function resolveAgentRuntimeSelection(
  configured = process.env.NEXT_PUBLIC_MORPHO_AGENT_RUNTIME
): AgentRuntimeSelection {
  return configured === "a-plus-stage3" ? "a-plus-stage3" : "b";
}

export function isAPlusAgentRuntimeSelected(
  options: AgentRuntimeSelectorOptions = {}
): boolean {
  return (options.selection ?? resolveAgentRuntimeSelection()) === "a-plus-stage3";
}

export async function runSelectedMorphoAgentTurn(
  input: RunMorphoAgentTurnAPlusInput,
  host: AgentTurnHost,
  options: AgentRuntimeSelectorOptions = {}
): Promise<void> {
  if (isAPlusAgentRuntimeSelected(options)) {
    await runMorphoAgentTurnAPlus(input, host, options.aPlusDependencies);
    return;
  }
  await runMorphoAgentTurn(input, host);
}

export async function runSelectedManualCompactionTurn(
  input: RunMorphoAgentTurnAPlusInput,
  host: AgentTurnHost,
  options: AgentRuntimeSelectorOptions = {}
): Promise<void> {
  if (isAPlusAgentRuntimeSelected(options)) {
    await runManualCompactionTurnAPlus(input, host, options.aPlusDependencies);
    return;
  }
  await runManualCompactionTurn(
    {
      draft: input.draft,
      selectedObjectIds: input.selectedObjectIds,
      agentTurnMode: input.agentTurnMode
    },
    host
  );
}

export async function recoverSelectedAgentRuntime(
  localProjectId: string,
  host: AgentTurnHost,
  options: AgentRuntimeSelectorOptions = {}
): Promise<"none" | "recovered" | "pending" | "failed"> {
  if (!isAPlusAgentRuntimeSelected(options)) return "none";
  return recoverMorphoAgentTurnAPlus(
    localProjectId,
    host,
    options.aPlusDependencies
  );
}

export async function cancelSelectedMorphoAgentTurn(
  localProjectId: string,
  options: AgentRuntimeSelectorOptions = {}
): Promise<boolean> {
  if (!isAPlusAgentRuntimeSelected(options)) return false;
  return cancelMorphoAgentTurnAPlus(localProjectId);
}

export async function acknowledgeSelectedPendingAgentConfirmation(
  localProjectId: string,
  options: AgentRuntimeSelectorOptions = {}
): Promise<boolean> {
  if (!isAPlusAgentRuntimeSelected(options)) return false;
  return acknowledgeMorphoAgentPendingConfirmationAPlus(localProjectId);
}
