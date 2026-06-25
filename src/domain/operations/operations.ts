import type {
  CanvasPoint,
  ConceptDirectionObject,
  DesignDefinitionObject,
  DesignDefinitionRevision,
  MorphoRelation,
  MorphoWorkspace,
  ResearchObject
} from "../morpho/types";
import { reconcileWorkspaceDerivedState } from "../morpho/derivedState";
import type {
  ConceptDirectionProposal,
  DesignDefinitionProposal,
  ImageGenerationOperationMetadata,
  OperationRecord,
  OperationStatus,
  ProposalReviewState,
  ResearchEvidence,
  ResearchAnalysisProposal,
  SourceCitation
} from "./types";

export type CreateResearchOperationInput = {
  userInput: string;
  selectedObjectIds: string[];
  allowWebSearch: boolean;
};

export type CreateResearchOperationResult = {
  workspace: MorphoWorkspace;
  operation: OperationRecord;
};

export type RecordResearchProposalInput = {
  proposalId?: string;
  operationId: string;
  title: string;
  summary: string;
  findings: string[];
  opportunities: string[];
  constraints: string[];
  openQuestions: string[];
  evidence?: Array<{
    claim: string;
    sourceObjectIds: string[];
    citationUrls: string[];
    confidence: ResearchEvidence["confidence"];
  }>;
  sourceObjectIds: string[];
  citations: Array<{
    title: string;
    url?: string;
    domain?: string;
    snippet?: string;
  }>;
  sourceChangedWarning?: string;
};

export type RecordResearchProposalResult = {
  workspace: MorphoWorkspace;
  proposal: ResearchAnalysisProposal;
};

export type RecordDesignDefinitionProposalInput = {
  proposalId?: string;
  operationId?: string;
  title: string;
  summary: string;
  projectGoal: string;
  targetUsers: string[];
  primaryScenarios: string[];
  coreProblem: string;
  designPrinciples: string[];
  constraints: string[];
  avoidDirections: string[];
  opportunities: string[];
  openQuestions: string[];
  sourceObjectIds: string[];
  citations: Array<{
    title: string;
    url?: string;
    domain?: string;
    snippet?: string;
  }>;
  basedOnDesignDefinitionId?: string;
  basedOnRevisionId?: string;
  changeNote?: string;
};

export type RecordDesignDefinitionProposalResult = {
  workspace: MorphoWorkspace;
  proposal: DesignDefinitionProposal;
};

export type ApplyDesignDefinitionProposalResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      designDefinitionObject: DesignDefinitionObject;
      revision: DesignDefinitionRevision;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

export type RecordConceptDirectionProposalInput = {
  proposalId?: string;
  operationId?: string;
  title: string;
  summary: string;
  directions: ConceptDirectionProposal["directions"];
  sourceObjectIds: string[];
  citations: Array<{
    title: string;
    url?: string;
    domain?: string;
    snippet?: string;
  }>;
  basedOnDesignDefinitionId?: string;
  basedOnRevisionId?: string;
};

export type RecordConceptDirectionProposalResult = {
  workspace: MorphoWorkspace;
  proposal: ConceptDirectionProposal;
};

export type ApplyConceptDirectionProposalResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      directions: ConceptDirectionObject[];
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

export type ApplyResearchProposalResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      researchObject: ResearchObject;
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      reason: string;
    };

export type CreateImageGenerationOperationInput = Omit<
  ImageGenerationOperationMetadata,
  "providerTaskId" | "resultObjectId"
> & {
  operationId: string;
  prompt: string;
  selectedObjectIds: string[];
  imagePixels: boolean;
};

export type CompleteImageGenerationOperationInput = {
  operationId: string;
  providerTaskId?: string;
  resultObjectId: string;
};

export type MarkImageGenerationOperationSubmittedInput = {
  operationId: string;
  referenceObjectIds: string[];
  imagePixels: boolean;
};

export type FailImageGenerationOperationInput = {
  operationId: string;
  status: Extract<OperationStatus, "failed" | "cancelled" | "interrupted">;
  reason: string;
  providerTaskId?: string;
};

export function createResearchOperation(
  workspace: MorphoWorkspace,
  input: CreateResearchOperationInput
): CreateResearchOperationResult {
  const now = new Date().toISOString();
  const operationId = nextRecordId(workspace.operations, "operation-research");
  const objectSnapshots = input.selectedObjectIds
    .map((objectId) => workspace.objects[objectId])
    .filter((object) => Boolean(object))
    .map((object) => ({
      id: object.id,
      type: object.type,
      title: object.title,
      summary: object.summary,
      body: "body" in object && typeof object.body === "string" ? object.body : undefined
    }));
  const operation: OperationRecord = {
    id: operationId,
    type: "research",
    projectId: workspace.project.id,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    userInput: input.userInput,
    inputSnapshot: {
      userInput: input.userInput,
      selectedObjectIds: [...input.selectedObjectIds],
      objectSnapshots
    },
    allowedCapabilities: {
      webSearch: input.allowWebSearch,
      imagePixels: false
    },
    steps: [
      {
        id: `${operationId}-step-input`,
        kind: "inputSnapshot",
        status: "succeeded",
        summary: "已保存本次研究任务的输入快照。",
        createdAt: now
      }
    ],
    events: [
      {
        id: `${operationId}-event-created`,
        createdAt: now,
        summary: "研究任务已创建。"
      }
    ],
    sourceIds: [...input.selectedObjectIds],
    proposalIds: [],
    retryable: true
  };

  return {
    operation,
    workspace: {
      ...workspace,
      operations: {
        ...workspace.operations,
        [operation.id]: operation
      }
    }
  };
}

export function getActiveOperation(workspace: MorphoWorkspace): OperationRecord | undefined {
  return Object.values(workspace.operations).find((operation) => isActiveOperationStatus(operation.status));
}

export function canStartOperation(workspace: MorphoWorkspace):
  | {
      status: "ok";
    }
  | {
      status: "blocked";
      operation: OperationRecord;
      reason: string;
    } {
  const active = getActiveOperation(workspace);
  if (!active) {
    return { status: "ok" };
  }

  return {
    status: "blocked",
    operation: active,
    reason: "当前项目已有一个未完成的 Operation，请先取消或处理后再开始新的任务。"
  };
}

export function createImageGenerationOperation(
  workspace: MorphoWorkspace,
  input: CreateImageGenerationOperationInput
): { workspace: MorphoWorkspace; operation: OperationRecord } {
  const now = new Date().toISOString();
  const objectSnapshots = input.selectedObjectIds
    .map((objectId) => workspace.objects[objectId])
    .filter((object) => Boolean(object))
    .map((object) => ({
      id: object.id,
      type: object.type,
      title: object.title,
      summary: object.summary,
      body: "body" in object && typeof object.body === "string" ? object.body : undefined
    }));
  const operation: OperationRecord = {
    id: input.operationId,
    type: "imageGeneration",
    projectId: workspace.project.id,
    createdAt: now,
    updatedAt: now,
    status: "preparing",
    userInput: input.prompt,
    inputSnapshot: {
      userInput: input.prompt,
      selectedObjectIds: [...input.selectedObjectIds],
      objectSnapshots
    },
    allowedCapabilities: {
      webSearch: false,
      imagePixels: input.imagePixels
    },
    steps: [
      {
        id: `${input.operationId}-step-input`,
        kind: "inputSnapshot",
        status: "succeeded",
        summary: "已保存本次图像生成任务的输入快照。",
        createdAt: now
      }
    ],
    events: [
      {
        id: `${input.operationId}-event-created`,
        createdAt: now,
        summary: "图像生成任务已创建。"
      }
    ],
    sourceIds: [...input.referenceObjectIds],
    proposalIds: [],
    retryable: false,
    imageGeneration: {
      clientRequestId: input.clientRequestId,
      modelId: input.modelId,
      modelLabel: input.modelLabel,
      aspectRatio: input.aspectRatio,
      sizeOption: input.sizeOption,
      referenceObjectIds: [...input.referenceObjectIds],
      directionObjectId: input.directionObjectId
    }
  };

  return {
    operation,
    workspace: {
      ...workspace,
      operations: {
        ...workspace.operations,
        [operation.id]: operation
      }
    }
  };
}

export function completeImageGenerationOperation(
  workspace: MorphoWorkspace,
  input: CompleteImageGenerationOperationInput
): MorphoWorkspace {
  const operation = workspace.operations[input.operationId];
  if (!operation || operation.type !== "imageGeneration") {
    return workspace;
  }

  const now = new Date().toISOString();
  const updatedOperation: OperationRecord = {
    ...operation,
    status: "succeeded",
    updatedAt: now,
    retryable: false,
    imageGeneration: operation.imageGeneration
      ? {
          ...operation.imageGeneration,
          providerTaskId: input.providerTaskId,
          resultObjectId: input.resultObjectId
        }
      : undefined,
    steps: [
      ...operation.steps,
      {
        id: `${operation.id}-step-asset-${operation.steps.length + 1}`,
        kind: "assetSave",
        status: "succeeded",
        summary: "生成结果已保存为独立本地资产和新图像对象。",
        createdAt: now
      }
    ],
    events: [
      ...operation.events,
      {
        id: `${operation.id}-event-succeeded-${operation.events.length + 1}`,
        createdAt: now,
        summary: "图像生成任务已完成。"
      }
    ]
  };

  return {
    ...workspace,
    operations: {
      ...workspace.operations,
      [operation.id]: updatedOperation
    }
  };
}

export function markImageGenerationOperationSubmitted(
  workspace: MorphoWorkspace,
  input: MarkImageGenerationOperationSubmittedInput
): MorphoWorkspace {
  const operation = workspace.operations[input.operationId];
  if (!operation || operation.type !== "imageGeneration") {
    return workspace;
  }

  const now = new Date().toISOString();
  const updatedOperation: OperationRecord = {
    ...operation,
    status: "running",
    updatedAt: now,
    sourceIds: [...input.referenceObjectIds],
    allowedCapabilities: {
      ...operation.allowedCapabilities,
      imagePixels: input.imagePixels
    },
    imageGeneration: operation.imageGeneration
      ? {
          ...operation.imageGeneration,
          referenceObjectIds: [...input.referenceObjectIds]
        }
      : undefined,
    steps: [
      ...operation.steps,
      {
        id: `${operation.id}-step-submit-${operation.steps.length + 1}`,
        kind: "providerSubmit",
        status: "succeeded",
        summary: "已提交受控图像生成请求。",
        createdAt: now
      }
    ],
    events: [
      ...operation.events,
      {
        id: `${operation.id}-event-submitted-${operation.events.length + 1}`,
        createdAt: now,
        summary: "图像生成请求已提交。"
      }
    ]
  };

  return {
    ...workspace,
    operations: {
      ...workspace.operations,
      [operation.id]: updatedOperation
    }
  };
}

export function failImageGenerationOperation(
  workspace: MorphoWorkspace,
  input: FailImageGenerationOperationInput
): MorphoWorkspace {
  const operation = workspace.operations[input.operationId];
  if (!operation || operation.type !== "imageGeneration") {
    return workspace;
  }

  const now = new Date().toISOString();
  const updatedOperation: OperationRecord = {
    ...operation,
    status: input.status,
    updatedAt: now,
    errorSummary: input.reason,
    retryable: input.status !== "cancelled",
    imageGeneration: operation.imageGeneration
      ? {
          ...operation.imageGeneration,
          providerTaskId: input.providerTaskId ?? operation.imageGeneration.providerTaskId
        }
      : undefined,
    steps: [
      ...operation.steps,
      {
        id: `${operation.id}-step-${input.status}-${operation.steps.length + 1}`,
        kind: "providerWait",
        status: "failed",
        summary: input.reason,
        createdAt: now
      }
    ],
    events: [
      ...operation.events,
      {
        id: `${operation.id}-event-${input.status}-${operation.events.length + 1}`,
        createdAt: now,
        summary: input.reason
      }
    ]
  };

  return {
    ...workspace,
    operations: {
      ...workspace.operations,
      [operation.id]: updatedOperation
    }
  };
}

export function interruptActiveOperations(workspace: MorphoWorkspace, reason: string): MorphoWorkspace {
  let didChange = false;
  const now = new Date().toISOString();
  const operations = Object.fromEntries(
    Object.entries(workspace.operations).map(([operationId, operation]) => {
      if (!isActiveOperationStatus(operation.status)) {
        return [operationId, operation];
      }

      didChange = true;
      return [
        operationId,
        {
          ...operation,
          status: "interrupted" as const,
          updatedAt: now,
          errorSummary: reason,
          retryable: true,
          events: [
            ...operation.events,
            {
              id: `${operation.id}-event-interrupted-${operation.events.length + 1}`,
              createdAt: now,
              summary: "任务因本地运行中断被标记为已中断。"
            }
          ]
        }
      ];
    })
  );

  return didChange
    ? {
        ...workspace,
        operations
      }
    : workspace;
}

export function recordResearchAnalysisProposal(
  workspace: MorphoWorkspace,
  input: RecordResearchProposalInput
): RecordResearchProposalResult {
  const operation = workspace.operations[input.operationId];
  const now = new Date().toISOString();
  const proposalId =
    input.proposalId && !workspace.artifactProposals[input.proposalId]
      ? input.proposalId
      : nextRecordId(workspace.artifactProposals, `proposal-research-${input.operationId}`);
  const citationEntries = materializeCitationSnapshots(workspace, proposalId, input.operationId, input.citations, now);
  const citationIdByUrl = new Map(citationEntries.filter((citation) => citation.url).map((citation) => [citation.url, citation.id]));
  const evidence: ResearchEvidence[] = (input.evidence ?? []).map((item) => ({
    claim: item.claim,
    sourceObjectIds: item.sourceObjectIds.filter((sourceObjectId) => input.sourceObjectIds.includes(sourceObjectId)),
    citationIds: item.citationUrls.map((url) => citationIdByUrl.get(url)).filter((id): id is string => Boolean(id)),
    confidence: item.confidence
  }));
  const proposal: ResearchAnalysisProposal = {
    id: proposalId,
    type: "researchAnalysis",
    operationId: input.operationId,
    status: "pending",
    title: input.title,
    summary: input.summary,
    findings: [...input.findings],
    opportunities: [...input.opportunities],
    constraints: [...input.constraints],
    openQuestions: [...input.openQuestions],
    evidence,
    sourceObjectIds: [...input.sourceObjectIds],
    citationIds: citationEntries.map((citation) => citation.id),
    sourceChangedWarning: input.sourceChangedWarning,
    createdAt: now,
    reviewState: input.sourceChangedWarning ? "sourceChanged" : "ready"
  };
  const updatedOperation: OperationRecord | undefined = operation
    ? {
        ...operation,
        status: "waiting_for_user",
        updatedAt: now,
        proposalIds: [...operation.proposalIds, proposal.id],
        steps: [
          ...operation.steps,
          {
            id: `${operation.id}-step-proposal-${operation.steps.length + 1}`,
            kind: "proposal",
            status: "succeeded",
            summary: "研究分析草案已准备，等待用户确认保存。",
            createdAt: now
          }
        ]
      }
    : undefined;

  return {
    proposal,
    workspace: {
      ...workspace,
      operations: updatedOperation
        ? {
            ...workspace.operations,
            [updatedOperation.id]: updatedOperation
          }
        : workspace.operations,
      artifactProposals: {
        ...workspace.artifactProposals,
        [proposal.id]: proposal
      },
      citationSnapshots: {
        ...workspace.citationSnapshots,
        ...Object.fromEntries(citationEntries.map((citation) => [citation.id, citation]))
      }
    }
  };
}

export function recordDesignDefinitionProposal(
  workspace: MorphoWorkspace,
  input: RecordDesignDefinitionProposalInput
): RecordDesignDefinitionProposalResult {
  const now = new Date().toISOString();
  const proposalId =
    input.proposalId && !workspace.artifactProposals[input.proposalId]
      ? input.proposalId
      : nextRecordId(workspace.artifactProposals, `proposal-definition-${Date.now()}`);
  const citationEntries = materializeCitationSnapshots(workspace, proposalId, input.operationId, input.citations, now);
  const proposal: DesignDefinitionProposal = {
    id: proposalId,
    type: "designDefinition",
    operationId: input.operationId,
    status: "pending",
    reviewState: "ready",
    sourceObjectIds: [...input.sourceObjectIds],
    citationIds: citationEntries.map((citation) => citation.id),
    createdAt: now,
    title: input.title,
    summary: input.summary,
    projectGoal: input.projectGoal,
    targetUsers: [...input.targetUsers],
    primaryScenarios: [...input.primaryScenarios],
    coreProblem: input.coreProblem,
    designPrinciples: [...input.designPrinciples],
    constraints: [...input.constraints],
    avoidDirections: [...input.avoidDirections],
    opportunities: [...input.opportunities],
    openQuestions: [...input.openQuestions],
    basedOnDesignDefinitionId: input.basedOnDesignDefinitionId,
    basedOnRevisionId: input.basedOnRevisionId,
    changeNote: input.changeNote
  };

  return {
    proposal,
    workspace: {
      ...workspace,
      artifactProposals: {
        ...workspace.artifactProposals,
        [proposal.id]: proposal
      },
      citationSnapshots: {
        ...workspace.citationSnapshots,
        ...Object.fromEntries(citationEntries.map((citation) => [citation.id, citation]))
      }
    }
  };
}

export function applyDesignDefinitionProposal(
  workspace: MorphoWorkspace,
  proposalId: string
): ApplyDesignDefinitionProposalResult {
  const proposal = workspace.artifactProposals[proposalId];
  if (!proposal || proposal.type !== "designDefinition") {
    return {
      status: "blocked",
      workspace,
      reason: "设计定义草案不存在。"
    };
  }

  if (proposal.status !== "pending") {
    return {
      status: "blocked",
      workspace,
      reason: "设计定义草案已被处理。"
    };
  }

  const now = new Date().toISOString();
  const designReview = evaluateDesignDefinitionProposalReviewState(workspace, proposal);
  if (designReview) {
    return {
      status: "blocked",
      workspace: updateProposalReviewState(workspace, proposal.id, designReview.state),
      reason: designReview.reason
    };
  }

  const currentDefinitionId =
    proposal.basedOnDesignDefinitionId && workspace.objects[proposal.basedOnDesignDefinitionId]?.type === "designDefinition"
      ? proposal.basedOnDesignDefinitionId
      : workspace.workingState.currentDesignDefinitionId &&
          workspace.objects[workspace.workingState.currentDesignDefinitionId]?.type === "designDefinition"
        ? workspace.workingState.currentDesignDefinitionId
        : undefined;
  const currentDefinition =
    currentDefinitionId && workspace.objects[currentDefinitionId]?.type === "designDefinition"
      ? workspace.objects[currentDefinitionId]
      : undefined;
  const definitionId = currentDefinition?.id ?? nextRecordId(workspace.objects, `design-definition-${proposal.id}`);
  const previousRevisionId = currentDefinition?.currentRevisionId;
  const previousRevision =
    previousRevisionId && workspace.designDefinitionRevisions[previousRevisionId]
      ? workspace.designDefinitionRevisions[previousRevisionId]
      : undefined;
  const revisionNumber = previousRevision ? previousRevision.revisionNumber + 1 : 1;
  const revisionId = nextRecordId(workspace.designDefinitionRevisions, `definition-revision-${definitionId}-${revisionNumber}`);

  const nextRevisions = {
    ...workspace.designDefinitionRevisions
  };
  if (previousRevision) {
    nextRevisions[previousRevision.id] = {
      ...previousRevision,
      isCurrent: false
    };
  }

  const revision: DesignDefinitionRevision = {
    id: revisionId,
    designDefinitionId: definitionId,
    revisionNumber,
    title: proposal.title,
    summary: proposal.summary,
    projectGoal: proposal.projectGoal,
    targetUsers: [...proposal.targetUsers],
    primaryScenarios: [...proposal.primaryScenarios],
    coreProblem: proposal.coreProblem,
    designPrinciples: [...proposal.designPrinciples],
    constraints: [...proposal.constraints],
    avoidDirections: [...proposal.avoidDirections],
    opportunities: [...proposal.opportunities],
    openQuestions: [...proposal.openQuestions],
    sourceObjectIds: [...proposal.sourceObjectIds],
    citationIds: [...proposal.citationIds],
    createdAt: now,
    previousRevisionId,
    changeNote: proposal.changeNote,
    isCurrent: true
  };
  nextRevisions[revisionId] = revision;

  const designDefinitionObject: DesignDefinitionObject = {
    id: definitionId,
    type: "designDefinition",
    title: proposal.title,
    summary: proposal.summary,
    createdBy: "ai",
    visibility: currentDefinition?.visibility ?? "active",
    problem: proposal.coreProblem,
    principles: [...proposal.designPrinciples],
    avoid: [...proposal.avoidDirections],
    currentRevisionId: revisionId,
    revisionIds: [...(currentDefinition?.revisionIds ?? []), revisionId],
    isCurrentEffective: true,
    createdAt: currentDefinition?.createdAt ?? now,
    updatedAt: now
  };

  const nextObjects = {
    ...workspace.objects,
    [definitionId]: designDefinitionObject
  };
  const nextRelations = workspace.relations.filter(
    (relation) => !(relation.kind === "supports" && relation.toObjectId === definitionId)
  );
  for (const sourceObjectId of proposal.sourceObjectIds) {
    if (!workspace.objects[sourceObjectId]) {
      continue;
    }
    nextRelations.push({
      id: nextRecordId(
        Object.fromEntries(nextRelations.map((relation) => [relation.id, relation])),
        `rel-${sourceObjectId}-${definitionId}-supports`
      ),
      kind: "supports",
      fromObjectId: sourceObjectId,
      toObjectId: definitionId,
      note: "该来源对象被保留为当前设计定义的依据。"
    });
  }

  const appliedProposal: DesignDefinitionProposal = {
    ...proposal,
    status: "applied",
    appliedObjectId: definitionId
  };

  return {
    status: "updated",
    designDefinitionObject,
    revision,
    workspace: reconcileWorkspaceDerivedState({
      ...workspace,
      objects: nextObjects,
      relations: nextRelations,
      designDefinitionRevisions: nextRevisions,
      artifactProposals: {
        ...workspace.artifactProposals,
        [proposal.id]: appliedProposal
      },
      decisionRecords: [
        ...workspace.decisionRecords,
        {
          id: `decision-apply-design-definition-${workspace.decisionRecords.length + 1}`,
          kind: "applyDesignDefinition",
          createdAt: now,
          summary: `应用设计定义：${proposal.title}`,
          reason: proposal.changeNote,
          objectSnapshot: {
            id: definitionId,
            type: "designDefinition",
            title: proposal.title
          },
          relatedObjectIds: proposal.sourceObjectIds
        }
      ],
      ui: {
        ...workspace.ui,
        lastSelectionIds: [definitionId]
      }
    })
  };
}

export function recordConceptDirectionProposal(
  workspace: MorphoWorkspace,
  input: RecordConceptDirectionProposalInput
): RecordConceptDirectionProposalResult {
  const now = new Date().toISOString();
  const proposalId =
    input.proposalId && !workspace.artifactProposals[input.proposalId]
      ? input.proposalId
      : nextRecordId(workspace.artifactProposals, `proposal-direction-${Date.now()}`);
  const citationEntries = materializeCitationSnapshots(workspace, proposalId, input.operationId, input.citations, now);
  const proposal: ConceptDirectionProposal = {
    id: proposalId,
    type: "conceptDirection",
    operationId: input.operationId,
    status: "pending",
    reviewState: "ready",
    sourceObjectIds: [...input.sourceObjectIds],
    citationIds: citationEntries.map((citation) => citation.id),
    createdAt: now,
    title: input.title,
    summary: input.summary,
    directions: input.directions.map((direction) => ({
      ...direction,
      keywords: [...direction.keywords],
      differentiators: [...direction.differentiators],
      visualSignals: [...direction.visualSignals],
      risks: [...direction.risks],
      openQuestions: [...direction.openQuestions]
    })),
    basedOnDesignDefinitionId: input.basedOnDesignDefinitionId,
    basedOnRevisionId: input.basedOnRevisionId
  };

  return {
    proposal,
    workspace: {
      ...workspace,
      artifactProposals: {
        ...workspace.artifactProposals,
        [proposal.id]: proposal
      },
      citationSnapshots: {
        ...workspace.citationSnapshots,
        ...Object.fromEntries(citationEntries.map((citation) => [citation.id, citation]))
      }
    }
  };
}

export function applyConceptDirectionProposal(
  workspace: MorphoWorkspace,
  proposalId: string,
  input: { position: CanvasPoint }
): ApplyConceptDirectionProposalResult {
  const proposal = workspace.artifactProposals[proposalId];
  if (!proposal || proposal.type !== "conceptDirection") {
    return {
      status: "blocked",
      workspace,
      reason: "概念方向草案不存在。"
    };
  }

  if (proposal.status !== "pending") {
    return {
      status: "blocked",
      workspace,
      reason: "概念方向草案已被处理。"
    };
  }

  if (proposal.directions.length === 0) {
    return {
      status: "blocked",
      workspace,
      reason: "概念方向草案没有可保存的方向。"
    };
  }

  const now = new Date().toISOString();
  const conceptReview = evaluateConceptDirectionProposalReviewState(workspace, proposal);
  if (conceptReview) {
    return {
      status: "blocked",
      workspace: updateProposalReviewState(workspace, proposal.id, conceptReview.state),
      reason: conceptReview.reason
    };
  }

  const nextObjects = { ...workspace.objects };
  const nextRelations = [...workspace.relations];
  const nextInstances = [...workspace.canvas.instances];
  const nextDirectionRevisions = { ...workspace.directionRevisions };
  const nextLineage = [...workspace.directionLineage];
  const createdDirections: ConceptDirectionObject[] = [];

  for (const [index, draft] of proposal.directions.entries()) {
    const directionId = nextRecordId(nextObjects, `direction-${proposal.id}-${index + 1}`);
    const revisionId = nextRecordId(nextDirectionRevisions, `direction-revision-${directionId}-1`);
    const sourceDirection =
      draft.basedOnDirectionId && nextObjects[draft.basedOnDirectionId]?.type === "conceptDirection"
        ? nextObjects[draft.basedOnDirectionId]
        : undefined;
    const lineageRootId =
      sourceDirection?.type === "conceptDirection" ? sourceDirection.lineageRootId : directionId;
    const directionObject: ConceptDirectionObject = {
      id: directionId,
      type: "conceptDirection",
      title: draft.title,
      summary: draft.summary,
      createdBy: "ai",
      visibility: "active",
      status: "pendingPreview",
      keywords: [...draft.keywords],
      currentRevisionId: revisionId,
      revisionIds: [revisionId],
      lineageRootId,
      createdAt: now,
      updatedAt: now
    };
    nextObjects[directionId] = directionObject;
    nextDirectionRevisions[revisionId] = {
      id: revisionId,
      directionId,
      revisionNumber: 1,
      title: draft.title,
      summary: draft.summary,
      conceptStatement: draft.conceptStatement,
      keywords: [...draft.keywords],
      strategy: draft.strategy,
      differentiators: [...draft.differentiators],
      visualSignals: [...draft.visualSignals],
      risks: [...draft.risks],
      openQuestions: [...draft.openQuestions],
      sourceObjectIds: [...proposal.sourceObjectIds],
      citationIds: [...proposal.citationIds],
      basedOnDefinitionRevisionId: proposal.basedOnRevisionId,
      createdAt: now,
      isCurrent: true
    };
    nextInstances.push({
      id: nextRecordId(
        Object.fromEntries(nextInstances.map((instance) => [instance.id, instance])),
        `canvas-${directionId}`
      ),
      objectId: directionId,
      position: {
        x: input.position.x + index * 300,
        y: input.position.y
      },
      size: { w: 270, h: 184 }
    });

    if (proposal.basedOnDesignDefinitionId && workspace.objects[proposal.basedOnDesignDefinitionId]) {
      nextRelations.push({
        id: nextRecordId(
          Object.fromEntries(nextRelations.map((relation) => [relation.id, relation])),
          `rel-${proposal.basedOnDesignDefinitionId}-${directionId}-supports`
        ),
        kind: "supports",
        fromObjectId: proposal.basedOnDesignDefinitionId,
        toObjectId: directionId,
        note: "该方向基于当前设计定义草案保存。"
      });
    }

    if (draft.basedOnDirectionId && draft.lineageKind && workspace.objects[draft.basedOnDirectionId]) {
      nextLineage.push({
        id: nextRecordId(
          Object.fromEntries(nextLineage.map((record) => [record.id, record])),
          `direction-lineage-${draft.basedOnDirectionId}-${directionId}`
        ),
        kind: draft.lineageKind,
        fromDirectionId: draft.basedOnDirectionId,
        toDirectionId: directionId,
        createdAt: now,
        note: `${draft.title} 由已存在方向延展而来。`
      });
    }

    createdDirections.push(directionObject);
  }

  const appliedProposal: ConceptDirectionProposal = {
    ...proposal,
    status: "applied",
    appliedObjectId: createdDirections[0]?.id
  };

  return {
    status: "updated",
    directions: createdDirections,
    workspace: reconcileWorkspaceDerivedState({
      ...workspace,
      objects: nextObjects,
      relations: nextRelations,
      directionRevisions: nextDirectionRevisions,
      directionLineage: nextLineage,
      artifactProposals: {
        ...workspace.artifactProposals,
        [proposal.id]: appliedProposal
      },
      decisionRecords: [
        ...workspace.decisionRecords,
        {
          id: `decision-apply-concept-direction-${workspace.decisionRecords.length + 1}`,
          kind: "applyConceptDirection",
          createdAt: now,
          summary: `保存概念方向：${proposal.title}`,
          objectSnapshot: createdDirections[0]
            ? {
                id: createdDirections[0].id,
                type: "conceptDirection",
                title: createdDirections[0].title
              }
            : undefined,
          relatedObjectIds: createdDirections.map((direction) => direction.id)
        }
      ],
      canvas: {
        ...workspace.canvas,
        instances: nextInstances
      },
      ui: {
        ...workspace.ui,
        lastSelectionIds: createdDirections.map((direction) => direction.id)
      }
    })
  };
}

export function applyResearchAnalysisProposal(
  workspace: MorphoWorkspace,
  proposalId: string,
  input: { position: CanvasPoint }
): ApplyResearchProposalResult {
  const proposal = workspace.artifactProposals[proposalId];
  if (!proposal || proposal.type !== "researchAnalysis") {
    return {
      status: "blocked",
      workspace,
      reason: "研究分析草案不存在。"
    };
  }

  if (proposal.status !== "pending") {
    return {
      status: "blocked",
      workspace,
      reason: "研究分析草案已被处理。"
    };
  }

  const objectId = nextRecordId(workspace.objects, `research-${proposal.id}`);
  const instanceId = nextRecordId(
    Object.fromEntries(workspace.canvas.instances.map((instance) => [instance.id, instance])),
    `canvas-${objectId}`
  );
  const researchObject: ResearchObject = {
    id: objectId,
    type: "research",
    title: proposal.title,
    summary: proposal.summary,
    createdBy: "ai",
    visibility: "active",
    findings: [...proposal.findings],
    opportunities: [...proposal.opportunities],
    constraints: [...proposal.constraints],
    openQuestions: [...proposal.openQuestions],
    evidence: [...proposal.evidence],
    provenance: {
      operationId: proposal.operationId,
      proposalId: proposal.id,
      sourceObjectIds: [...proposal.sourceObjectIds],
      citationIds: [...proposal.citationIds],
      didUseWebSearch: proposal.citationIds.length > 0
    }
  };
  const relations: MorphoRelation[] = proposal.sourceObjectIds
    .filter((sourceObjectId) => Boolean(workspace.objects[sourceObjectId]))
    .map((sourceObjectId, index) => ({
      id: nextRecordId(
        Object.fromEntries([...workspace.relations, ...relationsBefore(index, proposal.sourceObjectIds, objectId)].map((relation) => [relation.id, relation])),
        `rel-${sourceObjectId}-${objectId}-source`
      ),
      kind: "source" as const,
      fromObjectId: sourceObjectId,
      toObjectId: objectId,
      note: "研究分析由该来源对象参与形成。"
    }));
  const appliedProposal: ResearchAnalysisProposal = {
    ...proposal,
    status: "applied",
    appliedObjectId: objectId
  };
  const operation = workspace.operations[proposal.operationId];
  const now = new Date().toISOString();

  return {
    status: "updated",
    researchObject,
    workspace: reconcileWorkspaceDerivedState({
      ...workspace,
      objects: {
        ...workspace.objects,
        [objectId]: researchObject
      },
      artifactProposals: {
        ...workspace.artifactProposals,
        [proposal.id]: appliedProposal
      },
      operations: operation
        ? {
            ...workspace.operations,
            [operation.id]: {
              ...operation,
              status: "succeeded",
              updatedAt: now,
              retryable: false
            }
          }
        : workspace.operations,
      relations: [...workspace.relations, ...relations],
      canvas: {
        ...workspace.canvas,
        instances: [
          ...workspace.canvas.instances,
          {
            id: instanceId,
            objectId,
            position: input.position,
            size: { w: 320, h: 210 }
          }
        ]
      },
      ui: {
        ...workspace.ui,
        lastSelectionIds: [objectId]
      }
    })
  };
}

export function detectResearchSourceChanges(workspace: MorphoWorkspace, operationId: string): string | undefined {
  const operation = workspace.operations[operationId];
  if (!operation) {
    return undefined;
  }

  const changed: string[] = [];
  for (const snapshot of operation.inputSnapshot.objectSnapshots) {
    const current = workspace.objects[snapshot.id];
    if (!current) {
      changed.push(`${snapshot.title} 已被删除`);
      continue;
    }

    if (current.visibility === "hidden") {
      changed.push(`${snapshot.title} 已被隐藏`);
    }

    if (current.title !== snapshot.title || current.summary !== snapshot.summary) {
      changed.push(`${snapshot.title} 的标题或摘要已变化`);
    }

    if (snapshot.body !== undefined && (!("body" in current) || current.body !== snapshot.body)) {
      changed.push(`${snapshot.title} 的正文可能已变化`);
    }
  }

  return changed.length > 0 ? `来源已变化，保存前请复核：${changed.join("；")}` : undefined;
}

function evaluateDesignDefinitionProposalReviewState(
  workspace: MorphoWorkspace,
  proposal: DesignDefinitionProposal
): { state: ProposalReviewState; reason: string } | null {
  const baseDefinition = resolveBaseDesignDefinition(workspace, proposal.basedOnDesignDefinitionId);
  if (proposal.basedOnDesignDefinitionId && !baseDefinition) {
    return {
      state: "targetUnavailable",
      reason: "设计定义草案引用的原定义已不可用，请重新生成或重新确认后再保存。"
    };
  }

  if (proposal.basedOnRevisionId && baseDefinition && baseDefinition.currentRevisionId !== proposal.basedOnRevisionId) {
    return {
      state: "baseSuperseded",
      reason: "设计定义草案基于的版本已被新的定义版本替代，请复核后再保存。"
    };
  }

  if (proposal.sourceObjectIds.some((sourceObjectId) => !isVisibleSourceObject(workspace, sourceObjectId))) {
    return {
      state: "sourceChanged",
      reason: "设计定义草案的来源对象已被隐藏或删除，请复核来源后再保存。"
    };
  }

  return null;
}

function evaluateConceptDirectionProposalReviewState(
  workspace: MorphoWorkspace,
  proposal: ConceptDirectionProposal
): { state: ProposalReviewState; reason: string } | null {
  const baseDefinition = resolveBaseDesignDefinition(workspace, proposal.basedOnDesignDefinitionId);
  if (proposal.basedOnDesignDefinitionId && !baseDefinition) {
    return {
      state: "targetUnavailable",
      reason: "概念方向草案引用的设计定义已不可用，请重新生成或重新确认后再保存。"
    };
  }

  if (proposal.basedOnRevisionId && baseDefinition && baseDefinition.currentRevisionId !== proposal.basedOnRevisionId) {
    return {
      state: "baseSuperseded",
      reason: "概念方向草案基于的设计定义版本已被替代，请复核后再保存。"
    };
  }

  if (proposal.sourceObjectIds.some((sourceObjectId) => !isVisibleSourceObject(workspace, sourceObjectId))) {
    return {
      state: "sourceChanged",
      reason: "概念方向草案的来源对象已被隐藏或删除，请复核来源后再保存。"
    };
  }

  if (
    proposal.directions.some(
      (direction) =>
        direction.basedOnDirectionId &&
        (workspace.objects[direction.basedOnDirectionId]?.type !== "conceptDirection" ||
          workspace.objects[direction.basedOnDirectionId]?.visibility !== "active")
    )
  ) {
    return {
      state: "targetUnavailable",
      reason: "概念方向草案引用的原方向已不可用，请重新生成或重新确认后再保存。"
    };
  }

  return null;
}

function resolveBaseDesignDefinition(
  workspace: MorphoWorkspace,
  explicitDefinitionId?: string
): DesignDefinitionObject | undefined {
  const definitionId = explicitDefinitionId ?? workspace.workingState.currentDesignDefinitionId;
  if (!definitionId) {
    return undefined;
  }

  const definition = workspace.objects[definitionId];
  if (definition?.type !== "designDefinition" || definition.visibility !== "active") {
    return undefined;
  }

  return definition;
}

function updateProposalReviewState(
  workspace: MorphoWorkspace,
  proposalId: string,
  reviewState: ProposalReviewState
): MorphoWorkspace {
  const proposal = workspace.artifactProposals[proposalId];
  if (!proposal) {
    return workspace;
  }

  return {
    ...workspace,
    artifactProposals: {
      ...workspace.artifactProposals,
      [proposalId]: {
        ...proposal,
        reviewState
      }
    }
  };
}

function isVisibleSourceObject(workspace: MorphoWorkspace, objectId: string): boolean {
  const object = workspace.objects[objectId];
  return Boolean(object && object.visibility === "active");
}

function relationsBefore(index: number, sourceObjectIds: string[], objectId: string): MorphoRelation[] {
  return sourceObjectIds.slice(0, index).map((sourceObjectId) => ({
    id: `rel-${sourceObjectId}-${objectId}-source`,
    kind: "source",
    fromObjectId: sourceObjectId,
    toObjectId: objectId,
    note: "研究分析由该来源对象参与形成。"
  }));
}

function materializeCitationSnapshots(
  workspace: MorphoWorkspace,
  proposalId: string,
  operationId: string | undefined,
  citations: Array<{
    title: string;
    url?: string;
    domain?: string;
    snippet?: string;
  }>,
  now: string
): SourceCitation[] {
  return citations.map((citation, index): SourceCitation => {
    const id = nextRecordId(workspace.citationSnapshots, `${proposalId}-citation-${index + 1}`);
    return {
      id,
      operationId: operationId ?? proposalId,
      title: citation.title,
      url: citation.url,
      domain: citation.domain ?? domainFromUrl(citation.url),
      snippet: citation.snippet,
      retrievedAt: now
    };
  });
}

function isActiveOperationStatus(status: OperationRecord["status"]): boolean {
  return status === "queued" || status === "preparing" || status === "running" || status === "waiting_for_user";
}

function nextRecordId(record: Record<string, unknown>, preferredId: string): string {
  if (!record[preferredId]) {
    return preferredId;
  }

  let suffix = 2;
  while (record[`${preferredId}-${suffix}`]) {
    suffix += 1;
  }

  return `${preferredId}-${suffix}`;
}

function domainFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
