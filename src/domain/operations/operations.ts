import type {
  CanvasInstance,
  CanvasPoint,
  ConceptDirectionObject,
  DesignDefinitionObject,
  DesignDefinitionRevision,
  MorphoObject,
  MorphoRelation,
  MorphoWorkspace,
  ProposalDraftObject,
  ResearchObject
} from "../morpho/types";
import { reconcileWorkspaceDerivedState } from "../morpho/derivedState";
import { applyProjectContinuityEvent } from "../morpho/projectContinuity";
import type {
  ConceptDirectionProposal,
  DesignDefinitionProposal,
  ArtifactProposal,
  ImageGenerationOperationMetadata,
  OperationRecord,
  OperationStatus,
  ProposalReviewDetails,
  ProposalReviewState,
  ResearchEvidence,
  ResearchAnalysisProposal,
  SourceSemanticSnapshot,
  SourceCitation
} from "./types";

const DESIGN_DEFINITION_CANDIDATE_STACK_SLOT_HEIGHT = 288;
const DESIGN_DEFINITION_CANDIDATE_GAP = 32;
const DESIGN_DEFINITION_BATCH_ALIGNMENT_TOLERANCE = 24;
const CONCEPT_DIRECTION_CARD_WIDTH = 320;
const CONCEPT_DIRECTION_CARD_GAP = 32;

export type CreateResearchOperationInput = {
  userInput: string;
  selectedObjectIds: string[];
  allowWebSearch: boolean;
};

export type CreateArtifactProposalOperationInput = {
  operationId?: string;
  type: "designDefinition" | "conceptDirection";
  userInput: string;
  selectedObjectIds: string[];
  workIntent?: string;
};

export type CreateResearchOperationResult = {
  workspace: MorphoWorkspace;
  operation: OperationRecord;
};

export type RecordResearchProposalInput = {
  proposalId?: string;
  operationId: string;
  workIntent?: ResearchAnalysisProposal["workIntent"];
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
  position?: { x: number; y: number };
};

export type RecordResearchProposalResult = {
  workspace: MorphoWorkspace;
  proposal: ResearchAnalysisProposal;
};

export type RecordDesignDefinitionProposalInput = {
  proposalId?: string;
  operationId?: string;
  workIntent?: DesignDefinitionProposal["workIntent"];
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
  position?: { x: number; y: number };
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
  workIntent?: ConceptDirectionProposal["workIntent"];
  applicationMode?: ConceptDirectionProposal["applicationMode"];
  targetDirectionId?: string;
  parentDirectionIds?: string[];
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
  position?: { x: number; y: number };
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

export type RecordAndApplyConceptDirectionProposalResult =
  | {
      status: "updated";
      workspace: MorphoWorkspace;
      proposal: ConceptDirectionProposal;
      directions: ConceptDirectionObject[];
    }
  | {
      status: "blocked";
      workspace: MorphoWorkspace;
      proposal: ConceptDirectionProposal;
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

type ApplyProposalOptions = {
  allowSourceChanged?: boolean;
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

export type RecordImageGenerationOperationResultInput = {
  operationId: string;
  providerTaskId?: string;
  resultObjectId: string;
};

export type RecordImageGenerationOperationItemFailureInput = {
  operationId: string;
  planItemId: string;
  reason: string;
};

export type MarkImageGenerationOperationSubmittedInput = {
  operationId: string;
  referenceObjectIds: string[];
  imagePixels: boolean;
};

export type RecordImageGenerationPlanInput = {
  operationId: string;
  plan: NonNullable<ImageGenerationOperationMetadata["plan"]>;
};

export type FailImageGenerationOperationInput = {
  operationId: string;
  status: Extract<OperationStatus, "failed" | "cancelled" | "interrupted">;
  reason: string;
  providerTaskId?: string;
};

export type FailOperationInput = {
  status: Extract<OperationStatus, "failed" | "cancelled" | "interrupted">;
  reason: string;
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
      sourceSnapshots: buildSourceSemanticSnapshots(workspace, input.selectedObjectIds),
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

export function createArtifactProposalOperation(
  workspace: MorphoWorkspace,
  input: CreateArtifactProposalOperationInput
): { workspace: MorphoWorkspace; operation: OperationRecord } {
  const now = new Date().toISOString();
  const operationId = input.operationId ?? nextRecordId(workspace.operations, `operation-${input.type}-${Date.now()}`);
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
    type: input.type,
    projectId: workspace.project.id,
    createdAt: now,
    updatedAt: now,
    status: "running",
    userInput: input.userInput,
    inputSnapshot: {
      userInput: input.userInput,
      selectedObjectIds: [...input.selectedObjectIds],
      sourceSnapshots: buildSourceSemanticSnapshots(workspace, input.selectedObjectIds),
      objectSnapshots
    },
    allowedCapabilities: {
      webSearch: false,
      imagePixels: false
    },
    steps: [
      {
        id: `${operationId}-step-input`,
        kind: "inputSnapshot",
        status: "succeeded",
        summary: "已保存本次语义草案任务的输入快照。",
        createdAt: now
      },
      {
        id: `${operationId}-step-model`,
        kind: "modelSynthesis",
        status: "succeeded",
        summary: "已进入模型综合阶段，等待草案生成结果。",
        createdAt: now
      }
    ],
    events: [
      {
        id: `${operationId}-event-created`,
        createdAt: now,
        summary: "语义草案任务已创建。"
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
  const blocking = Object.values(workspace.operations).find((operation) => isBlockingOperationStatus(operation.status));
  if (!blocking) {
    return { status: "ok" };
  }

  return {
    status: "blocked",
    operation: blocking,
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
      sourceSnapshots: buildSourceSemanticSnapshots(workspace, input.selectedObjectIds),
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
      directionObjectId: input.directionObjectId,
      visualBranchId: input.visualBranchId,
      requestedPreviewCount: input.requestedPreviewCount,
      plan: input.plan,
      resultObjectIds: []
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
          resultObjectId: input.resultObjectId,
          resultObjectIds: appendUnique(operation.imageGeneration.resultObjectIds ?? [], input.resultObjectId)
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

  const updatedWorkspace: MorphoWorkspace = {
    ...workspace,
    operations: {
      ...workspace.operations,
      [operation.id]: updatedOperation
    }
  };
  const successfulResultObjectIds = (updatedOperation.imageGeneration?.resultObjectIds ?? []).filter((objectId) =>
    Boolean(updatedWorkspace.objects[objectId])
  );
  if (successfulResultObjectIds.length === 0) {
    return updatedWorkspace;
  }

  return applyProjectContinuityEvent(updatedWorkspace, {
    type: "visualGenerationCompleted",
    operationId: operation.id,
    resultObjectIds: successfulResultObjectIds,
    sourceObjectIds: [
      ...(updatedOperation.imageGeneration?.referenceObjectIds ?? []),
      ...(updatedOperation.imageGeneration?.directionObjectId ? [updatedOperation.imageGeneration.directionObjectId] : [])
    ],
    definitionRevisionId: getCurrentDesignDefinitionRevisionId(updatedWorkspace),
    branchId: updatedOperation.imageGeneration?.visualBranchId,
    successCount: successfulResultObjectIds.length,
    failureCount: updatedOperation.imageGeneration?.failedItems?.length ?? 0,
    createdAt: now
  });
}

export function recordImageGenerationOperationResult(
  workspace: MorphoWorkspace,
  input: RecordImageGenerationOperationResultInput
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
    imageGeneration: operation.imageGeneration
      ? {
          ...operation.imageGeneration,
          providerTaskId: input.providerTaskId ?? operation.imageGeneration.providerTaskId,
          resultObjectId: input.resultObjectId,
          resultObjectIds: appendUnique(operation.imageGeneration.resultObjectIds ?? [], input.resultObjectId)
        }
      : undefined,
    steps: [
      ...operation.steps,
      {
        id: `${operation.id}-step-asset-${operation.steps.length + 1}`,
        kind: "assetSave",
        status: "succeeded",
        summary: `已保存生成结果 ${input.resultObjectId} 为独立本地资产和新图像对象。`,
        createdAt: now
      }
    ],
    events: [
      ...operation.events,
      {
        id: `${operation.id}-event-result-${operation.events.length + 1}`,
        createdAt: now,
        summary: `图像生成结果已保存：${input.resultObjectId}。`
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

export function recordImageGenerationOperationItemFailure(
  workspace: MorphoWorkspace,
  input: RecordImageGenerationOperationItemFailureInput
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
    imageGeneration: operation.imageGeneration
      ? {
          ...operation.imageGeneration,
          failedItems: [
            ...(operation.imageGeneration.failedItems ?? []),
            {
              planItemId: input.planItemId,
              reason: input.reason
            }
          ]
        }
      : undefined,
    steps: [
      ...operation.steps,
      {
        id: `${operation.id}-step-item-failed-${operation.steps.length + 1}`,
        kind: "providerWait",
        status: "failed",
        summary: input.reason,
        createdAt: now
      }
    ],
    events: [
      ...operation.events,
      {
        id: `${operation.id}-event-item-failed-${operation.events.length + 1}`,
        createdAt: now,
        summary: `图像计划项失败：${input.planItemId}。${input.reason}`
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

function attachProposalDraftObject(
  workspace: MorphoWorkspace,
  proposal: ArtifactProposal,
  now: string
): MorphoWorkspace {
  const position = proposal.canvasPlacement ?? {
    x: workspace.canvas.view.x + 220,
    y: workspace.canvas.view.y + 180
  };
  const draftObject: ProposalDraftObject = {
    id: proposal.id,
    type: "proposalDraft",
    proposalId: proposal.id,
    proposalType: proposal.type,
    title: proposal.title,
    summary: proposal.summary,
    createdBy: "ai",
    visibility: "active",
    createdAt: now,
    updatedAt: now
  };
  const hasInstance = workspace.canvas.instances.some((instance) => instance.objectId === proposal.id);

  return {
    ...workspace,
    objects: {
      ...workspace.objects,
      [proposal.id]: draftObject
    },
    canvas: {
      ...workspace.canvas,
      instances: hasInstance
        ? workspace.canvas.instances
        : [
            ...workspace.canvas.instances,
            {
              id: nextRecordId(
                Object.fromEntries(workspace.canvas.instances.map((instance) => [instance.id, instance])),
                `canvas-${proposal.id}`
              ),
              objectId: proposal.id,
              position,
              size: proposal.type === "conceptDirection" ? { w: 360, h: 168 } : { w: 340, h: 168 }
            }
          ]
    }
  };
}

function removeProposalDraftObject(workspace: MorphoWorkspace, proposalId: string): MorphoWorkspace {
  if (!workspace.objects[proposalId] && !workspace.canvas.instances.some((instance) => instance.objectId === proposalId)) {
    return workspace;
  }

  const { [proposalId]: _removed, ...objects } = workspace.objects;
  return {
    ...workspace,
    objects,
    canvas: {
      ...workspace.canvas,
      instances: workspace.canvas.instances.filter((instance) => instance.objectId !== proposalId)
    }
  };
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
    workIntent: input.workIntent,
    status: "pending",
    title: input.title,
    summary: input.summary,
    findings: [...input.findings],
    opportunities: [...input.opportunities],
    constraints: [...input.constraints],
    openQuestions: [...input.openQuestions],
    evidence,
    sourceObjectIds: [...input.sourceObjectIds],
    sourceSnapshots: buildSourceSemanticSnapshots(workspace, input.sourceObjectIds),
    citationIds: citationEntries.map((citation) => citation.id),
    sourceChangedWarning: input.sourceChangedWarning,
    createdAt: now,
    canvasPlacement: input.position,
    reviewState: input.sourceChangedWarning ? "sourceChanged" : "ready"
  };
  const workspaceWithDraftObject = attachProposalDraftObject(workspace, proposal, now);
  const updatedOperation: OperationRecord | undefined = operation
    ? {
        ...operation,
        status: "succeeded",
        updatedAt: now,
        retryable: false,
        proposalIds: [...operation.proposalIds, proposal.id],
        steps: [
          ...operation.steps,
          {
            id: `${operation.id}-step-proposal-${operation.steps.length + 1}`,
            kind: "proposal",
            status: "succeeded",
            summary: "研究分析草案已放到画布，可稍后查看、应用、修改或放弃。",
            createdAt: now
          }
        ]
      }
    : undefined;

  return {
    proposal,
    workspace: {
      ...workspaceWithDraftObject,
      operations: updatedOperation
        ? {
            ...workspace.operations,
            [updatedOperation.id]: updatedOperation
          }
        : workspace.operations,
      artifactProposals: {
        ...workspaceWithDraftObject.artifactProposals,
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
    workIntent: input.workIntent,
    status: "pending",
    reviewState: "ready",
    sourceObjectIds: [...input.sourceObjectIds],
    sourceSnapshots: buildSourceSemanticSnapshots(workspace, input.sourceObjectIds),
    citationIds: citationEntries.map((citation) => citation.id),
    createdAt: now,
    canvasPlacement: input.position,
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
  const workspaceWithDraftObject = attachProposalDraftObject(workspace, proposal, now);
  const updatedOperation = input.operationId
    ? markProposalOperationCompleted(workspace.operations[input.operationId], proposal.id, now, "设计定义草案已放到画布，可稍后查看、应用、修改或放弃。")
    : undefined;

  return {
    proposal,
    workspace: {
      ...workspaceWithDraftObject,
      operations: updatedOperation
        ? {
            ...workspace.operations,
            [updatedOperation.id]: updatedOperation
          }
        : workspace.operations,
      artifactProposals: {
        ...workspaceWithDraftObject.artifactProposals,
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
  proposalId: string,
  options: ApplyProposalOptions = {}
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
  if (designReview && (designReview.state !== "sourceChanged" || !options.allowSourceChanged)) {
    return {
      status: "blocked",
      workspace: updateProposalReviewState(workspace, proposal.id, designReview.state, designReview.details),
      reason: designReview.reason
    };
  }

  const shouldReviseExistingDefinition = proposal.workIntent !== "createDesignDefinition";
  const currentDefinitionId = shouldReviseExistingDefinition
    ? proposal.basedOnDesignDefinitionId &&
      workspace.objects[proposal.basedOnDesignDefinitionId]?.type === "designDefinition"
      ? proposal.basedOnDesignDefinitionId
      : workspace.workingState.currentDesignDefinitionId &&
          workspace.objects[workspace.workingState.currentDesignDefinitionId]?.type === "designDefinition"
        ? workspace.workingState.currentDesignDefinitionId
        : undefined
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

  const { [proposal.id]: _removedProposalDraft, ...objectsWithoutProposalDraft } = workspace.objects;
  const objectsWithInactiveDefinitions = Object.fromEntries(
    Object.entries(objectsWithoutProposalDraft).map(([objectId, object]) => [
      objectId,
      object.type === "designDefinition" && object.isCurrentEffective
        ? {
            ...object,
            isCurrentEffective: false
          }
        : object
    ])
  );
  const nextObjects = {
    ...objectsWithInactiveDefinitions,
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
  const nextArtifactProposals = {
    ...workspace.artifactProposals,
    [proposal.id]: appliedProposal
  };
  const proposalDraftInstance = workspace.canvas.instances.find((instance) => instance.objectId === proposal.id);
  const canvasInstancesWithoutProposalDraft = workspace.canvas.instances.filter((instance) => instance.objectId !== proposal.id);
  const appliedPosition =
    proposalDraftInstance?.position ??
    proposal.canvasPlacement ??
    {
      x: workspace.canvas.view.x + 220,
      y: workspace.canvas.view.y + 180
    };
  const nextCanvasInstances = canvasInstancesWithoutProposalDraft.some((instance) => instance.objectId === definitionId)
    ? canvasInstancesWithoutProposalDraft
    : [
        ...canvasInstancesWithoutProposalDraft,
        {
          id: nextRecordId(
            Object.fromEntries(workspace.canvas.instances.map((instance) => [instance.id, instance])),
            `canvas-${definitionId}`
          ),
          objectId: definitionId,
          position: appliedPosition,
          size: {
            w: Math.max(proposalDraftInstance?.size.w ?? 320, 340),
            h: Math.max(proposalDraftInstance?.size.h ?? 210, 210)
          }
        }
      ];
  const reflowedCanvasInstances = reflowDesignDefinitionCandidateBatch({
    instances: nextCanvasInstances,
    objects: nextObjects,
    proposals: nextArtifactProposals,
    operationId: proposal.operationId
  });

  return {
    status: "updated",
    designDefinitionObject,
    revision,
    workspace: applyProjectContinuityEvent(reconcileWorkspaceDerivedState({
      ...workspace,
      objects: nextObjects,
      relations: nextRelations,
      designDefinitionRevisions: nextRevisions,
      operations: markProposalOperationFinal(workspace.operations, proposal.operationId, "succeeded", now, "设计定义草案已应用。"),
      artifactProposals: nextArtifactProposals,
      canvas: {
        ...workspace.canvas,
        instances: reflowedCanvasInstances
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
    }), {
      type: "designDefinitionApplied",
      designDefinitionObjectId: definitionId,
      revisionId,
      sourceObjectIds: proposal.sourceObjectIds,
      proposalId: proposal.id,
      operationId: proposal.operationId,
      citationIds: proposal.citationIds,
      createdAt: now
    })
  };
}

export function setCurrentDesignDefinition(
  workspace: MorphoWorkspace,
  designDefinitionId: string,
  reason = "用户明确将该方案设为当前设计定义。"
): MorphoWorkspace {
  const target = workspace.objects[designDefinitionId];
  if (target?.type !== "designDefinition" || target.isCurrentEffective) {
    return workspace;
  }

  const now = new Date().toISOString();
  const previousCurrentDefinitionId = workspace.workingState.currentDesignDefinitionId;
  const objects = Object.fromEntries(
    Object.entries(workspace.objects).map(([objectId, object]) => [
      objectId,
      object.type === "designDefinition"
        ? {
            ...object,
            isCurrentEffective: object.id === designDefinitionId,
            updatedAt: object.id === designDefinitionId ? now : object.updatedAt
          }
        : object
    ])
  );
  const updatedWorkspace = reconcileWorkspaceDerivedState({
    ...workspace,
    objects,
    decisionRecords: [
      ...workspace.decisionRecords,
      {
        id: nextRecordId(
          Object.fromEntries(workspace.decisionRecords.map((record) => [record.id, record])),
          "decision-set-current-design-definition"
        ),
        kind: "applyDesignDefinition",
        createdAt: now,
        summary: `设为当前设计定义：${target.title}`,
        reason,
        objectSnapshot: {
          id: target.id,
          type: target.type,
          title: target.title
        },
        relatedObjectIds: [previousCurrentDefinitionId].filter((id): id is string => Boolean(id))
      }
    ]
  });

  return applyProjectContinuityEvent(updatedWorkspace, {
    type: "designDefinitionApplied",
    designDefinitionObjectId: target.id,
    revisionId: target.currentRevisionId,
    sourceObjectIds: [],
    createdAt: now
  });
}

export function failOperation(workspace: MorphoWorkspace, operationId: string, input: FailOperationInput): MorphoWorkspace {
  const operation = workspace.operations[operationId];
  if (!operation) {
    return workspace;
  }

  const now = new Date().toISOString();
  return {
    ...workspace,
    operations: {
      ...workspace.operations,
      [operationId]: {
        ...operation,
        status: input.status,
        updatedAt: now,
        errorSummary: input.reason,
        retryable: input.status !== "cancelled",
        steps: [
          ...operation.steps,
          {
            id: `${operation.id}-step-${input.status}-${operation.steps.length + 1}`,
            kind: operation.type === "research" ? "webSearch" : "modelSynthesis",
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
      }
    }
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
    workIntent: input.workIntent,
    status: "pending",
    reviewState: "ready",
    sourceObjectIds: [...input.sourceObjectIds],
    sourceSnapshots: buildSourceSemanticSnapshots(workspace, input.sourceObjectIds),
    citationIds: citationEntries.map((citation) => citation.id),
    createdAt: now,
    canvasPlacement: input.position,
    title: input.title,
    summary: input.summary,
    applicationMode: input.applicationMode ?? inferConceptDirectionApplicationMode(input.workIntent),
    targetDirectionId: input.targetDirectionId,
    parentDirectionIds: [...(input.parentDirectionIds ?? [])],
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
  const workspaceWithDraftObject = attachProposalDraftObject(workspace, proposal, now);
  const updatedOperation = input.operationId
    ? markProposalOperationCompleted(workspace.operations[input.operationId], proposal.id, now, "概念方向草案已放到画布，可稍后查看、应用、修改或放弃。")
    : undefined;

  return {
    proposal,
    workspace: {
      ...workspaceWithDraftObject,
      operations: updatedOperation
        ? {
            ...workspace.operations,
            [updatedOperation.id]: updatedOperation
          }
        : workspace.operations,
      artifactProposals: {
        ...workspaceWithDraftObject.artifactProposals,
        [proposal.id]: proposal
      },
      citationSnapshots: {
        ...workspace.citationSnapshots,
        ...Object.fromEntries(citationEntries.map((citation) => [citation.id, citation]))
      }
    }
  };
}

function reflowDesignDefinitionCandidateBatch(input: {
  instances: CanvasInstance[];
  objects: MorphoWorkspace["objects"];
  proposals: MorphoWorkspace["artifactProposals"];
  operationId?: string;
}): CanvasInstance[] {
  if (!input.operationId) {
    return input.instances;
  }

  const candidateObjectIds = new Set(
    Object.values(input.proposals)
      .filter((proposal): proposal is DesignDefinitionProposal =>
        proposal.type === "designDefinition" && proposal.operationId === input.operationId
      )
      .map((proposal) => (proposal.status === "applied" ? proposal.appliedObjectId : proposal.id))
      .filter((objectId): objectId is string => Boolean(objectId))
  );
  const candidates = input.instances
    .filter((instance) => candidateObjectIds.has(instance.objectId))
    .sort(
      (left, right) =>
        left.position.y - right.position.y ||
        left.position.x - right.position.x ||
        left.objectId.localeCompare(right.objectId)
    );

  if (candidates.length < 2) {
    return input.instances;
  }

  const xValues = candidates.map((instance) => instance.position.x);
  if (Math.max(...xValues) - Math.min(...xValues) > DESIGN_DEFINITION_BATCH_ALIGNMENT_TOLERANCE) {
    return input.instances;
  }

  const anchorX = candidates[0].position.x;
  let nextY = candidates[0].position.y;
  const reflowedById = new Map<string, CanvasInstance>();

  for (const instance of candidates) {
    const object = input.objects[instance.objectId];
    const size =
      object?.type === "designDefinition"
        ? {
            w: Math.max(instance.size.w, 340),
            h: instance.size.h
          }
        : instance.size;
    reflowedById.set(instance.id, {
      ...instance,
      position: { x: anchorX, y: nextY },
      size
    });
    nextY +=
      (object?.type === "designDefinition"
        ? Math.max(size.h, DESIGN_DEFINITION_CANDIDATE_STACK_SLOT_HEIGHT)
        : size.h) + DESIGN_DEFINITION_CANDIDATE_GAP;
  }

  return input.instances.map((instance) => reflowedById.get(instance.id) ?? instance);
}

export function recordAndApplyConceptDirectionProposal(
  workspace: MorphoWorkspace,
  input: RecordConceptDirectionProposalInput & { position: CanvasPoint }
): RecordAndApplyConceptDirectionProposalResult {
  const recorded = recordConceptDirectionProposal(workspace, input);
  const applied = applyConceptDirectionProposal(recorded.workspace, recorded.proposal.id, {
    position: input.position
  });

  if (applied.status === "updated") {
    return {
      status: "updated",
      workspace: applied.workspace,
      proposal: applied.workspace.artifactProposals[recorded.proposal.id] as ConceptDirectionProposal,
      directions: applied.directions
    };
  }

  return {
    status: "blocked",
    workspace: applied.workspace,
    proposal: recorded.proposal,
    reason: applied.reason
  };
}

export function applyConceptDirectionProposal(
  workspace: MorphoWorkspace,
  proposalId: string,
  input: { position: CanvasPoint } & ApplyProposalOptions
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
  if (conceptReview && (conceptReview.state !== "sourceChanged" || !input.allowSourceChanged)) {
    return {
      status: "blocked",
      workspace: updateProposalReviewState(workspace, proposal.id, conceptReview.state, conceptReview.details),
      reason: conceptReview.reason
    };
  }

  const { [proposal.id]: _removedProposalDraft, ...objectsWithoutProposalDraft } = workspace.objects;
  const nextObjects = { ...objectsWithoutProposalDraft };
  const nextRelations = [...workspace.relations];
  const nextInstances = workspace.canvas.instances.filter((instance) => instance.objectId !== proposal.id);
  const nextDirectionRevisions = { ...workspace.directionRevisions };
  const nextLineage = [...workspace.directionLineage];
  const appliedDirections: ConceptDirectionObject[] = [];
  let nextDirectionY = input.position.y;
  const applicationMode = proposal.applicationMode;
  const targetObject = proposal.targetDirectionId ? nextObjects[proposal.targetDirectionId] : undefined;
  const targetDirection = targetObject?.type === "conceptDirection" ? targetObject : undefined;
  const parentDirections = proposal.parentDirectionIds
    .map((parentId) => nextObjects[parentId])
    .filter((object): object is ConceptDirectionObject => object?.type === "conceptDirection");
  const applicationValidation = validateConceptDirectionApplication(proposal, targetDirection, parentDirections);
  if (applicationValidation) {
    return {
      status: "blocked",
      workspace,
      reason: applicationValidation
    };
  }

  const createRevisionFromDraft = (
    directionId: string,
    revisionNumber: number,
    draft: ConceptDirectionProposal["directions"][number],
    previousRevisionId?: string
  ) => {
    const revisionId = nextRecordId(nextDirectionRevisions, `direction-revision-${directionId}-${revisionNumber}`);
    nextDirectionRevisions[revisionId] = {
      id: revisionId,
      directionId,
      revisionNumber,
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
      previousRevisionId,
      isCurrent: true
    };
    return revisionId;
  };

  const addCanvasInstance = (
    directionId: string,
    draft: ConceptDirectionProposal["directions"][number]
  ) => {
    const cardSize = estimateConceptDirectionCardSize(draft);
    nextInstances.push({
      id: nextRecordId(
        Object.fromEntries(nextInstances.map((instance) => [instance.id, instance])),
        `canvas-${directionId}`
      ),
      objectId: directionId,
      position: {
        x: input.position.x,
        y: nextDirectionY
      },
      size: cardSize
    });
    nextDirectionY += cardSize.h + CONCEPT_DIRECTION_CARD_GAP;
  };

  const addDefinitionSupportRelation = (directionId: string) => {
    if (!proposal.basedOnDesignDefinitionId || !workspace.objects[proposal.basedOnDesignDefinitionId]) {
      return;
    }

    if (
      nextRelations.some(
        (relation) =>
          relation.kind === "supports" &&
          relation.fromObjectId === proposal.basedOnDesignDefinitionId &&
          relation.toObjectId === directionId
      )
    ) {
      return;
    }

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
  };

  const createDirectionFromDraft = (
    draft: ConceptDirectionProposal["directions"][number],
    index: number,
    lineageRootIdFactory: (directionId: string) => string
  ) => {
    const directionId = nextRecordId(nextObjects, `direction-${proposal.id}-${index + 1}`);
    const revisionId = createRevisionFromDraft(directionId, 1, draft);
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
      lineageRootId: lineageRootIdFactory(directionId),
      createdAt: now,
      updatedAt: now
    };
    nextObjects[directionId] = directionObject;
    addCanvasInstance(directionId, draft);
    addDefinitionSupportRelation(directionId);
    appliedDirections.push(directionObject);
    return directionObject;
  };

  const addDirectionLineage = (
    kind: ConceptDirectionProposal["directions"][number]["lineageKind"],
    fromDirectionId: string,
    toDirectionId: string,
    note: string
  ) => {
    if (!kind) {
      return;
    }

    nextLineage.push({
      id: nextRecordId(
        Object.fromEntries(nextLineage.map((record) => [record.id, record])),
        `direction-lineage-${fromDirectionId}-${toDirectionId}`
      ),
      kind,
      fromDirectionId,
      toDirectionId,
      createdAt: now,
      note
    });
  };

  if (applicationMode === "revise" && targetDirection) {
    const draft = proposal.directions[0];
    const previousRevisionId = targetDirection.currentRevisionId;
    const previousRevision = nextDirectionRevisions[previousRevisionId];
    for (const revision of Object.values(nextDirectionRevisions)) {
      if (revision.directionId === targetDirection.id) {
        revision.isCurrent = false;
      }
    }
    const revisionId = createRevisionFromDraft(
      targetDirection.id,
      (previousRevision?.revisionNumber ?? targetDirection.revisionIds.length) + 1,
      draft,
      previousRevisionId
    );
    const revisedDirection: ConceptDirectionObject = {
      ...targetDirection,
      title: draft.title,
      summary: draft.summary,
      keywords: [...draft.keywords],
      currentRevisionId: revisionId,
      revisionIds: [...targetDirection.revisionIds, revisionId],
      updatedAt: now
    };
    nextObjects[targetDirection.id] = revisedDirection;
    addDefinitionSupportRelation(targetDirection.id);
    appliedDirections.push(revisedDirection);
  } else if (applicationMode === "split" && parentDirections[0]) {
    const parentDirection = parentDirections[0];
    for (const [index, draft] of proposal.directions.entries()) {
      const directionObject = createDirectionFromDraft(draft, index, () => parentDirection.lineageRootId);
      addDirectionLineage(
        "splitFromDirection",
        parentDirection.id,
        directionObject.id,
        `${draft.title} 由“${parentDirection.title}”拆分而来。`
      );
    }
  } else if (applicationMode === "merge") {
    const draft = proposal.directions[0];
    const directionObject = createDirectionFromDraft(draft, 0, (directionId) => directionId);
    for (const parentDirection of parentDirections) {
      nextLineage.push({
        id: nextRecordId(
          Object.fromEntries(nextLineage.map((record) => [record.id, record])),
          `direction-lineage-${parentDirection.id}-${directionObject.id}`
        ),
        kind: "mergedFromDirection",
        fromDirectionId: parentDirection.id,
        toDirectionId: directionObject.id,
        createdAt: now,
        note: `${draft.title} 合并了“${parentDirection.title}”。`
      });
    }
  } else {
    for (const [index, draft] of proposal.directions.entries()) {
      createDirectionFromDraft(draft, index, (directionId) => directionId);
    }
  }

  const appliedProposal: ConceptDirectionProposal = {
    ...proposal,
    status: "applied",
    appliedObjectId: appliedDirections[0]?.id
  };

  return {
    status: "updated",
    directions: appliedDirections,
    workspace: applyProjectContinuityEvent(reconcileWorkspaceDerivedState({
      ...workspace,
      objects: nextObjects,
      relations: nextRelations,
      directionRevisions: nextDirectionRevisions,
      directionLineage: nextLineage,
      operations: markProposalOperationFinal(workspace.operations, proposal.operationId, "succeeded", now, "概念方向草案已应用。"),
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
          summary: buildConceptDirectionDecisionSummary(proposal),
          objectSnapshot: appliedDirections[0]
            ? {
                id: appliedDirections[0].id,
                type: "conceptDirection",
                title: appliedDirections[0].title
              }
            : undefined,
          relatedObjectIds: [
            ...appliedDirections.map((direction) => direction.id),
            ...proposal.parentDirectionIds,
            ...(proposal.targetDirectionId ? [proposal.targetDirectionId] : [])
          ]
        }
      ],
      canvas: {
        ...workspace.canvas,
        instances: nextInstances
      },
      ui: {
        ...workspace.ui,
        lastSelectionIds: appliedDirections.map((direction) => direction.id)
      }
    }), {
      type: "conceptDirectionApplied",
      directionObjectIds: appliedDirections.map((direction) => direction.id),
      revisionIds: appliedDirections.map((direction) => direction.currentRevisionId),
      proposalId: proposal.id,
      operationId: proposal.operationId,
      citationIds: proposal.citationIds,
      createdAt: now
    })
  };
}

function estimateConceptDirectionCardSize(
  draft: ConceptDirectionProposal["directions"][number]
): { w: number; h: number } {
  const contentWidth = CONCEPT_DIRECTION_CARD_WIDTH - 36;
  const titleLines = estimateCanvasTextLines(draft.title, Math.max(12, Math.floor(contentWidth / 14)));
  const summaryLines = estimateCanvasTextLines(draft.summary, Math.max(16, Math.floor(contentWidth / 10.5)));
  const keywordLines = estimateCanvasTextLines(
    `关键词：${draft.keywords.join(" / ")}`,
    Math.max(18, Math.floor(contentWidth / 10))
  );
  const height =
    35 +
    10 +
    9 +
    titleLines * 19 +
    8 +
    summaryLines * 17 +
    13 +
    6 +
    keywordLines * 15 +
    6;

  return {
    w: CONCEPT_DIRECTION_CARD_WIDTH,
    h: Math.max(196, Math.ceil(height))
  };
}

function estimateCanvasTextLines(text: string, charsPerLine: number): number {
  return Math.max(
    1,
    text
      .split(/\r?\n/)
      .reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charsPerLine)), 0)
  );
}

export function applyResearchAnalysisProposal(
  workspace: MorphoWorkspace,
  proposalId: string,
  input: { position: CanvasPoint } & ApplyProposalOptions
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

  const researchReviewDetails = evaluateSourceReviewDetails(workspace, proposal.sourceSnapshots);
  if (researchReviewDetails.length > 0 && !input.allowSourceChanged) {
    return {
      status: "blocked",
      workspace: updateProposalReviewState(workspace, proposal.id, "sourceChanged", researchReviewDetails),
      reason: buildReviewReasonMessage(researchReviewDetails)
    };
  }

  const objectId = nextRecordId(workspace.objects, `research-${proposal.id}`);
  const canvasInstancesWithoutProposalDraft = workspace.canvas.instances.filter((instance) => instance.objectId !== proposal.id);
  const instanceId = nextRecordId(
    Object.fromEntries(canvasInstancesWithoutProposalDraft.map((instance) => [instance.id, instance])),
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
    workspace: applyProjectContinuityEvent(reconcileWorkspaceDerivedState({
      ...workspace,
      objects: {
        ...removeProposalDraftObject(workspace, proposal.id).objects,
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
          ...canvasInstancesWithoutProposalDraft,
          {
            id: instanceId,
            objectId,
            position: input.position,
            size: { w: 320, h: 148 }
          }
        ]
      },
      ui: {
        ...workspace.ui,
        lastSelectionIds: [objectId]
      }
    }), {
      type: "researchApplied",
      operationId: proposal.operationId,
      researchObjectId: objectId,
      sourceObjectIds: proposal.sourceObjectIds,
      citationIds: proposal.citationIds,
      createdAt: now
    })
  };
}

export function updateResearchAnalysisProposalDraft(
  workspace: MorphoWorkspace,
  proposalId: string,
  input: Pick<
    ResearchAnalysisProposal,
    "title" | "summary" | "findings" | "opportunities" | "constraints" | "openQuestions" | "evidence"
  >
): MorphoWorkspace {
  const proposal = workspace.artifactProposals[proposalId];
  if (!proposal || proposal.type !== "researchAnalysis" || proposal.status !== "pending") {
    return workspace;
  }
  const proposalObject = workspace.objects[proposalId]?.type === "proposalDraft" ? workspace.objects[proposalId] : undefined;

  return {
    ...workspace,
    objects: proposalObject
      ? {
          ...workspace.objects,
          [proposalId]: {
            ...proposalObject,
            title: input.title,
            summary: input.summary,
            updatedAt: new Date().toISOString()
          }
        }
      : workspace.objects,
    artifactProposals: {
      ...workspace.artifactProposals,
      [proposalId]: {
        ...proposal,
        title: input.title,
        summary: input.summary,
        findings: [...input.findings],
        opportunities: [...input.opportunities],
        constraints: [...input.constraints],
        openQuestions: [...input.openQuestions],
        evidence: input.evidence.map((item) => ({
          claim: item.claim,
          confidence: item.confidence,
          citationIds: [...item.citationIds],
          sourceObjectIds: [...item.sourceObjectIds]
        }))
      }
    }
  };
}

export function updateDesignDefinitionProposalDraft(
  workspace: MorphoWorkspace,
  proposalId: string,
  input: Pick<
    DesignDefinitionProposal,
    | "title"
    | "summary"
    | "projectGoal"
    | "targetUsers"
    | "primaryScenarios"
    | "coreProblem"
    | "designPrinciples"
    | "constraints"
    | "avoidDirections"
    | "opportunities"
    | "openQuestions"
    | "changeNote"
  >
): MorphoWorkspace {
  const proposal = workspace.artifactProposals[proposalId];
  if (!proposal || proposal.type !== "designDefinition" || proposal.status !== "pending") {
    return workspace;
  }
  const proposalObject = workspace.objects[proposalId]?.type === "proposalDraft" ? workspace.objects[proposalId] : undefined;

  return {
    ...workspace,
    objects: proposalObject
      ? {
          ...workspace.objects,
          [proposalId]: {
            ...proposalObject,
            title: input.title,
            summary: input.summary,
            updatedAt: new Date().toISOString()
          }
        }
      : workspace.objects,
    artifactProposals: {
      ...workspace.artifactProposals,
      [proposalId]: {
        ...proposal,
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
        changeNote: input.changeNote
      }
    }
  };
}

export function updateConceptDirectionProposalDraft(
  workspace: MorphoWorkspace,
  proposalId: string,
  input: Pick<ConceptDirectionProposal, "title" | "summary" | "directions">
): MorphoWorkspace {
  const proposal = workspace.artifactProposals[proposalId];
  if (!proposal || proposal.type !== "conceptDirection" || proposal.status !== "pending") {
    return workspace;
  }
  const proposalObject = workspace.objects[proposalId]?.type === "proposalDraft" ? workspace.objects[proposalId] : undefined;

  return {
    ...workspace,
    objects: proposalObject
      ? {
          ...workspace.objects,
          [proposalId]: {
            ...proposalObject,
            title: input.title,
            summary: input.summary,
            updatedAt: new Date().toISOString()
          }
        }
      : workspace.objects,
    artifactProposals: {
      ...workspace.artifactProposals,
      [proposalId]: {
        ...proposal,
        title: input.title,
        summary: input.summary,
        directions: input.directions.map((direction) => ({
          ...direction,
          keywords: [...direction.keywords],
          differentiators: [...direction.differentiators],
          visualSignals: [...direction.visualSignals],
          risks: [...direction.risks],
          openQuestions: [...direction.openQuestions]
        }))
      }
    }
  };
}

export function rejectArtifactProposal(
  workspace: MorphoWorkspace,
  proposalId: string,
  rejectedReason: string
): MorphoWorkspace {
  const proposal = workspace.artifactProposals[proposalId];
  if (!proposal || proposal.status !== "pending") {
    return workspace;
  }

  const workspaceWithoutDraftObject = removeProposalDraftObject(workspace, proposalId);

  return {
    ...workspaceWithoutDraftObject,
    artifactProposals: {
      ...workspaceWithoutDraftObject.artifactProposals,
      [proposalId]: {
        ...proposal,
        status: "rejected",
        rejectedReason
      }
    },
    operations: markProposalOperationFinal(
      workspaceWithoutDraftObject.operations,
      proposal.operationId,
      "cancelled",
      new Date().toISOString(),
      rejectedReason
    )
  };
}

export function detectResearchSourceChanges(workspace: MorphoWorkspace, operationId: string): string | undefined {
  const operation = workspace.operations[operationId];
  if (!operation) {
    return undefined;
  }

  const changed = evaluateSourceReviewDetails(workspace, operation.inputSnapshot.sourceSnapshots);
  return changed.length > 0 ? buildReviewReasonMessage(changed) : undefined;
}

function evaluateDesignDefinitionProposalReviewState(
  workspace: MorphoWorkspace,
  proposal: DesignDefinitionProposal
): { state: ProposalReviewState; reason: string; details: ProposalReviewDetails[] } | null {
  const baseDefinition = resolveBaseDesignDefinition(workspace, proposal.basedOnDesignDefinitionId);
  if (proposal.basedOnDesignDefinitionId && !baseDefinition) {
    const details = [
      {
        objectId: proposal.basedOnDesignDefinitionId,
        objectTitle: proposal.basedOnDesignDefinitionId,
        reason: "targetUnavailable" as const,
        message: "设计定义草案引用的原定义已不可用。"
      }
    ];
    return {
      state: "targetUnavailable",
      reason: buildReviewReasonMessage(details),
      details
    };
  }

  if (proposal.basedOnRevisionId && baseDefinition && baseDefinition.currentRevisionId !== proposal.basedOnRevisionId) {
    const details = [
      {
        objectId: baseDefinition.id,
        objectTitle: baseDefinition.title,
        reason: "baseRevisionSuperseded" as const,
        message: "设计定义草案基于的版本已被新的定义版本替代。"
      }
    ];
    return {
      state: "baseSuperseded",
      reason: buildReviewReasonMessage(details),
      details
    };
  }

  const sourceReviewDetails = evaluateSourceReviewDetails(workspace, proposal.sourceSnapshots);
  if (sourceReviewDetails.length > 0) {
    return {
      state: "sourceChanged",
      reason: buildReviewReasonMessage(sourceReviewDetails),
      details: sourceReviewDetails
    };
  }

  return null;
}

function evaluateConceptDirectionProposalReviewState(
  workspace: MorphoWorkspace,
  proposal: ConceptDirectionProposal
): { state: ProposalReviewState; reason: string; details: ProposalReviewDetails[] } | null {
  const baseDefinition = resolveBaseDesignDefinition(workspace, proposal.basedOnDesignDefinitionId);
  if (proposal.basedOnDesignDefinitionId && !baseDefinition) {
    const details = [
      {
        objectId: proposal.basedOnDesignDefinitionId,
        objectTitle: proposal.basedOnDesignDefinitionId,
        reason: "targetUnavailable" as const,
        message: "概念方向草案引用的设计定义已不可用。"
      }
    ];
    return {
      state: "targetUnavailable",
      reason: buildReviewReasonMessage(details),
      details
    };
  }

  if (proposal.basedOnRevisionId && baseDefinition && baseDefinition.currentRevisionId !== proposal.basedOnRevisionId) {
    const details = [
      {
        objectId: baseDefinition.id,
        objectTitle: baseDefinition.title,
        reason: "baseRevisionSuperseded" as const,
        message: "概念方向草案基于的设计定义版本已被替代。"
      }
    ];
    return {
      state: "baseSuperseded",
      reason: buildReviewReasonMessage(details),
      details
    };
  }

  const sourceReviewDetails = evaluateSourceReviewDetails(workspace, proposal.sourceSnapshots);
  if (sourceReviewDetails.length > 0) {
    return {
      state: "sourceChanged",
      reason: buildReviewReasonMessage(sourceReviewDetails),
      details: sourceReviewDetails
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
    const details = proposal.directions
      .filter((direction) => direction.basedOnDirectionId)
      .filter((direction) => {
        const target = direction.basedOnDirectionId ? workspace.objects[direction.basedOnDirectionId] : undefined;
        return target?.type !== "conceptDirection" || target.visibility !== "active";
      })
      .map((direction) => ({
        objectId: direction.basedOnDirectionId ?? "",
        objectTitle: direction.basedOnDirectionId ?? "",
        reason: "targetUnavailable" as const,
        message: "概念方向草案引用的原方向已不可用。"
      }));
    return {
      state: "targetUnavailable",
      reason: buildReviewReasonMessage(details),
      details
    };
  }

  return null;
}

function validateConceptDirectionApplication(
  proposal: ConceptDirectionProposal,
  targetDirection: ConceptDirectionObject | undefined,
  parentDirections: ConceptDirectionObject[]
): string | null {
  switch (proposal.applicationMode) {
    case "revise":
      if (!proposal.targetDirectionId || !targetDirection) {
        return "修订方向草案缺少可用的目标方向。";
      }
      if (proposal.parentDirectionIds.length > 0 || proposal.directions.length !== 1) {
        return "修订方向草案必须只包含一个修订目标和一条修订内容。";
      }
      return null;
    case "split":
      if (proposal.targetDirectionId || proposal.parentDirectionIds.length !== 1 || parentDirections.length !== 1) {
        return "拆分方向草案必须且只能引用一个可用的原方向。";
      }
      if (proposal.directions.length < 2) {
        return "拆分方向草案至少需要两条新方向。";
      }
      return null;
    case "merge":
      if (proposal.targetDirectionId || proposal.parentDirectionIds.length < 2 || parentDirections.length < 2) {
        return "合并方向草案至少需要两个可用的父方向。";
      }
      if (proposal.directions.length !== 1) {
        return "合并方向草案必须只生成一个新方向。";
      }
      return null;
    case "create":
    default:
      if (proposal.targetDirectionId || proposal.parentDirectionIds.length > 0) {
        return "新建方向草案不能带修订目标或父方向。";
      }
      return null;
  }
}

function buildConceptDirectionDecisionSummary(proposal: ConceptDirectionProposal): string {
  switch (proposal.applicationMode) {
    case "revise":
      return `修订概念方向：${proposal.title}`;
    case "split":
      return `拆分概念方向：${proposal.title}`;
    case "merge":
      return `合并概念方向：${proposal.title}`;
    case "create":
    default:
      return `保存概念方向：${proposal.title}`;
  }
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
  if (definition?.type !== "designDefinition") {
    return undefined;
  }

  return definition;
}

function updateProposalReviewState(
  workspace: MorphoWorkspace,
  proposalId: string,
  reviewState: ProposalReviewState,
  reviewDetails: ProposalReviewDetails[]
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
        reviewState,
        reviewDetails
      }
    }
  };
}

function markProposalOperationCompleted(
  operation: OperationRecord | undefined,
  proposalId: string,
  now: string,
  summary: string
): OperationRecord | undefined {
  if (!operation) {
    return undefined;
  }

  return {
    ...operation,
    status: "succeeded",
    updatedAt: now,
    retryable: false,
    proposalIds: operation.proposalIds.includes(proposalId)
      ? operation.proposalIds
      : [...operation.proposalIds, proposalId],
    steps: [
      ...operation.steps,
      {
        id: `${operation.id}-step-proposal-${operation.steps.length + 1}`,
        kind: "proposal",
        status: "succeeded",
        summary,
        createdAt: now
      }
    ],
    events: [
      ...operation.events,
      {
        id: `${operation.id}-event-succeeded-${operation.events.length + 1}`,
        createdAt: now,
        summary
      }
    ]
  };
}

function markProposalOperationFinal(
  operations: Record<string, OperationRecord>,
  operationId: string | undefined,
  status: Extract<OperationRecord["status"], "succeeded" | "cancelled">,
  now: string,
  summary: string
): Record<string, OperationRecord> {
  if (!operationId || !operations[operationId]) {
    return operations;
  }

  const operation = operations[operationId];
  if (operation.status !== "waiting_for_user") {
    return operations;
  }

  return {
    ...operations,
    [operationId]: {
      ...operation,
      status,
      updatedAt: now,
      retryable: false,
      events: [
        ...operation.events,
        {
          id: `${operation.id}-event-${status}-${operation.events.length + 1}`,
          createdAt: now,
          summary
        }
      ]
    }
  };
}

function buildSourceSemanticSnapshots(workspace: MorphoWorkspace, objectIds: string[]): SourceSemanticSnapshot[] {
  return objectIds
    .map((objectId) => createSourceSemanticSnapshot(workspace.objects[objectId]))
    .filter((snapshot): snapshot is SourceSemanticSnapshot => Boolean(snapshot));
}

function createSourceSemanticSnapshot(object: MorphoObject | undefined): SourceSemanticSnapshot | undefined {
  if (!object) {
    return undefined;
  }

  return {
    objectId: object.id,
    objectType: object.type,
    visibility: object.visibility,
    semanticFingerprint: buildSemanticFingerprint(object)
  };
}

function evaluateSourceReviewDetails(
  workspace: MorphoWorkspace,
  snapshots: SourceSemanticSnapshot[]
): ProposalReviewDetails[] {
  return snapshots.flatMap((snapshot): ProposalReviewDetails[] => {
    const current = workspace.objects[snapshot.objectId];
    if (!current) {
      return [
        {
          objectId: snapshot.objectId,
          objectTitle: snapshot.objectId,
          reason: "sourceUnavailable" as const,
          message: "来源对象已被删除，不能继续作为未复核依据。"
        }
      ];
    }

    if (current.visibility !== "active") {
      return [
        {
          objectId: current.id,
          objectTitle: current.title,
          reason: "sourceInactive" as const,
          message: "来源对象已被隐藏，默认不会进入当前 AI Context。"
        }
      ];
    }

    if (buildSemanticFingerprint(current) !== snapshot.semanticFingerprint) {
      return [
        {
          objectId: current.id,
          objectTitle: current.title,
          reason: "sourceContentChanged" as const,
          message: "来源对象的语义内容已变化，需要复核后才能应用。"
        }
      ];
    }

    return [];
  });
}

function buildSemanticFingerprint(object: MorphoObject): string {
  switch (object.type) {
    case "text":
      return stableStringify({ body: object.body });
    case "research":
      return stableStringify({
        findings: object.findings,
        opportunities: object.opportunities,
        constraints: object.constraints,
        openQuestions: object.openQuestions,
        evidence: object.evidence ?? [],
        provenanceCitationIds: object.provenance?.citationIds ?? []
      });
    case "keyConclusion":
      return stableStringify({
        body: object.body,
        state: object.state,
        supersededById: object.supersededById,
        confidence: object.confidence
      });
    case "designDefinition":
      return stableStringify({
        currentRevisionId: object.currentRevisionId,
        isCurrentEffective: object.isCurrentEffective
      });
    case "conceptDirection":
      return stableStringify({
        currentRevisionId: object.currentRevisionId,
        status: object.status
      });
    case "image":
      return stableStringify({ assetId: object.assetId });
    default:
      return stableStringify({ type: object.type });
  }
}

function buildReviewReasonMessage(details: ProposalReviewDetails[]): string {
  return `草案需要复核：${details.map((detail) => `${detail.objectTitle}：${detail.message}`).join("；")}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

export function recordImageGenerationPlan(
  workspace: MorphoWorkspace,
  input: RecordImageGenerationPlanInput
): MorphoWorkspace {
  const operation = workspace.operations[input.operationId];
  if (!operation || operation.type !== "imageGeneration") {
    return workspace;
  }

  const now = new Date().toISOString();
  const referenceObjectIds = [
    ...new Set(
      input.plan.items.flatMap((item) =>
        [item.targetDirectionId, ...item.referenceObjectIds].filter((objectId): objectId is string => Boolean(objectId))
      )
    )
  ];
  const updatedOperation: OperationRecord = {
    ...operation,
    status: "preparing",
    updatedAt: now,
    sourceIds: referenceObjectIds,
    imageGeneration: operation.imageGeneration
      ? {
          ...operation.imageGeneration,
          plan: input.plan,
          referenceObjectIds
        }
      : undefined,
    steps: [
      ...operation.steps,
      {
        id: `${operation.id}-step-plan-${operation.steps.length + 1}`,
        kind: "visualPlan",
        status: "succeeded",
        summary: `AiJWS 已形成 ${input.plan.items.length} 个受控图像生成计划项。`,
        createdAt: now
      }
    ],
    events: [
      ...operation.events,
      {
        id: `${operation.id}-event-plan-${operation.events.length + 1}`,
        createdAt: now,
        summary: "视觉生成计划已通过本地校验。"
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

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function getCurrentDesignDefinitionRevisionId(workspace: MorphoWorkspace): string | undefined {
  const definitionId = workspace.workingState.currentDesignDefinitionId;
  const definition = definitionId ? workspace.objects[definitionId] : undefined;
  return definition?.type === "designDefinition" ? definition.currentRevisionId : undefined;
}

function inferConceptDirectionApplicationMode(
  workIntent: ConceptDirectionProposal["workIntent"]
): ConceptDirectionProposal["applicationMode"] {
  switch (workIntent) {
    case "reviseConceptDirection":
      return "revise";
    case "splitConceptDirection":
      return "split";
    case "mergeConceptDirections":
      return "merge";
    default:
      return "create";
  }
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
  return status === "queued" || status === "preparing" || status === "running";
}

function isBlockingOperationStatus(status: OperationRecord["status"]): boolean {
  return isActiveOperationStatus(status);
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
