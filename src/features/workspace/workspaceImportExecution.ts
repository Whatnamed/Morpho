import type {
  AssetRecord,
  AssetSourceType,
  CanvasPoint,
  MorphoWorkspace
} from "@/domain/morpho/types";
import {
  attachDocumentExtractToFileObject,
  markFileObjectParseFailed,
  markFileObjectParsing
} from "@/domain/morpho/workspace";
import {
  createDocumentExtractFile,
  shouldAttemptDocumentParse,
  type DocumentParseResult
} from "@/domain/morpho/documentParsing";
import {
  importAssetBackedObjects,
  importTextObject,
  importUrlObject
} from "@/domain/morpho/imports";
import type { SaveLocalAssetResult } from "@/infrastructure/assets/localAssetWorkflow";
import type { ImageAssetDimensions } from "@/infrastructure/assets/localAssetWorkflow";
import {
  createImportResourcePolicyError,
  preflightImportResourceMetadata,
  validateImportImageDimensions
} from "@/domain/morpho/importResourcePolicy";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";

export type WorkspaceImportRequest = Readonly<{
  position: CanvasPoint;
  files?: readonly File[];
  text?: string;
  url?: string;
}>;

export type WorkspaceImportExecutionSession = Readonly<{
  projectId: string;
  workspaceReady: boolean;
  generation: symbol;
}>;

export type StaleWorkspaceImportExecutionError = Error & {
  code: "stale_workspace_import_execution";
};

export function createStaleWorkspaceImportExecutionError(
  message = "Import execution 所属的项目会话已失效。"
): StaleWorkspaceImportExecutionError {
  return Object.assign(new Error(message), {
    code: "stale_workspace_import_execution" as const
  });
}

export function isStaleWorkspaceImportExecutionError(
  value: unknown
): value is StaleWorkspaceImportExecutionError {
  return isRecord(value) && value.code === "stale_workspace_import_execution";
}

export type WorkspaceImportExecutionPorts = Readonly<{
  getCurrentSession: () => WorkspaceImportExecutionSession;
  assertCurrentSession: (expectedSession: WorkspaceImportExecutionSession) => void;
  commitWorkspace: <T>(
    expectedSession: WorkspaceImportExecutionSession,
    transform: WorkspaceCommitTransform<T>
  ) => T;
  selectObjects: (
    expectedSession: WorkspaceImportExecutionSession,
    objectIds: string[]
  ) => void;
  saveAsset: (
    file: File,
    sourceType: AssetSourceType,
    dimensions?: ImageAssetDimensions
  ) => Promise<SaveLocalAssetResult>;
  readImageDimensions: (file: File) => Promise<ImageAssetDimensions>;
  deleteAsset: (storageKey: string) => Promise<void>;
  parseDocumentFile: (file: File) => Promise<DocumentParseResult>;
  saveDocumentExtract: (file: File) => Promise<SaveLocalAssetResult>;
  now: () => number;
}>;

type SuccessfulAssetFile = Readonly<{
  asset: AssetRecord;
  file: File;
}>;

type PreparedImportFile = Readonly<{
  file: File;
  sourceType: AssetSourceType;
  dimensions?: ImageAssetDimensions;
}>;

type ImportedWorkspaceResult = Readonly<{
  objectIds: string[];
  parseTargets: Array<{ objectId: string; file: File }>;
}>;

export async function executeWorkspaceImport(
  request: WorkspaceImportRequest,
  ports: WorkspaceImportExecutionPorts,
  expectedSession: WorkspaceImportExecutionSession = ports.getCurrentSession()
): Promise<void> {
  const session = expectedSession;
  assertExecutionSession(session, ports);

  const descriptors = preflightImportResourceMetadata(request.files ?? []);
  const preparedFiles: PreparedImportFile[] = [];
  let decodedPixels = 0;
  for (const descriptor of descriptors) {
    ports.assertCurrentSession(session);
    if (descriptor.kind !== "image") {
      preparedFiles.push({ file: descriptor.file, sourceType: "originalFile" });
      continue;
    }
    let dimensions: ImageAssetDimensions;
    try {
      dimensions = await ports.readImageDimensions(descriptor.file);
    } catch {
      throw createImportResourcePolicyError("图片分辨率过高或无法读取，未导入。");
    }
    ports.assertCurrentSession(session);
    decodedPixels = validateImportImageDimensions(descriptor.file, dimensions, decodedPixels);
    preparedFiles.push({ file: descriptor.file, sourceType: "originalImage", dimensions });
  }

  const successfulAssets: AssetRecord[] = [];
  const successfulAssetFiles: SuccessfulAssetFile[] = [];
  const failureReasons: string[] = [];

  let assetsCommitted = false;
  try {
    for (const prepared of preparedFiles) {
      ports.assertCurrentSession(session);
      const saved = await ports.saveAsset(prepared.file, prepared.sourceType, prepared.dimensions);
      if (saved.status === "ok") {
        successfulAssets.push(saved.asset);
        successfulAssetFiles.push({ asset: saved.asset, file: prepared.file });
      } else {
        failureReasons.push(`文件“${boundedDisplayName(prepared.file.name)}”保存失败。`);
      }
      ports.assertCurrentSession(session);
    }

    const imported = ports.commitWorkspace(session, (current) => {
    ports.assertCurrentSession(session);
    let next = current;
    let objectIds: string[] = [];
    let parseTargets: Array<{ objectId: string; file: File }> = [];

    if (successfulAssets.length > 0) {
      const result = importAssetBackedObjects(next, {
        assets: successfulAssets,
        position: request.position
      });
      next = result.workspace;
      objectIds = result.objectIds;
      const fileByAssetId = new Map(
        successfulAssetFiles.map((entry) => [entry.asset.id, entry.file])
      );
      parseTargets = result.objectIds
        .map((objectId) => next.objects[objectId])
        .filter((object) => object?.type === "file")
        .map((object) => ({
          objectId: object.id,
          file: object.assetId ? fileByAssetId.get(object.assetId) : undefined
        }))
        .filter((target): target is { objectId: string; file: File } => Boolean(target.file));
    } else if (request.url) {
      const result = importUrlObject(next, {
        url: request.url,
        position: request.position
      });
      next = result.workspace;
      objectIds = result.objectIds;
    } else if (request.text) {
      const result = importTextObject(next, {
        text: request.text,
        position: request.position
      });
      next = result.workspace;
      objectIds = result.objectIds;
    }

    if (failureReasons.length > 0) {
      const timestamp = ports.now();
      next = {
        ...next,
        ai: {
          ...next.ai,
          messages: [
            ...next.ai.messages,
            {
              id: `ai-import-error-${timestamp}`,
              role: "assistant",
              body: formatImportFailureMessage(failureReasons),
              status: "failed",
              createdAt: new Date(timestamp).toISOString()
            }
          ]
        }
      };
    }

    return {
      workspace: next,
      value: { objectIds, parseTargets }
    };
    });
    assetsCommitted = true;

    if (imported.objectIds.length > 0) {
      ports.selectObjects(session, imported.objectIds);
    }

    if (imported.parseTargets.length > 0) {
      await parseImportedDocuments(session, imported.parseTargets, ports);
    }
  } catch (error) {
    if (!assetsCommitted) {
      await cleanupAssets(successfulAssets, ports);
    }
    throw error;
  }
}

async function parseImportedDocuments(
  session: WorkspaceImportExecutionSession,
  targets: Array<{ objectId: string; file: File }>,
  ports: WorkspaceImportExecutionPorts
): Promise<void> {
  for (const target of targets) {
    if (!shouldAttemptDocumentParse(target.file)) {
      continue;
    }

    ports.commitWorkspace(session, (current) => ({
      workspace: markFileObjectParsing(current, target.objectId),
      value: undefined
    }));

    let parsed: DocumentParseResult;
    try {
      parsed = await ports.parseDocumentFile(target.file);
    } catch (error) {
      parsed = {
        status: "failed",
        reason: "文档解析失败，源文件已保留。"
      };
    }
    ports.assertCurrentSession(session);

    if (parsed.status === "failed") {
      ports.commitWorkspace(session, (current) => ({
        workspace: markFileObjectParseFailed(current, {
          fileObjectId: target.objectId,
          reason: parsed.reason
        }),
        value: undefined
      }));
      continue;
    }

    const extractFile = createDocumentExtractFile(target.file, parsed.text);
    const saved = await ports.saveDocumentExtract(extractFile);
    if (saved.status === "failed") {
      ports.commitWorkspace(session, (current) => ({
        workspace: markFileObjectParseFailed(current, {
          fileObjectId: target.objectId,
          reason: "文档摘录保存失败。"
        }),
        value: undefined
      }));
      continue;
    }

    try {
      ports.assertCurrentSession(session);
      ports.commitWorkspace(session, (current) => ({
        workspace: attachDocumentExtractToFileObject(current, {
          fileObjectId: target.objectId,
          extractAsset: saved.asset,
          extractedCharCount: parsed.text.length,
          extractedPageCount: parsed.pageCount,
          sourcePageCount: parsed.sourcePageCount,
          extractionTruncated: parsed.truncated
        }),
        value: undefined
      }));
    } catch (error) {
      await cleanupAssets([saved.asset], ports);
      throw error;
    }
  }
}

async function cleanupAssets(assets: readonly AssetRecord[], ports: WorkspaceImportExecutionPorts): Promise<void> {
  await Promise.allSettled(assets.map((asset) => ports.deleteAsset(asset.storageKey)));
}

function formatImportFailureMessage(reasons: readonly string[]): string {
  const visible = reasons.slice(0, 3);
  const remaining = reasons.length - visible.length;
  return `有 ${reasons.length} 个资产没有导入成功：${visible.join("；")}${
    remaining > 0 ? `；另有 ${remaining} 个文件未列出` : ""
  }`;
}

function boundedDisplayName(fileName: string): string {
  const normalized = fileName.replace(/[\u0000-\u001f\u007f]/g, " ").trim() || "未命名文件";
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function assertExecutionSession(
  session: WorkspaceImportExecutionSession,
  ports: WorkspaceImportExecutionPorts
): void {
  if (!session.workspaceReady) {
    throw createStaleWorkspaceImportExecutionError();
  }
  ports.assertCurrentSession(session);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
