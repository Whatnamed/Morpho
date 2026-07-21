import type {
  ProviderContextFrame,
  ProviderContextFrameKind
} from "./types";

export type ProviderContextFrameInput = Omit<
  ProviderContextFrame,
  "id" | "contentHash" | "contextVisibility"
> & {
  projectId: string;
};

export function createProviderContextFrame(input: ProviderContextFrameInput): ProviderContextFrame {
  const canonical = canonicalFrameContent(input);
  const contentHash = stableHash(stableJson(canonical));
  const frameId = `provider-frame-${input.kind}-${stableHash(
    stableJson({ projectId: input.projectId, canonical, anchorMessageId: input.anchorMessageId })
  )}`;

  return {
    id: frameId,
    kind: input.kind,
    createdAt: input.createdAt,
    promptContractVersion: input.promptContractVersion,
    ...(input.taskStrategy ? { taskStrategy: input.taskStrategy } : {}),
    projectMemoryRevisionIds: [...input.projectMemoryRevisionIds],
    stageRecordRevisionIds: [...input.stageRecordRevisionIds],
    ...(input.designDefinitionRevisionId ? { designDefinitionRevisionId: input.designDefinitionRevisionId } : {}),
    directionRevisionIds: [...input.directionRevisionIds],
    ...(input.defaultReferenceObjectId ? { defaultReferenceObjectId: input.defaultReferenceObjectId } : {}),
    selectedObjectIds: [...input.selectedObjectIds],
    relatedObjectIds: [...input.relatedObjectIds],
    renderedText: input.renderedText,
    contentHash,
    ...(input.supersedesFrameId ? { supersedesFrameId: input.supersedesFrameId } : {}),
    contextVisibility: "providerOnly",
    sourceRefs: input.sourceRefs.map((source) => ({ ...source })),
    reason: input.reason,
    ...(input.anchorMessageId ? { anchorMessageId: input.anchorMessageId } : {})
  };
}

export function appendProviderContextFrame(
  frames: readonly ProviderContextFrame[],
  frame: ProviderContextFrame
): ProviderContextFrame[] {
  const latest = [...frames].reverse().find((candidate) => candidate.kind === frame.kind);
  if (
    latest &&
    (frame.kind === "projectState" || frame.kind === "runtimeConfiguration") &&
    latest.contentHash === frame.contentHash
  ) {
    return [...frames];
  }
  return [...frames, frame];
}

export function appendProviderContextFrames(
  frames: readonly ProviderContextFrame[],
  additions: readonly ProviderContextFrame[]
): ProviderContextFrame[] {
  return additions.reduce((current, frame) => appendProviderContextFrame(current, frame), [...frames]);
}

export function providerContextFrameMessage(frame: ProviderContextFrame): {
  role: "system";
  content: [{ type: "input_text"; text: string }];
} {
  const label = frame.kind === "projectState"
    ? "Project State Frame"
    : frame.kind === "turnContext"
      ? "Turn Context Frame"
      : frame.kind === "runtimeConfiguration"
        ? "Runtime Configuration Frame"
        : "Conversation Summary Frame";
  return {
    role: "system",
    content: [
      {
        type: "input_text",
        text: `[Morpho ${label} | historical snapshot]\n${frame.renderedText}\n旧 Frame 是历史快照；当前事实以最后一个适用 Frame 和真实结构化项目状态为准。`
      }
    ]
  };
}

export function buildProviderContextFrameTimeline(input: {
  frames: readonly ProviderContextFrame[];
  activeMessageIds: ReadonlySet<string>;
  summaryCoveredMessageIds?: ReadonlySet<string>;
}): ProviderContextFrame[] {
  const covered = input.summaryCoveredMessageIds ?? new Set<string>();
  const latestByKind = new Map<ProviderContextFrameKind, ProviderContextFrame>();
  for (const frame of input.frames) {
    if (frame.kind === "projectState" || frame.kind === "runtimeConfiguration") {
      latestByKind.set(frame.kind, frame);
    }
  }

  return input.frames.filter((frame) => {
    if (!frame.anchorMessageId) {
      return true;
    }
    if (input.activeMessageIds.has(frame.anchorMessageId)) {
      return true;
    }
    if (frame.kind === "projectState" || frame.kind === "runtimeConfiguration") {
      return latestByKind.get(frame.kind)?.id === frame.id && !covered.has(frame.anchorMessageId);
    }
    return false;
  });
}

function canonicalFrameContent(input: ProviderContextFrameInput): Record<string, unknown> {
  return {
    kind: input.kind,
    promptContractVersion: input.promptContractVersion,
    taskStrategy: input.taskStrategy,
    projectMemoryRevisionIds: [...input.projectMemoryRevisionIds].sort(),
    stageRecordRevisionIds: [...input.stageRecordRevisionIds].sort(),
    designDefinitionRevisionId: input.designDefinitionRevisionId,
    directionRevisionIds: [...input.directionRevisionIds].sort(),
    defaultReferenceObjectId: input.defaultReferenceObjectId,
    selectedObjectIds: [...input.selectedObjectIds].sort(),
    relatedObjectIds: [...input.relatedObjectIds].sort(),
    renderedText: input.renderedText,
    sourceRefs: [...input.sourceRefs]
      .map((source) => ({ kind: source.kind, id: source.id, title: source.title }))
      .sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)),
    reason: input.reason
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
