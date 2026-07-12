export type StageOpacitySessionHost = {
  getOpacity: (stageId: string) => number | null;
  writeOpacity: (stageId: string, value: number, options: { history: "ignore" | "record" }) => void;
  markHistoryStoppingPoint: (label: string) => void;
  persist: (stageId: string, value: number) => void;
  onSessionStageChange: (stageId: string | null) => void;
};

type ActiveStageOpacitySession = {
  stageId: string;
  startOpacity: number;
  previewOpacity: number;
};

/**
 * A single, idempotent opacity gesture. Preview updates stay out of history and
 * persistence; commit restores the start value before recording exactly one
 * final write, so one undo always returns to the visual state at gesture start.
 */
export function createStageOpacitySessionController(host: StageOpacitySessionHost) {
  let active: ActiveStageOpacitySession | null = null;

  const finish = (commit: boolean): boolean => {
    const session = active;
    if (!session) return false;
    active = null;
    // Keep canvas persistence suppressed through both editor writes.
    host.onSessionStageChange(session.stageId);
    host.writeOpacity(session.stageId, session.startOpacity, { history: "ignore" });
    if (commit && session.previewOpacity !== session.startOpacity) {
      host.markHistoryStoppingPoint("调整分区透明度");
      host.writeOpacity(session.stageId, session.previewOpacity, { history: "record" });
      host.persist(session.stageId, session.previewOpacity);
      host.onSessionStageChange(null);
      return true;
    }
    host.onSessionStageChange(null);
    return !commit;
  };

  const begin = (stageId: string): boolean => {
      if (active?.stageId === stageId) return true;
      if (active) finish(true);
      const startOpacity = host.getOpacity(stageId);
      if (startOpacity === null) return false;
      active = { stageId, startOpacity, previewOpacity: startOpacity };
      host.onSessionStageChange(stageId);
      return true;
    };
  const preview = (stageId: string, value: number): boolean => {
      if (!active || active.stageId !== stageId) {
        if (!begin(stageId)) return false;
      }
      if (!active || active.stageId !== stageId) return false;
      const nextOpacity = Math.round(Math.min(100, Math.max(0, value)));
      active.previewOpacity = nextOpacity;
      host.writeOpacity(stageId, nextOpacity, { history: "ignore" });
      return true;
    };

  return {
    begin,
    preview,
    commit: (): boolean => finish(true),
    cancel: (): boolean => finish(false),
    dispose: (): boolean => finish(true),
    get isActive() {
      return active !== null;
    },
    get activeStageId() {
      return active?.stageId ?? null;
    }
  };
}
