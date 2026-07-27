/**
 * Browser-facing re-export of the shared deterministic Agent scripts.
 * Production encoding stays the single source of truth for unit and E2E tests.
 */
export {
  openEndedScript,
  textAnswerScript,
  turnErrorScript,
  type MockAgentScript
} from "@/features/workspace/agentStreamScripts";
