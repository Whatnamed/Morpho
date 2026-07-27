import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace, createCurrentCaseStudyWorkspace } from "@/domain/morpho/workspace";
import { createEditableProjectBackupManifest } from "@/domain/morpho/projectArchive";
import {
  BLANK_PROJECT_ID,
  buildMemoryRevisions,
  buildMessages,
  buildObjects,
  buildRealContextFrames,
  cloneJson,
  withBlankBase
} from "./workspaceScaleFixtures";

/**
 * Measurement fixtures for `npm run measure:storage`.
 *
 * Growth scenarios are assembled from the shared builders in
 * `workspaceScaleFixtures.ts`, which replicate records taken from the deployable
 * case study rather than inventing payloads, so per-record sizes reflect real
 * Morpho content (Chinese prose, real agent traces, real context frames) instead
 * of a guess.
 *
 * Every scenario here grows along a single axis from a blank base, because storage
 * cost is additive and `diffFootprints` derives per-unit growth from a one-axis
 * delta. Time cost is not additive across axes — compound scenarios for the
 * performance harness live in `performanceScenarios.ts` instead, so this file's
 * output stays byte-stable.
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
