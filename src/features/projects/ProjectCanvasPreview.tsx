import { useMemo } from "react";

import type { AssetRecord, MorphoObjectType, MorphoWorkspace } from "@/domain/morpho/types";
import { getRenderableCanvasInstances } from "@/domain/morpho/workspace";

export type ProjectCanvasPreviewNode = {
  id: string;
  type: MorphoObjectType;
  assetId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type ProjectCanvasPreviewProps = {
  workspace?: MorphoWorkspace;
  assetUrls: Record<string, string>;
  className?: string;
};

const MAX_PREVIEW_NODES = 36;
const PREVIEW_PADDING = 7;

export function ProjectCanvasPreview({ workspace, assetUrls, className }: ProjectCanvasPreviewProps) {
  const nodes = useMemo(() => (workspace ? getProjectCanvasPreviewNodes(workspace) : []), [workspace]);
  const emptyVariant = workspace ? getEmptyPreviewVariant(workspace.project.id) : "one";

  return (
    <div className={`project-canvas-preview ${className ?? ""} ${nodes.length === 0 ? `is-empty is-empty-${emptyVariant}` : ""}`} aria-hidden="true">
      <div className="project-canvas-preview-grid" />
      {nodes.map((node) => {
        const assetUrl = node.assetId ? assetUrls[node.assetId] : undefined;
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
      })}
      {nodes.length === 0 ? <span className="project-preview-empty-mark" /> : null}
    </div>
  );
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
    return {
      id: instance.id,
      type: object.type,
      assetId: object.type === "image" ? object.assetId : undefined,
      x: offsetX + (instance.position.x - minX) * scale,
      y: offsetY + (instance.position.y - minY) * scale,
      w: Math.max(2.5, instance.size.w * scale),
      h: Math.max(2.5, instance.size.h * scale)
    };
  });
}

export function getProjectPreviewAssets(workspaces: Record<string, MorphoWorkspace>): Record<string, AssetRecord> {
  const assets: Record<string, AssetRecord> = {};
  for (const workspace of Object.values(workspaces)) {
    const previewAssetIds = new Set(
      getProjectCanvasPreviewNodes(workspace)
        .map((node) => node.assetId)
        .filter((assetId): assetId is string => Boolean(assetId))
    );
    for (const assetId of previewAssetIds) {
      const asset = workspace.assets[assetId];
      if (asset) {
        assets[assetId] = asset;
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
