import type {
  AiMessage,
  AssetId,
  AssetRecord,
  CanvasInstance,
  CanvasView,
  ComparisonAnalysis,
  ConceptDirectionObject,
  DecisionRecord,
  DeliveryReference,
  DeliverySectionDraft,
  DesignDefinitionObject,
  DirectionLineageRecord,
  MorphoObject,
  MorphoObjectId,
  MorphoWorkspace,
  ProjectContinuityState,
  ProjectWorkingState,
  VisualBranchRecord
} from "./types";

export const HUMAN_READABLE_ARCHIVE_FORMAT = "morpho-human-readable-archive";
export const EDITABLE_PROJECT_BACKUP_FORMAT = "morpho-editable-project-backup";
export const PROJECT_ARCHIVE_MANIFEST_VERSION = "1";

export type ProjectArchiveDiagnosticSeverity = "info" | "warning" | "error";

export type ProjectArchiveDiagnostic = {
  code:
    | "asset_metadata_orphaned"
    | "binary_not_verified"
    | "duplicate_portable_bundle_key"
    | "invalid_asset_inventory_entry"
    | "invalid_format"
    | "invalid_manifest_version"
    | "invalid_source_project"
    | "invalid_workspace_snapshot"
    | "missing_asset_metadata"
    | "referenced_asset_missing_inventory_entry";
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
export type ProjectContinuityScope = "none" | "current";

export type ProjectArchiveOptions = {
  createdAt?: string;
  chat?: ArchiveChatScope;
  projectContinuity?: ProjectContinuityScope;
};

export type EditableBackupOptions = {
  createdAt?: string;
  chat?: ArchiveChatScope;
  projectContinuity?: ProjectContinuityScope;
};

export type ProjectManifestIntegrity = {
  diagnostics: ProjectArchiveDiagnostic[];
};

export type HumanReadableArchiveManifest = {
  format: typeof HUMAN_READABLE_ARCHIVE_FORMAT;
  manifestVersion: typeof PROJECT_ARCHIVE_MANIFEST_VERSION;
  createdAt: string;
  sourceProject: ManifestSourceProject;
  workspaceSchemaVersion: MorphoWorkspace["schemaVersion"];
  options: {
    chat: ArchiveChatScope;
    projectContinuity: ProjectContinuityScope;
  };
  assetInventory: WorkspaceAssetInventory;
  integrity: ProjectManifestIntegrity;
  archive: {
    projectOverview: ManifestSourceProject;
    designDefinitions: DesignDefinitionObject[];
    keyConclusions: MorphoObject[];
    directions: ConceptDirectionObject[];
    visualObjects: Array<Pick<MorphoObject, "id" | "type" | "title" | "summary" | "visibility">>;
    decisions: DecisionRecord[];
    projectContinuity: ArchiveContinuitySection;
    conversation: ArchiveConversationSection;
    delivery: {
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
    chat: ArchiveChatScope;
    projectContinuity: ProjectContinuityScope;
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
      comparisonAnalyses: Record<string, ComparisonAnalysis>;
    };

export function createHumanReadableArchiveManifest(
  workspace: MorphoWorkspace,
  options: ProjectArchiveOptions = {}
): ManifestCreationResult<HumanReadableArchiveManifest> {
  const assetInventory = collectWorkspaceAssetInventory(workspace);
  const diagnostics = assetInventory.diagnostics;
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
      visualObjects: Object.values(workspace.objects)
        .filter((object) => object.type === "image" || object.type === "file" || object.type === "documentFragment")
        .map(({ id, type, title, summary, visibility }) => ({ id, type, title, summary, visibility })),
      decisions: workspace.decisionRecords,
      projectContinuity: buildArchiveContinuity(workspace, options.projectContinuity ?? "none"),
      conversation: buildArchiveConversation(workspace, options.chat ?? "none"),
      delivery: {
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
  const diagnostics = assetInventory.diagnostics;
  const manifest: EditableProjectBackupManifest = {
    format: EDITABLE_PROJECT_BACKUP_FORMAT,
    manifestVersion: PROJECT_ARCHIVE_MANIFEST_VERSION,
    createdAt: options.createdAt ?? new Date().toISOString(),
    sourceProject: sourceProjectFromWorkspace(workspace),
    workspaceSchemaVersion: workspace.schemaVersion,
    options: {
      chat: options.chat ?? "none",
      projectContinuity: options.projectContinuity ?? "current",
      restoreContract: {
        restoresAsNewProjectCopy: true,
        mustRemapProjectId: true,
        mustRegenerateRuntimeStorageKeys: true,
        mustRemapAssetIdsIfChanged: true,
        neverMergeByDefault: true
      }
    },
    assetInventory,
    integrity: { diagnostics },
    workspaceSnapshot: sanitizeWorkspaceForEditableBackup(workspace)
  };

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

  return { entries, references, diagnostics };
}

export function collectWorkspaceAssetReferenceDiagnostics(workspace: MorphoWorkspace): ProjectArchiveDiagnostic[] {
  return collectWorkspaceAssetInventory(workspace).diagnostics;
}

export function sanitizeWorkspaceForEditableBackup(workspace: MorphoWorkspace): EditableBackupWorkspaceSnapshot {
  const assets = Object.fromEntries(
    Object.entries(workspace.assets).map(([assetId, assetRecord]) => [assetId, omitRuntimeStorageKey(assetRecord)])
  );

  return {
    ...workspace,
    assets,
    ui: {
      activeDrawer: null,
      aiOpen: true,
      lastSelectionIds: [],
      canvasView: workspace.canvas.view,
      workIntent: workspace.ui.workIntent
    }
  };
}

export function validateHumanReadableArchiveManifest(
  value: unknown
): ManifestValidationResult<HumanReadableArchiveManifest> {
  return validateManifest(value, HUMAN_READABLE_ARCHIVE_FORMAT, isHumanReadableArchiveManifest);
}

export function validateEditableProjectBackupManifest(value: unknown): ManifestValidationResult<EditableProjectBackupManifest> {
  return validateManifest(value, EDITABLE_PROJECT_BACKUP_FORMAT, isEditableProjectBackupManifest);
}

function validateManifest<TManifest>(
  value: unknown,
  expectedFormat: typeof HUMAN_READABLE_ARCHIVE_FORMAT | typeof EDITABLE_PROJECT_BACKUP_FORMAT,
  typeGuard: (value: unknown) => value is TManifest
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

  diagnostics.push(...validateAssetInventoryShape(value.assetInventory));

  if (expectedFormat === EDITABLE_PROJECT_BACKUP_FORMAT) {
    diagnostics.push(...validateBackupSnapshot(value.workspaceSnapshot, value.assetInventory));
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error") || !typeGuard(value)) {
    return failed("Manifest failed structural validation.", diagnostics);
  }

  return { status: "ok", manifest: value, diagnostics };
}

function validateAssetInventoryShape(value: unknown): ProjectArchiveDiagnostic[] {
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
  for (const [index, entry] of value.entries.entries()) {
    if (!isRecord(entry) || typeof entry.sourceAssetId !== "string" || typeof entry.portableBundleKey !== "string") {
      diagnostics.push({
        code: "invalid_asset_inventory_entry",
        severity: "error",
        message: "Each asset inventory entry must include sourceAssetId and portableBundleKey.",
        path: `assetInventory.entries.${index}`
      });
      continue;
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
  }

  return diagnostics;
}

function validateBackupSnapshot(workspaceSnapshot: unknown, assetInventory: unknown): ProjectArchiveDiagnostic[] {
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

  if (!isRecord(assetInventory) || !Array.isArray(assetInventory.entries) || !Array.isArray(assetInventory.references)) {
    return diagnostics;
  }

  const inventoryAssetIds = new Set(
    assetInventory.entries
      .filter(isRecord)
      .map((entry) => entry.sourceAssetId)
      .filter((sourceAssetId): sourceAssetId is string => typeof sourceAssetId === "string")
  );
  for (const [index, reference] of assetInventory.references.entries()) {
    if (!isRecord(reference) || typeof reference.assetId !== "string") {
      continue;
    }
    if (!inventoryAssetIds.has(reference.assetId)) {
      diagnostics.push({
        code: "referenced_asset_missing_inventory_entry",
        severity: "error",
        message: `Asset reference ${reference.assetId} has no asset inventory entry.`,
        path: `assetInventory.references.${index}.assetId`
      });
    }
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

  return dedupeReferences(references);
}

function collectObjectAssetReferences(object: MorphoObject): WorkspaceAssetReference[] {
  switch (object.type) {
    case "image":
      return object.assetId ? [objectAssetReference(object.id, object.assetId, "objects", "assetId", "objectAsset")] : [];
    case "file": {
      const references: WorkspaceAssetReference[] = [];
      if (object.assetId) {
        references.push(objectAssetReference(object.id, object.assetId, "objects", "assetId", "objectAsset"));
      }
      if (object.extractedAssetId) {
        references.push(objectAssetReference(object.id, object.extractedAssetId, "objects", "extractedAssetId", "documentExtract"));
      }
      return references;
    }
    case "link":
      return object.assetId ? [objectAssetReference(object.id, object.assetId, "objects", "assetId", "objectAsset")] : [];
    case "documentFragment":
      return [
        objectAssetReference(
          object.id,
          object.source.sourceExtractAssetId,
          "objects",
          "source.sourceExtractAssetId",
          "documentExtract"
        )
      ];
    default:
      return [];
  }
}

function objectAssetReference(
  objectId: MorphoObjectId,
  assetId: AssetId,
  root: string,
  fieldName: string,
  usage: WorkspaceAssetReference["usage"]
): WorkspaceAssetReference {
  return {
    assetId,
    field: `${root}.${objectId}.${fieldName}`,
    ownerKind: "object",
    ownerId: objectId,
    usage
  };
}

function dedupeReferences(references: WorkspaceAssetReference[]): WorkspaceAssetReference[] {
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

function buildArchiveContinuity(workspace: MorphoWorkspace, scope: ProjectContinuityScope): ArchiveContinuitySection {
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
  return Object.values(workspace.objects).filter((object): object is Extract<MorphoObject, { type: TType }> => object.type === type);
}

function failed<TManifest>(reason: string, diagnostics: ProjectArchiveDiagnostic[]): ManifestValidationResult<TManifest> {
  return { status: "failed", reason, diagnostics };
}

function isHumanReadableArchiveManifest(value: unknown): value is HumanReadableArchiveManifest {
  return isRecord(value) && value.format === HUMAN_READABLE_ARCHIVE_FORMAT && isRecord(value.archive);
}

function isEditableProjectBackupManifest(value: unknown): value is EditableProjectBackupManifest {
  return isRecord(value) && value.format === EDITABLE_PROJECT_BACKUP_FORMAT && isRecord(value.workspaceSnapshot);
}

function isSourceProject(value: unknown): value is ManifestSourceProject {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.subtitle === "string"
  );
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
