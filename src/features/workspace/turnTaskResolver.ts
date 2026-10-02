import type { MorphoObject, MorphoWorkspace } from "@/domain/morpho/types";
import { stripUntrustedInstructionSegments } from "@/shared/userInstructionAuthority";
import type { MorphoAgentToolName } from "@/shared/agentToolContract";
import type { TurnEffectGrant, TurnTaskActivity, TurnTaskActivityKind, TurnTaskContract } from "@/shared/turnTaskContract";
import { resolveAgentTaskStrategy, resolveRequiredAgentReadRequirements } from "./agentTaskStrategy";
import { resolveAgentToolAuthority, type AgentToolAuthorityInput } from "./agentToolAuthority";
import { isExplicitComparisonRequest } from "./morphoAgent";
import { recommendAiWorkIntent, recommendAiTaskMode } from "./aiTaskRouting";
import { hasExplicitUserActionRequest, isUserActionExplicitlyDisallowed } from "@/shared/userInstructionAuthority";
import { resolveExpectedVisualGenerationCount } from "./agentVisualGenerationBatch";

type Input = AgentToolAuthorityInput & { workspace: MorphoWorkspace; directionPreviewCount?: number };
const grantKinds: Partial<Record<MorphoAgentToolName, TurnTaskActivityKind>> = {
  search_web_evidence: "research", create_research_analysis: "research",
  create_design_definition_proposal: "designDefinition", create_concept_direction_proposal: "conceptDirection",
  revise_selected_proposal_draft: "conceptDirection", create_comparison_analysis: "comparison",
  prepare_delivery_section_draft: "deliveryPreparation", submit_memory_update: "historyAndMemory", request_confirmation: "discussion"
};

/** Deterministic authority owner. Recommendations/Methods/models never mint grants.
 * Classification is a bounded aid to interpretation, not a full language planner.
 */
export function resolveTurnTaskContract(input: Input): TurnTaskContract {
  const text = stripUntrustedInstructionSegments(input.draft).trim();
  const selected = input.selectedObjects.filter((object) => object.visibility === "active");
  const selectedIds = selected.map((object) => object.id);
  const baseAuthority = resolveAgentToolAuthority({ ...input, selectedObjects: selected });
  const allowedTools = new Set(baseAuthority.allowedTools);
  const focus = resolveAgentTaskStrategy({ draft: text, taskMode: input.executionTaskMode,
    workIntent: input.executionWorkIntent, selectedObjects: selected, workspace: input.workspace,
    hasDeliveryDraftTarget: input.hasDeliveryDraftTarget });
  const kinds = new Map<TurnTaskActivityKind, string[]>();
  const add = (kind: TurnTaskActivityKind, instruction: string) => {
    const instructions = kinds.get(kind) ?? [];
    if (!instructions.includes(instruction)) instructions.push(instruction);
    kinds.set(kind, instructions);
  };
  const clauses = text.split(/[，,。；;！？!?\n]+/).map((clause) => clause.trim()).filter(Boolean);
  const visualClauses: string[] = [];
  for (const clause of clauses) {
    // A non-paid explicit activity may coexist with a different UI primary mode.
    // Never infer Paid Image authority here; that remains the send-time UI grant.
    const workIntent = recommendAiWorkIntent({ draft: clause, selectedObjects: selected,
      hasCurrentDesignDefinition: Boolean(input.workspace.workingState.currentDesignDefinitionId) });
    const taskMode = hasExplicitUserActionRequest(clause, "createResearchAnalysis") ? "researchOperation" :
      recommendAiTaskMode(clause, selected.map((object) => object.type));
    const clauseAuthority = resolveAgentToolAuthority({ ...input, draft: clause,
      executionTaskMode: taskMode === "imageGeneration" ? "chatAnalysis" : taskMode,
      executionTaskModeSource: "autoRecommended", executionWorkIntent: workIntent, executionWorkIntentSource: "autoRecommended" });
    for (const tool of clauseAuthority.allowedTools) {
      if (tool === "request_confirmation" || tool === "generate_visuals" || tool === "submit_memory_update") continue;
      if (tool === "create_research_analysis" && !hasExplicitUserActionRequest(clause, "createResearchAnalysis")) continue;
      const action = tool === "create_research_analysis" ? "createResearchAnalysis" :
        tool === "create_design_definition_proposal" ? "designDefinition" :
        tool === "create_concept_direction_proposal" ? "conceptDirection" :
        tool === "revise_selected_proposal_draft" ? "reviseSelectedProposalDraft" : undefined;
      if (!action || !isUserActionExplicitlyDisallowed(text, action)) allowedTools.add(tool);
    }
    const explicitResearch = hasExplicitUserActionRequest(clause, "createResearchAnalysis") || hasExplicitUserActionRequest(clause, "webSearch") || /资料|PDF|材料|文档|竞品|案例|来源|查证|调研/i.test(clause);
    const result = resolveAgentTaskStrategy({ draft: clause, taskMode: input.executionTaskMode === "imageGeneration" && !explicitResearch && /生成|出图|继续|CMF|场景|预览|材质/i.test(clause) ? "imageGeneration" : "chatAnalysis", workIntent: "discussion",
      selectedObjects: selected, workspace: input.workspace });
    const critique = /批评|评价|缺点|不足|弱点|有什么问题|问题在哪/.test(clause) && !/不要|别|无需/.test(clause);
    if (critique) {
      add("critique", clause);
      if (input.executionTaskMode === "imageGeneration" && /生成|出图/.test(clause) && /后再|然后|再(?=比较|评价|批评|分析|判断)/.test(clause)) visualClauses.push(clause.split(/后再|然后|再(?=比较|评价|批评|分析|判断)/)[0]!);
    }
    else if (result.kind !== "discussion") add(result.kind, clause);
    if (!critique && (result.kind === "visualDevelopment" || result.kind === "directionPreview" ||
      (result.kind === "discussion" && /生成|出图|继续|CMF|场景|预览|材质/i.test(clause)))) visualClauses.push(clause);
  }
  if (isExplicitComparisonRequest(text)) add("comparison", clauses.filter(isExplicitComparisonRequest).join("；"));
  if (focus.kind !== "discussion" && !kinds.has(focus.kind)) add(focus.kind, text);
  const visualKind = selected.some((object) => object.type === "image") ? "visualDevelopment" :
    selected.some((object) => object.type === "conceptDirection") ? "directionPreview" : "visualDevelopment";
  // Scope qualifiers without an activity verb belong to their sentence's activity.
  // A comparison/critique/research clause must never become a visual qualifier.
  for (const sentence of text.split(/[。；;！？!?\n]+/)) {
    const parts = sentence.split(/[，,]+/).map((part) => part.trim()).filter(Boolean);
    if (!parts.some((part) => visualClauses.includes(part))) continue;
    for (const part of parts) {
      const kind = resolveAgentTaskStrategy({ draft: part, taskMode: "chatAnalysis", workIntent: "discussion", selectedObjects: selected, workspace: input.workspace }).kind;
      if (kind === "discussion" && /不用|不使用|不要|排除|默认参考|仅|只|参考|借用|环境|构图|风格|结构/.test(part) && !/批评|评价/.test(part) && !visualClauses.includes(part)) visualClauses.push(part);
    }
  }
  if (input.executionTaskMode === "imageGeneration") {
    // Replace the classifier's UI-mode fallback with the owned clauses.
    const simpleVisual = [...kinds.keys()].every((kind) => kind === visualKind);
    kinds.delete(visualKind);
    add(visualKind, visualClauses.join("；") || (simpleVisual ? text : "视觉生成（当前 UI 模式）"));
  }
  for (const tool of allowedTools) {
    if (tool === "request_confirmation") {
      if (baseAuthority.allowedConfirmationActions.includes("batchGenerateVisuals") && !kinds.has(visualKind)) add(visualKind, visualClauses.join("；") || "视觉生成确认");
      if (baseAuthority.allowedConfirmationActions.some((action) => action !== "batchGenerateVisuals")) add("discussion", text);
      continue;
    }
    const kind = tool === "generate_visuals" ? visualKind : grantKinds[tool];
    if (kind && !kinds.has(kind)) add(kind, text);
  }
  if (kinds.size === 0) add("discussion", text);

  const activities: TurnTaskActivity[] = [...kinds].map(([kind, instructions], index) => {
    const instruction = instructions.join("；");
    const visual = kind === "visualDevelopment" || kind === "directionPreview";
    const narrow = visual ? resolveVisualScope(instruction, selected) : undefined;
    const mentioned = visual ? [] : selected.filter((object) => mentionsObject(instruction, object)).map((object) => object.id);
    const explicitExclusions = visual ? selected.filter((object) => instruction.split(/[，,；;]/).some((clause) => /(?:不要|别).{0,8}(?:用|参考|沿用|继续|基于)|不用|不使用|排除/.test(clause) && mentionsObject(clause, object))).map((object) => object.id) : [];
    const sourceObjectIds = (narrow?.ids ?? (mentioned.length ? mentioned : selectedIds)).filter((id) => !explicitExclusions.includes(id));
    // Task-local auxiliary mentions authorize references, not targets or identity.
    // A comparison source cannot enter generation merely because it was selected.
    const explicitAuxiliaryIds = visual ? selected.filter((object) => object.type === "image" && !explicitExclusions.includes(object.id) &&
      instruction.split(/[，,。；;！？!?\n]+/).some((clause) => /参考|借用|材质|CMF|环境|构图|风格|结构/i.test(clause) && mentionsObject(clause, object) &&
        !/(?:不要|不用|不使用|排除)/.test(clause))).map((object) => object.id) : [];
    const excludedObjectIds = selectedIds.filter((id) => !sourceObjectIds.includes(id) && !explicitAuxiliaryIds.includes(id));
    const includeDefaultReference = kind !== "comparison" && (visual ? !narrow : /默认参考|保持.*一致|延续.*默认|reference/i.test(instruction)) &&
      !/(?:不要|不使用|不用|排除).{0,8}默认参考/.test(instruction);
    const referenceObjectIds = visual ? [...new Set([...resolveReferenceScope(input.workspace, sourceObjectIds, includeDefaultReference, Boolean(narrow)), ...explicitAuxiliaryIds])].filter((id) => !excludedObjectIds.includes(id)) : [];
    const effectGrants: TurnEffectGrant[] = [...allowedTools].flatMap<TurnEffectGrant>((tool) => {
      if (tool === "request_confirmation") {
        const actions = baseAuthority.allowedConfirmationActions.filter((action) => action === "batchGenerateVisuals" ? kind === visualKind : kind === "discussion");
        return actions.length ? [{ tool, origin: "currentUserInstruction", confirmationActions: actions }] : [];
      }
      const owner = tool === "generate_visuals" ? visualKind : grantKinds[tool];
      if (owner !== kind) return [];
      return [{ tool, origin: tool === "generate_visuals" || (input.executionWorkIntentSource === "userSelected" && ["designDefinition", "conceptDirection", "deliveryPreparation"].includes(kind))
        ? "trustedUi" : "currentUserInstruction" }];
    });
    const conceptOperation = kind === "conceptDirection" && effectGrants.some((grant) => grant.tool === "create_concept_direction_proposal")
      ? input.executionWorkIntent === "reviseConceptDirection" ? "revise" : input.executionWorkIntent === "splitConceptDirection" ? "split" : input.executionWorkIntent === "mergeConceptDirections" ? "merge" :
        /拆分|split/i.test(instruction) ? "split" : /合并|merge/i.test(instruction) ? "merge" : /修订|修改|revise/i.test(instruction) && sourceObjectIds.some((id) => input.workspace.objects[id]?.type === "conceptDirection") ? "revise" : "create" : undefined;
    const conceptTargets = sourceObjectIds.filter((id) => input.workspace.objects[id]?.type === "conceptDirection");
    const targetRevisionIds = conceptTargets.flatMap((id) => { const object = input.workspace.objects[id]; return object?.type === "conceptDirection" ? [object.currentRevisionId] : []; });
    const expectedOutputs = [visual ? effectGrants.some((grant) => grant.tool === "generate_visuals") ? "newImages" : "visualProposal" : kind === "comparison" ? "chatTradeoffs" : kind === "critique" ? "chatCritique" : "chatAnswer",
      ...effectGrants.filter((grant) => grant.tool !== "generate_visuals").map((grant) => grant.tool)];
    const targetObjectIds = [...new Set([...sourceObjectIds, ...(visual ? sourceObjectIds.flatMap((id) => {
      const object = input.workspace.objects[id];
      return object?.type === "image" && object.directionId ? [object.directionId] : [];
    }) : [])])];
    const expectedVisuals = visual ? resolveExpectedVisualGenerationCount({ draft: instruction, kind,
      selectedDirectionCount: sourceObjectIds.filter((id) => input.workspace.objects[id]?.type === "conceptDirection").length,
      defaultPreviewCount: input.directionPreviewCount }) : undefined;
    return { id: `activity-${index + 1}`, kind, instruction, targetObjectIds, sourceObjectIds,
      referenceObjectIds, excludedObjectIds, includeDefaultReference,
      requiredFacts: sourceObjectIds.length ? ["selectedObjectContent", "currentProjectFacts"] : ["currentProjectFacts"],
      effectGrants, expectedOutputs,
      ...(conceptOperation ? { conceptOperation, targetRevisionIds } : {}),
      ...(visual && /(?:生成|出图|画).*(?:后|再|然后).*(?:比较|评价|批评|分析|判断)|(?:比较|评价|批评).*(?:新生成|刚生成)/.test(text) && !/(?:不要|无需|不用|别).{0,12}(?:比较|评价|批评|分析|判断)/.test(text) ? { observeGeneratedImages: true } : {}),
      ...(expectedVisuals ? { expectedVisualCount: expectedVisuals.totalItems, ...(expectedVisuals.requestedPreviewCount ? { requestedPreviewCount: expectedVisuals.requestedPreviewCount } : {}) } : {}),
      ...(narrow?.blocked ? { scopeBlockedReason: narrow.blocked } : {}) };
  });
  return { version: 1, readContractVersion: 1, userGoal: input.draft, primaryFocus: focus.kind, execution: baseAuthority.execution, activities,
    completionConditions: activities.flatMap((activity) => activity.expectedOutputs.map((output) => `${activity.id}:${output}${output === "newImages" ? `:${activity.expectedVisualCount}` : ""}`)),
    requiredReads: [...resolveRequiredAgentReadRequirements(text, { hasSelectedObject: selectedIds.length > 0 }),
      ...selected.flatMap((object): import("@/shared/turnTaskContract").RequiredAgentReadRequirement[] => {
        if (object.type === "file" && /全文|完整|整份|通读|deep read/i.test(text)) return [{ tool: "read_workspace_source", kind: "document", objectId: object.id }];
        if (object.type !== "conceptDirection" && object.type !== "designDefinition") return [];
        const revisions = object.type === "conceptDirection" ? input.workspace.directionRevisions : input.workspace.designDefinitionRevisions;
        const current = revisions[object.currentRevisionId];
        const previous = /上一版|前一版/.test(text) ? current?.previousRevisionId : undefined;
        const explicit = object.revisionIds.find((id) => text.includes(id));
        if (!previous && !explicit && !/当前.*(?:revision|修订|版本)|指定.*(?:revision|修订|版本)/i.test(text)) return [];
        return [{ tool: "read_workspace_source", kind: "object", objectId: object.id, revisionId: explicit ?? previous ?? object.currentRevisionId }];
      })] };
}

function resolveVisualScope(text: string, selected: readonly MorphoObject[]): { ids: string[]; blocked?: string } | undefined {
  const clause = text.split(/[，,。；;！？!?\n]+/).find((part) => /(?:只|仅)(?:在|用|沿用|继续|基于|针对)|(?:沿用|继续|基于).{0,35}(?:生成|发展|深化)/.test(part));
  if (!clause) return undefined;
  const ordinal = clause.match(/第([一二两三四五六七八九十\d]+)(?:个|张|幅)?/);
  const ordinals: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const ordinalIndex = ordinal ? (ordinals[ordinal[1]!] ?? Number(ordinal[1])) - 1 : undefined;
  const matches = ordinalIndex !== undefined ? selected[ordinalIndex] ? [selected[ordinalIndex]!] : [] :
    selected.filter((object) => mentionsObject(clause, object));
  if (matches.length === 0 && selected.length === 1 && /这张|这个|当前|选中/.test(clause)) return { ids: [selected[0]!.id] };
  return matches.length ? { ids: matches.map((object) => object.id) } :
    { ids: [], blocked: "用户指定的视觉目标无法唯一绑定到当前对象；需要澄清目标后才能生成。" };
}

function mentionsObject(text: string, object: MorphoObject): boolean {
  if (text.includes(object.id) || (object.title.length > 1 && text.includes(object.title))) return true;
  const letter = object.title.match(/^(?:方向|方案|图(?:片)?)?\s*([A-Z])(?:$|[\s｜|:：])/i)?.[1];
  return Boolean(letter && new RegExp(`(?:^|[^A-Za-z])${letter}(?:$|[^A-Za-z])`, "i").test(text));
}

function resolveReferenceScope(workspace: MorphoWorkspace, sources: readonly string[], includeDefault: boolean, narrow: boolean): string[] {
  const ids = new Set<string>();
  for (const id of sources) {
    const object = workspace.objects[id];
    if (object?.type === "image") {
      ids.add(id);
      if (!narrow) {
        object.generation?.referenceObjectIds.forEach((parent) => ids.add(parent));
        workspace.relations.filter((relation) => relation.kind === "version" && relation.toObjectId === id).forEach((relation) => ids.add(relation.fromObjectId));
      }
    }
    if (object?.type === "conceptDirection") Object.values(workspace.objects).filter((image) => image.type === "image" && image.directionId === id).forEach((image) => ids.add(image.id));
  }
  if (includeDefault) {
    if (workspace.workingState.currentDefaultReferenceId) ids.add(workspace.workingState.currentDefaultReferenceId);
    Object.values(workspace.objects).filter((object) => object.type === "image" && object.role === "reference").forEach((object) => ids.add(object.id));
  }
  return [...ids].filter((id) => workspace.objects[id]?.visibility === "active");
}
