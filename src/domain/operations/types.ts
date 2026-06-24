export type OperationId = string;
export type ArtifactProposalId = string;
export type SourceCitationId = string;
export type OperationObjectId = string;
export type OperationCanvasPoint = {
  x: number;
  y: number;
};

export type OperationStatus =
  | "queued"
  | "preparing"
  | "running"
  | "waiting_for_user"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export type OperationType = "research" | "imageGeneration";

export type OperationInputSnapshot = {
  userInput: string;
  selectedObjectIds: OperationObjectId[];
  objectSnapshots: Array<{
    id: OperationObjectId;
    type: string;
    title: string;
    summary: string;
  }>;
};

export type OperationStep = {
  id: string;
  kind:
    | "inputSnapshot"
    | "localCollection"
    | "webSearch"
    | "modelSynthesis"
    | "proposal"
    | "providerSubmit"
    | "providerWait"
    | "assetSave";
  status: "succeeded" | "skipped" | "failed";
  summary: string;
  createdAt: string;
};

export type OperationEvent = {
  id: string;
  createdAt: string;
  summary: string;
};

export type SourceCitation = {
  id: SourceCitationId;
  operationId: OperationId;
  title: string;
  url?: string;
  domain?: string;
  snippet?: string;
  retrievedAt: string;
};

export type ResearchAnalysisProposal = {
  id: ArtifactProposalId;
  type: "researchAnalysis";
  operationId: OperationId;
  status: "pending" | "applied" | "rejected" | "expired";
  title: string;
  summary: string;
  findings: string[];
  opportunities: string[];
  constraints: string[];
  openQuestions: string[];
  sourceObjectIds: OperationObjectId[];
  citationIds: SourceCitationId[];
  sourceChangedWarning?: string;
  createdAt: string;
  appliedObjectId?: OperationObjectId;
};

export type ArtifactProposal = ResearchAnalysisProposal;

export type ImageGenerationOperationMetadata = {
  clientRequestId: string;
  providerTaskId?: string;
  modelId: string;
  modelLabel: string;
  aspectRatio: string;
  sizeOption?: string;
  referenceObjectIds: OperationObjectId[];
  directionObjectId?: OperationObjectId;
  resultObjectId?: OperationObjectId;
};

export type OperationRecord = {
  id: OperationId;
  type: OperationType;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  status: OperationStatus;
  userInput: string;
  inputSnapshot: OperationInputSnapshot;
  allowedCapabilities: {
    webSearch: boolean;
    imagePixels: boolean;
  };
  steps: OperationStep[];
  events: OperationEvent[];
  sourceIds: OperationObjectId[];
  proposalIds: ArtifactProposalId[];
  errorSummary?: string;
  retryable: boolean;
  imageGeneration?: ImageGenerationOperationMetadata;
};

export type ApplyProposalInput = {
  position: OperationCanvasPoint;
};
