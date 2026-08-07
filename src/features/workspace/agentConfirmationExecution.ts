import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  eliminateDirection,
  setConceptDirectionStatus
} from "@/domain/morpho/workspace";
import { applyDesignDefinitionProposal } from "@/domain/operations/operations";
import { setDefaultReference } from "@/domain/morpho/workspace";
import type { PendingAiConfirmation } from "./workspaceConfirmation";

export type AgentRequestedActionConfirmation = Extract<PendingAiConfirmation, { kind: "agentRequestedAction" }>;

export function applyRequestedAgentAction(
  workspace: MorphoWorkspace,
  confirmation: AgentRequestedActionConfirmation,
  options: { executeVisuals?: string }
): MorphoWorkspace {
  switch (confirmation.action) {
    case "applyDesignDefinition": {
      if (!confirmation.targetObjectId) {
        return appendAiAssistantFailureMessage(workspace, "agent-request-apply-definition", "缺少要应用的设计定义 proposal。");
      }
      const result = applyDesignDefinitionProposal(workspace, confirmation.targetObjectId, {});
      return result.status === "updated"
        ? result.workspace
        : appendAiAssistantFailureMessage(workspace, "agent-request-apply-definition", result.reason);
    }
    case "setDirectionPrimary":
      return confirmation.targetObjectId
        ? setConceptDirectionStatus(workspace, confirmation.targetObjectId, "primary", confirmation.reason)
        : appendAiAssistantFailureMessage(workspace, "agent-request-primary", "缺少要设为主方向的对象。");
    case "setDirectionAlternative":
      return confirmation.targetObjectId
        ? setConceptDirectionStatus(workspace, confirmation.targetObjectId, "alternative", confirmation.reason)
        : appendAiAssistantFailureMessage(workspace, "agent-request-alternative", "缺少要设为备选方向的对象。");
    case "eliminateDirection":
      return confirmation.targetObjectId
        ? eliminateDirection(workspace, confirmation.targetObjectId, { reason: confirmation.reason })
        : appendAiAssistantFailureMessage(workspace, "agent-request-eliminate", "缺少要淘汰的方向对象。");
    case "setDefaultReference":
      return confirmation.targetObjectId
        ? setDefaultReference(workspace, confirmation.targetObjectId, { reason: confirmation.reason })
        : appendAiAssistantFailureMessage(workspace, "agent-request-default-reference", "缺少要设为默认参考的图像对象。");
    case "batchGenerateVisuals":
      return options.executeVisuals
        ? appendAiAssistantFailureMessage(workspace, "agent-request-batch-generate", options.executeVisuals)
        : workspace;
  }
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
