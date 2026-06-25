import type { ArtifactProposal, OperationRecord, ResearchEvidence, SourceCitation } from "../operations/types";

export type MorphoObjectId = string;
export type CanvasInstanceId = string;
export type MorphoRelationId = string;
export type DeliveryReferenceId = string;
export type DecisionRecordId = string;
export type AssetId = string;
export type DesignDefinitionRevisionId = string;
export type DirectionRevisionId = string;
export type DirectionLineageId = string;
export type VisualBranchId = string;
export type StageRecordKind =
  | "research"
  | "designDefinition"
  | "directionVisualDevelopment"
  | "deliveryPreparation";
export type AiTaskMode = "chatAnalysis" | "imageGeneration" | "researchOperation";

export type AiWorkIntent =
  | "discussion"
  | "comparison"
  | "createDesignDefinition"
  | "reviseDesignDefinition"
  | "createConceptDirections"
  | "reviseConceptDirection"
  | "splitConceptDirection"
  | "mergeConceptDirections";

export type MorphoObjectType =
  | "image"
  | "file"
  | "text"
  | "link"
  | "imageCollection"
  | "research"
  | "keyConclusion"
  | "designDefinition"
  | "conceptDirection"
  | "delivery";

export type ObjectVisibility = "active" | "hidden";

export type ImageRole =
  | "reference"
  | "preview"
  | "main"
  | "scenario"
  | "cmf"
  | "detail"
  | "diagram"
  | "conceptImage"
  | "primaryVisual"
  | "sceneVisual"
  | "cmfStudy"
  | "detailStudy"
  | "structureDiagram"
  | "interactionDiagram"
  | "deliveryAsset";

export type AssetSourceType =
  | "originalImage"
  | "originalFile"
  | "originalLink"
  | "aiGeneratedImage"
  | "documentExtract";

export type AssetRecord = {
  id: AssetId;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  storageKey: string;
  sourceType: AssetSourceType;
  width?: number;
  height?: number;
  aspectRatio?: number;
  url?: string;
  domain?: string;
};

export type ConceptDirectionStatus = "pendingPreview" | "primary" | "alternative" | "eliminated" | "needsReview";

export type KeyConclusionState = "active" | "needsVerification" | "superseded" | "archived";

export type DeliveryGap = {
  id: string;
  label: string;
};

export type MorphoObjectBase = {
  id: MorphoObjectId;
  type: MorphoObjectType;
  title: string;
  summary: string;
  createdBy: "user" | "ai";
  visibility: ObjectVisibility;
  createdAt?: string;
  updatedAt?: string;
};

export type ImageObject = MorphoObjectBase & {
  type: "image";
  role: ImageRole;
  imageVariant: "path" | "rail" | "detail" | "scenario" | "cmf" | "supportIsland" | "softGuide";
  assetId?: AssetId;
  directionId?: MorphoObjectId;
  visualBranchId?: VisualBranchId;
  isDefaultReference?: boolean;
  generation?: ImageGenerationMetadata;
};

export type ImageGenerationMetadata = {
  operationId?: string;
  clientRequestId?: string;
  providerTaskId?: string;
  modelId: string;
  modelLabel: string;
  aspectRatio: string;
  sizeOption?: string;
  prompt: string;
  referenceObjectIds: MorphoObjectId[];
  directionId?: MorphoObjectId;
  createdAt: string;
};

export type FileObject = MorphoObjectBase & {
  type: "file";
  fileKind: "pdf" | "imageSet" | "document";
  sourceLabel: string;
  assetId?: AssetId;
  fileName?: string;
  mimeType?: string;
  size?: number;
  parseStatus?: "unparsed";
};

export type TextObject = MorphoObjectBase & {
  type: "text";
  body: string;
};

export type LinkObject = MorphoObjectBase & {
  type: "link";
  url: string;
  domain: string;
  editableTitle?: string;
  description?: string;
  assetId?: AssetId;
};

export type ImageCollectionObject = MorphoObjectBase & {
  type: "imageCollection";
  memberObjectIds: MorphoObjectId[];
  expanded: boolean;
};

export type ResearchObject = MorphoObjectBase & {
  type: "research";
  findings: string[];
  opportunities: string[];
  constraints: string[];
  openQuestions: string[];
  evidence?: ResearchEvidence[];
  provenance?: {
    operationId: string;
    proposalId: string;
    sourceObjectIds: MorphoObjectId[];
    citationIds: string[];
    didUseWebSearch: boolean;
  };
};

export type KeyConclusionObject = MorphoObjectBase & {
  type: "keyConclusion";
  body: string;
  state: KeyConclusionState;
  confidence: ResearchEvidence["confidence"];
  sourceObjectIds: MorphoObjectId[];
  citationIds: string[];
  confirmedAt: string;
  supersededById?: MorphoObjectId;
  note?: string;
};

export type DesignDefinitionObject = MorphoObjectBase & {
  type: "designDefinition";
  problem: string;
  principles: string[];
  avoid: string[];
  currentRevisionId: DesignDefinitionRevisionId;
  revisionIds: DesignDefinitionRevisionId[];
  isCurrentEffective: boolean;
};

export type ConceptDirectionObject = MorphoObjectBase & {
  type: "conceptDirection";
  status: ConceptDirectionStatus;
  keywords: string[];
  currentRevisionId: DirectionRevisionId;
  revisionIds: DirectionRevisionId[];
  lineageRootId: MorphoObjectId;
};

export type DeliveryObject = MorphoObjectBase & {
  type: "delivery";
  format: "board" | "presentation";
  gaps: DeliveryGap[];
  references: DeliveryReferenceId[];
};

export type MorphoObject =
  | ImageObject
  | FileObject
  | TextObject
  | LinkObject
  | ImageCollectionObject
  | ResearchObject
  | KeyConclusionObject
  | DesignDefinitionObject
  | ConceptDirectionObject
  | DeliveryObject;

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasSize = {
  w: number;
  h: number;
};

export type CanvasInstance = {
  id: CanvasInstanceId;
  objectId: MorphoObjectId;
  position: CanvasPoint;
  size: CanvasSize;
};

export type CanvasView = {
  x: number;
  y: number;
  zoom: number;
};

export type RelationKind =
  | "source"
  | "supports"
  | "supportsConclusion"
  | "belongsToDirection"
  | "usesReference"
  | "version"
  | "defaultReference"
  | "deliveryReference";

export type MorphoRelation = {
  id: MorphoRelationId;
  kind: RelationKind;
  fromObjectId: MorphoObjectId;
  toObjectId: MorphoObjectId;
  note: string;
};

export type DeliveryReferenceSnapshot = {
  sourceType: MorphoObjectType;
  title: string;
  summary?: string;
  caption?: string;
  previewAsset?: {
    url?: string;
    alt: string;
  };
};

export type DeliveryReference = {
  id: DeliveryReferenceId;
  sourceObjectId?: MorphoObjectId;
  createdAt: string;
  snapshot: DeliveryReferenceSnapshot;
};

export type DecisionKind =
  | "createKeyConclusion"
  | "applyDesignDefinition"
  | "applyConceptDirection"
  | "setDefaultReference"
  | "setDirectionStatus"
  | "setImageRole"
  | "createDeliveryReference"
  | "replaceDeliveryReference"
  | "removeDeliveryReference"
  | "deleteObject";

export type ObjectSnapshot = {
  id: MorphoObjectId;
  type: MorphoObjectType;
  title: string;
};

export type DecisionRecord = {
  id: DecisionRecordId;
  kind: DecisionKind;
  createdAt: string;
  summary: string;
  reason?: string;
  objectSnapshot?: ObjectSnapshot;
  relatedObjectIds: MorphoObjectId[];
};

export type AiMessage = {
  id: string;
  role: "assistant" | "user";
  body: string;
  createdAt?: string;
  status?: "streaming" | "done" | "failed";
  contextObjectIds?: MorphoObjectId[];
  taskMode?: AiTaskMode;
  recommendedTaskMode?: AiTaskMode;
  workIntent?: AiWorkIntent;
  recommendedWorkIntent?: AiWorkIntent;
  operationId?: string;
  proposalId?: string;
  citationIds?: string[];
  error?: string;
};

export type DesignDefinitionRevision = {
  id: DesignDefinitionRevisionId;
  designDefinitionId: MorphoObjectId;
  revisionNumber: number;
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
  sourceObjectIds: MorphoObjectId[];
  citationIds: string[];
  createdAt: string;
  previousRevisionId?: DesignDefinitionRevisionId;
  changeNote?: string;
  isCurrent: boolean;
};

export type ConceptDirectionRevision = {
  id: DirectionRevisionId;
  directionId: MorphoObjectId;
  revisionNumber: number;
  title: string;
  summary: string;
  conceptStatement: string;
  keywords: string[];
  strategy: string;
  differentiators: string[];
  visualSignals: string[];
  risks: string[];
  openQuestions: string[];
  sourceObjectIds: MorphoObjectId[];
  citationIds: string[];
  basedOnDefinitionRevisionId?: DesignDefinitionRevisionId;
  createdAt: string;
  previousRevisionId?: DirectionRevisionId;
  changeNote?: string;
  isCurrent: boolean;
};

export type DirectionLineageKind =
  | "derivedFromDirection"
  | "splitFromDirection"
  | "mergedFromDirection"
  | "supersedesDirection";

export type DirectionLineageRecord = {
  id: DirectionLineageId;
  kind: DirectionLineageKind;
  fromDirectionId: MorphoObjectId;
  toDirectionId: MorphoObjectId;
  createdAt: string;
  note: string;
};

export type VisualBranchRecord = {
  id: VisualBranchId;
  directionId: MorphoObjectId;
  label: string;
  rootObjectId?: MorphoObjectId;
  createdAt: string;
  archivedAt?: string;
};

export type ProjectWorkingState = {
  currentDesignDefinitionId?: MorphoObjectId;
  primaryDirectionId?: MorphoObjectId;
  alternativeDirectionIds: MorphoObjectId[];
  eliminatedDirectionIds: MorphoObjectId[];
  activeKeyConclusionIds: MorphoObjectId[];
  currentDefaultReferenceId?: MorphoObjectId;
  directionReferenceIds: Record<MorphoObjectId, MorphoObjectId[]>;
  recentResearchObjectIds: MorphoObjectId[];
  openQuestionIds: MorphoObjectId[];
  derivedFromRevision: string;
  lastReconciledAt: string;
};

export type StageRecord = {
  kind: StageRecordKind;
  goal: string;
  currentStatus: "empty" | "active" | "pending" | "ready";
  savedObjectIds: MorphoObjectId[];
  decisionIds: DecisionRecordId[];
  constraints: string[];
  openQuestions: string[];
  nextSuggestion: string;
  updatedAt: string;
};

export type MorphoWorkspace = {
  schemaVersion: 5;
  project: {
    id: string;
    title: string;
    subtitle: string;
    currentFocus: "direction_visual_development" | "research" | "design_definition" | "delivery_preparation";
    createdAt?: string;
    updatedAt?: string;
    lastOpenedAt?: string;
    coverAssetId?: AssetId;
  };
  objects: Record<MorphoObjectId, MorphoObject>;
  assets: Record<AssetId, AssetRecord>;
  relations: MorphoRelation[];
  deliveryReferences: Record<DeliveryReferenceId, DeliveryReference>;
  decisionRecords: DecisionRecord[];
  operations: Record<string, OperationRecord>;
  artifactProposals: Record<string, ArtifactProposal>;
  citationSnapshots: Record<string, SourceCitation>;
  designDefinitionRevisions: Record<DesignDefinitionRevisionId, DesignDefinitionRevision>;
  directionRevisions: Record<DirectionRevisionId, ConceptDirectionRevision>;
  directionLineage: DirectionLineageRecord[];
  visualBranches: Record<VisualBranchId, VisualBranchRecord>;
  workingState: ProjectWorkingState;
  stageRecords: Record<StageRecordKind, StageRecord>;
  canvas: {
    view: CanvasView;
    instances: CanvasInstance[];
  };
  ai: {
    messages: AiMessage[];
  };
  ui: {
    activeDrawer: "map" | "assets" | "hidden" | "search" | null;
    aiOpen: boolean;
    lastSelectionIds: MorphoObjectId[];
    canvasView: CanvasView;
    workIntent: AiWorkIntent;
  };
};

export type AiSuggestionInput = {
  selectedObjectIds: MorphoObjectId[];
  suggestion: string;
};

export type AiDraftResult = {
  workspace: MorphoWorkspace;
  draft: string;
  contextObjectIds: MorphoObjectId[];
};

export type AiContextTask =
  | "general"
  | "research"
  | "designDefinition"
  | "conceptDirection"
  | "visualDevelopment"
  | "comparison"
  | "deliveryPreparation";

export type AiDefaultReferenceStatus =
  | {
      status: "available";
      objectId: MorphoObjectId;
    }
  | {
      status: "hidden";
      objectId: MorphoObjectId;
      message: string;
    }
  | {
      status: "missing";
      message: string;
    }
  | {
      status: "notRelevant";
    };

export type AssembleAiContextInput = {
  draft: string;
  selectedObjectIds: MorphoObjectId[];
  explicitObjectIds: MorphoObjectId[];
  task: AiContextTask;
};

export type AssembledAiContext = {
  draft: string;
  objectIds: MorphoObjectId[];
  defaultReferenceStatus: AiDefaultReferenceStatus;
};

export type WorkspaceMigrationResult =
  | {
      status: "ok";
      workspace: MorphoWorkspace;
      didMigrate: boolean;
    }
  | {
      status: "failed";
      reason: string;
    };
