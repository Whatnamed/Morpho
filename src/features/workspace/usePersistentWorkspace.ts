"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import { interruptActiveOperations } from "@/domain/operations/operations";
import {
  initializeLocalProjectCatalog,
  loadProjectWorkspace,
  persistProjectWorkspaceAndSummary
} from "@/infrastructure/persistence/localProjectStore";
import {
  createWorkspacePersistenceController,
  type WorkspacePersistenceController,
  type WorkspacePersistenceState
} from "./workspacePersistence";

type PersistentWorkspaceLoadResult = {
  workspace: MorphoWorkspace;
  migrationError?: string;
};

function loadWorkspace(projectId: string): PersistentWorkspaceLoadResult {
  if (typeof window === "undefined") {
    return { workspace: createBlankWorkspace(projectId) };
  }

  const catalog = initializeLocalProjectCatalog(window.localStorage);
  if (catalog.status === "failed") {
    return {
      workspace: createBlankWorkspace(projectId),
      migrationError: catalog.reason
    };
  }

  const loaded = loadProjectWorkspace(window.localStorage, projectId);
  if (loaded.status === "ok") {
    return { workspace: interruptActiveOperations(loaded.workspace, "browserReload") };
  }

  return {
    workspace: createBlankWorkspace(projectId),
    migrationError: loaded.reason
  };
}

export function usePersistentWorkspace(projectId: string) {
  const [loadResult, setLoadResult] = useState<PersistentWorkspaceLoadResult>(() => ({
    workspace: createBlankWorkspace(projectId)
  }));
  const [hasLoaded, setHasLoaded] = useState(false);
  const [workspace, setWorkspace] = useState<MorphoWorkspace>(() => createBlankWorkspace(projectId));
  const [persistence, setPersistence] = useState<WorkspacePersistenceState>({ phase: "loading", isDirty: false });
  const controllerRef = useRef<WorkspacePersistenceController | null>(null);

  useEffect(() => {
    controllerRef.current?.flush();
    controllerRef.current?.dispose();
    controllerRef.current = null;

    const timeoutId = window.setTimeout(() => {
      const loaded = loadWorkspace(projectId);
      setLoadResult(loaded);
      setWorkspace(loaded.workspace);
      setHasLoaded(true);
      if (loaded.migrationError) {
        setPersistence({ phase: "error", isDirty: false, error: loaded.migrationError });
        return;
      }

      controllerRef.current = createWorkspacePersistenceController({
        writer: (currentWorkspace) => persistProjectWorkspaceAndSummary(window.localStorage, currentWorkspace),
        onStateChange: setPersistence
      });
      setPersistence(controllerRef.current.getState());
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      controllerRef.current?.flush();
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, [projectId]);

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

  return [workspace, setWorkspace, { ...persistence, migrationError: loadResult.migrationError }, flushWorkspace] as const;
}
