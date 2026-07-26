import { localStorageEntryBytes } from "./storageFootprint";

/**
 * In-memory `Storage` used by persistence tests. It reproduces the failure modes
 * a real browser localStorage exhibits, because the guardrails under test have to
 * tell them apart:
 *
 * - `quotaBytes`  — throws `QuotaExceededError` once the origin budget is spent,
 *                   the way Chrome and Firefox do.
 * - `failSetKeys` — a plain write failure with no quota semantics.
 * - `silentWrites`— accepts a write and stores nothing, which is what Safari
 *                   private mode and some embedded webviews do.
 */
export type MemoryStorageOptions = {
  failSetKeys?: string[];
  quotaBytes?: number;
  silentWrites?: boolean;
};

export function createMemoryStorage(options: MemoryStorageOptions = {}): Storage {
  const values = new Map<string, string>();
  const failSetKeys = new Set(options.failSetKeys ?? []);

  function usedBytes(excludeKey?: string): number {
    let total = 0;
    for (const [key, value] of values) {
      if (key === excludeKey) {
        continue;
      }
      total += localStorageEntryBytes(key, value);
    }
    return total;
  }

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      if (failSetKeys.has(key)) {
        throw new Error(`Blocked write for ${key}`);
      }
      if (options.quotaBytes !== undefined && usedBytes(key) + localStorageEntryBytes(key, value) > options.quotaBytes) {
        throw new DOMException(
          `Failed to execute 'setItem' on 'Storage': Setting the value of '${key}' exceeded the quota.`,
          "QuotaExceededError"
        );
      }
      if (options.silentWrites) {
        return;
      }
      values.set(key, value);
    }
  };
}
