import { createCurrentCaseStudyWorkspace } from "@/domain/morpho/workspace";
import { buildConversationCompactionPlan } from "@/domain/morpho/conversationCompaction";
import { createHash } from "node:crypto";

/** Product calls are observed here; the expected base identity is the raw, unchanged fixture pointer. */
export function diagnoseP7Compaction() {
  const workspace = createCurrentCaseStudyWorkspace();
  const before = JSON.stringify(workspace);
  const current = workspace.ai.conversationCompaction.summaryRevisionId;
  const plan = buildConversationCompactionPlan({ workspace, force: "compact" });
  if (!plan) throw new Error("No compaction plan for current case");
  const after = JSON.stringify(workspace);
  return {
    fixture: "production current case, normalized by current domain constructor; no user mutation",
    currentSummaryRevisionId: current,
    currentRevisionExists: Boolean(current && workspace.ai.conversationSummaryRevisions[current]),
    plannedPreviousSummaryRevisionId: plan.previousSummaryRevision?.id ?? null,
    expectedCurrentSummaryRevisionId: plan.expectedCurrentSummaryRevisionId ?? null,
    immutableWorkspace: before === after,
    workspaceSha256: createHash("sha256").update(before).digest("hex"),
    plannedSourceMessageCount: plan.sourceMessages.length,
    plannedSourceStart: plan.sourceStartMessageId, plannedSourceEnd: plan.sourceEndMessageId,
    expected: "Compaction execution captures the unchanged current Summary base identity, separately from Summary content eligibility",
    boundaryWouldMatch: (current ?? undefined) === (plan.expectedCurrentSummaryRevisionId ?? undefined),
    historicalBrowserFault: "summary_revision_conflict: Compaction 的 Summary base revision 已在 External Action 执行期间变化。",
    locations: ["src/features/workspace/agentCompactionOrchestrator.ts", "src/domain/morpho/conversationCompaction.ts"],
    paidProviderCalls: 0
  };
}
