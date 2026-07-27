import { describe, expect, it } from "vitest";

import {
  createProviderInputSnapshot,
  normalizeProviderInputSnapshot,
  providerInputSnapshotText
} from "./providerInputSnapshot";

describe("provider input snapshots", () => {
  it("captures provider-visible text and only stable attachment references", () => {
    const snapshot = createProviderInputSnapshot({
      message: {
        content: [
          { type: "input_text", text: "用户输入与本轮合同" },
          { type: "input_image", image_url: "data:image/png;base64,secret-pixels" }
        ]
      },
      promptContractVersion: "morpho-agent-test",
      attachmentRefs: [{ objectId: "image-buoy", assetId: "asset-buoy", mimeType: "image/png" }]
    });

    expect(providerInputSnapshotText(snapshot)).toEqual(["用户输入与本轮合同"]);
    expect(snapshot.cacheBoundaryReason).toBe("imageInput");
    expect(JSON.stringify(snapshot)).not.toContain("secret-pixels");
    expect(snapshot.serializedTextHash).toBeTruthy();
  });

  it("reissues legacy snapshots with the current SHA-256 text hash", () => {
    const snapshot = normalizeProviderInputSnapshot({
      schemaVersion: 1,
      promptContractVersion: "morpho-agent-test",
      textParts: [{ kind: "userDraft", text: "原始问题" }],
      attachmentRefs: [],
      serializedTextHash: "stored-hash"
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      promptContractVersion: "morpho-agent-test",
      serializedTextHash: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
    expect(snapshot?.serializedTextHash).not.toBe("stored-hash");
    expect(snapshot?.textParts).toEqual([{ kind: "userDraft", text: "原始问题" }]);
  });

  it("keeps the captured provider text stable when the source message is later edited", () => {
    const message = {
      content: [{ type: "input_text" as const, text: "发送时的文档摘录" }]
    };
    const snapshot = createProviderInputSnapshot({
      message,
      promptContractVersion: "morpho-agent-test"
    });
    message.content[0].text = "后来文档内容";

    expect(providerInputSnapshotText(snapshot)).toEqual(["发送时的文档摘录"]);
    expect(JSON.stringify(snapshot)).not.toContain("后来文档内容");
    expect(JSON.stringify(snapshot)).not.toContain("api-key");
  });
});
