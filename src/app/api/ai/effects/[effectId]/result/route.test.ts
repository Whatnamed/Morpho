import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalResultError } from "@/server/ai/externalResultStore";
import { GET, POST } from "./route";
const auth = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => vi.fn());
const read = vi.hoisted(() => vi.fn());
const observe = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/aiAccess", () => ({ requireAiRouteUser: auth,
  aiAccessDeniedResponse: (denial: { httpStatus: number }) => new Response(null, { status: denial.httpStatus }) }));
vi.mock("@/server/ai/externalResultStore", async () => ({
  ...await vi.importActual<typeof import("@/server/ai/externalResultStore")>("@/server/ai/externalResultStore"),
  externalResultStore: { call: store }, externalResultResponse: read
}));
vi.mock("@/server/ai/externalEffectObservation", () => ({ observeExternalEffect: observe }));
const effectId = `effect:${"a".repeat(64)}`, resultId = `result:${"b".repeat(64)}`, sha256 = "c".repeat(64);
const context = { params: Promise.resolve({ effectId }) };
const request = (query = "kind=text", body?: unknown) => new Request(`http://localhost/api/ai/effects/${effectId}/result?${query}`,
  body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  auth.mockReset().mockResolvedValue({ status: "allowed", userId: "verified-owner" });
  store.mockReset().mockResolvedValue({ acknowledged: true }); read.mockReset(); observe.mockReset();
});
describe("result transport auth and persistence ACK boundary", () => {
  it("requires verified authentication before result reads or ACKs", async () => {
    auth.mockResolvedValue({ status: "denied", httpStatus: 401 });
    expect((await GET(request(), context)).status).toBe(401);
    expect((await POST(request("kind=text", { resultId, version: 1, sha256 }), context)).status).toBe(401);
    expect(store).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it("derives ownership from auth, validates the ACK tuple, and accepts duplicate exact ACKs", async () => {
    for (let n = 0; n < 2; n++) expect((await POST(request("kind=text", { resultId, version: 1, sha256 }), context)).status).toBe(200);
    expect(store.mock.calls).toEqual(Array(2).fill(["ack", { actorUserId: "verified-owner", effectId, kind: "text" }, { resultId, version: 1, sha256 }]));
    const invalid = [{ resultId, version: 2, sha256 }, { resultId, version: 1, sha256, actorUserId: "another" }, {},
      { resultId: "wrong", version: 1, sha256 }];
    for (const body of invalid) expect((await POST(request("kind=text", body), context)).status).toBe(400);
    expect(store).toHaveBeenCalledTimes(2);
  });
  it("returns honest expiration and conflict without observing or executing a Provider", async () => {
    read.mockResolvedValue(Response.json({ code: "external_result_expired" }, { status: 410 }));
    expect((await GET(request("kind=image"), context)).status).toBe(410);
    store.mockRejectedValue(new ExternalResultError("result_ack_conflict"));
    expect((await POST(request("kind=text", { resultId, version: 1, sha256 }), context)).status).toBe(409);
    expect(observe).not.toHaveBeenCalled();
  });
  it("bounds chunks and ACK bodies before RPC and reads same bytes with no ACK", async () => {
    store.mockResolvedValue({ base64: Buffer.from("original").toString("base64") });
    const response = await GET(request(`kind=text&chunk=0&resultId=${resultId}`), context);
    expect(await response.text()).toBe("original"); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(store.mock.calls[0]?.[0]).toBe("chunk");
    expect((await GET(request("kind=text&chunk=32"), context)).status).toBe(400);
    expect((await POST(request("kind=text", { resultId, version: 1, sha256, excess: "x".repeat(2048) }), context)).status).toBe(413);
    expect(store).toHaveBeenCalledTimes(1);
  });
});
