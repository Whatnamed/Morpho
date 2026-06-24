import type { BlobStore } from "./localAssetWorkflow";

const DATABASE_NAME = "morpho-assets-v1";
const DATABASE_VERSION = 1;
const BLOB_STORE_NAME = "asset-blobs";

export const indexedDbBlobStore: BlobStore = {
  async put(storageKey: string, blob: Blob) {
    const database = await openAssetsDatabase();
    await runTransaction(database, "readwrite", (store) => store.put(blob, storageKey));
    database.close();
  },
  async get(storageKey: string) {
    const database = await openAssetsDatabase();
    const blob = await runTransaction<Blob | undefined>(database, "readonly", (store) => store.get(storageKey));
    database.close();
    return blob ?? null;
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

function runTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BLOB_STORE_NAME, mode);
    const store = transaction.objectStore(BLOB_STORE_NAME);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 读写失败。"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB 事务失败。"));
  });
}
