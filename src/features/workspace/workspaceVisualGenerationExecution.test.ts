import { describe, expect, it } from "vitest";

import { createTestWorkspace } from "@/domain/morpho/workspace";
import type { VisualGenerationPlan } from "@/domain/operations/types";
import { validateVisualGenerationPlan } from "@/domain/operations/visualGenerationPlan";
import {
  buildAPlusImageBatchIdentity,
  buildAPlusImageChildActionId,
  createAPlusImageRestoredActionCursor,
  hashAPlusExternalActionBody
} from "./agentExternalActionClientAPlus";
import {
  IMAGE_GENERATION_MAX_CONCURRENCY,
  mapWithConcurrency
} from "./imageGenerationConcurrency";
import { resolveImageGenerationSettingsForVisualIntent } from "./imageGenerationSettings";

describe("visual generation execution characterization", () => {
  it("blocks an incomplete direction preview before any execution work", () => {
    const workspace = createTestWorkspace();
    const plan: VisualGenerationPlan = {
      kind: "directionPreview",
      items: [
        {
          id: "preview-1",
          targetDirectionId: "direction-soft-rail",
          title: "Preview",
          purpose: "Explore the direction.",
          prompt: "A warm product concept.",
          referenceObjectIds: [],
          role: "conceptImage"
        }
      ]
    };

    expect(validateVisualGenerationPlan(workspace, {
      plan,
      allowedObjectIds: ["direction-soft-rail"],
      selectedDirectionIds: ["direction-soft-rail", "direction-support-island"],
      selectedImageIds: [],
      requestedPreviewCount: 1
    })).toEqual({
      status: "blocked",
      reason: "方向预览计划必须覆盖每个已选方向，并且每方向精确生成 1 张。"
    });
  });

  it("keeps visual-intent routing and the caller-provided aspect ratio", () => {
    expect(resolveImageGenerationSettingsForVisualIntent({
      intent: "directionPreview",
      aspectRatio: "16:9"
    })).toMatchObject({
      modelId: "nano-banana-2-lite",
      aspectRatio: "16:9"
    });
    expect(resolveImageGenerationSettingsForVisualIntent({
      intent: "visualDevelopment",
      aspectRatio: "3:4"
    })).toMatchObject({
      modelId: "gpt-image-2",
      aspectRatio: "3:4"
    });
  });

  it("keeps ordinary generation bounded by the configured concurrency", async () => {
    let active = 0;
    let maximum = 0;
    const result = await mapWithConcurrency(
      ["a", "b", "c", "d", "e"],
      IMAGE_GENERATION_MAX_CONCURRENCY,
      async (item) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
        return item;
      }
    );

    expect(result).toEqual(["a", "b", "c", "d", "e"]);
    expect(maximum).toBeLessThanOrEqual(IMAGE_GENERATION_MAX_CONCURRENCY);
  });

  it("keeps A+ batch and child identities deterministic", async () => {
    const firstBatch = await buildAPlusImageBatchIdentity("turn-1", "call-1");
    const secondBatch = await buildAPlusImageBatchIdentity("turn-1", "call-1");
    const firstChild = await buildAPlusImageChildActionId("call-1", "item-a");
    const secondChild = await buildAPlusImageChildActionId("call-1", "item-a");

    expect(secondBatch).toEqual(firstBatch);
    expect(secondChild).toBe(firstChild);
    expect(await buildAPlusImageChildActionId("call-1", "item-b")).not.toBe(firstChild);
  });

  it("only consumes a restored A+ action after the matching local commit", async () => {
    const requestBody = JSON.stringify({
      input: { images: [], referenceObjectIds: [] }
    });
    const cursor = createAPlusImageRestoredActionCursor({
      actionId: "img:item-a",
      actionKind: "image",
      requestBody,
      requestHash: await hashAPlusExternalActionBody(requestBody),
      callId: "call-1"
    });

    expect(cursor.hasPending()).toBe(true);
    expect(cursor.consumeAfterLocalCommit("call-1", "img:item-b")).toBe(false);
    expect(cursor.hasPending()).toBe(true);
    expect(cursor.consumeAfterLocalCommit("call-1", "img:item-a")).toBe(true);
    expect(cursor.hasPending()).toBe(false);
  });
});
