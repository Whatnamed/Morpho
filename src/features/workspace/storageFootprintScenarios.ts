import type {
  AiMessage,
  CanvasInstance,
  MorphoObject,
  MorphoWorkspace,
  ProjectMemoryRevision,
  ProviderContextFrame
} from "@/domain/morpho/types";
import { createBlankWorkspace, createCurrentCaseStudyWorkspace } from "@/domain/morpho/workspace";
import { createEditableProjectBackupManifest } from "@/domain/morpho/projectArchive";
import { buildAgentDefaultMemoryContext } from "@/domain/morpho/projectMemory";
import { buildProviderTaskContext, buildTaskContext } from "./taskContext";
import { appendAgentProviderContextFrames } from "./providerContextFrames";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";

/**
 * Measurement fixtures for `npm run measure:storage`.
 *
 * Every growth scenario replicates records taken from the deployable case study
 * rather than inventing payloads, so per-record sizes reflect real Morpho content
 * (Chinese prose, real agent traces, real context frames) instead of a guess.
 *
 * These workspaces are sized, not exercised. They are not valid product states:
 * cloned records keep dangling references to operations and citations that the
 * blank base workspace does not have. Do not reuse them as behavioural fixtures.
 */

export type FootprintScenario = {
  key: string;
  label: string;
  workspace: MorphoWorkspace;
  /** Baseline scenario and unit count used to derive per-record growth. */
  growth?: {
    baselineKey: string;
    units: number;
    unitLabel: string;
  };
};

const BLANK_PROJECT_ID = "project-footprint-base";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withBlankBase(mutate: (workspace: MorphoWorkspace) => void): MorphoWorkspace {
  const workspace = createBlankWorkspace(BLANK_PROJECT_ID);
  mutate(workspace);
  return workspace;
}

function cycle<T>(source: readonly T[], count: number): T[] {
  if (source.length === 0) {
    throw new Error("Footprint scenario source is empty; regenerate the case study fixture.");
  }
  const result: T[] = [];
  for (let index = 0; index < count; index += 1) {
    result.push(cloneJson(source[index % source.length] as T));
  }
  return result;
}

function buildMessages(source: readonly AiMessage[], count: number): AiMessage[] {
  return cycle(source, count).map((message, index) => ({
    ...message,
    id: `message-footprint-${index}`,
    createdAt: "2026-07-01T00:00:00.000Z"
  }));
}

/**
 * The case study backup predates provider context frames, so frames cannot be
 * cloned from it. They are produced by the real builder instead: each turn selects
 * different objects, which is what makes turnContext frames accumulate in practice
 * while projectState frames dedupe on unchanged project state.
 */
function buildRealContextFrames(caseStudy: MorphoWorkspace, turns: number): ProviderContextFrame[] {
  const selectableObjectIds = Object.values(caseStudy.objects)
    .filter((object) => object.visibility === "active")
    .map((object) => object.id);
  const drafts = caseStudy.ai.messages
    .filter((message) => message.role === "user" && message.body.length > 0)
    .map((message) => message.body);
  if (selectableObjectIds.length === 0 || drafts.length === 0) {
    throw new Error("Case study has no selectable objects or user drafts; regenerate the fixture.");
  }

  let workspace = caseStudy;
  for (let turn = 0; turn < turns; turn += 1) {
    const selectedObjectIds = [
      selectableObjectIds[turn % selectableObjectIds.length] as string,
      selectableObjectIds[(turn + 1) % selectableObjectIds.length] as string
    ];
    const draft = drafts[turn % drafts.length] as string;
    const context = buildTaskContext(workspace, {
      kind: "general",
      draft,
      selectedObjectIds
    });

    workspace = appendAgentProviderContextFrames(workspace, {
      workspace,
      projectId: workspace.project.id,
      strategy: "discussion",
      mode: "auto",
      promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
      userMessageId: `message-footprint-frame-${turn}`,
      context,
      providerTaskContext: buildProviderTaskContext(context),
      defaultMemoryContext: buildAgentDefaultMemoryContext(workspace, "discussion")
    });
  }

  return (workspace.ai.providerContextFrames ?? []).map((frame, index) => ({
    ...frame,
    createdAt: "2026-07-01T00:00:00.000Z",
    sequence: index + 1
  }));
}

function buildObjects(
  source: readonly MorphoObject[],
  instances: readonly CanvasInstance[],
  count: number
): { objects: Record<string, MorphoObject>; instances: CanvasInstance[] } {
  const instanceByObjectId = new Map(instances.map((instance) => [instance.objectId, instance]));
  const objects: Record<string, MorphoObject> = {};
  const clonedInstances: CanvasInstance[] = [];

  cycle(source, count).forEach((object, index) => {
    const objectId = `object-footprint-${index}`;
    objects[objectId] = { ...object, id: objectId } as MorphoObject;

    const template = instanceByObjectId.get(object.id);
    if (template) {
      clonedInstances.push({
        ...cloneJson(template),
        id: `instance-footprint-${index}`,
        objectId
      });
    }
  });

  return { objects, instances: clonedInstances };
}

function buildMemoryRevisions(
  source: readonly ProjectMemoryRevision[],
  count: number
): Record<string, ProjectMemoryRevision> {
  const revisions: Record<string, ProjectMemoryRevision> = {};
  cycle(source, count).forEach((revision, index) => {
    const id = `memory-revision-footprint-${index}`;
    revisions[id] = {
      ...revision,
      id,
      previousRevisionId: index === 0 ? undefined : `memory-revision-footprint-${index - 1}`,
      createdAt: "2026-07-01T00:00:00.000Z"
    };
  });
  return revisions;
}

/**
 * The workspace a restore writes back into localStorage. Asset binaries live in
 * IndexedDB, so the localStorage cost of a restore is the sanitized snapshot plus
 * regenerated runtime storage keys — which is exactly what this measures.
 */
function buildRestoredBackupWorkspace(caseStudy: MorphoWorkspace): MorphoWorkspace {
  const created = createEditableProjectBackupManifest(caseStudy, {
    createdAt: "2026-07-01T00:00:00.000Z",
    chat: "full",
    projectContinuity: "current"
  });
  if (created.status !== "ok") {
    throw new Error(`Editable backup manifest could not be created: ${created.reason}`);
  }

  const snapshot = created.manifest.workspaceSnapshot;
  const restoredProjectId = "project-footprint-restored";
  const assets = Object.fromEntries(
    Object.entries(snapshot.assets).map(([assetId, portableAsset]) => [
      assetId,
      { ...portableAsset, storageKey: `morpho.asset.${restoredProjectId}.${assetId}` }
    ])
  );

  return {
    ...cloneJson(snapshot),
    assets,
    project: {
      ...snapshot.project,
      id: restoredProjectId
    }
  } as MorphoWorkspace;
}

export function buildFootprintScenarios(): FootprintScenario[] {
  const caseStudy = createCurrentCaseStudyWorkspace();
  const sourceMessages = caseStudy.ai.messages;
  const tracedMessages = sourceMessages.filter((message) => message.agentTrace);
  const sourceObjects = Object.values(caseStudy.objects);
  const sourceRevisions = Object.values(caseStudy.projectMemory.revisions);

  return [
    {
      key: "blank",
      label: "空白项目",
      workspace: createBlankWorkspace(BLANK_PROJECT_ID)
    },
    {
      key: "caseStudy",
      label: "内置案例（project-morpho-case-study）",
      workspace: caseStudy
    },
    {
      key: "chat100",
      label: "空白项目 + 100 条聊天",
      workspace: withBlankBase((workspace) => {
        workspace.ai.messages = buildMessages(sourceMessages, 100);
      }),
      growth: { baselineKey: "blank", units: 100, unitLabel: "条聊天" }
    },
    {
      key: "chat500",
      label: "空白项目 + 500 条聊天",
      workspace: withBlankBase((workspace) => {
        workspace.ai.messages = buildMessages(sourceMessages, 500);
      }),
      growth: { baselineKey: "chat100", units: 400, unitLabel: "条聊天" }
    },
    {
      key: "agentTraces",
      label: "空白项目 + 60 条带 Agent trace 的回合",
      workspace: withBlankBase((workspace) => {
        workspace.ai.messages = buildMessages(tracedMessages, 60);
      }),
      growth: { baselineKey: "blank", units: 60, unitLabel: "条 trace 回合" }
    },
    {
      key: "contextFrames",
      label: "空白项目 + 120 个真实回合产生的 Context Frame",
      workspace: withBlankBase((workspace) => {
        workspace.ai.providerContextFrames = buildRealContextFrames(caseStudy, 120);
      }),
      growth: { baselineKey: "blank", units: 120, unitLabel: "个回合" }
    },
    {
      key: "objects",
      label: "空白项目 + 600 个对象及画布实例",
      workspace: withBlankBase((workspace) => {
        const built = buildObjects(sourceObjects, caseStudy.canvas.instances, 600);
        workspace.objects = built.objects;
        workspace.canvas.instances = built.instances;
      }),
      growth: { baselineKey: "blank", units: 600, unitLabel: "个对象" }
    },
    {
      key: "memoryRevisions",
      label: "空白项目 + 200 条项目记忆修订",
      workspace: withBlankBase((workspace) => {
        workspace.projectMemory.revisions = buildMemoryRevisions(sourceRevisions, 200);
      }),
      growth: { baselineKey: "blank", units: 200, unitLabel: "条修订" }
    },
    {
      key: "restoredBackup",
      label: "内置案例经可编辑备份还原后",
      workspace: buildRestoredBackupWorkspace(caseStudy),
      growth: { baselineKey: "caseStudy", units: 1, unitLabel: "次还原" }
    }
  ];
}
