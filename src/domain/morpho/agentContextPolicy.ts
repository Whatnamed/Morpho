/**
 * The Provider request also has a hard item ceiling (1024 input items). Many short
 * turns can reach it long before the token thresholds, so compaction has to watch
 * both. The item thresholds leave headroom for the server-managed prefix and the
 * items a single turn still adds before the next request.
 */
export const MORPHO_AGENT_CONTEXT_POLICY = {
  windowTokens: 256_000,
  prepareTokens: 204_800,
  compactTokens: 230_400,
  targetUncompressedTokens: 16_000,
  responseReserveTokens: 16_000,
  prepareItemCount: 800,
  compactItemCount: 880
} as const;

export type MorphoAgentContextPolicy = {
  windowTokens: number;
  prepareTokens: number;
  compactTokens: number;
  targetUncompressedTokens: number;
  responseReserveTokens: number;
  prepareItemCount: number;
  compactItemCount: number;
};

export function createMorphoAgentContextPolicy(): MorphoAgentContextPolicy {
  return { ...MORPHO_AGENT_CONTEXT_POLICY };
}
