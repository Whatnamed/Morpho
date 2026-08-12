import { createHash } from "node:crypto";
import { extname, resolve } from "node:path";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

import { unzipSync } from "fflate";

import { planEditableProjectBackupRestore, validateEditableProjectBackupBundle } from "../projectBundles";
import type { EditableProjectBackupManifest } from "../projectArchive";
import type { AssetRecord, MorphoObject, MorphoWorkspace } from "../types";
import { parseWorkspace } from "../workspace";
import { fingerprintCaseStudyWorkspace } from "./caseStudyFingerprint";
import { CURRENT_CASE_STUDY_ID } from "./currentCaseStudyConstants";

const DEFAULT_CASE_STUDY_VERSION = "2026-07-in-progress-1";
export type CaseStudyImportOptions = {
  backupPath: string;
  caseStudyVersion?: string;
  projectRoot: string;
};

export type CaseStudyImportDiagnostic = {
  code: string;
  severity: "error" | "warning" | "info";
};

export type CaseStudyImportReport = {
  assetCount: number;
  caseStudyVersion: string;
  chat: {
    agentTraceCount: number;
    agentTracePartCount: number;
    assistantMessageCount: number;
    citationCount: number;
    userMessageCount: number;
  };
  cleanedCategories: string[];
  embeddedAssetCount: number;
  missingAssetCount: number;
  objectTypes: Record<string, number>;
  project: {
    id: string;
    sourceId: string;
    subtitle: string;
    title: string;
    workspaceSchemaVersion: number;
  };
  referenceOnlyAssetCount: number;
  resourceBytes: number;
  sizeMismatchCount: number;
  workspaceFingerprint: string;
};

export type PreparedCaseStudyImport = {
  assetManifest: {
    assets: Array<{
      assetId: string;
      contentHash: string;
      mimeType: string;
      publicPath: string;
      runtimeStorageKey: string;
      size: number;
    }>;
    manifestVersion: string;
  };
  assets: Array<{
    bytes: Uint8Array;
    fileName: string;
  }>;
  diagnostics: CaseStudyImportDiagnostic[];
  report: CaseStudyImportReport;
  workspace: MorphoWorkspace;
};

export class CaseStudyImportError extends Error {
  constructor(
    message: string,
    readonly diagnostics: CaseStudyImportDiagnostic[]
  ) {
    super(message);
  }
}

export async function importCurrentCaseStudyBackup(options: CaseStudyImportOptions): Promise<CaseStudyImportReport> {
  const archive = await readEditableBackupArchive(options.backupPath);
  const prepared = prepareCurrentCaseStudyImport({
    ...archive,
    caseStudyVersion: options.caseStudyVersion ?? DEFAULT_CASE_STUDY_VERSION
  });

  await writePreparedCaseStudyImport(prepared, options.projectRoot);
  return prepared.report;
}

export async function readEditableBackupArchive(backupPath: string): Promise<{
  bundle: unknown;
  files: Record<string, Uint8Array>;
  manifest: unknown;
}> {
  const bytes = new Uint8Array(await readFile(backupPath));
  const files = unzipSync(bytes);
  const bundle = parseJsonFile(files["bundle.json"], "bundle.json");

  if (!isRecord(bundle) || typeof bundle.manifestPath !== "string") {
    throw new CaseStudyImportError("Backup is missing a readable bundle envelope.", [
      { code: "bundle_invalid", severity: "error" }
    ]);
  }

  return {
    bundle,
    manifest: parseJsonFile(files[bundle.manifestPath], bundle.manifestPath),
    files
  };
}

export function prepareCurrentCaseStudyImport(input: {
  bundle: unknown;
  caseStudyVersion: string;
  files: Record<string, Uint8Array>;
  manifest: unknown;
}): PreparedCaseStudyImport {
  const validation = validateEditableProjectBackupBundle({
    bundle: input.bundle,
    manifest: input.manifest,
    files: input.files
  });

  const validationDiagnostics = validation.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity
  }));

  if (validation.status === "failed") {
    throw new CaseStudyImportError("Editable backup validation failed.", validationDiagnostics);
  }

  const manifest = validation.manifest;
  validateReferenceOnlyAssets(manifest);
  const restorePlan = planEditableProjectBackupRestore(manifest, validation.files, {
    projectId: CURRENT_CASE_STUDY_ID,
    projectTitle: manifest.sourceProject.title,
    restoredAt: manifest.workspaceSnapshot.project.createdAt ?? manifest.createdAt,
    createRuntimeStorageKey: createCaseStudyRuntimeStorageKey
  });

  if (restorePlan.status === "failed") {
    throw new CaseStudyImportError(
      "Editable backup restore planning failed.",
      restorePlan.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity }))
    );
  }

  const cleanedCategories = new Set<string>();
  const sanitizedWorkspaceSnapshot = sanitizeWorkspaceSnapshot({
    ...manifest.workspaceSnapshot,
    operations: restorePlan.workspace.operations
  }, cleanedCategories);
  const runtimeAssets = Object.fromEntries(
    Object.entries(sanitizedWorkspaceSnapshot.assets).map(([assetId, asset]) => [
      assetId,
      {
        ...asset,
        storageKey: createCaseStudyRuntimeStorageKey(assetId)
      }
    ])
  );

  const parsedWorkspace = parseWorkspace(
    JSON.stringify({
      ...sanitizedWorkspaceSnapshot,
      project: {
        ...sanitizedWorkspaceSnapshot.project,
        id: CURRENT_CASE_STUDY_ID
      },
      assets: runtimeAssets
    })
  );

  if (parsedWorkspace.status === "failed") {
    throw new CaseStudyImportError("Current case workspace could not be parsed.", [
      { code: "workspace_parse_failed", severity: "error" }
    ]);
  }

  const workspace = {
    ...parsedWorkspace.workspace,
    workingState: {
      ...parsedWorkspace.workspace.workingState,
      lastReconciledAt:
        sanitizedWorkspaceSnapshot.workingState.lastReconciledAt ?? parsedWorkspace.workspace.workingState.lastReconciledAt
    }
  };
  const referenceDiagnostics = validateWorkspaceReferences(workspace);
  if (referenceDiagnostics.length > 0) {
    throw new CaseStudyImportError("Current case workspace has unresolved references.", referenceDiagnostics);
  }

  const binaryAssets = createStaticAssets(manifest, validation.files);
  const assetManifest = {
    manifestVersion: input.caseStudyVersion,
    assets: binaryAssets.assets
  };
  const report = createReport({
    caseStudyVersion: input.caseStudyVersion,
    cleanedCategories,
    manifest,
    validationDiagnostics,
    workspace,
    assetManifest
  });

  return {
    assetManifest,
    assets: binaryAssets.files,
    diagnostics: validationDiagnostics,
    report,
    workspace
  };
}

export async function writePreparedCaseStudyImport(
  prepared: PreparedCaseStudyImport,
  projectRoot: string
): Promise<void> {
  const generatedRoot = resolve(projectRoot, "src/domain/morpho/caseStudy");
  const publicRoot = resolve(projectRoot, "public/case-study/current");
  assertInsideRoot(generatedRoot, resolve(projectRoot, "src/domain/morpho"));
  assertInsideRoot(publicRoot, resolve(projectRoot, "public/case-study"));

  await mkdir(generatedRoot, { recursive: true });
  await rm(publicRoot, { recursive: true, force: true });
  await mkdir(resolve(publicRoot, "assets"), { recursive: true });

  await Promise.all(
    prepared.assets.map((asset) => writeFile(resolve(publicRoot, "assets", asset.fileName), asset.bytes))
  );

  await Promise.all([
    writeGeneratedJson(resolve(generatedRoot, "currentCaseWorkspace.generated.json"), prepared.workspace),
    writeGeneratedJson(resolve(generatedRoot, "currentCaseAssets.generated.json"), prepared.assetManifest),
    writeGeneratedJson(resolve(generatedRoot, "currentCaseDiagnostics.generated.json"), prepared.report)
  ]);

  await removeEmptyDirectories(publicRoot);
}

function createStaticAssets(
  manifest: EditableProjectBackupManifest,
  files: Record<string, Uint8Array>
): {
  assets: PreparedCaseStudyImport["assetManifest"]["assets"];
  files: PreparedCaseStudyImport["assets"];
} {
  const assetById = manifest.workspaceSnapshot.assets;
  const canonicalFiles = new Map<string, { bytes: Uint8Array; fileName: string }>();
  const assets = manifest.assetInventory.entries
    .filter((entry) => entry.sourceType !== "originalLink")
    .sort((left, right) => left.sourceAssetId.localeCompare(right.sourceAssetId))
    .map((entry) => {
      const bytes = files[entry.portableBundleKey];
      const asset = assetById[entry.sourceAssetId];
      if (!bytes || !asset) {
        throw new CaseStudyImportError("A required static asset is missing.", [
          { code: "asset_binary_missing", severity: "error" }
        ]);
      }

      const contentHash = sha256(bytes);
      const extension = safeExtension(asset.fileName, asset.mimeType);
      const fileName = `${contentHash}${extension}`;
      if (!canonicalFiles.has(fileName)) {
        canonicalFiles.set(fileName, { bytes, fileName });
      }

      return {
        assetId: entry.sourceAssetId,
        contentHash,
        mimeType: asset.mimeType,
        publicPath: `/case-study/current/assets/${fileName}`,
        runtimeStorageKey: createCaseStudyRuntimeStorageKey(entry.sourceAssetId),
        size: asset.size
      };
    });

  return {
    assets,
    files: [...canonicalFiles.values()].sort((left, right) => left.fileName.localeCompare(right.fileName))
  };
}

function createReport(input: {
  assetManifest: PreparedCaseStudyImport["assetManifest"];
  caseStudyVersion: string;
  cleanedCategories: Set<string>;
  manifest: EditableProjectBackupManifest;
  validationDiagnostics: CaseStudyImportDiagnostic[];
  workspace: MorphoWorkspace;
}): CaseStudyImportReport {
  const messages = input.workspace.ai.messages;
  const objectTypes = Object.values(input.workspace.objects).reduce<Record<string, number>>((counts, object) => {
    counts[object.type] = (counts[object.type] ?? 0) + 1;
    return counts;
  }, {});
  const missingAssetCount = input.validationDiagnostics.filter((item) => item.code === "asset_binary_missing").length;
  const sizeMismatchCount = input.validationDiagnostics.filter((item) => item.code === "asset_binary_size_mismatch").length;

  return {
    assetCount: input.assetManifest.assets.length,
    caseStudyVersion: input.caseStudyVersion,
    chat: {
      agentTraceCount: messages.filter((message) => Boolean(message.agentTrace)).length,
      agentTracePartCount: messages.reduce((count, message) => count + (message.agentTrace?.parts.length ?? 0), 0),
      assistantMessageCount: messages.filter((message) => message.role === "assistant").length,
      citationCount: messages.reduce((count, message) => count + (message.citationIds?.length ?? 0), 0),
      userMessageCount: messages.filter((message) => message.role === "user").length
    },
    cleanedCategories: [...input.cleanedCategories].sort(),
    embeddedAssetCount: input.assetManifest.assets.length,
    missingAssetCount,
    objectTypes: Object.fromEntries(Object.entries(objectTypes).sort(([left], [right]) => left.localeCompare(right))),
    project: {
      id: input.workspace.project.id,
      sourceId: input.manifest.sourceProject.id,
      subtitle: input.workspace.project.subtitle,
      title: input.workspace.project.title,
      workspaceSchemaVersion: input.workspace.schemaVersion
    },
    referenceOnlyAssetCount: input.manifest.assetInventory.entries.filter((entry) => entry.sourceType === "originalLink").length,
    resourceBytes: input.assetManifest.assets.reduce((total, asset) => total + asset.size, 0),
    sizeMismatchCount,
    workspaceFingerprint: fingerprintCaseStudyWorkspace(input.workspace)
  };
}

function sanitizeWorkspaceSnapshot(
  workspace: EditableProjectBackupManifest["workspaceSnapshot"],
  cleanedCategories: Set<string>
): EditableProjectBackupManifest["workspaceSnapshot"] {
  return sanitizeValue(workspace, cleanedCategories) as EditableProjectBackupManifest["workspaceSnapshot"];
}

function sanitizeValue(value: unknown, cleanedCategories: Set<string>, key = ""): unknown {
  if (typeof value === "string") {
    return sanitizeString(value, cleanedCategories);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, cleanedCategories));
  }

  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (isSensitiveKey(entryKey) && typeof entryValue === "string" && entryValue.trim()) {
      throw new CaseStudyImportError("Backup contains a credential-like field.", [
        { code: "sensitive_credential_field", severity: "error" }
      ]);
    }
    normalized[entryKey] = sanitizeValue(entryValue, cleanedCategories, entryKey);
  }
  return normalized;
}

function sanitizeString(value: string, cleanedCategories: Set<string>): string {
  if (looksLikeApiSecret(value)) {
    throw new CaseStudyImportError("Backup contains an API key or credential-like value.", [
      { code: "sensitive_api_key", severity: "error" }
    ]);
  }

  let sanitized = value;
  if (containsLocalOrTemporaryUrl(sanitized)) {
    sanitized = sanitized.replace(
      /(?:blob:[^\s"'<>]+|(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s"'<>]*|file:\/\/[^\s"'<>]+|https?:\/\/[^\s"'<>]+(?:[?&](?:X-Amz-Signature|X-Goog-Signature|signature|token|expires)=)[^\s"'<>]*)/gi,
      "[已清理不可部署地址]"
    );
    cleanedCategories.add("local-or-temporary-url");
  }
  if (/[a-z]:\\users\\[^\\/\r\n]+/i.test(sanitized) || /\/users\/[^/\r\n]+/i.test(sanitized)) {
    sanitized = sanitized.replace(/[a-z]:\\users\\[^\\/\r\n]+/gi, "[已清理本地路径]");
    sanitized = sanitized.replace(/\/users\/[^/\r\n]+/gi, "[已清理本地路径]");
    cleanedCategories.add("local-path");
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(sanitized)) {
    sanitized = sanitized.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[已清理邮箱]");
    cleanedCategories.add("email");
  }
  return sanitized;
}

function validateWorkspaceReferences(workspace: MorphoWorkspace): CaseStudyImportDiagnostic[] {
  const diagnostics: CaseStudyImportDiagnostic[] = [];
  const objectExists = (objectId: string | undefined) => Boolean(objectId && workspace.objects[objectId]);
  const assetExists = (assetId: string | undefined) => Boolean(assetId && workspace.assets[assetId]);
  const revisionExists = (revisionId: string | undefined) =>
    Boolean(revisionId && (workspace.designDefinitionRevisions[revisionId] || workspace.directionRevisions[revisionId]));

  for (const object of Object.values(workspace.objects)) {
    validateObjectReferences(object, { assetExists, objectExists, revisionExists, workspace }, diagnostics);
  }

  for (const relation of workspace.relations) {
    if (!objectExists(relation.fromObjectId) || !objectExists(relation.toObjectId)) {
      diagnostics.push({ code: "relation_object_missing", severity: "error" });
    }
  }

  for (const reference of Object.values(workspace.deliveryReferences)) {
    if ((reference.sourceObjectId && !objectExists(reference.sourceObjectId)) || (reference.sourceAssetId && !assetExists(reference.sourceAssetId))) {
      diagnostics.push({ code: "delivery_reference_target_missing", severity: "error" });
    }
  }

  for (const instance of workspace.canvas.instances) {
    if (!objectExists(instance.objectId)) {
      diagnostics.push({ code: "canvas_object_missing", severity: "error" });
    }
  }

  return diagnostics;
}

function validateObjectReferences(
  object: MorphoObject,
  input: {
    assetExists: (assetId: string | undefined) => boolean;
    objectExists: (objectId: string | undefined) => boolean;
    revisionExists: (revisionId: string | undefined) => boolean;
    workspace: MorphoWorkspace;
  },
  diagnostics: CaseStudyImportDiagnostic[]
): void {
  switch (object.type) {
    case "image":
      if (object.assetId && !input.assetExists(object.assetId)) diagnostics.push({ code: "image_asset_missing", severity: "error" });
      if (object.directionId && !input.objectExists(object.directionId)) diagnostics.push({ code: "image_direction_missing", severity: "error" });
      if (object.visualBranchId && !input.workspace.visualBranches[object.visualBranchId]) {
        diagnostics.push({ code: "image_visual_branch_missing", severity: "error" });
      }
      if (object.generation?.operationId && !input.workspace.operations[object.generation.operationId]) {
        diagnostics.push({ code: "image_operation_missing", severity: "error" });
      }
      return;
    case "file":
      if (object.assetId && !input.assetExists(object.assetId)) diagnostics.push({ code: "file_asset_missing", severity: "error" });
      if (object.extractedAssetId && !input.assetExists(object.extractedAssetId)) {
        diagnostics.push({ code: "document_extract_missing", severity: "error" });
      }
      return;
    case "documentFragment":
      if (!input.objectExists(object.source.fileObjectId) || !input.assetExists(object.source.sourceExtractAssetId)) {
        diagnostics.push({ code: "document_fragment_source_missing", severity: "error" });
      }
      return;
    case "research":
      if (object.provenance) {
        if (!input.workspace.operations[object.provenance.operationId]) diagnostics.push({ code: "research_operation_missing", severity: "error" });
        if (!object.provenance.sourceObjectIds.every(input.objectExists)) {
          diagnostics.push({ code: "research_source_missing", severity: "error" });
        }
      }
      return;
    case "keyConclusion":
      if (!object.sourceObjectIds.every(input.objectExists)) diagnostics.push({ code: "conclusion_source_missing", severity: "error" });
      if (object.supersededById && !input.objectExists(object.supersededById)) {
        diagnostics.push({ code: "conclusion_superseded_target_missing", severity: "error" });
      }
      return;
    case "designDefinition":
      if (!input.revisionExists(object.currentRevisionId) || !object.revisionIds.every(input.revisionExists)) {
        diagnostics.push({ code: "design_definition_revision_missing", severity: "error" });
      }
      return;
    case "conceptDirection":
      if (!input.revisionExists(object.currentRevisionId) || !object.revisionIds.every(input.revisionExists)) {
        diagnostics.push({ code: "direction_revision_missing", severity: "error" });
      }
      return;
    case "imageCollection":
      if (!object.memberObjectIds.every(input.objectExists)) diagnostics.push({ code: "collection_member_missing", severity: "error" });
      return;
    default:
      return;
  }
}

function parseJsonFile(bytes: Uint8Array | undefined, fileName: string): unknown {
  if (!bytes) {
    throw new CaseStudyImportError(`Backup is missing ${fileName}.`, [{ code: "bundle_file_missing", severity: "error" }]);
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new CaseStudyImportError(`Backup file ${fileName} is not valid JSON.`, [
      { code: "bundle_json_invalid", severity: "error" }
    ]);
  }
}

function createCaseStudyRuntimeStorageKey(assetId: string): string {
  return `case-study:current:${assetId}`;
}

function safeExtension(fileName: string, mimeType: string): string {
  const extension = extname(fileName).toLowerCase();
  if (/^\.[a-z0-9]{1,12}$/.test(extension)) {
    return extension;
  }

  return (
    {
      "application/pdf": ".pdf",
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "text/markdown": ".md",
      "text/plain": ".txt"
    }[mimeType] ?? ".bin"
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isSensitiveKey(key: string): boolean {
  return /(?:api[_-]?key|authorization|cookie|password|supabase[_-]?token|provider[_-]?credential)/i.test(key);
}

function looksLikeApiSecret(value: string): boolean {
  return (
    /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value) ||
    /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i.test(value) ||
    /\b(?:api[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/i.test(value) ||
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(value)
  );
}

function containsLocalOrTemporaryUrl(value: string): boolean {
  return (
    /\bblob:/i.test(value) ||
    /\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d+)?\b/i.test(value) ||
    /\bfile:\/\//i.test(value) ||
    /[?&](?:X-Amz-Signature|X-Goog-Signature|signature|token|expires)=/i.test(value)
  );
}

function validateReferenceOnlyAssets(manifest: EditableProjectBackupManifest): void {
  for (const entry of manifest.assetInventory.entries) {
    if (entry.sourceType !== "originalLink") {
      continue;
    }
    const asset = manifest.workspaceSnapshot.assets[entry.sourceAssetId];
    if (!asset || !isStablePublicUrl(asset.url)) {
      throw new CaseStudyImportError("Reference-only assets require stable public URLs.", [
        { code: "reference_only_url_unstable", severity: "error" }
      ]);
    }
  }
}

function isStablePublicUrl(value: string | undefined): boolean {
  if (!value || containsLocalOrTemporaryUrl(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function assertInsideRoot(path: string, root: string): void {
  if (path !== root && !path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`)) {
    throw new Error(`Refusing to write outside ${root}.`);
  }
}

async function writeGeneratedJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function removeEmptyDirectories(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const directory = resolve(root, entry.name);
        await removeEmptyDirectories(directory);
        if ((await readdir(directory)).length === 0) {
          await rm(directory, { recursive: true, force: true });
        }
      })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
