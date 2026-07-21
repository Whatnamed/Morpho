export const MORPHO_AGENT_CONTEXT_POLICY = {
  windowTokens: 256_000,
  prepareTokens: 204_800,
  compactTokens: 230_400,
  targetUncompressedTokens: 16_000
} as const;

export type MorphoAgentContextPolicy = {
  windowTokens: number;
  prepareTokens: number;
  compactTokens: number;
  targetUncompressedTokens: number;
};

export function createMorphoAgentContextPolicy(): MorphoAgentContextPolicy {
  return { ...MORPHO_AGENT_CONTEXT_POLICY };
}
