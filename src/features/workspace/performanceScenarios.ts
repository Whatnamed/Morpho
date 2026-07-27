import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createCurrentCaseStudyWorkspace } from "@/domain/morpho/workspace";
import { buildScaledWorkspace, type WorkspaceScaleSpec } from "./workspaceScaleFixtures";

/**
 * Scale tiers for `npm run measure:perf` and the browser performance baseline.
 *
 * Separate from `storageFootprintScenarios.ts` on purpose. Storage cost is additive,
 * so those scenarios raise one axis at a time and `diffFootprints` attributes bytes
 * per record. Time cost is not additive: `reconcileProjectMemory` walks objects,
 * continuity entries and messages in one pass, so the interaction term only shows up
 * when the axes are raised together. Keeping the two tables apart also keeps
 * `storage-footprint.generated.json` byte-stable.
 *
 * These workspaces are sized, not exercised — see `workspaceScaleFixtures.ts`.
 */

export type PerformanceScenarioScale = {
  objects: number;
  canvasInstances: number;
  messages: number;
  contextFrames: number;
  memoryRevisions: number;
  decisionRecords: number;
  continuityEntries: number;
  continuitySourceRefs: number;
  messageSourceRefs: number;
};

export type PerformanceScenario = {
  key: string;
  label: string;
  workspace: MorphoWorkspace;
  /** Measured from the built workspace, never copied from the spec. */
  scale: PerformanceScenarioScale;
  /** Carried verbatim into the generated report so a number is never read bare. */
  note?: string;
};

/** The axis levels every non-compound tier holds steady while one axis moves. */
const BASE: WorkspaceScaleSpec = {
  objects: 40,
  messages: 40,
  tracedTurns: 6,
  contextFrames: 12,
  memoryRevisions: 20,
  decisionRecords: 32,
  continuityEntries: 32,
  rewireRefs: true
};

const COMPOUND: WorkspaceScaleSpec = {
  objects: 500,
  messages: 500,
  tracedTurns: 60,
  contextFrames: 120,
  // Capped well below the 200-revision storage tier: revisions are the largest
  // per-record cost (~14.8 KiB each), and the browser seed has to fit in a ~9.95 MiB
  // localStorage quota alongside everything else in this scenario.
  memoryRevisions: 60,
  decisionRecords: 200,
  continuityEntries: 200,
  rewireRefs: true
};

function measureScale(workspace: MorphoWorkspace): PerformanceScenarioScale {
  const entries = workspace.projectContinuity.recordEntries;
  const refs = entries.flatMap((entry) => entry.sourceRefs);
  return {
    objects: Object.keys(workspace.objects).length,
    canvasInstances: workspace.canvas.instances.length,
    messages: workspace.ai.messages.length,
    contextFrames: workspace.ai.providerContextFrames?.length ?? 0,
    memoryRevisions: Object.keys(workspace.projectMemory.revisions).length,
    decisionRecords: workspace.decisionRecords.length,
    continuityEntries: entries.length,
    continuitySourceRefs: refs.length,
    messageSourceRefs: refs.filter((ref) => ref.kind === "message").length
  };
}

function scenario(
  key: string,
  label: string,
  workspace: MorphoWorkspace,
  note?: string
): PerformanceScenario {
  return { key, label, workspace, scale: measureScale(workspace), note };
}

export function buildPerformanceScenarios(): PerformanceScenario[] {
  const caseStudy = createCurrentCaseStudyWorkspace();
  const scaled = (spec: WorkspaceScaleSpec) => buildScaledWorkspace(caseStudy, spec);

  return [
    scenario(
      "caseStudy",
      "内置案例（真实项目，未克隆）",
      caseStudy,
      "唯一的真实项目状态。其余档位为按规模克隆的合成夹具，引用悬空，成本偏悲观。"
    ),
    scenario("objects100", "100 个对象", scaled({ ...BASE, objects: 100 })),
    scenario("objects300", "300 个对象", scaled({ ...BASE, objects: 300 })),
    scenario("objects500", "500 个对象", scaled({ ...BASE, objects: 500 })),
    scenario("chatLong", "500 条聊天 + 60 条 trace 回合", scaled({ ...BASE, messages: 500, tracedTurns: 60 })),
    scenario("framesHeavy", "120 个 Context Frame", scaled({ ...BASE, contextFrames: 120 })),
    scenario("memoryHeavy", "200 条项目记忆修订", scaled({ ...BASE, memoryRevisions: 200 })),
    scenario(
      "compound500",
      "复合最坏情况（引用已重连）",
      scaled(COMPOUND),
      "所有轴同时拉高。对象与消息引用指向真实存在的 id。"
    ),
    scenario(
      "compound500Dangling",
      "复合最坏情况（引用悬空）",
      scaled({ ...COMPOUND, rewireRefs: false }),
      "与 compound500 规模相同，唯一差别是引用不解析。二者之差 = 合成夹具悬空引用的实测代价。"
    ),
    scenario(
      "compound500LatentMessageRefs",
      "复合最坏情况 + 每条 continuity 注入 2 个 message 引用",
      scaled({ ...COMPOUND, messageRefsPerEntry: 2 }),
      "LATENT：已发布的案例项目中 message 类 sourceRef 为 0，今天没有任何项目在付这个成本。" +
        "此档位为刻意注入，用于量化 O(entries x refs x messages) 这条路径一旦被触发有多贵。" +
        "不得据此单独论证优化的必要性。"
    )
  ];
}
