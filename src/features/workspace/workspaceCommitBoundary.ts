import type { Dispatch, SetStateAction } from "react";
import { flushSync } from "react-dom";

import type { MorphoWorkspace } from "@/domain/morpho/types";

export type WorkspaceCommitTransform<T> = (
  current: MorphoWorkspace
) => { workspace: MorphoWorkspace; value: T };

export function commitWorkspaceStateNow<T>(
  setWorkspace: Dispatch<SetStateAction<MorphoWorkspace>>,
  transform: WorkspaceCommitTransform<T>,
  flush: (callback: () => void) => void = flushSync
): T {
  let committed: { workspace: MorphoWorkspace; value: T } | undefined;
  flush(() => {
    setWorkspace((current) => {
      committed = transform(current);
      return committed.workspace;
    });
  });
  if (!committed) {
    throw new Error("Workspace update did not commit.");
  }
  return committed.value;
}
