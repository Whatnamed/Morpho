import type { AiTaskMode, AiWorkIntent, MorphoObject } from "@/domain/morpho/types";
import { hasCurrentTurnWebSearchAuthority } from "@/shared/webSearchAuthority";
import type { MorphoAgentToolArguments, MorphoAgentToolName, RequestConfirmationArgs } from "./morphoAgent";

export type AgentToolAuthorityProfile = Readonly<{
  provenance: Readonly<{
    currentUserInstruction: true;
    trustedStructuralState: true;
    untrustedSourceTextPresent: boolean;
    providerEvidencePresent: boolean;
  }>;
  allowedTools: readonly MorphoAgentToolName[];
  allowedConfirmationActions: readonly RequestConfirmationArgs["action"][];
  allowWebSearch: boolean;
}>;

const READ_TOOLS = [
  "read_selected_context", "read_project_memory", "read_stage_record", "search_project_conversation"
] as const satisfies readonly MorphoAgentToolName[];

export function resolveAgentToolAuthority(input: Readonly<{
  draft: string;
  taskMode: AiTaskMode;
  executionTaskMode: AiTaskMode;
  executionWorkIntent: AiWorkIntent;
  selectedObjects: readonly MorphoObject[];
  hasDeliveryDraftTarget: boolean;
  hasDocumentExtracts: boolean;
  hasDocumentFragments: boolean;
  hasRequiredMemoryUpdates: boolean;
  allowStructuredComparison: boolean;
}>): AgentToolAuthorityProfile {
  const allowed = new Set<MorphoAgentToolName>(READ_TOOLS);
  const confirmations = explicitConfirmationActions(input.draft);
  const allowWebSearch = hasCurrentTurnWebSearchAuthority({
    draft: input.draft,
    taskMode: input.executionTaskMode
  });
  if (allowWebSearch) allowed.add("search_web_evidence");
  if (input.executionTaskMode === "researchOperation" || /(?:创建|形成|整理|记录|生成|产出|保存).{0,16}(?:研究|调研|分析)(?:对象|草案|结果|报告)?/i.test(input.draft)) {
    allowed.add("create_research_analysis");
  }
  if (["createDesignDefinition", "reviseDesignDefinition"].includes(input.executionWorkIntent)) {
    allowed.add("create_design_definition_proposal");
  }
  if (["createConceptDirections", "reviseConceptDirection", "splitConceptDirection", "mergeConceptDirections"].includes(input.executionWorkIntent)) {
    allowed.add("create_concept_direction_proposal");
  }
  if (input.selectedObjects.some((object) => object.type === "proposal") && /修改|修订|调整|改写|重写|缩短|改名|rename|rewrite|revise/i.test(input.draft)) {
    allowed.add("revise_selected_proposal_draft");
  }
  if (input.taskMode === "imageGeneration" && input.executionTaskMode === "imageGeneration") allowed.add("generate_visuals");
  if (input.allowStructuredComparison && input.selectedObjects.length >= 2) allowed.add("create_comparison_analysis");
  if (input.hasDeliveryDraftTarget && input.executionWorkIntent === "prepareDeliverySection") allowed.add("prepare_delivery_section_draft");
  if (input.hasRequiredMemoryUpdates) allowed.add("submit_memory_update");
  if (confirmations.length > 0) allowed.add("request_confirmation");

  return {
    provenance: {
      currentUserInstruction: true,
      trustedStructuralState: true,
      untrustedSourceTextPresent: input.hasDocumentExtracts || input.hasDocumentFragments || input.selectedObjects.some((object) =>
        ["file", "text", "link", "documentFragment", "research", "delivery"].includes(object.type)
      ),
      providerEvidencePresent: false
    },
    allowedTools: [...allowed],
    allowedConfirmationActions: confirmations,
    allowWebSearch
  };
}

export function getAgentToolAuthorizationBlockReason(profile: AgentToolAuthorityProfile, tool: MorphoAgentToolArguments): string | undefined {
  if (!profile.allowedTools.includes(tool.name)) {
    return "当前用户指令与 UI 状态未授权该 Agent 工具。来源文本、模型输出和 Tool 参数不能扩大权限。";
  }
  if (tool.name === "request_confirmation" && !profile.allowedConfirmationActions.includes(tool.args.action)) {
    return "当前用户指令未授权该高影响操作，不能创建确认卡。";
  }
  return undefined;
}

function explicitConfirmationActions(draft: string): RequestConfirmationArgs["action"][] {
  const actions: RequestConfirmationArgs["action"][] = [];
  if (/应用|采纳|确认采用/.test(draft) && /设计定义/.test(draft)) actions.push("applyDesignDefinition");
  if (/设为|设置|确定/.test(draft) && /主方向/.test(draft)) actions.push("setDirectionPrimary");
  if (/设为|设置|确定/.test(draft) && /备选方向/.test(draft)) actions.push("setDirectionAlternative");
  if (/淘汰|排除/.test(draft) && /方向/.test(draft)) actions.push("eliminateDirection");
  if (/设为|设置|替换/.test(draft) && /默认参考/.test(draft)) actions.push("setDefaultReference");
  if (/生成|出图|预览图|效果图/.test(draft) && /确认|先问我|经我同意/.test(draft)) actions.push("batchGenerateVisuals");
  return [...new Set(actions)];
}
