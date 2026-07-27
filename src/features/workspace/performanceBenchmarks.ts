import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentTrace, MorphoWorkspace } from "@/domain/morpho/types";
import {
  getRenderableCanvasInstances,
  parseWorkspace,
  serializeWorkspace
} from "@/domain/morpho/workspace";
import {
  createEmptyProjectMemoryState,
  reconcileProjectMemory,
  reconcileProjectMemoryAfterWorkspaceChange
} from "@/domain/morpho/projectMemory";
import { interruptActiveOperations } from "@/domain/operations/operations";
import { createMemoryStorage } from "@/infrastructure/persistence/memoryStorage";
import {
  initializeLocalProjectCatalog,
  persistProjectWorkspaceAndSummary
} from "@/infrastructure/persistence/localProjectStore";
import { AiConversationPanel } from "./components/AiConversationPanel";
import { buildAiConversationPanelProps } from "./components/aiConversationPanelProps";
import { AgentProcessDisclosure } from "./components/AgentProcessDisclosure";
import type { PerformanceScenario } from "./performanceScenarios";

/**
 * The timed targets for `npm run measure:perf`.
 *
 * Deliberately imports nothing from `tldraw`. The Vite SSR loader turned out to
 * handle tldraw fine, but a tldraw editor still cannot be driven headlessly — the
 * canvas sync path is measured in the browser instead, where it is real.
 *
 * Every timestamp is pinned. `reconcileProjectMemory` defaults `now` to
 * `new Date().toISOString()`, which would make each iteration write a differently
 * stamped revision and quietly measure a different amount of work each time.
 */
const FIXED_NOW = "2026-07-01T00:00:00.000Z";

/**
 * One prepared, timed unit of work.
 *
 * `prepare` does all setup and closes over it, so `run` contains only the operation
 * under measurement. `verify` is what stops this harness from reporting a fast number
 * for work that never happened — the guard test asserts it for every target.
 */
export type PreparedBenchmark = {
  run: () => unknown;
  verify: (output: unknown) => boolean;
};

export type BenchmarkTarget = {
  key: string;
  label: string;
  unit: string;
  /**
   * Calls per timed sample; the driver divides the elapsed time by it.
   *
   * A target costing ~1 microsecond cannot be timed one call at a time —
   * `performance.now()` resolution dominates and the relative margin of error comes
   * out in the tens of percent, which reads as "noisy code" when it actually means
   * "unmeasurable instrument". Batching those targets is a fix to the instrument, not
   * a way to make a number look better; the batch size is recorded in the report so a
   * reader can see which figures are per-call averages.
   */
  iterationsPerSample?: number;
  /** Returns null when the scenario cannot exercise this target. */
  prepare: (scenario: PerformanceScenario) => PreparedBenchmark | null;
};

function collectTrace(workspace: MorphoWorkspace): AgentTrace | null {
  const parts = workspace.ai.messages.flatMap((message) => message.agentTrace?.parts ?? []);
  if (parts.length === 0) {
    return null;
  }
  return { startedAt: FIXED_NOW, completedAt: FIXED_NOW, parts, status: "done" };
}

export const PERFORMANCE_TARGETS: BenchmarkTarget[] = [
  {
    key: "reconcile:steady",
    label: "reconcileProjectMemory（投影命中，无写入）",
    unit: "ms/次",
    // The 4A raw projection cost. Phase 4C keeps this target so the semantic guard
    // can be compared against the exact full-reconciliation path it avoids.
    prepare: (scenario) => {
      const settled = reconcileProjectMemory(scenario.workspace, FIXED_NOW);
      return {
        run: () => reconcileProjectMemory(settled, FIXED_NOW),
        // The referential short-circuit at projectMemory.ts:209 must hold, otherwise
        // this is silently measuring the cold path instead.
        verify: (output) => output === settled
      };
    }
  },
  {
    key: "reconcile:guardedMessageBody",
    label: "Project Memory 语义门（已有消息正文更新）",
    unit: "ms/次",
    prepare: (scenario) => {
      const settled = reconcileProjectMemory(scenario.workspace, FIXED_NOW);
      const targetMessage = settled.ai.messages.at(-1);
      if (!targetMessage) {
        return null;
      }
      const bodyUpdated: MorphoWorkspace = {
        ...settled,
        ai: {
          ...settled.ai,
          messages: settled.ai.messages.map((message) =>
            message.id === targetMessage.id ? { ...message, body: `${message.body} stream` } : message
          )
        }
      };
      return {
        run: () => reconcileProjectMemoryAfterWorkspaceChange(settled, bodyUpdated, FIXED_NOW),
        verify: (output) => output === bodyUpdated
      };
    }
  },
  {
    key: "reconcile:cold",
    label: "reconcileProjectMemory（首次投影，产生写入）",
    unit: "ms/次",
    prepare: (scenario) => {
      const empty: MorphoWorkspace = {
        ...scenario.workspace,
        projectMemory: createEmptyProjectMemoryState(FIXED_NOW)
      };
      return {
        run: () => reconcileProjectMemory(empty, FIXED_NOW),
        verify: (output) =>
          (output as MorphoWorkspace).projectMemory !== empty.projectMemory
      };
    }
  },
  {
    key: "serialize",
    label: "serializeWorkspace（整个工作区 JSON.stringify）",
    unit: "ms/次",
    prepare: (scenario) => ({
      run: () => serializeWorkspace(scenario.workspace),
      verify: (output) => typeof output === "string" && output.length > 1000
    })
  },
  {
    key: "parse",
    label: "parseWorkspace（加载时解析与迁移）",
    unit: "ms/次",
    prepare: (scenario) => {
      const serialized = serializeWorkspace(scenario.workspace);
      return {
        run: () => parseWorkspace(serialized),
        verify: (output) => output !== null && output !== undefined
      };
    }
  },
  {
    key: "persistWrite",
    label: "持久化写入（序列化 + 回读校验 + 目录重写）",
    unit: "ms/次",
    // Includes the read-back verification at localProjectStore.ts:346 and the catalog
    // rewrite, because those are part of every real save — not just the stringify.
    prepare: (scenario) => {
      const storage = createMemoryStorage();
      initializeLocalProjectCatalog(storage);
      return {
        run: () => persistProjectWorkspaceAndSummary(storage, scenario.workspace),
        verify: (output) => (output as { status?: string })?.status === "ok"
      };
    }
  },
  {
    key: "interruptActiveOperations",
    label: "interruptActiveOperations（重载恢复）",
    unit: "ms/次",
    prepare: (scenario) => ({
      run: () => interruptActiveOperations(scenario.workspace, "browserReload"),
      verify: (output) => output !== null && output !== undefined
    })
  },
  {
    key: "renderableInstances",
    label: "getRenderableCanvasInstances（可见实例筛选）",
    unit: "ms/次",
    prepare: (scenario) => {
      if (scenario.workspace.canvas.instances.length === 0) {
        return null;
      }
      return {
        run: () => getRenderableCanvasInstances(scenario.workspace),
        verify: (output) => Array.isArray(output)
      };
    }
  },
  {
    key: "renderConversation",
    label: "AiConversationPanel SSR 渲染（全部消息，无窗口化）",
    unit: "ms/次",
    // AiConversationPanel.tsx:524 maps every message with no windowing, and the
    // component is not memoized, so this curve is what decides whether 4C needs
    // virtualization or just a memo.
    prepare: (scenario) => {
      if (scenario.workspace.ai.messages.length === 0) {
        return null;
      }
      const props = buildAiConversationPanelProps({ workspace: scenario.workspace });
      return {
        run: () => renderToStaticMarkup(createElement(AiConversationPanel, props)),
        verify: (output) => typeof output === "string" && output.length > 0
      };
    }
  },
  {
    key: "renderTrace",
    label: "AgentProcessDisclosure SSR 渲染（全部 trace part）",
    unit: "ms/次",
    prepare: (scenario) => {
      const trace = collectTrace(scenario.workspace);
      if (!trace) {
        return null;
      }
      return {
        run: () => renderToStaticMarkup(createElement(AgentProcessDisclosure, { trace })),
        verify: (output) => typeof output === "string" && output.length > 0
      };
    }
  }
];

/**
 * The fixed reference workload run alongside the targets.
 *
 * Absolute milliseconds do not survive a machine change; the ratio of a target to this
 * does. Deterministic by construction: the case study serializes to exactly 875,346
 * UTF-16 characters, pinned by `storageFootprintScenarios.test.ts`.
 */
export function createCalibrationBenchmark(caseStudy: MorphoWorkspace): PreparedBenchmark {
  return {
    run: () => JSON.stringify(caseStudy),
    verify: (output) => typeof output === "string" && output.length > 500_000
  };
}
