import type { SourceCitation } from "../operations/types";
import type {
  AiMessage,
  AssetId,
  AssetRecord,
  ComparisonAnalysis,
  ConceptDirectionObject,
  DecisionRecord,
  DeliveryObject,
  DeliveryReference,
  DeliverySectionDraft,
  DesignDefinitionObject,
  DirectionLineageRecord,
  DocumentFragmentObject,
  FileObject,
  ImageObject,
  KeyConclusionObject,
  LinkObject,
  MorphoObject,
  MorphoRelation,
  MorphoWorkspace,
  ProjectContinuityState,
  ResearchObject,
  TextObject,
  VisualBranchRecord
} from "./types";

export const HUMAN_READABLE_ARCHIVE_FORMAT = "morpho-human-readable-archive";
export const EDITABLE_PROJECT_BACKUP_FORMAT = "morpho-editable-project-backup";
export const PROJECT_ARCHIVE_MANIFEST_VERSION = "1";

export type ProjectArchiveDiagnosticSeverity = "info" | "warning" | "error";

export type ProjectArchiveDiagnostic = {
  code:
    | "asset_metadata_orphaned"
    | "backup_chat_scope_mismatch"
    | "backup_continuity_scope_mismatch"
    | "binary_not_verified"
    | "duplicate_portable_bundle_key"
    | "invalid_asset_inventory_entry"
    | "invalid_asset_inventory_reference"
    | "invalid_backup_scope"
    | "invalid_binary_status"
    | "invalid_format"
    | "invalid_manifest_version"
    | "invalid_source_project"
    | "invalid_workspace_snapshot"
    | "missing_asset_metadata"
    | "referenced_asset_missing_inventory_entry"
    | "runtime_storage_key_exposed"
    | "workspace_asset_inventory_mismatch";
  severity: ProjectArchiveDiagnosticSeverity;
  message: string;
  path?: string;
};

export type AssetBinaryStatus = "notVerified" | "metadataOnly" | "missingMetadata";

export type PortableAssetInventoryEntry = {
  sourceAssetId: AssetId;
  portableBundleKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  sourceType: AssetRecord["sourceType"];
  createdAt: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  url?: string;
  domain?: string;
  binaryStatus: AssetBinaryStatus;
};

export type WorkspaceAssetReference = {
  assetId: AssetId;
  field: string;
  ownerKind: "project" | "object" | "deliveryReference";
  ownerId: string;
  usage:
    | "projectCover"
    | "objectAsset"
    | "documentExtract"
    | "deliverySourceAsset"
    | "deliverySnapshotPreview";
};

export type WorkspaceAssetInventory = {
  entries: PortableAssetInventoryEntry[];
  references: WorkspaceAssetReference[];
  diagnostics: ProjectArchiveDiagnostic[];
};

export type ManifestSourceProject = {
  id: string;
  title: string;
  subtitle: string;
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string;
};

export type ArchiveChatScope = "none" | "decisionSummary" | "full";
export type ArchiveProjectContinuityScope = "none" | "current";
export type EditableBackupChatScope = "none" | "full";
export type EditableBackupProjectContinuityScope = "current" | "recordEntriesNone";

export type ProjectArchiveOptions = {
  createdAt?: string;
  chat?: ArchiveChatScope;
  projectContinuity?: ArchiveProjectContinuityScope;
};

export type EditableBackupOptions = {
  createdAt?: string;
  chat?: EditableBackupChatScope;
  projectContinuity?: EditableBackupProjectContinuityScope;
};

export type ProjectManifestIntegrity = {
  diagnostics: ProjectArchiveDiagnostic[];
};

export type ArchiveVisualObject = {
  id: ImageObject["id"];
  title: ImageObject["title"];
  summary: ImageObject["summary"];
  visibility: ImageObject["visibility"];
  assetId?: ImageObject["assetId"];
  role: ImageObject["role"];
  imageVariant: ImageObject["imageVariant"];
  directionId?: ImageObject["directionId"];
  directionTitle?: string;
  visualBranchId?: ImageObject["visualBranchId"];
  visualBranchLabel?: string;
  isDefaultReference: boolean;
  relatedRelationKinds: MorphoRelation["kind"][];
};

export type ArchiveSourceIndexObject = FileObject | LinkObject | TextObject | DocumentFragmentObject;

export type HumanReadableArchiveManifest = {
  format: typeof HUMAN_READABLE_ARCHIVE_FORMAT;
  manifestVersion: typeof PROJECT_ARCHIVE_MANIFEST_VERSION;
  createdAt: string;
  sourceProject: ManifestSourceProject;
  workspaceSchemaVersion: MorphoWorkspace["schemaVersion"];
  options: {
    chat: ArchiveChatScope;
    projectContinuity: ArchiveProjectContinuityScope;
  };
  assetInventory: WorkspaceAssetInventory;
  integrity: ProjectManifestIntegrity;
  archive: {
    projectOverview: ManifestSourceProject;
    designDefinitions: DesignDefinitionObject[];
    keyConclusions: KeyConclusionObject[];
    directions: ConceptDirectionObject[];
    visualObjects: ArchiveVisualObject[];
    researchAndSources: {
      researchObjects: ResearchObject[];
      sourceIndex: ArchiveSourceIndexObject[];
      citationSnapshots: Record<string, SourceCitation>;
    };
    decisions: DecisionRecord[];
    projectContinuity: ArchiveContinuitySection;
    projectMemory: MorphoWorkspace["projectMemory"];
    conversation: ArchiveConversationSection;
    delivery: {
      packages: DeliveryObject[];
      references: DeliveryReference[];
      sectionDrafts: DeliverySectionDraft[];
    };
    traceability: {
      relations: MorphoWorkspace["relations"];
      designDefinitionRevisions: MorphoWorkspace["designDefinitionRevisions"];
      directionRevisions: MorphoWorkspace["directionRevisions"];
      visualBranches: Record<string, VisualBranchRecord>;
      directionLineage: DirectionLineageRecord[];
    };
  };
};

export type PortableAssetMetadata = Omit<AssetRecord, "storageKey">;

export type EditableBackupWorkspaceSnapshot = Omit<MorphoWorkspace, "assets"> & {
  assets: Record<AssetId, PortableAssetMetadata>;
};

export type EditableProjectBackupManifest = {
  format: typeof EDITABLE_PROJECT_BACKUP_FORMAT;
  manifestVersion: typeof PROJECT_ARCHIVE_MANIFEST_VERSION;
  createdAt: string;
  sourceProject: ManifestSourceProject;
  workspaceSchemaVersion: MorphoWorkspace["schemaVersion"];
  options: {
    chat: EditableBackupChatScope;
    projectContinuity: EditableBackupProjectContinuityScope;
    restoreContract: {
      restoresAsNewProjectCopy: true;
      mustRemapProjectId: true;
      mustRegenerateRuntimeStorageKeys: true;
      mustRemapAssetIdsIfChanged: true;
      neverMergeByDefault: true;
    };
  };
  assetInventory: WorkspaceAssetInventory;
  integrity: ProjectManifestIntegrity;
  workspaceSnapshot: EditableBackupWorkspaceSnapshot;
};

export type ManifestCreationResult<TManifest> =
  | {
      status: "ok";
      manifest: TManifest;
      diagnostics: ProjectArchiveDiagnostic[];
    }
  | {
      status: "blocked";
      reason: string;
      diagnostics: ProjectArchiveDiagnostic[];
    };

export type ManifestValidationResult<TManifest> =
  | {
      status: "ok";
      manifest: TManifest;
      diagnostics: ProjectArchiveDiagnostic[];
    }
  | {
      status: "failed";
      reason: string;
      diagnostics: ProjectArchiveDiagnostic[];
    };

type ArchiveContinuitySection =
  | {
      mode: "none";
    }
  | {
      mode: "current";
      currentFocus: ProjectContinuityState["currentFocus"];
      recordEntries: ProjectContinuityState["recordEntries"];
      updatedAt: string;
    };

type ArchiveConversationSection =
  | {
      mode: "none";
    }
  | {
      mode: "decisionSummary";
      messages: AiMessage[];
    }
  | {
      mode: "full";
      messages: AiMessage[];
      conversationCheckpoints: MorphoWorkspace["ai"]["conversationCheckpoints"];
      conversationCompaction: MorphoWorkspace["ai"]["conversationCompaction"];
      conversationSummaryRevisions: MorphoWorkspace["ai"]["conversationSummaryRevisions"];
      comparisonAnalyses: Record<string, ComparisonAnalysis>;
    };

export function createHumanReadableArchiveManifest(
  workspace: MorphoWorkspace,
  options: ProjectArchiveOptions = {}
): ManifestCreationResult<HumanReadableArchiveManifest> {
  const assetInventory = collectWorkspaceAssetInventory(workspace);
  const diagnostics = [...assetInventory.diagnostics];
  const manifest: HumanReadableArchiveManifest = {
    format: HUMAN_READABLE_ARCHIVE_FORMAT,
    manifestVersion: PROJECT_ARCHIVE_MANIFEST_VERSION,
    createdAt: options.createdAt ?? new Date().toISOString(),
    sourceProject: sourceProjectFromWorkspace(workspace),
    workspaceSchemaVersion: workspace.schemaVersion,
    options: {
      chat: options.chat ?? "none",
      projectContinuity: options.projectContinuity ?? "none"
    },
    assetInventory,
    integrity: { diagnostics },
    archive: {
      projectOverview: sourceProjectFromWorkspace(workspace),
      designDefinitions: objectsOfType(workspace, "designDefinition"),
      keyConclusions: objectsOfType(workspace, "keyConclusion"),
      directions: objectsOfType(workspace, "conceptDirection"),
      visualObjects: buildArchiveVisualObjects(workspace),
      researchAndSources: {
        researchObjects: objectsOfType(workspace, "research"),
        sourceIndex: buildArchiveSourceIndex(workspace),
        citationSnapshots: workspace.citationSnapshots
      },
      decisions: workspace.decisionRecords,
      projectContinuity: buildArchiveContinuity(workspace, options.projectContinuity ?? "none"),
      projectMemory: workspace.projectMemory,
      conversation: buildArchiveConversation(workspace, options.chat ?? "none"),
      delivery: {
        packages: objectsOfType(workspace, "delivery"),
        references: Object.values(workspace.deliveryReferences),
        sectionDrafts: Object.values(workspace.deliverySectionDrafts)
      },
      traceability: {
        relations: workspace.relations,
        designDefinitionRevisions: workspace.designDefinitionRevisions,
        directionRevisions: workspace.directionRevisions,
        visualBranches: workspace.visualBranches,
        directionLineage: workspace.directionLineage
      }
    }
  };

  return { status: "ok", manifest, diagnostics };
}

export function createEditableProjectBackupManifest(
  workspace: MorphoWorkspace,
  options: EditableBackupOptions = {}
): ManifestCreationResult<EditableProjectBackupManifest> {
  const assetInventory = collectWorkspaceAssetInventory(workspace);
  const chatScope = options.chat ?? "full";
  const continuityScope = options.projectContinuity ?? "current";
  const manifest: EditableProjectBackupManifest = {
    format: EDITABLE_PROJECT_BACKUP_FORMAT,
    manifestVersion: PROJECT_ARCHIVE_MANIFEST_VERSION,
    createdAt: options.createdAt ?? new Date().toISOString(),
    sourceProject: sourceProjectFromWorkspace(workspace),
    workspaceSchemaVersion: workspace.schemaVersion,
    options: {
      chat: chatScope,
      projectContinuity: continuityScope,
      restoreContract: {
        restoresAsNewProjectCopy: true,
        mustRemapProjectId: true,
        mustRegenerateRuntimeStorageKeys: true,
        mustRemapAssetIdsIfChanged: true,
        neverMergeByDefault: true
      }
    },
    assetInventory,
    integrity: { diagnostics: [...assetInventory.diagnostics] },
    workspaceSnapshot: sanitizeWorkspaceForEditableBackup(workspace, {
      chat: chatScope,
      projectContinuity: continuityScope
    })
  };

  const validation = validateEditableProjectBackupManifest(manifest);
  const diagnostics = dedupeDiagnostics([...assetInventory.diagnostics, ...validation.diagnostics]);
  if (validation.status === "failed") {
    return {
      status: "blocked",
      reason: "Editable backup manifest has blocking integrity issues.",
      diagnostics
    };
  }

  manifest.integrity = { diagnostics };
  return { status: "ok", manifest, diagnostics };
}

export function collectWorkspaceAssetInventory(workspace: MorphoWorkspace): WorkspaceAssetInventory {
  const references = collectWorkspaceAssetReferences(workspace);
  const diagnostics: ProjectArchiveDiagnostic[] = [];
  const entries = Object.values(workspace.assets)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((assetRecord) => toPortableAssetInventoryEntry(assetRecord));

  const referencedAssetIds = new Set(references.map((reference) => reference.assetId));
  for (const entry of entries) {
    diagnostics.push({
      code: "binary_not_verified",
      severity: "warning",
      message: `Asset ${entry.sourceAssetId} has metadata, but M7-A does not read or verify binary content.`,
      path: `assetInventory.entries.${entry.sourceAssetId}`
    });
    if (!referencedAssetIds.has(entry.sourceAssetId)) {
      diagnostics.push({
        code: "asset_metadata_orphaned",
        severity: "info",
        message: `Asset ${entry.sourceAssetId} exists as metadata but has no audited workspace reference.`,
        path: `assets.${entry.sourceAssetId}`
      });
    }
  }

  for (const reference of references) {
    if (!workspace.assets[reference.assetId]) {
      diagnostics.push({
        code: "missing_asset_metadata",
        severity: "warning",
        message: `Asset reference ${reference.field} points to ${reference.assetId}, but workspace.assets has no metadata for it.`,
        path: reference.field
      });
    }
  }

  return { entries, references, diagnostics: dedupeDiagnostics(diagnostics) };
}

export function collectWorkspaceAssetReferenceDiagnostics(workspace: MorphoWorkspace): ProjectArchiveDiagnostic[] {
  return collectWorkspaceAssetInventory(workspace).diagnostics;
}

export function sanitizeWorkspaceForEditableBackup(
  workspace: MorphoWorkspace,
  options: {
    chat: EditableBackupChatScope;
    projectContinuity: EditableBackupProjectContinuityScope;
  }
): EditableBackupWorkspaceSnapshot {
  const assets = Object.fromEntries(
    Object.entries(workspace.assets).map(([assetId, assetRecord]) => [assetId, omitRuntimeStorageKey(assetRecord)])
  );

  return {
    ...workspace,
    assets,
    ai: sanitizeBackupAiState(workspace.ai, options.chat),
    projectContinuity: sanitizeBackupProjectContinuity(workspace.projectContinuity, options.projectContinuity),
    ui: {
      activeDrawer: null,
      aiOpen: true,
      lastSelectionIds: [],
      canvasView: workspace.canvas.view,
      workIntent: "discussion"
    }
  };
}

function sanitizeBackupAiState(
  ai: MorphoWorkspace["ai"],
  chat: EditableBackupChatScope
): MorphoWorkspace["ai"] {
  if (chat === "full") {
    return ai;
  }

  return {
    messages: [],
    conversationCheckpoints: [],
    conversationCompaction: { coveredMessageCount: 0 },
    conversationSummaryRevisions: {},
    comparisonAnalyses: {}
  };
}

function sanitizeBackupProjectContinuity(
  projectContinuity: MorphoWorkspace["projectContinuity"],
  scope: EditableBackupProjectContinuityScope
): MorphoWorkspace["projectContinuity"] {
  if (scope === "current") {
    return projectContinuity;
  }

  return {
    ...projectContinuity,
    recordEntries: []
  };
}

export function validateHumanReadableArchiveManifest(
  value: unknown
): ManifestValidationResult<HumanReadableArchiveManifest> {
  return validateManifest(value, HUMAN_READABLE_ARCHIVE_FORMAT, isHumanReadableArchiveManifest, false);
}

export function validateEditableProjectBackupManifest(value: unknown): ManifestValidationResult<EditableProjectBackupManifest> {
  return validateManifest(value, EDITABLE_PROJECT_BACKUP_FORMAT, isEditableProjectBackupManifest, true);
}

function validateManifest<TManifest>(
  value: unknown,
  expectedFormat: typeof HUMAN_READABLE_ARCHIVE_FORMAT | typeof EDITABLE_PROJECT_BACKUP_FORMAT,
  typeGuard: (value: unknown) => value is TManifest,
  validateBackupSnapshotShape: boolean
): ManifestValidationResult<TManifest> {
  const diagnostics: ProjectArchiveDiagnostic[] = [];
  if (!isRecord(value)) {
    return failed("Manifest must be a JSON object.", diagnostics);
  }

  if (value.format !== expectedFormat) {
    diagnostics.push({
      code: "invalid_format",
      severity: "error",
      message: `Expected format ${expectedFormat}.`,
      path: "format"
    });
  }

  if (value.manifestVersion !== PROJECT_ARCHIVE_MANIFEST_VERSION) {
    diagnostics.push({
      code: "invalid_manifest_version",
      severity: "error",
      message: `Unsupported manifestVersion ${stringifyForMessage(value.manifestVersion)}.`,
      path: "manifestVersion"
    });
  }

  if (!isSourceProject(value.sourceProject)) {
    diagnostics.push({
      code: "invalid_source_project",
      severity: "error",
      message: "sourceProject must include string id, title, and subtitle.",
      path: "sourceProject"
    });
  }

  diagnostics.push(...validateAssetInventoryShape(value.assetInventory, validateBackupSnapshotShape ? "backup" : "archive"));

  if (validateBackupSnapshotShape) {
    diagnostics.push(...validateBackupSnapshot(value.workspaceSnapshot, value.assetInventory, value.options));
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error") || !typeGuard(value)) {
    return failed("Manifest failed structural validation.", dedupeDiagnostics(diagnostics));
  }

  return { status: "ok", manifest: value, diagnostics: dedupeDiagnostics(diagnostics) };
}

function validateAssetInventoryShape(
  value: unknown,
  mode: "archive" | "backup"
): ProjectArchiveDiagnostic[] {
  const diagnostics: ProjectArchiveDiagnostic[] = [];
  if (!isRecord(value) || !Array.isArray(value.entries) || !Array.isArray(value.references)) {
    diagnostics.push({
      code: "invalid_asset_inventory_entry",
      severity: "error",
      message: "assetInventory must include entries and references arrays.",
      path: "assetInventory"
    });
    return diagnostics;
  }

  const seenPortableBundleKeys = new Set<string>();
  const inventoryAssetIds = new Set<string>();

  for (const [index, entry] of value.entries.entries()) {
    if (!isPortableAssetInventoryEntry(entry)) {
      diagnostics.push({
        code: "invalid_asset_inventory_entry",
        severity: "error",
        message: "Each asset inventory entry must include complete portable asset metadata.",
        path: `assetInventory.entries.${index}`
      });
      continue;
    }
    if ("storageKey" in entry) {
      diagnostics.push({
        code: "runtime_storage_key_exposed",
        severity: "error",
        message: "Portable asset inventory entries must not expose runtime storageKey values.",
        path: `assetInventory.entries.${index}.storageKey`
      });
    }
    if (!isAssetBinaryStatus(entry.binaryStatus)) {
      diagnostics.push({
        code: "invalid_binary_status",
        severity: "error",
        message: `Unsupported binaryStatus ${stringifyForMessage(entry.binaryStatus)}.`,
        path: `assetInventory.entries.${index}.binaryStatus`
      });
    }
    if (seenPortableBundleKeys.has(entry.portableBundleKey)) {
      diagnostics.push({
        code: "duplicate_portable_bundle_key",
        severity: "error",
        message: `Duplicate portableBundleKey ${entry.portableBundleKey}.`,
        path: `assetInventory.entries.${index}.portableBundleKey`
      });
    }
    seenPortableBundleKeys.add(entry.portableBundleKey);
    inventoryAssetIds.add(entry.sourceAssetId);
  }

  for (const [index, reference] of value.references.entries()) {
    if (!isWorkspaceAssetReference(reference)) {
      diagnostics.push({
        code: "invalid_asset_inventory_reference",
        severity: "error",
        message: "Each asset reference must include assetId, field, ownerKind, ownerId, and usage.",
        path: `assetInventory.references.${index}`
      });
      continue;
    }
    if (!inventoryAssetIds.has(reference.assetId)) {
      diagnostics.push({
        code: "referenced_asset_missing_inventory_entry",
        severity: mode === "backup" ? "error" : "warning",
        message: `Asset reference ${reference.assetId} has no asset inventory entry.`,
        path: `assetInventory.references.${index}.assetId`
      });
    }
  }

  return diagnostics;
}

function validateBackupSnapshot(
  workspaceSnapshot: unknown,
  assetInventory: unknown,
  options: unknown
): ProjectArchiveDiagnostic[] {
  const diagnostics: ProjectArchiveDiagnostic[] = [];
  if (
    !isRecord(workspaceSnapshot) ||
    typeof workspaceSnapshot.schemaVersion !== "number" ||
    !isRecord(workspaceSnapshot.objects) ||
    !isRecord(workspaceSnapshot.assets) ||
    !isRecord(workspaceSnapshot.projectContinuity)
  ) {
    diagnostics.push({
      code: "invalid_workspace_snapshot",
      severity: "error",
      message: "workspaceSnapshot must include schemaVersion, objects, assets, and projectContinuity.",
      path: "workspaceSnapshot"
    });
    return diagnostics;
  }

  const snapshotAssetIds = new Set<string>();
  const snapshotSchemaVersion = workspaceSnapshot.schemaVersion as number;
  if (snapshotSchemaVersion >= 15 && !isRecord(workspaceSnapshot.projectMemory)) {
    diagnostics.push({
      code: "invalid_workspace_snapshot",
      severity: "error",
      message: "schema 15 editable backups must include Project Memory and Stage Records.",
      path: "workspaceSnapshot.projectMemory"
    });
  }
  for (const [assetId, assetValue] of Object.entries(workspaceSnapshot.assets)) {
    snapshotAssetIds.add(assetId);
    if (!isPortableAssetMetadataRecord(assetValue)) {
      diagnostics.push({
        code: "invalid_workspace_snapshot",
        severity: "error",
        message: `workspaceSnapshot.assets.${assetId} must include portable asset metadata.`,
        path: `workspaceSnapshot.assets.${assetId}`
      });
      continue;
    }
    if ("storageKey" in assetValue) {
      diagnostics.push({
        code: "runtime_storage_key_exposed",
        severity: "error",
        message: "workspaceSnapshot.assets must not expose runtime storageKey values.",
        path: `workspaceSnapshot.assets.${assetId}.storageKey`
      });
    }
  }

  if (!isRecord(assetInventory) || !Array.isArray(assetInventory.entries)) {
    return diagnostics;
  }

  const inventoryAssetIds = new Set(
    assetInventory.entries
      .filter(isPortableAssetInventoryEntry)
      .map((entry) => entry.sourceAssetId)
  );

  const missingFromSnapshot = [...inventoryAssetIds].filter((assetId) => !snapshotAssetIds.has(assetId));
  const extraInSnapshot = [...snapshotAssetIds].filter((assetId) => !inventoryAssetIds.has(assetId));
  if (missingFromSnapshot.length > 0 || extraInSnapshot.length > 0) {
    diagnostics.push({
      code: "workspace_asset_inventory_mismatch",
      severity: "error",
      message: "workspaceSnapshot.assets must match assetInventory entries exactly.",
      path: "workspaceSnapshot.assets"
    });
  }

  diagnostics.push(...validateEditableBackupScope(options, workspaceSnapshot));

  return diagnostics;
}

function validateEditableBackupScope(
  options: unknown,
  workspaceSnapshot: Record<string, unknown>
): ProjectArchiveDiagnostic[] {
  const diagnostics: ProjectArchiveDiagnostic[] = [];
  if (!isRecord(options) || !isEditableBackupChatScope(options.chat) || !isEditableBackupProjectContinuityScope(options.projectContinuity)) {
    diagnostics.push({
      code: "invalid_backup_scope",
      severity: "error",
      message: "Editable backup options.chat/options.projectContinuity must use backup-supported scope values.",
      path: "options"
    });
    return diagnostics;
  }

  const ai = isRecord(workspaceSnapshot.ai) ? workspaceSnapshot.ai : undefined;
  if (!ai || !Array.isArray(ai.messages) || !Array.isArray(ai.conversationCheckpoints) || !isRecord(ai.comparisonAnalyses)) {
    diagnostics.push({
      code: "invalid_backup_scope",
      severity: "error",
      message: "workspaceSnapshot.ai must include messages, conversationCheckpoints, and comparisonAnalyses.",
      path: "workspaceSnapshot.ai"
    });
  } else {
    if (
      typeof workspaceSnapshot.schemaVersion === "number" &&
      workspaceSnapshot.schemaVersion >= 15 &&
      (!isRecord(ai.conversationCompaction) || !isRecord(ai.conversationSummaryRevisions))
    ) {
      diagnostics.push({
        code: "invalid_backup_scope",
        severity: "error",
        message: "schema 15 editable backups must include conversation compaction state and summary revisions.",
        path: "workspaceSnapshot.ai"
      });
    }
    if (
      options.chat === "none" &&
      (ai.messages.length > 0 ||
        ai.conversationCheckpoints.length > 0 ||
        Object.keys(ai.comparisonAnalyses).length > 0 ||
        (isRecord(ai.conversationSummaryRevisions) && Object.keys(ai.conversationSummaryRevisions).length > 0))
    ) {
      diagnostics.push({
        code: "backup_chat_scope_mismatch",
        severity: "error",
        message: "options.chat = none requires empty ai.messages, ai.conversationCheckpoints, and ai.comparisonAnalyses.",
        path: "workspaceSnapshot.ai"
      });
    }
  }

  const projectContinuity = isRecord(workspaceSnapshot.projectContinuity) ? workspaceSnapshot.projectContinuity : undefined;
  if (
    !projectContinuity ||
    !Array.isArray(projectContinuity.recordEntries)
  ) {
    diagnostics.push({
      code: "invalid_backup_scope",
      severity: "error",
      message: "workspaceSnapshot.projectContinuity must include a recordEntries array.",
      path: "workspaceSnapshot.projectContinuity"
    });
  } else if (options.projectContinuity === "recordEntriesNone" && projectContinuity.recordEntries.length > 0) {
    diagnostics.push({
      code: "backup_continuity_scope_mismatch",
      severity: "error",
      message: "options.projectContinuity = recordEntriesNone requires empty projectContinuity.recordEntries.",
      path: "workspaceSnapshot.projectContinuity.recordEntries"
    });
  }

  return diagnostics;
}

function collectWorkspaceAssetReferences(workspace: MorphoWorkspace): WorkspaceAssetReference[] {
  const references: WorkspaceAssetReference[] = [];
  if (workspace.project.coverAssetId) {
    references.push({
      assetId: workspace.project.coverAssetId,
      field: "project.coverAssetId",
      ownerKind: "project",
      ownerId: workspace.project.id,
      usage: "projectCover"
    });
  }

  for (const object of Object.values(workspace.objects)) {
    references.push(...collectObjectAssetReferences(object));
  }

  for (const reference of Object.values(workspace.deliveryReferences)) {
    if (reference.sourceAssetId) {
      references.push({
        assetId: reference.sourceAssetId,
        field: `deliveryReferences.${reference.id}.sourceAssetId`,
        ownerKind: "deliveryReference",
        ownerId: reference.id,
        usage: "deliverySourceAsset"
      });
    }
    if (reference.snapshot.previewAsset?.assetId) {
      references.push({
        assetId: reference.snapshot.previewAsset.assetId,
        field: `deliveryReferences.${reference.id}.snapshot.previewAsset.assetId`,
        ownerKind: "deliveryReference",
        ownerId: reference.id,
        usage: "deliverySnapshotPreview"
      });
    }
    if (reference.snapshot.sourceFile?.sourceExtractAssetId) {
      references.push({
        assetId: reference.snapshot.sourceFile.sourceExtractAssetId,
        field: `deliveryReferences.${reference.id}.snapshot.sourceFile.sourceExtractAssetId`,
        ownerKind: "deliveryReference",
        ownerId: reference.id,
        usage: "documentExtract"
      });
    }
  }

  return dedupeAssetReferences(references);
}

function collectObjectAssetReferences(object: MorphoObject): WorkspaceAssetReference[] {
  switch (object.type) {
    case "image":
      return object.assetId ? [objectAssetReference(object.id, object.assetId, "assetId", "objectAsset")] : [];
    case "file": {
      const references: WorkspaceAssetReference[] = [];
      if (object.assetId) {
        references.push(objectAssetReference(object.id, object.assetId, "assetId", "objectAsset"));
      }
      if (object.extractedAssetId) {
        references.push(objectAssetReference(object.id, object.extractedAssetId, "extractedAssetId", "documentExtract"));
      }
      return references;
    }
    case "link":
      return object.assetId ? [objectAssetReference(object.id, object.assetId, "assetId", "objectAsset")] : [];
    case "documentFragment":
      return [objectAssetReference(object.id, object.source.sourceExtractAssetId, "source.sourceExtractAssetId", "documentExtract")];
    default:
      return [];
  }
}

function objectAssetReference(
  objectId: MorphoObject["id"],
  assetId: AssetId,
  fieldName: string,
  usage: WorkspaceAssetReference["usage"]
): WorkspaceAssetReference {
  return {
    assetId,
    field: `objects.${objectId}.${fieldName}`,
    ownerKind: "object",
    ownerId: objectId,
    usage
  };
}

function dedupeAssetReferences(references: WorkspaceAssetReference[]): WorkspaceAssetReference[] {
  const seen = new Set<string>();
  const result: WorkspaceAssetReference[] = [];
  for (const reference of references) {
    const key = `${reference.field}:${reference.assetId}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(reference);
    }
  }
  return result.sort((a, b) => `${a.field}:${a.assetId}`.localeCompare(`${b.field}:${b.assetId}`));
}

function buildArchiveVisualObjects(workspace: MorphoWorkspace): ArchiveVisualObject[] {
  return objectsOfType(workspace, "image")
    .map((image) => {
      const direction = image.directionId ? workspace.objects[image.directionId] : undefined;
      const visualBranch = image.visualBranchId ? workspace.visualBranches[image.visualBranchId] : undefined;
      return {
        id: image.id,
        title: image.title,
        summary: image.summary,
        visibility: image.visibility,
        assetId: image.assetId,
        role: image.role,
        imageVariant: image.imageVariant,
        directionId: image.directionId,
        directionTitle: direction?.type === "conceptDirection" ? direction.title : undefined,
        visualBranchId: image.visualBranchId,
        visualBranchLabel: visualBranch?.label,
        isDefaultReference: image.isDefaultReference ?? false,
        relatedRelationKinds: workspace.relations
          .filter((relation) => relation.fromObjectId === image.id || relation.toObjectId === image.id)
          .map((relation) => relation.kind)
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildArchiveSourceIndex(workspace: MorphoWorkspace): ArchiveSourceIndexObject[] {
  return Object.values(workspace.objects)
    .filter(
      (object): object is ArchiveSourceIndexObject =>
        object.type === "file" || object.type === "link" || object.type === "text" || object.type === "documentFragment"
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

function toPortableAssetInventoryEntry(assetRecord: AssetRecord): PortableAssetInventoryEntry {
  return {
    sourceAssetId: assetRecord.id,
    portableBundleKey: `assets/${assetRecord.id}`,
    fileName: assetRecord.fileName,
    mimeType: assetRecord.mimeType,
    size: assetRecord.size,
    sourceType: assetRecord.sourceType,
    createdAt: assetRecord.createdAt,
    width: assetRecord.width,
    height: assetRecord.height,
    aspectRatio: assetRecord.aspectRatio,
    url: assetRecord.url,
    domain: assetRecord.domain,
    binaryStatus: "notVerified"
  };
}

function sourceProjectFromWorkspace(workspace: MorphoWorkspace): ManifestSourceProject {
  return {
    id: workspace.project.id,
    title: workspace.project.title,
    subtitle: workspace.project.subtitle,
    createdAt: workspace.project.createdAt,
    updatedAt: workspace.project.updatedAt,
    lastOpenedAt: workspace.project.lastOpenedAt
  };
}

function buildArchiveContinuity(workspace: MorphoWorkspace, scope: ArchiveProjectContinuityScope): ArchiveContinuitySection {
  if (scope === "none") {
    return { mode: "none" };
  }
  return {
    mode: "current",
    currentFocus: workspace.projectContinuity.currentFocus,
    recordEntries: workspace.projectContinuity.recordEntries.filter((entry) => entry.validity === "current"),
    updatedAt: workspace.projectContinuity.updatedAt
  };
}

function buildArchiveConversation(workspace: MorphoWorkspace, scope: ArchiveChatScope): ArchiveConversationSection {
  if (scope === "none") {
    return { mode: "none" };
  }
  if (scope === "decisionSummary") {
    const continuityEntryIds = new Set(workspace.projectContinuity.recordEntries.map((entry) => entry.id));
    return {
      mode: "decisionSummary",
      messages: workspace.ai.messages.filter((message) =>
        message.continuityEntryIds?.some((entryId) => continuityEntryIds.has(entryId))
      )
    };
  }
  return {
    mode: "full",
    messages: workspace.ai.messages,
    conversationCheckpoints: workspace.ai.conversationCheckpoints,
    conversationCompaction: workspace.ai.conversationCompaction,
    conversationSummaryRevisions: workspace.ai.conversationSummaryRevisions,
    comparisonAnalyses: workspace.ai.comparisonAnalyses ?? {}
  };
}

function omitRuntimeStorageKey(assetRecord: AssetRecord): PortableAssetMetadata {
  const { storageKey: _storageKey, ...portable } = assetRecord;
  return portable;
}

function objectsOfType<TType extends MorphoObject["type"]>(
  workspace: MorphoWorkspace,
  type: TType
): Array<Extract<MorphoObject, { type: TType }>> {
  return Object.values(workspace.objects)
    .filter((object): object is Extract<MorphoObject, { type: TType }> => object.type === type)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function failed<TManifest>(reason: string, diagnostics: ProjectArchiveDiagnostic[]): ManifestValidationResult<TManifest> {
  return { status: "failed", reason, diagnostics };
}

function isHumanReadableArchiveManifest(value: unknown): value is HumanReadableArchiveManifest {
  if (!isRecord(value) || value.format !== HUMAN_READABLE_ARCHIVE_FORMAT || !isRecord(value.archive)) {
    return false;
  }
  const delivery = isRecord(value.archive.delivery) ? value.archive.delivery : undefined;
  if (!delivery) {
    return false;
  }
  return (
    Array.isArray(value.archive.visualObjects) &&
    isRecord(value.archive.researchAndSources) &&
    Array.isArray(delivery.packages)
  );
}

function isEditableProjectBackupManifest(value: unknown): value is EditableProjectBackupManifest {
  return (
    isRecord(value) &&
    value.format === EDITABLE_PROJECT_BACKUP_FORMAT &&
    isRecord(value.workspaceSnapshot) &&
    isRecord(value.workspaceSnapshot.assets)
  );
}

function isSourceProject(value: unknown): value is ManifestSourceProject {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && typeof value.subtitle === "string";
}

function isPortableAssetInventoryEntry(value: unknown): value is PortableAssetInventoryEntry {
  return (
    isRecord(value) &&
    typeof value.sourceAssetId === "string" &&
    typeof value.portableBundleKey === "string" &&
    typeof value.fileName === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.size === "number" &&
    typeof value.sourceType === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.binaryStatus === "string"
  );
}

function isWorkspaceAssetReference(value: unknown): value is WorkspaceAssetReference {
  return (
    isRecord(value) &&
    typeof value.assetId === "string" &&
    typeof value.field === "string" &&
    (value.ownerKind === "project" || value.ownerKind === "object" || value.ownerKind === "deliveryReference") &&
    typeof value.ownerId === "string" &&
    (value.usage === "projectCover" ||
      value.usage === "objectAsset" ||
      value.usage === "documentExtract" ||
      value.usage === "deliverySourceAsset" ||
      value.usage === "deliverySnapshotPreview")
  );
}

function isPortableAssetMetadataRecord(value: unknown): value is PortableAssetMetadata {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.fileName === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.size === "number" &&
    typeof value.sourceType === "string" &&
    typeof value.createdAt === "string"
  );
}

function isAssetBinaryStatus(value: unknown): value is AssetBinaryStatus {
  return value === "notVerified" || value === "metadataOnly" || value === "missingMetadata";
}

function isEditableBackupChatScope(value: unknown): value is EditableBackupChatScope {
  return value === "none" || value === "full";
}

function isEditableBackupProjectContinuityScope(value: unknown): value is EditableBackupProjectContinuityScope {
  return value === "current" || value === "recordEntriesNone";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyForMessage(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function dedupeDiagnostics(diagnostics: ProjectArchiveDiagnostic[]): ProjectArchiveDiagnostic[] {
  const seen = new Set<string>();
  const deduped: ProjectArchiveDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.path ?? ""}:${diagnostic.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(diagnostic);
    }
  }
  return deduped;
}
