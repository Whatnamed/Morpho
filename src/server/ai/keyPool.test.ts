import { describe, expect, it } from "vitest";

import { classifyMiMoFailure, createMiMoKeyPool } from "./keyPool";

describe("MiMo key pool", () => {
  it("uses the first key by default without round-robin", () => {
    const pool = createMiMoKeyPool(["primary", "backup"]);

    expect(pool.current()).toBe("primary");
    expect(pool.current()).toBe("primary");
  });

  it("switches to a backup key once for auth failures", () => {
    const pool = createMiMoKeyPool(["primary", "backup"]);

    const next = pool.nextAfterFailure({ status: 401 });

    expect(next).toEqual({ status: "retry", apiKey: "backup" });
    expect(pool.current()).toBe("backup");
  });

  it("does not switch keys for 429 rate limits", () => {
    const pool = createMiMoKeyPool(["primary", "backup"]);

    const next = pool.nextAfterFailure({ status: 429 });

    expect(next).toEqual({ status: "stop", reason: "rateLimited" });
    expect(pool.current()).toBe("primary");
  });

  it("does not switch keys for parameter or model errors", () => {
    expect(classifyMiMoFailure({ status: 400 })).toBe("requestInvalid");
    expect(classifyMiMoFailure({ status: 404 })).toBe("requestInvalid");
    expect(createMiMoKeyPool(["primary", "backup"]).nextAfterFailure({ status: 400 })).toEqual({
      status: "stop",
      reason: "requestInvalid"
    });
  });

  it("allows one backup attempt for network or temporary provider failures", () => {
    const pool = createMiMoKeyPool(["primary", "backup"]);

    expect(pool.nextAfterFailure({ kind: "network" })).toEqual({ status: "retry", apiKey: "backup" });
    expect(pool.nextAfterFailure({ status: 503 })).toEqual({ status: "stop", reason: "temporaryFailure" });
  });
});
