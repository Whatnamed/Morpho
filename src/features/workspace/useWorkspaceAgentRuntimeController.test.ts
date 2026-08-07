// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiWorkIntent, MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import type { RunMorphoAgentTurnAPlusInput } from "./agentTurnProductPreparationAPlus";
import type { AgentTurnHost } from "./agentTurnHost";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import {
  useWorkspaceAgentRuntimeController,
  type UseWorkspaceAgentRuntimeControllerInput,
  type WorkspaceAgentRuntimeController
} from "./useWorkspaceAgentRuntimeController";
import type { ImageTaskStatus } from "./workspaceVisualGenerationExecution";

const runnerMocks = vi.hoisted(() => ({
  acknowledge: vi.fn(),
  cancel: vi.fn(),
  detach: vi.fn(),
  recover: vi.fn(),
  resume: vi.fn(),
  manual: vi.fn(),
  run: vi.fn()
}));

vi.mock("./agentTurnRunner", () => ({
  acknowledgeMorphoAgentPendingConfirmation: runnerMocks.acknowledge,
  cancelMorphoAgentTurn: runnerMocks.cancel,
  detachMorphoAgentTurnForPageUnload: runnerMocks.detach,
  recoverMorphoAgentTurn: runnerMocks.recover,
  resumeMorphoAgentTurn: runnerMocks.resume,
  runManualCompactionTurn: runnerMocks.manual,
  runMorphoAgentTurn: runnerMocks.run
}));

const roots: Root[] = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  vi.clearAllMocks();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await act(async () => root.unmount());
    }
  }
  document.body.replaceChildren();
});

describe("useWorkspaceAgentRuntimeController", () => {
  it("recovers once for a ready session and does not repeat on ordinary rerenders", async () => {
    runnerMocks.recover.mockResolvedValue("none");
    const harness = await renderController(createInput());

    expect(runnerMocks.recover).toHaveBeenCalledTimes(1);
    await harness.rerender(createInput({ workspace: harness.workspace(), projectId: "project-a" }));
    expect(runnerMocks.recover).toHaveBeenCalledTimes(1);
  });

  it("keeps an old recovery result from changing the next project session", async () => {
    const oldRecovery = deferred<void>();
    runnerMocks.recover
      .mockImplementationOnce(async (_projectId: string, host: AgentTurnHost) => {
        await oldRecovery.promise;
        host.ui.showRecoveryPending?.();
        return "pending";
      })
      .mockResolvedValueOnce("none");
    const harness = await renderController(createInput({ projectId: "project-a" }));
    await harness.rerender(createInput({ projectId: "project-b", workspace: createBlankWorkspace("project-b"), workspaceReady: false }));
    await harness.rerender(createInput({ projectId: "project-b", workspace: createBlankWorkspace("project-b"), workspaceReady: true }));

    expect(runnerMocks.recover).toHaveBeenCalledTimes(2);
    oldRecovery.resolve();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.current().showRecoveryPending).toBe(false);
    expect(runnerMocks.detach).toHaveBeenCalledWith("project-a");
  });

  it("guards old Host reads and commits after a project switch", async () => {
    runnerMocks.recover.mockResolvedValue("none");
    const harness = await renderController(createInput({ projectId: "project-a" }));
    const oldHost = runnerMocks.recover.mock.calls[0]?.[1] as AgentTurnHost;

    await harness.rerender(createInput({ projectId: "project-b", workspace: createBlankWorkspace("project-b") }));

    expect(() => oldHost.readWorkspace()).toThrowError(
      expect.objectContaining({ code: "agent_turn_host_session_detached" })
    );
    expect(() => oldHost.commitWorkspace(() => ({ workspace: createBlankWorkspace("project-a"), value: undefined }))).toThrowError(
      expect.objectContaining({ code: "agent_turn_host_session_detached" })
    );
  });

  it("preserves abort ownership when an old local visual task finishes after a switch", async () => {
    runnerMocks.recover.mockResolvedValue("none");
    const harness = await renderController(createInput({ projectId: "project-a" }));
    let createdOldTask!: ReturnType<WorkspaceAgentRuntimeController["beginLocalAbortableTask"]>;
    act(() => {
      createdOldTask = harness.current().beginLocalAbortableTask();
    });
    if (!createdOldTask) throw new Error("Expected the old session to own a local task.");
    const oldTask = createdOldTask;

    await harness.rerender(createInput({ projectId: "project-b", workspace: createBlankWorkspace("project-b") }));
    let createdNewTask!: ReturnType<WorkspaceAgentRuntimeController["beginLocalAbortableTask"]>;
    act(() => {
      createdNewTask = harness.current().beginLocalAbortableTask();
    });
    if (!createdNewTask) throw new Error("Expected the new session to own a local task.");
    const newTask = createdNewTask;

    act(() => harness.current().finishLocalAbortableTask(oldTask.controller));
    expect(harness.current().isStreaming).toBe(true);
    expect(newTask.isCurrent()).toBe(true);

    act(() => harness.current().finishLocalAbortableTask(newTask.controller));
    expect(harness.current().isStreaming).toBe(false);
  });

  it("uses recovery resume as the first send action and blocks a new turn while pending", async () => {
    runnerMocks.recover.mockResolvedValue("none");
    runnerMocks.resume.mockResolvedValue("pending");
    const harness = await renderController(createInput());
    const host = runnerMocks.recover.mock.calls[0]?.[1] as AgentTurnHost;

    act(() => host.ui.showRecoveryPending?.());
    await act(async () => {
      await harness.current().send(createTurnInput("新的问题"));
    });

    expect(runnerMocks.resume).toHaveBeenCalledTimes(1);
    expect(runnerMocks.run).not.toHaveBeenCalled();
    expect(runnerMocks.manual).not.toHaveBeenCalled();
    expect(harness.current().showRecoveryPending).toBe(true);
  });

  it("dispatches manual compaction and ordinary turns through the same Controller boundary", async () => {
    runnerMocks.recover.mockResolvedValue("none");
    runnerMocks.manual.mockResolvedValue(undefined);
    runnerMocks.run.mockResolvedValue(undefined);
    const harness = await renderController(createInput());

    await act(async () => {
      await harness.current().send(createTurnInput(" /compact "));
      await harness.current().send(createTurnInput("继续分析"));
    });

    expect(runnerMocks.manual).toHaveBeenCalledWith(expect.objectContaining({ draft: "/compact" }), expect.anything());
    expect(runnerMocks.run).toHaveBeenCalledWith(expect.objectContaining({ draft: "继续分析" }), expect.anything());
  });

  it("does not run local fallback when Runner cancellation handled the active session", async () => {
    runnerMocks.recover.mockResolvedValue("none");
    runnerMocks.cancel.mockResolvedValue(true);
    const harness = await renderController(createInput({ imageTaskStatus: { state: "waiting", message: "等待" } }));
    const commit = harness.commit;

    await act(async () => {
      await harness.current().cancel();
    });

    expect(runnerMocks.cancel).toHaveBeenCalledWith("project-a");
    expect(commit).not.toHaveBeenCalled();
    expect(harness.imageTaskStatus()).toEqual({ state: "waiting", message: "等待" });
  });

  it("uses local cancellation only when Runner has no active session", async () => {
    runnerMocks.recover.mockResolvedValue("none");
    runnerMocks.cancel.mockResolvedValue(false);
    const harness = await renderController(createInput({ imageTaskStatus: { state: "waiting", message: "等待" } }));
    let task!: ReturnType<WorkspaceAgentRuntimeController["beginLocalAbortableTask"]>;
    act(() => {
      task = harness.current().beginLocalAbortableTask();
    });
    if (!task) throw new Error("Expected a local task.");

    await act(async () => {
      await harness.current().cancel();
    });

    expect(task.signal.aborted).toBe(true);
    expect(harness.current().isStreaming).toBe(false);
    expect(harness.imageTaskStatus()).toMatchObject({ state: "cancelled" });
  });
});

function createInput(options: {
  projectId?: string;
  workspace?: MorphoWorkspace;
  workspaceReady?: boolean;
  imageTaskStatus?: ImageTaskStatus | null;
} = {}): UseWorkspaceAgentRuntimeControllerInput & {
  commit: ReturnType<typeof vi.fn>;
  imageTaskStatus: () => ImageTaskStatus | null;
  workspace: () => MorphoWorkspace;
} {
  const projectId = options.projectId ?? "project-a";
  let workspace = options.workspace ?? createBlankWorkspace(projectId);
  let imageTaskStatus = options.imageTaskStatus ?? null;
  const commit = vi.fn((transform: WorkspaceCommitTransform<unknown>) => {
    const result = transform(workspace);
    workspace = result.workspace;
    return result.value;
  });
  const input: UseWorkspaceAgentRuntimeControllerInput = {
    projectId,
    workspaceReady: options.workspaceReady ?? true,
    commitWorkspace: commit as unknown as UseWorkspaceAgentRuntimeControllerInput["commitWorkspace"],
    readWorkspace: () => workspace,
    persistWorkspace: () => ({ phase: "idle" as const, isDirty: false }),
    executeVisualGenerationPlan: vi.fn(async () => {
      throw new Error("visual execution is not part of this test");
    }),
    setContextWarning: vi.fn(),
    clearPendingDeliveryDraftTarget: vi.fn(),
    setDraft: vi.fn(),
    setTaskMode: vi.fn(),
    openConversation: vi.fn(),
    setPendingConfirmation: vi.fn(),
    selectObjects: vi.fn(),
    focusObject: vi.fn(),
    openProposal: vi.fn(),
    setImageTaskStatus: (update) => {
      imageTaskStatus = typeof update === "function" ? update(imageTaskStatus) : update;
    }
  };
  return {
    ...input,
    commit,
    imageTaskStatus: () => imageTaskStatus,
    workspace: () => workspace
  };
}

async function renderController(initialInput: UseWorkspaceAgentRuntimeControllerInput) {
  let controller: WorkspaceAgentRuntimeController | null = null;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  function Harness({ input }: { input: UseWorkspaceAgentRuntimeControllerInput }) {
    controller = useWorkspaceAgentRuntimeController(input);
    return null;
  }

  const render = async (input: UseWorkspaceAgentRuntimeControllerInput) => {
    await act(async () => {
      root.render(createElement(Harness, { input }));
    });
  };
  await render(initialInput);

  const details = initialInput as UseWorkspaceAgentRuntimeControllerInput & {
    commit?: ReturnType<typeof vi.fn>;
    imageTaskStatus?: () => ImageTaskStatus | null;
    workspace?: () => MorphoWorkspace;
  };

  return {
    current: () => {
      if (!controller) throw new Error("Controller did not render.");
      return controller;
    },
    rerender: render,
    commit: details.commit ?? vi.fn(),
    imageTaskStatus: details.imageTaskStatus ?? (() => null),
    workspace: details.workspace ?? (() => createBlankWorkspace("project-a"))
  };
}

function createTurnInput(draft: string): RunMorphoAgentTurnAPlusInput {
  return {
    draft,
    taskMode: "chatAnalysis",
    recommendedTaskMode: "chatAnalysis",
    workIntent: "discussion" as AiWorkIntent,
    recommendedWorkIntent: "discussion" as AiWorkIntent,
    selectedObjectIds: [],
    selectedObjects: [],
    pendingDeliveryDraftTarget: null,
    directionPreviewCount: 2,
    agentTurnMode: "auto",
    imageGenerationModelId: "test-model",
    readConversationTokenLimits: () => undefined
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
