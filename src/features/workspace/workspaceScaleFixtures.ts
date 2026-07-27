import type {
  AiMessage,
  CanvasInstance,
  ContinuityRecordEntry,
  ContinuitySourceRef,
  DecisionRecord,
  MorphoObject,
  MorphoWorkspace,
  ProjectMemoryRevision,
  ProviderContextFrame
} from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import { buildAgentDefaultMemoryContext } from "@/domain/morpho/projectMemory";
import { buildProviderTaskContext, buildTaskContext } from "./taskContext";
import { appendAgentProviderContextFrames } from "./providerContextFrames";
import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";

/**
 * Shared scaling primitives for the measurement harnesses.
 *
 * Every growth builder replicates records taken from the deployable case study
 * rather than inventing payloads, so per-record sizes and per-record work reflect
 * real Morpho content (Chinese prose, real agent traces, real context frames)
 * instead of a guess.
 *
 * Workspaces assembled from these builders are sized, not exercised. They are not
 * valid product states: cloned records keep dangling references to operations and
 * citations that the blank base workspace does not have. Do not reuse them as
 * behavioural fixtures.
 *
 * Consumers: `storageFootprintScenarios.ts` (byte cost) and
 * `performanceScenarios.ts` (time cost).
 */

export const BLANK_PROJECT_ID = "project-footprint-base";

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function withBlankBase(mutate: (workspace: MorphoWorkspace) => void): MorphoWorkspace {
  const workspace = createBlankWorkspace(BLANK_PROJECT_ID);
  mutate(workspace);
  return workspace;
}

export function cycle<T>(source: readonly T[], count: number): T[] {
  if (source.length === 0) {
    throw new Error("Footprint scenario source is empty; regenerate the case study fixture.");
  }
  const result: T[] = [];
  for (let index = 0; index < count; index += 1) {
    result.push(cloneJson(source[index % source.length] as T));
  }
  return result;
}

export function buildMessages(
  source: readonly AiMessage[],
  count: number,
  idPrefix = "message-footprint"
): AiMessage[] {
  return cycle(source, count).map((message, index) => ({
    ...message,
    id: `${idPrefix}-${index}`,
    createdAt: "2026-07-01T00:00:00.000Z"
  }));
}

/**
 * The case study backup predates provider context frames, so frames cannot be
 * cloned from it. They are produced by the real builder instead: each turn selects
 * different objects, which is what makes turnContext frames accumulate in practice
 * while projectState frames dedupe on unchanged project state.
 */
export function buildRealContextFrames(caseStudy: MorphoWorkspace, turns: number): ProviderContextFrame[] {
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

export function buildObjects(
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

export function buildMemoryRevisions(
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

export function buildDecisionRecords(source: readonly DecisionRecord[], count: number): DecisionRecord[] {
  return cycle(source, count).map((record, index) => ({
    ...record,
    id: `decision-footprint-${index}`,
    createdAt: "2026-07-01T00:00:00.000Z"
  }));
}

/**
 * How continuity source refs are pointed at the scaled workspace.
 *
 * Only two ref kinds carry any real cost, and knowing which is what makes the
 * rewired/dangling pair meaningful rather than decorative:
 *
 * - `message` is the ONLY kind that scans an array. `resolveSourceRefAvailability`
 *   (projectContinuity.ts:1520) runs `workspace.ai.messages.some(...)`, and `.some()`
 *   has no early exit when nothing matches — so a dangling message ref costs a full
 *   scan while a resolvable one exits around its hit position.
 * - `object` / `revision` / `branch` / `deliveryReference` are Record lookups, O(1)
 *   whether or not they resolve. `decision` / `operation` / `citation` do not even
 *   get looked up — they fall through to `sourceAvailability: "active"`.
 *
 * So `rewire` genuinely changes the shape of the work only for message refs.
 * Everything else is rewired for honesty of the fixture, not for timing.
 */
export type ContinuityRefWiring = {
  /** Ids `message`-kind refs point at. Empty leaves them dangling — the worst case. */
  messageIds: readonly string[];
  /** Ids `object`-kind refs point at. */
  objectIds: readonly string[];
  /**
   * Message-kind refs appended to each entry.
   *
   * The shipped case study has ZERO message refs (measured: object=194, decision=27,
   * operation=32, revision=29, citation=15, deliveryReference=1), so the
   * O(entries x refs x messages) path is LATENT, not a cost anyone pays today.
   * `createMessageRef` does produce them for semantic-patch entries, so the path is
   * reachable — set this above zero only to measure that latent cost deliberately,
   * and label the result as latent wherever it is reported.
   */
  messageRefsPerEntry: number;
};

export function buildContinuityEntries(
  source: readonly ContinuityRecordEntry[],
  count: number,
  wiring: ContinuityRefWiring
): ContinuityRecordEntry[] {
  const pick = (pool: readonly string[], seed: number): string | undefined =>
    pool.length === 0 ? undefined : (pool[seed % pool.length] as string);

  return cycle(source, count).map((entry, index) => {
    const rewired: ContinuitySourceRef[] = entry.sourceRefs.map((ref, refIndex) => {
      const replacement =
        ref.kind === "object"
          ? pick(wiring.objectIds, index + refIndex)
          : ref.kind === "message"
            ? pick(wiring.messageIds, index + refIndex)
            : undefined;
      return replacement === undefined ? ref : { ...ref, id: replacement };
    });

    for (let extra = 0; extra < wiring.messageRefsPerEntry; extra += 1) {
      rewired.push({
        kind: "message",
        // Falls back to an id that cannot exist, which is the dangling worst case.
        id: pick(wiring.messageIds, index + extra) ?? `message-absent-${index}-${extra}`
      });
    }

    return {
      ...entry,
      id: `continuity-footprint-${index}`,
      dedupeKey: `${entry.dedupeKey}-footprint-${index}`,
      sourceRefs: rewired,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    };
  });
}

/**
 * One compound workspace across every scale axis at once.
 *
 * Storage cost is additive, so `storageFootprintScenarios.ts` grows a single axis at
 * a time and `diffFootprints` attributes bytes per record. Time cost is not additive:
 * `reconcileProjectMemory` walks objects, continuity entries and messages in the same
 * pass, so the interaction term only appears when the axes are raised together.
 *
 * Takes the case study as an argument rather than rebuilding it, so a scenario table
 * pays that parse once.
 */
export type WorkspaceScaleSpec = {
  projectId?: string;
  objects?: number;
  messages?: number;
  tracedTurns?: number;
  contextFrames?: number;
  memoryRevisions?: number;
  decisionRecords?: number;
  continuityEntries?: number;
  messageRefsPerEntry?: number;
  /** Point object and message refs at ids that exist in the result. */
  rewireRefs?: boolean;
};

export function buildScaledWorkspace(caseStudy: MorphoWorkspace, spec: WorkspaceScaleSpec): MorphoWorkspace {
  const workspace = createBlankWorkspace(spec.projectId ?? BLANK_PROJECT_ID);

  const messages = spec.messages ? buildMessages(caseStudy.ai.messages, spec.messages) : [];
  const tracedSource = caseStudy.ai.messages.filter((message) => message.agentTrace);
  const traced =
    spec.tracedTurns && tracedSource.length > 0
      ? buildMessages(tracedSource, spec.tracedTurns, "message-traced-footprint")
      : [];
  workspace.ai.messages = [...messages, ...traced];

  if (spec.objects) {
    const built = buildObjects(Object.values(caseStudy.objects), caseStudy.canvas.instances, spec.objects);
    workspace.objects = built.objects;
    workspace.canvas.instances = built.instances;
  }

  if (spec.contextFrames) {
    workspace.ai.providerContextFrames = buildRealContextFrames(caseStudy, spec.contextFrames);
  }

  if (spec.memoryRevisions) {
    workspace.projectMemory.revisions = buildMemoryRevisions(
      Object.values(caseStudy.projectMemory.revisions),
      spec.memoryRevisions
    );
  }

  if (spec.decisionRecords && caseStudy.decisionRecords.length > 0) {
    workspace.decisionRecords = buildDecisionRecords(caseStudy.decisionRecords, spec.decisionRecords);
  }

  if (spec.continuityEntries) {
    const rewire = spec.rewireRefs ?? false;
    workspace.projectContinuity.recordEntries = buildContinuityEntries(
      caseStudy.projectContinuity.recordEntries,
      spec.continuityEntries,
      {
        objectIds: rewire ? Object.keys(workspace.objects) : [],
        messageIds: rewire ? workspace.ai.messages.map((message) => message.id) : [],
        messageRefsPerEntry: spec.messageRefsPerEntry ?? 0
      }
    );
  }

  return workspace;
}
