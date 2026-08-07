import type { MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import type { VisualGenerationPlan } from "@/domain/operations/types";
import type { ProviderCitation } from "@/server/ai/types";
import type { PendingAiConfirmation } from "./workspaceConfirmation";
import type {
  MorphoAgentToolArguments,
  RequestConfirmationArgs
} from "./morphoAgent";

export function buildPendingAgentActionConfirmation(input: {
  parsed: MorphoAgentToolArguments;
  workspace: MorphoWorkspace;
  compiledVisualPlan?: VisualGenerationPlan;
  draft: string;
  contextObjectIds: string[];
  citations: ProviderCitation[];
  selectedObjects: MorphoObject[];
  selectedObjectIds: string[];
  userMessageId: string;
  assistantMessageId: string;
  imageAttachmentObjectIds: string[];
  documentExtractObjectIds: string[];
  documentFragmentExtractObjectIds: string[];
}): PendingAiConfirmation {
  switch (input.parsed.name) {
    case "create_research_analysis":
      return {
        kind: "agentCreateResearchAnalysis",
        targetTitle: input.parsed.args.title,
        reason: "先确认模式要求创建研究卡前由用户明确确认。",
        impact: "确认后会创建研究分析卡、来源关系和引用快照。",
        draft: input.draft,
        args: input.parsed.args,
        sourceObjectIds: [...input.contextObjectIds],
        citations: [...input.citations]
      };
    case "create_design_definition_proposal":
      return {
        kind: "agentCreateDesignDefinitionProposal",
        targetTitle: input.parsed.args.title,
        reason: "先确认模式要求创建设计定义草稿前由用户明确确认。",
        impact: "确认后会创建画布上的设计定义 proposal，不会直接应用为当前设计定义。",
        draft: input.draft,
        args: input.parsed.args,
        sourceObjectIds: [...input.contextObjectIds],
        citations: [...input.citations],
        ...getDesignDefinitionBase(input.workspace)
      };
    case "create_concept_direction_proposal":
      return {
        kind: "agentCreateConceptDirectionProposal",
        targetTitle: input.parsed.args.title,
        reason: "先确认模式要求创建概念方向草稿前由用户明确确认。",
        impact: "确认后会创建画布上的概念方向 proposal，不会自动设为主方向。",
        draft: input.draft,
        args: input.parsed.args,
        sourceObjectIds: [...input.contextObjectIds],
        citations: [...input.citations],
        ...getDesignDefinitionBase(input.workspace)
      };
    case "create_comparison_analysis":
      return {
        kind: "agentCreateComparisonAnalysis",
        targetTitle: input.parsed.args.comparisonGoal,
        reason: "先确认模式要求写入 Compare 分析前由用户明确确认。",
        impact: "确认后会写入 Compare analysis；不会自动改变主方向、备选、淘汰或默认参考。",
        args: input.parsed.args,
        selectedObjectIds: [...input.selectedObjectIds],
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        imageAttachmentObjectIds: [...input.imageAttachmentObjectIds],
        documentExtractObjectIds: [...input.documentExtractObjectIds],
        documentFragmentExtractObjectIds: [...input.documentFragmentExtractObjectIds]
      };
    case "generate_visuals":
      if (!input.compiledVisualPlan) {
        throw new Error("图像确认缺少已编译的完整计划。");
      }
      return {
        kind: "agentGenerateVisuals",
        targetTitle: input.selectedObjects[0]?.title ?? "当前选择",
        reason: "先确认模式要求生成图像前由用户明确确认。",
        impact: "确认后会创建新的图像对象，不会覆盖来源图像。",
        draft: input.draft,
        plan: input.compiledVisualPlan,
        sourceObjectIds: [...input.contextObjectIds],
        selectedDirectionIds: input.selectedObjects
          .filter((object) => object.type === "conceptDirection")
          .map((object) => object.id),
        selectedImageIds: input.selectedObjects
          .filter((object) => object.type === "image")
          .map((object) => object.id)
      };
    case "read_selected_context":
    case "read_project_memory":
    case "read_stage_record":
    case "search_project_conversation":
    case "revise_selected_proposal_draft":
    case "search_web_evidence":
    case "prepare_delivery_section_draft":
    case "submit_memory_update":
    case "request_confirmation":
      throw new Error("Only mutating agent tools can be converted into a pending action.");
  }
}

export function buildRequestedAgentActionConfirmation(input: {
  args: RequestConfirmationArgs;
  compiledVisualPlan?: VisualGenerationPlan;
  workspace: MorphoWorkspace;
  draft: string;
  contextObjectIds: string[];
  selectedObjects: MorphoObject[];
}): PendingAiConfirmation {
  const target = input.args.targetObjectId
    ? input.workspace.objects[input.args.targetObjectId]
    : undefined;
  const proposal = input.args.targetObjectId
    ? input.workspace.artifactProposals[input.args.targetObjectId]
    : undefined;

  return {
    kind: "agentRequestedAction",
    targetTitle: target?.title ?? proposal?.title ?? "当前项目状态",
    reason: input.args.reason,
    impact: input.args.impact,
    action: input.args.action,
    targetObjectId: input.args.targetObjectId,
    visualPlan: input.compiledVisualPlan,
    draft: input.draft,
    sourceObjectIds: [...input.contextObjectIds],
    selectedDirectionIds: input.selectedObjects
      .filter((object) => object.type === "conceptDirection")
      .map((object) => object.id),
    selectedImageIds: input.selectedObjects
      .filter((object) => object.type === "image")
      .map((object) => object.id)
  };
}

function getDesignDefinitionBase(workspace: MorphoWorkspace): {
  basedOnDesignDefinitionId?: string;
  basedOnRevisionId?: string;
} {
  const baseId = workspace.workingState.currentDesignDefinitionId;
  const base = baseId ? workspace.objects[baseId] : undefined;
  return base?.type === "designDefinition"
    ? {
        basedOnDesignDefinitionId: base.id,
        basedOnRevisionId: base.currentRevisionId
      }
    : {};
}
