import type { MorphoObject, MorphoWorkspace, ProjectMemoryKey, StageRecordKey } from "@/domain/morpho/types";
import { buildSemanticPatchAuthorization } from "@/domain/morpho/conversationSemanticPatch";
import { applyConversationSemanticPatch } from "@/domain/morpho/projectContinuity";
import {
  applyComparisonAnalysis,
  buildComparisonAuthorization,
  validateComparisonAnalysis
} from "@/domain/morpho/comparisonAnalysis";
import { createDeliverySectionDraft } from "@/domain/morpho/deliveryPreparation";
import { validateDeliverySectionDraftPayload } from "@/domain/morpho/deliverySectionDraftBlock";
import {
  getCurrentProjectMemoryRevision,
  getCurrentStageRecordRevision,
  getProjectMemoryHistory,
  getStageRecordHistory
} from "@/domain/morpho/projectMemory";
import { searchProjectConversation } from "@/domain/morpho/conversationSearch";
import {
  canStartOperation,
  createArtifactProposalOperation,
  createResearchOperation,
  recordAndApplyConceptDirectionProposal,
  recordDesignDefinitionProposal
} from "@/domain/operations/operations";
import { compileVisualGenerationPlan } from "@/domain/operations/imagePromptCompiler";
import { normalizeResearchItems } from "@/domain/operations/researchItems";
import type { VisualGenerationPlan } from "@/domain/operations/types";
import { updateAiMessage } from "./aiConversationMessages";
import { updateLocalAgentToolActivity } from "./agentMessageTrace";
import {
  resolveRequiredAgentMemoryUpdates,
  validateAgentMemoryUpdateItems
} from "./agentMemoryUpdateGuard";
import { buildReadSelectedContextResult } from "./agentReadContextResult";
import {
  completeRequiredAgentRead,
  validateRequiredAgentReadCall
} from "./agentTaskStrategy";
import {
  mergeAgentSearchCitations,
  webSearchSourcesToCitations
} from "./agentTurnLimits";
import type { AgentTurnRuntimeState } from "./agentTurnState";
import type { AgentVisualGenerationBatch } from "./agentVisualGenerationBatch";
import { buildDeliverySectionContext } from "./deliveryPreparationUi";
import { applySelectedProposalDraftRevision } from "./proposalDraftRevision";
import {
  getPlacementNearObjects,
  getProposalPlacement,
  getSiblingProposalPlacement
} from "./proposalDraftPlacement";
import { constrainResearchEvidence } from "./researchExtraction";
import { applyResearchProposalWithSemanticPatch } from "./researchSemanticPatch";
import type { ProviderTaskContext, TaskContextResult } from "./taskContext";
import { buildSemanticPatchAuthorizationInput } from "./workspaceSemanticPatch";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import {
  getComparisonToolExecutionBlockReason,
  getDesignDefinitionDrafts,
  type MorphoAgentToolArguments,
  type MorphoAgentToolName,
  type RequestConfirmationArgs
} from "./morphoAgent";

export type AgentVisualGenerationExecution = {
  workspace: MorphoWorkspace;
  createdObjectIds: string[];
  failedItems: unknown[];
};

export type ExecuteAgentVisualGenerationPlan = (input: {
  workspaceSnapshot: MorphoWorkspace;
  draft: string;
  plan: VisualGenerationPlan;
  sourceObjectIds: string[];
  selectedDirectionIds: string[];
  selectedImageIds: string[];
  requestedPreviewCount?: number;
  onProgress?: (message: string) => void;
  signal: AbortSignal;
  aPlusExternalAction?: Readonly<{
    serverTurnId: string;
    localProjectId: string;
    requestId: string;
    stepSequence: number;
    actionId: string;
  }>;
}) => Promise<AgentVisualGenerationExecution>;

export type AgentToolBatchState = {
  visualBatch: AgentVisualGenerationBatch | null;
  executedVisualBatch?: Pick<
    AgentVisualGenerationExecution,
    "createdObjectIds" | "failedItems"
  >;
  pendingAgentActionCreated: boolean;
};

type RequiredMemoryUpdates = ReturnType<typeof resolveRequiredAgentMemoryUpdates>;
type DeliverySectionContext = ReturnType<typeof buildDeliverySectionContext>;

export type AgentToolExecutorInput = {
  callId: string;
  context: TaskContextResult;
  providerTaskContext: ProviderTaskContext;
  runtimeState: AgentTurnRuntimeState;
  batchState: AgentToolBatchState;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  readWorkspace: () => MorphoWorkspace;
  draft: string;
  modelOutputText: string;
  userMessageId: string;
  assistantMessageId: string;
  userMessageCreatedAt: string;
  selectedObjectIds: string[];
  selectedObjects: MorphoObject[];
  allowStructuredComparison: boolean;
  imageAttachmentObjectIds: string[];
  documentExtractObjectIds: string[];
  deliverySectionContext?: DeliverySectionContext;
  requiredMemoryUpdates: RequiredMemoryUpdates;
  imageGenerationModelId: string;
  signal: AbortSignal;
  requestWebSearch: (queries: string[]) => Promise<{
    sources: Array<{ title: string; url: string; domain?: string; snippet?: string; excerpt?: string }>;
    failedSourceCount?: number;
    timedOutSourceCount?: number;
  }>;
  executeVisualGenerationPlan: ExecuteAgentVisualGenerationPlan;
  ui: {
    selectObjects: (objectIds: string[]) => void;
    focusObject: (objectId: string) => void;
    openProposal: (proposalId: string) => void;
    clearPendingDeliveryDraftTarget: () => void;
    requestConfirmation: (
      args: RequestConfirmationArgs,
      compiledVisualPlan: VisualGenerationPlan | undefined
    ) => void;
  };
};

export type AgentToolExecutor<T extends MorphoAgentToolArguments> = (
  input: AgentToolExecutorInput & { parsed: T }
) => Promise<unknown> | unknown;

export type AgentToolExecutorRegistry = {
  [Name in MorphoAgentToolName]: AgentToolExecutor<
    Extract<MorphoAgentToolArguments, { name: Name }>
  >;
};

export const AGENT_TOOL_EXECUTORS: AgentToolExecutorRegistry = {
  read_selected_context: executeReadSelectedContext,
  read_project_memory: executeReadProjectMemory,
  read_stage_record: executeReadStageRecord,
  search_project_conversation: executeSearchProjectConversation,
  revise_selected_proposal_draft: executeReviseSelectedProposalDraft,
  search_web_evidence: executeSearchWebEvidence,
  create_research_analysis: executeCreateResearchAnalysis,
  create_design_definition_proposal: executeCreateDesignDefinitionProposal,
  create_concept_direction_proposal: executeCreateConceptDirectionProposal,
  generate_visuals: executeGenerateVisuals,
  create_comparison_analysis: executeCreateComparisonAnalysis,
  prepare_delivery_section_draft: executePrepareDeliverySectionDraft,
  submit_memory_update: executeSubmitMemoryUpdate,
  request_confirmation: executeRequestConfirmation
};

export async function executeAgentTool(
  input: AgentToolExecutorInput & { parsed: MorphoAgentToolArguments }
): Promise<unknown> {
  const executor = AGENT_TOOL_EXECUTORS[input.parsed.name] as unknown as AgentToolExecutor<MorphoAgentToolArguments>;
  return executor(input);
}

function executeReadSelectedContext(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "read_selected_context" }>;
  }
) {
  return buildReadSelectedContextResult(input.context, input.providerTaskContext);
}

function executeReadProjectMemory(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "read_project_memory" }>;
  }
) {
  const coverage = validateRequiredAgentReadCall(
    input.runtimeState.requiredReadState,
    "read_project_memory",
    input.parsed.args
  );
  if (!coverage.satisfied) {
    throw new Error(coverage.reason);
  }
  const current = input.readWorkspace();
  const keys: ProjectMemoryKey[] = input.parsed.args.keys ?? [
    "projectOverview",
    "designBrief",
    "userPreferences",
    "decisionLog",
    "rejectedDirections",
    "openQuestions",
    "outputPlan"
  ];
  const result = {
    documents: keys.map((key) => {
      const document = current.projectMemory.documents[key];
      const revision = getCurrentProjectMemoryRevision(current.projectMemory, key);
      return {
        key,
        title: document.title,
        revision,
        history: input.parsed.args.includeHistory
          ? getProjectMemoryHistory(current.projectMemory, key).slice(0, 5)
          : undefined
      };
    })
  };
  input.runtimeState.requiredReadState = completeRequiredAgentRead(
    input.runtimeState.requiredReadState,
    "read_project_memory"
  );
  return result;
}

function executeReadStageRecord(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "read_stage_record" }>;
  }
) {
  const coverage = validateRequiredAgentReadCall(
    input.runtimeState.requiredReadState,
    "read_stage_record",
    input.parsed.args
  );
  if (!coverage.satisfied) {
    throw new Error(coverage.reason);
  }
  const current = input.readWorkspace();
  const stages: StageRecordKey[] = input.parsed.args.stages ?? [
    "startAndInput",
    "exploration",
    "research",
    "designDefinition",
    "directionAndVisual",
    "deliveryPreparation"
  ];
  const result = {
    records: stages.map((stage) => ({
      stage,
      revision: getCurrentStageRecordRevision(current.projectMemory, stage),
      history: input.parsed.args.includeHistory
        ? getStageRecordHistory(current.projectMemory, stage).slice(0, 5)
        : undefined
    }))
  };
  input.runtimeState.requiredReadState = completeRequiredAgentRead(
    input.runtimeState.requiredReadState,
    "read_stage_record"
  );
  return result;
}

function executeSearchProjectConversation(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "search_project_conversation" }>;
  }
) {
  const coverage = validateRequiredAgentReadCall(
    input.runtimeState.requiredReadState,
    "search_project_conversation",
    input.parsed.args
  );
  if (!coverage.satisfied) {
    throw new Error(coverage.reason);
  }
  const result = searchProjectConversation(input.readWorkspace(), input.parsed.args);
  input.runtimeState.requiredReadState = completeRequiredAgentRead(
    input.runtimeState.requiredReadState,
    "search_project_conversation"
  );
  return result;
}

function executeReviseSelectedProposalDraft(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "revise_selected_proposal_draft" }>;
  }
) {
  const revision = input.commitWorkspace((current) => {
    const result = applySelectedProposalDraftRevision(
      current,
      input.selectedObjectIds,
      input.parsed.args
    );
    return { workspace: result.workspace, value: result };
  });
  if (revision.status === "updated") {
    input.ui.selectObjects([revision.proposalId]);
    input.ui.openProposal(revision.proposalId);
    return { status: "updated", proposalId: revision.proposalId };
  }
  return { status: "blocked", reason: revision.reason };
}

async function executeSearchWebEvidence(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "search_web_evidence" }>;
  }
) {
  const result = await input.requestWebSearch(input.parsed.args.queries);
  const citations = webSearchSourcesToCitations(result.sources);
  input.runtimeState.collectedCitations = mergeAgentSearchCitations(
    input.runtimeState.collectedCitations,
    citations
  );
  input.runtimeState.hasWebSearchEvidence = true;
  return {
    reason: input.parsed.args.reason,
    sources: result.sources,
    citations,
    failedSourceCount: result.failedSourceCount ?? 0,
    timedOutSourceCount: result.timedOutSourceCount ?? 0
  };
}

function executeCreateResearchAnalysis(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "create_research_analysis" }>;
  }
) {
  const args = input.parsed.args;
  const applied = input.commitWorkspace((current) => {
    const operationGate = canStartOperation(current);
    if (operationGate.status === "blocked") {
      throw new Error(operationGate.reason);
    }
    const created = createResearchOperation(current, {
      userInput: input.draft,
      selectedObjectIds: input.context.objectIds,
      allowWebSearch: input.runtimeState.hasWebSearchEvidence
    });
    const proposalId = `proposal-research-${created.operation.id}-${Date.now()}`;
    const result = applyResearchProposalWithSemanticPatch({
      workspace: created.workspace,
      proposal: {
        proposalId,
        operationId: created.operation.id,
        title: args.title,
        summary: args.summary,
        findings: normalizeResearchItems(args.findings),
        opportunities: normalizeResearchItems(args.opportunities),
        constraints: normalizeResearchItems(args.constraints),
        openQuestions: normalizeResearchItems(args.openQuestions),
        evidence: constrainResearchEvidence(
          args,
          input.context.objectIds,
          input.runtimeState.collectedCitations
        ),
        sourceObjectIds: input.context.objectIds,
        citations: input.runtimeState.collectedCitations
      },
      position: getPlacementNearObjects(created.workspace, input.context.objectIds, {
        x: created.workspace.canvas.view.x + 220,
        y: created.workspace.canvas.view.y + 180
      }),
      context: input.context,
      draft: input.draft,
      userMessageId: input.userMessageId,
      userMessageCreatedAt: input.userMessageCreatedAt,
      assistantText: ""
    });
    return { workspace: result.workspace, value: result };
  });
  if (applied.status === "updated") {
    input.ui.selectObjects([applied.researchObjectId]);
    input.ui.focusObject(applied.researchObjectId);
  }
  return {
    status: applied.status,
    researchObjectId: applied.status === "updated" ? applied.researchObjectId : undefined,
    reason: applied.status === "blocked" ? applied.reason : undefined
  };
}

function executeCreateDesignDefinitionProposal(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "create_design_definition_proposal" }>;
  }
) {
  const args = input.parsed.args;
  const proposalIds = input.commitWorkspace((current) => {
    const operationGate = canStartOperation(current);
    if (operationGate.status === "blocked") {
      throw new Error(operationGate.reason);
    }
    const operationId = `operation-designDefinition-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created = createArtifactProposalOperation(current, {
      operationId,
      type: "designDefinition",
      userInput: input.draft,
      selectedObjectIds: input.context.objectIds,
      workIntent: "createDesignDefinition"
    });
    const basedOnDefinitionId = current.workingState.currentDesignDefinitionId;
    const basedOnDefinitionObject = basedOnDefinitionId
      ? current.objects[basedOnDefinitionId]
      : undefined;
    const proposalPlacement = getProposalPlacement(
      created.workspace,
      input.context.objectIds,
      "definition"
    );
    const recordedProposalIds: string[] = [];
    let nextWorkspace = created.workspace;
    for (const [proposalIndex, proposalDraft] of getDesignDefinitionDrafts(args).entries()) {
      const recorded = recordDesignDefinitionProposal(nextWorkspace, {
        operationId,
        workIntent: "createDesignDefinition",
        title: proposalDraft.title,
        summary: proposalDraft.summary,
        projectGoal: proposalDraft.projectGoal,
        targetUsers: proposalDraft.targetUsers,
        primaryScenarios: proposalDraft.primaryScenarios,
        coreProblem: proposalDraft.coreProblem,
        designPrinciples: proposalDraft.designPrinciples,
        constraints: normalizeResearchItems(proposalDraft.constraints),
        avoidDirections: proposalDraft.avoidDirections,
        opportunities: normalizeResearchItems(proposalDraft.opportunities),
        openQuestions: normalizeResearchItems(proposalDraft.openQuestions),
        changeNote: proposalDraft.changeNote,
        sourceObjectIds: input.context.objectIds,
        citations: input.runtimeState.collectedCitations,
        basedOnDesignDefinitionId:
          basedOnDefinitionObject?.type === "designDefinition"
            ? basedOnDefinitionObject.id
            : undefined,
        basedOnRevisionId:
          basedOnDefinitionObject?.type === "designDefinition"
            ? basedOnDefinitionObject.currentRevisionId
            : undefined,
        position: getSiblingProposalPlacement(proposalPlacement, proposalIndex)
      });
      nextWorkspace = recorded.workspace;
      recordedProposalIds.push(recorded.proposal.id);
    }
    return { workspace: nextWorkspace, value: recordedProposalIds };
  });
  return {
    status: "created",
    proposalId: proposalIds[0],
    proposalIds
  };
}

function executeCreateConceptDirectionProposal(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "create_concept_direction_proposal" }>;
  }
) {
  const args = input.parsed.args;
  const placed = input.commitWorkspace((current) => {
    const operationGate = canStartOperation(current);
    if (operationGate.status === "blocked") {
      throw new Error(operationGate.reason);
    }
    const operationId = `operation-conceptDirection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created = createArtifactProposalOperation(current, {
      operationId,
      type: "conceptDirection",
      userInput: input.draft,
      selectedObjectIds: input.context.objectIds,
      workIntent: "createConceptDirections"
    });
    const basedOnDefinitionId = current.workingState.currentDesignDefinitionId;
    const basedOnDefinitionObject = basedOnDefinitionId
      ? current.objects[basedOnDefinitionId]
      : undefined;
    const result = recordAndApplyConceptDirectionProposal(created.workspace, {
      operationId,
      workIntent: "createConceptDirections",
      title: args.title,
      summary: args.summary,
      directions: args.directions,
      sourceObjectIds: input.context.objectIds,
      citations: input.runtimeState.collectedCitations,
      basedOnDesignDefinitionId:
        basedOnDefinitionObject?.type === "designDefinition"
          ? basedOnDefinitionObject.id
          : undefined,
      basedOnRevisionId:
        basedOnDefinitionObject?.type === "designDefinition"
          ? basedOnDefinitionObject.currentRevisionId
          : undefined,
      position: getProposalPlacement(created.workspace, input.context.objectIds, "direction")
    });
    return { workspace: result.workspace, value: result };
  });
  if (placed.status === "updated") {
    input.ui.selectObjects(placed.directions.map((direction) => direction.id));
    if (placed.directions[0]) {
      input.ui.focusObject(placed.directions[0].id);
    }
  }
  return {
    status: placed.status === "updated" ? "applied" : "created",
    proposalId: placed.proposal.id,
    directionIds:
      placed.status === "updated"
        ? placed.directions.map((direction) => direction.id)
        : undefined,
    reason: placed.status === "blocked" ? placed.reason : undefined
  };
}

async function executeGenerateVisuals(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "generate_visuals" }>;
  }
) {
  const visualBatch = input.batchState.visualBatch;
  if (!visualBatch || visualBatch.status !== "ok") {
    throw new Error("图像生成批次没有通过完整性校验。");
  }
  if (input.batchState.executedVisualBatch) {
    return {
      status: "created",
      objectIds: input.batchState.executedVisualBatch.createdObjectIds,
      failedItems: input.batchState.executedVisualBatch.failedItems,
      batched: true
    };
  }

  const generationResult = await input.executeVisualGenerationPlan({
    workspaceSnapshot: input.readWorkspace(),
    draft: input.draft,
    plan: visualBatch.plan,
    sourceObjectIds: input.context.objectIds,
    selectedDirectionIds: input.selectedObjects
      .filter((object) => object.type === "conceptDirection")
      .map((object) => object.id),
    selectedImageIds: input.selectedObjects
      .filter((object) => object.type === "image")
      .map((object) => object.id),
    requestedPreviewCount: visualBatch.expected.requestedPreviewCount,
    onProgress: (message) => {
      input.commitWorkspace((current) => {
        const assistant = current.ai.messages.find(
          (candidate) => candidate.id === input.assistantMessageId
        );
        if (!assistant?.agentTrace) {
          return { workspace: current, value: undefined };
        }
        return {
          workspace: updateAiMessage(
            current,
            input.assistantMessageId,
            assistant.body,
            "streaming",
            {
              agentTrace: updateLocalAgentToolActivity(
                assistant.agentTrace,
                input.callId,
                { detail: message }
              )
            }
          ),
          value: undefined
        };
      });
    },
    signal: input.signal
  });
  input.batchState.executedVisualBatch = generationResult;
  return {
    status: "created",
    objectIds: generationResult.createdObjectIds,
    failedItems: generationResult.failedItems,
    batched: true
  };
}

function executeCreateComparisonAnalysis(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "create_comparison_analysis" }>;
  }
) {
  const blockReason = getComparisonToolExecutionBlockReason({
    explicitComparisonRequested: input.allowStructuredComparison,
    selectedObjectCount: input.selectedObjectIds.length
  });
  if (blockReason) {
    throw new Error(blockReason);
  }
  const args = input.parsed.args;
  const analysisId = input.commitWorkspace((current) => {
    const authorizationResult = buildComparisonAuthorization({
      workspace: current,
      selectedObjectIds: input.selectedObjectIds,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      createdAt: input.userMessageCreatedAt,
      comparisonGoal: args.comparisonGoal,
      imageAttachmentObjectIds: input.imageAttachmentObjectIds,
      documentExtractObjectIds: input.documentExtractObjectIds,
      documentFragmentExtractObjectIds: input.context.documentFragmentExtracts.map(
        (fragment) => fragment.objectId
      )
    });
    if (!("authorization" in authorizationResult)) {
      throw new Error(
        authorizationResult.status === "blocked"
          ? authorizationResult.reason
          : "Compare authorization was not created."
      );
    }
    const validation = validateComparisonAnalysis(args, authorizationResult.authorization);
    if (validation.status !== "ok") {
      throw new Error(validation.reason);
    }
    const next = applyComparisonAnalysis(current, validation.analysis);
    return { workspace: next, value: validation.analysis.id };
  });
  return { status: "created", analysisId };
}

function executePrepareDeliverySectionDraft(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "prepare_delivery_section_draft" }>;
  }
) {
  const sectionContext = input.deliverySectionContext;
  if (!sectionContext) {
    throw new Error("当前没有已授权的交付章节上下文。");
  }
  const validation = validateDeliverySectionDraftPayload(input.parsed.args, {
    deliveryObjectId: sectionContext.deliveryObjectId,
    sectionId: sectionContext.sectionId,
    referenceIds: sectionContext.references.map((reference) => reference.referenceId)
  });
  if (validation.status !== "ok") {
    throw new Error(validation.reason);
  }
  const result = input.commitWorkspace((current) => {
    const created = createDeliverySectionDraft(current, {
      deliveryObjectId: sectionContext.deliveryObjectId,
      sectionId: sectionContext.sectionId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      title: input.parsed.args.title,
      narrative: input.parsed.args.narrative,
      captions: input.parsed.args.captions,
      suggestedGaps: input.parsed.args.suggestedGaps,
      now: new Date().toISOString()
    });
    return { workspace: created.workspace, value: created };
  });
  if (result.status !== "updated") {
    throw new Error(result.reason);
  }
  input.ui.clearPendingDeliveryDraftTarget();
  input.runtimeState.pendingConfirmationCreated = true;
  return {
    status: "pendingConfirmation",
    draftId: result.draftId,
    deliveryObjectId: sectionContext.deliveryObjectId,
    sectionId: sectionContext.sectionId,
    note: "草稿尚未应用到交付章节。"
  };
}

function executeSubmitMemoryUpdate(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "submit_memory_update" }>;
  }
) {
  const validation = validateAgentMemoryUpdateItems({
    candidates: input.requiredMemoryUpdates,
    draft: input.draft,
    items: input.parsed.args.items
  });
  const legalBatchSkip =
    input.parsed.args.items.length === 0 &&
    Boolean(input.parsed.args.skippedReason?.trim());
  if (
    input.requiredMemoryUpdates.length === 0 ||
    (!legalBatchSkip && validation.accepted.length === 0)
  ) {
    if (input.requiredMemoryUpdates.length > 0) {
      input.runtimeState.memoryUpdateReminderInserted = false;
    }
    return {
      status: input.requiredMemoryUpdates.length > 0 ? "retryable" : "skipped",
      retryable: input.requiredMemoryUpdates.length > 0,
      rejected: validation.rejected,
      skippedReason:
        input.requiredMemoryUpdates.length > 0
          ? "记忆证据必须逐字来自当前用户消息；请修正 evidenceQuote，或传 items:[] 并填写 skippedReason。"
          : "当前消息仅是一次性要求，不能写入项目记忆。"
    };
  }
  if (legalBatchSkip) {
    input.requiredMemoryUpdates.forEach((_candidate, index) =>
      input.runtimeState.handledMemoryCandidateIndexes.add(index)
    );
    return {
      status: "skipped",
      skippedReason: input.parsed.args.skippedReason
    };
  }
  const acceptedItems = validation.accepted.map(({ itemIndex, candidateIndex }) => {
    input.runtimeState.handledMemoryCandidateIndexes.add(candidateIndex);
    return input.parsed.args.items[itemIndex]!;
  });
  const memoryUpdate = input.commitWorkspace((current) => {
    const authorization = buildSemanticPatchAuthorization(
      buildSemanticPatchAuthorizationInput({
        workspace: current,
        taskMode: "chatAnalysis",
        context: input.context,
        draft: input.draft,
        userMessageId: input.userMessageId,
        userMessageCreatedAt: input.userMessageCreatedAt
      })
    );
    const applied = applyConversationSemanticPatch(
      current,
      authorization,
      acceptedItems.map((item) => ({
        ...item,
        relatedDecisionIds: []
      }))
    );
    return { workspace: applied.workspace, value: applied };
  });
  memoryUpdate.entries.forEach((entry) => {
    input.runtimeState.memoryUpdateEntryIds.add(entry.id);
    input.runtimeState.stageRecordUpdateKeys.add(entry.stage);
    input.runtimeState.memoryUpdateKeys.add(
      entry.category === "openQuestion" ? "openQuestions" : "userPreferences"
    );
  });
  const memoryUpdateWasApplied = memoryUpdate.entries.length > 0;
  const memoryUpdateWasEquivalent =
    memoryUpdate.entries.length === 0 && memoryUpdate.rejected.length === 0;
  for (const accepted of validation.accepted) {
    const item = input.parsed.args.items[accepted.itemIndex];
    if (
      item &&
      memoryUpdate.rejected.some(
        (rejected) => rejected.evidenceQuote === item.evidenceQuote
      )
    ) {
      input.runtimeState.handledMemoryCandidateIndexes.delete(accepted.candidateIndex);
    }
  }
  if (
    (!memoryUpdateWasApplied && !memoryUpdateWasEquivalent) ||
    validation.rejected.length > 0
  ) {
    input.runtimeState.memoryUpdateReminderInserted = false;
  }
  return {
    status: memoryUpdateWasApplied
      ? validation.rejected.length > 0
        ? "partial"
        : "recorded"
      : memoryUpdateWasEquivalent
        ? "skipped"
        : "retryable",
    retryable:
      validation.rejected.length > 0 ||
      (!memoryUpdateWasApplied && !memoryUpdateWasEquivalent),
    entryIds: memoryUpdate.entries.map((entry) => entry.id),
    rejected: [...validation.rejected, ...memoryUpdate.rejected]
  };
}

function executeRequestConfirmation(
  input: AgentToolExecutorInput & {
    parsed: Extract<MorphoAgentToolArguments, { name: "request_confirmation" }>;
  }
) {
  const args = input.parsed.args;
  const compiledVisualPlan = args.visualPlan
    ? compileVisualGenerationPlan({
        workspace: input.readWorkspace(),
        kind: args.visualPlan.kind,
        intents: args.visualPlan.items,
        selectedSourceObjectIds: input.context.objectIds,
        modelId: input.imageGenerationModelId,
        currentUserInput: input.draft
      })
    : undefined;
  input.ui.requestConfirmation(args, compiledVisualPlan);
  input.runtimeState.finalText =
    input.modelOutputText.trim() || "已准备确认卡。确认前不会改变项目状态。";
  input.batchState.pendingAgentActionCreated = true;
  input.runtimeState.pendingConfirmationCreated = true;
  return {
    status: "pendingConfirmation",
    action: args.action,
    reason: args.reason,
    impact: args.impact
  };
}
