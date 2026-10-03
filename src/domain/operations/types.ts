import type { AiWorkIntent, ImageRole } from "../morpho/types";
import type { GrsImageEditMode } from "../morpho/grsImageModels";

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

export type OperationType = "research" | "imageGeneration" | "designDefinition" | "conceptDirection";

export type OperationInputSnapshot = {
  userInput: string;
  selectedObjectIds: OperationObjectId[];
  sourceSnapshots: SourceSemanticSnapshot[];
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
    | "visualPlan"
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
  basis?: EvidenceBasis;
  item?: ResearchEvidenceItem;
  reportedConfidence?: ResearchEvidence["confidence"];
};

export type ResearchEvidenceItem = {
  kind: "finding" | "opportunity" | "constraint" | "openQuestion";
  index: number;
  text: string;
};

// A basis records what was supplied as evidence, not proof that a claim is true.
export type EvidenceBasis = {
  confidence: ResearchEvidence["confidence"];
  sourceSnapshots: SourceSemanticSnapshot[];
  citationSnapshots: SourceCitation[];
};

export type ProposalStatus = "pending" | "applied" | "rejected" | "expired";

export type ProposalReviewState = "ready" | "sourceChanged" | "baseSuperseded" | "targetUnavailable";

export type ProposalReviewReason =
  | "sourceContentChanged"
  | "sourceInactive"
  | "sourceUnavailable"
  | "baseRevisionSuperseded"
  | "targetUnavailable";

export type ProposalReviewDetails = {
  objectId: OperationObjectId;
  objectTitle: string;
  reason: ProposalReviewReason;
  message: string;
};

export type SourceSemanticSnapshot = {
  objectId: OperationObjectId;
  incarnationId?: string;
  objectType: string;
  visibility: string;
  semanticFingerprint: string;
  fingerprintVersion?: 2;
};

export type ArtifactProposalBase = {
  id: ArtifactProposalId;
  type: "researchAnalysis" | "designDefinition" | "conceptDirection" | "deliveryPlan";
  operationId?: OperationId;
  workIntent?: AiWorkIntent;
  status: ProposalStatus;
  reviewState?: ProposalReviewState;
  reviewDetails?: ProposalReviewDetails[];
  sourceSnapshots: SourceSemanticSnapshot[];
  targetIdentitySnapshots?: Array<Pick<SourceSemanticSnapshot, "objectId" | "incarnationId">>;
  sourceObjectIds: OperationObjectId[];
  citationIds: SourceCitationId[];
  createdAt: string;
  canvasPlacement?: OperationCanvasPoint;
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
  applicationMode: "create" | "revise" | "split" | "merge";
  targetDirectionId?: OperationObjectId;
  parentDirectionIds: OperationObjectId[];
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

export type VisualIntentItem = {
  id: string;
  /** Task-local identity; null explicitly requests a new concept. */
  identityParentObjectId?: OperationObjectId | null;
  referenceBindings?: VisualReferenceBinding[];
  excludedReferenceObjectIds?: OperationObjectId[];
  targetDirectionId?: OperationObjectId;
  visualBranchId?: OperationObjectId;
  title: string;
  purpose: string;
  requestedReferenceObjectIds: OperationObjectId[];
  excludeDefaultReference?: boolean;
  changeGoals: string[];
  preserve: string[];
  allowToChange: string[];
  composition?: string;
  viewpoint?: string;
  productForm: string[];
  materialsAndCmf: string[];
  environmentAndLighting: string[];
  avoid: string[];
  userPromptRemainder?: string;
  editMode?: GrsImageEditMode;
  role: ImageRole;
};

export type VisualReferenceRole = "identity" | "structure" | "cmf" | "environment" | "composition" | "style" | "unspecified";

export type VisualReferenceBinding = {
  objectId: OperationObjectId;
  role: Exclude<VisualReferenceRole, "identity">;
  required: boolean;
};

/** Generation-time facts. Absence on historical records means unknown, never inferred. */
export type VisualObjectSnapshot = {
  objectId: OperationObjectId;
  incarnationId?: string;
  title: string;
  assetId?: string;
};

export type VisualLineageSnapshot = {
  version: 1;
  identityParent: VisualObjectSnapshot | null;
  parentSource: "explicitTask" | "singleTaskSource" | "newIdentity";
  direction: VisualObjectSnapshot | null;
  directionSource: "explicitTask" | "identityParent" | "none";
  branch: { id: string; directionId: string; label: string; rootObjectId?: string } | null;
  branchSource: "explicitTask" | "identityParent" | "none";
};

export type VisualProviderInputManifest = {
  version: 1;
  references: Array<{
    source: VisualObjectSnapshot;
    role: VisualReferenceRole;
    required: boolean;
    status: "sent" | "omitted";
    omissionReason?: VisualReferenceOmissionReason | "missingPixels" | "invalidPixels" | "providerBytes";
    payloadIndex?: number;
    pixelHash?: string;
  }>;
};

export type VisualReferenceOmissionReason = "providerLimit" | "duplicate" | "unavailable" | "directionMismatch" | "defaultExcluded" | "taskScopeExcluded" | "explicitExcluded";

export type VisualReferenceReason =
  | "identityParent"
  | "roleBinding"
  | "userExplicit"
  | "selectedSource"
  | "branchRoot"
  | "directParent"
  | "directionRepresentative"
  | "defaultReference"
  | "projectReference";

export type VisualReferenceResolution = {
  resolvedObjectIds: OperationObjectId[];
  candidates: Array<{
    objectId: OperationObjectId;
    reason: VisualReferenceReason;
    priority: number;
    role?: VisualReferenceRole;
    required?: boolean;
    sourceDirectionId?: OperationObjectId;
    targetDirectionId?: OperationObjectId;
    crossDirection?: boolean;
    retentionReason?: string;
    included: boolean;
    omissionReason?: VisualReferenceOmissionReason;
  }>;
  providerLimit: number;
  defaultReferenceExcluded: boolean;
};

export type VisualGenerationPlanItem = {
  id: string;
  /** The owning P2A activity instruction used during deterministic compilation. */
  userInstruction?: string;
  lineage?: VisualLineageSnapshot;
  providerInputs?: VisualProviderInputManifest;
  targetDirectionId?: OperationObjectId;
  visualBranchId?: OperationObjectId;
  title: string;
  purpose: string;
  prompt: string;
  referenceObjectIds: OperationObjectId[];
  role: ImageRole;
  editMode?: GrsImageEditMode;
  visualIntent?: VisualIntentItem;
  referenceResolution?: VisualReferenceResolution;
  promptContractVersion?: string;
};

export type VisualGenerationPlan = {
  kind: "directionPreview" | "visualDevelopment";
  items: VisualGenerationPlanItem[];
};

export type ImageGenerationOperationMetadata = {
  clientRequestId: string;
  providerTaskId?: string;
  modelId: string;
  modelLabel: string;
  aspectRatio: string;
  sizeOption?: string;
  referenceObjectIds: OperationObjectId[];
  directionObjectId?: OperationObjectId;
  visualBranchId?: OperationObjectId;
  requestedPreviewCount?: number;
  resultObjectId?: OperationObjectId;
  resultObjectIds?: OperationObjectId[];
  plan?: VisualGenerationPlan;
  /** Per-item actual input, frozen before POST; planned plan remains intact. */
  materializedItems?: VisualGenerationPlanItem[];
  failedItems?: Array<{
    planItemId: string;
    reason: string;
  }>;
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
