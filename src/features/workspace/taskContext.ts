import type {
  AiContextTask,
  ConceptDirectionRevision,
  DesignDefinitionRevision,
  MorphoObject,
  MorphoObjectId,
  MorphoObjectType,
  MorphoWorkspace,
  VisualBranchRecord
} from "../../domain/morpho/types";
import type { ArtifactProposal } from "../../domain/operations/types";
import { GRS_REFERENCE_IMAGE_LIMIT } from "../../domain/morpho/imageLimits";
import { buildProjectContinuityContext, type ProjectContinuityContext } from "../../domain/morpho/projectContinuity";
import { resolveDocumentFragmentSourceAvailability } from "./documentFragments";

export type TaskContextKind = "research" | "general" | "directionPreview" | "visualDevelopment" | "designDefinition" | "conceptDirection" | "comparison";

export type TaskContextDefaultReference =
  | { status: "included"; objectId: MorphoObjectId; reason: string }
  | { status: "hidden"; objectId: MorphoObjectId; reason: string }
  | { status: "notIncluded"; objectId?: MorphoObjectId; reason: string }
  | { status: "missing"; reason: string };

export type TaskContextSummary = {
  id: MorphoObjectId;
  type: MorphoObjectType;
  title: string;
  summary: string;
  detail?: string;
};

export type TaskContextDocumentFragmentExtract = {
  objectId: MorphoObjectId;
  title: string;
  text: string;
  charCount: number;
  truncated: boolean;
  sourceFileObjectId: MorphoObjectId;
  sourceFileTitle: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  sourceAvailability: "active" | "hidden" | "missing" | "assetMissing" | "assetMismatch";
};

export type TaskContextProposalDraft =
  | {
      proposalId: MorphoObjectId;
      proposalType: "researchAnalysis";
      title: string;
      summary: string;
      findings: string[];
      opportunities: string[];
      constraints: string[];
      openQuestions: string[];
    }
  | {
      proposalId: MorphoObjectId;
      proposalType: "designDefinition";
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
      changeNote?: string;
    }
  | {
      proposalId: MorphoObjectId;
      proposalType: "conceptDirection";
      title: string;
      summary: string;
      directions: Extract<ArtifactProposal, { type: "conceptDirection" }>["directions"];
    };

export type TaskContextSkip = {
  objectId: MorphoObjectId;
  reason: string;
};

export type TaskContextResult = {
  kind: TaskContextKind;
  objectIds: MorphoObjectId[];
  semanticSummaries: TaskContextSummary[];
  imageObjectIds: MorphoObjectId[];
  documentObjectIds: MorphoObjectId[];
  documentFragmentExtracts: TaskContextDocumentFragmentExtract[];
  proposalDrafts: TaskContextProposalDraft[];
  directionRevisions: ConceptDirectionRevision[];
  designDefinitionRevision?: DesignDefinitionRevision;
  visualBranches: VisualBranchRecord[];
  skipped: TaskContextSkip[];
  truncated: boolean;
  defaultReference: TaskContextDefaultReference;
  scopeNote: string;
  projectContinuity: ProjectContinuityContext;
};

export type ProviderTaskContext = {
  kind: Exclude<TaskContextKind, "comparison">;
  objectIds: MorphoObjectId[];
  imageObjectIds: MorphoObjectId[];
  documentObjectIds: MorphoObjectId[];
  documentFragmentExtracts: TaskContextDocumentFragmentExtract[];
  truncated: boolean;
  defaultReference: string;
  designDefinition?: {
    objectId: MorphoObjectId;
    revisionId: string;
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
    previousRevisionId?: string;
    changeNote?: string;
  };
  directions: Array<{
    objectId: MorphoObjectId;
    revisionId: string;
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
    basedOnDefinitionRevisionId?: string;
    previousRevisionId?: string;
    changeNote?: string;
  }>;
  visualBranches: Array<{
    id: string;
    directionId: MorphoObjectId;
    label: string;
    rootObjectId?: MorphoObjectId;
  }>;
  projectContinuity: ProjectContinuityContext;
  skipped: TaskContextSkip[];
};

export type ProviderComparisonBackgroundContext = {
  defaultReference: string;
  designDefinition?: ProviderTaskContext["designDefinition"];
  projectContinuity: ProjectContinuityContext;
};

export type BuildTaskContextInput = {
  kind: TaskContextKind;
  draft: string;
  selectedObjectIds: MorphoObjectId[];
  explicitObjectIds?: MorphoObjectId[];
  targetDirectionIds?: MorphoObjectId[];
  visualBranchId?: string;
};

export const TASK_CONTEXT_LIMITS = {
  maxObjectSummaries: 16,
  maxDocumentExtracts: 8,
  maxCharsPerDocument: 8_000,
  maxTotalDocumentChars: 24_000,
  maxAiProviderImages: 16,
  maxGrsReferenceImages: GRS_REFERENCE_IMAGE_LIMIT
} as const;

const DEFAULT_REFERENCE_PATTERN = /默认参考|保持.*一致|延续.*默认|参考当前默认|reference/i;

export function buildTaskContext(workspace: MorphoWorkspace, input: BuildTaskContextInput): TaskContextResult {
  const skipped: TaskContextSkip[] = [];
  const objectIds: MorphoObjectId[] = [];
  const imageObjectIds: MorphoObjectId[] = [];
  const documentObjectIds: MorphoObjectId[] = [];
  const directionIds = new Set(input.targetDirectionIds ?? []);

  const selectedIds = uniqueStrings([...input.selectedObjectIds, ...(input.explicitObjectIds ?? [])]);
  for (const objectId of selectedIds) {
    addObjectIfAvailable(workspace, objectIds, skipped, objectId);
    const object = workspace.objects[objectId];
    if (!object || object.visibility !== "active") {
      continue;
    }
    if (object.type === "conceptDirection") {
      directionIds.add(object.id);
    }
    if (object.type === "image") {
      imageObjectIds.push(object.id);
      if (object.directionId) {
        directionIds.add(object.directionId);
      }
    }
    if (object.type === "file" && object.parseStatus === "parsed" && object.extractedAssetId) {
      documentObjectIds.push(object.id);
    }
  }

  if (input.kind === "comparison") {
    const budgeted = applyObjectBudget(workspace, objectIds, skipped);
    const budgetedDocuments = applyDocumentBudget(documentObjectIds, skipped);
    const budgetedImages = applyImageBudget(imageObjectIds, skipped);
    const designDefinitionRevision = getCurrentDesignDefinitionRevision(workspace);
    const projectContinuity = buildProjectContinuityContext(workspace, {
      taskKind: input.kind,
      selectedObjectIds: selectedIds,
      directObjectIds: budgeted.objectIds,
      directRevisionIds: [designDefinitionRevision?.id].filter((id): id is string => Boolean(id)),
      directBranchIds: [],
      directDecisionIds: collectDirectDecisionIds(workspace, budgeted.objectIds),
      targetDirectionIds: input.targetDirectionIds,
      includeHistorical: isHistoryOrientedDraft(input.draft)
    });

    return {
      kind: input.kind,
      objectIds: budgeted.objectIds,
      semanticSummaries: budgeted.objectIds
        .map((objectId) => summarizeObject(workspace.objects[objectId]))
        .filter((summary): summary is TaskContextSummary => Boolean(summary)),
      imageObjectIds: budgetedImages,
      documentObjectIds: budgetedDocuments,
      documentFragmentExtracts: collectDocumentFragmentExtracts(workspace, budgeted.objectIds),
      proposalDrafts: collectProposalDrafts(workspace, budgeted.objectIds),
      directionRevisions: [],
      designDefinitionRevision,
      visualBranches: [],
      skipped,
      truncated: budgeted.truncated || budgetedDocuments.length < documentObjectIds.length || budgetedImages.length < imageObjectIds.length,
      defaultReference: { status: "notIncluded", reason: "Compare never auto-includes default reference." },
      scopeNote: "Comparison Context only includes the explicit selected objects and does not auto-expand to related project state.",
      projectContinuity
    };
  }

  if (input.kind === "visualDevelopment" || input.kind === "directionPreview" || input.kind === "conceptDirection") {
    addCurrentDesignDefinition(workspace, objectIds, skipped);
  }

  for (const directionId of directionIds) {
    addObjectIfAvailable(workspace, objectIds, skipped, directionId);
    addRelatedKeyConclusions(workspace, objectIds, directionId);
  }

  const defaultReference = resolveDefaultReference(workspace, input, directionIds);
  if (defaultReference.status === "included") {
    addObjectIfAvailable(workspace, objectIds, skipped, defaultReference.objectId);
    if (!imageObjectIds.includes(defaultReference.objectId)) {
      imageObjectIds.push(defaultReference.objectId);
    }
  } else if (defaultReference.status === "hidden") {
    skipped.push({ objectId: defaultReference.objectId, reason: defaultReference.reason });
  }

  const directionRevisions = uniqueStrings([...directionIds])
    .map((directionId) => getCurrentDirectionRevision(workspace, directionId))
    .filter((revision): revision is ConceptDirectionRevision => Boolean(revision));
  const designDefinitionRevision = getCurrentDesignDefinitionRevision(workspace);
  const visualBranches = collectVisualBranches(workspace, input, imageObjectIds, directionIds);
  const budgeted = applyObjectBudget(workspace, objectIds, skipped);
  const budgetedDocuments = applyDocumentBudget(documentObjectIds, skipped);
  const budgetedImages = applyImageBudget(imageObjectIds, skipped);
  const documentFragmentExtracts = collectDocumentFragmentExtracts(workspace, budgeted.objectIds);
  const proposalDrafts = collectProposalDrafts(workspace, budgeted.objectIds);
  const projectContinuity = buildProjectContinuityContext(workspace, {
    taskKind: input.kind,
    selectedObjectIds: selectedIds,
    directObjectIds: budgeted.objectIds,
    directRevisionIds: uniqueStrings([
      designDefinitionRevision?.id,
      ...directionRevisions.map((revision) => revision.id)
    ].filter((id): id is string => Boolean(id))),
    directBranchIds: visualBranches.map((branch) => branch.id),
    directDecisionIds: collectDirectDecisionIds(workspace, budgeted.objectIds),
    targetDirectionIds: input.targetDirectionIds,
    includeHistorical: isHistoryOrientedDraft(input.draft)
  });

  return {
    kind: input.kind,
    objectIds: budgeted.objectIds,
    semanticSummaries: budgeted.objectIds
      .map((objectId) => summarizeObject(workspace.objects[objectId]))
      .filter((summary): summary is TaskContextSummary => Boolean(summary)),
    imageObjectIds: budgetedImages,
    documentObjectIds: budgetedDocuments,
    documentFragmentExtracts,
    proposalDrafts,
    directionRevisions,
    designDefinitionRevision,
    visualBranches,
    skipped,
    truncated: budgeted.truncated || budgetedDocuments.length < documentObjectIds.length || budgetedImages.length < imageObjectIds.length,
    defaultReference,
    scopeNote: `本次 ${input.kind} Context 只包含用户选择对象、直接相关的设计定义/方向/结论，以及被明确授权的图片和本地解析资料。`,
    projectContinuity
  };
}

function isHistoryOrientedDraft(draft: string): boolean {
  return /历史|旧版|旧图|之前|以往|回看|追溯|为什么/.test(draft);
}

export function taskContextKindFromAiTask(task: AiContextTask, visualIntent?: "directionPreview" | "visualDevelopment"): TaskContextKind {
  if (visualIntent) {
    return visualIntent;
  }
  switch (task) {
    case "research":
      return "research";
    case "comparison":
      return "comparison";
    case "designDefinition":
      return "designDefinition";
    case "conceptDirection":
      return "conceptDirection";
    case "visualDevelopment":
      return "visualDevelopment";
    default:
      return "general";
  }
}

export function buildProviderTaskContext(context: TaskContextResult): ProviderTaskContext {
  if (context.kind === "comparison") {
    throw new Error("Comparison task context must not be converted into provider task context.");
  }

  return {
    kind: context.kind,
    objectIds: context.objectIds,
    imageObjectIds: context.imageObjectIds,
    documentObjectIds: context.documentObjectIds,
    documentFragmentExtracts: context.documentFragmentExtracts,
    truncated: context.truncated,
    defaultReference: summarizeDefaultReference(context.defaultReference),
    designDefinition: context.designDefinitionRevision ? summarizeDesignDefinitionRevision(context.designDefinitionRevision) : undefined,
    directions: context.directionRevisions.map(summarizeDirectionRevision),
    visualBranches: context.visualBranches.map((branch) => ({
      id: branch.id,
      directionId: branch.directionId,
      label: branch.label,
      rootObjectId: branch.rootObjectId
    })),
    projectContinuity: context.projectContinuity,
    skipped: context.skipped
  };
}

export function buildProviderComparisonBackgroundContext(context: TaskContextResult): ProviderComparisonBackgroundContext {
  return {
    defaultReference: summarizeDefaultReference(context.defaultReference),
    designDefinition: context.designDefinitionRevision ? summarizeDesignDefinitionRevision(context.designDefinitionRevision) : undefined,
    projectContinuity: context.projectContinuity
  };
}

function addObjectIfAvailable(
  workspace: MorphoWorkspace,
  objectIds: MorphoObjectId[],
  skipped: TaskContextSkip[],
  objectId: MorphoObjectId
): void {
  const object = workspace.objects[objectId];
  if (!object) {
    skipped.push({ objectId, reason: "对象不存在，不能进入本次 AI Context。" });
    return;
  }
  if (object.visibility !== "active") {
    skipped.push({ objectId, reason: "对象已隐藏，默认不会进入本次 AI Context。" });
    return;
  }
  if (!objectIds.includes(objectId)) {
    objectIds.push(objectId);
  }
}

function addCurrentDesignDefinition(workspace: MorphoWorkspace, objectIds: MorphoObjectId[], skipped: TaskContextSkip[]): void {
  const definitionId = workspace.workingState.currentDesignDefinitionId;
  if (!definitionId) {
    return;
  }
  addObjectIfAvailable(workspace, objectIds, skipped, definitionId);
}

function addRelatedKeyConclusions(workspace: MorphoWorkspace, objectIds: MorphoObjectId[], directionId: MorphoObjectId): void {
  const directionRevision = getCurrentDirectionRevision(workspace, directionId);
  const definitionRevision = getCurrentDesignDefinitionRevision(workspace);
  const sourceIds = new Set([...(directionRevision?.sourceObjectIds ?? []), ...(definitionRevision?.sourceObjectIds ?? [])]);
  for (const object of Object.values(workspace.objects)) {
    if (object.type !== "keyConclusion" || object.visibility !== "active" || object.state !== "active") {
      continue;
    }
    if (object.sourceObjectIds.some((sourceId) => sourceIds.has(sourceId)) || directionRevision?.sourceObjectIds.includes(object.id)) {
      if (!objectIds.includes(object.id)) {
        objectIds.push(object.id);
      }
    }
  }
}

function resolveDefaultReference(
  workspace: MorphoWorkspace,
  input: BuildTaskContextInput,
  directionIds: Set<MorphoObjectId>
): TaskContextDefaultReference {
  const defaultId = workspace.workingState.currentDefaultReferenceId;
  if (!defaultId) {
    return { status: "missing", reason: "当前项目没有设置默认参考。" };
  }
  const object = workspace.objects[defaultId];
  if (!object || object.type !== "image") {
    return { status: "missing", reason: "默认参考对象不可用。" };
  }
  if (object.visibility !== "active") {
    return { status: "hidden", objectId: object.id, reason: "默认参考已隐藏，默认不会进入本次 AI Context。" };
  }
  const explicitlyRequested = DEFAULT_REFERENCE_PATTERN.test(input.draft);
  const isPixelEligibleTask = input.kind === "visualDevelopment" || input.kind === "directionPreview";
  const uniqueDirectionIds = uniqueStrings([...directionIds]);
  const sameDirection = Boolean(object.directionId && directionIds.has(object.directionId));
  const undirectedSingleTarget = !object.directionId && uniqueDirectionIds.length === 1;
  if (!explicitlyRequested) {
    return {
      status: "notIncluded",
      objectId: object.id,
      reason: "reason:default-reference-not-requested; default reference was not explicitly requested."
    };
  }
  if (!isPixelEligibleTask) {
    return {
      status: "notIncluded",
      objectId: object.id,
      reason: "reason:default-reference-non-visual-task; default reference pixels are only available to direction preview or visual development tasks."
    };
  }
  if (object.directionId && !sameDirection) {
    return {
      status: "notIncluded",
      objectId: object.id,
      reason: "reason:default-reference-direction-mismatch; default reference belongs to a different direction than the current target scope."
    };
  }
  if (!object.directionId && uniqueDirectionIds.length !== 1) {
    return {
      status: "notIncluded",
      objectId: object.id,
      reason: "reason:default-reference-ambiguous-multi-direction; undirected default reference requires one clear target direction."
    };
  }
  if (explicitlyRequested && isPixelEligibleTask && (sameDirection || undirectedSingleTarget)) {
    return { status: "included", objectId: object.id, reason: "用户明确要求保持或参考当前默认参考。" };
  }
  return { status: "notIncluded", objectId: object.id, reason: "默认参考不是本次任务的硬性输入，未被明确要求时不发送图片像素。" };
}

function getCurrentDirectionRevision(workspace: MorphoWorkspace, directionId: MorphoObjectId): ConceptDirectionRevision | undefined {
  const object = workspace.objects[directionId];
  if (!object || object.type !== "conceptDirection" || object.visibility !== "active") {
    return undefined;
  }
  return workspace.directionRevisions[object.currentRevisionId];
}

function getCurrentDesignDefinitionRevision(workspace: MorphoWorkspace): DesignDefinitionRevision | undefined {
  const definitionId = workspace.workingState.currentDesignDefinitionId;
  const object = definitionId ? workspace.objects[definitionId] : undefined;
  if (!object || object.type !== "designDefinition" || object.visibility !== "active") {
    return undefined;
  }
  return workspace.designDefinitionRevisions[object.currentRevisionId];
}

function collectVisualBranches(
  workspace: MorphoWorkspace,
  input: BuildTaskContextInput,
  imageObjectIds: MorphoObjectId[],
  directionIds: Set<MorphoObjectId>
): VisualBranchRecord[] {
  const branchIds = new Set<string>();
  if (input.visualBranchId) {
    branchIds.add(input.visualBranchId);
  }
  for (const imageId of imageObjectIds) {
    const image = workspace.objects[imageId];
    if (image?.type === "image" && image.visualBranchId) {
      branchIds.add(image.visualBranchId);
    }
  }
  for (const branch of Object.values(workspace.visualBranches)) {
    if (directionIds.has(branch.directionId) && !branch.archivedAt) {
      branchIds.add(branch.id);
    }
  }
  return [...branchIds].map((branchId) => workspace.visualBranches[branchId]).filter((branch): branch is VisualBranchRecord => Boolean(branch && !branch.archivedAt));
}

function collectDirectDecisionIds(workspace: MorphoWorkspace, objectIds: MorphoObjectId[]): string[] {
  const directObjectIds = new Set(objectIds);
  return workspace.decisionRecords
    .filter((decision) => decision.relatedObjectIds.some((objectId) => directObjectIds.has(objectId)) || (decision.objectSnapshot && directObjectIds.has(decision.objectSnapshot.id)))
    .map((decision) => decision.id);
}

function applyObjectBudget(
  workspace: MorphoWorkspace,
  objectIds: MorphoObjectId[],
  skipped: TaskContextSkip[]
): { objectIds: MorphoObjectId[]; truncated: boolean } {
  const limited = objectIds.slice(0, TASK_CONTEXT_LIMITS.maxObjectSummaries);
  for (const objectId of objectIds.slice(TASK_CONTEXT_LIMITS.maxObjectSummaries)) {
    const object = workspace.objects[objectId];
    skipped.push({ objectId, reason: `已达到对象摘要数量上限 ${TASK_CONTEXT_LIMITS.maxObjectSummaries}，本对象未进入本次摘要 Context。${object ? "" : ""}` });
  }
  return { objectIds: limited, truncated: limited.length < objectIds.length };
}

function applyDocumentBudget(documentObjectIds: MorphoObjectId[], skipped: TaskContextSkip[]): MorphoObjectId[] {
  const limited = uniqueStrings(documentObjectIds).slice(0, TASK_CONTEXT_LIMITS.maxDocumentExtracts);
  for (const objectId of uniqueStrings(documentObjectIds).slice(TASK_CONTEXT_LIMITS.maxDocumentExtracts)) {
    skipped.push({ objectId, reason: `已达到文件提取数量上限 ${TASK_CONTEXT_LIMITS.maxDocumentExtracts}，本文件未发送解析文本。` });
  }
  return limited;
}

function applyImageBudget(imageObjectIds: MorphoObjectId[], skipped: TaskContextSkip[]): MorphoObjectId[] {
  const limited = uniqueStrings(imageObjectIds).slice(0, TASK_CONTEXT_LIMITS.maxAiProviderImages);
  for (const objectId of uniqueStrings(imageObjectIds).slice(TASK_CONTEXT_LIMITS.maxAiProviderImages)) {
    skipped.push({ objectId, reason: `已达到 AiJWS 图片输入数量上限 ${TASK_CONTEXT_LIMITS.maxAiProviderImages}，本图片未发送像素。` });
  }
  return limited;
}

function collectDocumentFragmentExtracts(
  workspace: MorphoWorkspace,
  objectIds: MorphoObjectId[]
): TaskContextDocumentFragmentExtract[] {
  return objectIds.flatMap((objectId) => {
    const object = workspace.objects[objectId];
    if (!object || object.type !== "documentFragment" || object.visibility !== "active") {
      return [];
    }
    return [
      {
        objectId: object.id,
        title: object.title,
        text: object.body.slice(0, TASK_CONTEXT_LIMITS.maxCharsPerDocument),
        charCount: object.body.length,
        truncated: object.body.length > TASK_CONTEXT_LIMITS.maxCharsPerDocument,
        sourceFileObjectId: object.source.fileObjectId,
        sourceFileTitle: object.source.fileTitle,
        sourceStartOffset: object.source.startOffset,
        sourceEndOffset: object.source.endOffset,
        sourceAvailability: resolveDocumentFragmentSourceAvailability(workspace, object).status
      }
    ];
  });
}

function collectProposalDrafts(workspace: MorphoWorkspace, objectIds: MorphoObjectId[]): TaskContextProposalDraft[] {
  return uniqueStrings(objectIds).flatMap((objectId) => {
    const object = workspace.objects[objectId];
    if (!object || object.type !== "proposalDraft" || object.visibility !== "active") {
      return [];
    }

    const proposal = workspace.artifactProposals[object.proposalId];
    const draft = proposal?.status === "pending" ? summarizeProposalDraft(proposal) : undefined;
    return draft ? [draft] : [];
  });
}

function summarizeProposalDraft(proposal: ArtifactProposal): TaskContextProposalDraft | undefined {
  switch (proposal.type) {
    case "researchAnalysis":
      return {
        proposalId: proposal.id,
        proposalType: proposal.type,
        title: proposal.title,
        summary: proposal.summary,
        findings: [...proposal.findings],
        opportunities: [...proposal.opportunities],
        constraints: [...proposal.constraints],
        openQuestions: [...proposal.openQuestions]
      };
    case "designDefinition":
      return {
        proposalId: proposal.id,
        proposalType: proposal.type,
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
        changeNote: proposal.changeNote
      };
    case "conceptDirection":
      return {
        proposalId: proposal.id,
        proposalType: proposal.type,
        title: proposal.title,
        summary: proposal.summary,
        directions: proposal.directions.map((direction) => ({
          ...direction,
          keywords: [...direction.keywords],
          differentiators: [...direction.differentiators],
          visualSignals: [...direction.visualSignals],
          risks: [...direction.risks],
          openQuestions: [...direction.openQuestions]
        }))
      };
    case "deliveryPlan":
      return undefined;
  }
}

function summarizeObject(object: MorphoObject | undefined): TaskContextSummary | undefined {
  if (!object) {
    return undefined;
  }
  return {
    id: object.id,
    type: object.type,
    title: object.title,
    summary: object.summary,
    detail: detailForObject(object)
  };
}

function detailForObject(object: MorphoObject): string | undefined {
  switch (object.type) {
    case "text":
      return object.body.slice(0, 800);
    case "keyConclusion":
      return object.body;
    case "documentFragment":
      return [
        object.body.slice(0, 800),
        `source=${object.source.fileTitle}`,
        `range=${object.source.startOffset}-${object.source.endOffset}`
      ].join(" / ");
    case "research":
      return [...object.findings, ...object.opportunities, ...object.constraints, ...object.openQuestions].slice(0, 8).join(" / ");
    case "image":
      return [
        `role=${object.role}`,
        object.directionId ? `direction=${object.directionId}` : "",
        object.visualBranchId ? `visualBranch=${object.visualBranchId}` : "",
        object.generation ? `generatedBy=${object.generation.modelLabel}` : ""
      ]
        .filter(Boolean)
        .join(" / ");
    case "file":
      return `parseStatus=${object.parseStatus ?? "unparsed"}${object.extractedCharCount ? ` chars=${object.extractedCharCount}` : ""}`;
    case "conceptDirection":
      return `currentRevision=${object.currentRevisionId} status=${object.status}`;
    case "designDefinition":
      return `currentRevision=${object.currentRevisionId}`;
    default:
      return undefined;
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function summarizeDefaultReference(status: TaskContextDefaultReference): string {
  switch (status.status) {
    case "included":
      return `included:${status.objectId}:${status.reason}`;
    case "hidden":
      return `hidden:${status.objectId}:${status.reason}`;
    case "missing":
      return `missing:${status.reason}`;
    case "notIncluded":
      return status.objectId ? `notIncluded:${status.objectId}:${status.reason}` : `notIncluded:${status.reason}`;
  }
}

function summarizeDesignDefinitionRevision(revision: DesignDefinitionRevision): ProviderTaskContext["designDefinition"] {
  return {
    objectId: revision.designDefinitionId,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    title: revision.title,
    summary: revision.summary,
    projectGoal: revision.projectGoal,
    targetUsers: revision.targetUsers,
    primaryScenarios: revision.primaryScenarios,
    coreProblem: revision.coreProblem,
    designPrinciples: revision.designPrinciples,
    constraints: revision.constraints,
    avoidDirections: revision.avoidDirections,
    opportunities: revision.opportunities,
    openQuestions: revision.openQuestions,
    sourceObjectIds: revision.sourceObjectIds,
    previousRevisionId: revision.previousRevisionId,
    changeNote: revision.changeNote
  };
}

function summarizeDirectionRevision(revision: ConceptDirectionRevision): ProviderTaskContext["directions"][number] {
  return {
    objectId: revision.directionId,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    title: revision.title,
    summary: revision.summary,
    conceptStatement: revision.conceptStatement,
    keywords: revision.keywords,
    strategy: revision.strategy,
    differentiators: revision.differentiators,
    visualSignals: revision.visualSignals,
    risks: revision.risks,
    openQuestions: revision.openQuestions,
    sourceObjectIds: revision.sourceObjectIds,
    basedOnDefinitionRevisionId: revision.basedOnDefinitionRevisionId,
    previousRevisionId: revision.previousRevisionId,
    changeNote: revision.changeNote
  };
}
