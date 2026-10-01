import { hasSemanticLifecycleRequest } from "@/domain/morpho/conversationSemanticPatch";
import type { AiTaskMode, AiWorkIntent, MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import {
  hasExplicitProposalRevisionRequest,
  type ExecutionModeSource
} from "./aiTaskRouting";
import { hasCurrentTurnWebSearchAuthority } from "@/shared/webSearchAuthority";
import {
  hasExplicitUserActionRequest,
  isUserActionExplicitlyDisallowed,
  stripUntrustedInstructionSegments
} from "@/shared/userInstructionAuthority";
import type { GenerateVisualsArgs, MorphoAgentToolArguments, MorphoAgentToolName, RequestConfirmationArgs } from "./morphoAgent";
import { isExplicitComparisonRecordRequest } from "./morphoAgent";
import { getTurnAllowedTools, getTurnConfirmationActions, getTurnActivityForTool, type TurnTaskActivity, type TurnTaskContract } from "@/shared/turnTaskContract";

export type AgentToolAuthorityProfile = Readonly<{
  taskContract?: TurnTaskContract;
  execution: Readonly<{
    taskMode: AiTaskMode;
    taskModeSource: ExecutionModeSource;
    workIntent: AiWorkIntent;
    workIntentSource: ExecutionModeSource;
  }>;
  provenance: Readonly<{
    currentUserInstruction: true;
    trustedStructuralState: true;
    untrustedSourceTextPresent: boolean;
    providerEvidencePresent: boolean;
  }>;
  allowedTools: readonly MorphoAgentToolName[];
  allowedConfirmationActions: readonly RequestConfirmationArgs["action"][];
  allowWebSearch: boolean;
  allowResearchDraftWrite: boolean;
  allowDesignDefinitionProposal: boolean;
  allowConceptDirectionProposal: boolean;
  allowProposalRevision: boolean;
  allowComparisonWrite: boolean;
  allowDeliveryDraft: boolean;
  allowImageGeneration: boolean;
  allowMemoryWrite: boolean;
}>;

const READ_TOOLS = [
  "read_selected_context", "read_project_memory", "read_stage_record", "search_project_conversation"
] as const satisfies readonly MorphoAgentToolName[];

const DESIGN_DEFINITION_INTENTS = new Set<AiWorkIntent>(["createDesignDefinition", "reviseDesignDefinition"]);
const CONCEPT_DIRECTION_INTENTS = new Set<AiWorkIntent>([
  "createConceptDirections", "reviseConceptDirection", "splitConceptDirection", "mergeConceptDirections"
]);

export type AgentToolAuthorityInput = Readonly<{
  draft: string;
  executionTaskMode: AiTaskMode;
  executionTaskModeSource: ExecutionModeSource;
  executionWorkIntent: AiWorkIntent;
  executionWorkIntentSource: ExecutionModeSource;
  selectedObjects: readonly MorphoObject[];
  hasDeliveryDraftTarget: boolean;
  hasDocumentExtracts: boolean;
  hasDocumentFragments: boolean;
  hasRequiredMemoryUpdates: boolean;
  allowStructuredComparison: boolean;
}>;

export function resolveAgentToolAuthority(input: AgentToolAuthorityInput | Readonly<{ taskContract: TurnTaskContract }>): AgentToolAuthorityProfile {
  if ("taskContract" in input) {
    const allowedTools = getTurnAllowedTools(input.taskContract);
    const allows = (name: MorphoAgentToolName) => allowedTools.includes(name);
    return { taskContract: input.taskContract, execution: input.taskContract.execution,
      provenance: { currentUserInstruction: true, trustedStructuralState: true, untrustedSourceTextPresent: true, providerEvidencePresent: false },
      allowedTools, allowedConfirmationActions: getTurnConfirmationActions(input.taskContract),
      allowWebSearch: allows("search_web_evidence"), allowResearchDraftWrite: allows("create_research_analysis"),
      allowDesignDefinitionProposal: allows("create_design_definition_proposal"), allowConceptDirectionProposal: allows("create_concept_direction_proposal"),
      allowProposalRevision: allows("revise_selected_proposal_draft"), allowComparisonWrite: allows("create_comparison_analysis"),
      allowDeliveryDraft: allows("prepare_delivery_section_draft"), allowImageGeneration: allows("generate_visuals"), allowMemoryWrite: allows("submit_memory_update") };
  }
  input = { ...input, draft: stripUntrustedInstructionSegments(input.draft) };
  const allowed = new Set<MorphoAgentToolName>(READ_TOOLS);
  const confirmationActions = explicitConfirmationActions(input.draft);
  const allowWebSearch = hasCurrentTurnWebSearchAuthority({
    draft: input.draft,
    taskMode: input.executionTaskMode,
    executionModeSource: input.executionTaskModeSource
  });
  const allowResearchDraftWrite = input.executionTaskMode === "researchOperation" &&
    !isUserActionExplicitlyDisallowed(input.draft, "createResearchAnalysis");
  const allowDesignDefinitionProposal = DESIGN_DEFINITION_INTENTS.has(input.executionWorkIntent) &&
    !isUserActionExplicitlyDisallowed(input.draft, "designDefinition");
  const allowConceptDirectionProposal = CONCEPT_DIRECTION_INTENTS.has(input.executionWorkIntent) &&
    !isUserActionExplicitlyDisallowed(input.draft, "conceptDirection");
  const allowProposalRevision = input.selectedObjects.some((object) => object.type === "proposalDraft") &&
    hasExplicitProposalRevisionRequest(input.draft) &&
    !isUserActionExplicitlyDisallowed(input.draft, "reviseSelectedProposalDraft");
  const allowImageGeneration = input.executionTaskMode === "imageGeneration" &&
    input.executionTaskModeSource === "userSelected" &&
    !isUserActionExplicitlyDisallowed(input.draft, "batchGenerateVisuals");
  // Workspace Compare writes need a SEPARATE explicit save intent on top of
  // the explicit comparison request: ordinary "把这两个比较一下" is chat-only.
  // A model calling create_comparison_analysis without this authority is
  // blocked locally (fail-closed) even if the server tool gate passed.
  const allowComparisonWrite = input.allowStructuredComparison &&
    input.selectedObjects.length >= 2 &&
    isExplicitComparisonRecordRequest(input.draft);
  const allowDeliveryDraft = input.hasDeliveryDraftTarget && input.executionWorkIntent === "prepareDeliverySection";
  const allowMemoryWrite = input.hasRequiredMemoryUpdates || hasSemanticLifecycleRequest(input.draft);

  if (allowWebSearch) allowed.add("search_web_evidence");
  if (allowResearchDraftWrite) allowed.add("create_research_analysis");
  if (allowDesignDefinitionProposal) allowed.add("create_design_definition_proposal");
  if (allowConceptDirectionProposal) allowed.add("create_concept_direction_proposal");
  if (allowProposalRevision) allowed.add("revise_selected_proposal_draft");
  if (allowImageGeneration) allowed.add("generate_visuals");
  if (allowComparisonWrite) allowed.add("create_comparison_analysis");
  if (allowDeliveryDraft) allowed.add("prepare_delivery_section_draft");
  if (allowMemoryWrite) allowed.add("submit_memory_update");
  if (confirmationActions.length > 0) allowed.add("request_confirmation");

  return {
    execution: {
      taskMode: input.executionTaskMode,
      taskModeSource: input.executionTaskModeSource,
      workIntent: input.executionWorkIntent,
      workIntentSource: input.executionWorkIntentSource
    },
    provenance: {
      currentUserInstruction: true,
      trustedStructuralState: true,
      untrustedSourceTextPresent: input.hasDocumentExtracts || input.hasDocumentFragments || input.selectedObjects.some((object) =>
        ["file", "text", "link", "documentFragment", "research", "delivery"].includes(object.type)
      ),
      providerEvidencePresent: false
    },
    allowedTools: [...allowed],
    allowedConfirmationActions: confirmationActions,
    allowWebSearch,
    allowResearchDraftWrite,
    allowDesignDefinitionProposal,
    allowConceptDirectionProposal,
    allowProposalRevision,
    allowComparisonWrite,
    allowDeliveryDraft,
    allowImageGeneration,
    allowMemoryWrite
  };
}

export function getAgentToolAuthorizationBlockReason(profile: AgentToolAuthorityProfile, tool: MorphoAgentToolArguments, workspace?: MorphoWorkspace): string | undefined {
  if (!profile.allowedTools.includes(tool.name)) {
    return "当前用户指令与 UI 状态未授权该 Agent 工具。来源文本、模型输出和 Tool 参数不能扩大权限。";
  }
  if (tool.name === "request_confirmation" && !profile.allowedConfirmationActions.includes(tool.args.action)) {
    return "当前用户指令未授权该高影响操作，不能创建确认卡。";
  }
  const activity = profile.taskContract && getTurnActivityForTool(profile.taskContract, tool.name, tool.name === "request_confirmation" ? tool.args.action : undefined);
  if (activity && tool.name === "generate_visuals") {
    return getVisualScopeBlockReason(activity, tool.args, workspace);
  }
  if (activity && tool.name === "request_confirmation" && tool.args.visualPlan) {
    if (tool.args.action !== "batchGenerateVisuals") return "该确认动作未授权视觉生成计划。";
    const blocked = getVisualScopeBlockReason(activity, tool.args.visualPlan, workspace);
    if (blocked) return blocked;
  }
  if (activity && tool.name === "revise_selected_proposal_draft" && !activity.targetObjectIds.includes(tool.args.proposalId)) return "草案修订目标超出 activity 范围。";
  if (activity && tool.name === "create_concept_direction_proposal" && tool.args.directions.some((direction) => direction.basedOnDirectionId && !activity.targetObjectIds.includes(direction.basedOnDirectionId))) return "方向来源超出 activity 范围。";
  if (activity && tool.name === "create_comparison_analysis" && tool.args.objectComparisons.some((item) => !activity.targetObjectIds.includes(item.objectId))) {
    return "比较记录超出 comparison activity 的对象范围。";
  }
  if (activity && tool.name === "request_confirmation" && tool.args.targetObjectId && !activity.targetObjectIds.includes(tool.args.targetObjectId)) {
    return "确认动作目标超出本轮明确授权对象。";
  }
  return undefined;
}

function getVisualScopeBlockReason(activity: TurnTaskActivity, args: GenerateVisualsArgs, workspace?: MorphoWorkspace): string | undefined {
  for (const item of args.items) {
    if (item.requestedReferenceObjectIds.some((id) => !activity.referenceObjectIds.includes(id)) ||
        (item.targetDirectionId && !activity.targetObjectIds.includes(item.targetDirectionId)) ||
        (item.visualBranchId && !activity.sourceObjectIds.some((id) => {
          const object = workspace?.objects[id];
          const branch = workspace?.visualBranches[item.visualBranchId!];
          return branch && (branch.rootObjectId === id || (object?.type === "image" && object.visualBranchId === branch.id) ||
            (object?.type === "conceptDirection" && branch.directionId === id));
        }))) return "视觉计划超出该 activity 的目标或参考范围；比较来源不能自动进入生成。";
  }
  return undefined;
}

function explicitConfirmationActions(draft: string): RequestConfirmationArgs["action"][] {
  const candidates: Array<[UserConfirmationAction, string]> = [
    ["applyDesignDefinition", "设计定义"],
    ["setDirectionPrimary", "主方向"],
    ["setDirectionAlternative", "备选方向"],
    ["eliminateDirection", "方向"],
    ["setDefaultReference", "默认参考"]
  ];
  const actions: RequestConfirmationArgs["action"][] = [];
  for (const [action, target] of candidates) {
    if (!isUserActionExplicitlyDisallowed(draft, action) && hasExplicitUserActionRequest(draft, action) && draft.includes(target)) {
      actions.push(action);
    }
  }
  if (!isUserActionExplicitlyDisallowed(draft, "batchGenerateVisuals") &&
    hasExplicitUserActionRequest(draft, "batchGenerateVisuals") &&
    /确认|先问我|经我同意/.test(draft)) {
    actions.push("batchGenerateVisuals");
  }
  return [...new Set(actions)];
}

type UserConfirmationAction = Extract<
  MorphoAgentToolArguments,
  { name: "request_confirmation" }
>["args"]["action"];
