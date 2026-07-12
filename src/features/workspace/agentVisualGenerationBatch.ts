import type { VisualGenerationPlan } from "@/domain/operations/types";

export type ExpectedVisualGenerationCount = {
  totalItems: number;
  requestedPreviewCount?: 1 | 2 | 4 | 6;
  source: "explicitTotal" | "explicitPerDirection" | "default";
};

export type AgentVisualGenerationCall = {
  callId: string;
  plan: VisualGenerationPlan;
};

export type AgentVisualGenerationBatch =
  | {
      status: "ok";
      callIds: string[];
      expected: ExpectedVisualGenerationCount;
      plan: VisualGenerationPlan;
    }
  | {
      status: "blocked";
      callIds: string[];
      reason: string;
    };

const COUNT_WORDS: Record<string, number> = {
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8
};

/**
 * The requested result count is user intent, not a consequence of however the
 * model happens to split function calls. Direction previews keep their
 * per-direction contract; visual development uses a total item count.
 */
export function resolveExpectedVisualGenerationCount(input: {
  draft: string;
  kind: VisualGenerationPlan["kind"];
  selectedDirectionCount: number;
}): ExpectedVisualGenerationCount {
  const normalizedDraft = input.draft.replace(/\s+/g, "");
  const perDirectionCount = readCount(
    normalizedDraft.match(/(?:每个方向|每条方向|各方向|每一方向|每个方案)(?:生成|出|要|做)?([一二两三四五六七八\d]+)(?:张|幅|个)?(?:图|预览|方案)?/i)?.[1]
  );
  if (input.kind === "directionPreview" && perDirectionCount) {
    return {
      totalItems: perDirectionCount * Math.max(1, input.selectedDirectionCount),
      requestedPreviewCount: asPreviewCount(perDirectionCount),
      source: "explicitPerDirection"
    };
  }

  const explicitTotal = readCount(
    normalizedDraft.match(/(?:总共|一共|合计|总计)?(?:生成|出|给我|要|做)([一二两三四五六七八\d]+)(?:张|幅|个(?:方向|方案)?)(?:图|图片|预览|方案|视觉)?/i)?.[1]
      ?? normalizedDraft.match(/([一二两三四五六七八\d]+)(?:张|幅|个(?:方向|方案)?)(?:图|图片|预览|方案|视觉)/i)?.[1]
  );
  if (explicitTotal) {
    if (input.kind === "directionPreview") {
      const directionCount = Math.max(1, input.selectedDirectionCount);
      const perDirection = explicitTotal / directionCount;
      if (Number.isInteger(perDirection) && asPreviewCount(perDirection)) {
        return {
          totalItems: explicitTotal,
          requestedPreviewCount: asPreviewCount(perDirection),
          source: "explicitTotal"
        };
      }
    }
    return {
      totalItems: explicitTotal,
      source: "explicitTotal"
    };
  }

  if (input.kind === "directionPreview") {
    return {
      totalItems: Math.max(1, input.selectedDirectionCount),
      requestedPreviewCount: 1,
      source: "default"
    };
  }

  return { totalItems: 1, source: "default" };
}

export function buildAgentVisualGenerationBatch(input: {
  calls: AgentVisualGenerationCall[];
  expected: ExpectedVisualGenerationCount;
}): AgentVisualGenerationBatch {
  const callIds = input.calls.map((call) => call.callId);
  if (input.calls.length === 0) {
    return { status: "blocked", callIds, reason: "本轮没有可执行的图像生成计划。" };
  }

  const [firstCall] = input.calls;
  const kind = firstCall!.plan.kind;
  if (input.calls.some((call) => call.plan.kind !== kind)) {
    return {
      status: "blocked",
      callIds,
      reason: "同一轮图像生成不能混合方向预览与视觉继续发展；请返回一个完整且单一的生成批次。"
    };
  }

  const items = input.calls.flatMap((call) => call.plan.items);
  const itemIds = new Set<string>();
  if (items.some((item) => itemIds.has(item.id) || !itemIds.add(item.id))) {
    return {
      status: "blocked",
      callIds,
      reason: "图像生成批次包含重复计划项 ID；请返回完整且每项唯一的计划。"
    };
  }

  if (items.length !== input.expected.totalItems) {
    return {
      status: "blocked",
      callIds,
      reason: `用户本轮明确需要 ${input.expected.totalItems} 张图像，但 Agent 只返回了 ${items.length} 项。请一次返回完整 items[]，不得拆分或先执行部分计划。`
    };
  }

  return {
    status: "ok",
    callIds,
    expected: input.expected,
    plan: { kind, items }
  };
}

function readCount(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  if (/^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  return COUNT_WORDS[value];
}

function asPreviewCount(value: number): 1 | 2 | 4 | 6 | undefined {
  return value === 1 || value === 2 || value === 4 || value === 6 ? value : undefined;
}
