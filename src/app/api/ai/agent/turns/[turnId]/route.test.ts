import { describe, expect, it, vi } from "vitest";

import type { AgentTurnJournalSnapshot } from "@/shared/agentTurnJournalProtocol";
import { createAgentTurnGetHandler } from "./handler";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";
const SNAPSHOT: AgentTurnJournalSnapshot = {
  serverTurnId: TURN_ID,
  localProjectId: "project-a",
  status: "providerRunning",
  latestRequestId: "request-a",
  latestStepSequence: 1,
  counters: { provider: 1, webSearch: 0, image: 0 },
  createdAt: "2026-07-29T01:00:00.000Z",
  updatedAt: "2026-07-29T01:01:00.000Z",
  terminalAt: null
};

describe("GET /api/ai/agent/turns/[turnId]", () => {
  it("returns 401 before a Journal read when unauthenticated", async () => {
    const readJournal = vi.fn();
    const handler = createAgentTurnGetHandler({
      authenticate: vi.fn(async () => ({
        status: "denied" as const,
        httpStatus: 401 as const,
        error: "login"
      })),
      readJournal
    });
    const response = await call(handler, "project-a");
    expect(response.status).toBe(401);
    expect(readJournal).not.toHaveBeenCalled();
  });

  it("lets user A read the exact user/Turn/localProject binding", async () => {
    const readJournal = vi.fn(async () => ({ status: "ok" as const, snapshot: SNAPSHOT }));
    const handler = createAgentTurnGetHandler({
      authenticate: vi.fn(async () => ({ status: "allowed", userId: "user-a" } as const)),
      readJournal
    });
    const response = await call(handler, "project-a");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SNAPSHOT);
    expect(readJournal).toHaveBeenCalledWith({ serverTurnId: TURN_ID, localProjectId: "project-a" });
  });

  it.each([
    ["user-b", "project-a"],
    ["user-a", "project-other"]
  ])("hides a cross-user or cross-Project Turn as 404", async (userId, projectId) => {
    const owner = "user-a";
    const handler = createAgentTurnGetHandler({
      authenticate: vi.fn(async () => ({ status: "allowed", userId } as const)),
      readJournal: vi.fn(async ({ localProjectId }) =>
        userId === owner && localProjectId === "project-a"
          ? { status: "ok" as const, snapshot: SNAPSHOT }
          : {
              status: "denied" as const,
              httpStatus: 404 as const,
              code: "not_found",
              error: "hidden",
              recoverable: false as const
            }
      )
    });
    const response = await call(handler, projectId);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_found", recoverable: false });
  });

  it("returns only the minimal query contract", async () => {
    const handler = createAgentTurnGetHandler({
      authenticate: vi.fn(async () => ({ status: "allowed", userId: "user-a" } as const)),
      readJournal: vi.fn(async () => ({ status: "ok" as const, snapshot: SNAPSHOT }))
    });
    const body = await (await call(handler, "project-a")).json();
    expect(Object.keys(body).sort()).toEqual([
      "counters",
      "createdAt",
      "latestRequestId",
      "latestStepSequence",
      "localProjectId",
      "serverTurnId",
      "status",
      "terminalAt",
      "updatedAt"
    ]);
    expect(JSON.stringify(body)).not.toMatch(/userId|hash|body|output|tool|workspace|outcome/i);
  });
});

function call(
  handler: ReturnType<typeof createAgentTurnGetHandler>,
  localProjectId: string
): Promise<Response> {
  return handler(
    new Request(`http://localhost/api/ai/agent/turns/${TURN_ID}?localProjectId=${localProjectId}`),
    { params: Promise.resolve({ turnId: TURN_ID }) }
  );
}
