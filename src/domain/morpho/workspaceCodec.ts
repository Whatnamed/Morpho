import { normalizeAgentTaskFulfillment } from "@/shared/agentReadCoverage";
import { createObjectIncarnationId } from "./objectIdentity";
import { reconcileWorkspaceDerivedState, createEmptyProjectWorkingState } from "./derivedState";
import {
  createDeliveryReferenceSnapshot as createStableDeliveryReferenceSnapshot,
  makeDeliveryReferenceId
} from "./deliveryPreparation";
import { createDeliverySourceFingerprint } from "./deliveryInspection";
import {
  createInitialProjectContinuity,
  normalizeProjectContinuityWithMessageReferences,
  type LegacyProjectFocus
} from "./projectContinuity";
import { createEmptyProjectMemoryState, normalizeProjectMemoryState } from "./projectMemory";
import {
  createEmptyConversationCompactionState,
  normalizeConversationCompactionState,
  normalizeConversationSummaryRevisions
} from "./conversationCompaction";
import { migrateLegacyConversationCheckpoint, stripLegacyWorkspaceCompatibilityFields } from "./legacyWorkspaceCompatibility";
import { normalizeProviderInputSnapshot, normalizeProviderOutputSnapshot } from "./providerInputSnapshot";
import { isValidCanonicalAgentRuntimeItem } from "@/shared/agentRuntimeItem";
import { isKeyConclusionCategory } from "./types";
import type { ArtifactProposal } from "../operations/types";
import type {
  AiMessage,
  AgentTrace,
  AssetId,
  AssetRecord,
  ConceptDirectionStatus,
  ComparisonAnalysis,
  ComparisonKeyConclusionCandidate,
  ComparisonObjectEntry,
  ComparisonObjectEvidence,
  ComparisonSourceRef,
  DeliveryObject,
  DeliveryGap,
  DeliveryReference,
  DeliveryReferenceId,
  DeliverySection,
  DesignDefinitionRevision,
  DirectionRevisionId,
  FileParseStatus,
  ImageRole,
  AssignableKeyConclusionCategory,
  KeyConclusionCategory,
  ConversationSummaryRevision,
  MorphoObject,
  MorphoObjectId,
  MorphoObjectType,
  MorphoRelation,
  MorphoWorkspace,
  ProviderContextFrame,
  WorkspaceMigrationResult
} from "./types";
import { CURRENT_SCHEMA_VERSION } from "./types";

export function serializeWorkspace(workspace: MorphoWorkspace): string {
  return JSON.stringify(workspace);
}

export function parseWorkspace(raw: string): WorkspaceMigrationResult {
  try {
    return migrateWorkspaceToCurrentSchema(JSON.parse(raw) as unknown);
  } catch {
    return {
      status: "failed",
      reason: "Stored Morpho workspace is not valid JSON."
    };
  }
}

export function migrateWorkspaceToCurrentSchema(value: unknown): WorkspaceMigrationResult {
  if (!isRecord(value)) {
    return {
      status: "failed",
      reason: "Stored Morpho workspace is not an object."
    };
  }

  if (value.schemaVersion === CURRENT_SCHEMA_VERSION) {
    return {
      status: "ok",
      workspace: normalizeCurrentWorkspace(value),
      didMigrate: false
    };
  }

  if (typeof value.schemaVersion === "number" && value.schemaVersion >= 5 && value.schemaVersion <= 17) {
    const migratedLegacyWorkspace = value.schemaVersion === 17 ? value : migrateLegacyWorkspaceToSchema17(migrateLegacyKeyConclusionCategories(value));
    return {
      status: "ok",
      workspace: establishForwardObjectIncarnations(normalizeCurrentWorkspace({
        ...migratedLegacyWorkspace,
        schemaVersion: CURRENT_SCHEMA_VERSION
      })),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 4) {
    return {
      status: "ok",
      workspace: establishForwardObjectIncarnations(migrateV4Workspace(value)),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 3) {
    return {
      status: "ok",
      workspace: establishForwardObjectIncarnations(migrateV4Workspace(migrateV3WorkspaceToV4(value))),
      didMigrate: true
    };
  }

  if (value.schemaVersion === 2) {
    return {
      status: "ok",
      workspace: establishForwardObjectIncarnations(migrateV4Workspace(migrateV2WorkspaceToV4(value))),
      didMigrate: true
    };
  }

  if (value.schemaVersion !== 1) {
    return {
      status: "failed",
      reason: "Unsupported Morpho workspace schema version."
    };
  }

  const migrated = migrateV1Workspace(value);

  if (!migrated) {
    return {
      status: "failed",
      reason: "Stored Morpho workspace is missing required v1 fields."
    };
  }

  return {
    status: "ok",
    workspace: establishForwardObjectIncarnations(migrateV4Workspace(migrateV2WorkspaceToV4(migrated))),
    didMigrate: true
  };
}

function establishForwardObjectIncarnations(workspace: MorphoWorkspace): MorphoWorkspace {
  // This checkpoint identifies surviving objects only from the upgrade onward.
  // It never restores a past identity or fills any historical binding.
  return {
    ...workspace,
    objects: Object.fromEntries(Object.entries(workspace.objects).map(([id, object]) => [
      id,
      object.incarnationId ? object : { ...object, incarnationId: createObjectIncarnationId() }
    ]))
  };
}

function migrateLegacyWorkspaceToSchema17(value: Record<string, unknown>): Record<string, unknown> {
  const rawAi = isRecord(value.ai) ? value.ai : {};
  const stripped = stripLegacyWorkspaceCompatibilityFields(value);
  const normalizedAi = normalizeAiState(stripped.ai);
  const migratedConversation = migrateLegacyConversationCheckpoint({
    legacyMessages: rawAi.messages,
    legacyCheckpoints: rawAi.conversationCheckpoints,
    currentMessages: normalizedAi.messages,
    state: normalizedAi.conversationCompaction,
    revisions: normalizedAi.conversationSummaryRevisions
  });

  return {
    ...stripped,
    ai: {
      ...normalizedAi,
      conversationCompaction: migratedConversation.state,
      conversationSummaryRevisions: migratedConversation.revisions
    }
  };
}

function migrateLegacyKeyConclusionCategories(value: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(value) as Record<string, unknown>;
  const rawObjects = isRecord(cloned.objects) ? cloned.objects : {};

  return {
    ...cloned,
    objects: Object.fromEntries(
      Object.entries(rawObjects).map(([objectId, rawObject]) => {
        if (!isRecord(rawObject) || (rawObject.type !== "keyConclusion" && rawObject.type !== "insight")) {
          return [objectId, rawObject];
        }
        return [objectId, {
          ...rawObject,
          category: inferLegacyKeyConclusionCategory(rawObject, rawObjects)
        }];
      })
    )
  };
}

function inferLegacyKeyConclusionCategory(
  rawObject: Record<string, unknown>,
  rawObjects: Record<string, unknown>
): KeyConclusionCategory {
  if (isKeyConclusionCategory(rawObject.category)) {
    return rawObject.category;
  }

  const sourceObjectIds = new Set(getStringArray(rawObject.sourceObjectIds));
  const contentCandidates = new Set(
    [rawObject.body, rawObject.summary]
      .filter((value): value is string => typeof value === "string")
      .map(normalizeLegacyCategoryText)
      .filter(Boolean)
  );
  const matches = new Set<AssignableKeyConclusionCategory>();
  const researchSections: Array<[AssignableKeyConclusionCategory, string]> = [
    ["finding", "findings"],
    ["opportunity", "opportunities"],
    ["constraint", "constraints"],
    ["openQuestion", "openQuestions"]
  ];

  if (contentCandidates.size > 0) {
    for (const [researchId, rawResearch] of Object.entries(rawObjects)) {
      if (!isRecord(rawResearch) || rawResearch.type !== "research") {
        continue;
      }
      if (sourceObjectIds.size === 0 || !sourceObjectIds.has(researchId)) {
        continue;
      }

      for (const [category, field] of researchSections) {
        if (getStringArray(rawResearch[field]).some((item) => contentCandidates.has(normalizeLegacyCategoryText(item)))) {
          matches.add(category);
        }
      }
    }
  }

  if (matches.size === 1) {
    return [...matches][0];
  }

  const note = typeof rawObject.note === "string" ? rawObject.note : "";
  // legacy schema compatibility only: old extraction notes are a migration hint, not a runtime semantic source.
  const legacyNoteMarkers: Array<{ marker: string; category: AssignableKeyConclusionCategory }> = [
    { marker: "发现第", category: "finding" },
    { marker: "机会点第", category: "opportunity" },
    { marker: "约束第", category: "constraint" },
    { marker: "待验证问题第", category: "openQuestion" }
  ];
  const noteMatch = legacyNoteMarkers.find(({ marker }) => note.includes(marker));
  return noteMatch?.category ?? "unknown";
}

function normalizeLegacyCategoryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function migrateV1Workspace(value: Record<string, unknown>): Record<string, unknown> | null {
  if (!isRecord(value.project) || !isRecord(value.objects) || !Array.isArray(value.relations) || !isRecord(value.canvas)) {
    return null;
  }

  const sourceObjects = value.objects;
  const migratedObjects: Record<MorphoObjectId, MorphoObject> = {};
  const deliveryReferences: Record<DeliveryReferenceId, DeliveryReference> = {};

  for (const [objectId, rawObject] of Object.entries(sourceObjects)) {
    if (!isRecord(rawObject) || typeof rawObject.type !== "string") {
      return null;
    }

    const visibility = rawObject.visibility === "hidden" ? "hidden" : "active";

    if (rawObject.type === "delivery") {
      const sourceIds = getStringArray(rawObject.references);
      const references = sourceIds.map((sourceObjectId) => makeDeliveryReferenceId(objectId, sourceObjectId));
      migratedObjects[objectId] = {
        ...(rawObject as unknown as DeliveryObject),
        visibility,
        references,
        sections: createMigratedDeliverySections(objectId, references, "2026-06-23T00:00:00.000Z"),
        gaps: normalizeDeliveryGaps((rawObject as Partial<DeliveryObject>).gaps, "2026-06-23T00:00:00.000Z")
      };
      continue;
    }

    migratedObjects[objectId] = {
      ...(rawObject as unknown as MorphoObject),
      visibility
    };
  }

  for (const [objectId, rawObject] of Object.entries(sourceObjects)) {
    if (!isRecord(rawObject) || rawObject.type !== "delivery") {
      continue;
    }

    for (const sourceObjectId of getStringArray(rawObject.references)) {
      const sourceObject = migratedObjects[sourceObjectId];
      if (!sourceObject) {
        continue;
      }

      const deliveryReferenceId = makeDeliveryReferenceId(objectId, sourceObjectId);
      deliveryReferences[deliveryReferenceId] = {
        id: deliveryReferenceId,
        deliveryObjectId: objectId,
        sectionId: `section-${objectId}-migrated-content`,
        order: getStringArray(rawObject.references).indexOf(sourceObjectId),
        sourceObjectId,
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
        snapshot: createStableDeliveryReferenceSnapshot(
          {
            objects: migratedObjects,
            assets: {},
            designDefinitionRevisions: {},
            directionRevisions: {}
          } as MorphoWorkspace,
          sourceObject
        ),
        sourceFingerprint: createDeliverySourceFingerprint(
          {
            objects: migratedObjects,
            assets: {},
            designDefinitionRevisions: {},
            directionRevisions: {}
          } as MorphoWorkspace,
          sourceObject
        )
      };
    }
  }

  return {
    ...(structuredClone(value) as Record<string, unknown>),
    schemaVersion: 2,
    objects: migratedObjects,
    deliveryReferences,
    deliverySectionDrafts: {},
    decisionRecords: []
  };
}

function migrateV2WorkspaceToV4(value: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(value) as Record<string, unknown>;
  const project = isRecord(cloned.project) ? cloned.project : {};
  const canvas = isRecord(cloned.canvas) ? cloned.canvas : {};
  const canvasView = isRecord(canvas.view) ? canvas.view : { x: 0, y: 0, zoom: 1 };

  return {
    ...cloned,
    schemaVersion: 4,
    project: {
      ...project,
      createdAt: typeof project.createdAt === "string" ? project.createdAt : "2026-06-23T00:00:00.000Z",
      updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : "2026-06-23T00:00:00.000Z",
      lastOpenedAt:
        typeof project.lastOpenedAt === "string"
          ? project.lastOpenedAt
          : typeof project.updatedAt === "string"
            ? project.updatedAt
            : "2026-06-23T00:00:00.000Z"
    },
    assets: createLegacyAssetRecords(cloned.objects as Record<MorphoObjectId, MorphoObject>),
    operations: {},
    artifactProposals: {},
    citationSnapshots: {},
    ui: {
      activeDrawer: null,
      aiOpen: true,
      lastSelectionIds: [],
      canvasView,
      workIntent: "discussion"
    }
  };
}

function migrateV3WorkspaceToV4(value: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(value) as Record<string, unknown>;
  return {
    ...cloned,
    schemaVersion: 4,
    operations: {},
    artifactProposals: {},
    citationSnapshots: {}
  };
}

function migrateV4Workspace(value: Record<string, unknown>): MorphoWorkspace {
  const cloned = structuredClone(value) as Record<string, unknown>;
  const now = new Date().toISOString();
  const rawObjects = isRecord(cloned.objects) ? cloned.objects : {};
  const rawRelations = Array.isArray(cloned.relations) ? (cloned.relations as MorphoRelation[]) : [];
  const objects: Record<MorphoObjectId, MorphoObject> = {};
  const designDefinitionRevisions: Record<string, DesignDefinitionRevision> = {};
  const directionRevisions: Record<string, MorphoWorkspace["directionRevisions"][string]> = {};

  for (const [objectId, rawObject] of Object.entries(rawObjects)) {
    if (!isRecord(rawObject) || typeof rawObject.type !== "string") {
      continue;
    }

    const createdAt = typeof rawObject.createdAt === "string" ? rawObject.createdAt : now;
    const updatedAt = typeof rawObject.updatedAt === "string" ? rawObject.updatedAt : createdAt;

    if (rawObject.type === "insight" || rawObject.type === "keyConclusion") {
      const state = rawObject.insightState === "needsValidation"
        ? "needsVerification"
        : rawObject.insightState === "superseded"
          ? "superseded"
          : rawObject.state === "needsVerification" || rawObject.state === "superseded" || rawObject.state === "archived"
            ? rawObject.state
            : "active";
      objects[objectId] = {
        id: objectId,
        type: "keyConclusion",
        title: stringValue(rawObject.title, objectId),
        summary: stringValue(rawObject.summary),
        body: stringValue(rawObject.body, stringValue(rawObject.summary)),
        createdBy: rawObject.createdBy === "ai" ? "ai" : "user",
        visibility: rawObject.visibility === "hidden" ? "hidden" : "active",
        category: inferLegacyKeyConclusionCategory(rawObject, rawObjects),
        state,
        confidence: rawObject.confidence === "supported" || rawObject.confidence === "partial" ? rawObject.confidence : "supported",
        sourceObjectIds: [],
        citationIds: [],
        confirmedAt: createdAt,
        note: typeof rawObject.note === "string" ? rawObject.note : undefined,
        createdAt,
        updatedAt
      };
      continue;
    }

    if (rawObject.type === "designDefinition") {
      const revisionId = `definition-revision-${objectId}-1`;
      objects[objectId] = {
        id: objectId,
        type: "designDefinition",
        title: stringValue(rawObject.title, objectId),
        summary: stringValue(rawObject.summary),
        createdBy: rawObject.createdBy === "ai" ? "ai" : "user",
        visibility: rawObject.visibility === "hidden" ? "hidden" : "active",
        problem: stringValue(rawObject.problem),
        principles: getStringArray(rawObject.principles),
        avoid: getStringArray(rawObject.avoid),
        currentRevisionId: revisionId,
        revisionIds: [revisionId],
        isCurrentEffective: true,
        createdAt,
        updatedAt
      };
      designDefinitionRevisions[revisionId] = {
        id: revisionId,
        designDefinitionId: objectId,
        revisionNumber: 1,
        title: stringValue(rawObject.title, objectId),
        summary: stringValue(rawObject.summary),
        projectGoal: stringValue(rawObject.summary),
        targetUsers: [],
        primaryScenarios: [],
        coreProblem: stringValue(rawObject.problem),
        designPrinciples: getStringArray(rawObject.principles),
        constraints: [],
        avoidDirections: getStringArray(rawObject.avoid),
        opportunities: [],
        openQuestions: [],
        sourceObjectIds: rawRelations
          .filter((relation) => relation.kind === "supports" && relation.toObjectId === objectId)
          .map((relation) => relation.fromObjectId),
        citationIds: [],
        createdAt,
        isCurrent: true
      };
      continue;
    }

    if (rawObject.type === "conceptDirection") {
      const revisionId = `direction-revision-${objectId}-1` as DirectionRevisionId;
      const currentDefinition = Object.values(designDefinitionRevisions).find((revision) => revision.isCurrent);
      objects[objectId] = {
        id: objectId,
        type: "conceptDirection",
        title: stringValue(rawObject.title, objectId),
        summary: stringValue(rawObject.summary),
        createdBy: rawObject.createdBy === "ai" ? "ai" : "user",
        visibility: rawObject.visibility === "hidden" ? "hidden" : "active",
        status: isDirectionStatus(rawObject.status) ? rawObject.status : "pendingPreview",
        keywords: getStringArray(rawObject.keywords),
        currentRevisionId: revisionId,
        revisionIds: [revisionId],
        lineageRootId: objectId,
        createdAt,
        updatedAt
      };
      directionRevisions[revisionId] = {
        id: revisionId,
        directionId: objectId,
        revisionNumber: 1,
        title: stringValue(rawObject.title, objectId),
        summary: stringValue(rawObject.summary),
        conceptStatement: stringValue(rawObject.summary),
        keywords: getStringArray(rawObject.keywords),
        strategy: stringValue(rawObject.summary),
        differentiators: [],
        visualSignals: [],
        risks: [],
        openQuestions: [],
        sourceObjectIds: rawRelations
          .filter((relation) => relation.kind === "supports" && relation.toObjectId === objectId)
          .map((relation) => relation.fromObjectId),
        citationIds: [],
        basedOnDefinitionRevisionId: currentDefinition?.id,
        createdAt,
        isCurrent: true
      };
      continue;
    }

    objects[objectId] = {
      ...(rawObject as unknown as MorphoObject),
      visibility: rawObject.visibility === "hidden" ? "hidden" : "active",
      createdAt,
      updatedAt
    };
  }

  const normalized: MorphoWorkspace = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: {
      id: stringValue((cloned.project as Record<string, unknown>)?.id, "project-nightrail"),
      title: stringValue((cloned.project as Record<string, unknown>)?.title, "未命名项目"),
      subtitle: stringValue((cloned.project as Record<string, unknown>)?.subtitle),
      createdAt: stringValue((cloned.project as Record<string, unknown>)?.createdAt, now),
      updatedAt: stringValue((cloned.project as Record<string, unknown>)?.updatedAt, now),
      lastOpenedAt: stringValue((cloned.project as Record<string, unknown>)?.lastOpenedAt, now),
      coverAssetId:
        typeof (cloned.project as Record<string, unknown>)?.coverAssetId === "string"
          ? ((cloned.project as Record<string, unknown>).coverAssetId as string)
          : undefined
    },
    objects,
    assets: isRecord(cloned.assets) ? (cloned.assets as Record<AssetId, AssetRecord>) : {},
    relations: rawRelations,
    deliveryReferences: isRecord(cloned.deliveryReferences)
      ? normalizeDeliveryReferences(
          cloned.deliveryReferences as Record<DeliveryReferenceId, DeliveryReference>,
          normalizeObjectsForSchemaV13(objects),
          isRecord(cloned.assets) ? (cloned.assets as Record<AssetId, AssetRecord>) : {}
        )
      : {},
    deliverySectionDrafts: isRecord(cloned.deliverySectionDrafts)
      ? (cloned.deliverySectionDrafts as MorphoWorkspace["deliverySectionDrafts"])
      : {},
    decisionRecords: Array.isArray(cloned.decisionRecords) ? (cloned.decisionRecords as MorphoWorkspace["decisionRecords"]) : [],
    operations: isRecord(cloned.operations) ? (cloned.operations as MorphoWorkspace["operations"]) : {},
    artifactProposals: isRecord(cloned.artifactProposals)
      ? (cloned.artifactProposals as MorphoWorkspace["artifactProposals"])
      : {},
    citationSnapshots: isRecord(cloned.citationSnapshots)
      ? (cloned.citationSnapshots as MorphoWorkspace["citationSnapshots"])
      : {},
    designDefinitionRevisions,
    directionRevisions,
    directionLineage: [],
    visualBranches: {},
    workingState: createEmptyProjectWorkingState(now),
    projectContinuity: createInitialProjectContinuity({
      workspace: {
        project: {
          id: stringValue((cloned.project as Record<string, unknown>)?.id, "project-nightrail"),
          title: stringValue((cloned.project as Record<string, unknown>)?.title, "未命名项目"),
          subtitle: stringValue((cloned.project as Record<string, unknown>)?.subtitle),
          createdAt: stringValue((cloned.project as Record<string, unknown>)?.createdAt, now),
          updatedAt: stringValue((cloned.project as Record<string, unknown>)?.updatedAt, now),
          lastOpenedAt: stringValue((cloned.project as Record<string, unknown>)?.lastOpenedAt, now)
        },
        objects,
        designDefinitionRevisions,
        directionRevisions
      },
      now,
      legacyFocus: legacyProjectFocus((cloned.project as Record<string, unknown>)?.currentFocus)
    }),
    projectMemory: createEmptyProjectMemoryState(now),
    canvas: (cloned.canvas as MorphoWorkspace["canvas"]) ?? {
      view: { x: 0, y: 0, zoom: 1 },
      instances: []
    },
    ai: normalizeAiState(cloned.ai),
    ui: (cloned.ui as MorphoWorkspace["ui"]) ?? {
      activeDrawer: null,
      aiOpen: true,
      lastSelectionIds: [],
      canvasView: { x: 0, y: 0, zoom: 1 },
      workIntent: "discussion"
    }
  };

  return reconcileWorkspaceDerivedState(normalizeCurrentWorkspace(normalized), now);
}

function normalizeAiState(value: unknown): MorphoWorkspace["ai"] {
  if (!isRecord(value)) {
    return {
      messages: [],
      conversationCompaction: createEmptyConversationCompactionState(),
      conversationSummaryRevisions: {},
      providerContextFrames: [],
      comparisonAnalyses: {}
    };
  }

  const messages = Array.isArray(value.messages)
    ? (value.messages as AiMessage[]).map(normalizeAiMessage)
    : [];
  const conversationSummaryRevisions = normalizeConversationSummaryRevisions(value.conversationSummaryRevisions);

  return {
    messages,
    conversationCompaction: normalizeConversationCompactionState(value.conversationCompaction),
    conversationSummaryRevisions,
    providerContextFrames: normalizeProviderContextFrames(
      value.providerContextFrames,
      conversationSummaryRevisions,
      messages
    ),
    comparisonAnalyses: normalizeComparisonAnalyses(value.comparisonAnalyses)
  };
}

function normalizeComparisonAnalyses(value: unknown): MorphoWorkspace["ai"]["comparisonAnalyses"] {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([analysisId, rawAnalysis]) => {
      const normalizedAnalysis = normalizeComparisonAnalysis(analysisId, rawAnalysis);
      return normalizedAnalysis ? [[analysisId, normalizedAnalysis]] : [];
    })
  );
}

function normalizeComparisonAnalysis(analysisId: string, value: unknown): ComparisonAnalysis | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const keyConclusionCandidate = isRecord(value.keyConclusionCandidate)
    ? normalizeComparisonKeyConclusionCandidate(value.keyConclusionCandidate)
    : undefined;

  return {
    id: stringValue(value.id, analysisId),
    assistantMessageId: stringValue(value.assistantMessageId),
    userMessageId: stringValue(value.userMessageId),
    createdAt: stringValue(value.createdAt),
    updatedAt: stringValue(value.updatedAt),
    sourceObjectIds: getStringArray(value.sourceObjectIds),
    sourceRefs: normalizeComparisonSourceRefs(value.sourceRefs),
    comparisonGoal: stringValue(value.comparisonGoal),
    conclusionSummary: stringValue(value.conclusionSummary),
    objectComparisons: normalizeComparisonObjectEntries(value.objectComparisons),
    recommendedQuestions: getStringArray(value.recommendedQuestions),
    evidenceLimits: getStringArray(value.evidenceLimits),
    ...(keyConclusionCandidate ? { keyConclusionCandidate } : {})
  };
}

function normalizeComparisonKeyConclusionCandidate(value: Record<string, unknown>): ComparisonKeyConclusionCandidate | undefined {
  if (
    typeof value.title !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.body !== "string"
  ) {
    return undefined;
  }
  const confidence = normalizeComparisonConfidence(value.confidence);
  if (!confidence) {
    return undefined;
  }

  return {
    title: value.title,
    summary: value.summary,
    body: value.body,
    category: isKeyConclusionCategory(value.category) ? value.category : "unknown",
    sourceObjectIds: getStringArray(value.sourceObjectIds),
    evidence: normalizeComparisonObjectEvidence(value.evidence),
    confidence,
    ...(typeof value.note === "string" ? { note: value.note } : {})
  };
}

function normalizeComparisonObjectEvidence(value: unknown): ComparisonObjectEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.objectId !== "string" ||
      typeof candidate.label !== "string" ||
      typeof candidate.evidence !== "string"
    ) {
      return [];
    }
    return [{
      objectId: candidate.objectId,
      label: candidate.label,
      evidence: candidate.evidence
    }];
  });
}

function normalizeComparisonObjectEntries(value: unknown): ComparisonObjectEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.objectId !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.summary !== "string"
    ) {
      return [];
    }
    const evidenceBasis = normalizeComparisonEvidenceBasis(candidate.evidenceBasis);
    return [{
      objectId: candidate.objectId,
      title: candidate.title,
      ...(evidenceBasis ? { evidenceBasis } : {}),
      summary: candidate.summary,
      strengths: getStringArray(candidate.strengths),
      risks: getStringArray(candidate.risks),
      evidence: getStringArray(candidate.evidence)
    }];
  });
}

function normalizeComparisonSourceRefs(value: unknown): ComparisonSourceRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.objectId !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.summary !== "string"
    ) {
      return [];
    }
    const objectType = normalizeComparisonObjectType(candidate.objectType);
    const availability = normalizeComparisonSourceAvailability(candidate.availability);
    if (!objectType || !availability) {
      return [];
    }
    return [{
      objectId: candidate.objectId,
      objectType,
      title: candidate.title,
      summary: candidate.summary,
      availability
    }];
  });
}

function normalizeComparisonObjectType(value: unknown): MorphoObjectType | undefined {
  const objectTypes: readonly MorphoObjectType[] = [
    "image",
    "file",
    "text",
    "link",
    "imageCollection",
    "research",
    "keyConclusion",
    "documentFragment",
    "proposalDraft",
    "designDefinition",
    "conceptDirection",
    "delivery"
  ];
  return objectTypes.find((objectType) => objectType === value);
}

function normalizeComparisonSourceAvailability(value: unknown): ComparisonSourceRef["availability"] | undefined {
  return value === "active" || value === "hidden" || value === "missing" ? value : undefined;
}

function normalizeComparisonEvidenceBasis(value: unknown): ComparisonObjectEntry["evidenceBasis"] {
  return value === "pixels" || value === "objectSummary" || value === "documentExtract" || value === "documentFragment"
    ? value
    : undefined;
}

function normalizeComparisonConfidence(value: unknown): ComparisonKeyConclusionCandidate["confidence"] | undefined {
  return value === "supported" || value === "partial" || value === "needsVerification" ? value : undefined;
}

function normalizeProviderContextFrames(
  value: unknown,
  summaryRevisions: Record<string, ConversationSummaryRevision>,
  messages: readonly AiMessage[]
): ProviderContextFrame[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const usedSequences = new Set<number>();
  const summaryKeys = new Set<string>();
  const frames = value.flatMap((candidate, index) => {
    if (!isRecord(candidate) || candidate.contextVisibility !== "providerOnly") {
      return [];
    }
    const kind = candidate.kind as ProviderContextFrame["kind"];
    if (
      (kind !== "projectState" &&
        kind !== "turnContext" &&
        kind !== "runtimeConfiguration" &&
        kind !== "conversationSummary") ||
      typeof candidate.id !== "string" ||
      typeof candidate.createdAt !== "string" ||
      typeof candidate.promptContractVersion !== "string" ||
      typeof candidate.renderedText !== "string" ||
      typeof candidate.contentHash !== "string" ||
      typeof candidate.reason !== "string"
    ) {
      return [];
    }
    const sourceRefs = Array.isArray(candidate.sourceRefs)
      ? candidate.sourceRefs.flatMap((source) => {
          if (!isRecord(source) || typeof source.kind !== "string" || typeof source.id !== "string") {
            return [];
          }
          return [{
            kind: source.kind,
            id: source.id,
            ...(typeof source.title === "string" ? { title: source.title } : {})
          }];
        })
      : [];
    const sequence = normalizeFrameSequence(candidate.sequence, index + 1, usedSequences);
    const placement = kind === "conversationSummary"
      ? "conversationBaseline"
      : normalizeFramePlacement(candidate.placement, candidate.anchorMessageId);
    const summaryRevisionId = kind === "conversationSummary"
      ? inferSummaryRevisionId(candidate, summaryRevisions, messages)
      : placement === "conversationBaseline" &&
          typeof candidate.summaryRevisionId === "string" &&
          summaryRevisions[candidate.summaryRevisionId]
        ? candidate.summaryRevisionId
        : undefined;
    const summaryKey = kind === "conversationSummary"
      ? summaryRevisionId ?? `legacy:${candidate.contentHash}`
      : undefined;
    if (summaryKey && summaryKeys.has(summaryKey)) {
      return [];
    }
    if (summaryKey) {
      summaryKeys.add(summaryKey);
    }
    return [{
      id: kind === "conversationSummary" && summaryRevisionId
        ? `provider-frame-conversation-summary:${summaryRevisionId}`
        : candidate.id,
      kind,
      createdAt: candidate.createdAt,
      sequence,
      placement,
      promptContractVersion: candidate.promptContractVersion,
      ...(typeof candidate.taskStrategy === "string" ? { taskStrategy: candidate.taskStrategy as ProviderContextFrame["taskStrategy"] } : {}),
      projectMemoryRevisionIds: stringArray(candidate.projectMemoryRevisionIds),
      stageRecordRevisionIds: stringArray(candidate.stageRecordRevisionIds),
      ...(typeof candidate.designDefinitionRevisionId === "string"
        ? { designDefinitionRevisionId: candidate.designDefinitionRevisionId }
        : {}),
      directionRevisionIds: stringArray(candidate.directionRevisionIds),
      ...(typeof candidate.defaultReferenceObjectId === "string"
        ? { defaultReferenceObjectId: candidate.defaultReferenceObjectId }
        : {}),
      selectedObjectIds: stringArray(candidate.selectedObjectIds),
      relatedObjectIds: stringArray(candidate.relatedObjectIds),
      renderedText: candidate.renderedText,
      contentHash: candidate.contentHash,
      ...(typeof candidate.supersedesFrameId === "string" ? { supersedesFrameId: candidate.supersedesFrameId } : {}),
      contextVisibility: "providerOnly" as const,
      sourceRefs,
      reason: candidate.reason,
      ...(typeof candidate.anchorMessageId === "string" ? { anchorMessageId: candidate.anchorMessageId } : {}),
      ...(summaryRevisionId ? { summaryRevisionId } : {}),
      ...(isValidCanonicalAgentRuntimeItem(candidate.runtimeItem)
        ? { runtimeItem: candidate.runtimeItem }
        : {})
    }];
  });
  return frames.sort((left, right) => left.sequence - right.sequence);
}

function normalizeFrameSequence(value: unknown, fallback: number, used: Set<number>): number {
  const candidate = typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let next = Math.max(fallback, ...used) + 1;
  while (used.has(next)) {
    next += 1;
  }
  used.add(next);
  return next;
}

function normalizeFramePlacement(value: unknown, anchorMessageId: unknown): ProviderContextFrame["placement"] {
  if (
    value === "conversationBaseline" ||
    value === "beforeUser" ||
    value === "afterUser" ||
    value === "beforeAssistant" ||
    value === "afterAssistant"
  ) {
    return value;
  }
  return typeof anchorMessageId === "string" ? "beforeUser" : "conversationBaseline";
}

function inferSummaryRevisionId(
  candidate: Record<string, unknown>,
  summaryRevisions: Record<string, ConversationSummaryRevision>,
  messages: readonly AiMessage[]
): string | undefined {
  if (typeof candidate.summaryRevisionId === "string") {
    if (summaryRevisions[candidate.summaryRevisionId]) {
      return candidate.summaryRevisionId;
    }
  }
  if (typeof candidate.anchorMessageId === "string") {
    const messageRevisionId = messages.find(
      (message) => message.id === candidate.anchorMessageId && message.conversationSummaryRevisionId
    )?.conversationSummaryRevisionId;
    if (messageRevisionId && summaryRevisions[messageRevisionId]) {
      return messageRevisionId;
    }
    const sourceEndRevision = Object.values(summaryRevisions).find(
      (revision) => revision.sourceEndMessageId === candidate.anchorMessageId
    );
    if (sourceEndRevision) {
      return sourceEndRevision.id;
    }
  }
  if (typeof candidate.renderedText === "string") {
    const matchingRevisions = Object.values(summaryRevisions).filter(
      (revision) => renderConversationSummaryFrameText(revision) === candidate.renderedText
    );
    if (matchingRevisions.length === 1) {
      return matchingRevisions[0]?.id;
    }
  }
  return undefined;
}

function renderConversationSummaryFrameText(revision: ConversationSummaryRevision): string {
  const summary = revision.summary;
  return [
    `项目聊天摘要目标：${summary.threadGoal}`,
    `已建立上下文：${summary.establishedContext.join("；") || "无"}`,
    `决定及原因：${summary.decisionsAndReasons.join("；") || "无"}`,
    `当前工作：${summary.activeWork.join("；") || "无"}`,
    `未解决问题：${summary.unresolvedQuestions.join("；") || "无"}`,
    `下一轮锚点：${summary.nextTurnAnchor ?? "无"}`
  ].join("\n");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeAiMessageContextVisibility(message: AiMessage): AiMessage {
  if (message.contextVisibility === "model" || message.contextVisibility === "uiOnly") {
    return message;
  }

  return isLegacyUiOnlyAiMessage(message) ? { ...message, contextVisibility: "uiOnly" } : message;
}

function normalizeAiMessage(message: AiMessage): AiMessage {
  const normalized = normalizeAiMessageContextVisibility(message);
  const providerInputSnapshot = normalizeProviderInputSnapshot(message.providerInputSnapshot);
  const providerOutputSnapshot = normalizeProviderOutputSnapshot(message.providerOutputSnapshot);
  const {
    agentTurnOutcomeItem: _legacyOutcomeItem,
    agentTurnClosureRecovery: _legacyClosureRecovery,
    ...withoutLegacyBMessageState
  } = normalized as AiMessage & {
    agentTurnOutcomeItem?: unknown;
    agentTurnClosureRecovery?: unknown;
  };
  const snapshotNormalized = {
    ...withoutLegacyBMessageState,
    ...(message.taskFulfillment ? { taskFulfillment: normalizeAgentTaskFulfillment(message.taskFulfillment) } : {}),
    ...(providerInputSnapshot ? { providerInputSnapshot } : {}),
    ...(providerOutputSnapshot ? { providerOutputSnapshot } : {})
  };
  if (!snapshotNormalized.agentTrace) {
    return snapshotNormalized;
  }
  const {
    providerRequestState: _legacyProviderRequestState,
    ...traceWithoutLegacyBRequestState
  } = snapshotNormalized.agentTrace as AgentTrace & { providerRequestState?: unknown };
  const providerDiagnostics = snapshotNormalized.agentTrace.providerDiagnostics
    ? stripHistoricalProviderDiagnosticStates(snapshotNormalized.agentTrace.providerDiagnostics)
    : undefined;
  return {
    ...snapshotNormalized,
    agentTrace: {
      ...traceWithoutLegacyBRequestState,
      ...(providerDiagnostics ? { providerDiagnostics } : {})
    }
  };
}

function stripHistoricalProviderDiagnosticStates(
  diagnostics: NonNullable<AgentTrace["providerDiagnostics"]>
): NonNullable<AgentTrace["providerDiagnostics"]> {
  const {
    previousRequestState: _previousRequestState,
    requestState: _requestState,
    ...compact
  } = diagnostics as typeof diagnostics & {
    previousRequestState?: unknown;
    requestState?: unknown;
  };
  return compact;
}

function isLegacyUiOnlyAiMessage(message: AiMessage): boolean {
  if (message.role === "user") {
    return message.body.trim().toLocaleLowerCase() === "/compact";
  }

  return [
    "正在压缩当前上下文…",
    "上下文压缩完成。已保留当前项目状态、选中对象、待继续问题和最近讨论。",
    "当前讨论还很短，无需压缩。",
    "上下文压缩未完成：模型没有返回可用的讨论摘要，请稍后重试。",
    "上下文压缩已取消。"
  ].includes(message.body.trim());
}

function normalizeCurrentWorkspace(value: Record<string, unknown>): MorphoWorkspace {
  const canonicalValue = stripLegacyWorkspaceCompatibilityFields(value);
  const cloned = structuredClone(canonicalValue) as Partial<MorphoWorkspace>;
  const sourceProject = isRecord(canonicalValue.project) ? canonicalValue.project : {};
  const now =
    typeof sourceProject.updatedAt === "string"
      ? sourceProject.updatedAt
      : typeof sourceProject.createdAt === "string"
        ? sourceProject.createdAt
        : new Date().toISOString();
  const canvasView = cloned.ui?.canvasView ?? cloned.canvas?.view ?? { x: 0, y: 0, zoom: 1 };
  const objects = normalizeObjectsForSchemaV16(
    normalizeObjectsForSchemaV13(normalizeObjectsForSchemaV7(cloned.objects ?? {}))
  );
  const rawProject = sourceProject;
  const project = {
    id: typeof rawProject.id === "string" ? rawProject.id : "project-nightrail",
    title: typeof rawProject.title === "string" ? rawProject.title : "未命名项目",
    subtitle: typeof rawProject.subtitle === "string" ? rawProject.subtitle : "",
    createdAt: typeof rawProject.createdAt === "string" ? rawProject.createdAt : now,
    updatedAt: typeof rawProject.updatedAt === "string" ? rawProject.updatedAt : now,
    lastOpenedAt: typeof rawProject.lastOpenedAt === "string" ? rawProject.lastOpenedAt : now,
    coverAssetId: typeof rawProject.coverAssetId === "string" ? rawProject.coverAssetId : undefined
  };
  const designDefinitionRevisions = cloned.designDefinitionRevisions ?? {};
  const directionRevisions = cloned.directionRevisions ?? {};
  const ai = normalizeAiState(cloned.ai);
  const normalizedContinuity = normalizeProjectContinuityWithMessageReferences(
    {
      project,
      objects,
      designDefinitionRevisions,
      directionRevisions
    },
    cloned.projectContinuity,
    ai.messages,
    legacyProjectFocus(rawProject.currentFocus)
  );

  const normalized = reconcileWorkspaceDerivedState({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project,
    objects,
    assets: cloned.assets ?? {},
    relations: cloned.relations ?? [],
    deliveryReferences: normalizeDeliveryReferences(cloned.deliveryReferences ?? {}, objects, cloned.assets ?? {}),
    deliverySectionDrafts: cloned.deliverySectionDrafts ?? {},
    decisionRecords: cloned.decisionRecords ?? [],
    operations: cloned.operations ?? {},
    artifactProposals: normalizeArtifactProposals(cloned.artifactProposals ?? {}, objects),
    citationSnapshots: cloned.citationSnapshots ?? {},
    designDefinitionRevisions,
    directionRevisions,
    directionLineage: cloned.directionLineage ?? [],
    visualBranches: cloned.visualBranches ?? {},
    workingState: cloned.workingState ?? createEmptyProjectWorkingState(now),
    projectContinuity: normalizedContinuity.state,
    projectMemory: createEmptyProjectMemoryState(now),
    canvas: cloned.canvas ?? {
      view: { x: 0, y: 0, zoom: 1 },
      instances: []
    },
    ai: {
      ...ai,
      messages: normalizedContinuity.messages
    },
    ui: {
      activeDrawer: cloned.ui?.activeDrawer ?? null,
      aiOpen: cloned.ui?.aiOpen ?? true,
      lastSelectionIds: cloned.ui?.lastSelectionIds ?? [],
      canvasView,
      workIntent: cloned.ui?.workIntent ?? "discussion"
    }
  }, now);

  return {
    ...normalized,
    projectMemory: normalizeProjectMemoryState(normalized, cloned.projectMemory, now)
  };
}

function createLegacyAssetRecords(objects: Record<MorphoObjectId, MorphoObject>): Record<string, AssetRecord> {
  const assets: Record<string, AssetRecord> = {};

  for (const object of Object.values(objects)) {
    if (object.type !== "image" && object.type !== "file" && object.type !== "link") {
      continue;
    }

    const assetId = "assetId" in object ? object.assetId : undefined;
    if (!assetId) {
      continue;
    }

    assets[assetId] = {
      id: assetId,
      fileName: object.type === "file" ? object.fileName ?? object.title : object.title,
      mimeType:
        object.type === "image"
          ? "image/*"
          : object.type === "file"
            ? object.mimeType ?? "application/octet-stream"
            : "text/uri-list",
      size: object.type === "file" ? object.size ?? 0 : 0,
      createdAt: object.createdAt ?? "2026-06-23T00:00:00.000Z",
      storageKey: `legacy:${assetId}`,
      sourceType:
        object.type === "image" && object.createdBy === "ai"
          ? "aiGeneratedImage"
          : object.type === "link"
            ? "originalLink"
            : object.type === "image"
              ? "originalImage"
              : "originalFile",
      url: object.type === "link" ? object.url : undefined,
      domain: object.type === "link" ? object.domain : undefined
    };
  }

  return assets;
}

function normalizeObjectsForSchemaV7(objects: Record<MorphoObjectId, MorphoObject>): Record<MorphoObjectId, MorphoObject> {
  return Object.fromEntries(
    Object.entries(objects).map(([objectId, object]) => {
      if (object.type === "file") {
        return [
          objectId,
          {
            ...object,
            parseStatus: normalizeFileParseStatus(object.parseStatus),
            parseError: object.parseStatus === "failed" ? object.parseError : undefined
          }
        ];
      }

      if (object.type !== "image") {
        return [objectId, object];
      }

      return [
        objectId,
        {
          ...object,
          role: normalizeImageRole(object.role)
        }
      ];
    })
  );
}

function normalizeObjectsForSchemaV16(objects: Record<MorphoObjectId, MorphoObject>): Record<MorphoObjectId, MorphoObject> {
  return Object.fromEntries(
    Object.entries(objects).map(([objectId, object]) => {
      if (object.type !== "keyConclusion") {
        return [objectId, object];
      }
      return [
        objectId,
        {
          ...object,
          category: isKeyConclusionCategory(object.category) ? object.category : "unknown"
        }
      ];
    })
  );
}

function normalizeFileParseStatus(value: unknown): FileParseStatus {
  switch (value) {
    case "parsing":
    case "parsed":
    case "failed":
    case "unparsed":
      return value;
    default:
      return "unparsed";
  }
}

function normalizeImageRole(value: unknown): ImageRole {
  switch (value) {
    case "main":
      return "primaryVisual";
    case "scenario":
      return "sceneVisual";
    case "cmf":
      return "cmfStudy";
    case "detail":
      return "detailStudy";
    case "diagram":
      return "structureDiagram";
    case "reference":
    case "preview":
    case "conceptImage":
    case "primaryVisual":
    case "sceneVisual":
    case "cmfStudy":
    case "detailStudy":
    case "structureDiagram":
    case "interactionDiagram":
    case "deliveryAsset":
      return value;
    default:
      return "reference";
  }
}

function normalizeArtifactProposals(
  proposals: Record<string, ArtifactProposal>,
  objects: Record<MorphoObjectId, MorphoObject>
): Record<string, ArtifactProposal> {
  return Object.fromEntries(
    Object.entries(proposals).map(([proposalId, proposal]) => {
      const sourceSnapshots =
        Array.isArray(proposal.sourceSnapshots) && proposal.sourceSnapshots.length > 0
          ? proposal.sourceSnapshots
          : proposal.sourceObjectIds.map((objectId) => ({ objectId, objectType: objects[objectId]?.type ?? "unknown", visibility: "unknown", semanticFingerprint: "unknown" }));

      if (proposal.type !== "conceptDirection") {
        return [
          proposalId,
          {
            ...proposal,
            sourceSnapshots
          }
        ];
      }

      const parentDirectionIds = proposal.parentDirectionIds ?? inferParentDirectionIds(proposal);
      const applicationMode = proposal.applicationMode ?? inferConceptDirectionApplicationMode(proposal, parentDirectionIds);

      return [
        proposalId,
        {
          ...proposal,
          applicationMode,
          targetDirectionId:
            proposal.targetDirectionId ??
            (applicationMode === "revise" ? proposal.directions[0]?.basedOnDirectionId : undefined),
          parentDirectionIds,
          directions: proposal.directions.map((direction) => ({
            ...direction,
            lineageKind: normalizeDirectionLineageKind(direction.lineageKind)
          })),
          sourceSnapshots
        }
      ];
    })
  );
}

function normalizeDirectionLineageKind(
  value: unknown
): Extract<ArtifactProposal, { type: "conceptDirection" }>["directions"][number]["lineageKind"] {
  switch (value) {
    case "variant":
    case "derivedFromDirection":
      return "derivedFromDirection";
    case "split":
    case "splitFromDirection":
      return "splitFromDirection";
    case "merge":
    case "mergedFromDirection":
      return "mergedFromDirection";
    case "revision":
    case "supersedesDirection":
      return "supersedesDirection";
    default:
      return undefined;
  }
}

function inferParentDirectionIds(proposal: Extract<ArtifactProposal, { type: "conceptDirection" }>): MorphoObjectId[] {
  return [
    ...new Set(
      proposal.directions.map((direction) => direction.basedOnDirectionId).filter((id): id is string => Boolean(id))
    )
  ];
}

function inferConceptDirectionApplicationMode(
  proposal: Extract<ArtifactProposal, { type: "conceptDirection" }>,
  parentDirectionIds: MorphoObjectId[]
): Extract<ArtifactProposal, { type: "conceptDirection" }>["applicationMode"] {
  if (proposal.workIntent === "reviseConceptDirection") {
    return "revise";
  }
  if (proposal.workIntent === "splitConceptDirection") {
    return "split";
  }
  if (proposal.workIntent === "mergeConceptDirections") {
    return "merge";
  }
  return parentDirectionIds.length > 0 ? "split" : "create";
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeObjectsForSchemaV13(objects: Record<MorphoObjectId, MorphoObject>): Record<MorphoObjectId, MorphoObject> {
  return Object.fromEntries(
    Object.entries(objects).map(([objectId, object]) => {
      if (object.type !== "delivery") {
        return [objectId, object];
      }
      const now = object.updatedAt ?? object.createdAt ?? "2026-07-02T00:00:00.000Z";
      const references = Array.isArray(object.references) ? object.references : [];
      const sections =
        Array.isArray(object.sections) && object.sections.length > 0
          ? normalizeDeliverySections(object.sections, references, object.id, now)
          : createMigratedDeliverySections(object.id, references, now);
      return [
        objectId,
        {
          ...object,
          sections,
          gaps: normalizeDeliveryGaps(object.gaps, now),
          references
        }
      ];
    })
  );
}

function normalizeDeliverySections(
  sections: DeliverySection[],
  references: DeliveryReferenceId[],
  deliveryObjectId: MorphoObjectId,
  now: string
): DeliverySection[] {
  const remaining = new Set(references);
  const normalized: DeliverySection[] = sections.map((section, index) => {
    const referenceIds = Array.isArray(section.referenceIds)
      ? section.referenceIds.filter((referenceId) => {
          if (!remaining.has(referenceId)) {
            return false;
          }
          remaining.delete(referenceId);
          return true;
        })
      : [];
    return {
      id: typeof section.id === "string" && section.id ? section.id : `section-${deliveryObjectId}-${index + 1}`,
      title: typeof section.title === "string" && section.title.trim() ? section.title : "交付内容",
      purpose: typeof section.purpose === "string" && section.purpose.trim() ? section.purpose : undefined,
      order: index,
      referenceIds,
      narrative: typeof section.narrative === "string" && section.narrative.trim() ? section.narrative : undefined,
      copyReviewReferenceIds: section.copyReviewReferenceIds,
      createdAt: typeof section.createdAt === "string" ? section.createdAt : now,
      updatedAt: typeof section.updatedAt === "string" ? section.updatedAt : now
    };
  });

  if (remaining.size > 0) {
    normalized.push({
      id: `section-${deliveryObjectId}-migrated-content`,
      title: "交付内容",
      purpose: "结构迁移保留的既有交付引用。",
      order: normalized.length,
      referenceIds: [...remaining],
      narrative: undefined,
      createdAt: now,
      updatedAt: now
    });
  }

  return normalized.map((section, order) => ({ ...section, order }));
}

function createMigratedDeliverySections(
  deliveryObjectId: MorphoObjectId,
  references: DeliveryReferenceId[],
  now: string
): DeliverySection[] {
  if (references.length === 0) {
    return [];
  }
  return [
    {
      id: `section-${deliveryObjectId}-migrated-content`,
      title: "交付内容",
      purpose: "结构迁移保留的既有交付引用。",
      order: 0,
      referenceIds: [...references],
      createdAt: now,
      updatedAt: now
    }
  ];
}

function normalizeDeliveryGaps(value: unknown, now: string): DeliveryGap[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isRecord)
    .map((gap, index) => ({
      id: typeof gap.id === "string" && gap.id ? gap.id : `gap-migrated-${index + 1}`,
      label: typeof gap.label === "string" ? gap.label : "待补内容",
      sectionId: typeof gap.sectionId === "string" ? gap.sectionId : undefined,
      status: gap.status === "resolved" ? "resolved" as const : "open" as const,
      origin: gap.origin === "deliveryDraft" ? "deliveryDraft" as const : "manual" as const,
      createdAt: typeof gap.createdAt === "string" ? gap.createdAt : now,
      updatedAt: typeof gap.updatedAt === "string" ? gap.updatedAt : now,
      resolvedAt: typeof gap.resolvedAt === "string" ? gap.resolvedAt : undefined
    }));
}

function normalizeDeliveryReferences(
  references: Record<DeliveryReferenceId, DeliveryReference>,
  objects: Record<MorphoObjectId, MorphoObject>,
  assets: Record<AssetId, AssetRecord>
): Record<DeliveryReferenceId, DeliveryReference> {
  const workspaceForSnapshots = {
    objects,
    assets,
    designDefinitionRevisions: {},
    directionRevisions: {}
  } as MorphoWorkspace;
  const deliveryMembership = new Map<DeliveryReferenceId, { deliveryObjectId: MorphoObjectId; sectionId: string; order: number }>();
  for (const object of Object.values(objects)) {
    if (object.type !== "delivery") {
      continue;
    }
    for (const section of object.sections) {
      section.referenceIds.forEach((referenceId, order) => {
        deliveryMembership.set(referenceId, { deliveryObjectId: object.id, sectionId: section.id, order });
      });
    }
  }

  return Object.fromEntries(
    Object.entries(references).map(([referenceId, reference]) => {
      const membership = deliveryMembership.get(referenceId);
      const source = reference.sourceObjectId ? objects[reference.sourceObjectId] : undefined;
      const snapshot = reference.snapshot ?? (source ? createStableDeliveryReferenceSnapshot(workspaceForSnapshots, source) : {
        sourceType: "text" as const,
        title: "旧交付引用",
        summary: "迁移保留的旧交付引用快照。"
      });
      return [
        referenceId,
        {
          ...reference,
          deliveryObjectId: reference.deliveryObjectId ?? membership?.deliveryObjectId,
          sectionId: membership?.sectionId ?? reference.sectionId,
          order: membership?.order ?? reference.order,
          snapshot,
          updatedAt: reference.updatedAt ?? reference.createdAt,
          sourceFingerprint: reference.sourceFingerprint,
          sourceAssetId: reference.sourceAssetId ?? (source ? getDeliveryReferenceAssetId(source) : undefined)
        }
      ];
    })
  );
}

function getDeliveryReferenceAssetId(source: MorphoObject): AssetId | undefined {
  switch (source.type) {
    case "image":
    case "file":
    case "link":
      return source.assetId;
    case "documentFragment":
      return source.source.sourceExtractAssetId;
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectionStatus(value: unknown): value is ConceptDirectionStatus {
  return (
    value === "pendingPreview" ||
    value === "primary" ||
    value === "alternative" ||
    value === "eliminated" ||
    value === "needsReview"
  );
}

function legacyProjectFocus(value: unknown): LegacyProjectFocus | undefined {
  switch (value) {
    case "direction_visual_development":
    case "research":
    case "design_definition":
    case "delivery_preparation":
      return value;
    default:
      return undefined;
  }
}
