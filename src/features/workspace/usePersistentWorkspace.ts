"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { reconcileProjectMemoryAfterWorkspaceChange } from "@/domain/morpho/projectMemory";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import { persistProjectWorkspaceAndSummary } from "@/infrastructure/persistence/localProjectStore";
import {
  requestStorageDurability,
  type StorageDurabilityStatus
} from "@/infrastructure/persistence/storageDurability";
import {
  createWorkspacePersistenceController,
  type WorkspacePersistenceController,
  type WorkspacePersistenceState
} from "./workspacePersistence";
import {
  acquireLeaseThenLoadWorkspace,
  type PersistentWorkspaceLoadResult
} from "./workspaceInitialization";

export function usePersistentWorkspace(projectId: string) {
  const [loadResult, setLoadResult] = useState<PersistentWorkspaceLoadResult>(() => ({
    workspace: createBlankWorkspace(projectId)
  }));
  const [hasLoaded, setHasLoaded] = useState(false);
  const [workspace, setWorkspace] = useState<MorphoWorkspace>(() => createBlankWorkspace(projectId));
  const [persistence, setPersistence] = useState<WorkspacePersistenceState>({ phase: "loading", isDirty: false });
  const [storageDurability, setStorageDurability] = useState<StorageDurabilityStatus>("unknown");
  const controllerRef = useRef<WorkspacePersistenceController | null>(null);
  const releaseLeaseRef = useRef<(() => void) | null>(null);

  /** Pending writes go out before the lease does, so the next tab reads them. */
  const releaseWorkspace = useCallback(() => {
    controllerRef.current?.flush();
    controllerRef.current?.dispose();
    controllerRef.current = null;
    releaseLeaseRef.current?.();
    releaseLeaseRef.current = null;
  }, []);

  // An evictable origin loses written work silently, so the grant is requested on
  // the workspace route too — not only on the project home a deep link skips.
  useEffect(() => {
    let isCancelled = false;
    void requestStorageDurability().then((durability) => {
      if (!isCancelled) {
        setStorageDurability(durability);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    releaseWorkspace();
    let isCancelled = false;

    const timeoutId = window.setTimeout(() => {
      const blankWorkspace = createBlankWorkspace(projectId);
      setLoadResult({ workspace: blankWorkspace });
      setHasLoaded(false);
      setWorkspace(blankWorkspace);
      setPersistence({ phase: "loading", isDirty: false });
      void (async () => {
        // Decide the cross-tab writer before any catalog migration, workspace
        // repair, case-study seeding, or other shared persistence work.
        const { lease, loaded } = await acquireLeaseThenLoadWorkspace(projectId);
        if (isCancelled) {
          if (lease.status === "granted") {
            lease.release();
          }
          return;
        }

        setLoadResult(loaded);
        setWorkspace(loaded.workspace);
        if (loaded.migrationError) {
          if (lease.status === "granted") {
            lease.release();
          }
          setHasLoaded(true);
          setPersistence({ phase: "error", isDirty: false, error: loaded.migrationError });
          return;
        }
        setHasLoaded(true);

        // Two tabs on one project do not merge: the second tab's write replaces
        // everything the first tab did. Whichever tab loses the lease stops
        // writing entirely rather than racing for last-write-wins.
        if (lease.status === "heldElsewhere") {
          setPersistence({ phase: "readOnly", isDirty: false });
          return;
        }

        if (lease.status === "granted") {
          releaseLeaseRef.current = lease.release;
        }

        controllerRef.current = createWorkspacePersistenceController({
          writer: (currentWorkspace) => persistProjectWorkspaceAndSummary(window.localStorage, currentWorkspace),
          onStateChange: setPersistence
        });
        setPersistence(controllerRef.current.getState());
      })();
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
      releaseWorkspace();
    };
  }, [projectId, releaseWorkspace]);

  useEffect(() => {
    if (!hasLoaded || loadResult.migrationError || typeof window === "undefined") {
      return;
    }

    if (workspace.project.id !== projectId) {
      return;
    }

    controllerRef.current?.schedule(workspace);
  }, [hasLoaded, loadResult.migrationError, projectId, workspace]);

  useEffect(() => {
    if (!hasLoaded || loadResult.migrationError || typeof window === "undefined") {
      return;
    }

    const flush = () => {
      controllerRef.current?.flush();
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };

    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [hasLoaded, loadResult.migrationError]);

  const flushWorkspace = useCallback(() => controllerRef.current?.flush() ?? persistence, [persistence]);
  const setReconciledWorkspace = useCallback((action: SetStateAction<MorphoWorkspace>) => {
    setWorkspace((current) => {
      const next = typeof action === "function" ? action(current) : action;
      return reconcileProjectMemoryAfterWorkspaceChange(current, next);
    });
  }, []);

  const isWorkspaceLoaded = hasLoaded && !loadResult.migrationError && workspace.project.id === projectId;

  return [
    workspace,
    setReconciledWorkspace,
    { ...persistence, migrationError: loadResult.migrationError, storageDurability, isWorkspaceLoaded },
    flushWorkspace
  ] as const;
}
