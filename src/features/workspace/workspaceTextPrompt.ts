import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  createVisualBranch,
  eliminateDirection,
  renameVisualBranch
} from "@/domain/morpho/workspace";

export type WorkspaceTextPrompt =
  | {
      kind: "createVisualBranch";
      directionId: string;
      title: string;
      body: string;
      label: string;
      initialValue: string;
      allowEmpty?: false;
    }
  | {
      kind: "renameVisualBranch";
      branchId: string;
      title: string;
      body: string;
      label: string;
      initialValue: string;
      allowEmpty?: false;
    }
  | {
      kind: "eliminateDirection";
      directionId: string;
      title: string;
      body: string;
      label: string;
      initialValue: string;
      allowEmpty: true;
    };

export type WorkspaceTextPromptSession = Readonly<{
  projectId: string;
  workspaceId: string;
  workspaceReady: boolean;
  generation: symbol;
}>;

export type WorkspaceTextPromptState = Readonly<{
  session: WorkspaceTextPromptSession;
  prompt: WorkspaceTextPrompt;
}>;

export type WorkspaceTextPromptApplyResult =
  | { status: "blocked"; reason: string }
  | { status: "updated"; workspace: MorphoWorkspace; notice?: string };

export type WorkspaceTextPromptCommitResult =
  | { status: "stale" }
  | WorkspaceTextPromptApplyResult;

export function createWorkspaceTextPromptSession(
  projectId: string,
  workspaceId: string,
  workspaceReady: boolean
): WorkspaceTextPromptSession {
  return {
    projectId,
    workspaceId,
    workspaceReady,
    generation: Symbol("workspace-text-prompt-session")
  };
}

export function isWorkspaceTextPromptSessionCurrent(
  expectedSession: WorkspaceTextPromptSession,
  activeSession: WorkspaceTextPromptSession,
  workspace: MorphoWorkspace
): boolean {
  return (
    activeSession === expectedSession &&
    expectedSession.workspaceReady &&
    workspace.project.id === expectedSession.projectId &&
    workspace.project.id === expectedSession.workspaceId
  );
}

export function applyWorkspaceTextPrompt(
  workspace: MorphoWorkspace,
  prompt: WorkspaceTextPrompt,
  value: string
): WorkspaceTextPromptApplyResult {
  const trimmedValue = value.trim();

  if (prompt.kind === "createVisualBranch") {
    const result = createVisualBranch(workspace, {
      directionId: prompt.directionId,
      label: trimmedValue
    });
    return result.status === "blocked"
      ? result
      : { status: "updated", workspace: result.workspace };
  }

  if (prompt.kind === "renameVisualBranch") {
    const result = renameVisualBranch(workspace, prompt.branchId, trimmedValue);
    return result.status === "blocked"
      ? result
      : { status: "updated", workspace: result.workspace };
  }

  const direction = workspace.objects[prompt.directionId];
  return {
    status: "updated",
    workspace: eliminateDirection(workspace, prompt.directionId, {
      reason: trimmedValue || "用户明确淘汰该方向。"
    }),
    notice:
      direction?.type === "conceptDirection" ? `已淘汰方向「${direction.title}」` : "已淘汰方向"
  };
}

export function applyWorkspaceTextPromptIfCurrent(
  workspace: MorphoWorkspace,
  promptState: WorkspaceTextPromptState,
  activeSession: WorkspaceTextPromptSession,
  value: string
): WorkspaceTextPromptCommitResult {
  if (!isWorkspaceTextPromptSessionCurrent(promptState.session, activeSession, workspace)) {
    return { status: "stale" };
  }

  return applyWorkspaceTextPrompt(workspace, promptState.prompt, value);
}
