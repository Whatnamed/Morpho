"use client";

import { useEffect, useState } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import {
  initializeLocalProjectCatalog,
  loadProjectWorkspace,
  saveProjectWorkspace,
  upsertProjectSummary
} from "@/infrastructure/persistence/localProjectStore";

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
    return { workspace: loaded.workspace };
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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const loaded = loadWorkspace(projectId);
      setLoadResult(loaded);
      setWorkspace(loaded.workspace);
      setHasLoaded(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [projectId]);

  useEffect(() => {
    if (!hasLoaded || loadResult.migrationError || typeof window === "undefined") {
      return;
    }

    saveProjectWorkspace(window.localStorage, workspace);
    upsertProjectSummary(window.localStorage, workspace);
  }, [hasLoaded, loadResult.migrationError, workspace]);

  return [workspace, setWorkspace, { migrationError: loadResult.migrationError }] as const;
}
