import { expect, test } from "@playwright/test";

test.describe("IndexedDB transaction completion and abort correctness", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => typeof window.__morphoIndexedDbTestSeam !== "undefined");
  });

  test("normal put -> get -> delete completes and closes handles", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const seam = window.__morphoIndexedDbTestSeam!;
      const key = "e2e-test-normal-key";
      const content = "Morpho real-browser IndexedDB content";
      const blob = new Blob([content], { type: "text/plain" });

      await seam.indexedDbBlobStore.put(key, blob);
      const retrieved = await seam.indexedDbBlobStore.get(key);
      const retrievedText = retrieved ? await retrieved.text() : null;

      await seam.indexedDbBlobStore.delete(key);
      const afterDelete = await seam.indexedDbBlobStore.get(key);

      return {
        retrievedText,
        afterDelete
      };
    });

    expect(result.retrievedText).toBe("Morpho real-browser IndexedDB content");
    expect(result.afterDelete).toBeNull();
  });

  test("request success followed by transaction abort rejects and does not resolve as a successful write", async ({ page }) => {
    const outcome = await page.evaluate(async () => {
      const seam = window.__morphoIndexedDbTestSeam!;
      const database = await seam.openAssetsDatabase();
      const key = "e2e-test-abort-after-success-key";
      const blob = new Blob(["this write must abort"], { type: "text/plain" });

      let requestSuccessFired = false;
      let resolvedValue: unknown = undefined;
      let rejectionError: string | null = null;
      let settledState: "unsettled" | "resolved" | "rejected" = "unsettled";

      try {
        const promise = seam.runTransaction(database, "readwrite", (store, transaction) => {
          const req = store.put(blob, key);
          req.addEventListener("success", () => {
            requestSuccessFired = true;
            // Crucial: request succeeded in the browser engine, but transaction has not completed.
            // Abort the transaction now before it completes:
            transaction.abort();
          });
          return req;
        });

        promise
          .then((val) => {
            settledState = "resolved";
            resolvedValue = val;
          })
          .catch((err) => {
            settledState = "rejected";
            rejectionError = err instanceof Error ? err.message : String(err);
          });

        await promise;
      } catch (error) {
        settledState = "rejected";
        rejectionError = error instanceof Error ? error.message : String(error);
      } finally {
        database.close();
      }

      // Check whether anything was actually written to IndexedDB
      const verifyDb = await seam.openAssetsDatabase();
      let persistedBlobText: string | null = null;
      try {
        const getResult = await seam.runTransaction<Blob | undefined>(verifyDb, "readonly", (store) =>
          store.get(key)
        );
        persistedBlobText = getResult ? await getResult.text() : null;
      } finally {
        verifyDb.close();
      }

      return {
        requestSuccessFired,
        settledState,
        rejectionError,
        resolvedValue,
        persistedBlobText
      };
    });

    expect(outcome.requestSuccessFired).toBe(true);
    expect(outcome.settledState).toBe("rejected");
    expect(outcome.resolvedValue).toBeUndefined();
    expect(outcome.rejectionError).toBeTruthy();
    expect(outcome.persistedBlobText).toBeNull();
  });

  test("transaction error propagates to caller and no later event can flip settled failure into success", async ({ page }) => {
    const outcome = await page.evaluate(async () => {
      const seam = window.__morphoIndexedDbTestSeam!;
      const database = await seam.openAssetsDatabase();
      const key = "e2e-test-abort-settlement-guard";
      const blob = new Blob(["settlement guard test"], { type: "text/plain" });

      let rejectionCount = 0;
      let resolveCount = 0;
      let firstError: string | null = null;

      try {
        const promise = seam.runTransaction(database, "readwrite", (_store, transaction) => {
          transaction.abort();
          const req = _store.put(blob, key);
          return req;
        });

        promise
          .then(() => {
            resolveCount += 1;
          })
          .catch((err) => {
            rejectionCount += 1;
            firstError = err instanceof Error ? err.message : String(err);
          });

        await promise;
      } catch (err) {
        firstError = err instanceof Error ? err.message : String(err);
      } finally {
        database.close();
      }

      await new Promise((r) => setTimeout(r, 50));

      return {
        rejectionCount,
        resolveCount,
        firstError
      };
    });

    expect(outcome.resolveCount).toBe(0);
    expect(outcome.rejectionCount).toBe(1);
    expect(outcome.firstError).toBeTruthy();
  });
});
