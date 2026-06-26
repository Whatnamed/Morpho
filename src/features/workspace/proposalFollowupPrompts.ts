import type { ArtifactProposal } from "@/domain/operations/types";

export function buildProposalDiscussionDraft(proposal: ArtifactProposal): string {
  switch (proposal.type) {
    case "researchAnalysis":
      return `继续围绕这份研究与分析草案讨论，重点复核：${proposal.title}。请指出最需要补强的发现、约束和待确认问题。`;
    case "designDefinition":
      return proposal.workIntent === "reviseDesignDefinition"
        ? `继续围绕这份设计定义修订草案讨论，重点复核：${proposal.title}。请指出哪些原则、边界或场景还不够稳，以及哪些变化会真正替换当前定义。`
        : `继续围绕这份首版设计定义草案讨论，重点复核：${proposal.title}。请指出哪些原则、边界或场景还不够稳。`;
    case "conceptDirection":
      return `继续围绕这份概念方向草案讨论，重点复核：${proposal.title}。请指出哪些方向值得保留、拆分或合并。`;
    case "deliveryPlan":
      return `继续围绕这份交付草案讨论，重点复核：${proposal.title}。请指出缺口和需要补充的来源。`;
  }
}

export function buildProposalRegenerationDraft(proposal: ArtifactProposal): string {
  switch (proposal.type) {
    case "researchAnalysis":
      return `请基于当前来源重新生成这份研究与分析草案，并明确哪些发现更稳、哪些仍待验证。当前草案标题：${proposal.title}。`;
    case "designDefinition":
      return proposal.workIntent === "reviseDesignDefinition"
        ? `请基于当前设计定义和当前来源，重新生成一版设计定义修订草案，明确这次会替换哪些原则、边界或场景，不要直接应用。当前草案标题：${proposal.title}。`
        : `请基于当前来源重新生成一版首版设计定义草案，保持目标和边界清楚，不要直接应用。当前草案标题：${proposal.title}。`;
    case "conceptDirection":
      return `请基于当前设计定义和来源重新生成一版概念方向草案，保留方向差异，不要自动设为主方向。当前草案标题：${proposal.title}。`;
    case "deliveryPlan":
      return `请基于当前来源重新生成一版交付草案，明确缺口和引用来源。当前草案标题：${proposal.title}。`;
  }
}
