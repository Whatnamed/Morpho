import type {
  AssetRecord,
  DeliveryReference,
  DeliveryReferenceId,
  KeyConclusionCategory,
  MorphoObject,
  MorphoObjectId,
  MorphoWorkspace
} from "./types";

/**
 * A search row shows a bounded snippet, not the whole matching corpus. Document
 * fragment bodies alone can reach 6,000 characters.
 */
const SEARCH_SUMMARY_MAX_CHARS = 160;

export type WorkspaceSearchObjectSource = {
  fileObjectId: MorphoObjectId;
  fileTitle: string;
  fileName?: string;
  status: "active" | "hidden" | "missing";
};

export type WorkspaceSearchResult =
  | {
      kind: "object";
      objectId: MorphoObjectId;
      title: string;
      summary: string;
      category?: KeyConclusionCategory;
      hidden: boolean;
      source?: WorkspaceSearchObjectSource;
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
    .map((object): WorkspaceSearchResult => {
      const source = resolveObjectSearchSource(workspace, object);
      return {
        kind: "object",
        objectId: object.id,
        title: object.title,
        summary: buildResultSummary(getSearchableObjectText(object), normalizedQuery),
        ...(object.type === "keyConclusion" ? { category: object.category } : {}),
        hidden: object.visibility === "hidden",
        ...(source ? { source } : {})
      };
    });
  const deliveryReferenceResults = Object.values(workspace.deliveryReferences)
    .filter((reference) => matchesDeliveryReference(reference, normalizedQuery))
    .map((reference): WorkspaceSearchResult => ({
      kind: "deliveryReference",
      referenceId: reference.id,
      title: reference.snapshot.title,
      summary: reference.editorial?.caption ?? reference.snapshot.summary ?? "交付引用快照",
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
    reference.editorial?.caption ?? "",
    reference.snapshot.sourceType
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

/**
 * A fragment keeps a snapshot of its source file so the row can name the source
 * document even after that file is hidden or removed. Locating the source is a
 * separate decision the UI makes from `status`.
 */
function resolveObjectSearchSource(
  workspace: MorphoWorkspace,
  object: MorphoObject
): WorkspaceSearchObjectSource | undefined {
  if (object.type !== "documentFragment") {
    return undefined;
  }

  const sourceFile = workspace.objects[object.source.fileObjectId];
  const status: WorkspaceSearchObjectSource["status"] =
    !sourceFile || sourceFile.type !== "file"
      ? "missing"
      : sourceFile.visibility === "hidden"
        ? "hidden"
        : "active";

  return {
    fileObjectId: object.source.fileObjectId,
    fileTitle: object.source.fileTitle,
    ...(object.source.fileName ? { fileName: object.source.fileName } : {}),
    status
  };
}

/**
 * Windows the snippet around the first match so a long body still shows why the
 * row matched instead of only its opening characters.
 */
function buildResultSummary(searchableText: string, normalizedQuery: string): string {
  const text = searchableText.replace(/\s+/g, " ").trim();
  if (text.length <= SEARCH_SUMMARY_MAX_CHARS) {
    return text;
  }

  const matchIndex = normalizedQuery ? text.toLowerCase().indexOf(normalizedQuery) : -1;
  if (matchIndex < 0) {
    return `${text.slice(0, SEARCH_SUMMARY_MAX_CHARS)}…`;
  }

  const start = Math.max(0, Math.min(matchIndex - 40, text.length - SEARCH_SUMMARY_MAX_CHARS));
  const end = start + SEARCH_SUMMARY_MAX_CHARS;
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function getSearchableObjectText(object: MorphoObject): string {
  switch (object.type) {
    case "image":
      return [object.title, object.summary].join(" ");
    case "file":
      return [object.title, object.summary, object.fileName ?? "", object.mimeType ?? "", object.sourceLabel].join(" ");
    case "text":
      return [object.title, object.summary, object.body].join(" ");
    case "link":
      return [object.title, object.summary, object.url, object.domain, object.editableTitle ?? "", object.description ?? ""].join(
        " "
      );
    case "imageCollection":
      return [object.title, object.summary].join(" ");
    case "research":
      return [
        object.title,
        object.summary,
        object.findings.join(" "),
        object.opportunities.join(" "),
        object.constraints.join(" "),
        object.openQuestions.join(" ")
      ].join(" ");
    case "documentFragment":
      return [
        object.title,
        object.summary,
        object.body,
        object.source.fileTitle,
        object.source.fileName ?? ""
      ].join(" ");
    case "keyConclusion":
      return [object.title, object.summary, object.body, object.category, keyConclusionCategorySearchLabel(object.category), object.note ?? ""].join(" ");
    case "designDefinition":
      return [object.title, object.summary, object.problem, object.principles.join(" "), object.avoid.join(" ")].join(" ");
    case "conceptDirection":
      return [object.title, object.summary, object.keywords.join(" ")].join(" ");
    case "delivery":
      return [object.title, object.summary, object.gaps.map((gap) => gap.label).join(" ")].join(" ");
    default:
      return object.title;
  }
}

function keyConclusionCategorySearchLabel(category: KeyConclusionCategory): string {
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
