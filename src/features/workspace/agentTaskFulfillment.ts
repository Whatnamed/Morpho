import type { MorphoWorkspace } from "@/domain/morpho/types";
import type { AgentEffectReceipt, AgentReadReceipt, AgentTaskFulfillment } from "@/shared/agentReadCoverage";
import type { TurnTaskContract } from "@/shared/turnTaskContract";
import { requirementCovered } from "./agentSourceReads";

/** Structural verification only. Provider prose is never evidence of a workspace effect. */
export function evaluateAgentTaskFulfillment(input: {
  contract?: TurnTaskContract; workspace: MorphoWorkspace; reads: readonly AgentReadReceipt[];
  effects: readonly AgentEffectReceipt[]; providerCompleted: boolean;
}): AgentTaskFulfillment {
  const { contract, workspace, reads, effects } = input;
  const obligations: AgentTaskFulfillment["obligations"] = [];
  if (!contract || contract.readContractVersion !== 1) return { version: 1, status: "unknown", obligations, reads: [...reads], effects: [...effects] };
  contract.requiredReads.forEach((requirement, index) => {
    const covered = requirementCovered(requirement, reads, workspace);
    obligations.push({ id: `read:${index}`, status: covered ? "fulfilled" : "blocked", ...(covered ? {} : { reason: "指定来源尚未完整核实。" }) });
  });
  for (const activity of contract.activities) {
    const relevant = effects.filter((receipt) => receipt.activityId === activity.id);
    for (const output of activity.expectedOutputs) {
      const id = `${activity.id}:${output}`;
      if (activity.scopeBlockedReason) { obligations.push({ id, status: "blocked", reason: activity.scopeBlockedReason }); continue; }
      const pending = relevant.some((receipt) => receipt.status === "pendingConfirmation");
      const executed = relevant.filter((receipt) => receipt.status === "executed" && receipt.persistence !== "failed" && !["blocked", "failed", "retryable", "cancelled"].includes(receipt.resultStatus ?? ""));
      let fulfilled = false;
      let partial = false;
      if (output === "newImages") {
        const ids = [...new Set(executed.filter((receipt) => receipt.tool === "generate_visuals").flatMap((receipt) => receipt.objectIds))]
          .filter((objectId) => { const object = workspace.objects[objectId]; return object?.type === "image" && object.assetId && workspace.assets[object.assetId]?.sourceType === "aiGeneratedImage"; });
        const count = activity.expectedVisualCount ?? 1;
        fulfilled = ids.length === count;
        partial = ids.length > 0 && !fulfilled;
      } else if (output === "create_concept_direction_proposal") {
        fulfilled = executed.some((receipt) => {
          if (receipt.tool !== output || !receipt.proposalId) return false;
          const proposal = workspace.artifactProposals[receipt.proposalId];
          if (proposal?.type !== "conceptDirection" || proposal.status !== "applied" || proposal.applicationMode !== (activity.conceptOperation ?? "create")) return false;
          if (proposal.applicationMode === "revise") {
            const target = proposal.targetDirectionId ? workspace.objects[proposal.targetDirectionId] : undefined;
            return target?.type === "conceptDirection" && activity.targetObjectIds.includes(target.id) &&
              receipt.objectIds.includes(target.id) && receipt.revisionIds?.some((revisionId) => {
                const revision = workspace.directionRevisions[revisionId];
                return revision?.directionId === target.id && Boolean(revision.previousRevisionId && activity.targetRevisionIds?.includes(revision.previousRevisionId));
              }) === true;
          }
          if (proposal.applicationMode === "split" || proposal.applicationMode === "merge") return proposal.parentDirectionIds.every((id) => activity.targetObjectIds.includes(id)) &&
            receipt.objectIds.length > 0 && receipt.objectIds.every((id) => proposal.parentDirectionIds.every((parent) => workspace.directionLineage.some((lineage) => lineage.fromDirectionId === parent && lineage.toDirectionId === id && lineage.kind === (proposal.applicationMode === "split" ? "splitFromDirection" : "mergedFromDirection"))));
          return receipt.objectIds.length > 0 && receipt.objectIds.every((id) => workspace.objects[id]?.type === "conceptDirection");
        });
      } else if (output === "prepare_delivery_section_draft") {
        fulfilled = executed.some((receipt) => {
          const draft = receipt.draftId ? workspace.deliverySectionDrafts[receipt.draftId] : undefined;
          return receipt.tool === output && draft && draft.deliveryObjectId === receipt.deliveryObjectId && draft.sectionId === receipt.sectionId &&
            requirementCovered({ tool: "read_workspace_source", kind: "delivery", objectId: draft.deliveryObjectId, sectionId: draft.sectionId }, reads);
        });
      } else if (output === "create_design_definition_proposal") fulfilled = executed.some((receipt) => receipt.tool === output && receipt.proposalId && workspace.artifactProposals[receipt.proposalId]?.type === "designDefinition");
      else if (output === "create_research_analysis") fulfilled = executed.some((receipt) => receipt.tool === output && receipt.objectIds.some((id) => workspace.objects[id]?.type === "research"));
      else if (output === "create_comparison_analysis") fulfilled = executed.some((receipt) => receipt.tool === output && receipt.analysisId && workspace.ai.comparisonAnalyses?.[receipt.analysisId]);
      else if (output.startsWith("chat") || output === "visualProposal") fulfilled = input.providerCompleted;
      else fulfilled = executed.some((receipt) => receipt.tool === output);
      obligations.push({ id, status: fulfilled ? "fulfilled" : pending ? "awaitingUser" : partial ? "partial" : relevant.some((receipt) => receipt.status === "failed") ? "blocked" : "notPerformed",
        ...(fulfilled ? {} : { reason: output === "newImages" ? "实际保存的图像数量未达到要求。" : "所需结果尚未发生或仍待用户确认。" }) });
    }
    if (activity.observeGeneratedImages) {
      const ids = [...new Set(relevant.filter((receipt) => receipt.tool === "generate_visuals").flatMap((receipt) => receipt.objectIds))];
      const covered = ids.filter((objectId) => requirementCovered({ tool: "read_workspace_source", kind: "image", objectId }, reads, workspace));
      obligations.push({ id: `${activity.id}:observeGeneratedImages`, status: ids.length && covered.length === ids.length ? "fulfilled" : covered.length ? "partial" : "notPerformed", reason: "仅核对实际像素观察，不评价设计质量。" });
    }
  }
  const status = obligations.every((item) => item.status === "fulfilled") ? "fulfilled" : obligations.some((item) => item.status === "awaitingUser") ? "awaitingUser" :
    obligations.some((item) => item.status === "fulfilled" || item.status === "partial") ? "partial" : obligations.some((item) => item.status === "blocked") ? "blocked" : "notPerformed";
  return { version: 1, status, obligations, reads: structuredClone([...reads]), effects: structuredClone([...effects]) };
}

export function taskFulfillmentNotice(fulfillment: AgentTaskFulfillment): string {
  if (fulfillment.status === "fulfilled" || fulfillment.status === "unknown") return "";
  const reasons = [...new Set(fulfillment.obligations.filter((item) => item.status !== "fulfilled").map((item) => item.reason).filter(Boolean))];
  return `任务核对：${fulfillment.status === "awaitingUser" ? "等待用户确认" : fulfillment.status === "partial" ? "部分完成" : "尚未完成"}。${reasons.join(" ")}`;
}
