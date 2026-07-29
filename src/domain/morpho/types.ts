import type {
  ArtifactProposal,
  OperationRecord,
  ResearchEvidence,
  SourceCitation,
  VisualGenerationPlan,
  VisualIntentItem,
  VisualReferenceResolution
} from "../operations/types";
import type { GrsImageEditMode } from "./grsImageModels";

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
export type ComparisonAnalysisId = string;
export type AiTaskMode = "chatAnalysis" | "imageGeneration" | "researchOperation";

export type ConversationCheckpoint = {
  id: string;
  laneKey: string;
  focusArea: ProjectFocusArea;
  focusUpdatedAt: string;
  taskKind: "research" | "general" | "directionPreview" | "visualDevelopment" | "designDefinition" | "conceptDirection" | "comparison";
  anchorObjectIds: MorphoObjectId[];
  targetDirectionIds: MorphoObjectId[];
  visualBranchId?: VisualBranchId;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceMessageCount: number;
  createdAt: string;
  updatedAt: string;
  threadGoal: string;
  progress: string[];
  openThreads: string[];
  nextTurnAnchor?: string;
};

export type ConversationSummary = {
  threadGoal: string;
  establishedContext: string[];
  decisionsAndReasons: string[];
  activeWork: string[];
  unresolvedQuestions: string[];
  referencedObjects: string[];
  nextTurnAnchor?: string;
};

export type ConversationSummaryRevision = {
  id: string;
  previousRevisionId?: string;
  summary: ConversationSummary;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceMessageCount: number;
  sourceMessageIdsHash: string;
  estimatedInputTokens?: number;
  createdAt: string;
};

export type ConversationCompactionState = {
  summaryRevisionId?: string;
  coveredThroughMessageId?: string;
  coveredMessageCount: number;
  updatedAt?: string;
  estimatedInputTokens?: number;
  sourceMessageIdsHash?: string;
};

export type ProjectFocusArea =
  | "startAndInput"
  | "exploration"
  | "research"
  | "designDefinition"
  | "directionAndVisual"
  | "deliveryPreparation";

export type StageRecordKey = ProjectFocusArea;

export type ProjectMemoryKey =
  | "projectOverview"
  | "designBrief"
  | "userPreferences"
  | "decisionLog"
  | "rejectedDirections"
  | "openQuestions"
  | "outputPlan";

export type ProjectMemorySection = {
  key: string;
  title: string;
  items: string[];
};

export type MemoryRevisionBasis = "deterministic" | "userExplicit" | "userConfirmed" | "mixed";

export type ProjectMemoryDocument = {
  key: ProjectMemoryKey;
  title: string;
  currentRevisionId?: string;
  updatedAt?: string;
};

export type ProjectMemoryRevision = {
  id: string;
  documentKey: ProjectMemoryKey;
  previousRevisionId?: string;
  sections: ProjectMemorySection[];
  sourceRefs: ContinuitySourceRef[];
  basis: MemoryRevisionBasis;
  createdAt: string;
  reviewRequired: boolean;
};

export type StageRecordSectionKey =
  | "goalAndStatus"
  | "outputs"
  | "decisions"
  | "rejected"
  | "preferences"
  | "constraints"
  | "openRisks"
  | "nextFocus";

export type StageRecordSections = Partial<Record<StageRecordSectionKey, string[]>>;

export type StageRecord = {
  stage: StageRecordKey;
  currentRevisionId?: string;
  updatedAt?: string;
};

export type StageRecordRevision = {
  id: string;
  stage: StageRecordKey;
  previousRevisionId?: string;
  sections: StageRecordSections;
  sourceRefs: ContinuitySourceRef[];
  createdAt: string;
  reviewRequired: boolean;
};

export type ProjectMemoryState = {
  schemaVersion: 1;
  documents: Record<ProjectMemoryKey, ProjectMemoryDocument>;
  revisions: Record<string, ProjectMemoryRevision>;
  stageRecords: Partial<Record<StageRecordKey, StageRecord>>;
  stageRevisions: Record<string, StageRecordRevision>;
  updatedAt: string;
};

export type CurrentProjectFocus = {
  area: ProjectFocusArea;
  updatedAt: string;
  sourceKind: "migration" | "userAction" | "operation" | "proposalApplied";
  sourceObjectIds: MorphoObjectId[];
  sourceOperationId?: string;
  note: string;
};

export type ContinuityRecordCategory =
  | "output"
  | "decision"
  | "rejection"
  | "preference"
  | "constraint"
  | "openQuestion"
  | "nextFocus"
  | "systemNote";

export type ContinuityValidity = "current" | "reviewRequired" | "superseded" | "sourceUnavailable";

export type ContinuityRecordOrigin = "deterministicEvent" | "conversationSemanticPatch";

export type SemanticPatchKind =
  | "preference"
  | "constraint"
  | "avoidance"
  | "openQuestion"
  | "decisionReason"
  | "rejectionReason";

export type SemanticPatchScope = "project" | "designDefinition" | "direction" | "visual";

export type ContinuityManualState = "active" | "notApplicable" | "withdrawn";

export type ContinuitySourceRefKind =
  | "object"
  | "revision"
  | "operation"
  | "branch"
  | "decision"
  | "citation"
  | "deliveryReference"
  | "message";

export type ContinuitySourceSnapshot = {
  title: string;
  objectType?: MorphoObjectType;
  revisionNumber?: number;
  status?: string;
  visibility?: ObjectVisibility | "deleted";
  summarySnippet?: string;
  createdAt?: string;
};

export type ContinuitySourceAvailability = "active" | "hidden" | "missing";

export type ContinuitySourceRef = {
  kind: ContinuitySourceRefKind;
  id: string;
  snapshot?: ContinuitySourceSnapshot;
  sourceAvailability?: ContinuitySourceAvailability;
};

export type ContinuityRecordEntry = {
  id: string;
  dedupeKey: string;
  origin: ContinuityRecordOrigin;
  manualState: ContinuityManualState;
  stage: StageRecordKey;
  category: ContinuityRecordCategory;
  summary: string;
  sourceRefs: ContinuitySourceRef[];
  createdAt: string;
  updatedAt: string;
  validity: ContinuityValidity;
  semanticKind?: SemanticPatchKind;
  sourceMessageId?: string;
  evidenceQuote?: string;
  scope?: SemanticPatchScope;
  invalidationReasons?: string[];
};

export type ProjectMemoryViewKey =
  | "projectOverview"
  | "designDefinition"
  | "preferencesAndAvoids"
  | "decisionLog"
  | "rejectedDirections"
  | "openQuestions"
  | "deliveryPlan";

export type ProjectMemoryItem = {
  id: string;
  title: string;
  summary: string;
  sourceRefs: ContinuitySourceRef[];
  validity: ContinuityValidity;
};

export type ProjectMemoryView = {
  key: ProjectMemoryViewKey;
  title: string;
  items: ProjectMemoryItem[];
  emptyMessage: string;
};

export type ProjectContinuityState = {
  schemaVersion: 2;
  currentFocus: CurrentProjectFocus;
  recordEntries: ContinuityRecordEntry[];
  updatedAt: string;
};

export type AiWorkIntent =
  | "discussion"
  | "comparison"
  | "prepareDeliverySection"
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
  | "documentFragment"
  | "proposalDraft"
  | "designDefinition"
  | "conceptDirection"
  | "delivery";

export type ObjectVisibility = "active" | "hidden";

export type ImageRole =
  | "reference"
  | "preview"
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

export type FileParseStatus = "unparsed" | "parsing" | "parsed" | "failed";

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

export type DeliverySection = {
  id: string;
  title: string;
  purpose?: string;
  order: number;
  referenceIds: DeliveryReferenceId[];
  narrative?: string;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryGap = {
  id: string;
  label: string;
  sectionId?: string;
  status: "open" | "resolved";
  origin: "manual" | "deliveryDraft";
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
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
  pendingReview?: VisualReviewMark;
  generation?: ImageGenerationMetadata;
};

/** 待复核：因默认参考（主视觉锚点）替换等明确事件，需要用户重新判断的视觉素材。 */
export type VisualReviewMark = {
  reason: "defaultReferenceReplaced";
  previousDefaultReferenceId: MorphoObjectId;
  newDefaultReferenceId: MorphoObjectId;
  decisionId: string;
  markedAt: string;
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
  compiledPrompt?: string;
  promptContractVersion?: string;
  editMode?: GrsImageEditMode;
  referenceObjectIds: MorphoObjectId[];
  referenceResolution?: VisualReferenceResolution;
  directionId?: MorphoObjectId;
  visualBranchId?: VisualBranchId;
  title?: string;
  purpose?: string;
  role?: ImageRole;
  visualIntent?: VisualIntentItem;
  visualPlan?: VisualGenerationPlan;
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
  parseStatus?: FileParseStatus;
  extractedAssetId?: AssetId;
  extractedCharCount?: number;
  extractedPageCount?: number;
  parsedAt?: string;
  parseError?: string;
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
  pendingReview?: VisualReviewMark;
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

export type DocumentFragmentObject = MorphoObjectBase & {
  type: "documentFragment";
  body: string;
  source: {
    fileObjectId: MorphoObjectId;
    fileTitle: string;
    fileName?: string;
    sourceExtractAssetId: AssetId;
    startOffset: number;
    endOffset: number;
    blockIds: string[];
  };
};

export type ProposalDraftObject = MorphoObjectBase & {
  type: "proposalDraft";
  proposalId: string;
  proposalType: ArtifactProposal["type"];
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
  sections: DeliverySection[];
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
  | DocumentFragmentObject
  | ProposalDraftObject
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

/** Canvas presentation landmark — not a MorphoObject and not schema-versioned. */
export type StageRegionKey = "research" | "definition" | "visual" | "delivery";
export type StageRegionColorKey = "warmSand" | "mistBlue" | "sage" | "violetGray" | "clay" | "warmGray";
export type StageRegionBorderStyle = "none" | "solid" | "dashed";

export type StageRegionRecord = {
  id: string;
  key: StageRegionKey;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  memberObjectIds: MorphoObjectId[];
  /** Optional so pre-style projects remain readable without a schema migration. */
  colorKey?: StageRegionColorKey;
  fillOpacity?: number;
  backgroundVisible?: boolean;
  borderStyle?: StageRegionBorderStyle;
  locked?: boolean;
  isActivated?: boolean;
};

export type RelationKind =
  | "source"
  | "supports"
  | "supportsConclusion"
  | "belongsToDirection"
  | "usesReference"
  | "version"
  | "defaultReference"
  | "documentFragmentExtractedFromFile"
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
  body?: string;
  bodyKind?: "complete" | "excerpt";
  sourceRevision?: {
    revisionId: string;
    revisionNumber: number;
  };
  sourceFile?: {
    fileObjectId: MorphoObjectId;
    title: string;
    fileName?: string;
    sourceExtractAssetId?: AssetId;
    startOffset?: number;
    endOffset?: number;
  };
  previewAsset?: {
    assetId?: AssetId;
    alt: string;
  };
};

export type DeliveryReference = {
  id: DeliveryReferenceId;
  deliveryObjectId?: MorphoObjectId;
  sectionId?: string;
  order?: number;
  sourceObjectId?: MorphoObjectId;
  createdAt: string;
  updatedAt?: string;
  snapshot: DeliveryReferenceSnapshot;
  sourceFingerprint?: string;
  sourceRevisionId?: string;
  sourceRevisionNumber?: number;
  sourceAssetId?: AssetId;
  editorial?: {
    caption?: string;
    note?: string;
  };
};

export type DeliverySectionDraft = {
  id: string;
  deliveryObjectId: MorphoObjectId;
  sectionId: string;
  userMessageId: string;
  assistantMessageId: string;
  referenceIds: DeliveryReferenceId[];
  sourceFingerprints: Record<DeliveryReferenceId, string | undefined>;
  title?: string;
  narrative: string;
  captions: Array<{
    referenceId: DeliveryReferenceId;
    caption: string;
  }>;
  suggestedGaps: Array<{
    label: string;
  }>;
  status: "pending" | "applied" | "discarded";
  createdAt: string;
  updatedAt: string;
};

export type DecisionKind =
  | "createKeyConclusion"
  | "setKeyConclusionState"
  | "applyDesignDefinition"
  | "applyConceptDirection"
  | "setDefaultReference"
  | "setDirectionStatus"
  | "setImageRole"
  | "createDeliveryReference"
  | "replaceDeliveryReference"
  | "refreshDeliveryReference"
  | "removeDeliveryReference"
  | "createDeliveryPreparation"
  | "updateDeliverySection"
  | "applyDeliverySectionDraft"
  | "setDeliveryGapStatus"
  | "deleteObject";

export type ObjectSnapshot = {
  id: MorphoObjectId;
  type: MorphoObjectType;
  title: string;
};

export type ComparisonSourceAvailability = "active" | "hidden" | "missing";

export type ComparisonSourceRef = {
  objectId: MorphoObjectId;
  objectType: MorphoObjectType;
  title: string;
  summary: string;
  availability: ComparisonSourceAvailability;
};

export type ComparisonObjectEvidence = {
  objectId: MorphoObjectId;
  label: string;
  evidence: string;
};

export type ComparisonObjectEntry = {
  objectId: MorphoObjectId;
  title: string;
  evidenceBasis?: "pixels" | "objectSummary" | "documentExtract" | "documentFragment";
  summary: string;
  strengths: string[];
  risks: string[];
  evidence: string[];
};

export type ComparisonKeyConclusionCandidate = {
  title: string;
  summary: string;
  body: string;
  sourceObjectIds: MorphoObjectId[];
  evidence: ComparisonObjectEvidence[];
  confidence: KeyConclusionObject["confidence"];
  note?: string;
};

export type ComparisonAnalysis = {
  id: ComparisonAnalysisId;
  assistantMessageId: string;
  userMessageId: string;
  createdAt: string;
  updatedAt: string;
  sourceObjectIds: MorphoObjectId[];
  sourceRefs: ComparisonSourceRef[];
  comparisonGoal: string;
  conclusionSummary: string;
  objectComparisons: ComparisonObjectEntry[];
  recommendedQuestions: string[];
  evidenceLimits: string[];
  keyConclusionCandidate?: ComparisonKeyConclusionCandidate;
};

export type ComparisonDecisionMetadata = {
  comparisonAnalysisId: ComparisonAnalysisId;
  comparisonAssistantMessageId: string;
  comparisonSourceObjectIds: MorphoObjectId[];
  userReason?: string;
};

export type DecisionRecord = {
  id: DecisionRecordId;
  kind: DecisionKind;
  createdAt: string;
  summary: string;
  reason?: string;
  objectSnapshot?: ObjectSnapshot;
  relatedObjectIds: MorphoObjectId[];
  comparison?: ComparisonDecisionMetadata;
};

export type AgentActivityKind =
  | "webSearch"
  | "fileRead"
  | "contextRead"
  | "analysis"
  | "proposal"
  | "imageGeneration"
  | "comparison"
  | "workspaceWrite"
  | "confirmation"
  | "other";

export type AgentReasoningPart = {
  id: string;
  type: "reasoning";
  text: string;
  state: "streaming" | "done";
  createdAt: string;
  attemptId?: string;
};

export type AgentCommentaryPart = {
  id: string;
  type: "commentary";
  text: string;
  state: "streaming" | "done";
  createdAt: string;
  attemptId?: string;
};

export type AgentToolActivityPart = {
  id: string;
  type: "toolActivity";
  toolCallId: string;
  toolName: string;
  activityKind: AgentActivityKind;
  label: string;
  detail?: string;
  state: "running" | "done" | "failed";
  startedAt: string;
  completedAt?: string;
  source?: "provider" | "local";
  attemptId?: string;
};

export type AgentMessagePart = AgentReasoningPart | AgentCommentaryPart | AgentToolActivityPart;

export type AgentTrace = {
  startedAt: string;
  completedAt?: string;
  parts: AgentMessagePart[];
  status: "streaming" | "done" | "failed" | "cancelled";
  agentTurnId?: string;
  responseId?: string;
  providerDiagnostics?: import("@/shared/agentStreamProtocol").AgentProviderDiagnostics;
};

export type AgentTurnOutcome =
  | "success"
  | "cancelledBeforeExecution"
  | "failedBeforeExecution"
  | "cancelledDuringProvider"
  | "failedDuringProvider"
  | "partialSuccess"
  | "pendingConfirmation";

export type ProviderInputSnapshotTextPartKind =
  | "userDraft"
  | "turnContract"
  | "documentExtract"
  | "other";

export type ProviderInputSnapshotTextPart = {
  kind: ProviderInputSnapshotTextPartKind;
  text: string;
};

export type ProviderInputSnapshotAttachmentRef = {
  objectId: string;
  assetId?: string;
  contentHash?: string;
  mimeType?: string;
};

export type ProviderInputCacheBoundaryReason =
  | "imageInput"
  | "legacyProviderInput"
  | "documentSnapshotUnavailable"
  | "toolProfileChanged"
  | "promptContractChanged"
  | "compaction";

export type ProviderInputSnapshot = {
  schemaVersion: 1;
  promptContractVersion: string;
  textParts: ProviderInputSnapshotTextPart[];
  attachmentRefs: ProviderInputSnapshotAttachmentRef[];
  serializedTextHash: string;
  cacheBoundaryReason?: ProviderInputCacheBoundaryReason;
};

export type ProviderOutputSnapshot = {
  schemaVersion: 1;
  text: string;
  contentHash: string;
};

export type AiMessage = {
  id: string;
  role: "assistant" | "user";
  body: string;
  createdAt?: string;
  status?: "streaming" | "done" | "failed" | "cancelled";
  contextVisibility?: "model" | "uiOnly";
  contextObjectIds?: MorphoObjectId[];
  taskMode?: AiTaskMode;
  recommendedTaskMode?: AiTaskMode;
  workIntent?: AiWorkIntent;
  recommendedWorkIntent?: AiWorkIntent;
  operationId?: string;
  proposalId?: string;
  citationIds?: string[];
  continuityEntryIds?: string[];
  conversationLaneKey?: string;
  conversationCheckpointId?: string;
  conversationSummaryRevisionId?: string;
  memoryUpdateKeys?: ProjectMemoryKey[];
  stageRecordUpdateKeys?: StageRecordKey[];
  promptContractVersion?: string;
  providerInputSnapshot?: ProviderInputSnapshot;
  providerOutputSnapshot?: ProviderOutputSnapshot;
  taskStrategy?: AgentTaskStrategyKind;
  comparisonAnalysisId?: ComparisonAnalysisId;
  agentTrace?: AgentTrace;
  agentTurnId?: string;
  pairedMessageId?: string;
  agentTurnOutcome?: AgentTurnOutcome;
  agentTurnOutcomeSummary?: string;
  error?: string;
};

export type ProviderContextFrameKind =
  | "projectState"
  | "turnContext"
  | "runtimeConfiguration"
  | "conversationSummary";

export type ProviderContextFrameSourceRef = {
  kind: string;
  id: string;
  title?: string;
};

export type ProviderContextFramePlacement =
  | "conversationBaseline"
  | "beforeUser"
  | "afterUser"
  | "beforeAssistant"
  | "afterAssistant";

export type ProviderContextFrame = {
  id: string;
  kind: ProviderContextFrameKind;
  createdAt: string;
  sequence: number;
  placement: ProviderContextFramePlacement;
  promptContractVersion: string;
  taskStrategy?: AgentTaskStrategyKind;
  projectMemoryRevisionIds: string[];
  stageRecordRevisionIds: string[];
  designDefinitionRevisionId?: string;
  directionRevisionIds: string[];
  defaultReferenceObjectId?: string;
  selectedObjectIds: string[];
  relatedObjectIds: string[];
  renderedText: string;
  contentHash: string;
  supersedesFrameId?: string;
  contextVisibility: "providerOnly";
  sourceRefs: ProviderContextFrameSourceRef[];
  reason: string;
  anchorMessageId?: string;
  summaryRevisionId?: string;
  runtimeItem?: import("@/shared/agentRuntimeItem").AgentCanonicalRuntimeItem;
};

export type AgentTaskStrategyKind =
  | "discussion"
  | "research"
  | "designDefinition"
  | "conceptDirection"
  | "directionPreview"
  | "visualDevelopment"
  | "comparison"
  | "deliveryPreparation"
  | "historyAndMemory";

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
  currentDesignDefinitionAvailability: "available" | "hidden" | "missing";
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

export type MorphoWorkspace = {
  schemaVersion: 15;
  project: {
    id: string;
    title: string;
    subtitle: string;
    createdAt?: string;
    updatedAt?: string;
    lastOpenedAt?: string;
    coverAssetId?: AssetId;
  };
  objects: Record<MorphoObjectId, MorphoObject>;
  assets: Record<AssetId, AssetRecord>;
  relations: MorphoRelation[];
  deliveryReferences: Record<DeliveryReferenceId, DeliveryReference>;
  deliverySectionDrafts: Record<string, DeliverySectionDraft>;
  decisionRecords: DecisionRecord[];
  operations: Record<string, OperationRecord>;
  artifactProposals: Record<string, ArtifactProposal>;
  citationSnapshots: Record<string, SourceCitation>;
  designDefinitionRevisions: Record<DesignDefinitionRevisionId, DesignDefinitionRevision>;
  directionRevisions: Record<DirectionRevisionId, ConceptDirectionRevision>;
  directionLineage: DirectionLineageRecord[];
  visualBranches: Record<VisualBranchId, VisualBranchRecord>;
  workingState: ProjectWorkingState;
  projectContinuity: ProjectContinuityState;
  projectMemory: ProjectMemoryState;
  canvas: {
    view: CanvasView;
    instances: CanvasInstance[];
    /**
     * Optional canvas presentation only. Not a schema migration field —
     * missing records are filled at runtime by ensureStageRegions.
     */
    stageRegions?: StageRegionRecord[];
  };
  ai: {
    messages: AiMessage[];
    conversationCheckpoints: ConversationCheckpoint[];
    conversationCompaction: ConversationCompactionState;
    conversationSummaryRevisions: Record<string, ConversationSummaryRevision>;
    providerContextFrames?: ProviderContextFrame[];
    comparisonAnalyses?: Record<ComparisonAnalysisId, ComparisonAnalysis>;
  };
  ui: {
    activeDrawer: "map" | "assets" | "hidden" | "search" | "records" | null;
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
  visualTargetDirectionId?: MorphoObjectId;
  visualBranchId?: VisualBranchId;
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
