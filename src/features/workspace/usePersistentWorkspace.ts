"use client";

import { useEffect, useState } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  loadWorkspaceFromLocalStorage,
  saveWorkspaceToLocalStorage
} from "@/infrastructure/persistence/localWorkspaceStore";

export function usePersistentWorkspace() {
  const [loadResult] = useState(() => loadWorkspaceFromLocalStorage());
  const [workspace, setWorkspace] = useState<MorphoWorkspace>(loadResult.workspace);

  useEffect(() => {
    if (loadResult.migrationError) {
      return;
    }

    saveWorkspaceToLocalStorage(workspace);
  }, [loadResult.migrationError, workspace]);

  return [workspace, setWorkspace, { migrationError: loadResult.migrationError }] as const;
}
