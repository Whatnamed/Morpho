import type { MorphoObject, MorphoWorkspace } from "./types";
import { validateCurrentWorkspaceContract } from "./currentWorkspaceContractValidation";

export type CurrentWorkspaceValidationIssue = Readonly<{
  path: string;
  message: string;
}>;

export type CurrentWorkspaceValidationResult =
  | { status: "ok"; workspace: MorphoWorkspace }
  | { status: "failed"; reason: string; issues: CurrentWorkspaceValidationIssue[] };

const MAX_ISSUES = 64;
const MAX_STRUCTURE_NODES = 500_000;
const MAX_STRUCTURE_DEPTH = 32;
const MAX_STRING_CHARS = 2_000_000;
const MAX_ID_CHARS = 512;

const OBJECT_TYPES = new Set([
  "image", "file", "text", "link", "imageCollection", "research", "keyConclusion",
  "documentFragment", "proposalDraft", "designDefinition", "conceptDirection", "delivery"
]);
const VISIBILITIES = new Set(["active", "hidden"]);
const CREATED_BY = new Set(["user", "ai"]);

export function validateCurrentMorphoWorkspace(value: unknown): CurrentWorkspaceValidationResult {
  const issues: CurrentWorkspaceValidationIssue[] = [];
  const issuePaths = new Set<string>();
  const add = (path: string, message: string) => {
    if (issues.length < MAX_ISSUES && !issuePaths.has(path)) {
      issuePaths.add(path);
      issues.push({ path, message });
    }
  };

  validateSafeStructure(value, add);
  validateCurrentWorkspaceContract(value, add);
  if (!isRecord(value)) {
    add("workspace", "Current workspace must be an object.");
    return failed(issues);
  }
  if (value.schemaVersion !== 17) add("schemaVersion", "Current workspace schemaVersion must be 17.");

  const project = requireRecord(value.project, "project", add);
  const objects = requireRecord(value.objects, "objects", add);
  const assets = requireRecord(value.assets, "assets", add);
  const deliveryReferences = requireRecord(value.deliveryReferences, "deliveryReferences", add);
  const deliverySectionDrafts = requireRecord(value.deliverySectionDrafts, "deliverySectionDrafts", add);
  const operations = requireRecord(value.operations, "operations", add);
  const artifactProposals = requireRecord(value.artifactProposals, "artifactProposals", add);
  const citationSnapshots = requireRecord(value.citationSnapshots, "citationSnapshots", add);
  const definitionRevisions = requireRecord(value.designDefinitionRevisions, "designDefinitionRevisions", add);
  const directionRevisions = requireRecord(value.directionRevisions, "directionRevisions", add);
  const visualBranches = requireRecord(value.visualBranches, "visualBranches", add);
  const workingState = requireRecord(value.workingState, "workingState", add);
  const continuity = requireRecord(value.projectContinuity, "projectContinuity", add);
  const memory = requireRecord(value.projectMemory, "projectMemory", add);
  const canvas = requireRecord(value.canvas, "canvas", add);
  const ai = requireRecord(value.ai, "ai", add);
  const ui = requireRecord(value.ui, "ui", add);

  if (project) validateProject(project, assets, add);
  if (assets) validateAssets(assets, add);
  if (objects) validateObjects(objects, assets, artifactProposals, definitionRevisions, directionRevisions, visualBranches, add);
  validateArray(value.relations, "relations", add, (item, path) => validateRelation(item, path, objects, add));
  if (deliveryReferences) validateDeliveryReferences(deliveryReferences, objects, assets, add);
  if (deliverySectionDrafts) validateDeliverySectionDrafts(deliverySectionDrafts, objects, deliveryReferences, add);
  validateDecisionRecords(value.decisionRecords, add);
  if (operations) validateOperations(operations, project?.id, add);
  if (artifactProposals) validateArtifactProposals(artifactProposals, objects, add);
  if (citationSnapshots) validateCitationSnapshots(citationSnapshots, operations, add);
  if (definitionRevisions) validateDefinitionRevisions(definitionRevisions, objects, add);
  if (directionRevisions) validateDirectionRevisions(directionRevisions, objects, definitionRevisions, add);
  validateArray(value.directionLineage, "directionLineage", add, (item, path) => validateDirectionLineage(item, path, objects, add));
  if (visualBranches) validateVisualBranches(visualBranches, objects, add);
  if (workingState) validateWorkingState(workingState, objects, add);
  if (continuity) validateContinuity(continuity, add);
  if (memory) validateMemory(memory, add);
  if (canvas) validateCanvas(canvas, objects, add);
  if (ai) validateAi(ai, objects, add);
  if (ui) validateUi(ui, objects, add);

  return issues.length === 0
    ? { status: "ok", workspace: value as MorphoWorkspace }
    : failed(issues);
}

function validateProject(project: Record<string, unknown>, assets: Record<string, unknown> | null, add: AddIssue): void {
  requireId(project.id, "project.id", add);
  requireString(project.title, "project.title", add);
  requireString(project.subtitle, "project.subtitle", add);
  optionalString(project.createdAt, "project.createdAt", add);
  optionalString(project.updatedAt, "project.updatedAt", add);
  optionalString(project.lastOpenedAt, "project.lastOpenedAt", add);
  if (project.coverAssetId !== undefined) {
    requireId(project.coverAssetId, "project.coverAssetId", add);
    if (typeof project.coverAssetId === "string" && assets && !assets[project.coverAssetId]) {
      add("project.coverAssetId", "Project cover asset does not exist.");
    }
  }
}

function validateAssets(assets: Record<string, unknown>, add: AddIssue): void {
  for (const [assetId, raw] of Object.entries(assets)) {
    const path = `assets.${assetId}`;
    const asset = requireRecord(raw, path, add);
    if (!asset) continue;
    requireKeyId(assetId, asset.id, path, add);
    requireString(asset.fileName, `${path}.fileName`, add);
    requireString(asset.mimeType, `${path}.mimeType`, add);
    requireFiniteNonNegative(asset.size, `${path}.size`, add);
    requireString(asset.createdAt, `${path}.createdAt`, add);
    requireString(asset.storageKey, `${path}.storageKey`, add);
    if (!["originalImage", "originalFile", "originalLink", "aiGeneratedImage", "documentExtract"].includes(String(asset.sourceType))) {
      add(`${path}.sourceType`, "Asset sourceType is invalid.");
    }
    for (const field of ["width", "height", "aspectRatio"] as const) {
      if (asset[field] !== undefined) requireFinitePositive(asset[field], `${path}.${field}`, add);
    }
    optionalString(asset.url, `${path}.url`, add);
    optionalString(asset.domain, `${path}.domain`, add);
  }
}

function validateObjects(
  objects: Record<string, unknown>,
  assets: Record<string, unknown> | null,
  proposals: Record<string, unknown> | null,
  definitions: Record<string, unknown> | null,
  directions: Record<string, unknown> | null,
  branches: Record<string, unknown> | null,
  add: AddIssue
): void {
  for (const [objectId, raw] of Object.entries(objects)) {
    const path = `objects.${objectId}`;
    const object = requireRecord(raw, path, add);
    if (!object) continue;
    requireKeyId(objectId, object.id, path, add);
    if (!OBJECT_TYPES.has(String(object.type))) add(`${path}.type`, "Morpho object type is invalid.");
    requireString(object.title, `${path}.title`, add);
    requireString(object.summary, `${path}.summary`, add);
    if (!CREATED_BY.has(String(object.createdBy))) add(`${path}.createdBy`, "Object createdBy is invalid.");
    if (!VISIBILITIES.has(String(object.visibility))) add(`${path}.visibility`, "Object visibility is invalid.");
    optionalString(object.createdAt, `${path}.createdAt`, add);
    optionalString(object.updatedAt, `${path}.updatedAt`, add);
    validateObjectVariant(object, path, objects, assets, proposals, definitions, directions, branches, add);
  }
}

function validateObjectVariant(
  object: Record<string, unknown>, path: string, objects: Record<string, unknown>, assets: Record<string, unknown> | null,
  proposals: Record<string, unknown> | null, definitions: Record<string, unknown> | null,
  directions: Record<string, unknown> | null, branches: Record<string, unknown> | null, add: AddIssue
): void {
  switch (object.type) {
    case "image":
      requireEnum(object.role, `${path}.role`, ["reference", "preview", "conceptImage", "primaryVisual", "sceneVisual", "cmfStudy", "detailStudy", "structureDiagram", "interactionDiagram", "deliveryAsset"], add);
      validateOptionalRef(object.assetId, `${path}.assetId`, assets, "Image asset", add);
      validateOptionalObjectRef(object.directionId, `${path}.directionId`, objects, "conceptDirection", add);
      validateOptionalRef(object.visualBranchId, `${path}.visualBranchId`, branches, "Visual branch", add);
      optionalBoolean(object.isDefaultReference, `${path}.isDefaultReference`, add);
      break;
    case "file":
      requireEnum(object.fileKind, `${path}.fileKind`, ["pdf", "imageSet", "document"], add);
      requireString(object.sourceLabel, `${path}.sourceLabel`, add);
      validateOptionalRef(object.assetId, `${path}.assetId`, assets, "File asset", add);
      validateOptionalRef(object.extractedAssetId, `${path}.extractedAssetId`, assets, "Document extract asset", add);
      optionalFiniteNonNegative(object.size, `${path}.size`, add);
      optionalFiniteNonNegative(object.extractedCharCount, `${path}.extractedCharCount`, add);
      optionalFiniteNonNegative(object.extractedPageCount, `${path}.extractedPageCount`, add);
      optionalFiniteNonNegative(object.sourcePageCount, `${path}.sourcePageCount`, add);
      optionalBoolean(object.extractionTruncated, `${path}.extractionTruncated`, add);
      if (object.parseStatus !== undefined) requireEnum(object.parseStatus, `${path}.parseStatus`, ["unparsed", "parsing", "parsed", "failed"], add);
      break;
    case "text": requireString(object.body, `${path}.body`, add); break;
    case "link":
      requireString(object.url, `${path}.url`, add); requireString(object.domain, `${path}.domain`, add);
      validateOptionalRef(object.assetId, `${path}.assetId`, assets, "Link asset", add); break;
    case "imageCollection":
      validateIdArray(object.memberObjectIds, `${path}.memberObjectIds`, add, (id, itemPath) => validateObjectRef(id, itemPath, objects, "image", add));
      requireBoolean(object.expanded, `${path}.expanded`, add); break;
    case "research":
      for (const field of ["findings", "opportunities", "constraints", "openQuestions"] as const) validateStringArray(object[field], `${path}.${field}`, add);
      break;
    case "keyConclusion":
      requireEnum(object.category, `${path}.category`, ["finding", "opportunity", "constraint", "openQuestion", "unknown"], add);
      requireString(object.body, `${path}.body`, add);
      requireEnum(object.state, `${path}.state`, ["active", "needsVerification", "superseded", "archived"], add);
      validateIdArray(object.sourceObjectIds, `${path}.sourceObjectIds`, add);
      validateStringArray(object.citationIds, `${path}.citationIds`, add);
      requireString(object.confirmedAt, `${path}.confirmedAt`, add); break;
    case "documentFragment": {
      requireString(object.body, `${path}.body`, add);
      const source = requireRecord(object.source, `${path}.source`, add);
      if (source) {
        validateObjectRef(source.fileObjectId, `${path}.source.fileObjectId`, objects, "file", add);
        requireString(source.fileTitle, `${path}.source.fileTitle`, add);
        validateRequiredRef(source.sourceExtractAssetId, `${path}.source.sourceExtractAssetId`, assets, "Document extract asset", add);
        requireFiniteNonNegative(source.startOffset, `${path}.source.startOffset`, add);
        requireFiniteNonNegative(source.endOffset, `${path}.source.endOffset`, add);
        validateStringArray(source.blockIds, `${path}.source.blockIds`, add);
      }
      break;
    }
    case "proposalDraft":
      validateRequiredRef(object.proposalId, `${path}.proposalId`, proposals, "Proposal", add);
      requireString(object.proposalType, `${path}.proposalType`, add); break;
    case "designDefinition":
      requireString(object.problem, `${path}.problem`, add); validateStringArray(object.principles, `${path}.principles`, add); validateStringArray(object.avoid, `${path}.avoid`, add);
      validateRequiredRef(object.currentRevisionId, `${path}.currentRevisionId`, definitions, "Design definition revision", add);
      validateIdArray(object.revisionIds, `${path}.revisionIds`, add, (id, itemPath) => validateRequiredRef(id, itemPath, definitions, "Design definition revision", add));
      requireBoolean(object.isCurrentEffective, `${path}.isCurrentEffective`, add); break;
    case "conceptDirection":
      requireEnum(object.status, `${path}.status`, ["pendingPreview", "primary", "alternative", "eliminated", "needsReview"], add);
      validateStringArray(object.keywords, `${path}.keywords`, add);
      validateRequiredRef(object.currentRevisionId, `${path}.currentRevisionId`, directions, "Direction revision", add);
      validateIdArray(object.revisionIds, `${path}.revisionIds`, add, (id, itemPath) => validateRequiredRef(id, itemPath, directions, "Direction revision", add));
      validateObjectRef(object.lineageRootId, `${path}.lineageRootId`, objects, "conceptDirection", add); break;
    case "delivery": {
      requireEnum(object.format, `${path}.format`, ["board", "presentation"], add);
      validateArray(object.sections, `${path}.sections`, add, (section, sectionPath) => {
        const record = requireRecord(section, sectionPath, add); if (!record) return;
        requireId(record.id, `${sectionPath}.id`, add); requireString(record.title, `${sectionPath}.title`, add);
        requireFiniteNonNegative(record.order, `${sectionPath}.order`, add); validateIdArray(record.referenceIds, `${sectionPath}.referenceIds`, add);
      });
      validateArray(object.gaps, `${path}.gaps`, add, (gap, gapPath) => validateIdRecord(gap, gapPath, add));
      validateIdArray(object.references, `${path}.references`, add); break;
    }
  }
}

function validateDefinitionRevisions(revisions: Record<string, unknown>, objects: Record<string, unknown> | null, add: AddIssue): void {
  for (const [id, raw] of Object.entries(revisions)) {
    const path = `designDefinitionRevisions.${id}`; const revision = requireRecord(raw, path, add); if (!revision) continue;
    requireKeyId(id, revision.id, path, add);
    validateHistoricalObjectRef(revision.designDefinitionId, `${path}.designDefinitionId`, objects, "designDefinition", add);
    requireFinitePositive(revision.revisionNumber, `${path}.revisionNumber`, add); requireBoolean(revision.isCurrent, `${path}.isCurrent`, add);
    for (const field of ["title", "summary", "projectGoal", "coreProblem", "createdAt"] as const) requireString(revision[field], `${path}.${field}`, add);
    for (const field of ["targetUsers", "primaryScenarios", "designPrinciples", "constraints", "avoidDirections", "opportunities", "openQuestions", "sourceObjectIds", "citationIds"] as const) validateStringArray(revision[field], `${path}.${field}`, add);
    validateOptionalRef(revision.previousRevisionId, `${path}.previousRevisionId`, revisions, "Previous revision", add);
  }
  if (objects) for (const [objectId, rawObject] of Object.entries(objects)) {
    if (!isRecord(rawObject) || rawObject.type !== "designDefinition" || typeof rawObject.currentRevisionId !== "string") continue;
    const current = revisions[rawObject.currentRevisionId];
    if (isRecord(current) && current.designDefinitionId !== objectId) {
      add(`objects.${objectId}.currentRevisionId`, "Current revision belongs to another design definition.");
    }
    if (Array.isArray(rawObject.revisionIds) && !rawObject.revisionIds.includes(rawObject.currentRevisionId)) {
      add(`objects.${objectId}.revisionIds`, "Design definition revisionIds must include currentRevisionId.");
    }
    if (Array.isArray(rawObject.revisionIds)) {
      rawObject.revisionIds.forEach((revisionId, index) => {
        const revision = typeof revisionId === "string" ? revisions[revisionId] : undefined;
        if (isRecord(revision) && revision.designDefinitionId !== objectId) {
          add(`objects.${objectId}.revisionIds.${index}`, "Revision belongs to another design definition.");
        }
      });
    }
  }
}

function validateArtifactProposals(
  proposals: Record<string, unknown>,
  objects: Record<string, unknown> | null,
  add: AddIssue
): void {
  for (const [id, raw] of Object.entries(proposals)) {
    const path = `artifactProposals.${id}`;
    const proposal = requireRecord(raw, path, add);
    if (!proposal) continue;
    requireKeyId(id, proposal.id, path, add);
    requireEnum(proposal.type, `${path}.type`, ["researchAnalysis", "designDefinition", "conceptDirection", "deliveryPlan"], add);
    requireEnum(proposal.status, `${path}.status`, ["pending", "applied", "rejected", "expired"], add);
    if (proposal.reviewState !== undefined) {
      requireEnum(proposal.reviewState, `${path}.reviewState`, ["ready", "sourceChanged", "baseSuperseded", "targetUnavailable"], add);
    }
    requireString(proposal.createdAt, `${path}.createdAt`, add);
    validateIdArray(proposal.sourceObjectIds, `${path}.sourceObjectIds`, add);
    validateStringArray(proposal.citationIds, `${path}.citationIds`, add);
    const sourceIds = new Set(Array.isArray(proposal.sourceObjectIds)
      ? proposal.sourceObjectIds.filter((value): value is string => typeof value === "string")
      : []);
    const snapshotIds = new Set<string>();
    validateArray(proposal.sourceSnapshots, `${path}.sourceSnapshots`, add, (rawSnapshot, snapshotPath) => {
      const snapshot = requireRecord(rawSnapshot, snapshotPath, add);
      if (!snapshot) return;
      requireId(snapshot.objectId, `${snapshotPath}.objectId`, add);
      if (typeof snapshot.objectId === "string") snapshotIds.add(snapshot.objectId);
      requireString(snapshot.objectType, `${snapshotPath}.objectType`, add);
      requireString(snapshot.visibility, `${snapshotPath}.visibility`, add);
      requireString(snapshot.semanticFingerprint, `${snapshotPath}.semanticFingerprint`, add);
    });
    if (sourceIds.size !== snapshotIds.size || [...sourceIds].some((sourceId) => !snapshotIds.has(sourceId))) {
      add(`${path}.sourceSnapshots`, "Proposal source IDs and source snapshots must match.");
    }
    // Proposal sources are snapshots and may legitimately become hidden, changed, or deleted before review.
    if (proposal.appliedObjectId !== undefined) optionalString(proposal.appliedObjectId, `${path}.appliedObjectId`, add);
    if (proposal.type === "designDefinition") {
      validateOptionalHistoricalObjectRef(proposal.basedOnDesignDefinitionId, `${path}.basedOnDesignDefinitionId`, objects, "designDefinition", add);
      optionalString(proposal.basedOnRevisionId, `${path}.basedOnRevisionId`, add);
    }
    if (proposal.type === "conceptDirection") {
      requireEnum(proposal.applicationMode, `${path}.applicationMode`, ["create", "revise", "split", "merge"], add);
      validateOptionalHistoricalObjectRef(proposal.targetDirectionId, `${path}.targetDirectionId`, objects, "conceptDirection", add);
      validateIdArray(proposal.parentDirectionIds, `${path}.parentDirectionIds`, add, (objectId, itemPath) =>
        validateHistoricalObjectRef(objectId, itemPath, objects, "conceptDirection", add));
      validateArray(proposal.directions, `${path}.directions`, add, (rawDirection, directionPath) => {
        const direction = requireRecord(rawDirection, directionPath, add);
        if (!direction) return;
        for (const field of ["title", "summary", "conceptStatement", "strategy"] as const) {
          requireString(direction[field], `${directionPath}.${field}`, add);
        }
        for (const field of ["keywords", "differentiators", "visualSignals", "risks", "openQuestions"] as const) {
          validateStringArray(direction[field], `${directionPath}.${field}`, add);
        }
        validateOptionalHistoricalObjectRef(direction.basedOnDirectionId, `${directionPath}.basedOnDirectionId`, objects, "conceptDirection", add);
      });
    }
  }
}

function validateOperations(
  operations: Record<string, unknown>,
  projectId: unknown,
  add: AddIssue
): void {
  for (const [id, raw] of Object.entries(operations)) {
    const path = `operations.${id}`;
    const operation = requireRecord(raw, path, add);
    if (!operation) continue;
    requireKeyId(id, operation.id, path, add);
    requireEnum(operation.type, `${path}.type`, ["research", "imageGeneration", "designDefinition", "conceptDirection"], add);
    requireString(operation.projectId, `${path}.projectId`, add);
    if (typeof projectId === "string" && operation.projectId !== projectId) add(`${path}.projectId`, "Operation projectId must match the workspace project.");
    requireEnum(operation.status, `${path}.status`, ["queued", "preparing", "running", "waiting_for_user", "succeeded", "failed", "cancelled", "interrupted"], add);
    for (const field of ["createdAt", "updatedAt", "userInput"] as const) requireString(operation[field], `${path}.${field}`, add);
    requireBoolean(operation.retryable, `${path}.retryable`, add);
    const capabilities = requireRecord(operation.allowedCapabilities, `${path}.allowedCapabilities`, add);
    if (capabilities) {
      requireBoolean(capabilities.webSearch, `${path}.allowedCapabilities.webSearch`, add);
      requireBoolean(capabilities.imagePixels, `${path}.allowedCapabilities.imagePixels`, add);
    }
    const inputSnapshot = requireRecord(operation.inputSnapshot, `${path}.inputSnapshot`, add);
    if (inputSnapshot) {
      requireString(inputSnapshot.userInput, `${path}.inputSnapshot.userInput`, add);
      validateIdArray(inputSnapshot.selectedObjectIds, `${path}.inputSnapshot.selectedObjectIds`, add);
      validateArray(inputSnapshot.sourceSnapshots, `${path}.inputSnapshot.sourceSnapshots`, add, (item, itemPath) => {
        const snapshot = requireRecord(item, itemPath, add); if (!snapshot) return;
        requireId(snapshot.objectId, `${itemPath}.objectId`, add); requireString(snapshot.objectType, `${itemPath}.objectType`, add);
        requireString(snapshot.visibility, `${itemPath}.visibility`, add); requireString(snapshot.semanticFingerprint, `${itemPath}.semanticFingerprint`, add);
      });
      validateArray(inputSnapshot.objectSnapshots, `${path}.inputSnapshot.objectSnapshots`, add, (item, itemPath) => {
        const snapshot = requireRecord(item, itemPath, add); if (!snapshot) return;
        requireId(snapshot.id, `${itemPath}.id`, add);
        for (const field of ["type", "title", "summary"] as const) requireString(snapshot[field], `${itemPath}.${field}`, add);
      });
    }
    validateArray(operation.steps, `${path}.steps`, add, (item, itemPath) => {
      const step = requireRecord(item, itemPath, add); if (!step) return;
      requireId(step.id, `${itemPath}.id`, add); requireString(step.kind, `${itemPath}.kind`, add);
      requireEnum(step.status, `${itemPath}.status`, ["succeeded", "skipped", "failed"], add);
      requireString(step.summary, `${itemPath}.summary`, add); requireString(step.createdAt, `${itemPath}.createdAt`, add);
    });
    validateArray(operation.events, `${path}.events`, add, (item, itemPath) => {
      const event = requireRecord(item, itemPath, add); if (!event) return;
      requireId(event.id, `${itemPath}.id`, add); requireString(event.createdAt, `${itemPath}.createdAt`, add); requireString(event.summary, `${itemPath}.summary`, add);
    });
    validateIdArray(operation.sourceIds, `${path}.sourceIds`, add);
    validateIdArray(operation.proposalIds, `${path}.proposalIds`, add);
  }
}

function validateDecisionRecords(value: unknown, add: AddIssue): void {
  validateArray(value, "decisionRecords", add, (raw, path) => {
    const decision = requireRecord(raw, path, add); if (!decision) return;
    requireId(decision.id, `${path}.id`, add); requireString(decision.kind, `${path}.kind`, add);
    requireString(decision.createdAt, `${path}.createdAt`, add); requireString(decision.summary, `${path}.summary`, add);
    optionalString(decision.reason, `${path}.reason`, add); validateIdArray(decision.relatedObjectIds, `${path}.relatedObjectIds`, add);
    if (decision.objectSnapshot !== undefined) {
      const snapshot = requireRecord(decision.objectSnapshot, `${path}.objectSnapshot`, add);
      if (snapshot) { requireId(snapshot.id, `${path}.objectSnapshot.id`, add); requireString(snapshot.type, `${path}.objectSnapshot.type`, add); requireString(snapshot.title, `${path}.objectSnapshot.title`, add); }
    }
    // Decision history remains valid after related objects are hidden or deleted.
  });
}

function validateCitationSnapshots(
  citations: Record<string, unknown>,
  _operations: Record<string, unknown> | null,
  add: AddIssue
): void {
  for (const [id, raw] of Object.entries(citations)) {
    const path = `citationSnapshots.${id}`;
    const citation = requireRecord(raw, path, add); if (!citation) continue;
    requireKeyId(id, citation.id, path, add); requireId(citation.operationId, `${path}.operationId`, add);
    requireString(citation.title, `${path}.title`, add); requireString(citation.retrievedAt, `${path}.retrievedAt`, add);
    optionalString(citation.url, `${path}.url`, add); optionalString(citation.domain, `${path}.domain`, add); optionalString(citation.snippet, `${path}.snippet`, add);
    // Citation snapshots can outlive the Operation record that originally captured them.
  }
}

function validateDeliverySectionDrafts(
  drafts: Record<string, unknown>,
  objects: Record<string, unknown> | null,
  references: Record<string, unknown> | null,
  add: AddIssue
): void {
  for (const [id, raw] of Object.entries(drafts)) {
    const path = `deliverySectionDrafts.${id}`;
    const draft = requireRecord(raw, path, add);
    if (!draft) continue;
    requireKeyId(id, draft.id, path, add);
    validateObjectRef(draft.deliveryObjectId, `${path}.deliveryObjectId`, objects, "delivery", add);
    requireString(draft.sectionId, `${path}.sectionId`, add);
    if (typeof draft.deliveryObjectId === "string" && typeof draft.sectionId === "string" && objects) {
      const delivery = objects[draft.deliveryObjectId];
      if (isRecord(delivery) && Array.isArray(delivery.sections) &&
          !delivery.sections.some((section) => isRecord(section) && section.id === draft.sectionId)) {
        add(`${path}.sectionId`, "Delivery section draft target section does not exist.");
      }
    }
    for (const field of ["userMessageId", "assistantMessageId", "narrative", "createdAt", "updatedAt"] as const) {
      requireString(draft[field], `${path}.${field}`, add);
    }
    requireEnum(draft.status, `${path}.status`, ["pending", "applied", "discarded"], add);
    validateIdArray(draft.referenceIds, `${path}.referenceIds`, add, (referenceId, itemPath) =>
      validateRequiredRef(referenceId, itemPath, references, "Delivery reference", add));
    requireRecord(draft.sourceFingerprints, `${path}.sourceFingerprints`, add);
    validateArray(draft.captions, `${path}.captions`, add, (rawCaption, captionPath) => {
      const caption = requireRecord(rawCaption, captionPath, add);
      if (!caption) return;
      validateRequiredRef(caption.referenceId, `${captionPath}.referenceId`, references, "Delivery reference", add);
      requireString(caption.caption, `${captionPath}.caption`, add);
    });
    validateArray(draft.suggestedGaps, `${path}.suggestedGaps`, add, (rawGap, gapPath) => {
      const gap = requireRecord(rawGap, gapPath, add);
      if (gap) requireString(gap.label, `${gapPath}.label`, add);
    });
  }
}

function validateDirectionRevisions(revisions: Record<string, unknown>, objects: Record<string, unknown> | null, definitions: Record<string, unknown> | null, add: AddIssue): void {
  for (const [id, raw] of Object.entries(revisions)) {
    const path = `directionRevisions.${id}`; const revision = requireRecord(raw, path, add); if (!revision) continue;
    requireKeyId(id, revision.id, path, add);
    validateHistoricalObjectRef(revision.directionId, `${path}.directionId`, objects, "conceptDirection", add);
    requireFinitePositive(revision.revisionNumber, `${path}.revisionNumber`, add); requireBoolean(revision.isCurrent, `${path}.isCurrent`, add);
    for (const field of ["title", "summary", "conceptStatement", "strategy", "createdAt"] as const) requireString(revision[field], `${path}.${field}`, add);
    for (const field of ["keywords", "differentiators", "visualSignals", "risks", "openQuestions", "sourceObjectIds", "citationIds"] as const) validateStringArray(revision[field], `${path}.${field}`, add);
    validateOptionalRef(revision.previousRevisionId, `${path}.previousRevisionId`, revisions, "Previous revision", add);
    validateOptionalRef(revision.basedOnDefinitionRevisionId, `${path}.basedOnDefinitionRevisionId`, definitions, "Design definition revision", add);
  }
  if (objects) for (const [objectId, rawObject] of Object.entries(objects)) {
    if (!isRecord(rawObject) || rawObject.type !== "conceptDirection" || typeof rawObject.currentRevisionId !== "string") continue;
    const current = revisions[rawObject.currentRevisionId];
    if (isRecord(current) && current.directionId !== objectId) {
      add(`objects.${objectId}.currentRevisionId`, "Current revision belongs to another concept direction.");
    }
    if (Array.isArray(rawObject.revisionIds) && !rawObject.revisionIds.includes(rawObject.currentRevisionId)) {
      add(`objects.${objectId}.revisionIds`, "Concept direction revisionIds must include currentRevisionId.");
    }
    if (Array.isArray(rawObject.revisionIds)) {
      rawObject.revisionIds.forEach((revisionId, index) => {
        const revision = typeof revisionId === "string" ? revisions[revisionId] : undefined;
        if (isRecord(revision) && revision.directionId !== objectId) {
          add(`objects.${objectId}.revisionIds.${index}`, "Revision belongs to another concept direction.");
        }
      });
    }
  }
}

function validateCanvas(canvas: Record<string, unknown>, objects: Record<string, unknown> | null, add: AddIssue): void {
  validateView(canvas.view, "canvas.view", add);
  const instanceIds = new Set<string>();
  validateArray(canvas.instances, "canvas.instances", add, (raw, path) => {
    const instance = requireRecord(raw, path, add); if (!instance) return;
    requireId(instance.id, `${path}.id`, add); validateObjectRef(instance.objectId, `${path}.objectId`, objects, undefined, add);
    if (typeof instance.id === "string" && instanceIds.has(instance.id)) add(`${path}.id`, "Canvas instance id must be unique.");
    if (typeof instance.id === "string") instanceIds.add(instance.id);
    const position = requireRecord(instance.position, `${path}.position`, add); if (position) { requireFinite(position.x, `${path}.position.x`, add); requireFinite(position.y, `${path}.position.y`, add); }
    const size = requireRecord(instance.size, `${path}.size`, add); if (size) { requireFinitePositive(size.w, `${path}.size.w`, add); requireFinitePositive(size.h, `${path}.size.h`, add); }
  });
  if (canvas.stageRegions !== undefined) validateArray(canvas.stageRegions, "canvas.stageRegions", add, (raw, path) => {
    const region = requireRecord(raw, path, add); if (!region) return;
    requireId(region.id, `${path}.id`, add); requireString(region.title, `${path}.title`, add);
    for (const field of ["x", "y"] as const) requireFinite(region[field], `${path}.${field}`, add);
    for (const field of ["w", "h"] as const) requireFinitePositive(region[field], `${path}.${field}`, add);
    validateIdArray(region.memberObjectIds, `${path}.memberObjectIds`, add, (id, itemPath) => validateObjectRef(id, itemPath, objects, undefined, add));
  });
}

function validateWorkingState(state: Record<string, unknown>, objects: Record<string, unknown> | null, add: AddIssue): void {
  requireEnum(state.currentDesignDefinitionAvailability, "workingState.currentDesignDefinitionAvailability", ["available", "hidden", "missing"], add);
  if (state.currentDesignDefinitionId !== undefined && state.currentDesignDefinitionAvailability !== "missing") {
    validateObjectRef(state.currentDesignDefinitionId, "workingState.currentDesignDefinitionId", objects, "designDefinition", add);
    if (typeof state.currentDesignDefinitionId === "string" && objects) {
      const definition = objects[state.currentDesignDefinitionId];
      if (isRecord(definition)) {
        const expectedVisibility = state.currentDesignDefinitionAvailability === "available" ? "active" : "hidden";
        if (definition.visibility !== expectedVisibility) add("workingState.currentDesignDefinitionAvailability", "Design definition availability does not match object visibility.");
      }
    }
  }
  validateOptionalObjectRef(state.primaryDirectionId, "workingState.primaryDirectionId", objects, "conceptDirection", add);
  for (const field of ["alternativeDirectionIds", "eliminatedDirectionIds"] as const) validateIdArray(state[field], `workingState.${field}`, add, (id, path) => validateObjectRef(id, path, objects, "conceptDirection", add));
  validateIdArray(state.activeKeyConclusionIds, "workingState.activeKeyConclusionIds", add, (id, path) => validateObjectRef(id, path, objects, "keyConclusion", add));
  validateOptionalObjectRef(state.currentDefaultReferenceId, "workingState.currentDefaultReferenceId", objects, "image", add);
  if (objects) {
    const defaultImages = Object.values(objects).filter((object) => isRecord(object) && object.type === "image" && object.isDefaultReference === true);
    if (defaultImages.length > 1) add("objects", "Only one image may be the default reference.");
  }
  validateIdArray(state.recentResearchObjectIds, "workingState.recentResearchObjectIds", add, (id, path) => validateObjectRef(id, path, objects, "research", add));
  validateIdArray(state.openQuestionIds, "workingState.openQuestionIds", add, (id, path) => {
    if (!objects) return;
    const object = objects[id];
    if (!isRecord(object) || (object.type !== "keyConclusion" && object.type !== "research")) {
      add(path, "Open-question source must be a key conclusion or research object.");
    }
  });
  const directionRefs = requireRecord(state.directionReferenceIds, "workingState.directionReferenceIds", add);
  if (directionRefs) for (const [directionId, refs] of Object.entries(directionRefs)) {
    validateObjectRef(directionId, `workingState.directionReferenceIds.${directionId}`, objects, "conceptDirection", add);
    validateIdArray(refs, `workingState.directionReferenceIds.${directionId}`, add, (id, path) => validateObjectRef(id, path, objects, "image", add));
  }
  requireString(state.derivedFromRevision, "workingState.derivedFromRevision", add); requireString(state.lastReconciledAt, "workingState.lastReconciledAt", add);
}

function validateDeliveryReferences(references: Record<string, unknown>, objects: Record<string, unknown> | null, assets: Record<string, unknown> | null, add: AddIssue): void {
  for (const [id, raw] of Object.entries(references)) {
    const path = `deliveryReferences.${id}`; const ref = requireRecord(raw, path, add); if (!ref) continue;
    requireKeyId(id, ref.id, path, add); requireString(ref.createdAt, `${path}.createdAt`, add); requireRecord(ref.snapshot, `${path}.snapshot`, add);
    if (ref.deliveryObjectId !== undefined) {
      validateObjectRef(ref.deliveryObjectId, `${path}.deliveryObjectId`, objects, "delivery", add);
      if (typeof ref.sectionId === "string" && typeof ref.deliveryObjectId === "string" && objects) {
        const delivery = objects[ref.deliveryObjectId];
        if (isRecord(delivery) && Array.isArray(delivery.sections) && !delivery.sections.some((section) => isRecord(section) && section.id === ref.sectionId)) add(`${path}.sectionId`, "Delivery reference section does not exist.");
      }
    }
    optionalString(ref.sectionId, `${path}.sectionId`, add); optionalFiniteNonNegative(ref.order, `${path}.order`, add);
    optionalString(ref.sourceObjectId, `${path}.sourceObjectId`, add); optionalString(ref.sourceAssetId, `${path}.sourceAssetId`, add);
    // Stable delivery snapshots intentionally remain valid when their upstream source object or asset is gone.
  }
  if (objects) for (const [objectId, raw] of Object.entries(objects)) {
    if (!isRecord(raw) || raw.type !== "delivery") continue;
    validateIdArray(raw.references, `objects.${objectId}.references`, add, (refId, path) => validateRequiredRef(refId, path, references, "Delivery reference", add));
  }
  void assets;
}

function validateRelation(raw: unknown, path: string, objects: Record<string, unknown> | null, add: AddIssue): void {
  const relation = requireRecord(raw, path, add); if (!relation) return;
  requireId(relation.id, `${path}.id`, add); requireString(relation.kind, `${path}.kind`, add); requireString(relation.note, `${path}.note`, add);
  validateObjectRef(relation.fromObjectId, `${path}.fromObjectId`, objects, undefined, add); validateObjectRef(relation.toObjectId, `${path}.toObjectId`, objects, undefined, add);
}

function validateDirectionLineage(raw: unknown, path: string, objects: Record<string, unknown> | null, add: AddIssue): void {
  const item = requireRecord(raw, path, add); if (!item) return; requireId(item.id, `${path}.id`, add);
  validateObjectRef(item.fromDirectionId, `${path}.fromDirectionId`, objects, "conceptDirection", add); validateObjectRef(item.toDirectionId, `${path}.toDirectionId`, objects, "conceptDirection", add);
}

function validateVisualBranches(branches: Record<string, unknown>, objects: Record<string, unknown> | null, add: AddIssue): void {
  for (const [id, raw] of Object.entries(branches)) {
    const path = `visualBranches.${id}`; const branch = requireRecord(raw, path, add); if (!branch) continue;
    requireKeyId(id, branch.id, path, add); validateObjectRef(branch.directionId, `${path}.directionId`, objects, "conceptDirection", add);
    validateOptionalObjectRef(branch.rootObjectId, `${path}.rootObjectId`, objects, "image", add); requireString(branch.label, `${path}.label`, add);
  }
}

function validateContinuity(value: Record<string, unknown>, add: AddIssue): void {
  if (value.schemaVersion !== 2) add("projectContinuity.schemaVersion", "Project continuity schemaVersion must be 2.");
  const focus = requireRecord(value.currentFocus, "projectContinuity.currentFocus", add);
  if (focus) {
    requireEnum(focus.area, "projectContinuity.currentFocus.area", ["startAndInput", "exploration", "research", "designDefinition", "directionAndVisual", "deliveryPreparation"], add);
    requireString(focus.updatedAt, "projectContinuity.currentFocus.updatedAt", add);
    requireEnum(focus.sourceKind, "projectContinuity.currentFocus.sourceKind", ["migration", "userAction", "operation", "proposalApplied"], add);
    validateIdArray(focus.sourceObjectIds, "projectContinuity.currentFocus.sourceObjectIds", add);
    optionalString(focus.sourceOperationId, "projectContinuity.currentFocus.sourceOperationId", add);
    requireString(focus.note, "projectContinuity.currentFocus.note", add);
  }
  validateArray(value.recordEntries, "projectContinuity.recordEntries", add, (item, path) => {
    const entry = requireRecord(item, path, add); if (!entry) return;
    requireId(entry.id, `${path}.id`, add); requireString(entry.dedupeKey, `${path}.dedupeKey`, add);
    requireEnum(entry.origin, `${path}.origin`, ["deterministicEvent", "conversationSemanticPatch"], add);
    requireEnum(entry.manualState, `${path}.manualState`, ["active", "notApplicable", "withdrawn"], add);
    requireEnum(entry.stage, `${path}.stage`, ["startAndInput", "exploration", "research", "designDefinition", "directionAndVisual", "deliveryPreparation"], add);
    requireEnum(entry.category, `${path}.category`, ["output", "decision", "rejection", "preference", "constraint", "openQuestion", "nextFocus", "systemNote"], add);
    requireString(entry.summary, `${path}.summary`, add); requireString(entry.createdAt, `${path}.createdAt`, add); requireString(entry.updatedAt, `${path}.updatedAt`, add);
    requireEnum(entry.validity, `${path}.validity`, ["current", "reviewRequired", "superseded", "sourceUnavailable"], add);
    validateArray(entry.sourceRefs, `${path}.sourceRefs`, add, (rawRef, refPath) => validateContinuitySourceRef(rawRef, refPath, add));
  });
  requireString(value.updatedAt, "projectContinuity.updatedAt", add);
}

function validateMemory(value: Record<string, unknown>, add: AddIssue): void {
  if (value.schemaVersion !== 1) add("projectMemory.schemaVersion", "Project memory schemaVersion must be 1.");
  const documents = requireRecord(value.documents, "projectMemory.documents", add);
  const revisions = requireRecord(value.revisions, "projectMemory.revisions", add);
  const stageRecords = requireRecord(value.stageRecords, "projectMemory.stageRecords", add);
  const stageRevisions = requireRecord(value.stageRevisions, "projectMemory.stageRevisions", add);
  if (revisions) for (const [id, raw] of Object.entries(revisions)) {
    const path = `projectMemory.revisions.${id}`; const revision = requireRecord(raw, path, add); if (!revision) continue;
    requireKeyId(id, revision.id, path, add); requireString(revision.documentKey, `${path}.documentKey`, add);
    requireString(revision.createdAt, `${path}.createdAt`, add); requireBoolean(revision.reviewRequired, `${path}.reviewRequired`, add);
    validateArray(revision.sections, `${path}.sections`, add, (rawSection, sectionPath) => {
      const section = requireRecord(rawSection, sectionPath, add); if (!section) return;
      requireString(section.key, `${sectionPath}.key`, add); requireString(section.title, `${sectionPath}.title`, add); validateStringArray(section.items, `${sectionPath}.items`, add);
    });
    validateArray(revision.sourceRefs, `${path}.sourceRefs`, add, (rawRef, refPath) => validateContinuitySourceRef(rawRef, refPath, add));
    validateOptionalRef(revision.previousRevisionId, `${path}.previousRevisionId`, revisions, "Previous memory revision", add);
  }
  if (documents) for (const [key, raw] of Object.entries(documents)) {
    const path = `projectMemory.documents.${key}`; const document = requireRecord(raw, path, add); if (!document) continue;
    if (document.key !== key) add(`${path}.key`, "Memory document key must match its record key.");
    requireString(document.title, `${path}.title`, add); validateOptionalRef(document.currentRevisionId, `${path}.currentRevisionId`, revisions, "Current memory revision", add);
    if (typeof document.currentRevisionId === "string" && revisions) {
      const current = revisions[document.currentRevisionId];
      if (isRecord(current) && current.documentKey !== key) add(`${path}.currentRevisionId`, "Current memory revision belongs to another document.");
    }
  }
  if (stageRevisions) for (const [id, raw] of Object.entries(stageRevisions)) {
    const path = `projectMemory.stageRevisions.${id}`; const revision = requireRecord(raw, path, add); if (!revision) continue;
    requireKeyId(id, revision.id, path, add); requireString(revision.stage, `${path}.stage`, add); requireString(revision.createdAt, `${path}.createdAt`, add);
    requireBoolean(revision.reviewRequired, `${path}.reviewRequired`, add); requireRecord(revision.sections, `${path}.sections`, add);
    validateArray(revision.sourceRefs, `${path}.sourceRefs`, add, (rawRef, refPath) => validateContinuitySourceRef(rawRef, refPath, add));
    validateOptionalRef(revision.previousRevisionId, `${path}.previousRevisionId`, stageRevisions, "Previous stage revision", add);
  }
  if (stageRecords) for (const [key, raw] of Object.entries(stageRecords)) {
    const path = `projectMemory.stageRecords.${key}`; const record = requireRecord(raw, path, add); if (!record) continue;
    if (record.stage !== key) add(`${path}.stage`, "Stage record key and stage must match.");
    validateOptionalRef(record.currentRevisionId, `${path}.currentRevisionId`, stageRevisions, "Current stage revision", add);
    if (typeof record.currentRevisionId === "string" && stageRevisions) {
      const current = stageRevisions[record.currentRevisionId];
      if (isRecord(current) && current.stage !== key) add(`${path}.currentRevisionId`, "Current stage revision belongs to another stage.");
    }
  }
  requireString(value.updatedAt, "projectMemory.updatedAt", add);
}

function validateContinuitySourceRef(raw: unknown, path: string, add: AddIssue): void {
  const ref = requireRecord(raw, path, add); if (!ref) return;
  requireEnum(ref.kind, `${path}.kind`, ["object", "revision", "operation", "branch", "decision", "citation", "deliveryReference", "message"], add);
  requireId(ref.id, `${path}.id`, add);
  if (ref.sourceAvailability !== undefined) requireEnum(ref.sourceAvailability, `${path}.sourceAvailability`, ["active", "hidden", "missing"], add);
  if (ref.snapshot !== undefined) {
    const snapshot = requireRecord(ref.snapshot, `${path}.snapshot`, add);
    if (snapshot) { requireString(snapshot.title, `${path}.snapshot.title`, add); optionalFiniteNonNegative(snapshot.revisionNumber, `${path}.snapshot.revisionNumber`, add); }
  }
}

function validateAi(ai: Record<string, unknown>, objects: Record<string, unknown> | null, add: AddIssue): void {
  const messageIds = new Set<string>();
  validateArray(ai.messages, "ai.messages", add, (raw, path) => {
    const message = requireRecord(raw, path, add); if (!message) return;
    requireId(message.id, `${path}.id`, add); requireEnum(message.role, `${path}.role`, ["assistant", "user"], add); requireString(message.body, `${path}.body`, add);
    if (typeof message.id === "string" && messageIds.has(message.id)) add(`${path}.id`, "AI message id must be unique.");
    if (typeof message.id === "string") messageIds.add(message.id);
    if (message.status !== undefined) requireEnum(message.status, `${path}.status`, ["streaming", "done", "failed", "cancelled"], add);
    optionalString(message.createdAt, `${path}.createdAt`, add);
    if (message.contextObjectIds !== undefined) validateIdArray(message.contextObjectIds, `${path}.contextObjectIds`, add, (id, itemPath) => {
      // Historical message context can outlive a deleted source, so only validate ID shape here.
      requireId(id, itemPath, add);
    });
  });
  requireRecord(ai.conversationCompaction, "ai.conversationCompaction", add); requireRecord(ai.conversationSummaryRevisions, "ai.conversationSummaryRevisions", add);
  if (ai.providerContextFrames !== undefined) validateArray(ai.providerContextFrames, "ai.providerContextFrames", add, (raw, path) => validateIdRecord(raw, path, add));
  if (ai.comparisonAnalyses !== undefined) requireRecord(ai.comparisonAnalyses, "ai.comparisonAnalyses", add);
  const summaryRevisions = isRecord(ai.conversationSummaryRevisions) ? ai.conversationSummaryRevisions : null;
  if (summaryRevisions) validateKeyedRecords(summaryRevisions, "ai.conversationSummaryRevisions", add);
  const analyses = isRecord(ai.comparisonAnalyses) ? ai.comparisonAnalyses : null;
  if (analyses) validateKeyedRecords(analyses, "ai.comparisonAnalyses", add);
  void objects;
}

function validateUi(ui: Record<string, unknown>, objects: Record<string, unknown> | null, add: AddIssue): void {
  requireEnum(ui.activeDrawer, "ui.activeDrawer", ["map", "assets", "hidden", "search", "records", null], add); requireBoolean(ui.aiOpen, "ui.aiOpen", add);
  validateIdArray(ui.lastSelectionIds, "ui.lastSelectionIds", add, (id, path) => validateObjectRef(id, path, objects, undefined, add));
  validateView(ui.canvasView, "ui.canvasView", add); requireString(ui.workIntent, "ui.workIntent", add);
}

function validateView(raw: unknown, path: string, add: AddIssue): void {
  const view = requireRecord(raw, path, add); if (!view) return;
  requireFinite(view.x, `${path}.x`, add); requireFinite(view.y, `${path}.y`, add); requireFinitePositive(view.zoom, `${path}.zoom`, add);
}

function validateSafeStructure(value: unknown, add: AddIssue): void {
  const stack: Array<{ value: unknown; path: string; depth: number }> = [{ value, path: "workspace", depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!; nodes += 1;
    if (nodes > MAX_STRUCTURE_NODES) { add("workspace", "Workspace exceeds the structural node budget."); return; }
    if (current.depth > MAX_STRUCTURE_DEPTH) { add(current.path, "Workspace nesting is too deep."); continue; }
    if (typeof current.value === "number" && !Number.isFinite(current.value)) add(current.path, "Number must be finite.");
    if (typeof current.value === "string" && current.value.length > MAX_STRING_CHARS) add(current.path, "String exceeds the workspace limit.");
    if (Array.isArray(current.value)) current.value.forEach((item, index) => stack.push({ value: item, path: `${current.path}.${index}`, depth: current.depth + 1 }));
    else if (isRecord(current.value)) Object.entries(current.value).forEach(([key, item]) => stack.push({ value: item, path: `${current.path}.${key}`, depth: current.depth + 1 }));
    else if (current.value !== null && !["string", "number", "boolean", "undefined"].includes(typeof current.value)) add(current.path, "Workspace contains an unsupported value.");
  }
}

type AddIssue = (path: string, message: string) => void;
function failed(issues: CurrentWorkspaceValidationIssue[]): CurrentWorkspaceValidationResult { return { status: "failed", reason: "Editable backup workspace failed deep current-schema validation.", issues }; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requireRecord(value: unknown, path: string, add: AddIssue): Record<string, unknown> | null { if (!isRecord(value)) { add(path, "Expected an object."); return null; } return value; }
function requireString(value: unknown, path: string, add: AddIssue): void { if (typeof value !== "string" || value.length > MAX_STRING_CHARS) add(path, "Expected a bounded string."); }
function optionalString(value: unknown, path: string, add: AddIssue): void { if (value !== undefined) requireString(value, path, add); }
function requireId(value: unknown, path: string, add: AddIssue): void { if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_CHARS) add(path, "Expected a bounded non-empty id."); }
function requireKeyId(key: string, value: unknown, path: string, add: AddIssue): void { requireId(value, `${path}.id`, add); if (value !== key) add(`${path}.id`, "Record key and id must match."); }
function requireBoolean(value: unknown, path: string, add: AddIssue): void { if (typeof value !== "boolean") add(path, "Expected a boolean."); }
function optionalBoolean(value: unknown, path: string, add: AddIssue): void { if (value !== undefined) requireBoolean(value, path, add); }
function requireFinite(value: unknown, path: string, add: AddIssue): void { if (typeof value !== "number" || !Number.isFinite(value)) add(path, "Expected a finite number."); }
function requireFinitePositive(value: unknown, path: string, add: AddIssue): void { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) add(path, "Expected a positive finite number."); }
function requireFiniteNonNegative(value: unknown, path: string, add: AddIssue): void { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) add(path, "Expected a non-negative finite number."); }
function optionalFiniteNonNegative(value: unknown, path: string, add: AddIssue): void { if (value !== undefined) requireFiniteNonNegative(value, path, add); }
function requireEnum(value: unknown, path: string, allowed: readonly unknown[], add: AddIssue): void { if (!allowed.includes(value)) add(path, "Value is outside the allowed set."); }
function validateArray(value: unknown, path: string, add: AddIssue, item: (value: unknown, path: string) => void): void { if (!Array.isArray(value)) { add(path, "Expected an array."); return; } value.forEach((entry, index) => item(entry, `${path}.${index}`)); }
function validateStringArray(value: unknown, path: string, add: AddIssue): void { validateArray(value, path, add, (entry, itemPath) => requireString(entry, itemPath, add)); }
function validateIdArray(value: unknown, path: string, add: AddIssue, item?: (id: string, path: string) => void): void { validateArray(value, path, add, (entry, itemPath) => { requireId(entry, itemPath, add); if (typeof entry === "string") item?.(entry, itemPath); }); }
function validateIdRecord(value: unknown, path: string, add: AddIssue): void { const record = requireRecord(value, path, add); if (record) requireId(record.id, `${path}.id`, add); }
function validateKeyedRecords(value: Record<string, unknown>, path: string, add: AddIssue): void { for (const [key, raw] of Object.entries(value)) { const record = requireRecord(raw, `${path}.${key}`, add); if (record) requireKeyId(key, record.id, `${path}.${key}`, add); } }
function validateRequiredRef(value: unknown, path: string, record: Record<string, unknown> | null, label: string, add: AddIssue): void { requireId(value, path, add); if (typeof value === "string" && record && !record[value]) add(path, `${label} does not exist.`); }
function validateOptionalRef(value: unknown, path: string, record: Record<string, unknown> | null, label: string, add: AddIssue): void { if (value !== undefined) validateRequiredRef(value, path, record, label, add); }
function validateObjectRef(value: unknown, path: string, objects: Record<string, unknown> | null, expectedType: MorphoObject["type"] | undefined, add: AddIssue): void { requireId(value, path, add); if (typeof value !== "string" || !objects) return; const object = objects[value]; if (!object) add(path, "Referenced object does not exist."); else if (expectedType && (!isRecord(object) || object.type !== expectedType)) add(path, `Referenced object must be ${expectedType}.`); }
function validateOptionalObjectRef(value: unknown, path: string, objects: Record<string, unknown> | null, expectedType: MorphoObject["type"], add: AddIssue): void { if (value !== undefined) validateObjectRef(value, path, objects, expectedType, add); }
function validateHistoricalObjectRef(value: unknown, path: string, objects: Record<string, unknown> | null, expectedType: MorphoObject["type"], add: AddIssue): void { requireId(value, path, add); if (typeof value !== "string" || !objects) return; const object = objects[value]; if (object && (!isRecord(object) || object.type !== expectedType)) add(path, `Referenced object must be ${expectedType}.`); }
function validateOptionalHistoricalObjectRef(value: unknown, path: string, objects: Record<string, unknown> | null, expectedType: MorphoObject["type"], add: AddIssue): void { if (value !== undefined) validateHistoricalObjectRef(value, path, objects, expectedType, add); }
