import type { MorphoWorkspace } from "@/domain/morpho/types";
import { serializeWorkspace } from "@/domain/morpho/workspace";
import { getProjectWorkspaceStorageKey } from "./localProjectStore";

/**
 * Storage accounting for the local project store.
 *
 * Two units matter and they are not interchangeable:
 *
 * - UTF-8 bytes is what the value costs on a wire or on disk.
 * - UTF-16 code units is what browsers charge against the localStorage quota.
 *   Chrome and Firefox both bill an entry as `(key.length + value.length) * 2`.
 *
 * Morpho's stored text is mostly Chinese, where the two diverge by 1.5x
 * (3 UTF-8 bytes vs 2 quota bytes per character). Reporting only UTF-8 would
 * overstate quota pressure by half, so every quota decision uses `quotaBytes`.
 */

const textEncoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).length;
}

/** Quota cost of one localStorage entry, in the unit browsers actually charge. */
export function localStorageEntryBytes(key: string, value: string): number {
  return (key.length + value.length) * 2;
}

export type FootprintSegment = {
  path: string;
  utf16Length: number;
  utf8Bytes: number;
  /** Share of the serialized workspace, by UTF-16 length. */
  share: number;
  /** Number of records the segment covers, when the segment is a collection. */
  count?: number;
};

export type WorkspaceFootprint = {
  storageKey: string;
  utf16Length: number;
  utf8Bytes: number;
  /** What this workspace costs against the browser localStorage quota. */
  quotaBytes: number;
  /** Exact partition of the serialized workspace by top-level key. */
  segments: FootprintSegment[];
  /**
   * Cross-cutting measurements of fields nested inside the segments above.
   * These overlap with `segments` and do not sum to the total.
   */
  hotFields: FootprintSegment[];
  /** JSON punctuation and top-level key names not attributed to any segment. */
  structuralOverheadUtf16: number;
};

export type FootprintDelta = {
  path: string;
  utf16Delta: number;
  /** UTF-16 units added per unit of scenario growth (per message, per object, ...). */
  utf16PerUnit: number;
};

function measure(path: string, value: unknown, total: number, count?: number): FootprintSegment {
  const serialized = value === undefined ? "" : JSON.stringify(value);
  return {
    path,
    utf16Length: serialized.length,
    utf8Bytes: utf8ByteLength(serialized),
    share: total === 0 ? 0 : serialized.length / total,
    count
  };
}

function recordCount(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (typeof value === "object" && value !== null) {
    return Object.keys(value).length;
  }
  return undefined;
}

function sumOf<T>(items: readonly T[], pick: (item: T) => unknown): { value: unknown[]; count: number } {
  const picked = items.map(pick).filter((entry) => entry !== undefined);
  return { value: picked, count: picked.length };
}

export function measureWorkspaceFootprint(workspace: MorphoWorkspace): WorkspaceFootprint {
  const serialized = serializeWorkspace(workspace);
  const total = serialized.length;
  const storageKey = getProjectWorkspaceStorageKey(workspace.project.id);

  const objectsByType = new Map<string, unknown[]>();
  for (const object of Object.values(workspace.objects)) {
    const bucket = objectsByType.get(object.type) ?? [];
    bucket.push(object);
    objectsByType.set(object.type, bucket);
  }

  const segments: FootprintSegment[] = [];
  for (const [key, value] of Object.entries(workspace) as Array<[keyof MorphoWorkspace, unknown]>) {
    if (key === "objects") {
      for (const [type, bucket] of [...objectsByType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        segments.push(measure(`objects.${type}`, bucket, total, bucket.length));
      }
      continue;
    }

    if (key === "ai" || key === "projectMemory" || key === "canvas") {
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        segments.push(measure(`${key}.${subKey}`, subValue, total, recordCount(subValue)));
      }
      continue;
    }

    segments.push(measure(key, value, total, recordCount(value)));
  }

  const messages = workspace.ai.messages;
  const frames = workspace.ai.providerContextFrames ?? [];
  const memoryRevisions = Object.values(workspace.projectMemory.revisions);
  const traces = sumOf(messages, (message) => message.agentTrace);
  const snapshots = sumOf(messages, (message) => message.providerInputSnapshot);
  const bodies = sumOf(messages, (message) => message.body);
  const renderedTexts = sumOf(frames, (frame) => frame.renderedText);
  const runtimeItems = sumOf(frames, (frame) => frame.runtimeItem);
  const memorySections = sumOf(memoryRevisions, (revision) => revision.sections);

  const hotFields: FootprintSegment[] = [
    measure("ai.messages[].body", bodies.value, total, bodies.count),
    measure("ai.messages[].agentTrace", traces.value, total, traces.count),
    measure("ai.messages[].providerInputSnapshot", snapshots.value, total, snapshots.count),
    measure("ai.providerContextFrames[].renderedText", renderedTexts.value, total, renderedTexts.count),
    measure("ai.providerContextFrames[].runtimeItem", runtimeItems.value, total, runtimeItems.count),
    measure("projectMemory.revisions[].sections", memorySections.value, total, memorySections.count)
  ];

  const attributed = segments.reduce((sum, segment) => sum + segment.utf16Length, 0);

  return {
    storageKey,
    utf16Length: total,
    utf8Bytes: utf8ByteLength(serialized),
    quotaBytes: localStorageEntryBytes(storageKey, serialized),
    segments,
    hotFields,
    structuralOverheadUtf16: total - attributed
  };
}

/**
 * Per-unit growth between two scenarios that differ by `units` records.
 * Only segments that actually moved are reported, largest first.
 */
export function diffFootprints(
  before: WorkspaceFootprint,
  after: WorkspaceFootprint,
  units: number
): FootprintDelta[] {
  const beforeByPath = new Map(before.segments.concat(before.hotFields).map((segment) => [segment.path, segment]));
  const deltas: FootprintDelta[] = [];

  for (const segment of after.segments.concat(after.hotFields)) {
    const previous = beforeByPath.get(segment.path)?.utf16Length ?? 0;
    const utf16Delta = segment.utf16Length - previous;
    if (utf16Delta === 0) {
      continue;
    }
    deltas.push({
      path: segment.path,
      utf16Delta,
      utf16PerUnit: units === 0 ? 0 : utf16Delta / units
    });
  }

  return deltas.sort((a, b) => Math.abs(b.utf16Delta) - Math.abs(a.utf16Delta));
}

export type StorageUsageEntry = {
  key: string;
  quotaBytes: number;
};

export type StorageUsage = {
  entryCount: number;
  quotaBytes: number;
  entries: StorageUsageEntry[];
};

/**
 * Total quota cost of everything the origin currently stores, not just Morpho.
 * A failing write is bounded by the whole origin, so the whole origin is measured.
 */
export function measureStorageUsage(storage: Storage): StorageUsage {
  const entries: StorageUsageEntry[] = [];
  let quotaBytes = 0;

  for (let index = 0; index < storage.length; index += 1) {
    let key: string | null = null;
    try {
      key = storage.key(index);
    } catch {
      continue;
    }
    if (key === null) {
      continue;
    }

    let value: string | null = null;
    try {
      value = storage.getItem(key);
    } catch {
      continue;
    }
    if (value === null) {
      continue;
    }

    const entryBytes = localStorageEntryBytes(key, value);
    quotaBytes += entryBytes;
    entries.push({ key, quotaBytes: entryBytes });
  }

  return {
    entryCount: entries.length,
    quotaBytes,
    entries: entries.sort((a, b) => b.quotaBytes - a.quotaBytes)
  };
}
