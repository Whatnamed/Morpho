"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { AssetRecord } from "@/domain/morpho/types";
import {
  CATALOG_STORAGE_KEY,
  loadProjectWorkspace,
  parseProjectWorkspaceStorageKey,
  type LocalProjectCatalog,
  type ProjectWorkspaceLoadResult
} from "@/infrastructure/persistence/localProjectStore";
import { useWorkspaceAssetUrls } from "@/features/workspace/useWorkspaceAssetUrls";
import {
  extractProjectPreviewSnapshot,
  type ProjectPreviewSnapshot,
  type ProjectPreviewStatus
} from "./ProjectCanvasPreview";

const DEFAULT_ROOT_MARGIN = "120px 0px";

type ProjectPreviewEntry =
  | {
      status: "ready";
      snapshot: ProjectPreviewSnapshot;
      epoch: number;
    }
  | {
      status: "error";
      epoch: number;
    };

export type UseProjectHomePreviewsOptions = {
  catalog: LocalProjectCatalog | null;
  recentProjectId?: string;
  visibleGridProjectIds: readonly string[];
  scrollRootRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onExternalCatalogChange?: () => void;
  /** Injectable for deterministic unit tests; defaults to read-only localStorage load. */
  loadWorkspaceReadOnly?: (storage: Storage, projectId: string) => ProjectWorkspaceLoadResult;
  rootMargin?: string;
};

export type UseProjectHomePreviewsResult = {
  getPreviewState: (projectId: string) => {
    status: ProjectPreviewStatus;
    preview?: ProjectPreviewSnapshot;
  };
  storageKeyUrls: Record<string, string>;
  registerCardElement: (projectId: string, element: HTMLElement | null) => void;
  invalidateProjects: (projectIds?: readonly string[]) => void;
};

function defaultLoadWorkspaceReadOnly(storage: Storage, projectId: string): ProjectWorkspaceLoadResult {
  return loadProjectWorkspace(storage, projectId, { mode: "readOnly" });
}

export function useProjectHomePreviews({
  catalog,
  recentProjectId,
  visibleGridProjectIds,
  scrollRootRef,
  enabled,
  onExternalCatalogChange,
  loadWorkspaceReadOnly = defaultLoadWorkspaceReadOnly,
  rootMargin = DEFAULT_ROOT_MARGIN
}: UseProjectHomePreviewsOptions): UseProjectHomePreviewsResult {
  const [entriesState, setEntriesState] = useState<Record<string, ProjectPreviewEntry>>({});
  const [revealedIdsState, setRevealedIdsState] = useState<Set<string>>(() => new Set());

  const entriesRef = useRef<Map<string, ProjectPreviewEntry>>(new Map());
  const projectEpochRef = useRef<Map<string, number>>(new Map());
  const currentlyIntersectingRef = useRef<Set<string>>(new Set());
  const revealedIdsRef = useRef<Set<string>>(new Set());
  const elementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const elementToProjectIdRef = useRef<Map<Element, string>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const prevGridLayoutKeyRef = useRef<string | null>(null);
  const pumpTimerRef = useRef<number | null>(null);
  const isMountedRef = useRef(false);

  const catalogIds = useMemo(() => new Set(catalog?.projects.map((project) => project.id) ?? []), [catalog]);

  const activeRecentId =
    enabled && catalog && recentProjectId && catalogIds.has(recentProjectId) ? recentProjectId : undefined;

  const displayedIds = useMemo(() => {
    const ids = new Set<string>(visibleGridProjectIds);
    if (activeRecentId) {
      ids.add(activeRecentId);
    }
    return ids;
  }, [activeRecentId, visibleGridProjectIds]);

  const gridLayoutKey = visibleGridProjectIds.join("\u0000");

  const latestRef = useRef({
    enabled,
    catalog,
    catalogIds,
    displayedIds,
    activeRecentId,
    visibleGridProjectIds,
    loadWorkspaceReadOnly,
    onExternalCatalogChange
  });
  useEffect(() => {
    latestRef.current = {
      enabled,
      catalog,
      catalogIds,
      displayedIds,
      activeRecentId,
      visibleGridProjectIds,
      loadWorkspaceReadOnly,
      onExternalCatalogChange
    };
  });

  const clearPumpTimer = useCallback(() => {
    if (pumpTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(pumpTimerRef.current);
      pumpTimerRef.current = null;
    }
  }, []);

  const bumpEpoch = useCallback((projectId: string): number => {
    const next = (projectEpochRef.current.get(projectId) ?? 0) + 1;
    projectEpochRef.current.set(projectId, next);
    return next;
  }, []);

  const syncEntriesState = useCallback(() => {
    setEntriesState(Object.fromEntries(entriesRef.current.entries()));
  }, []);

  const pickNextTarget = useCallback((): { projectId: string; epoch: number } | null => {
    if (!isMountedRef.current || typeof window === "undefined") {
      return null;
    }
    const current = latestRef.current;
    if (!current.enabled || !current.catalog) {
      return null;
    }

    if (
      current.activeRecentId &&
      current.catalogIds.has(current.activeRecentId) &&
      !entriesRef.current.has(current.activeRecentId)
    ) {
      return {
        projectId: current.activeRecentId,
        epoch: projectEpochRef.current.get(current.activeRecentId) ?? 0
      };
    }

    const observerMissing = typeof window.IntersectionObserver === "undefined";
    for (const projectId of current.visibleGridProjectIds) {
      if (!current.catalogIds.has(projectId) || !current.displayedIds.has(projectId)) {
        continue;
      }
      if (entriesRef.current.has(projectId)) {
        continue;
      }
      if (
        observerMissing ||
        currentlyIntersectingRef.current.has(projectId) ||
        revealedIdsRef.current.has(projectId)
      ) {
        return {
          projectId,
          epoch: projectEpochRef.current.get(projectId) ?? 0
        };
      }
    }

    return null;
  }, []);

  const schedulePump = useCallback(() => {
    if (!isMountedRef.current || typeof window === "undefined") {
      return;
    }
    if (pumpTimerRef.current !== null) {
      return;
    }
    if (!pickNextTarget()) {
      return;
    }

    const runStep = () => {
      pumpTimerRef.current = null;
      if (!isMountedRef.current) {
        return;
      }

      const target = pickNextTarget();
      if (!target) {
        return;
      }

      const current = latestRef.current;
      let loaded: ProjectWorkspaceLoadResult;
      try {
        loaded = current.loadWorkspaceReadOnly(window.localStorage, target.projectId);
      } catch {
        loaded = { status: "failed", reason: "预览读取失败。" };
      }

      if (!isMountedRef.current) {
        return;
      }
      const after = latestRef.current;
      const latestEpoch = projectEpochRef.current.get(target.projectId) ?? 0;
      if (
        !after.enabled ||
        !after.catalogIds.has(target.projectId) ||
        !after.displayedIds.has(target.projectId) ||
        latestEpoch !== target.epoch
      ) {
        if (pickNextTarget()) {
          pumpTimerRef.current = window.setTimeout(runStep, 0);
        }
        return;
      }

      if (loaded.status === "ok") {
        entriesRef.current.set(target.projectId, {
          status: "ready",
          snapshot: extractProjectPreviewSnapshot(loaded.workspace),
          epoch: target.epoch
        });
      } else {
        entriesRef.current.set(target.projectId, {
          status: "error",
          epoch: target.epoch
        });
      }
      syncEntriesState();

      if (pickNextTarget()) {
        pumpTimerRef.current = window.setTimeout(runStep, 0);
      }
    };

    pumpTimerRef.current = window.setTimeout(runStep, 0);
  }, [pickNextTarget, syncEntriesState]);

  const invalidateProjects = useCallback(
    (projectIds?: readonly string[]) => {
      let entriesChanged = false;
      let revealedChanged = false;
      const current = latestRef.current;

      if (!projectIds) {
        const allIds = new Set<string>([
          ...entriesRef.current.keys(),
          ...current.catalogIds,
          ...revealedIdsRef.current
        ]);
        for (const projectId of allIds) {
          bumpEpoch(projectId);
          if (entriesRef.current.delete(projectId)) {
            entriesChanged = true;
          }
          const keepRevealed =
            projectId === current.activeRecentId || currentlyIntersectingRef.current.has(projectId);
          if (!keepRevealed && revealedIdsRef.current.delete(projectId)) {
            revealedChanged = true;
          }
        }
      } else {
        for (const projectId of projectIds) {
          bumpEpoch(projectId);
          if (entriesRef.current.delete(projectId)) {
            entriesChanged = true;
          }
          const keepRevealed =
            current.catalogIds.has(projectId) &&
            current.displayedIds.has(projectId) &&
            (projectId === current.activeRecentId || currentlyIntersectingRef.current.has(projectId));
          if (!keepRevealed && revealedIdsRef.current.delete(projectId)) {
            revealedChanged = true;
          }
        }
      }

      if (entriesChanged) {
        syncEntriesState();
      }
      if (revealedChanged) {
        setRevealedIdsState(new Set(revealedIdsRef.current));
      }
      clearPumpTimer();
      schedulePump();
    },
    [bumpEpoch, clearPumpTimer, schedulePump, syncEntriesState]
  );

  // Prune deleted/disabled entries and release URLs for filtered-out cards.
  useEffect(() => {
    let entriesChanged = false;
    let revealedChanged = false;

    if (!enabled || !catalog) {
      clearPumpTimer();
      for (const projectId of entriesRef.current.keys()) {
        bumpEpoch(projectId);
      }
      if (entriesRef.current.size > 0) {
        entriesRef.current.clear();
        entriesChanged = true;
      }
      if (revealedIdsRef.current.size > 0) {
        revealedIdsRef.current.clear();
        revealedChanged = true;
      }
      currentlyIntersectingRef.current.clear();
    } else {
      for (const projectId of [...entriesRef.current.keys()]) {
        if (!catalogIds.has(projectId)) {
          bumpEpoch(projectId);
          entriesRef.current.delete(projectId);
          entriesChanged = true;
        }
      }
      for (const projectId of [...currentlyIntersectingRef.current]) {
        if (!displayedIds.has(projectId)) {
          currentlyIntersectingRef.current.delete(projectId);
        }
      }
      for (const projectId of [...revealedIdsRef.current]) {
        if (!displayedIds.has(projectId)) {
          revealedIdsRef.current.delete(projectId);
          revealedChanged = true;
        }
      }
      if (activeRecentId && !revealedIdsRef.current.has(activeRecentId)) {
        revealedIdsRef.current.add(activeRecentId);
        revealedChanged = true;
      }
      if (typeof window !== "undefined" && typeof window.IntersectionObserver === "undefined") {
        for (const projectId of visibleGridProjectIds) {
          if (!revealedIdsRef.current.has(projectId)) {
            revealedIdsRef.current.add(projectId);
            revealedChanged = true;
          }
        }
      }
    }

    if (entriesChanged) {
      syncEntriesState();
    }
    if (revealedChanged) {
      setRevealedIdsState(new Set(revealedIdsRef.current));
    }
    schedulePump();
  }, [
    activeRecentId,
    bumpEpoch,
    catalog,
    catalogIds,
    clearPumpTimer,
    displayedIds,
    enabled,
    schedulePump,
    syncEntriesState,
    visibleGridProjectIds
  ]);

  // Mount lifecycle, IntersectionObserver on the real `.phome-main` scroll root, and cross-tab/bfcache listeners.
  useEffect(() => {
    isMountedRef.current = true;
    const rootElement = scrollRootRef.current ?? null;

    if (enabled && typeof window !== "undefined" && typeof window.IntersectionObserver !== "undefined") {
      const observer = new window.IntersectionObserver(
        (entries) => {
          if (!isMountedRef.current) return;
          let revealedChanged = false;
          let needsPump = false;
          const current = latestRef.current;

          for (const entry of entries) {
            const projectId = elementToProjectIdRef.current.get(entry.target);
            if (!projectId || !current.displayedIds.has(projectId)) {
              continue;
            }
            const intersecting = entry.isIntersecting || entry.intersectionRatio > 0;
            if (intersecting) {
              currentlyIntersectingRef.current.add(projectId);
              if (!revealedIdsRef.current.has(projectId)) {
                revealedIdsRef.current.add(projectId);
                revealedChanged = true;
              }
              if (!entriesRef.current.has(projectId)) {
                needsPump = true;
              }
            } else {
              currentlyIntersectingRef.current.delete(projectId);
            }
          }

          if (revealedChanged) {
            setRevealedIdsState(new Set(revealedIdsRef.current));
          }
          if (needsPump) {
            schedulePump();
          }
        },
        {
          root: rootElement,
          rootMargin,
          threshold: 0
        }
      );

      observerRef.current = observer;
      for (const element of elementsRef.current.values()) {
        observer.observe(element);
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (!isMountedRef.current) return;
      if (event.storageArea && event.storageArea !== window.localStorage) {
        return;
      }
      if (event.key === null) {
        latestRef.current.onExternalCatalogChange?.();
        invalidateProjects();
        return;
      }
      if (event.key === CATALOG_STORAGE_KEY) {
        latestRef.current.onExternalCatalogChange?.();
        return;
      }
      const changedProjectId = parseProjectWorkspaceStorageKey(event.key);
      if (changedProjectId) {
        invalidateProjects([changedProjectId]);
      }
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (!isMountedRef.current || !event.persisted) {
        return;
      }
      latestRef.current.onExternalCatalogChange?.();
      invalidateProjects();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("storage", handleStorage);
      window.addEventListener("pageshow", handlePageShow);
    }

    schedulePump();

    return () => {
      isMountedRef.current = false;
      clearPumpTimer();
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener("pageshow", handlePageShow);
      }
    };
  }, [clearPumpTimer, enabled, invalidateProjects, rootMargin, schedulePump, scrollRootRef]);

  // Re-evaluate intersection targets cleanly when filtering/sorting changes grid layout without remounting rows.
  useEffect(() => {
    if (prevGridLayoutKeyRef.current === null) {
      prevGridLayoutKeyRef.current = gridLayoutKey;
      return;
    }
    if (prevGridLayoutKeyRef.current === gridLayoutKey) {
      return;
    }
    prevGridLayoutKeyRef.current = gridLayoutKey;
    const observer = observerRef.current;
    if (!observer || !enabled) {
      return;
    }
    for (const element of elementsRef.current.values()) {
      observer.unobserve(element);
      observer.observe(element);
    }
  }, [enabled, gridLayoutKey]);

  const registerCardElement = useCallback((projectId: string, element: HTMLElement | null) => {
    const existing = elementsRef.current.get(projectId);
    if (existing && existing !== element) {
      observerRef.current?.unobserve(existing);
      elementToProjectIdRef.current.delete(existing);
      elementsRef.current.delete(projectId);
    }
    if (!element) {
      return;
    }
    elementsRef.current.set(projectId, element);
    elementToProjectIdRef.current.set(element, projectId);
    observerRef.current?.observe(element);
  }, []);

  const activePreviewAssets = useMemo(() => {
    if (!enabled || !catalog) {
      return {};
    }
    const assets: Record<string, AssetRecord> = {};
    for (const projectId of displayedIds) {
      if (projectId !== activeRecentId && !revealedIdsState.has(projectId)) {
        continue;
      }
      const entry = entriesState[projectId];
      if (entry?.status !== "ready") {
        continue;
      }
      for (const [storageKey, asset] of Object.entries(entry.snapshot.previewAssets)) {
        if (!assets[storageKey]) {
          assets[storageKey] = {
            ...asset,
            id: storageKey as AssetRecord["id"]
          };
        }
      }
    }
    return assets;
  }, [activeRecentId, catalog, displayedIds, enabled, entriesState, revealedIdsState]);

  const storageKeyUrls = useWorkspaceAssetUrls(activePreviewAssets);

  const getPreviewState = useCallback(
    (projectId: string): { status: ProjectPreviewStatus; preview?: ProjectPreviewSnapshot } => {
      const entry = entriesState[projectId];
      if (!entry) {
        return { status: "pending" };
      }
      if (entry.status === "error") {
        return { status: "error" };
      }
      return {
        status: "ready",
        preview: entry.snapshot
      };
    },
    [entriesState]
  );

  return {
    getPreviewState,
    storageKeyUrls,
    registerCardElement,
    invalidateProjects
  };
}
