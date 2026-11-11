// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBlankWorkspace, createInitialWorkspace } from "@/domain/morpho/workspace";
import {
  CATALOG_STORAGE_KEY,
  createCatalog,
  getProjectWorkspaceStorageKey,
  saveProjectWorkspace,
  summarizeProject
} from "@/infrastructure/persistence/localProjectStore";
import { ProjectHomeClient } from "./ProjectHomeClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}));

vi.mock("@/infrastructure/assets/currentCaseStudyAssetInstaller", () => ({
  ensureCurrentCaseStudyAssets: vi.fn(async () => [])
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
});
