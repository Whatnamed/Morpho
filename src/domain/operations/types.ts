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
    body?: string;
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

export type ResearchEvidence = {
  claim: string;
  sourceObjectIds: OperationObjectId[];
  citationIds: SourceCitationId[];
  confidence: "supported" | "partial" | "needsVerification";
};

export type ProposalStatus = "pending" | "applied" | "rejected" | "expired";

export type ProposalReviewState = "ready" | "sourceChanged" | "baseSuperseded" | "targetUnavailable";

export type ArtifactProposalBase = {
  id: ArtifactProposalId;
  type: "researchAnalysis" | "designDefinition" | "conceptDirection" | "deliveryPlan";
  operationId?: OperationId;
  status: ProposalStatus;
  reviewState?: ProposalReviewState;
  sourceObjectIds: OperationObjectId[];
  citationIds: SourceCitationId[];
  createdAt: string;
  appliedObjectId?: OperationObjectId;
  rejectedReason?: string;
  userNote?: string;
};

export type ResearchAnalysisProposal = ArtifactProposalBase & {
  type: "researchAnalysis";
  operationId: OperationId;
  title: string;
  summary: string;
  findings: string[];
  opportunities: string[];
  constraints: string[];
  openQuestions: string[];
  evidence: ResearchEvidence[];
  sourceChangedWarning?: string;
};

export type DesignDefinitionProposal = ArtifactProposalBase & {
  type: "designDefinition";
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
  basedOnDesignDefinitionId?: OperationObjectId;
  basedOnRevisionId?: string;
  changeNote?: string;
};

export type ConceptDirectionDraft = {
  title: string;
  summary: string;
  conceptStatement: string;
  keywords: string[];
  strategy: string;
  differentiators: string[];
  visualSignals: string[];
  risks: string[];
  openQuestions: string[];
  basedOnDirectionId?: OperationObjectId;
  lineageKind?: "derivedFromDirection" | "splitFromDirection" | "mergedFromDirection" | "supersedesDirection";
};

export type ConceptDirectionProposal = ArtifactProposalBase & {
  type: "conceptDirection";
  title: string;
  summary: string;
  directions: ConceptDirectionDraft[];
  basedOnDesignDefinitionId?: OperationObjectId;
  basedOnRevisionId?: string;
};

export type DeliveryPlanProposal = ArtifactProposalBase & {
  type: "deliveryPlan";
  title: string;
  summary: string;
  items: Array<{
    title: string;
    purpose: string;
    contentType: string;
    sourceObjectIds: OperationObjectId[];
    missingReason?: string;
  }>;
};

export type ArtifactProposal =
  | ResearchAnalysisProposal
  | DesignDefinitionProposal
  | ConceptDirectionProposal
  | DeliveryPlanProposal;

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
