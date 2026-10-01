import { hashProviderImageDataUrl } from "@/domain/morpho/providerInputSnapshot";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import type { AgentEffectReceipt, AgentReadReceipt } from "@/shared/agentReadCoverage";
import { agentInputImageBytes, MAX_AGENT_INPUT_IMAGE_BYTES, MAX_AGENT_INPUT_IMAGE_COUNT, MAX_AGENT_TOTAL_INPUT_IMAGE_BYTES } from "@/shared/agentImageInputLimits";
import type { APlusAgentProviderMessage, APlusAgentProviderRequest } from "@/shared/agentTurnJournalProtocol";
import type { TurnTaskContract } from "@/shared/turnTaskContract";

/** Only a fresh request calls this; submitted Coordinator bodies remain immutable. */
export function materializeContinuationImages(input: {
  base: APlusAgentProviderRequest; observations: readonly APlusAgentProviderMessage[];
  reads: readonly AgentReadReceipt[]; effects: readonly AgentEffectReceipt[];
  workspace: MorphoWorkspace; contract: TurnTaskContract; stepSequence: number;
}): { input: APlusAgentProviderMessage[]; reads: AgentReadReceipt[]; coverage: AgentReadReceipt[] } {
  const needed = new Set<string>();
  const generated = new Set<string>();
  for (const activity of input.contract.activities) {
    if (activity.scopeBlockedReason) continue;
    const results = input.effects.filter((effect) => effect.activityId === activity.id && effect.tool === "generate_visuals" && effect.status === "executed").flatMap((effect) => effect.objectIds);
    const generationPending = activity.expectedOutputs.includes("newImages") && new Set(results).size < (activity.expectedVisualCount ?? 1);
    if (activity.observeGeneratedImages) results.forEach((id) => generated.add(id));
    if (activity.observeGeneratedImages || generationPending || !["visualDevelopment", "directionPreview"].includes(activity.kind)) {
      [...activity.sourceObjectIds, ...activity.referenceObjectIds, ...activity.targetObjectIds].forEach((id) => {
        if (!activity.excludedObjectIds.includes(id)) needed.add(id);
      });
    }
  }
  input.contract.requiredReads.forEach((read) => { if (read.tool === "read_workspace_source" && read.kind === "image") needed.add(read.objectId); });
  const relevant = (id: string) => (needed.has(id) || generated.has(id)) && input.workspace.objects[id]?.visibility === "active";
  const reads = input.reads.map((receipt): AgentReadReceipt => receipt.kind === "image" && ["pixels", "contactSheet"].includes(receipt.representation ?? "")
    ? { ...receipt, requestStepSequence: input.stepSequence, requestImageStatus: "omitted", imageOmissionReason: relevant(receipt.objectId) ? "unavailable" : "scope" }
    : { ...receipt });
  const retained = input.base.input.filter((message) => !message.content.some((part) => "text" in part && (part.text.startsWith("<morpho_fresh_context>") || part.text.startsWith("只读观察 ") || part.text.startsWith("本次原始参考像素 "))));
  const candidates: Array<{ message: APlusAgentProviderMessage; receipts: AgentReadReceipt[] }> = [];
  // Original scoped pixels first, in their existing request order. Contact sheets
  // are indivisible: never carry an unrelated member just to retain another one.
  for (const message of input.base.input.filter((message) => !message.content.some((part) => "text" in part && part.text.startsWith("只读观察 ")))) {
    for (const part of message.content) {
      if (part.type !== "input_image") continue;
      const hash = hashProviderImageDataUrl(part.image_url);
      const matches = reads.filter((receipt) => receipt.source === "request" && receipt.kind === "image" && receipt.contentHash === hash && ["pixels", "contactSheet"].includes(receipt.representation ?? ""));
      if (!matches.length || matches.some((receipt) => !relevant(receipt.objectId))) continue;
      candidates.push({ receipts: matches, message: { role: "user", content: [{ type: "input_text", text: `本次原始参考像素 ${JSON.stringify(matches.map((receipt) => receipt.objectId))}` }, part] } });
    }
  }
  // Observation IDs come from the existing read result, not arbitrary new scope.
  for (const message of input.observations) {
    const label = message.content.find((part) => "text" in part && part.text.startsWith("只读观察 "));
    if (!label || !("text" in label)) continue;
    const objectId = label.text.slice("只读观察 ".length).split("；")[0]!;
    if (!relevant(objectId)) continue;
    for (const part of message.content) {
      if (part.type !== "input_image") continue;
      const hash = hashProviderImageDataUrl(part.image_url);
      const matches = reads.filter((receipt) => receipt.kind === "image" && receipt.objectId === objectId && receipt.contentHash === hash && ["pixels", "contactSheet"].includes(receipt.representation ?? ""));
      if (!matches.length || candidates.some((candidate) => candidate.receipts.some((receipt) => receipt.objectId === objectId))) continue;
      candidates.push({ receipts: matches, message: { role: "user", content: [label, part] } });
    }
  }
  let bytes = 0;
  const images: APlusAgentProviderMessage[] = [];
  for (const candidate of candidates) {
    const part = candidate.message.content.find((part) => part.type === "input_image")!;
    if (part.type !== "input_image") continue;
    const size = agentInputImageBytes(part.image_url);
    const omission = size === undefined || size > MAX_AGENT_INPUT_IMAGE_BYTES || bytes + size > MAX_AGENT_TOTAL_INPUT_IMAGE_BYTES ? "imageBytes" : images.length >= MAX_AGENT_INPUT_IMAGE_COUNT ? "imageCount" : undefined;
    candidate.receipts.forEach((receipt) => {
      if (receipt.requestImageStatus === "materialized") return;
      receipt.requestImageStatus = omission ? "omitted" : "materialized";
      receipt.imageOmissionReason = omission;
    });
    if (omission) continue;
    images.push(candidate.message); bytes += size!;
  }
  // This projection describes only this payload. Historical delivered receipts
  // remain in runtime state, with an explicit request-local image status.
  const coverage = reads.map((receipt): AgentReadReceipt => receipt.requestImageStatus === "omitted"
    ? { ...receipt, status: "unavailable", representation: "metadata", delivered: false }
    : receipt.requestImageStatus === "materialized" ? { ...receipt, delivered: false } : receipt);
  const coverageText = `<morpho_input_coverage>\n${JSON.stringify(coverage)}\n</morpho_input_coverage>\n本次 request 的像素覆盖以 requestImageStatus 为准；omitted 仅有历史回执，不能用于本次视觉比较。`;
  const textInput = retained.map((message): APlusAgentProviderMessage => ({ ...message, content: message.content.filter((part) => part.type !== "input_image").map((part) => "text" in part && part.text.startsWith("<morpho_input_coverage>") ? { type: "input_text", text: coverageText } : part) })).filter((message) => message.content.length);
  if (!textInput.some((message) => message.content.some((part) => "text" in part && part.text.startsWith("<morpho_input_coverage>")))) textInput.push({ role: "user", content: [{ type: "input_text", text: coverageText }] });
  return { reads, coverage, input: [...textInput, ...images] };
}
