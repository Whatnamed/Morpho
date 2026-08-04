import {
  EDITABLE_PROJECT_BACKUP_FORMAT,
  HUMAN_READABLE_ARCHIVE_FORMAT,
  validateEditableProjectBackupManifest,
  validateHumanReadableArchiveManifest,
  type EditableProjectBackupManifest,
  type HumanReadableArchiveManifest,
  type ProjectArchiveDiagnostic,
  type ProjectArchiveDiagnosticSeverity
} from "./projectArchive";
import type { AssetId, AssetRecord, KeyConclusionCategory, MorphoWorkspace } from "./types";
import { migrateWorkspaceToCurrentSchema } from "./workspace";

export const PROJECT_BUNDLE_FORMAT = "morpho-project-bundle";
export const PROJECT_BUNDLE_VERSION = "1";

export type ProjectBundlePackageKind = "humanArchive" | "editableBackup";
export type ProjectBundleFileKind = "manifest" | "markdown" | "asset" | "metadata";
export type ProjectBundleAssetAvailability = "embedded" | "referenceOnly" | "missingRequiredBinary" | "sizeMismatch";

export type ProjectBundleResolvedAsset = {
  sourceAssetId: AssetId;
  portableBundleKey: string;
  fileName: string;
  mimeType: string;
  sourceType: AssetRecord["sourceType"];
  expectedByteLength: number;
  actualByteLength?: number;
  availability: ProjectBundleAssetAvailability;
  required: boolean;
  bytes?: Uint8Array;
};

type BundleOnlyDiagnostic = {
  code:
    | "asset_binary_missing"
    | "asset_binary_size_mismatch"
    | "bundle_file_missing"
    | "bundle_file_unexpected"
    | "bundle_manifest_missing"
    | "invalid_bundle_format"
    | "invalid_bundle_package_kind"
    | "invalid_bundle_version"
    | "restore_project_id_collision"
    | "unreadable_backup_bundle";
  severity: ProjectArchiveDiagnosticSeverity;
  message: string;
  path?: string;
};

export type ProjectBundleDiagnostic = ProjectArchiveDiagnostic | BundleOnlyDiagnostic;

export type ProjectBundleFileDescriptor = {
  path: string;
  kind: ProjectBundleFileKind;
  required: boolean;
  assetId?: AssetId;
  byteLength?: number;
};

export type ProjectBundleEnvelope = {
  format: typeof PROJECT_BUNDLE_FORMAT;
  bundleVersion: typeof PROJECT_BUNDLE_VERSION;
  packageKind: ProjectBundlePackageKind;
  createdAt: string;
  manifestPath: string;
  files: ProjectBundleFileDescriptor[];
  diagnostics: ProjectBundleDiagnostic[];
};

export type ProjectBundleFile = ProjectBundleFileDescriptor & {
  bytes: Uint8Array;
};

export type BuiltProjectBundle = {
  fileName: string;
  envelope: ProjectBundleEnvelope;
  files: ProjectBundleFile[];
  diagnostics: ProjectBundleDiagnostic[];
};

export type BundleCreationResult =
  | {
      status: "ok";
      bundle: BuiltProjectBundle;
      diagnostics: ProjectBundleDiagnostic[];
    }
  | {
      status: "blocked";
      reason: string;
      diagnostics: ProjectBundleDiagnostic[];
    };

export type BundleValidationInput = {
  bundle: unknown;
  manifest: unknown;
  files: Record<string, Uint8Array>;
};

export type BundleValidationResult<TManifest> =
  | {
      status: "ok";
      bundle: ProjectBundleEnvelope;
      manifest: TManifest;
      files: Record<string, Uint8Array>;
      diagnostics: ProjectBundleDiagnostic[];
    }
  | {
      status: "failed";
      reason: string;
      diagnostics: ProjectBundleDiagnostic[];
    };

export type EditableProjectBackupRestorePlan = {
  workspace: MorphoWorkspace;
  assetWrites: Array<{
    assetId: AssetId;
    storageKey: string;
    bytes: Uint8Array;
    mimeType: string;
  }>;
};

export type EditableProjectBackupRestorePlanResult =
  | ({ status: "ok" } & EditableProjectBackupRestorePlan)
  | {
      status: "failed";
      reason: string;
      diagnostics: ProjectBundleDiagnostic[];
    };

type BackupRestorePlanOptions = {
  restoredAt: string;
  projectId: string;
  projectTitle: string;
  createRuntimeStorageKey: (assetId: AssetId) => string;
};

const ARCHIVE_MANIFEST_PATH = "archive-manifest.json";
const BACKUP_MANIFEST_PATH = "backup-manifest.json";
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

export function createHumanReadableArchiveBundle(
  manifest: HumanReadableArchiveManifest,
  resolvedAssets: ProjectBundleResolvedAsset[]
): BuiltProjectBundle {
  const diagnostics = dedupeBundleDiagnostics([
    ...manifest.integrity.diagnostics,
    ...diagnosticsFromResolvedAssets(resolvedAssets, "archive")
  ]);

  const assetFiles = assetOutputFiles(resolvedAssets, "archive");
  const markdownFiles = archiveMarkdownFiles(manifest, resolvedAssets, diagnostics);
  const contentFiles = [
    outputFile(ARCHIVE_MANIFEST_PATH, "manifest", true, utf8(JSON.stringify(manifest, null, 2))),
    ...markdownFiles,
    ...assetFiles
  ];

  const envelope = createEnvelope("humanArchive", manifest.createdAt, ARCHIVE_MANIFEST_PATH, diagnostics, contentFiles);
  const files = [outputFile("bundle.json", "metadata", true, utf8(JSON.stringify(envelope, null, 2))), ...contentFiles];

  return {
    fileName: `morpho-archive-${safeSlug(manifest.sourceProject.title)}-${dateStamp(manifest.createdAt)}.zip`,
    envelope,
    files,
    diagnostics
  };
}

export function createEditableProjectBackupBundle(
  manifest: EditableProjectBackupManifest,
  resolvedAssets: ProjectBundleResolvedAsset[]
): BundleCreationResult {
  const diagnostics = dedupeBundleDiagnostics([
    ...manifest.integrity.diagnostics,
    ...diagnosticsFromResolvedAssets(resolvedAssets, "backup")
  ]);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      status: "blocked",
      reason: "Editable backup bundle has blocking binary integrity issues.",
      diagnostics
    };
  }

  const contentFiles = [
    outputFile(BACKUP_MANIFEST_PATH, "manifest", true, utf8(JSON.stringify(manifest, null, 2))),
    ...assetOutputFiles(resolvedAssets, "backup")
  ];
  const envelope = createEnvelope("editableBackup", manifest.createdAt, BACKUP_MANIFEST_PATH, diagnostics, contentFiles);
  const files = [outputFile("bundle.json", "metadata", true, utf8(JSON.stringify(envelope, null, 2))), ...contentFiles];
  const bundle: BuiltProjectBundle = {
    fileName: `morpho-backup-${safeSlug(manifest.sourceProject.title)}-${dateStamp(manifest.createdAt)}.zip`,
    envelope,
    files,
    diagnostics
  };

  return { status: "ok", bundle, diagnostics };
}

export function validateHumanReadableArchiveBundle(
  input: BundleValidationInput
): BundleValidationResult<HumanReadableArchiveManifest> {
  return validateBundle(input, "humanArchive", validateHumanReadableArchiveManifest);
}

export function validateEditableProjectBackupBundle(
  input: BundleValidationInput
): BundleValidationResult<EditableProjectBackupManifest> {
  return validateBundle(input, "editableBackup", validateEditableProjectBackupManifest);
}

export function planEditableProjectBackupRestore(
  manifest: EditableProjectBackupManifest,
  files: Record<string, Uint8Array>,
  options: BackupRestorePlanOptions
): EditableProjectBackupRestorePlanResult {
  const diagnostics = validateRequiredAssetFiles(manifest.assetInventory.entries, files, "backup");
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      status: "failed",
      reason: "Editable backup restore plan failed bundle validation.",
      diagnostics: dedupeBundleDiagnostics(diagnostics)
    };
  }

  const restoredAssets: Record<AssetId, AssetRecord> = {};
  const assetWrites: EditableProjectBackupRestorePlan["assetWrites"] = [];
  for (const [assetId, portableAsset] of Object.entries(manifest.workspaceSnapshot.assets)) {
    const inventoryEntry = manifest.assetInventory.entries.find((entry) => entry.sourceAssetId === assetId);
    if (!inventoryEntry) {
      continue;
    }

    const storageKey = options.createRuntimeStorageKey(assetId);
    restoredAssets[assetId] = {
      ...portableAsset,
      storageKey
    };

    if (expectsBundledBinary(inventoryEntry.sourceType)) {
      const bytes = files[inventoryEntry.portableBundleKey];
      if (!bytes) {
        return {
          status: "failed",
          reason: `Missing bundle bytes for ${assetId}.`,
          diagnostics: [
            {
              code: "asset_binary_missing",
              severity: "error",
              message: `Backup restore requires bundled bytes for ${assetId}.`,
              path: inventoryEntry.portableBundleKey
            }
          ]
        };
      }
      assetWrites.push({
        assetId,
        storageKey,
        bytes,
        mimeType: portableAsset.mimeType
      });
    }
  }

  const migrated = migrateWorkspaceToCurrentSchema({
    ...manifest.workspaceSnapshot,
    assets: restoredAssets
  });
  if (migrated.status !== "ok") {
    return {
      status: "failed",
      reason: migrated.reason,
      diagnostics: [{
        code: "invalid_workspace_snapshot",
        severity: "error",
        message: migrated.reason,
        path: "workspaceSnapshot"
      }]
    };
  }

  const workspace: MorphoWorkspace = {
    ...migrated.workspace,
    project: {
      ...migrated.workspace.project,
      id: options.projectId,
      title: options.projectTitle,
      createdAt: options.restoredAt,
      updatedAt: options.restoredAt,
      lastOpenedAt: options.restoredAt
    }
  };

  return {
    status: "ok",
    workspace,
    assetWrites
  };
}

function validateBundle<
  TManifest extends {
    assetInventory: {
      entries: Array<{
        sourceAssetId: AssetId;
        portableBundleKey: string;
        size: number;
        sourceType: AssetRecord["sourceType"];
      }>;
    };
  }
>(
  input: BundleValidationInput,
  expectedKind: ProjectBundlePackageKind,
  manifestValidator: (value: unknown) => {
    status: "ok";
    manifest: TManifest;
    diagnostics: ProjectArchiveDiagnostic[];
  } | {
    status: "failed";
    reason: string;
    diagnostics: ProjectArchiveDiagnostic[];
  }
): BundleValidationResult<TManifest> {
  const diagnostics: ProjectBundleDiagnostic[] = [];
  if (!isBundleEnvelope(input.bundle)) {
    return failedBundle("Bundle envelope must be a JSON object.", diagnostics);
  }

  diagnostics.push(...validateEnvelopeShape(input.bundle, input.files, expectedKind));
  const manifestValidation = manifestValidator(input.manifest);
  diagnostics.push(...manifestValidation.diagnostics);

  if (manifestValidation.status === "ok") {
    diagnostics.push(
      ...validateRequiredAssetFiles(
        manifestValidation.manifest.assetInventory.entries,
        input.files,
        expectedKind === "humanArchive" ? "archive" : "backup"
      )
    );
  }

  const deduped = dedupeBundleDiagnostics([...input.bundle.diagnostics, ...diagnostics]);
  if (deduped.some((diagnostic) => diagnostic.severity === "error") || manifestValidation.status === "failed") {
    return failedBundle("Bundle failed structural validation.", deduped);
  }

  if (manifestValidation.status !== "ok") {
    return failedBundle("Manifest failed structural validation.", deduped);
  }

  return {
    status: "ok",
    bundle: input.bundle,
    manifest: manifestValidation.manifest,
    files: input.files,
    diagnostics: deduped
  };
}

function validateEnvelopeShape(
  bundle: ProjectBundleEnvelope,
  files: Record<string, Uint8Array>,
  expectedKind: ProjectBundlePackageKind
): ProjectBundleDiagnostic[] {
  const diagnostics: ProjectBundleDiagnostic[] = [];
  if (bundle.format !== PROJECT_BUNDLE_FORMAT) {
    diagnostics.push({
      code: "invalid_bundle_format",
      severity: "error",
      message: `Expected bundle format ${PROJECT_BUNDLE_FORMAT}.`,
      path: "bundle.format"
    });
  }
  if (bundle.bundleVersion !== PROJECT_BUNDLE_VERSION) {
    diagnostics.push({
      code: "invalid_bundle_version",
      severity: "error",
      message: `Unsupported bundleVersion ${stringify(bundle.bundleVersion)}.`,
      path: "bundle.bundleVersion"
    });
  }
  if (bundle.packageKind !== expectedKind) {
    diagnostics.push({
      code: "invalid_bundle_package_kind",
      severity: "error",
      message: `Expected packageKind ${expectedKind}.`,
      path: "bundle.packageKind"
    });
  }
  if (!files[bundle.manifestPath]) {
    diagnostics.push({
      code: "bundle_manifest_missing",
      severity: "error",
      message: `Bundle is missing manifest file ${bundle.manifestPath}.`,
      path: bundle.manifestPath
    });
  }

  const declared = new Map(bundle.files.map((file) => [file.path, file]));
  for (const file of bundle.files) {
    const actual = files[file.path];
    if (!actual) {
      diagnostics.push({
        code: "bundle_file_missing",
        severity: "error",
        message: `Bundle file ${file.path} is declared but missing.`,
        path: file.path
      });
      continue;
    }
    if (typeof file.byteLength === "number" && actual.byteLength !== file.byteLength) {
      diagnostics.push({
        code: "asset_binary_size_mismatch",
        severity: file.kind === "asset" && expectedKind === "humanArchive" ? "warning" : "error",
        message: `Bundle file ${file.path} has ${actual.byteLength} bytes, expected ${file.byteLength}.`,
        path: file.path
      });
    }
  }

  for (const path of Object.keys(files)) {
    if (!declared.has(path)) {
      diagnostics.push({
        code: "bundle_file_unexpected",
        severity: "error",
        message: `Bundle contains unexpected file ${path}.`,
        path
      });
    }
  }

  return diagnostics;
}

function validateRequiredAssetFiles(
  entries: Array<{
    sourceAssetId: AssetId;
    portableBundleKey: string;
    size: number;
    sourceType: AssetRecord["sourceType"];
  }>,
  files: Record<string, Uint8Array>,
  mode: "archive" | "backup"
): ProjectBundleDiagnostic[] {
  const diagnostics: ProjectBundleDiagnostic[] = [];
  for (const entry of entries) {
    if (!expectsBundledBinary(entry.sourceType)) {
      continue;
    }
    const bytes = files[entry.portableBundleKey];
    if (!bytes) {
      diagnostics.push({
        code: "asset_binary_missing",
        severity: mode === "backup" ? "error" : "warning",
        message: `Bundle is missing bytes for required asset ${entry.sourceAssetId}.`,
        path: entry.portableBundleKey
      });
      continue;
    }
    if (bytes.byteLength !== entry.size) {
      diagnostics.push({
        code: "asset_binary_size_mismatch",
        severity: mode === "backup" ? "error" : "warning",
        message: `Asset ${entry.sourceAssetId} has ${bytes.byteLength} bytes in the bundle, expected ${entry.size}.`,
        path: entry.portableBundleKey
      });
    }
  }
  return diagnostics;
}

function diagnosticsFromResolvedAssets(
  resolvedAssets: ProjectBundleResolvedAsset[],
  mode: "archive" | "backup"
): ProjectBundleDiagnostic[] {
  const diagnostics: ProjectBundleDiagnostic[] = [];
  for (const asset of resolvedAssets) {
    if (asset.availability === "missingRequiredBinary") {
      diagnostics.push({
        code: "asset_binary_missing",
        severity: mode === "backup" && asset.required ? "error" : "warning",
        message: `Local binary for ${asset.sourceAssetId} is missing and cannot be bundled.`,
        path: asset.portableBundleKey
      });
    }
    if (asset.availability === "sizeMismatch") {
      diagnostics.push({
        code: "asset_binary_size_mismatch",
        severity: mode === "backup" && asset.required ? "error" : "warning",
        message: `Local binary for ${asset.sourceAssetId} has ${asset.actualByteLength ?? 0} bytes, expected ${asset.expectedByteLength}.`,
        path: asset.portableBundleKey
      });
    }
  }
  return diagnostics;
}

function assetOutputFiles(
  resolvedAssets: ProjectBundleResolvedAsset[],
  mode: "archive" | "backup"
): ProjectBundleFile[] {
  return resolvedAssets.flatMap((asset) => {
    if (!asset.bytes) {
      return [];
    }
    if (asset.availability === "referenceOnly" || asset.availability === "missingRequiredBinary") {
      return [];
    }
    if (asset.availability === "sizeMismatch" && mode === "backup" && asset.required) {
      return [];
    }
    return [outputFile(asset.portableBundleKey, "asset", false, asset.bytes, asset.sourceAssetId)];
  });
}

function archiveMarkdownFiles(
  manifest: HumanReadableArchiveManifest,
  resolvedAssets: ProjectBundleResolvedAsset[],
  diagnostics: ProjectBundleDiagnostic[]
): ProjectBundleFile[] {
  const files = [
    outputFile("README.md", "markdown", true, utf8(buildArchiveReadme(manifest, diagnostics))),
    outputFile("project-overview.md", "markdown", true, utf8(buildRichArchiveProjectOverview(manifest))),
    outputFile("research-and-sources.md", "markdown", true, utf8(buildRichArchiveResearchAndSources(manifest))),
    outputFile("directions-and-visuals.md", "markdown", true, utf8(buildRichArchiveDirectionsAndVisuals(manifest, resolvedAssets))),
    outputFile("decisions-and-process.md", "markdown", true, utf8(buildRichArchiveDecisionsAndProcess(manifest))),
    outputFile("delivery-preparation.md", "markdown", true, utf8(buildRichArchiveDeliveryPreparation(manifest))),
    outputFile("asset-index.md", "markdown", true, utf8(buildRichArchiveAssetIndex(manifest, resolvedAssets)))
  ];

  if (manifest.archive.conversation.mode === "full") {
    files.push(outputFile("conversation.md", "markdown", true, utf8(buildArchiveConversation(manifest))));
  }

  return files;
}

function buildArchiveReadme(manifest: HumanReadableArchiveManifest, diagnostics: ProjectBundleDiagnostic[]): string {
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const errorLike = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const list = [
    "# Morpho 项目归档",
    "",
    `- 项目：${manifest.sourceProject.title}`,
    `- 副标题：${manifest.sourceProject.subtitle}`,
    `- 导出时间：${manifest.createdAt}`,
    `- 聊天范围：${manifest.options.chat}`,
    `- 连续性范围：${manifest.options.projectContinuity}`,
    "",
    "## 内容",
    "",
    "- `project-overview.md` 项目概览",
    "- `research-and-sources.md` 研究与来源",
    "- `directions-and-visuals.md` 方向与视觉路线",
    "- `decisions-and-process.md` 决策与过程",
    "- `delivery-preparation.md` 交付准备",
    "- `asset-index.md` 资产索引",
    "",
    "## 完整性",
    "",
    `- Warning：${warningCount}`,
    `- Error：${errorLike}`,
    "",
    "该文件包用于阅读、交接和复盘，不能用于恢复可编辑项目。"
  ];
  return list.join("\n");
}

function buildArchiveProjectOverview(manifest: HumanReadableArchiveManifest): string {
  const currentFocus =
    manifest.archive.projectContinuity.mode === "current" ? manifest.archive.projectContinuity.currentFocus.note : "未附带连续性记录";
  return [
    "# 项目概览",
    "",
    `- 项目：${manifest.sourceProject.title}`,
    `- 副标题：${manifest.sourceProject.subtitle}`,
    `- 设计定义数量：${manifest.archive.designDefinitions.length}`,
    `- 关键结论数量：${manifest.archive.keyConclusions.length}`,
    `- 方向数量：${manifest.archive.directions.length}`,
    `- 当前默认参考数量：${manifest.archive.visualObjects.filter((item) => item.isDefaultReference).length}`,
    "",
    "## 当前重点",
    "",
    currentFocus
  ].join("\n");
}

function buildArchiveResearchAndSources(manifest: HumanReadableArchiveManifest): string {
  const researchLines =
    manifest.archive.researchAndSources.researchObjects.length > 0
      ? manifest.archive.researchAndSources.researchObjects.map((item) => `- ${item.title}: ${item.summary}`)
      : ["- 暂无结构化研究对象"];
  const sourceLines =
    manifest.archive.researchAndSources.sourceIndex.length > 0
      ? manifest.archive.researchAndSources.sourceIndex.map((item) => `- ${item.title}`)
      : ["- 暂无可读来源索引"];
  const citationLines =
    Object.values(manifest.archive.researchAndSources.citationSnapshots).length > 0
      ? Object.values(manifest.archive.researchAndSources.citationSnapshots).map((item) => `- ${item.title}`)
      : ["- 暂无 citation snapshot"];
  return ["# 研究与来源", "", "## Research objects", "", ...researchLines, "", "## Source index", "", ...sourceLines, "", "## Citation snapshots", "", ...citationLines].join("\n");
}

function buildArchiveDirectionsAndVisuals(
  manifest: HumanReadableArchiveManifest,
  resolvedAssets: ProjectBundleResolvedAsset[]
): string {
  const assetState = new Map(resolvedAssets.map((item) => [item.sourceAssetId, item]));
  const directionLines =
    manifest.archive.directions.length > 0
      ? manifest.archive.directions.map((item) => `- ${item.title}: ${item.status}`)
      : ["- 暂无概念方向"];
  const visualLines =
    manifest.archive.visualObjects.length > 0
      ? manifest.archive.visualObjects.map((item) => {
          const asset = item.assetId ? assetState.get(item.assetId) : undefined;
          const assetLabel = asset ? `${asset.portableBundleKey} · ${asset.availability}` : "无关联资产";
          return `- ${item.title}: ${item.role} / ${item.imageVariant} / ${item.visibility} / ${assetLabel}`;
        })
      : ["- 暂无视觉对象"];
  return ["# 方向与视觉路线", "", "## 方向", "", ...directionLines, "", "## 视觉对象", "", ...visualLines].join("\n");
}

function buildArchiveDecisionsAndProcess(manifest: HumanReadableArchiveManifest): string {
  const decisionLines =
    manifest.archive.decisions.length > 0
      ? manifest.archive.decisions.map((item) => `- ${item.summary}`)
      : ["- 暂无 DecisionRecord"];
  const traceLines = manifest.archive.traceability.directionLineage.length > 0
    ? manifest.archive.traceability.directionLineage.map((item) => `- ${item.kind}: ${item.note}`)
    : ["- 暂无方向谱系记录"];
  return ["# 决策与过程", "", "## 决策", "", ...decisionLines, "", "## Traceability", "", ...traceLines].join("\n");
}

function buildArchiveConversation(manifest: HumanReadableArchiveManifest): string {
  if (manifest.archive.conversation.mode === "none") {
    return "# 对话记录\n\n未附带聊天记录。";
  }
  const lines = manifest.archive.conversation.messages.map((message) => `- ${message.role}: ${message.body}`);
  return ["# 对话记录", "", ...lines].join("\n");
}

function buildArchiveDeliveryPreparation(manifest: HumanReadableArchiveManifest): string {
  const packageLines =
    manifest.archive.delivery.packages.length > 0
      ? manifest.archive.delivery.packages.map((item) => `- ${item.title}: ${item.format}`)
      : ["- 暂无交付准备内容"];
  const draftLines =
    manifest.archive.delivery.sectionDrafts.length > 0
      ? manifest.archive.delivery.sectionDrafts.map((item) => `- ${item.title}: ${item.status}`)
      : ["- 暂无待应用章节草稿"];
  return ["# 交付准备", "", "## Delivery packages", "", ...packageLines, "", "## Pending section drafts", "", ...draftLines].join("\n");
}

function buildArchiveAssetIndex(
  manifest: HumanReadableArchiveManifest,
  resolvedAssets: ProjectBundleResolvedAsset[]
): string {
  const assetState = new Map(resolvedAssets.map((item) => [item.sourceAssetId, item]));
  const lines =
    manifest.assetInventory.entries.length > 0
      ? manifest.assetInventory.entries.map((entry) => {
          const state = assetState.get(entry.sourceAssetId);
          const availability = state?.availability ?? "missingRequiredBinary";
          const location = state?.bytes ? entry.portableBundleKey : "未打包";
          return `- ${entry.sourceAssetId} | ${entry.fileName} | ${entry.mimeType} | ${availability} | ${location}`;
        })
      : ["- 暂无资产"];
  return ["# 资产索引", "", ...lines].join("\n");
}

function buildRichArchiveProjectOverview(manifest: HumanReadableArchiveManifest): string {
  const currentFocus =
    manifest.archive.projectContinuity.mode === "current"
      ? manifest.archive.projectContinuity.currentFocus.note
      : "未附带连续性记录";
  const activeDirections = manifest.archive.directions.filter((direction) => direction.status !== "eliminated");
  const eliminatedDirections = manifest.archive.directions.filter((direction) => direction.status === "eliminated");
  const defaultReferences = manifest.archive.visualObjects.filter((item) => item.isDefaultReference);

  return [
    "# 项目概览",
    "",
    `- 项目：${manifest.sourceProject.title}`,
    `- 副标题：${manifest.sourceProject.subtitle}`,
    `- 导出时间：${manifest.createdAt}`,
    `- 设计定义数量：${manifest.archive.designDefinitions.length}`,
    `- 关键结论数量：${manifest.archive.keyConclusions.length}`,
    `- 方向数量：${manifest.archive.directions.length}`,
    `- 当前默认参考数量：${defaultReferences.length}`,
    "",
    "## 当前设计定义",
    "",
    ...listOrEmpty(
      manifest.archive.designDefinitions.map((item) =>
        [
          `### ${item.title}`,
          "",
          `- 摘要：${item.summary}`,
          `- 问题：${item.problem}`,
          `- 当前修订：${item.currentRevisionId}`,
          `- 是否当前生效：${yesNo(item.isCurrentEffective)}`,
          bulletList("原则", item.principles),
          bulletList("避免", item.avoid)
        ].join("\n")
      ),
      "暂无设计定义"
    ),
    "",
    "## 关键结论",
    "",
    ...listOrEmpty(
      manifest.archive.keyConclusions.map(
        (item) =>
          `- ${item.title}｜类别：${keyConclusionCategoryLabel(item.category)}｜${item.state}｜${item.confidence}：${item.summary}\n  来源对象：${joinValues(item.sourceObjectIds)}；引用：${joinValues(item.citationIds)}\n  ${item.body}`
      ),
      "暂无关键结论"
    ),
    "",
    "## 有效方向",
    "",
    ...listOrEmpty(
      activeDirections.map((item) => `- ${item.title}｜${item.status}｜${item.summary}｜关键词：${joinValues(item.keywords)}`),
      "暂无有效方向"
    ),
    "",
    "## 淘汰方向",
    "",
    ...listOrEmpty(
      eliminatedDirections.map((item) => {
        const decision = manifest.archive.decisions.find(
          (candidate) =>
            candidate.objectSnapshot?.id === item.id ||
            candidate.relatedObjectIds.includes(item.id) ||
            candidate.summary.includes(item.title)
        );
        return `- ${item.title}｜${item.summary}｜原因：${decision?.reason ?? decision?.summary ?? "未记录明确原因"}`;
      }),
      "暂无淘汰方向"
    ),
    "",
    "## 默认参考图",
    "",
    ...listOrEmpty(
      defaultReferences.map(
        (item) =>
          `- ${item.title}｜${item.role}｜${item.imageVariant}｜方向：${item.directionTitle ?? item.directionId ?? "未关联方向"}｜分支：${item.visualBranchLabel ?? item.visualBranchId ?? "未关联分支"}`
      ),
      "暂无默认参考图"
    ),
    "",
    "## 当前重点 / 下一步",
    "",
    currentFocus
  ].join("\n");
}

function buildRichArchiveResearchAndSources(manifest: HumanReadableArchiveManifest): string {
  const researchLines = manifest.archive.researchAndSources.researchObjects.flatMap((item) => [
    `### ${item.title}`,
    "",
    `- 摘要：${item.summary}`,
    bulletList("发现", item.findings),
    bulletList("机会", item.opportunities),
    bulletList("约束", item.constraints),
    bulletList("待验证", item.openQuestions),
    "- Evidence:",
    ...listOrEmpty(
      (item.evidence ?? []).map(
        (evidence) =>
          `  - ${evidence.claim}｜${evidence.confidence}｜来源对象：${joinValues(evidence.sourceObjectIds)}｜引用：${joinValues(evidence.citationIds)}`
      ),
      "  - 暂无 evidence"
    ),
    `- Provenance：operation=${item.provenance?.operationId ?? "无"}；proposal=${item.provenance?.proposalId ?? "无"}；webSearch=${yesNo(item.provenance?.didUseWebSearch ?? false)}`
  ]);
  const sourceLines = manifest.archive.researchAndSources.sourceIndex.map((item) => `- ${sourceIndexLabel(item)}`);
  const citationLines = Object.values(manifest.archive.researchAndSources.citationSnapshots).map(
    (item) =>
      `- ${item.id}｜${item.title}｜${item.domain ?? "无域名"}｜${item.url ?? "无 URL"}｜${item.snippet ?? "无摘录"}｜retrievedAt=${item.retrievedAt}`
  );
  const evidenceCitationLines = manifest.archive.researchAndSources.researchObjects.flatMap((item) =>
    (item.evidence ?? []).flatMap((evidence) =>
      evidence.citationIds.map((citationId) => `- ${item.id}｜${evidence.claim} -> ${citationId}`)
    )
  );

  return [
    "# 研究与来源",
    "",
    "## Research objects",
    "",
    ...listOrEmpty(researchLines, "暂无结构化研究对象"),
    "",
    "## Source index",
    "",
    ...listOrEmpty(sourceLines, "暂无可读来源索引"),
    "",
    "## Citation snapshots",
    "",
    ...listOrEmpty(citationLines, "暂无 citation snapshot"),
    "",
    "## Evidence to citation",
    "",
    ...listOrEmpty(evidenceCitationLines, "暂无 evidence-citation 关系")
  ].join("\n");
}

function buildRichArchiveDirectionsAndVisuals(
  manifest: HumanReadableArchiveManifest,
  resolvedAssets: ProjectBundleResolvedAsset[]
): string {
  const assetState = new Map(resolvedAssets.map((item) => [item.sourceAssetId, item]));
  const directionLines = manifest.archive.directions.map((item) => {
    const revision = manifest.archive.traceability.directionRevisions[item.currentRevisionId];
    return `- ${item.title}｜${item.status}｜${item.visibility}｜${item.summary}｜当前修订：${item.currentRevisionId}｜策略：${revision?.strategy ?? "未记录"}｜风险：${joinValues(revision?.risks)}`;
  });
  const branchLines = Object.values(manifest.archive.traceability.visualBranches).map(
    (branch) =>
      `- ${branch.label}｜id=${branch.id}｜direction=${branch.directionId}｜root=${branch.rootObjectId ?? "无"}｜archived=${branch.archivedAt ?? "否"}`
  );
  const visualLines = manifest.archive.visualObjects.map((item) => {
    const asset = item.assetId ? assetState.get(item.assetId) : undefined;
    const assetLabel = asset ? `${asset.portableBundleKey}｜${asset.availability}` : "无关联资产";
    return `- ${item.title}｜role=${item.role}｜variant=${item.imageVariant}｜visibility=${item.visibility}｜direction=${item.directionTitle ?? item.directionId ?? "无"}｜branch=${item.visualBranchLabel ?? item.visualBranchId ?? "无"}｜defaultReference=${yesNo(item.isDefaultReference)}｜relations=${joinValues(item.relatedRelationKinds)}｜asset=${assetLabel}`;
  });

  return [
    "# 方向与视觉路线",
    "",
    "## 方向",
    "",
    ...listOrEmpty(directionLines, "暂无概念方向"),
    "",
    "## Visual branches",
    "",
    ...listOrEmpty(branchLines, "暂无视觉分支"),
    "",
    "## 视觉对象",
    "",
    ...listOrEmpty(visualLines, "暂无视觉对象")
  ].join("\n");
}

function buildRichArchiveDecisionsAndProcess(manifest: HumanReadableArchiveManifest): string {
  const decisionLines = manifest.archive.decisions.map(
    (item) =>
      `- ${item.createdAt}｜${item.kind}｜${item.summary}｜原因：${item.reason ?? "未记录"}｜对象：${item.objectSnapshot?.title ?? item.objectSnapshot?.id ?? "无"}｜相关：${joinValues(item.relatedObjectIds)}｜Compare：${item.comparison?.comparisonAnalysisId ?? "无"}｜Compare reason：${item.comparison?.userReason ?? "无"}`
  );
  const definitionRevisionLines = Object.values(manifest.archive.traceability.designDefinitionRevisions).map(
    (revision) =>
      `- ${revision.id}｜${revision.title}｜v${revision.revisionNumber}｜current=${yesNo(revision.isCurrent)}｜${revision.summary}｜change=${revision.changeNote ?? "无"}｜sources=${joinValues(revision.sourceObjectIds)}｜citations=${joinValues(revision.citationIds)}`
  );
  const directionRevisionLines = Object.values(manifest.archive.traceability.directionRevisions).map(
    (revision) =>
      `- ${revision.id}｜${revision.title}｜v${revision.revisionNumber}｜current=${yesNo(revision.isCurrent)}｜${revision.summary}｜change=${revision.changeNote ?? "无"}｜sources=${joinValues(revision.sourceObjectIds)}｜citations=${joinValues(revision.citationIds)}`
  );
  const branchLines = Object.values(manifest.archive.traceability.visualBranches).map(
    (branch) => `- ${branch.id}｜${branch.label}｜direction=${branch.directionId}｜root=${branch.rootObjectId ?? "无"}`
  );
  const traceLines = manifest.archive.traceability.directionLineage.map((item) => `- ${item.kind}｜${item.note}`);

  return [
    "# 决策与过程",
    "",
    "## 决策",
    "",
    ...listOrEmpty(decisionLines, "暂无 DecisionRecord"),
    "",
    "## Design definition revisions",
    "",
    ...listOrEmpty(definitionRevisionLines, "暂无设计定义修订"),
    "",
    "## Direction revisions",
    "",
    ...listOrEmpty(directionRevisionLines, "暂无方向修订"),
    "",
    "## Visual branches",
    "",
    ...listOrEmpty(branchLines, "暂无视觉分支"),
    "",
    "## Traceability",
    "",
    ...listOrEmpty(traceLines, "暂无方向谱系记录")
  ].join("\n");
}

function buildRichArchiveDeliveryPreparation(manifest: HumanReadableArchiveManifest): string {
  const packageLines = manifest.archive.delivery.packages.flatMap((item) => [
    `### ${item.title}`,
    "",
    `- Format：${item.format}`,
    `- Summary：${item.summary}`,
    "- Sections:",
    ...listOrEmpty(
      [...item.sections]
        .sort((left, right) => left.order - right.order)
        .map(
          (section) =>
            `  - ${section.order}. ${section.title}｜purpose=${section.purpose ?? "无"}｜references=${joinValues(section.referenceIds)}｜narrative=${section.narrative ?? "无"}`
        ),
      "  - 暂无 sections"
    ),
    "- Gaps:",
    ...listOrEmpty(
      item.gaps.map((gap) => `  - ${gap.label}｜${gap.status}｜section=${gap.sectionId ?? "未分配"}｜origin=${gap.origin}`),
      "  - 暂无 gaps"
    ),
    "- Stable references:",
    ...listOrEmpty(
      item.references.map((referenceId) => {
        const reference = manifest.archive.delivery.references.find((candidate) => candidate.id === referenceId);
        return `  - ${referenceId}｜${reference?.snapshot.title ?? "未知引用"}｜source=${reference?.sourceObjectId ?? "无"}｜asset=${reference?.sourceAssetId ?? reference?.snapshot.previewAsset?.assetId ?? "无"}｜caption=${reference?.editorial?.caption ?? "无"}`;
      }),
      "  - 暂无 stable references"
    )
  ]);
  const draftLines = manifest.archive.delivery.sectionDrafts.map(
    (item) =>
      `- ${item.title ?? item.sectionId}｜${item.status}｜delivery=${item.deliveryObjectId}｜section=${item.sectionId}\n  Narrative：${item.narrative}\n  Captions：${joinValues(item.captions.map((caption) => `${caption.referenceId}: ${caption.caption}`))}\n  Suggested gaps：${joinValues(item.suggestedGaps.map((gap) => gap.label))}`
  );

  return [
    "# 交付准备",
    "",
    "## Delivery packages",
    "",
    ...listOrEmpty(packageLines, "暂无交付准备内容"),
    "",
    "## Pending section drafts",
    "",
    ...listOrEmpty(draftLines, "暂无待应用章节草稿")
  ].join("\n");
}

function buildRichArchiveAssetIndex(
  manifest: HumanReadableArchiveManifest,
  resolvedAssets: ProjectBundleResolvedAsset[]
): string {
  const assetState = new Map(resolvedAssets.map((item) => [item.sourceAssetId, item]));
  const lines = manifest.assetInventory.entries.map((entry) => {
    const state = assetState.get(entry.sourceAssetId);
    const availability = state?.availability ?? "missingRequiredBinary";
    const location = state?.bytes ? entry.portableBundleKey : "未打包";
    const references = manifest.assetInventory.references
      .filter((reference) => reference.assetId === entry.sourceAssetId)
      .map((reference) => `${reference.field} (${reference.usage})`);
    return `- ${entry.sourceAssetId} | ${entry.fileName} | ${entry.mimeType} | ${entry.size} bytes | ${entry.sourceType} | ${availability} | ${location} | references: ${joinValues(references)}`;
  });
  return ["# 资产索引", "", ...listOrEmpty(lines, "暂无资产")].join("\n");
}

function sourceIndexLabel(item: HumanReadableArchiveManifest["archive"]["researchAndSources"]["sourceIndex"][number]): string {
  if (item.type === "link") {
    return `${item.title}｜link｜${item.url}｜${item.domain}｜${item.description ?? item.summary}`;
  }
  if (item.type === "file") {
    return `${item.title}｜file｜${item.fileName ?? "无文件名"}｜${item.mimeType ?? "未知 MIME"}｜asset=${item.assetId ?? "无"}`;
  }
  if (item.type === "documentFragment") {
    return `${item.title}｜documentFragment｜${item.source.fileTitle}｜${item.source.fileName ?? "无文件名"}｜asset=${item.source.sourceExtractAssetId}｜offset=${item.source.startOffset}-${item.source.endOffset}`;
  }
  return `${item.title}｜text｜${item.summary}`;
}

function listOrEmpty(lines: string[], empty: string): string[] {
  return lines.length > 0 ? lines : [`- ${empty}`];
}

function keyConclusionCategoryLabel(category: KeyConclusionCategory): string {
  switch (category) {
    case "finding":
      return "发现";
    case "opportunity":
      return "机会点";
    case "constraint":
      return "约束";
    case "openQuestion":
      return "待验证";
    case "unknown":
      return "待分类";
  }
}

function bulletList(label: string, values: readonly string[] | undefined): string {
  return `- ${label}：${joinValues(values)}`;
}

function joinValues(values: readonly (string | undefined)[] | undefined): string {
  const filtered = (values ?? []).filter((value): value is string => Boolean(value));
  return filtered.length > 0 ? filtered.join("、") : "无";
}

function yesNo(value: boolean): string {
  return value ? "是" : "否";
}

function createEnvelope(
  packageKind: ProjectBundlePackageKind,
  createdAt: string,
  manifestPath: string,
  diagnostics: ProjectBundleDiagnostic[],
  files: ProjectBundleFile[]
): ProjectBundleEnvelope {
  return {
    format: PROJECT_BUNDLE_FORMAT,
    bundleVersion: PROJECT_BUNDLE_VERSION,
    packageKind,
    createdAt,
    manifestPath,
    files: [
      {
        path: "bundle.json",
        kind: "metadata",
        required: true
      },
      ...files.map(toDescriptor)
    ],
    diagnostics
  };
}

function outputFile(
  path: string,
  kind: ProjectBundleFileKind,
  required: boolean,
  bytes: Uint8Array,
  assetId?: AssetId
): ProjectBundleFile {
  return {
    path,
    kind,
    required,
    assetId,
    byteLength: bytes.byteLength,
    bytes
  };
}

function toDescriptor(file: ProjectBundleFile): ProjectBundleFileDescriptor {
  return {
    path: file.path,
    kind: file.kind,
    required: file.required,
    assetId: file.assetId,
    byteLength: file.byteLength
  };
}

function expectsBundledBinary(sourceType: AssetRecord["sourceType"]): boolean {
  return sourceType !== "originalLink";
}

function utf8(value: string): Uint8Array {
  return utf8Encoder.encode(value);
}

function dateStamp(value: string): string {
  return value.slice(0, 10);
}

function safeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || "project";
}

function dedupeBundleDiagnostics(diagnostics: ProjectBundleDiagnostic[]): ProjectBundleDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}|${diagnostic.severity}|${diagnostic.path ?? ""}|${diagnostic.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function failedBundle(reason: string, diagnostics: ProjectBundleDiagnostic[]): {
  status: "failed";
  reason: string;
  diagnostics: ProjectBundleDiagnostic[];
} {
  return {
    status: "failed",
    reason,
    diagnostics: dedupeBundleDiagnostics(diagnostics)
  };
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isBundleEnvelope(value: unknown): value is ProjectBundleEnvelope {
  return (
    isRecord(value) &&
    typeof value.format === "string" &&
    typeof value.bundleVersion === "string" &&
    typeof value.packageKind === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.manifestPath === "string" &&
    Array.isArray(value.files) &&
    Array.isArray(value.diagnostics)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
