import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  eliminateDirection,
  setConceptDirectionStatus
} from "@/domain/morpho/workspace";
import { applyDesignDefinitionProposal } from "@/domain/operations/operations";
import { setDefaultReference } from "@/domain/morpho/workspace";
import type { PendingAiConfirmation } from "./workspaceConfirmation";

export type AgentRequestedActionConfirmation = Extract<PendingAiConfirmation, { kind: "agentRequestedAction" }>;

export type AgentRequestedActionExecutionResult =
  | { status: "applied"; workspace: MorphoWorkspace }
  | { status: "blocked"; workspace: MorphoWorkspace; reason: string };

export function applyRequestedAgentAction(
  workspace: MorphoWorkspace,
  confirmation: AgentRequestedActionConfirmation,
  options: { executeVisuals?: string }
): AgentRequestedActionExecutionResult {
  switch (confirmation.action) {
    case "applyDesignDefinition": {
      if (!confirmation.targetObjectId) {
        return blocked(workspace, "缺少要应用的设计定义 proposal。");
      }
      const result = applyDesignDefinitionProposal(workspace, confirmation.targetObjectId, {});
      return result.status === "updated"
        ? applied(result.workspace)
        : blocked(result.workspace, result.reason);
    }
    case "setDirectionPrimary":
      return confirmation.targetObjectId
        ? applied(setConceptDirectionStatus(workspace, confirmation.targetObjectId, "primary", confirmation.reason))
        : blocked(workspace, "缺少要设为主方向的对象。");
    case "setDirectionAlternative":
      return confirmation.targetObjectId
        ? applied(setConceptDirectionStatus(workspace, confirmation.targetObjectId, "alternative", confirmation.reason))
        : blocked(workspace, "缺少要设为备选方向的对象。");
    case "eliminateDirection":
      return confirmation.targetObjectId
        ? applied(eliminateDirection(workspace, confirmation.targetObjectId, { reason: confirmation.reason }))
        : blocked(workspace, "缺少要淘汰的方向对象。");
    case "setDefaultReference":
      return confirmation.targetObjectId
        ? applied(setDefaultReference(workspace, confirmation.targetObjectId, { reason: confirmation.reason }))
        : blocked(workspace, "缺少要设为默认参考的图像对象。");
    case "batchGenerateVisuals":
      return options.executeVisuals
        ? blocked(workspace, options.executeVisuals)
        : applied(workspace);
  }
}

function applied(workspace: MorphoWorkspace): AgentRequestedActionExecutionResult {
  return { status: "applied", workspace };
}

function blocked(workspace: MorphoWorkspace, reason: string): AgentRequestedActionExecutionResult {
  return { status: "blocked", workspace, reason };
}

export function appendAiAssistantFailureMessage(
  workspace: MorphoWorkspace,
  prefix: string,
  body: string,
  proposalId?: string
): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: [
        ...workspace.ai.messages,
        {
          id: `${prefix}-${Date.now()}`,
          role: "assistant",
          body,
          status: "failed",
          createdAt: new Date().toISOString(),
          proposalId
        }
      ]
    }
  };
}

export function appendAiAssistantNotice(
  workspace: MorphoWorkspace,
  prefix: string,
  body: string,
  proposalId?: string
): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: [
        ...workspace.ai.messages,
        {
          id: `${prefix}-${Date.now()}`,
          role: "assistant",
          body,
          status: "done",
          createdAt: new Date().toISOString(),
          proposalId
        }
      ]
    }
  };
}
