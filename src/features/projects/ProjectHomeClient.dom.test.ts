// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_CASE_STUDY_ID } from "@/domain/morpho/caseStudy/currentCaseStudyConstants";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import { createCurrentCaseStudyWorkspace } from "@/domain/morpho/caseStudy/createCurrentCaseStudyWorkspace";
import { createTestWorkspace } from "@/test/createTestWorkspace";
import {
  CATALOG_STORAGE_KEY,
  createCatalog,
  getProjectWorkspaceStorageKey,
  writeProjectWorkspace,
  summarizeProject
} from "@/infrastructure/persistence/localProjectStore";
import { createMemoryStorage } from "@/infrastructure/persistence/memoryStorage";
import { ensureCurrentCaseStudyAssetsWithResult } from "@/infrastructure/assets/currentCaseStudyAssetInstaller";
import { getAssetObjectUrl, indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import {
  downloadProjectBundleFile,
  exportEditableProjectBackupBundle
} from "@/features/archive/projectBundleClient";
import {
  estimateOriginStorage,
  LOCAL_TEXT_STORAGE_WARNING_BYTES,
  measureLocalTextStorage,
  type LocalTextStorageUsage,
  type OriginStorageUsage
} from "@/infrastructure/persistence/storageDurability";
import { extractProjectPreviewSnapshot } from "./ProjectCanvasPreview";
import { ProjectHomeClient } from "./ProjectHomeClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}));

vi.mock("@/infrastructure/assets/currentCaseStudyAssetInstaller", () => ({
  ensureCurrentCaseStudyAssets: vi.fn(async () => []),
  ensureCurrentCaseStudyAssetsWithResult: vi.fn(async () => ({
    diagnostics: [],
    installedCount: 0,
    repairedCount: 0,
    skippedCount: 0,
    updatedStorageKeys: []
  }))
}));

vi.mock("@/infrastructure/assets/indexedDbAssetStore", () => ({
  indexedDbBlobStore: {
    get: vi.fn(async () => null),
    delete: vi.fn(async () => {})
  },
  getAssetObjectUrl: vi.fn(async (storageKey: string) => `blob:test:${storageKey}`)
}));

vi.mock("@/features/archive/projectBundleClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/archive/projectBundleClient")>();
  return {
    ...actual,
    exportEditableProjectBackupBundle: vi.fn((...args: Parameters<typeof actual.exportEditableProjectBackupBundle>) =>
      actual.exportEditableProjectBackupBundle(...args)
    ),
    downloadProjectBundleFile: vi.fn()
  };
});

vi.mock("@/infrastructure/persistence/projectWriteLock", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/infrastructure/persistence/projectWriteLock")>(),
  acquireProjectWriteLease: async () => ({ status: "granted", release: () => {} })
}));

vi.mock("@/infrastructure/persistence/storageDurability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/persistence/storageDurability")>();
  return {
    ...actual,
    requestStorageDurability: vi.fn(async () => "unknown"),
    estimateOriginStorage: vi.fn(async (): Promise<OriginStorageUsage> => ({ status: "unknown" })),
    measureLocalTextStorage: vi.fn((): LocalTextStorageUsage => actual.measureLocalTextStorage())
  };
});

vi.mock("@/infrastructure/supabase/browser", () => ({
  createBrowserSupabaseClient: vi.fn()
}));

type ObserverEntry = {
  callback: IntersectionObserverCallback;
  targets: Element[];
};

let observers: ObserverEntry[] = [];
let revokedUrls: string[] = [];
let originalRevokeObjectURL: typeof URL.revokeObjectURL;
let originalIntersectionObserver: typeof window.IntersectionObserver | undefined;

function buildSampleImageProject(projectId: string, title: string, updatedAt: string) {
  const base = createTestWorkspace();
  const img = base.objects["image-soft-rail-preview"];
  if (!img || img.type !== "image") {
    throw new Error("Expected image object");
  }
  const assetId = "shared-asset-id";
  const storageKey = `blob:${projectId}:img`;
  return {
    ...base,
    project: {
      ...base.project,
      id: projectId,
      title,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt
    },
    objects: {
      ...base.objects,
      [img.id]: { ...img, assetId }
    },
    assets: {
      ...base.assets,
      [assetId]: {
        id: assetId,
        fileName: `${projectId}.png`,
        mimeType: "image/png",
        size: 120,
        createdAt: "2026-10-01T00:00:00.000Z",
        storageKey,
        sourceType: "originalImage" as const
      }
    }
  };
}

describe("ProjectHomeClient on-demand previews", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    window.localStorage.clear();
    observers = [];
    revokedUrls = [];
    vi.mocked(getAssetObjectUrl).mockImplementation(async (storageKey: string) => `blob:test:${storageKey}`);
    vi.mocked(indexedDbBlobStore.get).mockImplementation(async () => null);
    vi.mocked(downloadProjectBundleFile).mockReset();
    vi.mocked(estimateOriginStorage).mockImplementation(async () => ({ status: "unknown" }));
    vi.mocked(measureLocalTextStorage).mockImplementation(() => ({ status: "ok", quotaBytes: 0, entryCount: 0 }));
    vi.mocked(ensureCurrentCaseStudyAssetsWithResult).mockImplementation(async () => ({
      diagnostics: [],
      installedCount: 0,
      repairedCount: 0,
      skippedCount: 0,
      updatedStorageKeys: []
    }));
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
    originalIntersectionObserver = window.IntersectionObserver;
    class ControlledObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "120px 0px";
      readonly scrollMargin = "0px";
      readonly thresholds = [0];
      private readonly entry: ObserverEntry;
      constructor(cb: IntersectionObserverCallback) {
        this.entry = { callback: cb, targets: [] };
        observers.push(this.entry);
      }
      observe(target: Element) {
        if (!this.entry.targets.includes(target)) {
          this.entry.targets.push(target);
        }
      }
      unobserve(target: Element) {
        this.entry.targets = this.entry.targets.filter((t) => t !== target);
      }
      disconnect() {
        this.entry.targets = [];
      }
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: ControlledObserver
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    URL.revokeObjectURL = originalRevokeObjectURL;
    if (originalIntersectionObserver) {
      window.IntersectionObserver = originalIntersectionObserver;
    }
    vi.useRealTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  function emitIntersection(projectIds: string[], isIntersecting = true) {
    const wanted = new Set(projectIds);
    for (const obs of [...observers]) {
      const batch: IntersectionObserverEntry[] = [];
      for (const el of obs.targets) {
        const id = el.getAttribute("data-project-id");
        if (id && wanted.has(id)) {
          batch.push({
            target: el,
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
            boundingClientRect: el.getBoundingClientRect(),
            intersectionRect: el.getBoundingClientRect(),
            rootBounds: null,
            time: performance.now()
          });
        }
      }
      if (batch.length > 0) {
        obs.callback(batch, {} as IntersectionObserver);
      }
    }
  }

  it("preserves files after failed and partially completed deletion, then repairs the residual list entry", async () => {
    const storage = createMemoryStorage();
    vi.spyOn(window, "localStorage", "get").mockReturnValue(storage);
    const target = buildSampleImageProject("p-delete", "删除失败测试", "2026-10-10T10:00:00.000Z");
    const other = createBlankWorkspace("p-keep");
    writeProjectWorkspace(window.localStorage, target);
    writeProjectWorkspace(window.localStorage, other);
    const rawCatalog = JSON.stringify(createCatalog([summarizeProject(target), summarizeProject(other)], target.project.id));
    const key = getProjectWorkspaceStorageKey(target.project.id);
    window.localStorage.setItem(CATALOG_STORAGE_KEY, rawCatalog);
    const rawWorkspace = window.localStorage.getItem(key);
    const deleteBlob = vi.mocked(indexedDbBlobStore.delete);
    deleteBlob.mockClear();
    await act(async () => root.render(createElement(ProjectHomeClient, { account: null, authRequired: false })));

    const click = async (label: string, byText = false) => {
      const button = [...container.querySelectorAll("button")].find((entry) =>
        byText ? entry.textContent?.trim() === label : entry.getAttribute("aria-label") === label
      );
      expect(button).toBeDefined();
      await act(async () => button!.click());
    };

    await click("删除项目：删除失败测试");
    const remove = vi.spyOn(storage, "removeItem").mockImplementation(() => {});
    try {
      await click("删除项目", true);
      expect(container.textContent).toContain("无法确认项目内容已删除");
      expect(window.localStorage.getItem(key)).toBe(rawWorkspace);
      expect(window.localStorage.getItem(CATALOG_STORAGE_KEY)).toBe(rawCatalog);
      expect(deleteBlob).not.toHaveBeenCalled();
    } finally {
      remove.mockRestore();
    }

    const set = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      await click("删除项目", true);
      expect(container.textContent).toContain("项目内容已删除，项目列表更新失败");
      expect(window.localStorage.getItem(key)).toBeNull();
      expect(window.localStorage.getItem(CATALOG_STORAGE_KEY)).toBe(rawCatalog);
      expect(deleteBlob).not.toHaveBeenCalled();
    } finally {
      set.mockRestore();
    }

    await click("重试更新列表", true);
    expect(container.textContent).toContain("已更新项目列表");
    expect(JSON.parse(window.localStorage.getItem(CATALOG_STORAGE_KEY)!).projects).toEqual([
      expect.objectContaining({ id: other.project.id })
    ]);
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("shows placeholder signals instead of 0 before Hero resolves, renders real counts once ready, and isolates corrupt/offscreen cards", async () => {
    const hero = buildSampleImageProject("p-hero", "主方向项目", "2026-10-10T10:00:00.000Z");
    const visible = buildSampleImageProject("p-vis", "可见小项目", "2026-10-09T10:00:00.000Z");
    const offscreen = createBlankWorkspace("p-off");
    offscreen.project.title = "未滚入视口";
    const legacyRaw = JSON.stringify({ ...offscreen, schemaVersion: offscreen.schemaVersion - 1 });

    writeProjectWorkspace(window.localStorage, hero);
    writeProjectWorkspace(window.localStorage, visible);
    window.localStorage.setItem(getProjectWorkspaceStorageKey("p-off"), legacyRaw);

    const catalog = createCatalog(
      [
        summarizeProject(hero),
        summarizeProject(visible),
        { ...summarizeProject(offscreen), id: "p-off" }
      ],
      "p-hero"
    );
    window.localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog));

    await act(async () => {
      root.render(createElement(ProjectHomeClient, { account: null, authRequired: false }));
    });

    // Flush just microtasks (catalog initialize), before any scheduled preview macrotask executes.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const heroFiguresBefore = Array.from(container.querySelectorAll(".phome-hero-figure strong")).map((el) => el.textContent);
    expect(heroFiguresBefore).toEqual(["—", "—"]);
    expect(container.querySelector(".phome-hero .project-canvas-preview")?.classList.contains("is-empty")).toBe(false);

    // Intersect only p-vis; keep p-off offscreen.
    await act(async () => {
      emitIntersection(["p-vis"], true);
      await vi.runAllTimersAsync();
    });

    const heroFiguresAfter = Array.from(container.querySelectorAll(".phome-hero-figure strong")).map((el) => el.textContent);
    const activeObjects = Object.values(hero.objects).filter((o) => o.visibility === "active").length;
    const activeImages = Object.values(hero.objects).filter((o) => o.visibility === "active" && o.type === "image").length;
    expect(heroFiguresAfter).toEqual([String(activeObjects), String(activeImages)]);

    // Offscreen card stays pending (never parsed, never shows fake empty state).
    const offCardPreview = container.querySelector('[data-project-id="p-off"] .project-canvas-preview');
    expect(offCardPreview?.getAttribute("data-preview-status")).toBe("pending");
    expect(offCardPreview?.classList.contains("is-empty")).toBe(false);
    expect(window.localStorage.getItem(getProjectWorkspaceStorageKey("p-off"))).toBe(legacyRaw);

    // Search filters out p-hero/p-vis -> revokes p-vis image URL.
    const searchInput = container.querySelector(".phome-search input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(searchInput, "未滚入");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.runAllTimersAsync();
    });
    expect(revokedUrls).toContain("blob:test:blob:p-vis:img");
  });

  it("refreshes loaded case-study preview assets when installer repairs or installs blobs without workspace migration", async () => {
    const caseWs = createCurrentCaseStudyWorkspace();
    const previewSnapshot = extractProjectPreviewSnapshot(caseWs);
    const previewKeys = Object.keys(previewSnapshot.previewAssets);
    expect(previewKeys.length).toBeGreaterThanOrEqual(2);
    const [repairedKey, missingKey, ...stableKeys] = previewKeys as [string, string, ...string[]];

    writeProjectWorkspace(window.localStorage, caseWs);
    const storedBefore = window.localStorage.getItem(getProjectWorkspaceStorageKey(CURRENT_CASE_STUDY_ID));
    const catalog = createCatalog([summarizeProject(caseWs)], CURRENT_CASE_STUDY_ID);
    window.localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog));
    const idbUrls = new Map<string, string | null>([
      [repairedKey, "blob:corrupt-initial"],
      [missingKey, null],
      ...stableKeys.map((key) => [key, `blob:stable:${key}`] as const)
    ]);
    vi.mocked(getAssetObjectUrl).mockImplementation(async (storageKey: string) => idbUrls.get(storageKey) ?? null);

    let resolveInstall!: (value: {
      diagnostics: [];
      installedCount: number;
      repairedCount: number;
      skippedCount: number;
      updatedStorageKeys: string[];
    }) => void;
    vi.mocked(ensureCurrentCaseStudyAssetsWithResult).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInstall = resolve;
        })
    );

    await act(async () => {
      root.render(createElement(ProjectHomeClient, { account: null, authRequired: false }));
    });

    // Let Hero workspace preview finish reading BEFORE case-study installer completes (no workspace migration).
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const getHeroImgSrcs = () =>
      Array.from(container.querySelectorAll(".phome-hero .project-canvas-preview img")).map((img) =>
        img.getAttribute("src")
      );
    expect(getHeroImgSrcs()).toContain("blob:corrupt-initial");
    expect(getHeroImgSrcs()).not.toContain("blob:installed-fresh");
    expect(window.localStorage.getItem(getProjectWorkspaceStorageKey(CURRENT_CASE_STUDY_ID))).toBe(storedBefore);

    // Installer repairs corrupt key & installs missing key even without workspace migration.
    idbUrls.set(repairedKey, "blob:repaired-fresh");
    idbUrls.set(missingKey, "blob:installed-fresh");
    await act(async () => {
      resolveInstall({
        diagnostics: [],
        installedCount: 1,
        repairedCount: 1,
        skippedCount: stableKeys.length,
        updatedStorageKeys: [repairedKey, missingKey]
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    const updatedSrcs = getHeroImgSrcs();
    expect(updatedSrcs).toContain("blob:repaired-fresh");
    expect(updatedSrcs).toContain("blob:installed-fresh");
    expect(updatedSrcs).not.toContain("blob:corrupt-initial");
    expect(revokedUrls).toContain("blob:corrupt-initial");
  });

  it("clears old catalog and revokes preview URLs when cross-tab localStorage wipe leaves catalog missing", async () => {
    const hero = buildSampleImageProject("p-hero", "主方向项目", "2026-10-10T10:00:00.000Z");
    const grid = buildSampleImageProject("p-grid", "列表项目", "2026-10-09T10:00:00.000Z");

    const seedBoth = () => {
      writeProjectWorkspace(window.localStorage, hero);
      writeProjectWorkspace(window.localStorage, grid);
      window.localStorage.setItem(
        CATALOG_STORAGE_KEY,
        JSON.stringify(createCatalog([summarizeProject(hero), summarizeProject(grid)], "p-hero"))
      );
    };
    seedBoth();

    await act(async () => {
      root.render(createElement(ProjectHomeClient, { account: null, authRequired: false }));
    });
    await act(async () => {
      emitIntersection(["p-grid"], true);
      await vi.runAllTimersAsync();
    });

    expect(container.querySelector(".phome-hero")).not.toBeNull();
    expect(container.querySelectorAll(".phome-card")).toHaveLength(1);
    expect(container.querySelector('[data-project-id="p-grid"] img[src="blob:test:blob:p-grid:img"]')).not.toBeNull();

    // Case A: another tab calls localStorage.clear() -> StorageEvent with key: null.
    await act(async () => {
      window.localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
      await vi.runAllTimersAsync();
    });

    expect(container.querySelector(".phome-hero")).toBeNull();
    expect(container.querySelectorAll(".phome-card")).toHaveLength(0);
    expect(container.textContent).toContain("这里还没有项目");
    expect(revokedUrls).toContain("blob:test:blob:p-hero:img");
    expect(revokedUrls).toContain("blob:test:blob:p-grid:img");

    // Re-seed from external tab, flush mount/observers + timers so both images load,
    // then Case B: another tab removes CATALOG_STORAGE_KEY directly.
    revokedUrls = [];
    await act(async () => {
      seedBoth();
      window.dispatchEvent(new StorageEvent("storage", { key: CATALOG_STORAGE_KEY, newValue: "{}" }));
    });
    await act(async () => {
      emitIntersection(["p-grid"], true);
      await vi.runAllTimersAsync();
    });
    expect(container.querySelectorAll(".phome-card")).toHaveLength(1);
    expect(container.querySelector('.phome-hero img[src="blob:test:blob:p-hero:img"]')).not.toBeNull();
    expect(container.querySelector('[data-project-id="p-grid"] img[src="blob:test:blob:p-grid:img"]')).not.toBeNull();

    await act(async () => {
      window.localStorage.removeItem(CATALOG_STORAGE_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: CATALOG_STORAGE_KEY, newValue: null }));
      await vi.runAllTimersAsync();
    });

    expect(container.querySelector(".phome-hero")).toBeNull();
    expect(container.querySelectorAll(".phome-card")).toHaveLength(0);
    expect(container.textContent).toContain("这里还没有项目");
    expect(revokedUrls).toContain("blob:test:blob:p-hero:img");
    expect(revokedUrls).toContain("blob:test:blob:p-grid:img");
  });

  it("separates local text pressure from origin image storage, ignores unknown readings, and coalesces refresh events", async () => {
    const heavy = createBlankWorkspace("p-heavy");
    heavy.project.title = "大型文本项目";
    writeProjectWorkspace(window.localStorage, heavy);
    window.localStorage.setItem(
      CATALOG_STORAGE_KEY,
      JSON.stringify(createCatalog([summarizeProject(heavy)], heavy.project.id))
    );

    let localQuota = LOCAL_TEXT_STORAGE_WARNING_BYTES;
    let originUsage: OriginStorageUsage = {
      status: "ok",
      usageBytes: 1058,
      quotaBytes: 3 * 1024 * 1024 * 1024,
      usedShare: 1058 / (3 * 1024 * 1024 * 1024)
    };
    const measureMock = vi.mocked(measureLocalTextStorage).mockImplementation(() => ({
      status: "ok",
      quotaBytes: localQuota,
      entryCount: 2
    }));
    measureMock.mockClear();
    vi.mocked(estimateOriginStorage).mockImplementation(async () => originUsage);

    await act(async () => {
      root.render(createElement(ProjectHomeClient, { account: null, authRequired: false }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // First catalog render must NOT be blocked by scanning localStorage.
    expect(container.querySelector(".phome-hero h2")?.textContent).toBe("大型文本项目");
    expect(measureMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const footerText = () => container.querySelector(".phome-foot")?.textContent ?? "";
    // Local text high while origin estimate shows ~3 GiB free -> show local text warning, NOT origin warning or fake %.
    expect(footerText()).toContain("本机项目记录较多，建议导出备份；图片存储可用空间不代表项目记录仍可继续保存。");
    expect(footerText()).not.toContain("本地图片与文件存储空间已接近上限");
    expect(footerText()).not.toContain("%");

    // Typing in search must NOT re-scan storage.
    const callsBeforeSearch = measureMock.mock.calls.length;
    const searchInput = container.querySelector(".phome-search input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(searchInput, "大型");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.runAllTimersAsync();
    });
    expect(measureMock.mock.calls.length).toBe(callsBeforeSearch);

    // Rapid storage + visibilitychange events coalesce into a single scan, and reflect lowered pressure (e.g. after delete) or high origin image pressure.
    localQuota = 1024;
    originUsage = {
      status: "ok",
      usageBytes: 9 * 1024 * 1024,
      quotaBytes: 10 * 1024 * 1024,
      usedShare: 0.9
    };
    const callsBeforeBurst = measureMock.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "other-key", newValue: "1" }));
      window.dispatchEvent(new StorageEvent("storage", { key: "other-key", newValue: "2" }));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(120);
      await Promise.resolve();
    });
    expect(measureMock.mock.calls.length - callsBeforeBurst).toBe(1);
    expect(footerText()).not.toContain("本机项目记录较多");
    expect(footerText()).toContain("本地图片与文件存储空间已接近上限");

    // Unknown readings must not fabricate warnings or "0 MB" free claims.
    vi.mocked(measureLocalTextStorage).mockImplementation(() => ({ status: "unknown" }));
    originUsage = { status: "unknown" };
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "other-key", newValue: "3" }));
      await vi.advanceTimersByTimeAsync(120);
      await Promise.resolve();
    });
    expect(footerText()).not.toContain("本机项目记录较多");
    expect(footerText()).not.toContain("本地图片与文件存储空间已接近上限");
  });

  it("cancels deferred initial storage scan if unmounted before the idle timer fires", async () => {
    const sample = createBlankWorkspace("p-unmount");
    writeProjectWorkspace(window.localStorage, sample);
    window.localStorage.setItem(
      CATALOG_STORAGE_KEY,
      JSON.stringify(createCatalog([summarizeProject(sample)], sample.project.id))
    );
    const measureMock = vi.mocked(measureLocalTextStorage);
    measureMock.mockClear();

    await act(async () => {
      root.render(createElement(ProjectHomeClient, { account: null, authRequired: false }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector(".phome-hero")).not.toBeNull();
    expect(measureMock).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await vi.runAllTimersAsync();
    });
    expect(measureMock).not.toHaveBeenCalled();
  });

  it("exports backup directly from hero, pending cards, and search results, coalesces duplicate clicks, and refuses missing assets", async () => {
    const hero = createBlankWorkspace("p-hero-exp");
    hero.project.title = "最近项目";
    hero.project.lastOpenedAt = "2026-10-10T10:00:00.000Z";
    const offscreen = createBlankWorkspace("p-off-exp");
    offscreen.project.title = "未加载项目";
    offscreen.project.lastOpenedAt = "2026-10-09T10:00:00.000Z";
    const brokenImg = buildSampleImageProject("p-img-exp", "缺图项目", "2026-10-08T10:00:00.000Z");
    brokenImg.project.lastOpenedAt = "2026-10-08T10:00:00.000Z";

    writeProjectWorkspace(window.localStorage, hero);
    writeProjectWorkspace(window.localStorage, offscreen);
    writeProjectWorkspace(window.localStorage, brokenImg);
    const rawCatalog = JSON.stringify(
      createCatalog([summarizeProject(hero), summarizeProject(offscreen), summarizeProject(brokenImg)], hero.project.id)
    );
    window.localStorage.setItem(CATALOG_STORAGE_KEY, rawCatalog);
    const rawOffscreen = window.localStorage.getItem(getProjectWorkspaceStorageKey(offscreen.project.id));

    await act(async () => {
      root.render(createElement(ProjectHomeClient, { account: null, authRequired: false }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Offscreen card is still pending, yet direct export works without opening delete confirmation or loading preview.
    expect(
      container.querySelector('[data-project-id="p-off-exp"] .project-canvas-preview')?.getAttribute("data-preview-status")
    ).toBe("pending");

    const exportBtn = container.querySelector('button[aria-label="导出项目备份：未加载项目"]') as HTMLButtonElement;
    const deleteBtn = container.querySelector('button[aria-label="删除项目：未加载项目"]') as HTMLButtonElement;
    expect(exportBtn).not.toBeNull();

    // Defer export bundle generation to verify duplicate clicks only start one export and disable concurrent delete.
    const exportMock = vi.mocked(exportEditableProjectBackupBundle);
    const actualBundle = await vi.importActual<typeof import("@/features/archive/projectBundleClient")>(
      "@/features/archive/projectBundleClient"
    );
    let resolveExport!: (value: Awaited<ReturnType<typeof actualBundle.exportEditableProjectBackupBundle>>) => void;
    exportMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        })
    );

    await act(async () => {
      exportBtn.click();
      exportBtn.click();
    });
    expect(exportMock).toHaveBeenCalledTimes(1);
    expect(exportBtn.disabled).toBe(true);
    expect(deleteBtn.disabled).toBe(true);
    expect(container.textContent).toContain("正在导出备份…");

    const realResult = await actualBundle.exportEditableProjectBackupBundle(offscreen, {
      blobStore: indexedDbBlobStore,
      chat: "full",
      projectContinuity: "current"
    });
    await act(async () => {
      resolveExport(realResult);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(downloadProjectBundleFile).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("最近已保存内容");
    expect(window.localStorage.getItem(getProjectWorkspaceStorageKey(offscreen.project.id))).toBe(rawOffscreen);
    expect(window.localStorage.getItem(CATALOG_STORAGE_KEY)).toBe(rawCatalog);

    // Search results preserve direct export; missing source asset refuses export without downloading.
    const searchInput = container.querySelector(".phome-search input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(searchInput, "缺图项目");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.runAllTimersAsync();
    });

    vi.mocked(downloadProjectBundleFile).mockClear();
    const brokenExportBtn = container.querySelector('button[aria-label="导出项目备份：缺图项目"]') as HTMLButtonElement;
    await act(async () => {
      brokenExportBtn.click();
      await vi.runAllTimersAsync();
    });
    expect(downloadProjectBundleFile).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("最近已保存内容");
    expect(container.querySelector(".phome-restore-message.warning, .phome-restore-message.error")).not.toBeNull();
  });
});
