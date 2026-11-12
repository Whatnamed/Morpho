import { measureStorageUsage } from "./storageFootprint";

/**
 * Browser storage durability and pressure accounting for the local-first project store.
 *
 * Morpho keeps project records in localStorage and binaries in IndexedDB.
 * Both sit in the origin's best-effort storage bucket unless the origin has
 * been granted persistence. Best-effort storage is not only at risk of a
 * rejected write — it is at risk of being deleted after it was written
 * successfully: Safari clears script-writable storage after seven days without
 * interaction, and Chromium evicts whole origins under disk pressure.
 *
 * That failure is silent and total, so it needs a different mitigation from a
 * failed write. A failed write reports itself and leaves the previous data
 * intact; eviction reports nothing and leaves nothing. The only mitigations the
 * platform offers are asking for persistence and telling the user to keep an
 * exported backup when the browser will not grant it.
 *
 * `navigator.storage.estimate()` reflects the origin's large-object quota
 * (where IndexedDB binaries live), NOT the browser's much smaller separate
 * localStorage text cap. A browser can hit `QuotaExceededError` on
 * localStorage while `estimate()` still reports gigabytes of headroom, so the
 * two pressure checks stay independent.
 */

/** The browser promised not to evict this origin without an explicit user action. */
export type StorageDurabilityStatus =
  | "persisted"
  /** The API answered, but this origin can still be evicted without warning. */
  | "bestEffort"
  /** No StorageManager, or the call failed. Nothing can be claimed either way. */
  | "unknown";

export type StorageEstimateLike = {
  quota?: number;
  usage?: number;
};

export type StorageManagerLike = {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<StorageEstimateLike>;
};

export type OriginStorageUsage =
  | {
      status: "unknown";
    }
  | {
      status: "ok";
      usageBytes: number;
      quotaBytes: number;
      /**
       * 0-1 share of the origin's large-object quota already used (primarily
       * IndexedDB image and file binaries). Does not reflect localStorage's
       * separate text quota in all browsers.
       */
      usedShare: number;
    };

export type LocalTextStorageUsage =
  | {
      status: "unknown";
    }
  | {
      status: "ok";
      /** Measured localStorage footprint in UTF-16 quota bytes (`(key.length + value.length) * 2`). */
      quotaBytes: number;
      entryCount: number;
    };

/**
 * Share of the origin quota above which eviction and write failure both become
 * realistic. Deliberately below 1: a user who is told at 99% has no room left
 * to export a backup, and exporting a backup allocates memory of its own.
 */
export const ORIGIN_STORAGE_PRESSURE_SHARE = 0.8;

/**
 * Conservative internal warning threshold for localStorage project records
 * (4 MiB in UTF-16 quota bytes). This is an internal heuristic — above the
 * built-in case study and below typical ~5–10 MiB browser caps — NOT a hard
 * browser quota or a promise of remaining writable space.
 */
export const LOCAL_TEXT_STORAGE_WARNING_BYTES = 4 * 1024 * 1024;

export function getLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function getStorageManager(): StorageManagerLike | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  return (navigator as Navigator & { storage?: StorageManagerLike }).storage;
}

/** Reads the current grant without prompting or requesting anything. */
export async function readStorageDurability(
  // Omitting this asks the browser. Passing `null` states that there is no
  // StorageManager — `undefined` cannot say that, because a default parameter
  // fires on `undefined` and would reach for the ambient one instead.
  manager: StorageManagerLike | null | undefined = getStorageManager()
): Promise<StorageDurabilityStatus> {
  if (!manager?.persisted) {
    return "unknown";
  }

  try {
    return (await manager.persisted()) ? "persisted" : "bestEffort";
  } catch {
    return "unknown";
  }
}

/**
 * Asks the browser to make this origin persistent, and reports what was
 * actually granted.
 *
 * Already-persisted origins are never re-requested: Firefox shows a permission
 * prompt for `persist()`, and re-asking an origin that already has the grant
 * would be a prompt with nothing behind it.
 */
export async function requestStorageDurability(
  manager: StorageManagerLike | null | undefined = getStorageManager()
): Promise<StorageDurabilityStatus> {
  const current = await readStorageDurability(manager);
  if (current === "persisted") {
    return current;
  }

  if (!manager?.persist) {
    return current;
  }

  try {
    return (await manager.persist()) ? "persisted" : "bestEffort";
  } catch {
    return current;
  }
}

export async function estimateOriginStorage(
  manager: StorageManagerLike | null | undefined = getStorageManager()
): Promise<OriginStorageUsage> {
  if (!manager?.estimate) {
    return { status: "unknown" };
  }

  let estimate: StorageEstimateLike;
  try {
    estimate = await manager.estimate();
  } catch {
    return { status: "unknown" };
  }

  const usageBytes = estimate.usage;
  const quotaBytes = estimate.quota;
  if (
    typeof usageBytes !== "number" ||
    typeof quotaBytes !== "number" ||
    !Number.isFinite(usageBytes) ||
    !Number.isFinite(quotaBytes) ||
    usageBytes < 0 ||
    quotaBytes <= 0
  ) {
    return { status: "unknown" };
  }

  return {
    status: "ok",
    usageBytes,
    quotaBytes,
    usedShare: usageBytes / quotaBytes
  };
}

export function isOriginStorageUnderPressure(usage: OriginStorageUsage): boolean {
  return usage.status === "ok" && usage.usedShare >= ORIGIN_STORAGE_PRESSURE_SHARE;
}

/**
 * Measures existing localStorage entries by UTF-16 quota bytes without parsing
 * project JSON. Any access or read failure yields `unknown` rather than 0 so
 * an unreadable storage area never poses as empty.
 */
export function measureLocalTextStorage(
  storage: Storage | null | undefined = getLocalStorage()
): LocalTextStorageUsage {
  if (!storage) {
    return { status: "unknown" };
  }

  const usage = measureStorageUsage(storage);
  if (usage.measurementFailed) {
    return { status: "unknown" };
  }

  return {
    status: "ok",
    quotaBytes: usage.quotaBytes,
    entryCount: usage.entryCount
  };
}

export function isLocalTextStorageUnderPressure(usage: LocalTextStorageUsage): boolean {
  return usage.status === "ok" && usage.quotaBytes >= LOCAL_TEXT_STORAGE_WARNING_BYTES;
}

/** Rounded display size. Sizes are for the user's own material, not for storage internals. */
export function formatStorageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "未知";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
