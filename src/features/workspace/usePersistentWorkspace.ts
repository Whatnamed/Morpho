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
  const [loadResult] = useState(() => loadWorkspace(projectId));
  const [workspace, setWorkspace] = useState<MorphoWorkspace>(loadResult.workspace);

  useEffect(() => {
    if (loadResult.migrationError || typeof window === "undefined") {
      return;
    }

    saveProjectWorkspace(window.localStorage, workspace);
    upsertProjectSummary(window.localStorage, workspace);
  }, [loadResult.migrationError, workspace]);

  return [workspace, setWorkspace, { migrationError: loadResult.migrationError }] as const;
}
