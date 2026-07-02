import type { MorphoWorkspace } from "@/domain/morpho/types";

export type WorkspacePersistencePhase = "loading" | "idle" | "saving" | "saved" | "error";

export type WorkspacePersistenceState = {
  phase: WorkspacePersistencePhase;
  isDirty: boolean;
  lastSavedAt?: string;
  error?: string;
  failedStage?: "workspace" | "catalog";
};

export type WorkspacePersistenceWriteResult =
  | {
      status: "ok";
      savedAt: string;
    }
  | {
      status: "failed";
      reason: string;
      stage: "workspace" | "catalog";
    };

export type WorkspacePersistenceWriter = (workspace: MorphoWorkspace) => WorkspacePersistenceWriteResult;

export type WorkspacePersistenceController = {
  schedule(workspace: MorphoWorkspace): void;
  flush(): WorkspacePersistenceState;
  dispose(): void;
  getState(): WorkspacePersistenceState;
};

type WorkspacePersistenceControllerOptions = {
  writer: WorkspacePersistenceWriter;
  debounceMs?: number;
  maxWaitMs?: number;
  onStateChange?: (state: WorkspacePersistenceState) => void;
};

export const WORKSPACE_PERSISTENCE_DEBOUNCE_MS = 400;
export const WORKSPACE_PERSISTENCE_MAX_WAIT_MS = 1200;

export function createWorkspacePersistenceController({
  writer,
  debounceMs = WORKSPACE_PERSISTENCE_DEBOUNCE_MS,
  maxWaitMs = WORKSPACE_PERSISTENCE_MAX_WAIT_MS,
  onStateChange
}: WorkspacePersistenceControllerOptions): WorkspacePersistenceController {
  let state: WorkspacePersistenceState = { phase: "idle", isDirty: false };
  let latestWorkspace: MorphoWorkspace | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;

  function publish(nextState: WorkspacePersistenceState) {
    state = nextState;
    onStateChange?.(state);
  }

  function clearDebounceTimer() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
  }

  function clearMaxWaitTimer() {
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = undefined;
    }
  }

  function clearTimers() {
    clearDebounceTimer();
    clearMaxWaitTimer();
  }

  function writeLatest(): WorkspacePersistenceState {
    if (!latestWorkspace) {
      return state;
    }

    const workspaceToPersist = latestWorkspace;
    latestWorkspace = undefined;
    clearTimers();
    publish({ ...state, phase: "saving", isDirty: true });

    const result = writer(workspaceToPersist);
    if (result.status === "ok") {
      publish({
        phase: "saved",
        isDirty: false,
        lastSavedAt: result.savedAt
      });
      return state;
    }

    latestWorkspace = workspaceToPersist;
    publish({
      phase: "error",
      isDirty: true,
      lastSavedAt: state.lastSavedAt,
      error: result.reason,
      failedStage: result.stage
    });
    return state;
  }

  function ensureMaxWaitTimer() {
    if (maxWaitTimer) {
      return;
    }
    maxWaitTimer = setTimeout(() => {
      void writeLatest();
    }, maxWaitMs);
  }

  return {
    schedule(workspace) {
      latestWorkspace = workspace;
      publish({
        ...state,
        phase: state.phase === "loading" ? "loading" : state.phase,
        isDirty: true
      });
      clearDebounceTimer();
      debounceTimer = setTimeout(() => {
        void writeLatest();
      }, debounceMs);
      ensureMaxWaitTimer();
    },
    flush() {
      return writeLatest();
    },
    dispose() {
      clearTimers();
      latestWorkspace = undefined;
    },
    getState() {
      return state;
    }
  };
}
