// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CURRENT_CASE_STUDY_ASSET_MANIFEST_VERSION,
  CURRENT_CASE_STUDY_FINGERPRINT,
  CURRENT_CASE_STUDY_ID,
  CURRENT_CASE_STUDY_VERSION
} from "@/domain/morpho/caseStudy/currentCaseStudy";
import { writeCaseStudyInstallationMarker } from "@/domain/morpho/caseStudy/caseStudyInstallation";
import { createBlankWorkspace, createCurrentCaseStudyWorkspace, createInitialWorkspace } from "@/domain/morpho/workspace";
import {
  CATALOG_STORAGE_KEY,
  createCatalog,
  getProjectWorkspaceStorageKey,
  saveProjectWorkspace,
  summarizeProject
} from "@/infrastructure/persistence/localProjectStore";
import { ensureCurrentCaseStudyAssetsWithResult } from "@/infrastructure/assets/currentCaseStudyAssetInstaller";
import { getAssetObjectUrl } from "@/infrastructure/assets/indexedDbAssetStore";
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
  indexedDbBlobStore: { delete: vi.fn(async () => {}) },
  getAssetObjectUrl: vi.fn(async (storageKey: string) => `blob:test:${storageKey}`)
}));

vi.mock("@/infrastructure/persistence/storageDurability", () => ({
  requestStorageDurability: vi.fn(async () => "unknown"),
  estimateOriginStorage: vi.fn(async () => ({ status: "unknown" })),
  formatStorageSize: vi.fn(() => "0 B"),
  isOriginStorageUnderPressure: vi.fn(() => false)
}));

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
  const base = createInitialWorkspace();
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

  it("shows placeholder signals instead of 0 before Hero resolves, renders real counts once ready, and isolates corrupt/offscreen cards", async () => {
    const hero = buildSampleImageProject("p-hero", "主方向项目", "2026-10-10T10:00:00.000Z");
    const visible = buildSampleImageProject("p-vis", "可见小项目", "2026-10-09T10:00:00.000Z");
    const offscreen = createBlankWorkspace("p-off");
    offscreen.project.title = "未滚入视口";
    const legacyRaw = JSON.stringify({ ...offscreen, schemaVersion: offscreen.schemaVersion - 1 });

    saveProjectWorkspace(window.localStorage, hero);
    saveProjectWorkspace(window.localStorage, visible);
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

    saveProjectWorkspace(window.localStorage, caseWs);
    const storedBefore = window.localStorage.getItem(getProjectWorkspaceStorageKey(CURRENT_CASE_STUDY_ID));
    const catalog = createCatalog([summarizeProject(caseWs)], CURRENT_CASE_STUDY_ID);
    window.localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog));
    writeCaseStudyInstallationMarker(window.localStorage, {
      assetManifestVersion: CURRENT_CASE_STUDY_ASSET_MANIFEST_VERSION,
      installedVersion: CURRENT_CASE_STUDY_VERSION,
      projectId: CURRENT_CASE_STUDY_ID,
      workspaceFingerprint: CURRENT_CASE_STUDY_FINGERPRINT
    });

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
      saveProjectWorkspace(window.localStorage, hero);
      saveProjectWorkspace(window.localStorage, grid);
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
});
