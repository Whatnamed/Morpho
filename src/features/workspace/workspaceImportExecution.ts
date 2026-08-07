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
    sourceType: AssetSourceType
  ) => Promise<SaveLocalAssetResult>;
  parseDocumentFile: (file: File) => Promise<DocumentParseResult>;
  saveDocumentExtract: (file: File) => Promise<SaveLocalAssetResult>;
  now: () => number;
}>;

type SuccessfulAssetFile = Readonly<{
  asset: AssetRecord;
  file: File;
}>;

type ImportedWorkspaceResult = Readonly<{
  objectIds: string[];
  parseTargets: Array<{ objectId: string; file: File }>;
}>;

export async function executeWorkspaceImport(
  request: WorkspaceImportRequest,
  ports: WorkspaceImportExecutionPorts
): Promise<void> {
  const session = ports.getCurrentSession();
  assertExecutionSession(session, ports);

  const successfulAssets: AssetRecord[] = [];
  const successfulAssetFiles: SuccessfulAssetFile[] = [];
  const failureReasons: string[] = [];

  for (const file of request.files ?? []) {
    ports.assertCurrentSession(session);
    const sourceType: AssetSourceType = file.type.startsWith("image/")
      ? "originalImage"
      : "originalFile";
    const saved = await ports.saveAsset(file, sourceType);
    ports.assertCurrentSession(session);
    if (saved.status === "ok") {
      successfulAssets.push(saved.asset);
      successfulAssetFiles.push({ asset: saved.asset, file });
    } else {
      failureReasons.push(`${file.name}: ${saved.reason}`);
    }
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
              body: `有 ${failureReasons.length} 个资产没有导入成功：${failureReasons.join("；")}`,
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

  if (imported.objectIds.length > 0) {
    ports.selectObjects(session, imported.objectIds);
  }

  if (imported.parseTargets.length > 0) {
    await parseImportedDocuments(session, imported.parseTargets, ports);
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
        reason: error instanceof Error ? error.message : "文档解析失败。"
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
    ports.assertCurrentSession(session);
    if (saved.status === "failed") {
      ports.commitWorkspace(session, (current) => ({
        workspace: markFileObjectParseFailed(current, {
          fileObjectId: target.objectId,
          reason: saved.reason
        }),
        value: undefined
      }));
      continue;
    }

    ports.commitWorkspace(session, (current) => ({
      workspace: attachDocumentExtractToFileObject(current, {
        fileObjectId: target.objectId,
        extractAsset: saved.asset,
        extractedCharCount: parsed.text.length,
        extractedPageCount: parsed.pageCount
      }),
      value: undefined
    }));
  }
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
