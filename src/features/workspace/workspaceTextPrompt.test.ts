import { describe, expect, it } from "vitest";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import {
  applyWorkspaceTextPromptIfCurrent,
  createWorkspaceTextPromptSession,
  isWorkspaceTextPromptSessionCurrent,
  type WorkspaceTextPrompt,
  type WorkspaceTextPromptState
} from "./workspaceTextPrompt";

const DIRECTION_ID = "direction-soft-rail";

describe("workspace text prompt session boundary", () => {
  it("keeps a same-project rerender valid while giving transitions a new identity", () => {
    const workspace = createWorkspace("project-a");
    const session = createWorkspaceTextPromptSession("project-a", "project-a", true);
    const rerenderedWorkspace = { ...workspace, ui: { ...workspace.ui } };

    expect(isWorkspaceTextPromptSessionCurrent(session, session, rerenderedWorkspace)).toBe(true);

    const nextSession = createWorkspaceTextPromptSession("project-a", "project-a", true);
    expect(nextSession).not.toBe(session);
    expect(isWorkspaceTextPromptSessionCurrent(session, nextSession, rerenderedWorkspace)).toBe(false);
  });

  it("drops a stale prompt after switching from A to B", () => {
    const workspaceA = createWorkspace("project-a");
    const workspaceB = createWorkspace("project-b");
    const sessionA = createWorkspaceTextPromptSession("project-a", "project-a", true);
    const sessionB = createWorkspaceTextPromptSession("project-b", "project-b", true);
    const promptState: WorkspaceTextPromptState = {
      session: sessionA,
      prompt: eliminatePrompt(DIRECTION_ID)
    };

    const result = applyWorkspaceTextPromptIfCurrent(workspaceB, promptState, sessionB, "不再采用");

    expect(result).toEqual({ status: "stale" });
    expect(workspaceB.objects[DIRECTION_ID]).toMatchObject({ status: "primary" });
    expect(workspaceA.objects[DIRECTION_ID]).toMatchObject({ status: "primary" });
  });

  it("does not revive an A prompt after an A to B to A2 transition", () => {
    const workspaceA2 = createWorkspace("project-a");
    const sessionA = createWorkspaceTextPromptSession("project-a", "project-a", true);
    const sessionA2 = createWorkspaceTextPromptSession("project-a", "project-a", true);
    const promptState: WorkspaceTextPromptState = {
      session: sessionA,
      prompt: eliminatePrompt(DIRECTION_ID)
    };

    const result = applyWorkspaceTextPromptIfCurrent(workspaceA2, promptState, sessionA2, "旧提示");

    expect(result).toEqual({ status: "stale" });
    expect(workspaceA2.objects[DIRECTION_ID]).toMatchObject({ status: "primary" });
  });

  it("rejects a restored clone that preserves the prompt target ID", () => {
    const workspaceA = createWorkspace("project-a");
    const sessionA = createWorkspaceTextPromptSession("project-a", "project-a", true);
    const workspaceWithBranch = applyWorkspaceTextPromptIfCurrent(
      workspaceA,
      { session: sessionA, prompt: createPrompt(DIRECTION_ID) },
      sessionA,
      "柔光路线"
    );
    if (workspaceWithBranch.status !== "updated") {
      throw new Error("Expected the branch prompt to create a branch.");
    }
    const createdBranch = Object.values(workspaceWithBranch.workspace.visualBranches).find(
      (branch) => branch.label === "柔光路线"
    );
    if (!createdBranch) {
      throw new Error("Expected a visual branch with the requested label.");
    }
    const branchId = createdBranch.id;

    const restoredClone = createWorkspace("project-b", workspaceWithBranch.workspace);
    const sessionB = createWorkspaceTextPromptSession("project-b", "project-b", true);
    const result = applyWorkspaceTextPromptIfCurrent(
      restoredClone,
      { session: sessionA, prompt: renamePrompt(branchId, "旧名称") },
      sessionB,
      "不应写入 B"
    );

    expect(result).toEqual({ status: "stale" });
    expect(restoredClone.visualBranches[branchId]?.label).toBe("柔光路线");
  });

  it("applies create, rename, and eliminate prompts only for their active session", () => {
    const session = createWorkspaceTextPromptSession("project-a", "project-a", true);
    const workspace = createWorkspace("project-a");

    const created = applyWorkspaceTextPromptIfCurrent(
      workspace,
      { session, prompt: createPrompt(DIRECTION_ID) },
      session,
      "  柔光路线  "
    );
    if (created.status !== "updated") {
      throw new Error("Expected createVisualBranch to update the workspace.");
    }
    const createdBranch = Object.values(created.workspace.visualBranches).find(
      (branch) => branch.label === "柔光路线"
    );
    if (!createdBranch) {
      throw new Error("Expected a visual branch with the requested label.");
    }
    const branchId = createdBranch.id;
    expect(created.workspace.visualBranches[branchId]?.label).toBe("柔光路线");

    const renamed = applyWorkspaceTextPromptIfCurrent(
      created.workspace,
      { session, prompt: renamePrompt(branchId, "柔光路线") },
      session,
      "  支撑路线  "
    );
    if (renamed.status !== "updated") {
      throw new Error("Expected renameVisualBranch to update the workspace.");
    }
    expect(renamed.workspace.visualBranches[branchId]?.label).toBe("支撑路线");

    const eliminated = applyWorkspaceTextPromptIfCurrent(
      renamed.workspace,
      { session, prompt: eliminatePrompt(DIRECTION_ID) },
      session,
      "不再采用"
    );
    if (eliminated.status !== "updated") {
      throw new Error("Expected eliminateDirection to update the workspace.");
    }
    expect(eliminated.workspace.objects[DIRECTION_ID]).toMatchObject({ status: "eliminated" });
    expect(eliminated.notice).toContain("已淘汰方向");
  });
});

function createWorkspace(projectId: string, source?: MorphoWorkspace): MorphoWorkspace {
  const workspace = source ?? createInitialWorkspace();
  return {
    ...workspace,
    project: {
      ...workspace.project,
      id: projectId
    }
  };
}

function createPrompt(directionId: string): WorkspaceTextPrompt {
  return {
    kind: "createVisualBranch",
    directionId,
    title: "新视觉分支",
    body: "",
    label: "分支名称",
    initialValue: ""
  };
}

function renamePrompt(branchId: string, initialValue: string): WorkspaceTextPrompt {
  return {
    kind: "renameVisualBranch",
    branchId,
    title: "重命名视觉分支",
    body: "",
    label: "分支名称",
    initialValue
  };
}

function eliminatePrompt(directionId: string): WorkspaceTextPrompt {
  return {
    kind: "eliminateDirection",
    directionId,
    title: "淘汰方向",
    body: "",
    label: "淘汰理由（可选）",
    initialValue: "",
    allowEmpty: true
  };
}
