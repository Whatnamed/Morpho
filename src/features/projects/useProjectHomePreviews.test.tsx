// @vitest-environment happy-dom

import { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBlankWorkspace, createInitialWorkspace } from "@/domain/morpho/workspace";
import {
  CATALOG_STORAGE_KEY,
  createCatalog,
  getProjectWorkspaceStorageKey,
  loadProjectWorkspace,
  saveProjectWorkspace,
  summarizeProject,
  type LocalProjectCatalog
} from "@/infrastructure/persistence/localProjectStore";
import { ProjectCanvasPreview } from "./ProjectCanvasPreview";
import { useProjectHomePreviews } from "./useProjectHomePreviews";

const deferredBlobPromises = new Map<string, (value: string | null) => void>();
const deferBlobKeys = new Set<string>();
const assetLoadCalls: string[] = [];

vi.mock("@/infrastructure/assets/indexedDbAssetStore", () => ({
  getAssetObjectUrl: vi.fn((storageKey: string) => {
    assetLoadCalls.push(storageKey);
    if (deferBlobKeys.has(storageKey)) {
      return new Promise<string | null>((resolve) => {
        deferredBlobPromises.set(storageKey, resolve);
      });
    }
    return Promise.resolve(`blob:url-for-${storageKey}`);
  })
}));

type ObserverRecord = {
  callback: IntersectionObserverCallback;
  targets: Set<Element>;
};

let activeObservers: ObserverRecord[] = [];
let revokedUrls: string[] = [];
let originalRevokeObjectURL: typeof URL.revokeObjectURL;
let originalIntersectionObserver: typeof window.IntersectionObserver | undefined;

function installObserverMock() {
  activeObservers = [];
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly scrollMargin = "0px";
    readonly thresholds: ReadonlyArray<number>;
    private readonly record: ObserverRecord;

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.root = options?.root ?? null;
      this.rootMargin = options?.rootMargin ?? "0px";
      this.thresholds = [0];
      this.record = { callback, targets: new Set() };
      activeObservers.push(this.record);
    }

    observe(target: Element): void {
      this.record.targets.add(target);
    }

    unobserve(target: Element): void {
      this.record.targets.delete(target);
    }

    disconnect(): void {
      this.record.targets.clear();
      activeObservers = activeObservers.filter((item) => item !== this.record);
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  Object.defineProperty(window, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: MockIntersectionObserver
  });
}

function triggerIntersections(updates: Array<{ projectId: string; isIntersecting: boolean }>) {
  const byId = new Map(updates.map((u) => [u.projectId, u.isIntersecting]));
  for (const obs of [...activeObservers]) {
    const entries: IntersectionObserverEntry[] = [];
    for (const target of obs.targets) {
      const id = target.getAttribute("data-project-id");
      if (!id || !byId.has(id)) continue;
      const isIntersecting = Boolean(byId.get(id));
      entries.push({
        target,
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
        boundingClientRect: target.getBoundingClientRect(),
        intersectionRect: target.getBoundingClientRect(),
        rootBounds: null,
        time: performance.now()
      });
    }
    if (entries.length > 0) {
      obs.callback(entries, {} as IntersectionObserver);
    }
  }
}

function buildImageWorkspace(projectId: string, title: string, assetId: string, storageKey: string) {
  const base = createInitialWorkspace();
  const previewImage = base.objects["image-soft-rail-preview"];
  if (!previewImage || previewImage.type !== "image") {
    throw new Error("Expected image object in initial workspace.");
  }
  return {
    ...base,
    project: {
      ...base.project,
      id: projectId,
      title,
      updatedAt: "2026-10-01T00:00:00.000Z"
    },
    objects: {
      [previewImage.id]: { ...previewImage, assetId }
    },
    canvas: {
      ...base.canvas,
      instances: base.canvas.instances.filter((inst) => inst.objectId === previewImage.id)
    },
    assets: {
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

type HarnessProps = {
  catalog: LocalProjectCatalog | null;
  recentProjectId?: string;
  visibleGridProjectIds: string[];
  enabled?: boolean;
  onRead?: (projectId: string) => void;
  onExternalCatalogChange?: () => void;
  onApiReady?: (api: { invalidateProjects: (ids?: readonly string[]) => void }) => void;
};

function PreviewHarness({
  catalog,
  recentProjectId,
  visibleGridProjectIds,
  enabled = true,
  onRead,
  onExternalCatalogChange,
  onApiReady
}: HarnessProps) {
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const { getPreviewState, storageKeyUrls, registerCardElement, invalidateProjects } = useProjectHomePreviews({
    catalog,
    recentProjectId,
    visibleGridProjectIds,
    scrollRootRef,
    enabled,
    onExternalCatalogChange,
    loadWorkspaceReadOnly: (storage, projectId) => {
      onRead?.(projectId);
      return loadProjectWorkspace(storage, projectId, { mode: "readOnly" });
    }
  });

  useEffect(() => {
    onApiReady?.({ invalidateProjects });
  }, [invalidateProjects, onApiReady]);

  const heroState = recentProjectId ? getPreviewState(recentProjectId) : null;

  return (
    <div className="phome-main" ref={scrollRootRef}>
      {recentProjectId ? (
        <div data-testid="hero" data-project-id={recentProjectId}>
          <ProjectCanvasPreview
            preview={heroState?.preview}
            previewStatus={heroState?.status ?? "pending"}
            storageKeyUrls={storageKeyUrls}
          />
        </div>
      ) : null}
      <div className="phome-grid">
        {visibleGridProjectIds.map((id) => {
          const state = getPreviewState(id);
          return (
            <article key={id} data-project-id={id} ref={(el) => registerCardElement(id, el)}>
              <ProjectCanvasPreview
                preview={state.preview}
                previewStatus={state.status}
                storageKeyUrls={storageKeyUrls}
              />
            </article>
          );
        })}
      </div>
    </div>
  );
}

describe("useProjectHomePreviews", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    window.localStorage.clear();
    deferredBlobPromises.clear();
    deferBlobKeys.clear();
    assetLoadCalls.length = 0;
    revokedUrls = [];
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
    originalIntersectionObserver = window.IntersectionObserver;
    installObserverMock();

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

  it("prioritizes recentProject, schedules per-card async tasks, and skips offscreen cards", async () => {
    const workspaces = [
      buildImageWorkspace("p0", "Recent", "a0", "blob:p0"),
      buildImageWorkspace("p1", "Visible 1", "a1", "blob:p1"),
      buildImageWorkspace("p2", "Visible 2", "a2", "blob:p2"),
      buildImageWorkspace("p3", "Offscreen 3", "a3", "blob:p3"),
      buildImageWorkspace("p4", "Offscreen 4", "a4", "blob:p4")
    ];
    for (const ws of workspaces) {
      saveProjectWorkspace(window.localStorage, ws);
    }
    const catalog = createCatalog(
      workspaces.map((ws) => summarizeProject(ws)),
      "p0"
    );
    window.localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog));

    const readOrder: string[] = [];

    await act(async () => {
      root.render(
        <PreviewHarness
          catalog={catalog}
          recentProjectId="p0"
          visibleGridProjectIds={["p1", "p2", "p3", "p4"]}
          onRead={(id) => readOrder.push(id)}
        />
      );
    });

    // Catalog renders immediately before async timers run; zero workspaces read synchronously.
    expect(readOrder).toEqual([]);
    const heroPreviewEl = container.querySelector('[data-testid="hero"] .project-canvas-preview');
    expect(heroPreviewEl?.getAttribute("data-preview-status")).toBe("pending");
    expect(heroPreviewEl?.classList.contains("is-empty")).toBe(false);
    expect(container.querySelector(".project-preview-empty-mark")).toBeNull();

    await act(async () => {
      triggerIntersections([
        { projectId: "p1", isIntersecting: true },
        { projectId: "p2", isIntersecting: true },
        { projectId: "p3", isIntersecting: false },
        { projectId: "p4", isIntersecting: false }
      ]);
    });

    // First macrotask processes ONLY the recent hero project, yielding main thread before p1/p2.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readOrder).toEqual(["p0"]);

    // Subsequent macrotasks load visible grid cards (p1, p2) and stop without reading offscreen p3/p4.
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(readOrder).toEqual(["p0", "p1", "p2"]);
    expect(assetLoadCalls).toEqual(["blob:p0", "blob:p1", "blob:p2"]);
    expect(assetLoadCalls).not.toContain("blob:p3");
    expect(assetLoadCalls).not.toContain("blob:p4");

    // Scrolling p3 into view loads p3 cleanly, and scrolling away + back does NOT reload p3.
    await act(async () => {
      triggerIntersections([{ projectId: "p3", isIntersecting: true }]);
      await vi.runAllTimersAsync();
    });
    expect(readOrder).toEqual(["p0", "p1", "p2", "p3"]);

    await act(async () => {
      triggerIntersections([{ projectId: "p3", isIntersecting: false }]);
      triggerIntersections([{ projectId: "p3", isIntersecting: true }]);
      await vi.runAllTimersAsync();
    });
    expect(readOrder).toEqual(["p0", "p1", "p2", "p3"]);
    expect(assetLoadCalls.filter((key) => key === "blob:p3")).toHaveLength(1);
    expect(readOrder).not.toContain("p4");
  });

  it("revokes filtered/deleted image URLs, preserves shared storageKeys still in view, and drops late async results", async () => {
    deferBlobKeys.add("blob:late-delete");

    const workspaces = [
      buildImageWorkspace("p1", "Unique A", "asset-shared", "blob:p1-unique"),
      buildImageWorkspace("p2", "Shared A", "asset-shared", "blob:shared-1-2"),
      buildImageWorkspace("p3", "Shared B", "asset-shared", "blob:shared-1-2"),
      buildImageWorkspace("p4", "Late Delete", "asset-late", "blob:late-delete")
    ];
    for (const ws of workspaces) {
      saveProjectWorkspace(window.localStorage, ws);
    }
    const catalog = createCatalog(
      workspaces.map((ws) => summarizeProject(ws)),
      undefined
    );

    const reads: string[] = [];

    const renderWithGrid = async (nextCatalog: LocalProjectCatalog, gridIds: string[]) => {
      await act(async () => {
        root.render(
          <PreviewHarness
            catalog={nextCatalog}
            visibleGridProjectIds={gridIds}
            onRead={(id) => reads.push(id)}
          />
        );
      });
    };

    await renderWithGrid(catalog, ["p1", "p2", "p3", "p4"]);
    await act(async () => {
      triggerIntersections([
        { projectId: "p1", isIntersecting: true },
        { projectId: "p2", isIntersecting: true },
        { projectId: "p3", isIntersecting: true },
        { projectId: "p4", isIntersecting: true }
      ]);
      await vi.runAllTimersAsync();
    });

    expect(container.querySelector('[data-project-id="p1"] img')?.getAttribute("src")).toBe("blob:url-for-blob:p1-unique");
    expect(container.querySelector('[data-project-id="p2"] img')?.getAttribute("src")).toBe("blob:url-for-blob:shared-1-2");
    expect(container.querySelector('[data-project-id="p3"] img')?.getAttribute("src")).toBe("blob:url-for-blob:shared-1-2");
    expect(deferredBlobPromises.has("blob:late-delete")).toBe(true);

    // Search filters out p1 and p4 while deleting p4; p2 & p3 still keep blob:shared-1-2 alive.
    const catalogAfterDelete = {
      ...catalog,
      projects: catalog.projects.filter((p) => p.id !== "p4")
    };
    await renderWithGrid(catalogAfterDelete, ["p2", "p3"]);

    expect(revokedUrls).toContain("blob:url-for-blob:p1-unique");
    expect(revokedUrls).not.toContain("blob:url-for-blob:shared-1-2");

    // Late IDB blob resolution for deleted p4 must revoke immediately and not linger.
    await act(async () => {
      deferredBlobPromises.get("blob:late-delete")?.("blob:stale-late-p4");
      await Promise.resolve();
    });
    expect(revokedUrls).toContain("blob:stale-late-p4");

    // Narrow search out of p2, keeping p3 -> shared URL stays active.
    await renderWithGrid(catalogAfterDelete, ["p3"]);
    expect(revokedUrls).not.toContain("blob:url-for-blob:shared-1-2");

    // Narrow search to zero results -> now shared URL revokes too.
    await renderWithGrid(catalogAfterDelete, []);
    expect(revokedUrls).toContain("blob:url-for-blob:shared-1-2");
  });

  it("isolates errors, invalidates by projectId across rename/storage/bfcache, and never writes readOnly migrations", async () => {
    const legacy = createBlankWorkspace("p-legacy");
    // Ensure a valid current workspace plus one legacy schema (< current) plus one corrupted JSON key.
    const legacyRaw = JSON.stringify({ ...legacy, schemaVersion: legacy.schemaVersion - 1 });
    window.localStorage.setItem(getProjectWorkspaceStorageKey("p-legacy"), legacyRaw);
    window.localStorage.setItem(getProjectWorkspaceStorageKey("p-corrupt"), "{not-json");

    const good = buildImageWorkspace("p-good", "Good", "asset-good", "blob:good");
    saveProjectWorkspace(window.localStorage, good);

    const catalog = createCatalog(
      [
        {
          id: "p-corrupt",
          title: "Corrupt",
          subtitle: "",
          lastOpenedAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z"
        },
        summarizeProject(legacy),
        summarizeProject(good)
      ],
      "p-corrupt"
    );

    const reads: string[] = [];
    const externalCatalogChanges = vi.fn();
    let api: { invalidateProjects: (ids?: readonly string[]) => void } | undefined;

    await act(async () => {
      root.render(
        <PreviewHarness
          catalog={catalog}
          recentProjectId="p-corrupt"
          visibleGridProjectIds={["p-legacy", "p-good"]}
          onRead={(id) => reads.push(id)}
          onExternalCatalogChange={externalCatalogChanges}
          onApiReady={(next) => {
            api = next;
          }}
        />
      );
    });

    await act(async () => {
      triggerIntersections([
        { projectId: "p-legacy", isIntersecting: true },
        { projectId: "p-good", isIntersecting: true }
      ]);
      await vi.runAllTimersAsync();
    });

    // Corrupt hero shows error placeholder (NOT .is-empty) and does not block subsequent good card.
    const corruptEl = container.querySelector('[data-testid="hero"] .project-canvas-preview');
    expect(corruptEl?.getAttribute("data-preview-status")).toBe("error");
    expect(corruptEl?.classList.contains("is-empty")).toBe(false);
    expect(corruptEl?.querySelector(".project-preview-empty-mark")).toBeNull();
    expect(container.querySelector('[data-project-id="p-good"] img')?.getAttribute("src")).toBe("blob:url-for-blob:good");

    // Read-only preview loading must never rewrite old schema entries in localStorage.
    expect(window.localStorage.getItem(getProjectWorkspaceStorageKey("p-legacy"))).toBe(legacyRaw);

    // Local rename (same updatedAt) or cross-tab storage event invalidates targeted projectId.
    reads.length = 0;
    await act(async () => {
      api?.invalidateProjects(["p-good"]);
      await vi.runAllTimersAsync();
    });
    expect(reads).toEqual(["p-good"]);

    reads.length = 0;
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: getProjectWorkspaceStorageKey("p-legacy"),
          newValue: legacyRaw
        })
      );
      await vi.runAllTimersAsync();
    });
    expect(reads).toEqual(["p-legacy"]);

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: CATALOG_STORAGE_KEY,
          newValue: "{}"
        })
      );
    });
    expect(externalCatalogChanges).toHaveBeenCalledTimes(1);

    // bfcache return triggers catalog refresh and visible invalidation.
    reads.length = 0;
    await act(async () => {
      const ev = new Event("pageshow") as Event & { persisted: boolean };
      Object.defineProperty(ev, "persisted", { value: true });
      window.dispatchEvent(ev);
      await vi.runAllTimersAsync();
    });
    expect(externalCatalogChanges).toHaveBeenCalledTimes(2);
    expect(reads).toEqual(["p-corrupt", "p-legacy", "p-good"]);
  });

  it("drops queued workspace reads before execution if deleted or unmounted", async () => {
    const p1 = buildImageWorkspace("p1", "One", "a1", "blob:p1");
    saveProjectWorkspace(window.localStorage, p1);
    const catalog = createCatalog([summarizeProject(p1)], undefined);
    const reads: string[] = [];

    await act(async () => {
      root.render(
        <PreviewHarness
          catalog={catalog}
          visibleGridProjectIds={["p1"]}
          onRead={(id) => reads.push(id)}
        />
      );
      triggerIntersections([{ projectId: "p1", isIntersecting: true }]);
    });

    // Delete/unmount before queued macrotask fires.
    await act(async () => {
      root.unmount();
      await vi.runAllTimersAsync();
    });
    expect(reads).toEqual([]);
    // Recreate root for afterEach cleanup.
    root = createRoot(container);
  });
});
