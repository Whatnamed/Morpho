import { describe, expect, it } from "vitest";

import { isRecord, readErrorResponse, readJsonPayload } from "./httpPayload";

describe("HTTP payload helpers", () => {
  it("reads JSON without throwing on malformed bodies", async () => {
    await expect(readJsonPayload(Response.json({ ok: true }))).resolves.toEqual({ ok: true });
    await expect(readJsonPayload(new Response("not-json"))).resolves.toBeUndefined();
  });

  it("prefers provider error wording and otherwise uses HTTP status text", async () => {
    await expect(
      readErrorResponse(Response.json({ error: "Provider wording" }, { status: 503 }))
    ).resolves.toBe("Provider wording");
    await expect(
      readErrorResponse(new Response("", { status: 503, statusText: "Unavailable" }))
    ).resolves.toBe("Unavailable");
  });

  it("recognizes records without accepting arrays", () => {
    expect(isRecord({ value: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });
});
