import type { CanvasPoint, MorphoRelation, MorphoWorkspace, ResearchObject } from "../morpho/types";
import type {
  ImageGenerationOperationMetadata,
  OperationRecord,
  OperationStatus,
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
      summary: object.summary
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
      summary: object.summary
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
  const citationEntries = input.citations.map((citation, index): SourceCitation => {
    const id = nextRecordId(workspace.citationSnapshots, `${proposalId}-citation-${index + 1}`);
    return {
      id,
      operationId: input.operationId,
      title: citation.title,
      url: citation.url,
      domain: citation.domain ?? domainFromUrl(citation.url),
      snippet: citation.snippet,
      retrievedAt: now
    };
  });
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
    sourceObjectIds: [...input.sourceObjectIds],
    citationIds: citationEntries.map((citation) => citation.id),
    sourceChangedWarning: input.sourceChangedWarning,
    createdAt: now
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
    openQuestions: [...proposal.openQuestions]
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
    workspace: {
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
    }
  };
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
