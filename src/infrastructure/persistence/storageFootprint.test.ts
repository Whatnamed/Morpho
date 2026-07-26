import { describe, expect, it } from "vitest";

import { createBlankWorkspace, createCurrentCaseStudyWorkspace } from "@/domain/morpho/workspace";
import {
  diffFootprints,
  localStorageEntryBytes,
  measureStorageUsage,
  measureWorkspaceFootprint,
  utf8ByteLength
} from "./storageFootprint";
import { getProjectWorkspaceStorageKey } from "./localProjectStore";
import { createMemoryStorage } from "./memoryStorage";

describe("localStorageEntryBytes", () => {
  it("charges key and value together in UTF-16 code units", () => {
    expect(localStorageEntryBytes("ab", "cd")).toBe(8);
  });

  it("charges Chinese text at two bytes per character, not three", () => {
    // The distinction matters: Morpho stores mostly Chinese, so UTF-8 sizing
    // would overstate quota pressure by 50%.
    expect(utf8ByteLength("方向")).toBe(6);
    expect(localStorageEntryBytes("", "方向")).toBe(4);
  });

  it("charges astral characters per UTF-16 surrogate pair", () => {
    expect(localStorageEntryBytes("", "🙂")).toBe(4);
  });
});

describe("measureWorkspaceFootprint", () => {
  const workspace = createBlankWorkspace("project-footprint-test");
  const footprint = measureWorkspaceFootprint(workspace);

  it("reports the real storage key and its quota cost", () => {
    const storageKey = getProjectWorkspaceStorageKey("project-footprint-test");
    expect(footprint.storageKey).toBe(storageKey);
    expect(footprint.quotaBytes).toBe((storageKey.length + footprint.utf16Length) * 2);
  });

  it("partitions the serialized workspace with only structural overhead unattributed", () => {
    const attributed = footprint.segments.reduce((sum, segment) => sum + segment.utf16Length, 0);
    expect(attributed + footprint.structuralOverheadUtf16).toBe(footprint.utf16Length);
    expect(footprint.structuralOverheadUtf16).toBeGreaterThanOrEqual(0);
    expect(footprint.structuralOverheadUtf16).toBeLessThan(footprint.utf16Length);
  });

  it("keeps hot fields out of the partition so they are not double counted", () => {
    const segmentPaths = footprint.segments.map((segment) => segment.path);
    for (const hotField of footprint.hotFields) {
      expect(segmentPaths).not.toContain(hotField.path);
      expect(hotField.path).toContain("[]");
    }
  });

  it("splits objects by type and keeps the per-type counts", () => {
    const caseStudy = createCurrentCaseStudyWorkspace();
    const measured = measureWorkspaceFootprint(caseStudy);

    const expectedCounts = new Map<string, number>();
    for (const object of Object.values(caseStudy.objects)) {
      expectedCounts.set(object.type, (expectedCounts.get(object.type) ?? 0) + 1);
    }
    expect(expectedCounts.size).toBeGreaterThan(1);

    for (const [type, count] of expectedCounts) {
      const segment = measured.segments.find((entry) => entry.path === `objects.${type}`);
      expect(segment?.count).toBe(count);
      expect(segment?.utf16Length).toBeGreaterThan(0);
    }
  });
});

describe("diffFootprints", () => {
  it("reports per-unit growth for segments that moved", () => {
    const before = createBlankWorkspace("project-footprint-diff");
    const after = createBlankWorkspace("project-footprint-diff");
    after.ai.messages = Array.from({ length: 10 }, (_, index) => ({
      id: `message-${index}`,
      role: "user" as const,
      body: "重复的一段中文内容用于测量增长",
      createdAt: "2026-07-01T00:00:00.000Z"
    }));

    const deltas = diffFootprints(measureWorkspaceFootprint(before), measureWorkspaceFootprint(after), 10);
    const messages = deltas.find((delta) => delta.path === "ai.messages");
    expect(messages).toBeDefined();
    expect(messages?.utf16PerUnit).toBeGreaterThan(0);
    expect(messages?.utf16Delta).toBe((messages?.utf16PerUnit ?? 0) * 10);
    expect(deltas.every((delta) => delta.utf16Delta !== 0)).toBe(true);
  });

  it("returns nothing when the two footprints are identical", () => {
    const footprint = measureWorkspaceFootprint(createBlankWorkspace("project-footprint-same"));
    expect(diffFootprints(footprint, footprint, 1)).toEqual([]);
  });
});

describe("measureStorageUsage", () => {
  it("sums every entry in the origin, not just Morpho keys", () => {
    const storage = createMemoryStorage();
    storage.setItem("morpho.project.a.workspace.v1", "12345");
    storage.setItem("other", "67");

    const usage = measureStorageUsage(storage);
    expect(usage.entryCount).toBe(2);
    expect(usage.quotaBytes).toBe(
      localStorageEntryBytes("morpho.project.a.workspace.v1", "12345") + localStorageEntryBytes("other", "67")
    );
  });

  it("orders entries by quota cost so the largest offender is first", () => {
    const storage = createMemoryStorage();
    storage.setItem("small", "a");
    storage.setItem("large", "a".repeat(500));

    const usage = measureStorageUsage(storage);
    expect(usage.entries[0]?.key).toBe("large");
  });

  it("skips entries the storage refuses to read instead of throwing", () => {
    const storage = createMemoryStorage();
    storage.setItem("readable", "value");
    storage.setItem("unreadable", "value");
    const guarded: Storage = {
      ...storage,
      get length() {
        return storage.length;
      },
      key: (index: number) => storage.key(index),
      getItem: (key: string) => {
        if (key === "unreadable") {
          throw new DOMException("blocked", "SecurityError");
        }
        return storage.getItem(key);
      },
      setItem: storage.setItem.bind(storage),
      removeItem: storage.removeItem.bind(storage),
      clear: storage.clear.bind(storage)
    };

    const usage = measureStorageUsage(guarded);
    expect(usage.entryCount).toBe(1);
    expect(usage.entries[0]?.key).toBe("readable");
  });
});
