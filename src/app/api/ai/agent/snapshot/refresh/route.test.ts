import { afterEach, describe, expect, it } from "vitest";

import { issueAgentTranscriptSnapshotToken } from "@/server/ai/agentContinuationToken";
import { buildAgentTranscriptManifest } from "@/shared/agentCompactionProtocol";

import { POST } from "./route";

const SECRET = "snapshot-refresh-route-secret";
const originalSecret = process.env.MORPHO_AGENT_CONTINUATION_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.MORPHO_AGENT_CONTINUATION_SECRET;
  } else {
    process.env.MORPHO_AGENT_CONTINUATION_SECRET = originalSecret;
  }
});

describe("agent transcript snapshot refresh route", () => {
  it("renews an expired checkpoint without Provider or Lease input", async () => {
    process.env.MORPHO_AGENT_CONTINUATION_SECRET = SECRET;
    const manifest = buildAgentTranscriptManifest([
      { role: "user", content: [{ type: "input_text", text: "海洋浮标长期项目" }] }
    ]);
    const token = issueAgentTranscriptSnapshotToken({
      secret: SECRET,
      projectId: "project-ocean-buoy",
      transcriptManifest: manifest,
      now: Date.now() - 25 * 60 * 60 * 1_000
    });

    const response = await POST(new Request("http://localhost/api/ai/agent/snapshot/refresh", {
      method: "POST",
      body: JSON.stringify({ projectId: "project-ocean-buoy", token, transcriptManifest: manifest })
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transcriptSnapshotToken: expect.any(String),
      transcriptManifestHash: manifest.manifestHash,
      expiresAt: expect.any(Number)
    });
  });

  it("rejects cross-project and malformed signed checkpoints", async () => {
    process.env.MORPHO_AGENT_CONTINUATION_SECRET = SECRET;
    const manifest = buildAgentTranscriptManifest([
      { role: "user", content: [{ type: "input_text", text: "海洋浮标长期项目" }] }
    ]);
    const token = issueAgentTranscriptSnapshotToken({
      secret: SECRET,
      projectId: "project-ocean-buoy",
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
});
