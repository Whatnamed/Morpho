/** Bounds for the complete visual payload of each Agent Provider request. */
export const MAX_AGENT_INPUT_IMAGE_COUNT = 4;
export const MAX_AGENT_INPUT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_AGENT_TOTAL_INPUT_IMAGE_BYTES = 24 * 1024 * 1024;

export function agentInputImageBytes(value: string): number | undefined {
  const match = value.match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return undefined;
  const base64 = match[2]!;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
