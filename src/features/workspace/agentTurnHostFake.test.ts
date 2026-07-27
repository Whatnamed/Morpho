import { describe, expect, it } from "vitest";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import { createAgentTurnHostFake } from "./agentTurnHostFake";

describe("Agent turn host fake", () => {
  it("preserves synchronous commit and read ordering", () => {
    const fake = createAgentTurnHostFake({ workspace: createTestWorkspace() });
    const recordStreaming = fake.createUiRecorder<[boolean]>("streaming");

    recordStreaming(true);
    const title = fake.commitWorkspace((current) => ({
      workspace: {
        ...current,
        project: { ...current.project, title: "Updated by the turn" }
      },
      value: current.project.title
    }));
    const readBack = fake.readWorkspace();
    recordStreaming(false);

    expect(title).not.toBe("Updated by the turn");
    expect(readBack.project.title).toBe("Updated by the turn");
    expect(fake.getEvents().map(({ sequence, kind, name }) => ({ sequence, kind, name }))).toEqual([
      { sequence: 1, kind: "ui", name: "streaming" },
      { sequence: 2, kind: "workspaceCommit", name: "commit" },
      { sequence: 3, kind: "workspaceCommit", name: "commit" },
      { sequence: 4, kind: "ui", name: "streaming" }
    ]);
  });

  it("routes relative fetch requests without touching the network", async () => {
    const fake = createAgentTurnHostFake({
      workspace: createTestWorkspace(),
      routes: {
        "/api/ai/agent": async (request) =>
          Response.json({ body: await request.json(), method: request.method })
      }
    });

    const response = await fake.fetch("/api/ai/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnId: "turn-unit" })
    });

    expect(await response.json()).toEqual({
      body: { turnId: "turn-unit" },
      method: "POST"
    });
    expect((await fake.fetch("/missing")).status).toBe(404);
  });

  it("provides deterministic clocks and identity-preserving slots", () => {
    const fake = createAgentTurnHostFake({
      workspace: createTestWorkspace(),
      now: 123,
      randomSuffix: "fixed"
    });
    const controller = new AbortController();
    const flush = () => undefined;

    fake.abortSlot.set(controller);
    fake.streamFlushSlot.set(flush);

    expect(fake.now()).toBe(123);
    expect(fake.randomSuffix()).toBe("fixed");
    expect(fake.abortSlot.get()).toBe(controller);
    expect(fake.streamFlushSlot.get()).toBe(flush);
  });
});
