import { reconcileWorkspaceDerivedState } from "@/domain/morpho/derivedState";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { parseWorkspace } from "@/domain/morpho/workspaceCodec";
import legacyNightrailTestFixture from "./nightrail.fixture.json";

export function createTestWorkspace(): MorphoWorkspace {
  const parsed = parseWorkspace(JSON.stringify(legacyNightrailTestFixture));
  if (parsed.status === "failed") {
    throw new Error(`Legacy test workspace is invalid: ${parsed.reason}`);
  }
  return reconcileWorkspaceDerivedState(parsed.workspace);
}
