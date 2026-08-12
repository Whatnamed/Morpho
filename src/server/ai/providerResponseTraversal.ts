import {
  PROVIDER_RESPONSE_MAX_STRUCTURE_DEPTH,
  PROVIDER_RESPONSE_MAX_STRUCTURE_NODES,
  ProviderResponseBoundaryError
} from "./providerResponseBoundary";

export type ProviderResponseTraversalLimits = Readonly<{
  maxDepth?: number;
  maxNodes?: number;
}>;

export function visitProviderResponseRecords(
  root: unknown,
  visitor: (record: Record<string, unknown>) => void,
  limits: ProviderResponseTraversalLimits = {}
): void {
  const maxDepth = limits.maxDepth ?? PROVIDER_RESPONSE_MAX_STRUCTURE_DEPTH;
  const maxNodes = limits.maxNodes ?? PROVIDER_RESPONSE_MAX_STRUCTURE_NODES;
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let visitedNodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || current.value === null || typeof current.value !== "object") continue;
    visitedNodes += 1;
    if (current.depth > maxDepth || visitedNodes > maxNodes) {
      throw new ProviderResponseBoundaryError("provider_response_too_large");
    }

    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }

    const record = current.value as Record<string, unknown>;
    visitor(record);
    const values = Object.values(record);
    for (let index = values.length - 1; index >= 0; index -= 1) {
      pending.push({ value: values[index], depth: current.depth + 1 });
    }
  }
}
