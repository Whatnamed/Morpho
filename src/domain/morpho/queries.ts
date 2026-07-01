import type {
  AssetRecord,
  DeliveryReference,
  DeliveryReferenceId,
  MorphoObject,
  MorphoObjectId,
  MorphoWorkspace
} from "./types";

export type WorkspaceSearchResult =
  | {
      kind: "object";
      objectId: MorphoObjectId;
      title: string;
      summary: string;
      hidden: boolean;
    }
  | {
      kind: "deliveryReference";
      referenceId: DeliveryReferenceId;
      title: string;
      summary: string;
      hidden: false;
    };

export type WorkspaceAssetItem = {
  asset: AssetRecord;
  objects: MorphoObject[];
  usedInDeliveryReferenceIds: DeliveryReferenceId[];
};

export function searchWorkspace(workspace: MorphoWorkspace, query: string): WorkspaceSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  const objectResults = Object.values(workspace.objects)
    .filter((object) => matchesObject(object, normalizedQuery))
    .map((object): WorkspaceSearchResult => ({
      kind: "object",
      objectId: object.id,
      title: object.title,
      summary: getSearchableObjectText(object),
      hidden: object.visibility === "hidden"
    }));
  const deliveryReferenceResults = Object.values(workspace.deliveryReferences)
    .filter((reference) => matchesDeliveryReference(reference, normalizedQuery))
    .map((reference): WorkspaceSearchResult => ({
      kind: "deliveryReference",
      referenceId: reference.id,
      title: reference.snapshot.title,
      summary: reference.snapshot.caption ?? reference.snapshot.summary ?? "交付引用快照",
      hidden: false
    }));

  return [...objectResults, ...deliveryReferenceResults];
}

export function getWorkspaceAssetItems(workspace: MorphoWorkspace): WorkspaceAssetItem[] {
  return Object.values(workspace.assets).map((asset) => {
    const objects = Object.values(workspace.objects).filter(
      (object) => "assetId" in object && object.assetId === asset.id
    );
    const sourceObjectIds = new Set(objects.map((object) => object.id));
    const usedInDeliveryReferenceIds = Object.values(workspace.deliveryReferences)
      .filter((reference) => reference.sourceObjectId && sourceObjectIds.has(reference.sourceObjectId))
      .map((reference) => reference.id);

    return {
      asset,
      objects,
      usedInDeliveryReferenceIds
    };
  });
}

function matchesObject(object: MorphoObject, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true;
  }

  return getSearchableObjectText(object).toLowerCase().includes(normalizedQuery);
}

function matchesDeliveryReference(reference: DeliveryReference, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true;
  }

  return [
    reference.snapshot.title,
    reference.snapshot.summary ?? "",
    reference.snapshot.caption ?? "",
    reference.snapshot.sourceType
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function getSearchableObjectText(object: MorphoObject): string {
  switch (object.type) {
    case "image":
      return [object.title, object.summary, object.role, object.directionId ?? "", object.visualBranchId ?? ""].join(" ");
    case "file":
      return [object.title, object.summary, object.fileName ?? "", object.mimeType ?? "", object.sourceLabel].join(" ");
    case "text":
      return [object.title, object.summary, object.body].join(" ");
    case "link":
      return [object.title, object.summary, object.url, object.domain, object.editableTitle ?? "", object.description ?? ""].join(
        " "
      );
    case "imageCollection":
      return [object.title, object.summary, object.memberObjectIds.join(" ")].join(" ");
    case "research":
      return [
        object.title,
        object.summary,
        object.findings.join(" "),
        object.opportunities.join(" "),
        object.constraints.join(" "),
        object.openQuestions.join(" ")
      ].join(" ");
    case "keyConclusion":
      return [object.title, object.summary, object.body, object.state, object.note ?? ""].join(" ");
    case "designDefinition":
      return [object.title, object.summary, object.problem, object.principles.join(" "), object.avoid.join(" ")].join(" ");
    case "conceptDirection":
      return [object.title, object.summary, object.status, object.keywords.join(" ")].join(" ");
    case "delivery":
      return [object.title, object.summary, object.gaps.map((gap) => gap.label).join(" ")].join(" ");
    default:
      return object.title;
  }
}
