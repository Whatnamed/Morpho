import { describe, expect, it, vi } from "vitest";

import {
  estimateOriginStorage,
  formatStorageSize,
  isLocalTextStorageUnderPressure,
  isOriginStorageUnderPressure,
  LOCAL_TEXT_STORAGE_WARNING_BYTES,
  measureLocalTextStorage,
  ORIGIN_STORAGE_PRESSURE_SHARE,
  readStorageDurability,
  requestStorageDurability,
  type StorageManagerLike
} from "./storageDurability";
import { createMemoryStorage } from "./memoryStorage";
import { localStorageEntryBytes } from "./storageFootprint";

describe("readStorageDurability", () => {
  it("reports an unknown grant when the browser has no StorageManager", async () => {
    await expect(readStorageDurability(null)).resolves.toBe("unknown");
  });

  it("reports an unknown grant when the StorageManager cannot answer", async () => {
    await expect(readStorageDurability({})).resolves.toBe("unknown");
    await expect(
      readStorageDurability({ persisted: () => Promise.reject(new Error("denied")) })
    ).resolves.toBe("unknown");
  });

  it("separates a granted origin from an evictable one", async () => {
    await expect(readStorageDurability({ persisted: async () => true })).resolves.toBe("persisted");
    await expect(readStorageDurability({ persisted: async () => false })).resolves.toBe("bestEffort");
  });
});

describe("requestStorageDurability", () => {
  it("does not re-request a grant the origin already has", async () => {
    const persist = vi.fn(async () => true);
    const manager: StorageManagerLike = { persisted: async () => true, persist };

    await expect(requestStorageDurability(manager)).resolves.toBe("persisted");
    expect(persist).not.toHaveBeenCalled();
  });

  it("requests persistence when the origin is still evictable", async () => {
    const persist = vi.fn(async () => true);
    const manager: StorageManagerLike = { persisted: async () => false, persist };

    await expect(requestStorageDurability(manager)).resolves.toBe("persisted");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("reports bestEffort when the browser refuses the request", async () => {
    const manager: StorageManagerLike = { persisted: async () => false, persist: async () => false };

    await expect(requestStorageDurability(manager)).resolves.toBe("bestEffort");
  });

  it("keeps the last readable state when the request itself throws", async () => {
    const manager: StorageManagerLike = {
      persisted: async () => false,
      persist: () => Promise.reject(new Error("not allowed"))
    };

    await expect(requestStorageDurability(manager)).resolves.toBe("bestEffort");
  });

  it("stays unknown when persistence cannot be requested at all", async () => {
    await expect(requestStorageDurability({})).resolves.toBe("unknown");
    await expect(requestStorageDurability(null)).resolves.toBe("unknown");
  });
});

describe("estimateOriginStorage", () => {
  it("reports usage against the origin quota", async () => {
    const usage = await estimateOriginStorage({
      estimate: async () => ({ usage: 250, quota: 1000 })
    });

    expect(usage).toEqual({
      status: "ok",
      usageBytes: 250,
      quotaBytes: 1000,
      usedShare: 0.25
    });
  });

  it("rejects estimates that cannot support a share", async () => {
    const cases: Array<Record<string, number>> = [
      { usage: 10 },
      { quota: 10 },
      { usage: -1, quota: 10 },
      { usage: 10, quota: 0 },
      { usage: Number.NaN, quota: 10 }
    ];

    for (const estimate of cases) {
      await expect(estimateOriginStorage({ estimate: async () => estimate })).resolves.toEqual({
        status: "unknown"
      });
    }
  });

  it("stays unknown when the browser cannot estimate", async () => {
    await expect(estimateOriginStorage({})).resolves.toEqual({ status: "unknown" });
    await expect(
      estimateOriginStorage({ estimate: () => Promise.reject(new Error("blocked")) })
    ).resolves.toEqual({ status: "unknown" });
  });
});

describe("isOriginStorageUnderPressure", () => {
  it("warns at the threshold, not only when the quota is full", () => {
    expect(
      isOriginStorageUnderPressure({
        status: "ok",
        usageBytes: ORIGIN_STORAGE_PRESSURE_SHARE * 1000,
        quotaBytes: 1000,
        usedShare: ORIGIN_STORAGE_PRESSURE_SHARE
      })
    ).toBe(true);
    expect(
      isOriginStorageUnderPressure({ status: "ok", usageBytes: 100, quotaBytes: 1000, usedShare: 0.1 })
    ).toBe(false);
  });

  it("never warns on an unknown estimate", () => {
    expect(isOriginStorageUnderPressure({ status: "unknown" })).toBe(false);
  });
});

describe("formatStorageSize", () => {
  it("formats the units a user can act on", () => {
    expect(formatStorageSize(4096)).toBe("4 KB");
    expect(formatStorageSize(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatStorageSize(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });

  it("never reports a zero size for stored bytes", () => {
    expect(formatStorageSize(12)).toBe("1 KB");
  });

  it("refuses to invent a size", () => {
    expect(formatStorageSize(Number.NaN)).toBe("未知");
    expect(formatStorageSize(-1)).toBe("未知");
  });
});

describe("measureLocalTextStorage", () => {
  it("reports unknown when localStorage is unavailable or throws", () => {
    expect(measureLocalTextStorage(null)).toEqual({ status: "unknown" });

    const memory = createMemoryStorage();
    const brokenLength: Storage = {
      ...memory,
      get length(): number {
        throw new DOMException("blocked", "SecurityError");
      },
      key: memory.key.bind(memory),
      getItem: memory.getItem.bind(memory),
      setItem: memory.setItem.bind(memory),
      removeItem: memory.removeItem.bind(memory),
      clear: memory.clear.bind(memory)
    };
    expect(measureLocalTextStorage(brokenLength)).toEqual({ status: "unknown" });

    memory.setItem("ok", "123");
    memory.setItem("bad", "456");
    const brokenRead: Storage = {
      ...memory,
      get length() {
        return memory.length;
      },
      key: (index) => memory.key(index),
      getItem: (key) => {
        if (key === "bad") {
          throw new DOMException("blocked", "SecurityError");
        }
        return memory.getItem(key);
      },
      setItem: memory.setItem.bind(memory),
      removeItem: memory.removeItem.bind(memory),
      clear: memory.clear.bind(memory)
    };
    expect(measureLocalTextStorage(brokenRead)).toEqual({ status: "unknown" });
  });

  it("measures UTF-16 quota bytes without parsing values", () => {
    const memory = createMemoryStorage();
    memory.setItem("k1", "{not-json");
    memory.setItem("k2", "中文");

    expect(measureLocalTextStorage(memory)).toEqual({
      status: "ok",
      quotaBytes: localStorageEntryBytes("k1", "{not-json") + localStorageEntryBytes("k2", "中文"),
      entryCount: 2
    });
  });
});

describe("isLocalTextStorageUnderPressure", () => {
  it("never warns on unknown usage", () => {
    expect(isLocalTextStorageUnderPressure({ status: "unknown" })).toBe(false);
  });

  it("warns at or above the conservative local text threshold and stays quiet below it", () => {
    expect(
      isLocalTextStorageUnderPressure({
        status: "ok",
        quotaBytes: LOCAL_TEXT_STORAGE_WARNING_BYTES - 1,
        entryCount: 1
      })
    ).toBe(false);
    expect(
      isLocalTextStorageUnderPressure({
        status: "ok",
        quotaBytes: LOCAL_TEXT_STORAGE_WARNING_BYTES,
        entryCount: 1
      })
    ).toBe(true);
  });
});
