import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { issueAgentTranscriptSnapshotToken } from "@/server/ai/agentContinuationToken";
import { buildAgentTranscriptManifest } from "@/shared/agentCompactionProtocol";

import { MAX_AGENT_SNAPSHOT_REFRESH_BODY_BYTES, POST } from "./route";

const SECRET = "snapshot-refresh-route-secret";
const USER_ID = "user-ocean-buoy";
const originalSecret = process.env.MORPHO_AGENT_CONTINUATION_SECRET;
const requireAiRouteUserMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/auth/aiAccess", () => ({
  requireAiRouteUser: (...args: unknown[]) => requireAiRouteUserMock(...args)
}));

beforeEach(() => {
  process.env.MORPHO_AGENT_CONTINUATION_SECRET = SECRET;
  requireAiRouteUserMock.mockReset();
  requireAiRouteUserMock.mockResolvedValue({ status: "allowed", userId: USER_ID });
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.MORPHO_AGENT_CONTINUATION_SECRET;
  } else {
    process.env.MORPHO_AGENT_CONTINUATION_SECRET = originalSecret;
  }
});

describe("agent transcript snapshot refresh route", () => {
  it("renews an expired checkpoint without Provider or Lease input", async () => {
    const manifest = buildAgentTranscriptManifest([
      { role: "user", content: [{ type: "input_text", text: "海洋浮标长期项目" }] }
    ]);
    const token = issueAgentTranscriptSnapshotToken({
      secret: SECRET,
      projectId: "project-ocean-buoy",
      userId: USER_ID,
      transcriptManifest: manifest,
      now: Date.now() - 25 * 60 * 60 * 1_000
    });

    const response = await POST(new Request("http://localhost/api/ai/agent/snapshot/refresh", {
      method: "POST",
      body: JSON.stringify({ projectId: "project-ocean-buoy", token })
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transcriptSnapshotToken: expect.any(String),
      transcriptManifestHash: manifest.manifestHash,
      expiresAt: expect.any(Number)
    });
  });

  it("rejects cross-project and malformed signed checkpoints", async () => {
    const manifest = buildAgentTranscriptManifest([
      { role: "user", content: [{ type: "input_text", text: "海洋浮标长期项目" }] }
    ]);
    const token = issueAgentTranscriptSnapshotToken({
      secret: SECRET,
      projectId: "project-ocean-buoy",
      userId: USER_ID,
      transcriptManifest: manifest,
      now: Date.now()
    });
    const request = (projectId: string, value: string) => POST(new Request(
      "http://localhost/api/ai/agent/snapshot/refresh",
      { method: "POST", body: JSON.stringify({ projectId, token: value }) }
    ));

    expect((await request("project-other", token)).status).toBe(400);
    expect((await request("project-ocean-buoy", `${token}x`)).status).toBe(400);
  });

  it("requires login and rejects a checkpoint issued for another user", async () => {
    const manifest = buildAgentTranscriptManifest([
      { role: "user", content: [{ type: "input_text", text: "海洋浮标长期项目" }] }
    ]);
    const token = issueAgentTranscriptSnapshotToken({
      secret: SECRET,
      projectId: "project-ocean-buoy",
      userId: "user-other",
      transcriptManifest: manifest,
      now: Date.now() - 25 * 60 * 60 * 1_000
    });
    const request = () => POST(new Request("http://localhost/api/ai/agent/snapshot/refresh", {
      method: "POST",
      body: JSON.stringify({ projectId: "project-ocean-buoy", token })
    }));

    expect((await request()).status).toBe(400);
    requireAiRouteUserMock.mockResolvedValueOnce({
      status: "denied",
      httpStatus: 401,
      error: "请先登录 Morpho。"
    });
    expect((await request()).status).toBe(401);
  });

  it("does not extend the absolute 180-day refresh deadline", async () => {
    const manifest = buildAgentTranscriptManifest([
      { role: "user", content: [{ type: "input_text", text: "海洋浮标长期项目" }] }
    ]);
    const token = issueAgentTranscriptSnapshotToken({
      secret: SECRET,
      projectId: "project-ocean-buoy",
      userId: USER_ID,
      transcriptManifest: manifest,
      now: Date.now() - 181 * 24 * 60 * 60 * 1_000
    });
    const response = await POST(new Request("http://localhost/api/ai/agent/snapshot/refresh", {
      method: "POST",
      body: JSON.stringify({ projectId: "project-ocean-buoy", token })
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ reason: "compaction_source_unverified" });
  });

  it("rejects an oversized body before authentication", async () => {
    const response = await POST(new Request("http://localhost/api/ai/agent/snapshot/refresh", {
      method: "POST",
      headers: { "content-length": String(MAX_AGENT_SNAPSHOT_REFRESH_BODY_BYTES + 1) },
      body: "{}"
    }));

    expect(response.status).toBe(413);
    expect(requireAiRouteUserMock).not.toHaveBeenCalled();
  });
});
