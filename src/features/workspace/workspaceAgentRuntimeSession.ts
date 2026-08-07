export type WorkspaceAgentRuntimeSession = Readonly<{
  projectId: string;
  workspaceReady: boolean;
  generation: symbol;
}>;

export function createWorkspaceAgentRuntimeSession(
  projectId: string,
  workspaceReady: boolean
): WorkspaceAgentRuntimeSession {
  return {
    projectId,
    workspaceReady,
    generation: Symbol("agent-runtime-session")
  };
}
