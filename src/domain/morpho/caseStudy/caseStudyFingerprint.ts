import type { MorphoWorkspace } from "../types";

export function fingerprintCaseStudyWorkspace(workspace: MorphoWorkspace): string {
  return fingerprintStructuredValue(workspace);
}

export function fingerprintStructuredValue(value: unknown): string {
  const input = JSON.stringify(canonicalizeValue(value));
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalizeValue(value: unknown, path = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalizeValue(item, `${path}[${index}]`));
  }

  if (!isRecord(value)) {
    return value;
  }

  const ignoredKeys = ignoredKeysForPath(path);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => !ignoredKeys.has(key))
      .map((key) => [key, canonicalizeValue(value[key], path ? `${path}.${key}` : key)])
  );
}

function ignoredKeysForPath(path: string): Set<string> {
  if (path === "") {
    return new Set(["ui"]);
  }

  if (path === "project") {
    return new Set(["lastOpenedAt", "updatedAt"]);
  }

  if (path === "canvas") {
    return new Set(["view"]);
  }

  if (path === "workingState") {
    return new Set(["lastReconciledAt"]);
  }

  return new Set();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
