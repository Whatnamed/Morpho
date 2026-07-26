import { describe, expect, it } from "vitest";

import { createBlankWorkspace } from "@/domain/morpho/workspace";

import {
  createCatalog,
  describeStorageWriteFailure,
  getProjectWorkspaceStorageKey,
  persistProjectWorkspaceAndSummary,
  writeCatalog,
  writeProjectWorkspace,
  type StorageWriteFailureKind
} from "./localProjectStore";
import { createMemoryStorage } from "./memoryStorage";

/** A browser that refuses storage access outright, as in some locked-down webviews. */
function createBlockedStorage(name: string): Storage {
  const throwBlocked = () => {
    throw new DOMException("The operation is insecure.", name);
  };

  return {
    length: 0,
    clear: throwBlocked,
    getItem: () => null,
    key: () => null,
    removeItem: throwBlocked,
    setItem: throwBlocked
  };
}

describe("persistStorageValue failure classification", () => {
  it("separates a full origin from other write failures", () => {
    const storage = createMemoryStorage({ quotaBytes: 200 });

    const result = writeProjectWorkspace(storage, createBlankWorkspace("project-a"));

    expect(result).toEqual({
      status: "failed",
      kind: "quotaExceeded",
      reason: describeStorageWriteFailure("quotaExceeded")
    });
  });

  it("detects a write that was accepted and stored nothing", () => {
    // Safari private mode accepts setItem and keeps nothing. Nothing throws, so
    // only the read-back distinguishes it from a successful save.
    const storage = createMemoryStorage({ silentWrites: true });

    const result = writeProjectWorkspace(storage, createBlankWorkspace("project-a"));

    expect(result).toEqual({
      status: "failed",
      kind: "writeNotVerified",
      reason: describeStorageWriteFailure("writeNotVerified")
    });
  });

  it("reports a blocked storage API as unavailable rather than full", () => {
    for (const name of ["SecurityError", "InvalidAccessError", "InvalidStateError"]) {
      const result = writeProjectWorkspace(createBlockedStorage(name), createBlankWorkspace("project-a"));

      expect(result).toMatchObject({ status: "failed", kind: "storageUnavailable" });
    }
  });

  it("falls back to unknown instead of guessing a cause", () => {
    const storage = createMemoryStorage({ failSetKeys: [getProjectWorkspaceStorageKey("project-a")] });

    const result = writeProjectWorkspace(storage, createBlankWorkspace("project-a"));

    expect(result).toMatchObject({ status: "failed", kind: "unknown" });
  });

  it("classifies catalog writes the same way", () => {
    const storage = createMemoryStorage({ quotaBytes: 10 });

    expect(writeCatalog(storage, createCatalog([]))).toMatchObject({
      status: "failed",
      kind: "quotaExceeded"
    });
  });
});

describe("persistProjectWorkspaceAndSummary", () => {
  it("carries the cause and the stage that failed", () => {
    const storage = createMemoryStorage({ quotaBytes: 200 });

    const result = persistProjectWorkspaceAndSummary(storage, createBlankWorkspace("project-a"));

    expect(result).toMatchObject({
      status: "failed",
      stage: "workspace",
      kind: "quotaExceeded"
    });
  });

  it("reports a catalog-stage failure separately from the workspace write", () => {
    const storage = createMemoryStorage({ failSetKeys: ["morpho.projects.catalog.v1"] });

    const result = persistProjectWorkspaceAndSummary(storage, createBlankWorkspace("project-a"));

    expect(result).toMatchObject({ status: "failed", stage: "catalog" });
    // The workspace itself survived; only the project list is stale.
    expect(storage.getItem(getProjectWorkspaceStorageKey("project-a"))).toBeTruthy();
  });
});

describe("describeStorageWriteFailure", () => {
  const kinds: StorageWriteFailureKind[] = [
    "quotaExceeded",
    "storageUnavailable",
    "writeNotVerified",
    "unknown"
  ];

  it("gives each cause its own Chinese wording", () => {
    const messages = kinds.map(describeStorageWriteFailure);

    expect(new Set(messages).size).toBe(kinds.length);
    for (const message of messages) {
      expect(message).toMatch(/[一-龥]/);
    }
  });

  it("always states that the change is unsaved", () => {
    for (const kind of kinds) {
      expect(describeStorageWriteFailure(kind)).toContain("没有保存");
    }
  });

  it("never exposes storage keys to the user", () => {
    for (const kind of kinds) {
      expect(describeStorageWriteFailure(kind)).not.toContain("morpho.");
    }
  });
});
