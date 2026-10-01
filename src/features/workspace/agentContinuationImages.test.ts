import { MAX_AGENT_INPUT_IMAGE_BYTES } from "@/shared/agentImageInputLimits";
import { describe, expect, it } from "vitest";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import { hashProviderImageDataUrl } from "@/domain/morpho/providerInputSnapshot";
import type { AgentReadReceipt } from "@/shared/agentReadCoverage";
import type { TurnTaskContract } from "@/shared/turnTaskContract";
import { materializeContinuationImages } from "./agentContinuationImages";
import { requirementCovered, sourceReceipt } from "./agentSourceReads";
import { evaluateAgentTaskFulfillment } from "./agentTaskFulfillment";

function fixture(sources = 1) {
  const workspace = createTestWorkspace();
  const original = Object.values(workspace.objects).find((object) => object.type === "image")!;
  if (original.type !== "image") throw new Error("image fixture");
  const ids = Array.from({ length: sources + 2 }, (_, index) => `visual-${index}`);
  const reads: AgentReadReceipt[] = ids.map((id, index) => {
    workspace.objects[id] = { ...original, id, incarnationId: `identity-${id}` };
    return { ...sourceReceipt(workspace, id, "image", id, index < sources ? "request" : "tool"), status: "full", representation: "pixels", contentHash: hashProviderImageDataUrl(`data:image/png;base64,${Buffer.from(id).toString("base64")}`), delivered: index < sources };
  });
  const message = (index: number) => ({ role: "user" as const, content: [
    { type: "input_text" as const, text: index < sources ? "原图" : `只读观察 ${ids[index]}；测试` },
    { type: "input_image" as const, image_url: `data:image/png;base64,${Buffer.from(ids[index]!).toString("base64")}` }
  ] });
  const contract: TurnTaskContract = { version: 1, readContractVersion: 1, userGoal: "生成后对照原图评价", primaryFocus: "visualDevelopment", execution: { taskMode: "imageGeneration", taskModeSource: "userSelected", workIntent: "discussion", workIntentSource: "autoRecommended" }, completionConditions: [], requiredReads: [], activities: [{ id: "visual", kind: "visualDevelopment", instruction: "生成后评价", targetObjectIds: ids.slice(0, sources), sourceObjectIds: ids.slice(0, sources), referenceObjectIds: [], excludedObjectIds: [], includeDefaultReference: false, requiredFacts: [], effectGrants: [], expectedOutputs: ["newImages"], expectedVisualCount: 2, observeGeneratedImages: true }] };
  return { workspace, reads, contract, base: { input: ids.slice(0, sources).map((_, index) => message(index)), promptContractVersion: "test", mode: "auto" as const, capabilityIntent: { comparisonAnalysis: false } }, observations: [message(sources), message(sources + 1)], effects: [{ callId: "generation", tool: "generate_visuals", activityId: "visual", status: "executed" as const, objectIds: ids.slice(sources) }], stepSequence: 4 };
}

describe("request-local continuation pixels", () => {
  it("retains the scoped source and both observations, with matching payload hashes", () => {
    const result = materializeContinuationImages(fixture());
    const hashes = result.input.flatMap((message) => message.content).flatMap((part) => part.type === "input_image" ? [hashProviderImageDataUrl(part.image_url)] : []);
    expect(hashes).toHaveLength(3);
    expect(result.coverage.every((receipt) => receipt.requestImageStatus === "materialized" && hashes.includes(receipt.contentHash!))).toBe(true);
  });
  it("keeps three scoped sources first and discloses the fifth image as omitted", () => {
    const input = fixture(3);
    input.reads.at(-1)!.delivered = true; // Historical observation is not current coverage.
    const result = materializeContinuationImages(input);
    expect(result.input.flatMap((message) => message.content).filter((part) => part.type === "input_image")).toHaveLength(4);
    expect(result.coverage.at(-1)).toMatchObject({ status: "unavailable", representation: "metadata", delivered: false, requestImageStatus: "omitted", imageOmissionReason: "imageCount", requestStepSequence: 4 });
    expect(result.reads.at(-1)?.delivered).toBe(true);
    expect(requirementCovered({ tool: "read_workspace_source", kind: "image", objectId: input.reads.at(-1)!.objectId }, result.reads)).toBe(false);
  });
  it("drops original pixels when only the new results need evaluation", () => {
    const input = fixture();
    input.contract = { ...input.contract, activities: input.contract.activities.map((activity) => ({ ...activity, sourceObjectIds: [], targetObjectIds: [] })) };
    const result = materializeContinuationImages(input);
    expect(result.input.flatMap((message) => message.content).filter((part) => part.type === "input_image")).toHaveLength(2);
    expect(result.coverage[0]).toMatchObject({ requestImageStatus: "omitted", imageOmissionReason: "scope", representation: "metadata" });
  });
  it.each(["single", "total"])("honors the %s byte bound with honest omitted coverage", (variant) => {
    const input = fixture(3);
    const size = variant === "single" ? MAX_AGENT_INPUT_IMAGE_BYTES + 1 : MAX_AGENT_INPUT_IMAGE_BYTES;
    input.base.input = input.base.input.map((message, index) => {
      const image_url = `data:image/png;base64,${Buffer.alloc(size, index + 1).toString("base64")}`;
      input.reads[index]!.contentHash = hashProviderImageDataUrl(image_url);
      return { ...message, content: [{ type: "input_image" as const, image_url }] };
    });
    const result = materializeContinuationImages(input);
    const omitted = variant === "single" ? result.coverage.slice(0, 3) : result.coverage.slice(1, 3);
    expect(omitted.every((receipt) => receipt.requestImageStatus === "omitted" && receipt.imageOmissionReason === "imageBytes")).toBe(true);
    if (variant === "single") {
      const fulfillment = evaluateAgentTaskFulfillment({ contract: input.contract, workspace: input.workspace, reads: result.reads, effects: input.effects, providerCompleted: true });
      expect(fulfillment.obligations).toContainEqual(expect.objectContaining({ id: "visual:sourcePixels", status: "blocked" }));
    }
  });
});
