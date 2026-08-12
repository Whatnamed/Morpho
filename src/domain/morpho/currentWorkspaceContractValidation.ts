import type {
  AgentActivityKind,
  AgentTaskStrategyKind,
  AgentTurnOutcome,
  AiTaskMode,
  AiWorkIntent,
  AssetSourceType,
  ContinuityManualState,
  ContinuityRecordCategory,
  ContinuityRecordOrigin,
  ContinuitySourceAvailability,
  ContinuitySourceRefKind,
  ContinuityValidity,
  DecisionKind,
  DirectionLineageKind,
  ImageRole,
  KeyConclusionCategory,
  MorphoObjectType,
  ObjectVisibility,
  ProjectFocusArea,
  ProjectMemoryKey,
  ProviderContextFrameKind,
  ProviderContextFramePlacement,
  ProviderInputCacheBoundaryReason,
  ProviderInputSnapshotTextPartKind,
  SemanticPatchKind,
  SemanticPatchScope,
  StageRecordKey,
  StageRecordSectionKey,
  StageRegionBorderStyle,
  StageRegionColorKey,
  StageRegionKey
} from "./types";
import type {
  OperationStatus,
  OperationType,
  ProposalReviewReason,
  ProposalReviewState,
  ProposalStatus,
  VisualReferenceReason
} from "../operations/types";
import type { GrsImageEditMode } from "./grsImageModels";

export type WorkspaceContractIssueAdder = (path: string, message: string) => void;

const OBJECT_TYPES = values<MorphoObjectType>([
  "image", "file", "text", "link", "imageCollection", "research", "keyConclusion",
  "documentFragment", "proposalDraft", "designDefinition", "conceptDirection", "delivery"
]);
const IMAGE_ROLES = values<ImageRole>([
  "reference", "preview", "conceptImage", "primaryVisual", "sceneVisual", "cmfStudy",
  "detailStudy", "structureDiagram", "interactionDiagram", "deliveryAsset"
]);
const VISIBILITIES = values<ObjectVisibility>(["active", "hidden"]);
const ASSET_SOURCE_TYPES = values<AssetSourceType>([
  "originalImage", "originalFile", "originalLink", "aiGeneratedImage", "documentExtract"
]);
const KEY_CONCLUSION_CATEGORIES = values<KeyConclusionCategory>([
  "finding", "opportunity", "constraint", "openQuestion", "unknown"
]);
const AI_WORK_INTENTS = values<AiWorkIntent>([
  "discussion", "comparison", "prepareDeliverySection", "createDesignDefinition",
  "reviseDesignDefinition", "createConceptDirections", "reviseConceptDirection",
  "splitConceptDirection", "mergeConceptDirections"
]);
const AI_TASK_MODES = values<AiTaskMode>(["chatAnalysis", "imageGeneration", "researchOperation"]);
const AGENT_TASK_STRATEGIES = values<AgentTaskStrategyKind>([
  "discussion", "research", "designDefinition", "conceptDirection", "directionPreview",
  "visualDevelopment", "comparison", "deliveryPreparation", "historyAndMemory"
]);
const PROJECT_FOCUS_AREAS = values<ProjectFocusArea>([
  "startAndInput", "exploration", "research", "designDefinition", "directionAndVisual",
  "deliveryPreparation"
]);
const PROJECT_MEMORY_KEYS = values<ProjectMemoryKey>([
  "projectOverview", "designBrief", "userPreferences", "decisionLog", "rejectedDirections",
  "openQuestions", "outputPlan"
]);
const STAGE_RECORD_KEYS = values<StageRecordKey>(PROJECT_FOCUS_AREAS);
const STAGE_SECTION_KEYS = values<StageRecordSectionKey>([
  "goalAndStatus", "outputs", "decisions", "rejected", "preferences", "constraints",
  "openRisks", "nextFocus"
]);
const CONTINUITY_SOURCE_KINDS = values<ContinuitySourceRefKind>([
  "object", "revision", "operation", "branch", "decision", "citation", "deliveryReference", "message"
]);
const CONTINUITY_CATEGORIES = values<ContinuityRecordCategory>([
  "output", "decision", "rejection", "preference", "constraint", "openQuestion",
  "nextFocus", "systemNote"
]);
const CONTINUITY_VALIDITIES = values<ContinuityValidity>([
  "current", "reviewRequired", "superseded", "sourceUnavailable"
]);
const CONTINUITY_ORIGINS = values<ContinuityRecordOrigin>([
  "deterministicEvent", "conversationSemanticPatch"
]);
const CONTINUITY_MANUAL_STATES = values<ContinuityManualState>([
  "active", "notApplicable", "withdrawn"
]);
const SEMANTIC_PATCH_KINDS = values<SemanticPatchKind>([
  "preference", "constraint", "avoidance", "openQuestion", "decisionReason", "rejectionReason"
]);
const SEMANTIC_PATCH_SCOPES = values<SemanticPatchScope>([
  "project", "designDefinition", "direction", "visual"
]);
const OPERATION_TYPES = values<OperationType>([
  "research", "imageGeneration", "designDefinition", "conceptDirection"
]);
const OPERATION_STATUSES = values<OperationStatus>([
  "queued", "preparing", "running", "waiting_for_user", "succeeded", "failed", "cancelled", "interrupted"
]);
const PROPOSAL_STATUSES = values<ProposalStatus>(["pending", "applied", "rejected", "expired"]);
const PROPOSAL_REVIEW_STATES = values<ProposalReviewState>([
  "ready", "sourceChanged", "baseSuperseded", "targetUnavailable"
]);
const PROPOSAL_REVIEW_REASONS = values<ProposalReviewReason>([
  "sourceContentChanged", "sourceInactive", "sourceUnavailable", "baseRevisionSuperseded", "targetUnavailable"
]);
const DECISION_KINDS = values<DecisionKind>([
  "createKeyConclusion", "setKeyConclusionCategory", "setKeyConclusionState", "applyDesignDefinition",
  "applyConceptDirection", "setDefaultReference", "setDirectionStatus", "setImageRole",
  "createDeliveryReference", "replaceDeliveryReference", "refreshDeliveryReference",
  "removeDeliveryReference", "createDeliveryPreparation", "updateDeliverySection",
  "applyDeliverySectionDraft", "setDeliveryGapStatus", "deleteObject"
]);
const DIRECTION_LINEAGE_KINDS = values<DirectionLineageKind>([
  "derivedFromDirection", "splitFromDirection", "mergedFromDirection", "supersedesDirection"
]);
const STAGE_REGION_KEYS = values<StageRegionKey>(["research", "definition", "visual", "delivery"]);
const STAGE_REGION_COLORS = values<StageRegionColorKey>([
  "warmSand", "mistBlue", "sage", "violetGray", "clay", "warmGray"
]);
const STAGE_REGION_BORDERS = values<StageRegionBorderStyle>(["none", "solid", "dashed"]);
const EDIT_MODES = values<GrsImageEditMode>([
  "textToImage", "imageToImage", "directedEdit", "maskedLocalEdit"
]);
const VISUAL_REFERENCE_REASONS = values<VisualReferenceReason>([
  "userExplicit", "selectedSource", "branchRoot", "directParent", "directionRepresentative",
  "defaultReference", "projectReference"
]);
const AGENT_ACTIVITY_KINDS = values<AgentActivityKind>([
  "webSearch", "fileRead", "contextRead", "analysis", "proposal", "imageGeneration",
  "comparison", "workspaceWrite", "confirmation", "other"
]);
const AGENT_TURN_OUTCOMES = values<AgentTurnOutcome>([
  "success", "cancelledBeforeExecution", "failedBeforeExecution", "cancelledDuringProvider",
  "failedDuringProvider", "partialSuccess", "pendingConfirmation"
]);
const PROVIDER_TEXT_PART_KINDS = values<ProviderInputSnapshotTextPartKind>([
  "userDraft", "turnContract", "documentExtract", "other"
]);
const PROVIDER_CACHE_BOUNDARY_REASONS = values<ProviderInputCacheBoundaryReason>([
  "imageInput", "legacyProviderInput", "documentSnapshotUnavailable", "toolProfileChanged",
  "promptContractChanged", "compaction"
]);
const PROVIDER_FRAME_KINDS = values<ProviderContextFrameKind>([
  "projectState", "turnContext", "runtimeConfiguration", "conversationSummary"
]);
const PROVIDER_FRAME_PLACEMENTS = values<ProviderContextFramePlacement>([
  "conversationBaseline", "beforeUser", "afterUser", "beforeAssistant", "afterAssistant"
]);

export function validateCurrentWorkspaceContract(
  value: unknown,
  add: WorkspaceContractIssueAdder
): void {
  const workspace = record(value, "workspace", add);
  if (!workspace) return;

  if (workspace.schemaVersion !== 17) add("schemaVersion", "Expected schemaVersion 17.");
  validateProject(workspace.project, "project", add);
  recordValues(workspace.assets, "assets", add, validateAsset);
  recordValues(workspace.objects, "objects", add, validateMorphoObject);
  array(workspace.relations, "relations", add, validateRelation);
  recordValues(workspace.deliveryReferences, "deliveryReferences", add, validateDeliveryReference);
  recordValues(workspace.deliverySectionDrafts, "deliverySectionDrafts", add, validateDeliverySectionDraft);
  array(workspace.decisionRecords, "decisionRecords", add, validateDecisionRecord);
  recordValues(workspace.operations, "operations", add, validateOperation);
  recordValues(workspace.artifactProposals, "artifactProposals", add, validateArtifactProposal);
  recordValues(workspace.citationSnapshots, "citationSnapshots", add, validateCitation);
  recordValues(workspace.designDefinitionRevisions, "designDefinitionRevisions", add, validateDesignDefinitionRevision);
  recordValues(workspace.directionRevisions, "directionRevisions", add, validateDirectionRevision);
  array(workspace.directionLineage, "directionLineage", add, validateDirectionLineage);
  recordValues(workspace.visualBranches, "visualBranches", add, validateVisualBranch);
  validateWorkingState(workspace.workingState, "workingState", add);
  validateProjectContinuity(workspace.projectContinuity, "projectContinuity", add);
  validateProjectMemory(workspace.projectMemory, "projectMemory", add);
  validateCanvas(workspace.canvas, "canvas", add);
  validateAi(workspace.ai, "ai", add);
  validateUi(workspace.ui, "ui", add);
}

function validateProject(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  string(item.title, `${path}.title`, add);
  string(item.subtitle, `${path}.subtitle`, add);
  optionalString(item.createdAt, `${path}.createdAt`, add);
  optionalString(item.updatedAt, `${path}.updatedAt`, add);
  optionalString(item.lastOpenedAt, `${path}.lastOpenedAt`, add);
  optionalId(item.coverAssetId, `${path}.coverAssetId`, add);
}

function validateAsset(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  string(item.fileName, `${path}.fileName`, add);
  string(item.mimeType, `${path}.mimeType`, add);
  nonNegativeNumber(item.size, `${path}.size`, add);
  string(item.createdAt, `${path}.createdAt`, add);
  string(item.storageKey, `${path}.storageKey`, add);
  enumValue(item.sourceType, `${path}.sourceType`, ASSET_SOURCE_TYPES, add);
  optionalPositiveNumber(item.width, `${path}.width`, add);
  optionalPositiveNumber(item.height, `${path}.height`, add);
  optionalPositiveNumber(item.aspectRatio, `${path}.aspectRatio`, add);
  optionalString(item.url, `${path}.url`, add);
  optionalString(item.domain, `${path}.domain`, add);
}

function validateMorphoObject(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  enumValue(item.type, `${path}.type`, OBJECT_TYPES, add);
  string(item.title, `${path}.title`, add);
  string(item.summary, `${path}.summary`, add);
  enumValue(item.createdBy, `${path}.createdBy`, ["user", "ai"], add);
  enumValue(item.visibility, `${path}.visibility`, VISIBILITIES, add);
  optionalString(item.createdAt, `${path}.createdAt`, add);
  optionalString(item.updatedAt, `${path}.updatedAt`, add);

  switch (item.type) {
    case "image":
      enumValue(item.role, `${path}.role`, IMAGE_ROLES, add);
      optionalId(item.assetId, `${path}.assetId`, add);
      optionalId(item.directionId, `${path}.directionId`, add);
      optionalId(item.visualBranchId, `${path}.visualBranchId`, add);
      optionalBoolean(item.isDefaultReference, `${path}.isDefaultReference`, add);
      optional(item.pendingReview, `${path}.pendingReview`, add, validateVisualReviewMark);
      optional(item.generation, `${path}.generation`, add, validateImageGenerationMetadata);
      break;
    case "file":
      enumValue(item.fileKind, `${path}.fileKind`, ["pdf", "imageSet", "document"], add);
      string(item.sourceLabel, `${path}.sourceLabel`, add);
      for (const key of ["assetId", "extractedAssetId"] as const) optionalId(item[key], `${path}.${key}`, add);
      for (const key of ["fileName", "mimeType", "parsedAt", "parseError"] as const) optionalString(item[key], `${path}.${key}`, add);
      for (const key of ["size", "extractedCharCount", "extractedPageCount", "sourcePageCount"] as const) {
        optionalNonNegativeNumber(item[key], `${path}.${key}`, add);
      }
      optionalBoolean(item.extractionTruncated, `${path}.extractionTruncated`, add);
      optionalEnum(item.parseStatus, `${path}.parseStatus`, ["unparsed", "parsing", "parsed", "failed"], add);
      break;
    case "text":
      string(item.body, `${path}.body`, add);
      break;
    case "link":
      string(item.url, `${path}.url`, add);
      string(item.domain, `${path}.domain`, add);
      optionalString(item.editableTitle, `${path}.editableTitle`, add);
      optionalString(item.description, `${path}.description`, add);
      optionalId(item.assetId, `${path}.assetId`, add);
      break;
    case "imageCollection":
      idArray(item.memberObjectIds, `${path}.memberObjectIds`, add);
      boolean(item.expanded, `${path}.expanded`, add);
      optional(item.pendingReview, `${path}.pendingReview`, add, validateVisualReviewMark);
      break;
    case "research":
      for (const key of ["findings", "opportunities", "constraints", "openQuestions"] as const) {
        stringArray(item[key], `${path}.${key}`, add);
      }
      optionalArray(item.evidence, `${path}.evidence`, add, validateResearchEvidence);
      optional(item.provenance, `${path}.provenance`, add, validateResearchProvenance);
      break;
    case "keyConclusion":
      enumValue(item.category, `${path}.category`, KEY_CONCLUSION_CATEGORIES, add);
      string(item.body, `${path}.body`, add);
      enumValue(item.state, `${path}.state`, ["active", "needsVerification", "superseded", "archived"], add);
      enumValue(item.confidence, `${path}.confidence`, ["supported", "partial", "needsVerification"], add);
      idArray(item.sourceObjectIds, `${path}.sourceObjectIds`, add);
      idArray(item.citationIds, `${path}.citationIds`, add);
      string(item.confirmedAt, `${path}.confirmedAt`, add);
      optionalId(item.supersededById, `${path}.supersededById`, add);
      optionalString(item.note, `${path}.note`, add);
      break;
    case "documentFragment":
      string(item.body, `${path}.body`, add);
      validateDocumentFragmentSource(item.source, `${path}.source`, add);
      break;
    case "proposalDraft":
      id(item.proposalId, `${path}.proposalId`, add);
      enumValue(item.proposalType, `${path}.proposalType`, [
        "researchAnalysis", "designDefinition", "conceptDirection", "deliveryPlan"
      ], add);
      break;
    case "designDefinition":
      string(item.problem, `${path}.problem`, add);
      stringArray(item.principles, `${path}.principles`, add);
      stringArray(item.avoid, `${path}.avoid`, add);
      id(item.currentRevisionId, `${path}.currentRevisionId`, add);
      idArray(item.revisionIds, `${path}.revisionIds`, add);
      boolean(item.isCurrentEffective, `${path}.isCurrentEffective`, add);
      break;
    case "conceptDirection":
      enumValue(item.status, `${path}.status`, ["pendingPreview", "primary", "alternative", "eliminated", "needsReview"], add);
      stringArray(item.keywords, `${path}.keywords`, add);
      id(item.currentRevisionId, `${path}.currentRevisionId`, add);
      idArray(item.revisionIds, `${path}.revisionIds`, add);
      id(item.lineageRootId, `${path}.lineageRootId`, add);
      break;
    case "delivery":
      enumValue(item.format, `${path}.format`, ["board", "presentation"], add);
      array(item.sections, `${path}.sections`, add, validateDeliverySection);
      array(item.gaps, `${path}.gaps`, add, validateDeliveryGap);
      idArray(item.references, `${path}.references`, add);
      break;
  }
}

function validateVisualReviewMark(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  enumValue(item.reason, `${path}.reason`, ["defaultReferenceReplaced"], add);
  id(item.previousDefaultReferenceId, `${path}.previousDefaultReferenceId`, add);
  id(item.newDefaultReferenceId, `${path}.newDefaultReferenceId`, add);
  id(item.decisionId, `${path}.decisionId`, add);
  string(item.markedAt, `${path}.markedAt`, add);
}

function validateImageGenerationMetadata(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  for (const key of ["operationId", "clientRequestId", "providerTaskId", "directionId", "visualBranchId"] as const) {
    optionalId(item[key], `${path}.${key}`, add);
  }
  for (const key of ["modelId", "modelLabel", "aspectRatio", "prompt", "createdAt"] as const) string(item[key], `${path}.${key}`, add);
  for (const key of ["sizeOption", "compiledPrompt", "promptContractVersion", "title", "purpose"] as const) {
    optionalString(item[key], `${path}.${key}`, add);
  }
  optionalEnum(item.editMode, `${path}.editMode`, EDIT_MODES, add);
  idArray(item.referenceObjectIds, `${path}.referenceObjectIds`, add);
  optional(item.referenceResolution, `${path}.referenceResolution`, add, validateVisualReferenceResolution);
  optionalEnum(item.role, `${path}.role`, IMAGE_ROLES, add);
  optional(item.visualIntent, `${path}.visualIntent`, add, validateVisualIntent);
  optional(item.visualPlan, `${path}.visualPlan`, add, validateVisualPlan);
}

function validateResearchEvidence(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  string(item.claim, `${path}.claim`, add);
  idArray(item.sourceObjectIds, `${path}.sourceObjectIds`, add);
  idArray(item.citationIds, `${path}.citationIds`, add);
  enumValue(item.confidence, `${path}.confidence`, ["supported", "partial", "needsVerification"], add);
}

function validateResearchProvenance(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.operationId, `${path}.operationId`, add);
  id(item.proposalId, `${path}.proposalId`, add);
  idArray(item.sourceObjectIds, `${path}.sourceObjectIds`, add);
  idArray(item.citationIds, `${path}.citationIds`, add);
  boolean(item.didUseWebSearch, `${path}.didUseWebSearch`, add);
}

function validateDocumentFragmentSource(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.fileObjectId, `${path}.fileObjectId`, add);
  string(item.fileTitle, `${path}.fileTitle`, add);
  optionalString(item.fileName, `${path}.fileName`, add);
  id(item.sourceExtractAssetId, `${path}.sourceExtractAssetId`, add);
  nonNegativeNumber(item.startOffset, `${path}.startOffset`, add);
  nonNegativeNumber(item.endOffset, `${path}.endOffset`, add);
  idArray(item.blockIds, `${path}.blockIds`, add);
}

function validateDeliverySection(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  string(item.title, `${path}.title`, add);
  optionalString(item.purpose, `${path}.purpose`, add);
  nonNegativeNumber(item.order, `${path}.order`, add);
  idArray(item.referenceIds, `${path}.referenceIds`, add);
  optionalString(item.narrative, `${path}.narrative`, add);
  string(item.createdAt, `${path}.createdAt`, add);
  string(item.updatedAt, `${path}.updatedAt`, add);
}

function validateDeliveryGap(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  string(item.label, `${path}.label`, add);
  optionalId(item.sectionId, `${path}.sectionId`, add);
  enumValue(item.status, `${path}.status`, ["open", "resolved"], add);
  enumValue(item.origin, `${path}.origin`, ["manual", "deliveryDraft"], add);
  string(item.createdAt, `${path}.createdAt`, add);
  string(item.updatedAt, `${path}.updatedAt`, add);
  optionalString(item.resolvedAt, `${path}.resolvedAt`, add);
}

function validateVisualIntent(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  optionalId(item.targetDirectionId, `${path}.targetDirectionId`, add);
  optionalId(item.visualBranchId, `${path}.visualBranchId`, add);
  string(item.title, `${path}.title`, add);
  string(item.purpose, `${path}.purpose`, add);
  idArray(item.requestedReferenceObjectIds, `${path}.requestedReferenceObjectIds`, add);
  optionalBoolean(item.excludeDefaultReference, `${path}.excludeDefaultReference`, add);
  for (const key of ["changeGoals", "preserve", "allowToChange", "productForm", "materialsAndCmf", "environmentAndLighting", "avoid"] as const) {
    stringArray(item[key], `${path}.${key}`, add);
  }
  for (const key of ["composition", "viewpoint", "userPromptRemainder"] as const) optionalString(item[key], `${path}.${key}`, add);
  optionalEnum(item.editMode, `${path}.editMode`, EDIT_MODES, add);
  enumValue(item.role, `${path}.role`, IMAGE_ROLES, add);
}

function validateVisualReferenceResolution(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  idArray(item.resolvedObjectIds, `${path}.resolvedObjectIds`, add);
  array(item.candidates, `${path}.candidates`, add, (raw, candidatePath, issue) => {
    const candidate = record(raw, candidatePath, issue); if (!candidate) return;
    id(candidate.objectId, `${candidatePath}.objectId`, issue);
    enumValue(candidate.reason, `${candidatePath}.reason`, VISUAL_REFERENCE_REASONS, issue);
    number(candidate.priority, `${candidatePath}.priority`, issue);
    optionalId(candidate.sourceDirectionId, `${candidatePath}.sourceDirectionId`, issue);
    optionalId(candidate.targetDirectionId, `${candidatePath}.targetDirectionId`, issue);
    optionalBoolean(candidate.crossDirection, `${candidatePath}.crossDirection`, issue);
    optionalString(candidate.retentionReason, `${candidatePath}.retentionReason`, issue);
    boolean(candidate.included, `${candidatePath}.included`, issue);
    optionalEnum(candidate.omissionReason, `${candidatePath}.omissionReason`, [
      "providerLimit", "duplicate", "unavailable", "directionMismatch", "defaultExcluded"
    ], issue);
  });
  nonNegativeNumber(item.providerLimit, `${path}.providerLimit`, add);
  boolean(item.defaultReferenceExcluded, `${path}.defaultReferenceExcluded`, add);
}

function validateVisualPlan(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  enumValue(item.kind, `${path}.kind`, ["directionPreview", "visualDevelopment"], add);
  array(item.items, `${path}.items`, add, (raw, itemPath, issue) => {
    const planItem = record(raw, itemPath, issue); if (!planItem) return;
    id(planItem.id, `${itemPath}.id`, issue);
    optionalId(planItem.targetDirectionId, `${itemPath}.targetDirectionId`, issue);
    optionalId(planItem.visualBranchId, `${itemPath}.visualBranchId`, issue);
    for (const key of ["title", "purpose", "prompt"] as const) string(planItem[key], `${itemPath}.${key}`, issue);
    idArray(planItem.referenceObjectIds, `${itemPath}.referenceObjectIds`, issue);
    enumValue(planItem.role, `${itemPath}.role`, IMAGE_ROLES, issue);
    optionalEnum(planItem.editMode, `${itemPath}.editMode`, EDIT_MODES, issue);
    optional(planItem.visualIntent, `${itemPath}.visualIntent`, issue, validateVisualIntent);
    optional(planItem.referenceResolution, `${itemPath}.referenceResolution`, issue, validateVisualReferenceResolution);
    optionalString(planItem.promptContractVersion, `${itemPath}.promptContractVersion`, issue);
  });
}

function validateRelation(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  enumValue(item.kind, `${path}.kind`, [
    "source", "supports", "supportsConclusion", "belongsToDirection", "usesReference", "version",
    "defaultReference", "documentFragmentExtractedFromFile", "deliveryReference"
  ], add);
  id(item.fromObjectId, `${path}.fromObjectId`, add);
  id(item.toObjectId, `${path}.toObjectId`, add);
  string(item.note, `${path}.note`, add);
}

function validateDeliveryReference(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  optionalId(item.deliveryObjectId, `${path}.deliveryObjectId`, add);
  optionalId(item.sectionId, `${path}.sectionId`, add);
  optionalNonNegativeNumber(item.order, `${path}.order`, add);
  optionalId(item.sourceObjectId, `${path}.sourceObjectId`, add);
  string(item.createdAt, `${path}.createdAt`, add);
  optionalString(item.updatedAt, `${path}.updatedAt`, add);
  validateDeliveryReferenceSnapshot(item.snapshot, `${path}.snapshot`, add);
  optionalString(item.sourceFingerprint, `${path}.sourceFingerprint`, add);
  optionalId(item.sourceRevisionId, `${path}.sourceRevisionId`, add);
  optionalNonNegativeNumber(item.sourceRevisionNumber, `${path}.sourceRevisionNumber`, add);
  optionalId(item.sourceAssetId, `${path}.sourceAssetId`, add);
  optional(item.editorial, `${path}.editorial`, add, (raw, editorialPath, issue) => {
    const editorial = record(raw, editorialPath, issue); if (!editorial) return;
    optionalString(editorial.caption, `${editorialPath}.caption`, issue);
    optionalString(editorial.note, `${editorialPath}.note`, issue);
  });
}

function validateDeliveryReferenceSnapshot(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  enumValue(item.sourceType, `${path}.sourceType`, OBJECT_TYPES, add);
  string(item.title, `${path}.title`, add);
  optionalString(item.summary, `${path}.summary`, add);
  optionalString(item.body, `${path}.body`, add);
  optionalEnum(item.bodyKind, `${path}.bodyKind`, ["complete", "excerpt"], add);
  optional(item.sourceRevision, `${path}.sourceRevision`, add, (raw, revisionPath, issue) => {
    const revision = record(raw, revisionPath, issue); if (!revision) return;
    id(revision.revisionId, `${revisionPath}.revisionId`, issue);
    positiveNumber(revision.revisionNumber, `${revisionPath}.revisionNumber`, issue);
  });
  optional(item.sourceFile, `${path}.sourceFile`, add, (raw, filePath, issue) => {
    const file = record(raw, filePath, issue); if (!file) return;
    id(file.fileObjectId, `${filePath}.fileObjectId`, issue);
    string(file.title, `${filePath}.title`, issue);
    optionalString(file.fileName, `${filePath}.fileName`, issue);
    optionalId(file.sourceExtractAssetId, `${filePath}.sourceExtractAssetId`, issue);
    optionalNonNegativeNumber(file.startOffset, `${filePath}.startOffset`, issue);
    optionalNonNegativeNumber(file.endOffset, `${filePath}.endOffset`, issue);
  });
  optional(item.previewAsset, `${path}.previewAsset`, add, (raw, previewPath, issue) => {
    const preview = record(raw, previewPath, issue); if (!preview) return;
    optionalId(preview.assetId, `${previewPath}.assetId`, issue);
    string(preview.alt, `${previewPath}.alt`, issue);
  });
}

function validateDeliverySectionDraft(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  for (const key of ["id", "deliveryObjectId", "sectionId", "userMessageId", "assistantMessageId"] as const) id(item[key], `${path}.${key}`, add);
  idArray(item.referenceIds, `${path}.referenceIds`, add);
  const fingerprints = record(item.sourceFingerprints, `${path}.sourceFingerprints`, add);
  if (fingerprints) for (const [key, fingerprint] of Object.entries(fingerprints)) {
    id(key, `${path}.sourceFingerprints.${key}`, add);
    optionalString(fingerprint, `${path}.sourceFingerprints.${key}`, add);
  }
  optionalString(item.title, `${path}.title`, add);
  string(item.narrative, `${path}.narrative`, add);
  array(item.captions, `${path}.captions`, add, (raw, captionPath, issue) => {
    const caption = record(raw, captionPath, issue); if (!caption) return;
    id(caption.referenceId, `${captionPath}.referenceId`, issue);
    string(caption.caption, `${captionPath}.caption`, issue);
  });
  array(item.suggestedGaps, `${path}.suggestedGaps`, add, (raw, gapPath, issue) => {
    const gap = record(raw, gapPath, issue); if (gap) string(gap.label, `${gapPath}.label`, issue);
  });
  enumValue(item.status, `${path}.status`, ["pending", "applied", "discarded"], add);
  string(item.createdAt, `${path}.createdAt`, add);
  string(item.updatedAt, `${path}.updatedAt`, add);
}

function validateDecisionRecord(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  enumValue(item.kind, `${path}.kind`, DECISION_KINDS, add);
  string(item.createdAt, `${path}.createdAt`, add);
  string(item.summary, `${path}.summary`, add);
  optionalString(item.reason, `${path}.reason`, add);
  optional(item.objectSnapshot, `${path}.objectSnapshot`, add, (raw, snapshotPath, issue) => {
    const snapshot = record(raw, snapshotPath, issue); if (!snapshot) return;
    id(snapshot.id, `${snapshotPath}.id`, issue);
    enumValue(snapshot.type, `${snapshotPath}.type`, OBJECT_TYPES, issue);
    string(snapshot.title, `${snapshotPath}.title`, issue);
  });
  idArray(item.relatedObjectIds, `${path}.relatedObjectIds`, add);
  optional(item.comparison, `${path}.comparison`, add, (raw, comparisonPath, issue) => {
    const comparison = record(raw, comparisonPath, issue); if (!comparison) return;
    id(comparison.comparisonAnalysisId, `${comparisonPath}.comparisonAnalysisId`, issue);
    id(comparison.comparisonAssistantMessageId, `${comparisonPath}.comparisonAssistantMessageId`, issue);
    idArray(comparison.comparisonSourceObjectIds, `${comparisonPath}.comparisonSourceObjectIds`, issue);
    optionalString(comparison.userReason, `${comparisonPath}.userReason`, issue);
  });
}

function validateOperation(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  enumValue(item.type, `${path}.type`, OPERATION_TYPES, add);
  id(item.projectId, `${path}.projectId`, add);
  string(item.createdAt, `${path}.createdAt`, add);
  string(item.updatedAt, `${path}.updatedAt`, add);
  enumValue(item.status, `${path}.status`, OPERATION_STATUSES, add);
  string(item.userInput, `${path}.userInput`, add);
  validateOperationInputSnapshot(item.inputSnapshot, `${path}.inputSnapshot`, add);
  const capabilities = record(item.allowedCapabilities, `${path}.allowedCapabilities`, add);
  if (capabilities) {
    boolean(capabilities.webSearch, `${path}.allowedCapabilities.webSearch`, add);
    boolean(capabilities.imagePixels, `${path}.allowedCapabilities.imagePixels`, add);
  }
  array(item.steps, `${path}.steps`, add, (raw, stepPath, issue) => {
    const step = record(raw, stepPath, issue); if (!step) return;
    id(step.id, `${stepPath}.id`, issue);
    enumValue(step.kind, `${stepPath}.kind`, [
      "inputSnapshot", "localCollection", "webSearch", "modelSynthesis", "visualPlan", "proposal",
      "providerSubmit", "providerWait", "assetSave"
    ], issue);
    enumValue(step.status, `${stepPath}.status`, ["succeeded", "skipped", "failed"], issue);
    string(step.summary, `${stepPath}.summary`, issue);
    string(step.createdAt, `${stepPath}.createdAt`, issue);
  });
  array(item.events, `${path}.events`, add, (raw, eventPath, issue) => {
    const event = record(raw, eventPath, issue); if (!event) return;
    id(event.id, `${eventPath}.id`, issue);
    string(event.createdAt, `${eventPath}.createdAt`, issue);
    string(event.summary, `${eventPath}.summary`, issue);
  });
  idArray(item.sourceIds, `${path}.sourceIds`, add);
  idArray(item.proposalIds, `${path}.proposalIds`, add);
  optionalString(item.errorSummary, `${path}.errorSummary`, add);
  boolean(item.retryable, `${path}.retryable`, add);
  optional(item.imageGeneration, `${path}.imageGeneration`, add, validateImageGenerationOperationMetadata);
}

function validateOperationInputSnapshot(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  string(item.userInput, `${path}.userInput`, add);
  idArray(item.selectedObjectIds, `${path}.selectedObjectIds`, add);
  array(item.sourceSnapshots, `${path}.sourceSnapshots`, add, validateSourceSemanticSnapshot);
  array(item.objectSnapshots, `${path}.objectSnapshots`, add, (raw, snapshotPath, issue) => {
    const snapshot = record(raw, snapshotPath, issue); if (!snapshot) return;
    id(snapshot.id, `${snapshotPath}.id`, issue);
    for (const key of ["type", "title", "summary"] as const) string(snapshot[key], `${snapshotPath}.${key}`, issue);
    optionalString(snapshot.body, `${snapshotPath}.body`, issue);
  });
}

function validateImageGenerationOperationMetadata(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.clientRequestId, `${path}.clientRequestId`, add);
  optionalId(item.providerTaskId, `${path}.providerTaskId`, add);
  for (const key of ["modelId", "modelLabel", "aspectRatio"] as const) string(item[key], `${path}.${key}`, add);
  optionalString(item.sizeOption, `${path}.sizeOption`, add);
  idArray(item.referenceObjectIds, `${path}.referenceObjectIds`, add);
  for (const key of ["directionObjectId", "visualBranchId", "resultObjectId"] as const) optionalId(item[key], `${path}.${key}`, add);
  optionalNonNegativeNumber(item.requestedPreviewCount, `${path}.requestedPreviewCount`, add);
  if (item.resultObjectIds !== undefined) idArray(item.resultObjectIds, `${path}.resultObjectIds`, add);
  optional(item.plan, `${path}.plan`, add, validateVisualPlan);
  optionalArray(item.failedItems, `${path}.failedItems`, add, (raw, failedPath, issue) => {
    const failed = record(raw, failedPath, issue); if (!failed) return;
    id(failed.planItemId, `${failedPath}.planItemId`, issue);
    string(failed.reason, `${failedPath}.reason`, issue);
  });
}

function validateArtifactProposal(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  enumValue(item.type, `${path}.type`, ["researchAnalysis", "designDefinition", "conceptDirection", "deliveryPlan"], add);
  optionalId(item.operationId, `${path}.operationId`, add);
  optionalEnum(item.workIntent, `${path}.workIntent`, AI_WORK_INTENTS, add);
  enumValue(item.status, `${path}.status`, PROPOSAL_STATUSES, add);
  optionalEnum(item.reviewState, `${path}.reviewState`, PROPOSAL_REVIEW_STATES, add);
  optionalArray(item.reviewDetails, `${path}.reviewDetails`, add, (raw, detailPath, issue) => {
    const detail = record(raw, detailPath, issue); if (!detail) return;
    id(detail.objectId, `${detailPath}.objectId`, issue);
    string(detail.objectTitle, `${detailPath}.objectTitle`, issue);
    enumValue(detail.reason, `${detailPath}.reason`, PROPOSAL_REVIEW_REASONS, issue);
    string(detail.message, `${detailPath}.message`, issue);
  });
  array(item.sourceSnapshots, `${path}.sourceSnapshots`, add, validateSourceSemanticSnapshot);
  idArray(item.sourceObjectIds, `${path}.sourceObjectIds`, add);
  idArray(item.citationIds, `${path}.citationIds`, add);
  string(item.createdAt, `${path}.createdAt`, add);
  optional(item.canvasPlacement, `${path}.canvasPlacement`, add, validatePoint);
  optionalId(item.appliedObjectId, `${path}.appliedObjectId`, add);
  optionalString(item.rejectedReason, `${path}.rejectedReason`, add);
  optionalString(item.userNote, `${path}.userNote`, add);

  switch (item.type) {
    case "researchAnalysis":
      id(item.operationId, `${path}.operationId`, add);
      for (const key of ["title", "summary"] as const) string(item[key], `${path}.${key}`, add);
      for (const key of ["findings", "opportunities", "constraints", "openQuestions"] as const) stringArray(item[key], `${path}.${key}`, add);
      array(item.evidence, `${path}.evidence`, add, validateResearchEvidence);
      optionalString(item.sourceChangedWarning, `${path}.sourceChangedWarning`, add);
      break;
    case "designDefinition":
      for (const key of ["title", "summary", "projectGoal", "coreProblem"] as const) string(item[key], `${path}.${key}`, add);
      for (const key of ["targetUsers", "primaryScenarios", "designPrinciples", "constraints", "avoidDirections", "opportunities", "openQuestions"] as const) stringArray(item[key], `${path}.${key}`, add);
      optionalId(item.basedOnDesignDefinitionId, `${path}.basedOnDesignDefinitionId`, add);
      optionalId(item.basedOnRevisionId, `${path}.basedOnRevisionId`, add);
      optionalString(item.changeNote, `${path}.changeNote`, add);
      break;
    case "conceptDirection":
      string(item.title, `${path}.title`, add);
      string(item.summary, `${path}.summary`, add);
      enumValue(item.applicationMode, `${path}.applicationMode`, ["create", "revise", "split", "merge"], add);
      optionalId(item.targetDirectionId, `${path}.targetDirectionId`, add);
      idArray(item.parentDirectionIds, `${path}.parentDirectionIds`, add);
      array(item.directions, `${path}.directions`, add, validateConceptDirectionDraft);
      optionalId(item.basedOnDesignDefinitionId, `${path}.basedOnDesignDefinitionId`, add);
      optionalId(item.basedOnRevisionId, `${path}.basedOnRevisionId`, add);
      break;
    case "deliveryPlan":
      string(item.title, `${path}.title`, add);
      string(item.summary, `${path}.summary`, add);
      array(item.items, `${path}.items`, add, (raw, planPath, issue) => {
        const plan = record(raw, planPath, issue); if (!plan) return;
        for (const key of ["title", "purpose", "contentType"] as const) string(plan[key], `${planPath}.${key}`, issue);
        idArray(plan.sourceObjectIds, `${planPath}.sourceObjectIds`, issue);
        optionalString(plan.missingReason, `${planPath}.missingReason`, issue);
      });
      break;
  }
}

function validateConceptDirectionDraft(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  for (const key of ["title", "summary", "conceptStatement", "strategy"] as const) string(item[key], `${path}.${key}`, add);
  for (const key of ["keywords", "differentiators", "visualSignals", "risks", "openQuestions"] as const) stringArray(item[key], `${path}.${key}`, add);
  optionalId(item.basedOnDirectionId, `${path}.basedOnDirectionId`, add);
  optionalEnum(item.lineageKind, `${path}.lineageKind`, DIRECTION_LINEAGE_KINDS, add);
}

function validateSourceSemanticSnapshot(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.objectId, `${path}.objectId`, add);
  string(item.objectType, `${path}.objectType`, add);
  string(item.visibility, `${path}.visibility`, add);
  string(item.semanticFingerprint, `${path}.semanticFingerprint`, add);
}

function validateCitation(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  id(item.operationId, `${path}.operationId`, add);
  string(item.title, `${path}.title`, add);
  optionalString(item.url, `${path}.url`, add);
  optionalString(item.domain, `${path}.domain`, add);
  optionalString(item.snippet, `${path}.snippet`, add);
  string(item.retrievedAt, `${path}.retrievedAt`, add);
}

function validateDesignDefinitionRevision(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  id(item.designDefinitionId, `${path}.designDefinitionId`, add);
  positiveNumber(item.revisionNumber, `${path}.revisionNumber`, add);
  for (const key of ["title", "summary", "projectGoal", "coreProblem", "createdAt"] as const) string(item[key], `${path}.${key}`, add);
  for (const key of ["targetUsers", "primaryScenarios", "designPrinciples", "constraints", "avoidDirections", "opportunities", "openQuestions"] as const) stringArray(item[key], `${path}.${key}`, add);
  idArray(item.sourceObjectIds, `${path}.sourceObjectIds`, add);
  idArray(item.citationIds, `${path}.citationIds`, add);
  optionalId(item.previousRevisionId, `${path}.previousRevisionId`, add);
  optionalString(item.changeNote, `${path}.changeNote`, add);
  boolean(item.isCurrent, `${path}.isCurrent`, add);
}

function validateDirectionRevision(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  id(item.directionId, `${path}.directionId`, add);
  positiveNumber(item.revisionNumber, `${path}.revisionNumber`, add);
  for (const key of ["title", "summary", "conceptStatement", "strategy", "createdAt"] as const) string(item[key], `${path}.${key}`, add);
  for (const key of ["keywords", "differentiators", "visualSignals", "risks", "openQuestions"] as const) stringArray(item[key], `${path}.${key}`, add);
  idArray(item.sourceObjectIds, `${path}.sourceObjectIds`, add);
  idArray(item.citationIds, `${path}.citationIds`, add);
  optionalId(item.basedOnDefinitionRevisionId, `${path}.basedOnDefinitionRevisionId`, add);
  optionalId(item.previousRevisionId, `${path}.previousRevisionId`, add);
  optionalString(item.changeNote, `${path}.changeNote`, add);
  boolean(item.isCurrent, `${path}.isCurrent`, add);
}

function validateDirectionLineage(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  enumValue(item.kind, `${path}.kind`, DIRECTION_LINEAGE_KINDS, add);
  id(item.fromDirectionId, `${path}.fromDirectionId`, add);
  id(item.toDirectionId, `${path}.toDirectionId`, add);
  string(item.createdAt, `${path}.createdAt`, add);
  string(item.note, `${path}.note`, add);
}

function validateVisualBranch(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  id(item.directionId, `${path}.directionId`, add);
  string(item.label, `${path}.label`, add);
  optionalId(item.rootObjectId, `${path}.rootObjectId`, add);
  string(item.createdAt, `${path}.createdAt`, add);
  optionalString(item.archivedAt, `${path}.archivedAt`, add);
}

function validateWorkingState(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  optionalId(item.currentDesignDefinitionId, `${path}.currentDesignDefinitionId`, add);
  enumValue(item.currentDesignDefinitionAvailability, `${path}.currentDesignDefinitionAvailability`, ["available", "hidden", "missing"], add);
  optionalId(item.primaryDirectionId, `${path}.primaryDirectionId`, add);
  for (const key of ["alternativeDirectionIds", "eliminatedDirectionIds", "activeKeyConclusionIds", "recentResearchObjectIds", "openQuestionIds"] as const) {
    idArray(item[key], `${path}.${key}`, add);
  }
  optionalId(item.currentDefaultReferenceId, `${path}.currentDefaultReferenceId`, add);
  const references = record(item.directionReferenceIds, `${path}.directionReferenceIds`, add);
  if (references) for (const [directionId, ids] of Object.entries(references)) {
    id(directionId, `${path}.directionReferenceIds.${directionId}`, add);
    idArray(ids, `${path}.directionReferenceIds.${directionId}`, add);
  }
  string(item.derivedFromRevision, `${path}.derivedFromRevision`, add);
  string(item.lastReconciledAt, `${path}.lastReconciledAt`, add);
}

function validateProjectContinuity(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  if (item.schemaVersion !== 2) add(`${path}.schemaVersion`, "Expected schemaVersion 2.");
  const focus = record(item.currentFocus, `${path}.currentFocus`, add);
  if (focus) {
    enumValue(focus.area, `${path}.currentFocus.area`, PROJECT_FOCUS_AREAS, add);
    string(focus.updatedAt, `${path}.currentFocus.updatedAt`, add);
    enumValue(focus.sourceKind, `${path}.currentFocus.sourceKind`, ["migration", "userAction", "operation", "proposalApplied"], add);
    idArray(focus.sourceObjectIds, `${path}.currentFocus.sourceObjectIds`, add);
    optionalId(focus.sourceOperationId, `${path}.currentFocus.sourceOperationId`, add);
    string(focus.note, `${path}.currentFocus.note`, add);
  }
  array(item.recordEntries, `${path}.recordEntries`, add, validateContinuityEntry);
  string(item.updatedAt, `${path}.updatedAt`, add);
}

function validateContinuityEntry(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  string(item.dedupeKey, `${path}.dedupeKey`, add);
  enumValue(item.origin, `${path}.origin`, CONTINUITY_ORIGINS, add);
  enumValue(item.manualState, `${path}.manualState`, CONTINUITY_MANUAL_STATES, add);
  enumValue(item.stage, `${path}.stage`, STAGE_RECORD_KEYS, add);
  enumValue(item.category, `${path}.category`, CONTINUITY_CATEGORIES, add);
  string(item.summary, `${path}.summary`, add);
  array(item.sourceRefs, `${path}.sourceRefs`, add, validateContinuitySourceRef);
  string(item.createdAt, `${path}.createdAt`, add);
  string(item.updatedAt, `${path}.updatedAt`, add);
  enumValue(item.validity, `${path}.validity`, CONTINUITY_VALIDITIES, add);
  optionalEnum(item.semanticKind, `${path}.semanticKind`, SEMANTIC_PATCH_KINDS, add);
  optionalId(item.sourceMessageId, `${path}.sourceMessageId`, add);
  optionalString(item.evidenceQuote, `${path}.evidenceQuote`, add);
  optionalEnum(item.scope, `${path}.scope`, SEMANTIC_PATCH_SCOPES, add);
  if (item.invalidationReasons !== undefined) stringArray(item.invalidationReasons, `${path}.invalidationReasons`, add);
}

function validateContinuitySourceRef(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  enumValue(item.kind, `${path}.kind`, CONTINUITY_SOURCE_KINDS, add);
  id(item.id, `${path}.id`, add);
  optional(item.snapshot, `${path}.snapshot`, add, (raw, snapshotPath, issue) => {
    const snapshot = record(raw, snapshotPath, issue); if (!snapshot) return;
    string(snapshot.title, `${snapshotPath}.title`, issue);
    optionalEnum(snapshot.objectType, `${snapshotPath}.objectType`, OBJECT_TYPES, issue);
    optionalPositiveNumber(snapshot.revisionNumber, `${snapshotPath}.revisionNumber`, issue);
    optionalString(snapshot.status, `${snapshotPath}.status`, issue);
    optionalEnum(snapshot.visibility, `${snapshotPath}.visibility`, [...VISIBILITIES, "deleted"], issue);
    optionalString(snapshot.summarySnippet, `${snapshotPath}.summarySnippet`, issue);
    optionalString(snapshot.createdAt, `${snapshotPath}.createdAt`, issue);
  });
  optionalEnum(item.sourceAvailability, `${path}.sourceAvailability`, values<ContinuitySourceAvailability>(["active", "hidden", "missing"]), add);
}

function validateProjectMemory(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  if (item.schemaVersion !== 1) add(`${path}.schemaVersion`, "Expected schemaVersion 1.");
  const documents = record(item.documents, `${path}.documents`, add);
  if (documents) {
    for (const requiredKey of PROJECT_MEMORY_KEYS) {
      if (!(requiredKey in documents)) add(`${path}.documents.${requiredKey}`, "Required memory document is missing.");
    }
    for (const [key, raw] of Object.entries(documents)) {
      enumValue(key, `${path}.documents.${key}`, PROJECT_MEMORY_KEYS, add);
      const document = record(raw, `${path}.documents.${key}`, add); if (!document) continue;
      enumValue(document.key, `${path}.documents.${key}.key`, PROJECT_MEMORY_KEYS, add);
      string(document.title, `${path}.documents.${key}.title`, add);
      optionalId(document.currentRevisionId, `${path}.documents.${key}.currentRevisionId`, add);
      optionalString(document.updatedAt, `${path}.documents.${key}.updatedAt`, add);
    }
  }
  recordValues(item.revisions, `${path}.revisions`, add, validateProjectMemoryRevision);
  const stageRecords = record(item.stageRecords, `${path}.stageRecords`, add);
  if (stageRecords) for (const [key, raw] of Object.entries(stageRecords)) {
    enumValue(key, `${path}.stageRecords.${key}`, STAGE_RECORD_KEYS, add);
    const stage = record(raw, `${path}.stageRecords.${key}`, add); if (!stage) continue;
    enumValue(stage.stage, `${path}.stageRecords.${key}.stage`, STAGE_RECORD_KEYS, add);
    optionalId(stage.currentRevisionId, `${path}.stageRecords.${key}.currentRevisionId`, add);
    optionalString(stage.updatedAt, `${path}.stageRecords.${key}.updatedAt`, add);
  }
  recordValues(item.stageRevisions, `${path}.stageRevisions`, add, validateStageRevision);
  string(item.updatedAt, `${path}.updatedAt`, add);
}

function validateProjectMemoryRevision(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  enumValue(item.documentKey, `${path}.documentKey`, PROJECT_MEMORY_KEYS, add);
  optionalId(item.previousRevisionId, `${path}.previousRevisionId`, add);
  array(item.sections, `${path}.sections`, add, validateMemorySection);
  array(item.sourceRefs, `${path}.sourceRefs`, add, validateContinuitySourceRef);
  enumValue(item.basis, `${path}.basis`, ["deterministic", "userExplicit", "userConfirmed", "mixed"], add);
  string(item.createdAt, `${path}.createdAt`, add);
  boolean(item.reviewRequired, `${path}.reviewRequired`, add);
}

function validateMemorySection(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  string(item.key, `${path}.key`, add);
  string(item.title, `${path}.title`, add);
  stringArray(item.items, `${path}.items`, add);
}

function validateStageRevision(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  enumValue(item.stage, `${path}.stage`, STAGE_RECORD_KEYS, add);
  optionalId(item.previousRevisionId, `${path}.previousRevisionId`, add);
  const sections = record(item.sections, `${path}.sections`, add);
  if (sections) for (const [key, entries] of Object.entries(sections)) {
    enumValue(key, `${path}.sections.${key}`, STAGE_SECTION_KEYS, add);
    stringArray(entries, `${path}.sections.${key}`, add);
  }
  array(item.sourceRefs, `${path}.sourceRefs`, add, validateContinuitySourceRef);
  string(item.createdAt, `${path}.createdAt`, add);
  boolean(item.reviewRequired, `${path}.reviewRequired`, add);
}

function validateCanvas(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  validateView(item.view, `${path}.view`, add);
  array(item.instances, `${path}.instances`, add, (raw, instancePath, issue) => {
    const instance = record(raw, instancePath, issue); if (!instance) return;
    id(instance.id, `${instancePath}.id`, issue);
    id(instance.objectId, `${instancePath}.objectId`, issue);
    validatePoint(instance.position, `${instancePath}.position`, issue);
    const size = record(instance.size, `${instancePath}.size`, issue);
    if (size) {
      positiveNumber(size.w, `${instancePath}.size.w`, issue);
      positiveNumber(size.h, `${instancePath}.size.h`, issue);
    }
  });
  optionalArray(item.stageRegions, `${path}.stageRegions`, add, validateStageRegion);
}

function validateStageRegion(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  enumValue(item.key, `${path}.key`, STAGE_REGION_KEYS, add);
  string(item.title, `${path}.title`, add);
  number(item.x, `${path}.x`, add);
  number(item.y, `${path}.y`, add);
  positiveNumber(item.w, `${path}.w`, add);
  positiveNumber(item.h, `${path}.h`, add);
  idArray(item.memberObjectIds, `${path}.memberObjectIds`, add);
  optionalEnum(item.colorKey, `${path}.colorKey`, STAGE_REGION_COLORS, add);
  optionalNonNegativeNumber(item.fillOpacity, `${path}.fillOpacity`, add);
  optionalBoolean(item.backgroundVisible, `${path}.backgroundVisible`, add);
  optionalEnum(item.borderStyle, `${path}.borderStyle`, STAGE_REGION_BORDERS, add);
  optionalBoolean(item.locked, `${path}.locked`, add);
  optionalBoolean(item.isActivated, `${path}.isActivated`, add);
}

function validateAi(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  array(item.messages, `${path}.messages`, add, validateAiMessage);
  validateConversationCompaction(item.conversationCompaction, `${path}.conversationCompaction`, add);
  recordValues(item.conversationSummaryRevisions, `${path}.conversationSummaryRevisions`, add, validateConversationSummaryRevision);
  optionalArray(item.providerContextFrames, `${path}.providerContextFrames`, add, validateProviderContextFrame);
  if (item.comparisonAnalyses !== undefined) recordValues(item.comparisonAnalyses, `${path}.comparisonAnalyses`, add, validateComparisonAnalysis);
}

function validateAiMessage(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  enumValue(item.role, `${path}.role`, ["assistant", "user"], add);
  string(item.body, `${path}.body`, add);
  optionalString(item.createdAt, `${path}.createdAt`, add);
  optionalEnum(item.status, `${path}.status`, ["streaming", "done", "failed", "cancelled"], add);
  optionalEnum(item.contextVisibility, `${path}.contextVisibility`, ["model", "uiOnly"], add);
  if (item.contextObjectIds !== undefined) idArray(item.contextObjectIds, `${path}.contextObjectIds`, add);
  optionalEnum(item.taskMode, `${path}.taskMode`, AI_TASK_MODES, add);
  optionalEnum(item.recommendedTaskMode, `${path}.recommendedTaskMode`, AI_TASK_MODES, add);
  optionalEnum(item.workIntent, `${path}.workIntent`, AI_WORK_INTENTS, add);
  optionalEnum(item.recommendedWorkIntent, `${path}.recommendedWorkIntent`, AI_WORK_INTENTS, add);
  for (const key of ["operationId", "proposalId", "conversationSummaryRevisionId", "comparisonAnalysisId", "agentTurnId", "pairedMessageId"] as const) optionalId(item[key], `${path}.${key}`, add);
  for (const key of ["citationIds", "continuityEntryIds"] as const) if (item[key] !== undefined) idArray(item[key], `${path}.${key}`, add);
  if (item.memoryUpdateKeys !== undefined) enumArray(item.memoryUpdateKeys, `${path}.memoryUpdateKeys`, PROJECT_MEMORY_KEYS, add);
  if (item.stageRecordUpdateKeys !== undefined) enumArray(item.stageRecordUpdateKeys, `${path}.stageRecordUpdateKeys`, STAGE_RECORD_KEYS, add);
  optionalString(item.promptContractVersion, `${path}.promptContractVersion`, add);
  optional(item.providerInputSnapshot, `${path}.providerInputSnapshot`, add, validateProviderInputSnapshot);
  optional(item.providerOutputSnapshot, `${path}.providerOutputSnapshot`, add, validateProviderOutputSnapshot);
  optionalEnum(item.taskStrategy, `${path}.taskStrategy`, AGENT_TASK_STRATEGIES, add);
  optional(item.agentTrace, `${path}.agentTrace`, add, validateAgentTrace);
  optionalEnum(item.agentTurnOutcome, `${path}.agentTurnOutcome`, AGENT_TURN_OUTCOMES, add);
  optionalString(item.agentTurnOutcomeSummary, `${path}.agentTurnOutcomeSummary`, add);
  optionalString(item.error, `${path}.error`, add);
}

function validateProviderInputSnapshot(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  if (item.schemaVersion !== 1) add(`${path}.schemaVersion`, "Expected schemaVersion 1.");
  string(item.promptContractVersion, `${path}.promptContractVersion`, add);
  array(item.textParts, `${path}.textParts`, add, (raw, partPath, issue) => {
    const part = record(raw, partPath, issue); if (!part) return;
    enumValue(part.kind, `${partPath}.kind`, PROVIDER_TEXT_PART_KINDS, issue);
    string(part.text, `${partPath}.text`, issue);
  });
  array(item.attachmentRefs, `${path}.attachmentRefs`, add, (raw, refPath, issue) => {
    const ref = record(raw, refPath, issue); if (!ref) return;
    id(ref.objectId, `${refPath}.objectId`, issue);
    optionalId(ref.assetId, `${refPath}.assetId`, issue);
    optionalString(ref.contentHash, `${refPath}.contentHash`, issue);
    optionalString(ref.mimeType, `${refPath}.mimeType`, issue);
  });
  string(item.serializedTextHash, `${path}.serializedTextHash`, add);
  optionalEnum(item.cacheBoundaryReason, `${path}.cacheBoundaryReason`, PROVIDER_CACHE_BOUNDARY_REASONS, add);
}

function validateProviderOutputSnapshot(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  if (item.schemaVersion !== 1) add(`${path}.schemaVersion`, "Expected schemaVersion 1.");
  string(item.text, `${path}.text`, add);
  string(item.contentHash, `${path}.contentHash`, add);
}

function validateAgentTrace(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  string(item.startedAt, `${path}.startedAt`, add);
  optionalString(item.completedAt, `${path}.completedAt`, add);
  array(item.parts, `${path}.parts`, add, validateAgentPart);
  enumValue(item.status, `${path}.status`, ["streaming", "done", "failed", "cancelled"], add);
  optionalId(item.agentTurnId, `${path}.agentTurnId`, add);
  optionalId(item.responseId, `${path}.responseId`, add);
  optional(item.providerDiagnostics, `${path}.providerDiagnostics`, add, validateProviderDiagnostics);
}

function validateAgentPart(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  enumValue(item.type, `${path}.type`, ["reasoning", "commentary", "toolActivity"], add);
  optionalId(item.attemptId, `${path}.attemptId`, add);
  if (item.type === "reasoning" || item.type === "commentary") {
    string(item.text, `${path}.text`, add);
    enumValue(item.state, `${path}.state`, ["streaming", "done"], add);
    string(item.createdAt, `${path}.createdAt`, add);
  } else if (item.type === "toolActivity") {
    id(item.toolCallId, `${path}.toolCallId`, add);
    string(item.toolName, `${path}.toolName`, add);
    enumValue(item.activityKind, `${path}.activityKind`, AGENT_ACTIVITY_KINDS, add);
    string(item.label, `${path}.label`, add);
    optionalString(item.detail, `${path}.detail`, add);
    enumValue(item.state, `${path}.state`, ["running", "done", "failed"], add);
    string(item.startedAt, `${path}.startedAt`, add);
    optionalString(item.completedAt, `${path}.completedAt`, add);
    optionalEnum(item.source, `${path}.source`, ["provider", "local"], add);
  }
}

function validateProviderDiagnostics(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  optionalString(item.promptContractVersion, `${path}.promptContractVersion`, add);
  optionalEnum(item.toolProfile, `${path}.toolProfile`, ["standard", "standardWithWebSearch", "conversationSummary"], add);
  optionalNonNegativeNumber(item.cachedInputTokens, `${path}.cachedInputTokens`, add);
  optionalNonNegativeNumber(item.uncachedInputTokens, `${path}.uncachedInputTokens`, add);
  optionalNonNegativeNumber(item.cacheHitRatio, `${path}.cacheHitRatio`, add);
  optionalBoolean(item.providerCacheKeyEnabled, `${path}.providerCacheKeyEnabled`, add);
  optionalEnum(item.providerCacheRetention, `${path}.providerCacheRetention`, ["24h"], add);
  optionalEnum(item.cacheStatus, `${path}.cacheStatus`, ["unavailable", "miss", "partialHit", "fullHit"], add);
}

function validateConversationCompaction(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  optionalId(item.summaryRevisionId, `${path}.summaryRevisionId`, add);
  optionalId(item.coveredThroughMessageId, `${path}.coveredThroughMessageId`, add);
  nonNegativeNumber(item.coveredMessageCount, `${path}.coveredMessageCount`, add);
  optionalString(item.updatedAt, `${path}.updatedAt`, add);
  optionalNonNegativeNumber(item.estimatedInputTokens, `${path}.estimatedInputTokens`, add);
  optionalString(item.sourceMessageIdsHash, `${path}.sourceMessageIdsHash`, add);
}

function validateConversationSummaryRevision(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  optionalId(item.previousRevisionId, `${path}.previousRevisionId`, add);
  validateConversationSummary(item.summary, `${path}.summary`, add);
  id(item.sourceStartMessageId, `${path}.sourceStartMessageId`, add);
  id(item.sourceEndMessageId, `${path}.sourceEndMessageId`, add);
  nonNegativeNumber(item.sourceMessageCount, `${path}.sourceMessageCount`, add);
  string(item.sourceMessageIdsHash, `${path}.sourceMessageIdsHash`, add);
  optionalNonNegativeNumber(item.estimatedInputTokens, `${path}.estimatedInputTokens`, add);
  string(item.createdAt, `${path}.createdAt`, add);
}

function validateConversationSummary(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  string(item.threadGoal, `${path}.threadGoal`, add);
  for (const key of ["establishedContext", "decisionsAndReasons", "activeWork", "unresolvedQuestions", "referencedObjects"] as const) {
    stringArray(item[key], `${path}.${key}`, add);
  }
  optionalString(item.nextTurnAnchor, `${path}.nextTurnAnchor`, add);
}

function validateProviderContextFrame(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  enumValue(item.kind, `${path}.kind`, PROVIDER_FRAME_KINDS, add);
  string(item.createdAt, `${path}.createdAt`, add);
  nonNegativeNumber(item.sequence, `${path}.sequence`, add);
  enumValue(item.placement, `${path}.placement`, PROVIDER_FRAME_PLACEMENTS, add);
  string(item.promptContractVersion, `${path}.promptContractVersion`, add);
  optionalEnum(item.taskStrategy, `${path}.taskStrategy`, AGENT_TASK_STRATEGIES, add);
  for (const key of ["projectMemoryRevisionIds", "stageRecordRevisionIds", "directionRevisionIds", "selectedObjectIds", "relatedObjectIds"] as const) {
    idArray(item[key], `${path}.${key}`, add);
  }
  for (const key of ["designDefinitionRevisionId", "defaultReferenceObjectId", "supersedesFrameId", "anchorMessageId", "summaryRevisionId"] as const) {
    optionalId(item[key], `${path}.${key}`, add);
  }
  string(item.renderedText, `${path}.renderedText`, add);
  string(item.contentHash, `${path}.contentHash`, add);
  enumValue(item.contextVisibility, `${path}.contextVisibility`, ["providerOnly"], add);
  array(item.sourceRefs, `${path}.sourceRefs`, add, (raw, refPath, issue) => {
    const ref = record(raw, refPath, issue); if (!ref) return;
    string(ref.kind, `${refPath}.kind`, issue);
    id(ref.id, `${refPath}.id`, issue);
    optionalString(ref.title, `${refPath}.title`, issue);
  });
  string(item.reason, `${path}.reason`, add);
  optional(item.runtimeItem, `${path}.runtimeItem`, add, validateCanonicalRuntimeItem);
}

function validateCanonicalRuntimeItem(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  string(item.contentHash, `${path}.contentHash`, add);
  enumValue(item.effectiveToolProfile, `${path}.effectiveToolProfile`, ["standard", "standardWithWebSearch", "conversationSummary"], add);
  enumValue(item.mode, `${path}.mode`, ["auto", "confirm"], add);
  string(item.promptContractVersion, `${path}.promptContractVersion`, add);
  enumValue(item.placement, `${path}.placement`, ["afterStableSystem"], add);
  positiveNumber(item.sequence, `${path}.sequence`, add);
  string(item.renderedText, `${path}.renderedText`, add);
  optionalId(item.predecessorItemId, `${path}.predecessorItemId`, add);
}

function validateComparisonAnalysis(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.id, `${path}.id`, add);
  id(item.assistantMessageId, `${path}.assistantMessageId`, add);
  id(item.userMessageId, `${path}.userMessageId`, add);
  string(item.createdAt, `${path}.createdAt`, add);
  string(item.updatedAt, `${path}.updatedAt`, add);
  idArray(item.sourceObjectIds, `${path}.sourceObjectIds`, add);
  array(item.sourceRefs, `${path}.sourceRefs`, add, (raw, refPath, issue) => {
    const ref = record(raw, refPath, issue); if (!ref) return;
    id(ref.objectId, `${refPath}.objectId`, issue);
    enumValue(ref.objectType, `${refPath}.objectType`, OBJECT_TYPES, issue);
    string(ref.title, `${refPath}.title`, issue);
    string(ref.summary, `${refPath}.summary`, issue);
    enumValue(ref.availability, `${refPath}.availability`, ["active", "hidden", "missing"], issue);
  });
  string(item.comparisonGoal, `${path}.comparisonGoal`, add);
  string(item.conclusionSummary, `${path}.conclusionSummary`, add);
  array(item.objectComparisons, `${path}.objectComparisons`, add, validateComparisonObjectEntry);
  stringArray(item.recommendedQuestions, `${path}.recommendedQuestions`, add);
  stringArray(item.evidenceLimits, `${path}.evidenceLimits`, add);
  optional(item.keyConclusionCandidate, `${path}.keyConclusionCandidate`, add, validateComparisonCandidate);
}

function validateComparisonObjectEntry(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  id(item.objectId, `${path}.objectId`, add);
  string(item.title, `${path}.title`, add);
  optionalEnum(item.evidenceBasis, `${path}.evidenceBasis`, ["pixels", "objectSummary", "documentExtract", "documentFragment"], add);
  string(item.summary, `${path}.summary`, add);
  stringArray(item.strengths, `${path}.strengths`, add);
  stringArray(item.risks, `${path}.risks`, add);
  stringArray(item.evidence, `${path}.evidence`, add);
}

function validateComparisonCandidate(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  for (const key of ["title", "summary", "body"] as const) string(item[key], `${path}.${key}`, add);
  enumValue(item.category, `${path}.category`, KEY_CONCLUSION_CATEGORIES, add);
  idArray(item.sourceObjectIds, `${path}.sourceObjectIds`, add);
  array(item.evidence, `${path}.evidence`, add, (raw, evidencePath, issue) => {
    const evidence = record(raw, evidencePath, issue); if (!evidence) return;
    id(evidence.objectId, `${evidencePath}.objectId`, issue);
    string(evidence.label, `${evidencePath}.label`, issue);
    string(evidence.evidence, `${evidencePath}.evidence`, issue);
  });
  enumValue(item.confidence, `${path}.confidence`, ["supported", "partial", "needsVerification"], add);
  optionalString(item.note, `${path}.note`, add);
}

function validateUi(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  enumValue(item.activeDrawer, `${path}.activeDrawer`, ["map", "assets", "hidden", "search", "records", null], add);
  boolean(item.aiOpen, `${path}.aiOpen`, add);
  idArray(item.lastSelectionIds, `${path}.lastSelectionIds`, add);
  validateView(item.canvasView, `${path}.canvasView`, add);
  enumValue(item.workIntent, `${path}.workIntent`, AI_WORK_INTENTS, add);
}

function validateView(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  number(item.x, `${path}.x`, add);
  number(item.y, `${path}.y`, add);
  positiveNumber(item.zoom, `${path}.zoom`, add);
}

function validatePoint(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  const item = record(value, path, add); if (!item) return;
  number(item.x, `${path}.x`, add);
  number(item.y, `${path}.y`, add);
}

function values<T extends string>(input: readonly T[]): readonly T[] {
  return input;
}

function record(value: unknown, path: string, add: WorkspaceContractIssueAdder): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    add(path, "Expected an object.");
    return null;
  }
  return value as Record<string, unknown>;
}

function recordValues(
  value: unknown,
  path: string,
  add: WorkspaceContractIssueAdder,
  validate: (value: unknown, path: string, add: WorkspaceContractIssueAdder) => void
): void {
  const items = record(value, path, add); if (!items) return;
  for (const [key, item] of Object.entries(items)) validate(item, `${path}.${key}`, add);
}

function array(
  value: unknown,
  path: string,
  add: WorkspaceContractIssueAdder,
  validate: (value: unknown, path: string, add: WorkspaceContractIssueAdder) => void
): void {
  if (!Array.isArray(value)) {
    add(path, "Expected an array.");
    return;
  }
  value.forEach((item, index) => validate(item, `${path}.${index}`, add));
}

function optionalArray(
  value: unknown,
  path: string,
  add: WorkspaceContractIssueAdder,
  validate: (value: unknown, path: string, add: WorkspaceContractIssueAdder) => void
): void {
  if (value !== undefined) array(value, path, add, validate);
}

function optional(
  value: unknown,
  path: string,
  add: WorkspaceContractIssueAdder,
  validate: (value: unknown, path: string, add: WorkspaceContractIssueAdder) => void
): void {
  if (value !== undefined) validate(value, path, add);
}

function string(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  if (typeof value !== "string") add(path, "Expected a string.");
}

function optionalString(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  if (value !== undefined) string(value, path, add);
}

function id(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) add(path, "Expected a bounded non-empty id.");
}

function optionalId(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  if (value !== undefined) id(value, path, add);
}

function boolean(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  if (typeof value !== "boolean") add(path, "Expected a boolean.");
}

function optionalBoolean(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  if (value !== undefined) boolean(value, path, add);
}

function number(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  if (typeof value !== "number" || !Number.isFinite(value)) add(path, "Expected a finite number.");
}

function nonNegativeNumber(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) add(path, "Expected a non-negative finite number.");
}

function positiveNumber(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) add(path, "Expected a positive finite number.");
}

function optionalNonNegativeNumber(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  if (value !== undefined) nonNegativeNumber(value, path, add);
}

function optionalPositiveNumber(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  if (value !== undefined) positiveNumber(value, path, add);
}

function enumValue<T>(value: unknown, path: string, allowed: readonly T[], add: WorkspaceContractIssueAdder): void {
  if (!allowed.includes(value as T)) add(path, "Value is outside the allowed set.");
}

function optionalEnum<T>(value: unknown, path: string, allowed: readonly T[], add: WorkspaceContractIssueAdder): void {
  if (value !== undefined) enumValue(value, path, allowed, add);
}

function enumArray<T>(value: unknown, path: string, allowed: readonly T[], add: WorkspaceContractIssueAdder): void {
  array(value, path, add, (item, itemPath, issue) => enumValue(item, itemPath, allowed, issue));
}

function stringArray(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  array(value, path, add, (item, itemPath, issue) => string(item, itemPath, issue));
}

function idArray(value: unknown, path: string, add: WorkspaceContractIssueAdder): void {
  array(value, path, add, (item, itemPath, issue) => id(item, itemPath, issue));
}
