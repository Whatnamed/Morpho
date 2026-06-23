"use client";

import { useEffect, useState } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  loadWorkspaceFromLocalStorage,
  saveWorkspaceToLocalStorage
} from "@/infrastructure/persistence/localWorkspaceStore";

export function usePersistentWorkspace() {
  const [workspace, setWorkspace] = useState<MorphoWorkspace>(() => loadWorkspaceFromLocalStorage());

  useEffect(() => {
    saveWorkspaceToLocalStorage(workspace);
  }, [workspace]);

  return [workspace, setWorkspace] as const;
}
