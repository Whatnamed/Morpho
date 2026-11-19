import { createHash } from "node:crypto";
import { z } from "zod";

import { agentInputImageBytes } from "@/shared/agentImageInputLimits";
import { getAgentToolEffect, isMorphoAgentToolName, type MorphoAgentToolName } from "@/shared/agentToolContract";
import { isDesignMethodPackId, MAX_METHOD_PACKS_PER_TURN, type DesignMethodPackId } from "@/shared/designMethodPack";

import type { OpenAiCompatibleConfig } from "./openaiCompatibleConfig";

export const AGENT_LAB_HEADER = "x-morpho-agent-lab";
export const AGENT_LAB_REQUEST_EVENT = "lab-provider-request" as const;

const nonBlank = z.string().regex(/\S/);
const toolName = z.custom<MorphoAgentToolName>((name) => typeof name === "string" &&
  isMorphoAgentToolName(name) && isAgentLabTool(name), "Expected a registered tool with no external execution.");
const profileSchema = z.strictObject({
  name: nonBlank.max(80),
  systemPrompt: nonBlank.max(120_000).optional(),
  methods: z.array(z.strictObject({
    id: z.custom<DesignMethodPackId>(isDesignMethodPackId, "Unknown Method Pack."),
    title: nonBlank.max(200).optional(),
    lines: z.array(nonBlank.max(12_000)).min(1).max(20).optional()
  })).max(MAX_METHOD_PACKS_PER_TURN).refine((methods) => new Set(methods.map(({ id }) => id)).size === methods.length,
    "Duplicate Method Pack.").optional(),
  tools: z.array(toolName).refine((tools) => new Set(tools).size === tools.length, "Duplicate tool.").optional(),
  model: nonBlank.trim().max(200).optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).nullable().optional()
});

export type AgentLabProfile = z.infer<typeof profileSchema>;

export function isAgentLabTool(name: MorphoAgentToolName): boolean {
  const effect = getAgentToolEffect(name);
  return !effect.externalCost && !effect.externalEvidence;
}

export async function loadAgentLabProfile(path: string): Promise<AgentLabProfile> {
  const { readFile } = await import("node:fs/promises");
  return profileSchema.parse(JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")));
}

export function agentLabProfileId(profile: AgentLabProfile): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

/** The header selects an exact, server-configured local profile. It carries no options or authority. */
export async function resolveAgentLabRequest(
  request: Request,
  env: Partial<NodeJS.ProcessEnv> = process.env
): Promise<AgentLabProfile | Response | undefined> {
  const requestedId = request.headers.get(AGENT_LAB_HEADER);
  if (requestedId === null) return undefined;
  if (env.NODE_ENV !== "development" || env.MORPHO_ALLOW_PAID_SMOKE_TESTS !== "true" ||
    !env.MORPHO_AGENT_LAB_PROFILE || !isAgentLabLoopback(new URL(request.url))) {
    return Response.json({ code: "agent_lab_unavailable", error: "Agent Lab requires an opted-in loopback dev server." }, { status: 404 });
  }
  try {
    const profile = await loadAgentLabProfile(env.MORPHO_AGENT_LAB_PROFILE);
    if (requestedId === agentLabProfileId(profile)) return profile;
  } catch {
    // Keep server file paths and profile content out of HTTP errors.
  }
  return Response.json({ code: "agent_lab_profile_mismatch", error: "Agent Lab profile changed or could not be loaded." }, { status: 409 });
}

export function isAgentLabLoopback(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol);
}

export function isAgentLabProjectId(value: string): boolean {
  return /^agent-lab-[0-9a-f]{24}$/.test(value);
}

export function applyAgentLabModel(config: OpenAiCompatibleConfig, profile: AgentLabProfile): OpenAiCompatibleConfig {
  return {
    ...config,
    model: profile.model ?? config.model,
    reasoningEffort: profile.reasoningEffort === undefined ? config.reasoningEffort : profile.reasoningEffort ?? undefined
  };
}

/** Project the exact serialized Responses body for local export. */
export function captureAgentLabProviderBody(serialized: string): Record<string, unknown> {
  return JSON.parse(serialized, (key: string, value: unknown) => {
    if (key !== "image_url" || typeof value !== "string") return value;
    const byteLength = agentInputImageBytes(value);
    if (byteLength === undefined) return { omitted: true };
    const [mime, data] = value.split(",", 2);
    return {
      mimeType: mime.slice("data:".length, mime.indexOf(";")),
      byteLength,
      sha256: createHash("sha256").update(Buffer.from(data, "base64")).digest("hex")
    };
  }) as Record<string, unknown>;
}
