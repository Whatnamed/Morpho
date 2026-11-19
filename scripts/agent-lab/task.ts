import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { validateCurrentWorkspaceContract } from "@/domain/morpho/currentWorkspaceContractValidation";
import { migrateWorkspaceToCurrentSchema } from "@/domain/morpho/workspace";
import type { RunMorphoAgentTurnAPlusInput } from "@/features/workspace/agentTurnProductPreparationAPlus";
import { loadAgentLabAssets } from "./assets";

const usage = z.strictObject({
  input_tokens: z.int().nonnegative(),
  output_tokens: z.int().nonnegative(),
  total_tokens: z.int().nonnegative()
});
const response = z.strictObject({
  reasoningSummary: z.string().optional(),
  text: z.string().optional(),
  calls: z.array(z.strictObject({ name: z.string().min(1), args: z.record(z.string(), z.unknown()) })).optional(),
  usage: usage.optional()
}).refine((step) => Boolean(step.text?.trim() || step.calls?.length), "A response needs final text or at least one tool call.");
export type ScriptedResponse = z.infer<typeof response>;

const schema = z.strictObject({
  draft: z.string().regex(/\S/).max(12_000).refine((draft) => draft.trim() !== "/compact", "Supply a regular Agent task."),
  workspace: z.string().min(1),
  assetFiles: z.record(z.string(), z.string().min(1)).default({}),
  selectedObjectIds: z.array(z.string().min(1)).default([]),
  taskMode: z.enum(["chatAnalysis", "researchOperation"]).default("chatAnalysis"),
  workIntent: z.enum(["discussion", "comparison", "createDesignDefinition", "reviseDesignDefinition",
    "createConceptDirections", "reviseConceptDirection", "splitConceptDirection", "mergeConceptDirections"]).default("discussion"),
  agentTurnMode: z.enum(["auto", "confirm"]).default("auto"),
  responses: z.array(response).min(1).optional()
});

export function loadAgentLabTask(path: string) {
  const task = schema.parse(readJsonFile(path));
  const { workspace: workspacePath, responses, assetFiles, ...fields } = task;
  const rawWorkspace = readJsonFile(resolve(dirname(path), workspacePath));
  validateCurrentWorkspaceContract(rawWorkspace, (path, message) => {
    throw new Error(`Invalid workspace fixture at ${path}. ${message}`);
  });
  const initial = migrateWorkspaceToCurrentSchema(rawWorkspace);
  if (initial.status === "failed") throw new Error(initial.reason);
  const workspace = initial.workspace;
  const initialWorkspaceSha256 = createHash("sha256").update(JSON.stringify(workspace)).digest("hex");
  workspace.project.id = `agent-lab-${initialWorkspaceSha256.slice(0, 24)}`;
  const selectedObjects = fields.selectedObjectIds.map((id) => {
    const object = workspace.objects[id];
    if (!object || object.visibility !== "active") throw new Error(`Fixture object is absent or hidden: ${id}`);
    return object;
  });
  const input: RunMorphoAgentTurnAPlusInput = {
    ...fields,
    recommendedTaskMode: "chatAnalysis",
    recommendedWorkIntent: "discussion",
    selectedObjects,
    pendingDeliveryDraftTarget: null,
    directionPreviewCount: 1,
    imageGenerationModelId: "unavailable-in-agent-lab",
    readConversationTokenLimits: () => undefined
  };
  return { workspace, initialWorkspaceSha256, assets: loadAgentLabAssets(workspace, dirname(path), assetFiles), task, input, responses };
}

export function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}
