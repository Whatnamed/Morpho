import {
  applyConversationSummaryRevision,
  buildConversationCompactionPlan
} from "@/domain/morpho/conversationCompaction";
import {
  buildConversationLaneKey,
  resolveConversationLaneAnchors
} from "@/domain/morpho/conversationCheckpoint";
import { updateAiMessage } from "./aiConversationMessages";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import type { AgentTurnHost } from "./agentTurnHost";
import {
  closeAgentTurnLeaseRequest,
  requestConversationSummary,
  type AgentTurnLeaseOutcome
} from "./agentTurnLeaseClient";
import { appendAgentTurnMessages } from "./agentTurnMessages";
import { getManualCompactionStatusText } from "./manualConversationCompaction";
import { ensureAgentConversationSummaryBaselines } from "./providerContextFrames";
import { buildTaskContext } from "./taskContext";
import type { MorphoAgentTurnMode } from "./morphoAgent";

export type ManualCompactionTurnInput = {
  draft: string;
  selectedObjectIds: string[];
  agentTurnMode: MorphoAgentTurnMode;
};

export async function runManualCompactionTurn(
  input: ManualCompactionTurnInput,
  host: AgentTurnHost
): Promise<void> {
  const workspace = host.readWorkspace();
  const context = buildTaskContext(workspace, {
    kind: "general",
    draft: input.draft,
    selectedObjectIds: input.selectedObjectIds
  });
  const conversationLaneAnchors = resolveConversationLaneAnchors(
    workspace,
    input.selectedObjectIds
  );
  const conversationLaneKey = buildConversationLaneKey({
    currentFocus: workspace.projectContinuity.currentFocus,
    taskKind: context.kind,
    anchorObjectIds: conversationLaneAnchors.anchorObjectIds,
    targetDirectionIds: conversationLaneAnchors.targetDirectionIds,
    visualBranchId: conversationLaneAnchors.visualBranchId
  });
  const compactionPlan = buildConversationCompactionPlan({
    workspace,
    force: "compact"
  });
  const now = new Date(host.now()).toISOString();
  const userMessageId = `ai-user-compact-${host.now()}`;
  const assistantMessageId = `ai-assistant-compact-${host.now()}`;
  const manualCompactionTurnId = `manual-compact-${host.now()}`;
  const controller = new AbortController();

  host.ui.setDraft("");
  host.ui.openConversation();
  host.ui.setStreaming(true);
  host.abortSlot.set(controller);
  host.commitWorkspace((current) => ({
    workspace: appendAgentTurnMessages(current, {
      userMessageId,
      assistantMessageId,
      userBody: input.draft,
      assistantBody: getManualCompactionStatusText("running"),
      createdAt: now,
      contextObjectIds: context.objectIds,
      conversationLaneKey,
      workIntent: "discussion",
      contextVisibility: "uiOnly",
      taskMode: "chatAnalysis",
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      taskStrategy: "discussion",
      agentTurnId: manualCompactionTurnId
    }),
    value: undefined
  }));

  if (!compactionPlan) {
    host.commitWorkspace((current) => ({
      workspace: updateAiMessage(
        current,
        assistantMessageId,
        getManualCompactionStatusText("notNeeded"),
        "done"
      ),
      value: undefined
    }));
    host.abortSlot.set(null);
    host.ui.setStreaming(false);
    return;
  }

  let manualCompactionLeaseId: string | undefined;
  let manualCompactionOutcome: Extract<
    AgentTurnLeaseOutcome,
    "success" | "cancelledBeforeExecution" | "failedBeforeExecution"
  > = "failedBeforeExecution";
  try {
    const summaryRequest = await requestConversationSummary(
      compactionPlan,
      controller.signal,
      {
        projectId: workspace.project.id,
        agentTurnId: manualCompactionTurnId,
        mode: input.agentTurnMode,
        onLeaseStarted: (leaseId) => {
          manualCompactionLeaseId = leaseId;
        }
      },
      host.fetch
    );
    manualCompactionLeaseId = summaryRequest.leaseId ?? manualCompactionLeaseId;
    const parsedSummary = summaryRequest.parsed;
    if (parsedSummary.status !== "ok") {
      throw new Error("模型没有返回可用的连续对话摘要。");
    }
    const summaryApplied = host.commitWorkspace((current) => {
      const result = applyConversationSummaryRevision(current, {
        summary: parsedSummary.summary,
        sourceMessageIds: compactionPlan.sourceMessages.map((message) => message.id),
        expectedPreviousRevisionId: compactionPlan.previousSummaryRevision?.id,
        estimatedInputTokens: compactionPlan.estimatedInputTokens,
        now: new Date(host.now()).toISOString()
      });
      const framed =
        result.status === "applied"
          ? ensureAgentConversationSummaryBaselines(result.workspace, {
              projectId: result.workspace.project.id,
              promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
              summaryRevision: result.revision,
              mode: input.agentTurnMode
            })
          : result.workspace;
      return {
        workspace: updateAiMessage(
          framed,
          assistantMessageId,
          result.status === "applied"
            ? getManualCompactionStatusText("completed")
            : getManualCompactionStatusText("failed"),
          result.status === "applied" ? "done" : "failed"
        ),
        value: result.status === "applied"
      };
    });
    if (!summaryApplied) {
      host.ui.showFailure();
    } else {
      manualCompactionOutcome = "success";
    }
  } catch (error) {
    const isCancelled = error instanceof DOMException && error.name === "AbortError";
    manualCompactionOutcome = isCancelled
      ? "cancelledBeforeExecution"
      : "failedBeforeExecution";
    host.commitWorkspace((current) => ({
      workspace: updateAiMessage(
        current,
        assistantMessageId,
        isCancelled ? "上下文压缩已取消。" : getManualCompactionStatusText("failed"),
        isCancelled ? "done" : "failed"
      ),
      value: undefined
    }));
    if (!isCancelled) {
      host.ui.showFailure();
    }
  } finally {
    await closeAgentTurnLeaseRequest({
      leaseId: manualCompactionLeaseId,
      agentTurnId: manualCompactionTurnId,
      outcome: manualCompactionOutcome,
      fetch: host.fetch
    });
    if (host.abortSlot.get() === controller) {
      host.abortSlot.set(null);
      host.ui.setStreaming(false);
    } else if (host.abortSlot.get() === null) {
      host.ui.setStreaming(false);
    }
  }
}
