import type { CanvasPoint, CanvasSize, MorphoObjectId, MorphoWorkspace, ResearchObject } from "@/domain/morpho/types";
import { getResearchItemParts, normalizeResearchItem } from "@/domain/operations/researchItems";
import { buildKeyConclusionDraftFromResearchSource, createKeyConclusion, hideObject, restoreObject } from "@/domain/morpho/workspace";
import type { ProviderCitation } from "@/server/ai/types";
import type { CreateResearchAnalysisArgs } from "./morphoAgent";

export type ResearchExtractionKind = "finding" | "opportunity" | "constraint" | "openQuestion";

export type ResearchExtractionItem = {
  key: string;
  kind: ResearchExtractionKind;
  index: number;
  label: string;
  text: string;
  activeObjectId?: MorphoObjectId;
  hiddenObjectId?: MorphoObjectId;
};

export type ApplyResearchExtractionSelectionResult = {
  workspace: MorphoWorkspace;
  activeObjectIds: MorphoObjectId[];
  createdCount: number;
  restoredCount: number;
  hiddenCount: number;
  skippedCount: number;
};

export function constrainResearchEvidence(
  args: CreateResearchAnalysisArgs,
  sourceObjectIds: string[],
  citations: ProviderCitation[]
): CreateResearchAnalysisArgs["evidence"] {
  const allowedObjectIds = new Set(sourceObjectIds);
  const allowedCitationUrls = new Set(
    citations.map((citation) => citation.url).filter((url): url is string => Boolean(url))
  );

  return args.evidence.map((entry) => ({
    ...entry,
    sourceObjectIds: entry.sourceObjectIds.filter((objectId) => allowedObjectIds.has(objectId)),
    citationUrls: entry.citationUrls.filter((url) => allowedCitationUrls.has(url))
  }));
}

const researchSectionConfigs: Array<{
  kind: ResearchExtractionKind;
  label: string;
  items: (research: ResearchObject) => string[];
}> = [
  { kind: "finding", label: "发现", items: (research) => research.findings },
  { kind: "opportunity", label: "设计机会", items: (research) => research.opportunities },
  { kind: "constraint", label: "现实约束", items: (research) => research.constraints },
  { kind: "openQuestion", label: "待验证", items: (research) => research.openQuestions }
];

export function getResearchExtractionItems(workspace: MorphoWorkspace, researchId: MorphoObjectId): ResearchExtractionItem[] {
  const research = workspace.objects[researchId];
  if (!research || research.type !== "research") {
    return [];
  }

  return researchSectionConfigs.flatMap((section) =>
    section.items(research).flatMap((rawText, index) => {
      const text = normalizeResearchItem(rawText);
      if (!text) {
        return [];
      }
      const linkedObjects = findLinkedKeyConclusions(workspace, research, section.kind, index);
      const activeObjectId = linkedObjects.find((object) => object.visibility === "active")?.id;
      const hiddenObjectId = linkedObjects.find((object) => object.visibility === "hidden")?.id;

      return [{
        key: getResearchExtractionKey(section.kind, index),
        kind: section.kind,
        index,
        label: section.label,
        text,
        activeObjectId,
        hiddenObjectId
      }];
    })
  );
}

export function getResearchExtractionKey(kind: ResearchExtractionKind, index: number): string {
  return `${kind}:${index}`;
}

export function getResearchExtractionRecommendationKeys(workspace: MorphoWorkspace, researchId: MorphoObjectId): string[] {
  const items = getResearchExtractionItems(workspace, researchId);
  const grouped = new Map<ResearchExtractionKind, ResearchExtractionItem[]>();
  for (const item of items) {
    const sectionItems = grouped.get(item.kind) ?? [];
    sectionItems.push(item);
    grouped.set(item.kind, sectionItems);
  }

  const selectedKeys: string[] = [];
  const sectionOrder: ResearchExtractionKind[] = ["finding", "opportunity", "constraint", "openQuestion"];
  const maxKeys = 6;

  for (const kind of sectionOrder) {
    const first = grouped.get(kind)?.[0];
    if (first) {
      selectedKeys.push(first.key);
    }
  }

  for (let index = 1; selectedKeys.length < maxKeys; index += 1) {
    let addedInRound = false;
    for (const kind of sectionOrder) {
      const item = grouped.get(kind)?.[index];
      if (!item) {
        continue;
      }
      selectedKeys.push(item.key);
      addedInRound = true;
      if (selectedKeys.length >= maxKeys) {
        break;
      }
    }
    if (!addedInRound) {
      break;
    }
  }

  return selectedKeys;
}

export function applyResearchExtractionSelection(
  workspace: MorphoWorkspace,
  researchId: MorphoObjectId,
  selectedKeys: Iterable<string>
): ApplyResearchExtractionSelectionResult {
  const desiredKeys = new Set(selectedKeys);
  const items = getResearchExtractionItems(workspace, researchId);
  let nextWorkspace = workspace;
  let createdCount = 0;
  let restoredCount = 0;
  let hiddenCount = 0;
  let skippedCount = 0;

  for (const item of items) {
    const wantsActive = desiredKeys.has(item.key);

    if (wantsActive && item.activeObjectId) {
      continue;
    }

    if (wantsActive && item.hiddenObjectId) {
      nextWorkspace = restoreObject(nextWorkspace, item.hiddenObjectId);
      restoredCount += 1;
      continue;
    }

    if (wantsActive) {
      const cardSize = getResearchExtractionCardSize(item.text);
      const draft = buildKeyConclusionDraftFromResearchSource(nextWorkspace, researchId, {
        kind: item.kind,
        index: item.index
      });

      if (draft.status !== "ready") {
        skippedCount += 1;
        continue;
      }

      const created = createKeyConclusion(nextWorkspace, {
        title: item.text,
        body: item.text,
        summary: item.text,
        sourceObjectIds: draft.draft.sourceObjectIds,
        citationIds: draft.draft.citationIds,
        confidence: draft.draft.confidence,
        state: draft.draft.state,
        note: draft.draft.note,
        position: getResearchExtractionPosition(nextWorkspace, researchId),
        size: cardSize
      });
      nextWorkspace = created.workspace;
      createdCount += 1;
      continue;
    }

    if (!wantsActive && item.activeObjectId) {
      nextWorkspace = hideObject(nextWorkspace, item.activeObjectId);
      hiddenCount += 1;
    }
  }

  const activeObjectIds = getResearchExtractionItems(nextWorkspace, researchId)
    .filter((item) => desiredKeys.has(item.key) && item.activeObjectId)
    .map((item) => item.activeObjectId)
    .filter((objectId): objectId is MorphoObjectId => Boolean(objectId));

  return {
    workspace: nextWorkspace,
    activeObjectIds,
    createdCount,
    restoredCount,
    hiddenCount,
    skippedCount
  };
}

function findLinkedKeyConclusions(
  workspace: MorphoWorkspace,
  research: ResearchObject,
  kind: ResearchExtractionKind,
  index: number
) {
  const noteMarker = `${formatResearchSourceKind(kind)}第 ${index + 1}条`;

  return Object.values(workspace.objects).filter(
    (object) =>
      object.type === "keyConclusion" &&
      object.sourceObjectIds.includes(research.id) &&
      (object.note?.includes(noteMarker) ?? false)
  );
}

function formatResearchSourceKind(kind: ResearchExtractionKind): string {
  switch (kind) {
    case "finding":
      return "发现";
    case "opportunity":
      return "机会点";
    case "constraint":
      return "约束";
    case "openQuestion":
      return "待验证问题";
  }
}

export function getResearchExtractionCardSize(text: string): CanvasSize {
  const width = 320;
  const contentWidth = width - 42;
  const parts = getResearchItemParts(text);
  const titleLineCount = estimateLineCount(parts.title, Math.max(12, Math.floor(contentWidth / 12)));
  const detailLineCount = parts.detail ? estimateLineCount(parts.detail, Math.max(14, Math.floor(contentWidth / 11))) : 0;
  const height = 16 + 12 + 9 + titleLineCount * 18 + (parts.detail ? 5 + detailLineCount * 17 : 0) + 16;

  return {
    w: width,
    h: Math.min(156, Math.max(108, Math.ceil(height)))
  };
}

function getResearchExtractionPosition(workspace: MorphoWorkspace, researchId: MorphoObjectId): CanvasPoint {
  const sourceInstance = workspace.canvas.instances.find((instance) => instance.objectId === researchId);
  if (!sourceInstance) {
    return { x: 120, y: 120 };
  }

  const existingLinkedInstances = workspace.canvas.instances.filter((instance) => {
    const object = workspace.objects[instance.objectId];
    return object?.type === "keyConclusion" && object.visibility === "active" && object.sourceObjectIds.includes(researchId);
  });
  const index = existingLinkedInstances.length;
  const column = index % 2;
  const columnX = sourceInstance.position.x + sourceInstance.size.w + 36 + column * 340;
  const columnBottom = existingLinkedInstances
    .filter((instance) => Math.abs(instance.position.x - columnX) < 8)
    .reduce((bottom, instance) => Math.max(bottom, instance.position.y + instance.size.h + 24), sourceInstance.position.y);

  return {
    x: columnX,
    y: columnBottom
  };
}

function estimateLineCount(text: string, charsPerLine: number): number {
  if (!text.trim()) {
    return 1;
  }

  return Math.max(
    1,
    text
      .split(/\r?\n/)
      .reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charsPerLine)), 0)
  );
}
