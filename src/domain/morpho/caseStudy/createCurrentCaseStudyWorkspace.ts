import type { MorphoWorkspace } from "../types";
import { reconcileWorkspaceDerivedState } from "../derivedState";
import { parseWorkspace } from "../workspaceCodec";
import { CURRENT_CASE_STUDY_ID } from "./currentCaseStudyConstants";
import template from "./currentCaseWorkspace.generated.json";

export function createCurrentCaseStudyWorkspace(): MorphoWorkspace {
  const parsed = parseWorkspace(JSON.stringify(template));
  if (parsed.status === "failed") throw new Error(parsed.reason);
  if (parsed.workspace.project.id !== CURRENT_CASE_STUDY_ID) throw new Error("Invalid case study project ID.");
  return reconcileWorkspaceDerivedState(parsed.workspace);
}
