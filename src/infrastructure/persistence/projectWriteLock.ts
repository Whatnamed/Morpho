/**
 * One writer per project, across browser tabs.
 *
 * A project workspace is held whole in React state and written back as one
 * localStorage value. Two tabs on the same project therefore do not merge — the
 * second tab's debounced write replaces everything the first tab did, including
 * a completed Agent turn, and both tabs still report "已保存". Nothing in the
 * storage layer can detect this after the fact, because the write that destroys
 * the work is a perfectly valid write.
 *
 * Web Locks is the right primitive: the lock is scoped to the origin, released
 * automatically when the holding tab closes or crashes, and never outlives the
 * browser session — so a hard-killed tab cannot leave a project permanently
 * read-only the way a stored lock flag could.
 *
 * Browsers without Web Locks keep today's behavior rather than being blocked:
 * an unenforceable lock must not become a reason the workspace refuses to save.
 */

export type ProjectWriteLease =
  | {
      /** This tab may write the project. */
      status: "granted";
      release: () => void;
    }
  | {
      /** Another tab already holds the project. This tab must stay read-only. */
      status: "heldElsewhere";
    }
  | {
      /** No enforceable lock. Writing continues unprotected, as before. */
      status: "unsupported";
    };

export type LockManagerLike = {
  request: (
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: unknown) => Promise<void>
  ) => Promise<unknown>;
};

export function getProjectWriteLockName(projectId: string): string {
  return `morpho.project.${projectId}.workspace.write`;
}

export function getLockManager(): LockManagerLike | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  return (navigator as Navigator & { locks?: LockManagerLike }).locks;
}

export function acquireProjectWriteLease(
  projectId: string,
  // Omitting this asks the browser. Passing `null` states that there is no lock
  // manager — which `undefined` cannot express, because a default parameter
  // fires on `undefined` and would silently reach for the ambient one instead.
  locks: LockManagerLike | null | undefined = getLockManager()
): Promise<ProjectWriteLease> {
  if (!locks?.request) {
    return Promise.resolve({ status: "unsupported" });
  }

  return new Promise<ProjectWriteLease>((resolve) => {
    // The lock is held for exactly as long as the callback's promise is pending,
    // so `release` is the resolver of that promise rather than a separate call.
    let release: () => void = () => {};
    const heldUntilReleased = new Promise<void>((resolveHeld) => {
      release = resolveHeld;
    });

    let settled = false;
    const settle = (lease: ProjectWriteLease) => {
      if (!settled) {
        settled = true;
        resolve(lease);
      }
    };

    void Promise.resolve(
      locks.request(getProjectWriteLockName(projectId), { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) {
          settle({ status: "heldElsewhere" });
          return;
        }

        settle({ status: "granted", release });
        await heldUntilReleased;
      })
    ).catch(() => {
      // A rejected request tells us nothing about who holds the project, and
      // refusing to save on that basis would lose more work than it protects.
      settle({ status: "unsupported" });
    });
  });
}
