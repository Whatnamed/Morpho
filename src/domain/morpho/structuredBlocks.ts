export function extractStructuredJsonBlock(text: string, marker: string): string | undefined {
  const blocks = extractFencedBlocks(text);
  const exact = blocks.find((block) => block.body.includes(marker) && hasTopLevelKey(block.body, marker));
  if (exact) {
    return exact.body.trim();
  }

  return blocks.find((block) => block.body.includes(marker))?.body.trim();
}

export function containsStructuredBlock(text: string, marker: string): boolean {
  return Boolean(extractStructuredJsonBlock(text, marker));
}

export function stripStructuredBlocksContainingMarkers(text: string, markers: readonly string[]): string {
  return text
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, (block, body: string) =>
      markers.some((marker) => body.includes(marker)) ? "" : block
    )
    .trim();
}

export function sanitizeStructuredStreamForDisplay(rawText: string, markers: readonly string[]): string {
  const withoutClosedBlocks = stripStructuredBlocksContainingMarkers(rawText, markers);
  const lastFenceIndex = withoutClosedBlocks.lastIndexOf("```");
  if (lastFenceIndex < 0) {
    return withoutClosedBlocks.trim();
  }

  const fenceCount = (withoutClosedBlocks.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 0) {
    return withoutClosedBlocks.trim();
  }

  return withoutClosedBlocks.slice(0, lastFenceIndex).trim();
}

function extractFencedBlocks(text: string): Array<{ body: string }> {
  return Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))
    .map((match) => ({ body: match[1] ?? "" }))
    .filter((block) => block.body.trim().length > 0);
}

function hasTopLevelKey(jsonText: string, topLevelKey: string): boolean {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return isRecord(parsed) && isRecord(parsed[topLevelKey]);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
