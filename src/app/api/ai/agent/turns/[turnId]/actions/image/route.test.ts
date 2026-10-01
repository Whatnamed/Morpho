import { describe, expect, it, vi } from "vitest";

import { resolveGrsImageResult } from "@/server/image/grsProvider";
import type { AgentTurnExternalActionSnapshot } from "@/shared/agentTurnExternalActionProtocol";
import { createAgentTurnImageActionPostHandler } from "./handler";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";

describe("A+ image action route", () => {
  it("observes an existing effect before rebuilding current config, hashes, claims or paid admission", async () => {
    const acquire = vi.fn();
    const generate = vi.fn();
    const loadConfig = vi.fn(() => { throw new Error("config changed"); });
    const observeExisting = vi.fn(async () => new Response(new Blob(["original-result"]), { headers: { "Content-Type": "image/png" } }));
    const handler = createAgentTurnImageActionPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      acquire, generate, loadConfig, settle: vi.fn(), observeExisting
    });
    const response = await handler(new Request("http://morpho.test", { method: "POST", body: JSON.stringify({
      localProjectId: "project-test", requestId: "request-1", stepSequence: 1, actionId: "img:child-1", claimCallId: "call-image-1", input: {}
    }) }), { params: Promise.resolve({ turnId: TURN_ID }) });
    expect(await response.text()).toBe("original-result");
    expect(acquire).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(loadConfig).not.toHaveBeenCalled();
    expect(observeExisting).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "user-a", kind: "image" }), expect.any(AbortSignal));
  });
  it("accepts the normal minimal image payload without hashing undefined optionals", async () => {
    const acquire = vi.fn(async () => ({
      status: "ok" as const,
      executionGranted: true,
      replayed: false,
      snapshot: actionSnapshot("running")
    }));
    const settle = vi.fn(async () => ({
      status: "ok" as const,
      replayed: false,
      snapshot: actionSnapshot("externallyCompleted")
    }));
    const handler = createAgentTurnImageActionPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      acquire,
      settle,
      loadConfig: () => ({
        status: "ok",
        config: { apiKey: "test", baseUrl: "https://images.test", model: "gpt-image-2" }
      }),
      generate: async () => ({
        status: "ok",
        blob: new Blob(["image"], { type: "image/png" }),
        mimeType: "image/png",
        providerTaskId: "provider-task-1"
      })
    });

    const response = await handler(new Request(`http://morpho.test/${TURN_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        localProjectId: "project-test",
        requestId: "request-1",
        stepSequence: 1,
        actionId: "img:child-1",
        claimCallId: "call-image-1",
        input: { prompt: "A warm industrial-design concept", images: [] }
      })
    }), { params: Promise.resolve({ turnId: TURN_ID }) });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("image");
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({
      actionId: "img:child-1",
      claimCallId: "call-image-1",
      claimHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      actionHash: expect.stringMatching(/^[0-9a-f]{64}$/)
    }));
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("authenticates before reserving an external action", async () => {
    const acquire = vi.fn();
    const handler = createAgentTurnImageActionPostHandler({
      authenticate: async () => ({ status: "denied", httpStatus: 401, error: "login" }),
      acquire,
      settle: vi.fn(),
      loadConfig: () => ({ status: "failed", reason: "not reached" }),
      generate: vi.fn()
    });

    const response = await handler(new Request("http://morpho.test", { method: "POST" }), {
      params: Promise.resolve({ turnId: TURN_ID })
    });

    expect(response.status).toBe(401);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("never repeats a completed paid generation when the binary payload was lost", async () => {
    const generate = vi.fn();
    const settle = vi.fn();
    const handler = createAgentTurnImageActionPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      acquire: async () => ({
        status: "ok",
        executionGranted: false,
        replayed: true,
        snapshot: actionSnapshot("externallyCompleted")
      }),
      settle,
      loadConfig: () => ({
        status: "ok",
        config: { apiKey: "test", baseUrl: "https://images.test", model: "gpt-image-2" }
      }),
      generate
    });

    const response = await handler(new Request(`http://morpho.test/${TURN_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        localProjectId: "project-test",
        requestId: "request-1",
        stepSequence: 1,
        actionId: "img:child-1",
        claimCallId: "call-image-1",
        input: { prompt: "A warm industrial-design concept", images: [] }
      })
    }), { params: Promise.resolve({ turnId: TURN_ID }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "external_action_result_unavailable",
      recoverable: false
    });
    expect(generate).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it("settles a failed image action without exposing its upstream reason", async () => {
    const secretReason = "internal-host.local api_key=secret raw upstream body /private/path";
    const settle = vi.fn(async () => ({
      status: "ok" as const,
      replayed: false,
      snapshot: { ...actionSnapshot("externallyFailed"), failureCode: "image_generation_failed" }
    }));
    const handler = createAgentTurnImageActionPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      acquire: async () => ({
        status: "ok",
        executionGranted: true,
        replayed: false,
        snapshot: actionSnapshot("running")
      }),
      settle,
      loadConfig: () => ({
        status: "ok",
        config: { apiKey: "test", baseUrl: "https://images.test", model: "gpt-image-2" }
      }),
      generate: async () => ({ status: "failed", reason: secretReason })
    });

    const response = await handler(new Request(`http://morpho.test/${TURN_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        localProjectId: "project-test",
        requestId: "request-1",
        stepSequence: 1,
        actionId: "img:child-1",
        claimCallId: "call-image-1",
        input: { prompt: "A warm industrial-design concept", images: [] }
      })
    }), { params: Promise.resolve({ turnId: TURN_ID }) });
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(body)).toMatchObject({
      error: "图像任务失败，请稍后重试。",
      code: "image_generation_failed",
      recoverable: false
    });
    expect(body).not.toContain(secretReason);
    expect(body).not.toContain("api_key=secret");
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({
      status: "externallyFailed",
      failureCode: "image_generation_failed"
    }));
    expect(JSON.stringify(settle.mock.calls)).not.toContain(secretReason);
  });
  it("settles ambiguous generate as unknown and replay never submits again", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new TypeError("accepted but lost"); });
    let terminal = false;
    const settle = vi.fn(async () => {
      terminal = true;
      return { status: "ok" as const, replayed: false, snapshot: { ...actionSnapshot("externallyFailed"), failureCode: "external_execution_state_unknown" } };
    });
    const generate = vi.fn<typeof resolveGrsImageResult>((config, input, options) => resolveGrsImageResult(config, input, { ...options, fetchImpl }));
    const handler = createAgentTurnImageActionPostHandler({
      authenticate: async () => ({ status: "allowed", userId: "user-a" }),
      acquire: async () => ({ status: "ok", executionGranted: !terminal, replayed: terminal,
        snapshot: { ...actionSnapshot(terminal ? "externallyFailed" : "running"), ...(terminal ? { failureCode: "external_execution_state_unknown" } : {}) } }),
      settle,
      loadConfig: () => ({ status: "ok", config: { apiKey: "test", baseUrl: "https://images.test", fallbackBaseUrls: ["https://fallback.test"], model: "gpt-image-2" } }),
      generate
    });
    const request = () => new Request("http://morpho.test", { method: "POST", body: JSON.stringify({
      localProjectId: "project-test", requestId: "request-1", stepSequence: 1, actionId: "img:child-1", claimCallId: "call-image-1",
      input: { prompt: "A warm industrial-design concept", images: [] }
    }) });
    const context = () => ({ params: Promise.resolve({ turnId: TURN_ID }) });
    const response = await handler(request(), context());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "external_execution_state_unknown", recoverable: false });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ status: "externallyFailed", failureCode: "external_execution_state_unknown" }));
    const replay = await handler(request(), context());
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ code: "external_execution_state_unknown" });
    expect(generate).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

});

function actionSnapshot(
  status: AgentTurnExternalActionSnapshot["status"]
): AgentTurnExternalActionSnapshot {
  return {
    serverTurnId: TURN_ID,
    requestId: "request-1",
    stepSequence: 1,
    actionId: "img:child-1",
    actionKind: "image",
    status,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    terminalAt: status === "running" ? null : "2026-07-29T00:00:01.000Z"
  };
}
