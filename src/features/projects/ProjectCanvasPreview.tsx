import { useMemo } from "react";

import type { AssetRecord, MorphoObjectType, MorphoWorkspace } from "@/domain/morpho/types";
import { getRenderableCanvasInstances } from "@/domain/morpho/workspace";

export type ProjectCanvasPreviewNode = {
  id: string;
  type: MorphoObjectType;
  assetId?: string;
  storageKey?: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ProjectPreviewStatus = "pending" | "ready" | "error";

export type ProjectPreviewSnapshot = {
  projectId: string;
  nodes: ProjectCanvasPreviewNode[];
  /** Keyed by `storageKey` so distinct binaries that happen to reuse `assetId` across projects never overwrite each other. */
  previewAssets: Record<string, AssetRecord>;
  activeObjectCount: number;
  activeImageCount: number;
  emptyVariant: "one" | "two" | "three";
};

type ProjectCanvasPreviewProps = {
  preview?: ProjectPreviewSnapshot;
  previewStatus?: ProjectPreviewStatus;
  workspace?: MorphoWorkspace;
  assetUrls?: Record<string, string>;
  storageKeyUrls?: Record<string, string>;
  className?: string;
};

const MAX_PREVIEW_NODES = 36;
const PREVIEW_PADDING = 7;

export function ProjectCanvasPreview({
  preview,
  previewStatus,
  workspace,
  assetUrls,
  storageKeyUrls,
  className
}: ProjectCanvasPreviewProps) {
  const resolvedPreview = useMemo(
    () => preview ?? (workspace ? extractProjectPreviewSnapshot(workspace) : undefined),
    [preview, workspace]
  );
  const status: ProjectPreviewStatus = previewStatus ?? (resolvedPreview ? "ready" : "pending");
  const nodes = status === "ready" ? (resolvedPreview?.nodes ?? []) : [];
  const isConfirmedEmpty = status === "ready" && nodes.length === 0;
  const emptyVariant = resolvedPreview?.emptyVariant ?? "one";
  const statusClass = isConfirmedEmpty
    ? `is-empty is-empty-${emptyVariant}`
    : status === "error"
      ? "is-unavailable"
      : status === "pending"
        ? "is-pending"
        : "";

  return (
    <div
      className={`project-canvas-preview ${className ?? ""} ${statusClass}`.trim()}
      data-preview-status={status}
      aria-hidden="true"
    >
      <div className="project-canvas-preview-grid" />
      {status === "ready"
        ? nodes.map((node) => {
            const assetUrl =
              (node.storageKey ? storageKeyUrls?.[node.storageKey] : undefined) ??
              (node.assetId ? assetUrls?.[node.assetId] : undefined);
            const style = {
              left: `${node.x}%`,
              top: `${node.y}%`,
              width: `${node.w}%`,
              height: `${node.h}%`
            };
            return (
              <span className={`project-preview-node project-preview-${node.type}`} key={node.id} style={style}>
                {node.type === "image" && assetUrl ? (
                  // Blob URLs are browser-local IndexedDB previews and cannot be optimized by next/image.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl} alt="" />
                ) : null}
              </span>
            );
          })
        : null}
      {isConfirmedEmpty ? <span className="project-preview-empty-mark" /> : null}
      {status === "error" ? <span className="project-preview-unavailable">预览暂不可用</span> : null}
    </div>
  );
}

function isImagePreviewAsset(asset: AssetRecord): boolean {
  return asset.sourceType === "originalImage" || asset.sourceType === "aiGeneratedImage";
}

export function getProjectCanvasPreviewNodes(workspace: MorphoWorkspace): ProjectCanvasPreviewNode[] {
  const instances = getRenderableCanvasInstances(workspace)
    .filter((instance) => workspace.objects[instance.objectId])
    .slice(0, MAX_PREVIEW_NODES);
  if (instances.length === 0) {
    return [];
  }

  const minX = Math.min(...instances.map((instance) => instance.position.x));
  const minY = Math.min(...instances.map((instance) => instance.position.y));
  const maxX = Math.max(...instances.map((instance) => instance.position.x + instance.size.w));
  const maxY = Math.max(...instances.map((instance) => instance.position.y + instance.size.h));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const usableWidth = 100 - PREVIEW_PADDING * 2;
  const usableHeight = 100 - PREVIEW_PADDING * 2;
  const scale = Math.min(usableWidth / contentWidth, usableHeight / contentHeight);
  const offsetX = PREVIEW_PADDING + (usableWidth - contentWidth * scale) / 2;
  const offsetY = PREVIEW_PADDING + (usableHeight - contentHeight * scale) / 2;

  return instances.map((instance) => {
    const object = workspace.objects[instance.objectId]!;
    const assetId = object.type === "image" ? object.assetId : undefined;
    const asset = assetId ? workspace.assets[assetId] : undefined;
    const imageAsset = asset && isImagePreviewAsset(asset) ? asset : undefined;
    return {
      id: instance.id,
      type: object.type,
      assetId,
      storageKey: imageAsset?.storageKey,
      x: offsetX + (instance.position.x - minX) * scale,
      y: offsetY + (instance.position.y - minY) * scale,
      w: Math.max(2.5, instance.size.w * scale),
      h: Math.max(2.5, instance.size.h * scale)
    };
  });
}

export function extractProjectPreviewSnapshot(workspace: MorphoWorkspace): ProjectPreviewSnapshot {
  const nodes = getProjectCanvasPreviewNodes(workspace);
  const previewAssets: Record<string, AssetRecord> = {};
  for (const node of nodes) {
    if (!node.assetId || !node.storageKey) continue;
    const asset = workspace.assets[node.assetId];
    if (asset && isImagePreviewAsset(asset) && !previewAssets[asset.storageKey]) {
      previewAssets[asset.storageKey] = asset;
    }
  }

  const activeObjects = Object.values(workspace.objects).filter((object) => object.visibility === "active");
  const activeImageCount = activeObjects.filter((object) => object.type === "image").length;

  return {
    projectId: workspace.project.id,
    nodes,
    previewAssets,
    activeObjectCount: activeObjects.length,
    activeImageCount,
    emptyVariant: getEmptyPreviewVariant(workspace.project.id)
  };
}

/**
 * Returns unique preview assets keyed by `storageKey` so restored/duplicated projects
 * sharing an `assetId` but pointing at distinct binaries remain isolated.
 */
export function getProjectPreviewAssets(workspaces: Record<string, MorphoWorkspace>): Record<string, AssetRecord> {
  const assets: Record<string, AssetRecord> = {};
  for (const workspace of Object.values(workspaces)) {
    const snapshot = extractProjectPreviewSnapshot(workspace);
    for (const [storageKey, asset] of Object.entries(snapshot.previewAssets)) {
      if (!assets[storageKey]) {
        assets[storageKey] = asset;
      }
    }
  }
  return assets;
}

function getEmptyPreviewVariant(projectId: string): "one" | "two" | "three" {
  let value = 0;
  for (const character of projectId) {
    value = (value * 31 + character.charCodeAt(0)) % 3;
  }
  return ["one", "two", "three"][value] as "one" | "two" | "three";
}
