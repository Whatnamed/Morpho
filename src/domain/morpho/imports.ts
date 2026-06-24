import type {
  AssetRecord,
  CanvasPoint,
  FileObject,
  ImageCollectionObject,
  ImageObject,
  LinkObject,
  MorphoObject,
  MorphoObjectId,
  MorphoWorkspace,
  TextObject
} from "./types";

type ImportResult = {
  workspace: MorphoWorkspace;
  objectIds: MorphoObjectId[];
};

export function importTextObject(
  workspace: MorphoWorkspace,
  input: {
    text: string;
    position: CanvasPoint;
  }
): ImportResult {
  const body = input.text.trim();
  if (!body) {
    return { workspace, objectIds: [] };
  }

  const objectId = nextObjectId(workspace, "text-import");
  const object: TextObject = {
    id: objectId,
    type: "text",
    title: body.length > 28 ? `${body.slice(0, 28)}...` : body,
    summary: body,
    body,
    createdBy: "user",
    visibility: "active"
  };

  return addObjectsToCanvas(workspace, [object], input.position);
}

export function importUrlObject(
  workspace: MorphoWorkspace,
  input: {
    url: string;
    title?: string;
    position: CanvasPoint;
  }
): ImportResult {
  const parsed = parseUrl(input.url);
  if (!parsed) {
    return { workspace, objectIds: [] };
  }

  const assetId = nextAssetId(workspace, "asset-link");
  const objectId = nextObjectId(workspace, "link-import");
  const asset: AssetRecord = {
    id: assetId,
    fileName: input.title ?? parsed.hostname,
    mimeType: "text/uri-list",
    size: parsed.href.length,
    createdAt: new Date().toISOString(),
    storageKey: `link:${assetId}`,
    sourceType: "originalLink",
    url: parsed.href,
    domain: parsed.hostname
  };
  const object: LinkObject = {
    id: objectId,
    type: "link",
    title: input.title ?? parsed.hostname,
    summary: parsed.href,
    url: parsed.href,
    domain: parsed.hostname,
    editableTitle: input.title,
    assetId,
    createdBy: "user",
    visibility: "active"
  };

  return {
    ...addObjectsToCanvas(
      {
        ...workspace,
        assets: {
          ...workspace.assets,
          [assetId]: asset
        }
      },
      [object],
      input.position
    )
  };
}

export function importAssetBackedObjects(
  workspace: MorphoWorkspace,
  input: {
    assets: AssetRecord[];
    position: CanvasPoint;
  }
): ImportResult {
  const imageAssets = input.assets.filter((asset) => asset.sourceType === "originalImage" || asset.sourceType === "aiGeneratedImage");
  const importedObjects = input.assets.map((asset, index) => createObjectForAsset(workspace, asset, index));
  const workspaceWithAssets = {
    ...workspace,
    assets: {
      ...workspace.assets,
      ...Object.fromEntries(input.assets.map((asset) => [asset.id, asset]))
    }
  };
  const placed = addObjectsToCanvas(workspaceWithAssets, importedObjects, input.position);

  if (imageAssets.length <= 1) {
    return placed;
  }

  const imageObjectIds = importedObjects
    .filter((object) => object.type === "image")
    .map((object) => object.id);
  const collectionId = nextObjectId(placed.workspace, "image-collection");
  const collection: ImageCollectionObject = {
    id: collectionId,
    type: "imageCollection",
    title: `图片合集 · ${imageObjectIds.length} 张`,
    summary: "批量导入形成的初始展开合集；成员仍是独立对象。",
    memberObjectIds: imageObjectIds,
    expanded: true,
    createdBy: "user",
    visibility: "active"
  };

  return addObjectsToCanvas(placed.workspace, [collection], {
    x: input.position.x,
    y: input.position.y - 96
  });
}

function createObjectForAsset(workspace: MorphoWorkspace, asset: AssetRecord, index: number): MorphoObject {
  const isImage = asset.sourceType === "originalImage" || asset.sourceType === "aiGeneratedImage";
  const objectId = nextObjectId(workspace, isImage ? `image-${asset.id}` : `file-${asset.id}`);

  if (isImage) {
    return {
      id: objectId,
      type: "image",
      title: asset.fileName,
      summary: asset.sourceType === "aiGeneratedImage" ? "AI 生成图片，已保存为本地资产。" : "用户导入的原始图片。",
      createdBy: asset.sourceType === "aiGeneratedImage" ? "ai" : "user",
      visibility: "active",
      role: asset.sourceType === "aiGeneratedImage" ? "preview" : "reference",
      imageVariant: "path",
      assetId: asset.id
    } satisfies ImageObject;
  }

  return {
    id: objectId,
    type: "file",
    title: asset.fileName,
    summary: `${asset.mimeType || "未知类型"} · ${formatSize(asset.size)} · 尚未解析`,
    createdBy: "user",
    visibility: "active",
    fileKind: fileKindFromMime(asset.mimeType),
    sourceLabel: "用户导入",
    assetId: asset.id,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    size: asset.size,
    parseStatus: "unparsed"
  } satisfies FileObject;
}

function addObjectsToCanvas(workspace: MorphoWorkspace, objects: MorphoObject[], position: CanvasPoint): ImportResult {
  const nextObjects = { ...workspace.objects };
  const nextInstances = [...workspace.canvas.instances];
  const objectIds: MorphoObjectId[] = [];

  objects.forEach((object, index) => {
    nextObjects[object.id] = object;
    objectIds.push(object.id);
    nextInstances.push({
      id: nextCanvasInstanceId(workspace, object.id),
      objectId: object.id,
      position: {
        x: position.x + (index % 3) * 280,
        y: position.y + Math.floor(index / 3) * 230
      },
      size: defaultSizeForObject(object)
    });
  });

  return {
    workspace: {
      ...workspace,
      objects: nextObjects,
      canvas: {
        ...workspace.canvas,
        instances: nextInstances
      },
      ui: {
        ...workspace.ui,
        lastSelectionIds: objectIds
      }
    },
    objectIds
  };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

function defaultSizeForObject(object: MorphoObject) {
  if (object.type === "image") {
    return { w: 245, h: 178 };
  }

  if (object.type === "imageCollection") {
    return { w: 290, h: 88 };
  }

  return { w: 250, h: 140 };
}

function fileKindFromMime(mimeType: string): FileObject["fileKind"] {
  if (mimeType === "application/pdf") {
    return "pdf";
  }

  return mimeType.startsWith("image/") ? "imageSet" : "document";
}

function nextAssetId(workspace: MorphoWorkspace, prefix: string): string {
  return nextAvailableId(workspace.assets, prefix);
}

function nextObjectId(workspace: MorphoWorkspace, prefix: string): string {
  return nextAvailableId(workspace.objects, prefix);
}

function nextCanvasInstanceId(workspace: MorphoWorkspace, objectId: string): string {
  return nextAvailableId(
    Object.fromEntries(workspace.canvas.instances.map((instance) => [instance.id, instance])),
    `canvas-${objectId}`
  );
}

function nextAvailableId(record: Record<string, unknown>, preferredId: string): string {
  if (!record[preferredId]) {
    return preferredId;
  }

  let suffix = 2;
  while (record[`${preferredId}-${suffix}`]) {
    suffix += 1;
  }

  return `${preferredId}-${suffix}`;
}

function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 102.4) / 10} KB`;
  }

  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
}
