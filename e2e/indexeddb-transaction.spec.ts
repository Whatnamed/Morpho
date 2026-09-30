import { expect, test } from "@playwright/test";

import { buildPng } from "./support/importFiles";
import { readStoredWorkspace, seedProject, shapeSelector } from "./fixtures/seed";

test.describe("IndexedDB transaction completion and abort correctness", () => {
  test.beforeEach(async ({ page }) => {
    // Inject test-only fault injection harness before any app script runs (like perfProbe.ts).
    // Not one line of this ships in the product bundle.
    await page.addInitScript(() => {
      const originalPut = IDBObjectStore.prototype.put;
      window.__morphoTestFault = {
        abortOnAssetBlobsPutSuccess: false,
        abortTriggered: false,
        putCount: 0
      };

      IDBObjectStore.prototype.put = function patchedPut(...args) {
        const req = originalPut.apply(this, args);
        if (this.name === "asset-blobs") {
          window.__morphoTestFault.putCount += 1;
          if (window.__morphoTestFault.abortOnAssetBlobsPutSuccess) {
            const tx = this.transaction;
            req.addEventListener("success", () => {
              window.__morphoTestFault.abortTriggered = true;
              try {
                tx.abort();
              } catch {
                // Ignore if already finished
              }
            });
          }
        }
        return req;
      };
    });
  });

  test("normal product file import succeeds and persists blob in IndexedDB when no fault injected", async ({ page }) => {
    const seed = await seedProject(page);
    await page.goto(`/projects/${seed.seedProjectId}`);
    await expect(page.locator(shapeSelector(seed.objectIds.keyConclusion))).toBeVisible();
    await expect(page.getByRole("button", { name: "导入", exact: true })).toBeEnabled();

    const initialWorkspace = await readStoredWorkspace(page, seed.seedProjectId);
    const initialObjectCount = Object.keys(initialWorkspace.objects).length;

    // Click "导入" button to arm the import session, then set file
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "normal-import-asset.png",
      mimeType: "image/png",
      buffer: buildPng(100, 100)
    });

    // Verify product successfully added object to workspace
    await expect.poll(async () => {
      const current = await readStoredWorkspace(page, seed.seedProjectId);
      return Object.keys(current.objects).length;
    }).toBe(initialObjectCount + 1);

    // Verify blob was actually persisted in native IndexedDB
    const blobExists = await page.evaluate(async () => {
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open("morpho-assets-v1", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("asset-blobs")) {
            db.createObjectStore("asset-blobs");
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          try {
            const tx = db.transaction("asset-blobs", "readonly");
            const store = tx.objectStore("asset-blobs");
            const countReq = store.count();
            countReq.onsuccess = () => {
              db.close();
              resolve(countReq.result > 0);
            };
            countReq.onerror = () => {
              db.close();
              resolve(false);
            };
          } catch {
            db.close();
            resolve(false);
          }
        };
        req.onerror = () => resolve(false);
      });
    });

    expect(blobExists).toBe(true);
  });

  test("real product save pipeline fails closed and does not report success when transaction aborts after request success", async ({ page }) => {
    const seed = await seedProject(page);
    await page.goto(`/projects/${seed.seedProjectId}`);
    await expect(page.locator(shapeSelector(seed.objectIds.keyConclusion))).toBeVisible();
    await expect(page.getByRole("button", { name: "导入", exact: true })).toBeEnabled();

    const initialWorkspace = await readStoredWorkspace(page, seed.seedProjectId);
    const initialInstanceCount = initialWorkspace.canvas.instances.length;

    // Arm the test fault injection on native IDBObjectStore.prototype.put
    await page.evaluate(() => {
      window.__morphoTestFault.abortOnAssetBlobsPutSuccess = true;
      window.__morphoTestFault.abortTriggered = false;
    });

    // Trigger product file import: useWorkspaceImportController -> saveBlobAsLocalAsset -> indexedDbBlobStore.put
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "aborted-import-asset.png",
      mimeType: "image/png",
      buffer: buildPng(120, 120)
    });

    // Wait for the fault to trigger in the browser engine
    await expect.poll(async () => {
      return page.evaluate(() => window.__morphoTestFault.abortTriggered);
    }).toBe(true);

    // Wait a brief window to confirm no delayed corrupt success is written
    await page.waitForTimeout(500);

    // Product must NOT have created a canvas shape instance for the failed asset
    const afterWorkspace = await readStoredWorkspace(page, seed.seedProjectId);
    expect(afterWorkspace.canvas.instances.length).toBe(initialInstanceCount);

    // Verify aborted blob was NOT committed to native IndexedDB
    const persistedKeys = await page.evaluate(async () => {
      return new Promise<string[]>((resolve) => {
        const req = indexedDB.open("morpho-assets-v1", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("asset-blobs")) {
            db.createObjectStore("asset-blobs");
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          try {
            const tx = db.transaction("asset-blobs", "readonly");
            const store = tx.objectStore("asset-blobs");
            const keysReq = store.getAllKeys();
            keysReq.onsuccess = () => {
              db.close();
              resolve(keysReq.result.map(String));
            };
            keysReq.onerror = () => {
              db.close();
              resolve([]);
            };
          } catch {
            db.close();
            resolve([]);
          }
        };
        req.onerror = () => resolve([]);
      });
    });

    expect(persistedKeys.some((k) => k.includes("aborted-import-asset"))).toBe(false);
  });

  test("synchronous executor failure in transaction rejects once and closes database handle", async ({ page }) => {
    await page.goto("/");

    const outcome = await page.evaluate(async () => {
      return new Promise<{
        rejected: boolean;
        isDomException: boolean;
        errorName: string;
        settleCount: number;
      }>((resolveTest) => {
        const openReq = indexedDB.open("morpho-assets-v1", 1);
        openReq.onupgradeneeded = () => {
          const db = openReq.result;
          if (!db.objectStoreNames.contains("asset-blobs")) {
            db.createObjectStore("asset-blobs");
          }
        };
        openReq.onsuccess = async () => {
          const db = openReq.result;
          let settleCount = 0;
          let rejected = false;
          let errorName = "";
          let isDomException = false;

          const promise = new Promise((resolvePromise, rejectPromise) => {
            let settled = false;
            const safeReject = (err: Error) => {
              if (settled) return;
              settled = true;
              settleCount += 1;
              rejectPromise(err);
            };
            const safeResolve = (val: unknown) => {
              if (settled) return;
              settled = true;
              settleCount += 1;
              resolvePromise(val);
            };

            try {
              const tx = db.transaction("asset-blobs", "readwrite");
              const store = tx.objectStore("asset-blobs");

              // Synchronous executor failure: abort transaction then attempt store operation.
              // In native IndexedDB, calling put on an aborted transaction throws synchronously.
              tx.abort();
              store.put(new Blob(["data"]), "sync-fail-key");

              tx.oncomplete = () => safeResolve(true);
              tx.onerror = () => safeReject(tx.error ?? new Error("tx error"));
              tx.onabort = () => safeReject(tx.error ?? new Error("tx abort"));
            } catch (err) {
              safeReject(err instanceof Error ? err : new Error(String(err)));
            }
          });

          try {
            await promise;
          } catch (err) {
            rejected = true;
            isDomException = err instanceof DOMException;
            errorName = err instanceof Error ? err.name : String(err);
          } finally {
            db.close();
          }

          setTimeout(() => {
            resolveTest({ rejected, isDomException, errorName, settleCount });
          }, 50);
        };
        openReq.onerror = () => {
          resolveTest({ rejected: false, isDomException: false, errorName: "open failed", settleCount: 0 });
        };
      });
    });

    expect(outcome.rejected).toBe(true);
    expect(outcome.isDomException).toBe(true);
    expect(outcome.settleCount).toBe(1);
  });

  test("asynchronous transaction abort event rejects transaction promise and settles strictly once", async ({ page }) => {
    await page.goto("/");

    const outcome = await page.evaluate(async () => {
      return new Promise<{
        requestSuccessFired: boolean;
        transactionAbortFired: boolean;
        promiseRejected: boolean;
        settleCount: number;
        persisted: boolean;
      }>((resolveTest) => {
        const openReq = indexedDB.open("morpho-assets-v1", 1);
        openReq.onupgradeneeded = () => {
          const db = openReq.result;
          if (!db.objectStoreNames.contains("asset-blobs")) {
            db.createObjectStore("asset-blobs");
          }
        };
        openReq.onsuccess = async () => {
          const db = openReq.result;
          let requestSuccessFired = false;
          let transactionAbortFired = false;
          let settleCount = 0;
          let promiseRejected = false;

          const key = "async-abort-event-test-key";
          const blob = new Blob(["this will be aborted after request success"], { type: "text/plain" });

          const promise = new Promise((resolvePromise, rejectPromise) => {
            let settled = false;
            let result: unknown;

            const safeReject = (err: Error) => {
              if (settled) return;
              settled = true;
              settleCount += 1;
              rejectPromise(err);
            };
            const safeResolve = (val: unknown) => {
              if (settled) return;
              settled = true;
              settleCount += 1;
              resolvePromise(val);
            };

            try {
              const tx = db.transaction("asset-blobs", "readwrite");
              const store = tx.objectStore("asset-blobs");
              const req = store.put(blob, key);

              req.onsuccess = () => {
                requestSuccessFired = true;
                result = req.result;
                // Crucial: request succeeded, now abort transaction before completion
                tx.abort();
              };

              req.onerror = () => safeReject(req.error ?? new Error("req error"));
              tx.oncomplete = () => safeResolve(result);
              tx.onerror = () => safeReject(tx.error ?? new Error("tx error"));
              tx.onabort = () => {
                transactionAbortFired = true;
                safeReject(tx.error ?? new Error("IndexedDB 事务已中止。"));
              };
            } catch (err) {
              safeReject(err instanceof Error ? err : new Error(String(err)));
            }
          });

          try {
            await promise;
          } catch {
            promiseRejected = true;
          } finally {
            db.close();
          }

          // Check if key was persisted
          const verifyReq = indexedDB.open("morpho-assets-v1", 1);
          verifyReq.onsuccess = () => {
            const vDb = verifyReq.result;
            const vTx = vDb.transaction("asset-blobs", "readonly");
            const getReq = vTx.objectStore("asset-blobs").get(key);
            getReq.onsuccess = () => {
              const persisted = Boolean(getReq.result);
              vDb.close();
              resolveTest({
                requestSuccessFired,
                transactionAbortFired,
                promiseRejected,
                settleCount,
                persisted
              });
            };
            getReq.onerror = () => {
              vDb.close();
              resolveTest({
                requestSuccessFired,
                transactionAbortFired,
                promiseRejected,
                settleCount,
                persisted: false
              });
            };
          };
        };
      });
    });

    expect(outcome.requestSuccessFired).toBe(true);
    expect(outcome.transactionAbortFired).toBe(true);
    expect(outcome.promiseRejected).toBe(true);
    expect(outcome.settleCount).toBe(1);
    expect(outcome.persisted).toBe(false);
  });
});

declare global {
  interface Window {
    __morphoTestFault: {
      abortOnAssetBlobsPutSuccess: boolean;
      abortTriggered: boolean;
      putCount: number;
    };
  }
}
