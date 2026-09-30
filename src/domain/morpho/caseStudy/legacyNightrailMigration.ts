import type { MorphoWorkspace } from "../types";
import { fingerprintStructuredValue } from "./caseStudyFingerprint";

export const LEGACY_NIGHTRAIL_PROJECT_ID = "project-nightrail";

const LEGACY_NIGHTRAIL_OBJECT_IDS = [
  "definition-current",
  "delivery-board-a1",
  "delivery-ppt-six",
  "direction-soft-guide",
  "direction-soft-rail",
  "direction-support-island",
  "file-course-brief",
  "file-path-references",
  "fragment-course-goal",
  "image-cmf-board",
  "image-night-scenario",
  "image-path-reference",
  "image-rail-detail",
  "image-soft-guide-preview",
  "image-soft-rail-preview",
  "image-soft-rail-v2",
  "image-support-island-preview",
  "insight-continuous-support",
  "insight-low-construction",
  "insight-nonmedical",
  "research-night-path"
] as const;

const LEGACY_NIGHTRAIL_ASSET_IDS = ["asset-course-brief", "asset-course-brief-extract"] as const;
const LEGACY_NIGHTRAIL_PRISTINE_FINGERPRINT = "d1471aac";
// The exact same untouched fixture after schema 18 marks legacy evidence unknown.
// Keep exact fingerprints: user changes must never qualify for automatic replacement.
const SCHEMA18_LEGACY_NIGHTRAIL_PRISTINE_FINGERPRINT = "7355e9e5";

export const LEGACY_NIGHTRAIL_OBSOLETE_STORAGE_KEYS = ["seed:course-brief", "seed:course-brief-extract"] as const;

export function isPristineLegacyNightrailWorkspace(workspace: MorphoWorkspace): boolean {
  if (workspace.project.id !== LEGACY_NIGHTRAIL_PROJECT_ID) {
    return false;
  }

  if (!sameSortedIds(Object.keys(workspace.objects), LEGACY_NIGHTRAIL_OBJECT_IDS)) {
    return false;
  }

  if (!sameSortedIds(Object.keys(workspace.assets), LEGACY_NIGHTRAIL_ASSET_IDS)) {
    return false;
  }

  if (workspace.ai.messages.length !== 1 || Object.keys(workspace.operations).length !== 0) {
    return false;
  }

  if (workspace.projectContinuity.recordEntries.length !== 0) {
    return false;
  }

  const { projectMemory: _projectMemory, ...withoutMemory } = workspace;
  const {
    conversationCompaction: _conversationCompaction,
    conversationSummaryRevisions: _conversationSummaryRevisions,
    providerContextFrames: _providerContextFrames,
    ...legacyAi
  } = workspace.ai;
  const fingerprint = fingerprintStructuredValue({
    ...withoutMemory,
    // Forward migration identities are runtime metadata, not legacy fixture edits.
    // Strip only live-object identities here; historical bindings stay in the guard.
    objects: Object.fromEntries(Object.entries(workspace.objects).map(([id, object]) => {
      const { incarnationId: _incarnationId, ...legacyObject } = object;
      return [id, legacyObject];
    })),
    schemaVersion: 14,
    ai: legacyAi
  });
  return fingerprint === LEGACY_NIGHTRAIL_PRISTINE_FINGERPRINT || fingerprint === SCHEMA18_LEGACY_NIGHTRAIL_PRISTINE_FINGERPRINT;
}

function sameSortedIds(actual: string[], expected: readonly string[]): boolean {
  const sortedActual = [...actual].sort();
  return sortedActual.length === expected.length && sortedActual.every((id, index) => id === expected[index]);
}
