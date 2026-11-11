import { expect, test, type Page } from "@playwright/test";

import { seedPayload } from "./fixtures/seed";

type SeedWorkspaceEntry = {
  id: string;
  title: string;
  updatedAt: string;
  rawWorkspace: string | null;
  corruptRaw?: string;
  assetsToWrite: Array<{ storageKey: string; width: number; height: number; seed: number }>;
};

function createWorkspaceClone(
  baseJson: string,
  options: {
    id: string;
    title: string;
    updatedAt: string;
    assetId: string;
    storageKey: string;
    keepSingleImageOnly?: boolean;
  }
): string {
  const ws = JSON.parse(baseJson) as {
    project: { id: string; title: string; updatedAt: string; lastOpenedAt: string; coverAssetId?: string };
    objects: Record<string, { id: string; type: string; assetId?: string }>;
    assets: Record<
      string,
      {
        id: string;
        fileName: string;
        mimeType: string;
        size: number;
        createdAt: string;
        storageKey: string;
        sourceType: string;
        width?: number;
        height?: number;
        aspectRatio?: number;
      }
    >;
    canvas: { instances: Array<{ id: string; objectId: string }> };
  };

  ws.project.id = options.id;
  ws.project.title = options.title;
  ws.project.updatedAt = options.updatedAt;
  ws.project.lastOpenedAt = options.updatedAt;
  ws.project.coverAssetId = options.assetId;

  const firstImage = Object.values(ws.objects).find((obj) => obj.type === "image");
  if (!firstImage) {
    throw new Error("Expected image object in base seed workspace");
  }
  firstImage.assetId = options.assetId;

  for (const obj of Object.values(ws.objects)) {
    if (obj.type === "image" && obj.id !== firstImage.id) {
      obj.assetId = options.assetId;
    }
  }

  ws.assets = {
    [options.assetId]: {
      id: options.assetId,
      fileName: `${options.id}.png`,
      mimeType: "image/png",
      size: 1024,
      createdAt: "2026-10-01T00:00:00.000Z",
      storageKey: options.storageKey,
      sourceType: "originalImage",
      width: 64,
      height: 48,
      aspectRatio: 64 / 48
    }
  };

  if (options.keepSingleImageOnly) {
    ws.objects = { [firstImage.id]: firstImage };
    ws.canvas.instances = ws.canvas.instances.filter((inst) => inst.objectId === firstImage.id);
  }

  return JSON.stringify(ws);
}

async function seedProjectsAndBlobs(
  page: Page,
  catalogKey: string,
  recentProjectId: string,
  entries: SeedWorkspaceEntry[]
) {
  await page.route("**/__e2e_seed__", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>seed</body></html>"
    });
  });

  await page.goto("/__e2e_seed__", { waitUntil: "domcontentloaded" });

  await page.evaluate(
    async ({ key, recentId, items }) => {
      window.localStorage.clear();
      const summaries = items.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: `${item.title} 简介`,
        lastOpenedAt: item.updatedAt,
        updatedAt: item.updatedAt
      }));
      window.localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          recentProjectId: recentId,
          projects: summaries
        })
      );

      for (const item of items) {
        const wsKey = `morpho.project.${item.id}.workspace.v1`;
        if (item.corruptRaw !== undefined) {
          window.localStorage.setItem(wsKey, item.corruptRaw);
        } else if (item.rawWorkspace !== null) {
          window.localStorage.setItem(wsKey, item.rawWorkspace);
        }
      }

      const assetsToWrite = items.flatMap((item) => item.assetsToWrite);
      if (assetsToWrite.length === 0) {
        return;
      }

      const makeBlob = async (w: number, h: number, seed: number) => {
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = `rgb(${(seed * 37) % 200 + 30}, ${(seed * 73) % 200 + 30}, ${(seed * 19) % 200 + 30})`;
        ctx.fillRect(0, 0, w, h);
        return canvas.convertToBlob({ type: "image/png" });
      };

      const blobs = await Promise.all(assetsToWrite.map((a) => makeBlob(a.width, a.height, a.seed)));
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("morpho-assets-v1", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("asset-blobs")) {
            req.result.createObjectStore("asset-blobs");
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("asset-blobs", "readwrite");
          const store = tx.objectStore("asset-blobs");
          assetsToWrite.forEach((asset, index) => {
            store.put(blobs[index], asset.storageKey);
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { key: catalogKey, recentId: recentProjectId, items: entries }
  );

  await page.unroute("**/__e2e_seed__");
}

async function installHomeSpy(page: Page) {
  await page.addInitScript(() => {
    const spy = {
      wsReads: [] as string[],
      idbGets: 0,
      idbKeys: [] as string[],
      urlCreates: 0,
      urlRevokes: 0
    };
    (window as unknown as { __homeSpy?: typeof spy; __resetHomeSpy?: () => void }).__homeSpy = spy;
    (window as unknown as { __resetHomeSpy?: () => void }).__resetHomeSpy = () => {
      spy.wsReads = [];
      spy.idbGets = 0;
      spy.idbKeys = [];
      spy.urlCreates = 0;
      spy.urlRevokes = 0;
    };

    const lsProto = window.localStorage.constructor.prototype as Storage;
    const origGetItem = lsProto.getItem;
    Object.defineProperty(window.localStorage, "getItem", {
      configurable: true,
      value(key: string) {
        if (key.startsWith("morpho.project.") && key.endsWith(".workspace.v1")) {
          spy.wsReads.push(key);
        }
        return origGetItem.call(this, key);
      }
    });

    const origIdbGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function patchedGet(...args: [IDBValidKey | IDBKeyRange]) {
      if (this.name === "asset-blobs") {
        spy.idbGets += 1;
        spy.idbKeys.push(String(args[0] ?? ""));
      }
      return origIdbGet.apply(this, args);
    };

    const origCreate = URL.createObjectURL;
    URL.createObjectURL = function patchedCreate(obj: Blob | MediaSource) {
      spy.urlCreates += 1;
      return origCreate.call(this, obj);
    };
    const origRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = function patchedRevoke(url: string) {
      spy.urlRevokes += 1;
      return origRevoke.call(this, url);
    };
  });
}

test.describe("project home on-demand preview", () => {
  test("skips offscreen cards initially, loads on scroll, avoids reload on scroll back/forth, revokes filtered URLs, and isolates corrupt projects", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const payload = seedPayload();
    const entries: SeedWorkspaceEntry[] = [];

    entries.push({
      id: "proj-hero",
      title: "Hero 核心方向",
      updatedAt: "2026-11-10T12:00:00.000Z",
      rawWorkspace: createWorkspaceClone(payload.workspaceValue, {
        id: "proj-hero",
        title: "Hero 核心方向",
        updatedAt: "2026-11-10T12:00:00.000Z",
        assetId: "asset-hero",
        storageKey: "blob:e2e:hero"
      }),
      assetsToWrite: [{ storageKey: "blob:e2e:hero", width: 64, height: 48, seed: 101 }]
    });

    entries.push({
      id: "proj-01",
      title: "项目 01",
      updatedAt: "2026-11-09T12:00:00.000Z",
      rawWorkspace: createWorkspaceClone(payload.workspaceValue, {
        id: "proj-01",
        title: "项目 01",
        updatedAt: "2026-11-09T12:00:00.000Z",
        assetId: "asset-01",
        storageKey: "blob:e2e:01"
      }),
      assetsToWrite: [{ storageKey: "blob:e2e:01", width: 64, height: 48, seed: 102 }]
    });

    entries.push({
      id: "proj-corrupt",
      title: "损坏项目示例",
      updatedAt: "2026-11-08T12:00:00.000Z",
      rawWorkspace: null,
      corruptRaw: "{not-valid-json",
      assetsToWrite: []
    });

    entries.push({
      id: "proj-missing-img",
      title: "缺图项目示例",
      updatedAt: "2026-11-07T12:00:00.000Z",
      rawWorkspace: createWorkspaceClone(payload.workspaceValue, {
        id: "proj-missing-img",
        title: "缺图项目示例",
        updatedAt: "2026-11-07T12:00:00.000Z",
        assetId: "asset-missing",
        storageKey: "blob:e2e:missing-does-not-exist"
      }),
      assetsToWrite: []
    });

    for (let i = 2; i <= 18; i += 1) {
      const label = String(i).padStart(2, "0");
      const day = String(30 - i).padStart(2, "0");
      const id = `proj-${label}`;
      entries.push({
        id,
        title: `项目 ${label}`,
        updatedAt: `2026-10-${day}T12:00:00.000Z`,
        rawWorkspace: createWorkspaceClone(payload.workspaceValue, {
          id,
          title: `项目 ${label}`,
          updatedAt: `2026-10-${day}T12:00:00.000Z`,
          assetId: `asset-${label}`,
          storageKey: `blob:e2e:${label}`
        }),
        assetsToWrite: [{ storageKey: `blob:e2e:${label}`, width: 64, height: 48, seed: 200 + i }]
      });
    }

    await seedProjectsAndBlobs(page, payload.catalogKey, "proj-hero", entries);
    await installHomeSpy(page);

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/", { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll(".phome-card").length === 20);
    await page.waitForSelector('.phome-hero .project-canvas-preview[data-preview-status="ready"]');
    await page.waitForFunction(() => {
      const heroImgs = Array.from(document.querySelectorAll('.phome-hero .project-canvas-preview img[src^="blob:"]')) as HTMLImageElement[];
      const card1Img = document.querySelector('[data-project-id="proj-01"] img[src^="blob:"]') as HTMLImageElement | null;
      return heroImgs.length > 0 && heroImgs.every((img) => img.complete && img.naturalWidth > 0) && Boolean(card1Img && card1Img.naturalWidth > 0);
    });
    await page.waitForTimeout(300);

    // HeroSignals shows confirmed object & image counts (non-zero, not placeholder).
    const heroSignals = await page.locator(".phome-hero-figure strong").allTextContents();
    expect(Number(heroSignals[0])).toBeGreaterThan(0);
    expect(Number(heroSignals[1])).toBeGreaterThan(0);

    // Bottom card remains unloaded/pending and unread from localStorage; corrupt/missing cards stay isolated.
    const initialCheck = await page.evaluate(() => {
      const spy = (window as unknown as { __homeSpy: { wsReads: string[]; idbGets: number; urlCreates: number } }).__homeSpy;
      const bottomPreview = document.querySelector('[data-project-id="proj-18"] .project-canvas-preview');
      const corruptPreview = document.querySelector('[data-project-id="proj-corrupt"] .project-canvas-preview');
      const missingImgPreview = document.querySelector('[data-project-id="proj-missing-img"] .project-canvas-preview');
      return {
        wsReads: spy.wsReads,
        idbGets: spy.idbGets,
        bottomStatus: bottomPreview?.getAttribute("data-preview-status"),
        bottomIsEmpty: bottomPreview?.classList.contains("is-empty"),
        corruptStatus: corruptPreview?.getAttribute("data-preview-status"),
        corruptIsEmpty: corruptPreview?.classList.contains("is-empty"),
        corruptText: corruptPreview?.textContent,
        missingImgStatus: missingImgPreview?.getAttribute("data-preview-status"),
        missingImgNodes: missingImgPreview?.querySelectorAll(".project-preview-node").length ?? 0
      };
    });

    expect(initialCheck.bottomStatus).toBe("pending");
    expect(initialCheck.bottomIsEmpty).toBe(false);
    expect(initialCheck.wsReads).not.toContain("morpho.project.proj-18.workspace.v1");
    expect(initialCheck.corruptStatus).toBe("error");
    expect(initialCheck.corruptIsEmpty).toBe(false);
    expect(initialCheck.corruptText).toContain("预览暂不可用");
    expect(initialCheck.missingImgStatus).toBe("ready");
    expect(initialCheck.missingImgNodes).toBeGreaterThan(0);

    // Stepwise scroll to bottom so intermediate and final cards enter view cleanly.
    for (const frac of [0.35, 0.7, 1.0]) {
      await page.evaluate((f) => {
        const main = document.querySelector(".phome-main")!;
        main.scrollTop = Math.round((main.scrollHeight - main.clientHeight) * f);
      }, frac);
      await page.waitForTimeout(250);
    }

    await page.waitForSelector('[data-project-id="proj-18"] .project-canvas-preview[data-preview-status="ready"]');
    await page.waitForFunction(() => {
      const img = document.querySelector('[data-project-id="proj-18"] img[src^="blob:"]') as HTMLImageElement | null;
      return Boolean(img && img.complete && img.naturalWidth > 0);
    });

    // Scrolling back to top and down again must not trigger duplicate workspace parses or IDB reads.
    await page.evaluate(() => (window as unknown as { __resetHomeSpy: () => void }).__resetHomeSpy());
    await page.evaluate(() => {
      document.querySelector(".phome-main")!.scrollTop = 0;
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const main = document.querySelector(".phome-main")!;
      main.scrollTop = main.scrollHeight;
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      document.querySelector(".phome-main")!.scrollTop = 0;
    });
    await page.waitForTimeout(250);

    const scrollBackStats = await page.evaluate(
      () => (window as unknown as { __homeSpy: { wsReads: string[]; idbGets: number; idbKeys: string[]; urlCreates: number } }).__homeSpy
    );
    expect(scrollBackStats.wsReads).toEqual([]);
    expect(scrollBackStats.idbKeys).toEqual([]);
    expect(scrollBackStats.idbGets).toBe(0);
    expect(scrollBackStats.urlCreates).toBe(0);

    // Search filters out other cards and revokes unused blob URLs.
    await page.evaluate(() => (window as unknown as { __resetHomeSpy: () => void }).__resetHomeSpy());
    const searchInput = page.locator(".phome-search input");
    await searchInput.fill("项目 18");
    await expect(page.locator(".phome-card")).toHaveCount(1);
    await page.waitForFunction(() => (window as unknown as { __homeSpy: { urlRevokes: number } }).__homeSpy.urlRevokes > 0);
    await expect(page.locator('[data-project-id="proj-18"] img[src^="blob:"]').first()).toBeVisible();

    // Clear search and test sort select cleanly.
    await searchInput.fill("");
    await expect(page.locator(".phome-card")).toHaveCount(20);
    await page.locator(".phome-sort select").selectOption("title");
    await page.locator(".phome-sort select").selectOption("opened");

    expect(pageErrors).toEqual([]);
  });

  test("isolates distinct binaries sharing assetId across projects and reflects rename, return-home, and delete", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const payload = seedPayload();

    const entries: SeedWorkspaceEntry[] = [
      {
        id: "proj-orig",
        title: "原始主项目",
        updatedAt: "2026-11-10T12:00:00.000Z",
        rawWorkspace: createWorkspaceClone(payload.workspaceValue, {
          id: "proj-orig",
          title: "原始主项目",
          updatedAt: "2026-11-10T12:00:00.000Z",
          assetId: "shared-collision-asset-id",
          storageKey: "blob:e2e:orig-48x32",
          keepSingleImageOnly: true
        }),
        assetsToWrite: [{ storageKey: "blob:e2e:orig-48x32", width: 48, height: 32, seed: 301 }]
      },
      {
        id: "proj-copy",
        title: "恢复副本项目",
        updatedAt: "2026-11-09T12:00:00.000Z",
        rawWorkspace: createWorkspaceClone(payload.workspaceValue, {
          id: "proj-copy",
          title: "恢复副本项目",
          updatedAt: "2026-11-09T12:00:00.000Z",
          assetId: "shared-collision-asset-id",
          storageKey: "blob:e2e:copy-96x64",
          keepSingleImageOnly: true
        }),
        assetsToWrite: [{ storageKey: "blob:e2e:copy-96x64", width: 96, height: 64, seed: 302 }]
      },
      {
        id: "proj-del",
        title: "待删除项目",
        updatedAt: "2026-11-08T12:00:00.000Z",
        rawWorkspace: createWorkspaceClone(payload.workspaceValue, {
          id: "proj-del",
          title: "待删除项目",
          updatedAt: "2026-11-08T12:00:00.000Z",
          assetId: "del-asset",
          storageKey: "blob:e2e:del-32x32",
          keepSingleImageOnly: true
        }),
        assetsToWrite: [{ storageKey: "blob:e2e:del-32x32", width: 32, height: 32, seed: 303 }]
      }
    ];

    await seedProjectsAndBlobs(page, payload.catalogKey, "proj-orig", entries);
    await installHomeSpy(page);

    await page.goto("/", { waitUntil: "load" });
    await page.waitForFunction(() => {
      const orig = document.querySelector('.phome-hero img[src^="blob:"]') as HTMLImageElement | null;
      const copy = document.querySelector('[data-project-id="proj-copy"] img[src^="blob:"]') as HTMLImageElement | null;
      const del = document.querySelector('[data-project-id="proj-del"] img[src^="blob:"]') as HTMLImageElement | null;
      return (
        Boolean(orig && orig.complete && orig.naturalWidth > 0) &&
        Boolean(copy && copy.complete && copy.naturalWidth > 0) &&
        Boolean(del && del.complete && del.naturalWidth > 0)
      );
    });

    // Both projects share the same assetId but point at different storageKeys -> must render their own dimensions.
    const dimensions = await page.evaluate(() => ({
      origWidth: (document.querySelector('.phome-hero img[src^="blob:"]') as HTMLImageElement).naturalWidth,
      copyWidth: (document.querySelector('[data-project-id="proj-copy"] img[src^="blob:"]') as HTMLImageElement).naturalWidth
    }));
    expect(dimensions.origWidth).toBe(48);
    expect(dimensions.copyWidth).toBe(96);

    // Rename stays accurate immediately (even with preserved updatedAt).
    await page.getByRole("button", { name: "重命名项目：恢复副本项目" }).click();
    await page.locator(".phome-rename-field input").fill("改名后的副本");
    await page.getByRole("button", { name: "保存名称" }).click();
    await expect(page.locator('[data-project-id="proj-copy"] h3')).toHaveText("改名后的副本");
    await expect(page.locator('[data-project-id="proj-copy"] .project-canvas-preview')).toHaveAttribute(
      "data-preview-status",
      "ready"
    );

    // Open project then return home via project menu.
    // Opening proj-copy updates catalog recentProjectId to proj-copy, so on return home
    // proj-copy sits in .phome-hero (96px) while proj-orig moves to the grid (48px).
    await page.getByRole("button", { name: "进入项目：改名后的副本" }).click();
    await page.waitForURL(/\/projects\/proj-copy/);
    await page.locator(".project-menu-trigger").click();
    await page.getByRole("button", { name: "返回项目首页" }).click();
    await page.waitForURL(/\/$/);
    await page.waitForFunction(() => {
      const heroCopyImg = document.querySelector('.phome-hero img[src^="blob:"]') as HTMLImageElement | null;
      const origCardImg = document.querySelector('[data-project-id="proj-orig"] img[src^="blob:"]') as HTMLImageElement | null;
      return (
        Boolean(heroCopyImg && heroCopyImg.complete && heroCopyImg.naturalWidth === 96) &&
        Boolean(origCardImg && origCardImg.complete && origCardImg.naturalWidth === 48)
      );
    });

    // Delete removes project and revokes its blob URL without disturbing remaining cards.
    await page.evaluate(() => (window as unknown as { __resetHomeSpy: () => void }).__resetHomeSpy());
    await page.getByRole("button", { name: "删除项目：待删除项目" }).click();
    await page.locator(".phome-restore-card").getByRole("button", { name: "删除项目" }).click();
    await expect(page.locator('[data-project-id="proj-del"]')).toHaveCount(0);
    await page.waitForFunction(() => (window as unknown as { __homeSpy: { urlRevokes: number } }).__homeSpy.urlRevokes > 0);
    await expect(page.locator('.phome-hero img[src^="blob:"]')).toBeVisible();
  });
});
