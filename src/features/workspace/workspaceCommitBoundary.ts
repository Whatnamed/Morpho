import type { Dispatch, SetStateAction } from "react";
import { flushSync } from "react-dom";

import type { MorphoWorkspace } from "@/domain/morpho/types";

export type WorkspaceCommitTransform<T> = (
  current: MorphoWorkspace
) => { workspace: MorphoWorkspace; value: T };

export type WorkspaceMutationBlockedError = Error & {
  code: "workspace_mutation_blocked";
};

export function createWorkspaceMutationBlockedError(): WorkspaceMutationBlockedError {
  return Object.assign(new Error("This workspace session is view-only."), {
    code: "workspace_mutation_blocked" as const
  });
}

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
