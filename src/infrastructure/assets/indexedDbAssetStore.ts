import type { BlobStore } from "./localAssetWorkflow";

const DATABASE_NAME = "morpho-assets-v1";
const DATABASE_VERSION = 1;
const BLOB_STORE_NAME = "asset-blobs";

export const indexedDbBlobStore: BlobStore = {
  async put(storageKey: string, blob: Blob) {
    const database = await openAssetsDatabase();
    try {
      await runTransaction(database, "readwrite", (store) => store.put(blob, storageKey));
    } finally {
      database.close();
    }
  },
  async get(storageKey: string) {
    const database = await openAssetsDatabase();
    try {
      const blob = await runTransaction<Blob | undefined>(database, "readonly", (store) => store.get(storageKey));
      return blob ?? null;
    } finally {
      database.close();
    }
  },
  async delete(storageKey: string) {
    const database = await openAssetsDatabase();
    try {
      await runTransaction(database, "readwrite", (store) => store.delete(storageKey));
    } finally {
      database.close();
    }
  }
};

export async function getAssetObjectUrl(storageKey: string): Promise<string | null> {
  const blob = await indexedDbBlobStore.get(storageKey);
  if (!blob) {
    return null;
  }

  return URL.createObjectURL(blob);
}

function openAssetsDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前浏览器不可用 IndexedDB，本次文件未保存。"));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BLOB_STORE_NAME)) {
        database.createObjectStore(BLOB_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 打开失败。"));
    request.onblocked = () => reject(new Error("IndexedDB 正被其他页面占用。"));
  });
}

export function runTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, transaction: IDBTransaction) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let result: T | undefined;

    const safeReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const safeResolve = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const transaction = database.transaction(BLOB_STORE_NAME, mode);
      const store = transaction.objectStore(BLOB_STORE_NAME);
      const request = operation(store, transaction);

      request.onsuccess = () => {
        result = request.result;
      };

      request.onerror = () => {
        safeReject(request.error ?? new Error("IndexedDB 读写失败。"));
      };

      transaction.oncomplete = () => {
        safeResolve(result as T);
      };

      transaction.onerror = () => {
        safeReject(transaction.error ?? new Error("IndexedDB 事务失败。"));
      };

      transaction.onabort = () => {
        safeReject(transaction.error ?? new Error("IndexedDB 事务已中止。"));
      };
    } catch (error) {
      safeReject(error instanceof Error ? error : new Error("IndexedDB 操作异常。"));
    }
  });
}

declare global {
  interface Window {
    __morphoIndexedDbTestSeam?: {
      indexedDbBlobStore: BlobStore;
      openAssetsDatabase: () => Promise<IDBDatabase>;
      runTransaction: typeof runTransaction;
      DATABASE_NAME: string;
      BLOB_STORE_NAME: string;
    };
  }
}

if (typeof window !== "undefined") {
  window.__morphoIndexedDbTestSeam = {
    indexedDbBlobStore,
    openAssetsDatabase,
    runTransaction,
    DATABASE_NAME,
    BLOB_STORE_NAME
  };
}
