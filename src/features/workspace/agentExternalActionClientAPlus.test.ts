import { describe, expect, it, vi } from "vitest";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import {
  buildAPlusImageBatchIdentity,
  buildAPlusImageChildActionId,
  classifyAPlusImageResponse,
  findAPlusImageResultObjectId,
  requestAgentWebSearchAPlus
} from "./agentExternalActionClientAPlus";

const identity = {
  serverTurnId: "019fa9c0-7b9d-7a20-8f31-2c676296c9d1",
  localProjectId: "project-local",
  requestId: "request-search",
  stepSequence: 2
};

describe("A+ External Action client", () => {
  it("derives stable image batch and child identities from the Turn and Tool Call", async () => {
    const first = await buildAPlusImageBatchIdentity(identity.serverTurnId, "call-image");
    const replay = await buildAPlusImageBatchIdentity(identity.serverTurnId, "call-image");
    const otherTurn = await buildAPlusImageBatchIdentity(
      "019fa9c0-7b9d-7a20-8f31-2c676296c9d2",
      "call-image"
    );

    expect(replay).toEqual(first);
    expect(otherTurn).not.toEqual(first);
    expect(await buildAPlusImageChildActionId("call-image", "item-a"))
      .toBe(await buildAPlusImageChildActionId("call-image", "item-a"));
    expect(await buildAPlusImageChildActionId("call-image", "item-b"))
      .not.toBe(await buildAPlusImageChildActionId("call-image", "item-a"));
  });

  it("finds an already persisted image by the stable child client request identity", () => {
    const workspace = createTestWorkspace();
    const image = Object.values(workspace.objects).find((object) => object.type === "image");
    if (!image || image.type !== "image") throw new Error("Fixture 缺少 image object。");
    const clientRequestId = "client-image-a-plus-stable-item";
    const restored = {
      ...workspace,
      objects: {
        ...workspace.objects,
        [image.id]: {
          ...image,
          generation: {
            modelId: "test-image-model",
            modelLabel: "Test Image Model",
            aspectRatio: "1:1",
            prompt: "stable recovery",
            referenceObjectIds: [],
            clientRequestId,
            createdAt: "2026-07-29T00:00:00.000Z"
          }
        }
      }
    };

    expect(findAPlusImageResultObjectId(restored, clientRequestId)).toBe(image.id);
    expect(findAPlusImageResultObjectId(restored, "different-request")).toBeUndefined();
  });

  it("polls a running Search only by replaying the exact same action identity and body", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ replayed: true, action: { status: "running" } }, {
        status: 202
      }))
      .mockResolvedValueOnce(Response.json({
        replayed: true,
        sources: [{ title: "Morpho", url: "https://example.com/morpho" }],
        failedSourceCount: 0,
        timedOutSourceCount: 0
      }));
    const waitForReplay = vi.fn(async () => undefined);

    await expect(requestAgentWebSearchAPlus({
      fetch: fetchMock,
      identity,
      actionId: "call-search",
      queries: ["local-first agent runtime"],
      signal: new AbortController().signal,
      waitForReplay
    })).resolves.toMatchObject({
      sources: [{ title: "Morpho", url: "https://example.com/morpho" }]
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(fetchMock.mock.calls[1]?.[0]);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body);
    expect(waitForReplay).toHaveBeenCalledWith(100, expect.any(AbortSignal));
  });

  it("stops after the bounded query-only window without creating a new Search identity", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ replayed: true, action: { status: "running" } }, { status: 202 })
    );

    await expect(requestAgentWebSearchAPlus({
      fetch: fetchMock,
      identity,
      actionId: "call-search",
      queries: ["local-first agent runtime"],
      signal: new AbortController().signal,
      waitForReplay: async () => undefined
    })).rejects.toMatchObject({ code: "external_action_running" });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new Set(fetchMock.mock.calls.map((call) => call[1]?.body))).toHaveProperty("size", 1);
  });

  it("classifies Image 202 JSON as running instead of an image payload", () => {
    expect(classifyAPlusImageResponse(202, "application/json")).toBe("running");
    expect(classifyAPlusImageResponse(200, "application/json")).toBe("jsonError");
    expect(classifyAPlusImageResponse(200, "image/png")).toBe("payload");
  });
});
