import { describe, expect, it } from "vitest";

import {
  acquireProjectWriteLease,
  getProjectWriteLockName,
  type LockManagerLike
} from "./projectWriteLock";

/**
 * A minimal exclusive-lock manager with the one behavior under test: while a
 * name is held, `ifAvailable` hands the callback `null` instead of queueing.
 */
function createFakeLockManager(): LockManagerLike {
  const held = new Set<string>();

  return {
    request: async (name, _options, callback) => {
      if (held.has(name)) {
        await callback(null);
        return;
      }

      held.add(name);
      try {
        await callback({ name });
      } finally {
        held.delete(name);
      }
    }
  };
}

describe("acquireProjectWriteLease", () => {
  it("grants the project to the first tab", async () => {
    const lease = await acquireProjectWriteLease("project-a", createFakeLockManager());

    expect(lease.status).toBe("granted");
  });

  it("refuses a second tab while the first still holds the project", async () => {
    const locks = createFakeLockManager();
    const first = await acquireProjectWriteLease("project-a", locks);
    expect(first.status).toBe("granted");

    const second = await acquireProjectWriteLease("project-a", locks);

    expect(second.status).toBe("heldElsewhere");
  });

  it("hands the project to the next tab once the holder releases it", async () => {
    const locks = createFakeLockManager();
    const first = await acquireProjectWriteLease("project-a", locks);
    expect(first.status).toBe("granted");
    if (first.status !== "granted") return;

    first.release();
    // The holder's callback resumes, returns, and only then does the manager
    // drop the name. A macrotask boundary drains that whole microtask chain.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = await acquireProjectWriteLease("project-a", locks);
    expect(second.status).toBe("granted");
  });

  it("does not let one project block another", async () => {
    const locks = createFakeLockManager();
    const held = await acquireProjectWriteLease("project-a", locks);
    expect(held.status).toBe("granted");

    const other = await acquireProjectWriteLease("project-b", locks);

    expect(other.status).toBe("granted");
  });

  it("keeps writing possible when the browser has no Web Locks", async () => {
    await expect(acquireProjectWriteLease("project-a", undefined)).resolves.toEqual({ status: "unsupported" });
  });

  it("keeps writing possible when the lock request itself fails", async () => {
    const locks: LockManagerLike = {
      request: () => Promise.reject(new Error("locks unavailable"))
    };

    await expect(acquireProjectWriteLease("project-a", locks)).resolves.toEqual({ status: "unsupported" });
  });

  it("scopes the lock name to one project", () => {
    expect(getProjectWriteLockName("project-a")).not.toBe(getProjectWriteLockName("project-b"));
    expect(getProjectWriteLockName("project-a")).toContain("project-a");
  });
});
