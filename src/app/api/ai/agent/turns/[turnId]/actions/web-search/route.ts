import { NextResponse } from "next/server";

import {
  acquireAgentTurnExternalAction,
  hashAgentTurnExternalActionContract,
  settleAgentTurnExternalAction,
  type AcquireAgentTurnExternalActionResult,
  type SettleAgentTurnExternalActionResult
} from "@/server/ai/agentTurnExternalActionJournal";
import { loadOpenAiCompatibleConfig } from "@/server/ai/openaiCompatibleConfig";
import { searchWebEvidence } from "@/server/ai/webSearch";
import { hashAPlusExternalToolActionClaim } from "@/server/ai/agentTurnProviderRequest";
import {
  invalidRequestResponse,
  isBoundedIdentifier,
  isRecord,
  isUuid,
  journalDeniedResponse,
  readBoundedJsonBody,
  unknownKeys
} from "@/server/ai/agentTurnRouteSupport";
import { requireAiRouteUser, type AiRouteUserAccessResult } from "@/server/auth/aiAccess";

export const runtime = "nodejs";
const MAX_WEB_SEARCH_ACTION_BODY_BYTES = 16 * 1024;

type RouteContext = { params: Promise<{ turnId: string }> };
type SearchResult = Awaited<ReturnType<typeof searchWebEvidence>>;

export type AgentTurnWebSearchActionDependencies = Readonly<{
  authenticate: () => Promise<AiRouteUserAccessResult>;
  acquire: typeof acquireAgentTurnExternalAction;
  settle: typeof settleAgentTurnExternalAction;
  search: typeof searchWebEvidence;
  waitForSettlementRetry?: (delayMs: number) => Promise<void>;
  webSearchEnabled: () => boolean;
}>;

const defaultDependencies: AgentTurnWebSearchActionDependencies = {
  authenticate: requireAiRouteUser,
  acquire: acquireAgentTurnExternalAction,
  settle: settleAgentTurnExternalAction,
  search: searchWebEvidence,
  webSearchEnabled: () => {
    const configured = loadOpenAiCompatibleConfig(process.env);
    return configured.status === "ok" && configured.config.webSearchEnabled;
  }
};

export function createAgentTurnWebSearchActionPostHandler(
  dependencies: AgentTurnWebSearchActionDependencies = defaultDependencies
) {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    const { turnId } = await context.params;
    if (!isUuid(turnId)) return invalidRequestResponse("serverTurnId 格式无效。");
    const auth = await dependencies.authenticate();
    if (auth.status === "denied") {
      return NextResponse.json(
        {
          error: auth.error,
          code: auth.httpStatus === 401 ? "unauthenticated" : "auth_unavailable",
          recoverable: false
        },
        { status: auth.httpStatus }
      );
    }
    if (!dependencies.webSearchEnabled()) {
      return NextResponse.json(
        { error: "网页搜索已关闭。", code: "web_search_disabled", recoverable: false },
        { status: 403 }
      );
    }
    const parsed = await readBoundedJsonBody(request, MAX_WEB_SEARCH_ACTION_BODY_BYTES);
    if (parsed.status === "failed") return parsed.response;
    if (!isRecord(parsed.value)) return invalidRequestResponse("Search Action 必须是对象。");
    const unknown = unknownKeys(parsed.value, [
      "localProjectId", "requestId", "stepSequence", "actionId", "queries", "maxSources"
    ]);
    if (unknown.length > 0) {
      return invalidRequestResponse(`请求包含不允许的字段：${unknown.join("、")}。`);
    }
    if (
      !isBoundedIdentifier(parsed.value.localProjectId) ||
      !isBoundedIdentifier(parsed.value.requestId) ||
      !isBoundedIdentifier(parsed.value.actionId) ||
      !Number.isSafeInteger(parsed.value.stepSequence) ||
      (parsed.value.stepSequence as number) < 1 ||
      (parsed.value.stepSequence as number) > 10_000 ||
      !Array.isArray(parsed.value.queries)
    ) return invalidRequestResponse("Search Action 身份或 queries 无效。");
    const queries = parsed.value.queries.map((query) =>
      typeof query === "string" ? query.trim() : ""
    );
    if (
      queries.length < 1 || queries.length > 3 ||
      queries.some((query) => query.length < 1 || query.length > 300) ||
      new Set(queries).size !== queries.length
    ) return invalidRequestResponse("Search queries 必须是 1 至 3 个去重的受限字符串。");
    const maxSources = Number.isSafeInteger(parsed.value.maxSources)
      ? Math.min(5, Math.max(1, parsed.value.maxSources as number))
      : 5;
    const identity = {
      serverTurnId: turnId,
      localProjectId: parsed.value.localProjectId,
      requestId: parsed.value.requestId,
      stepSequence: parsed.value.stepSequence as number,
      actionId: parsed.value.actionId,
      actionKind: "webSearch" as const
    };
    const actionHash = hashAgentTurnExternalActionContract({
      version: 1,
      kind: "webSearch",
      queries,
      maxSources
    });
    const acquired: AcquireAgentTurnExternalActionResult = await dependencies.acquire({
      ...identity,
      actionHash,
      claimCallId: identity.actionId,
      claimHash: hashAPlusExternalToolActionClaim({
        actionKind: "webSearch",
        toolCallId: identity.actionId,
        queries
      })
    });
    if (acquired.status === "denied") return journalDeniedResponse(acquired);
    if (!acquired.executionGranted) return replayResponse(acquired);

    try {
      const result = await dependencies.search({ queries, maxSources, signal: request.signal });
      const receipt = buildSearchReceipt(result);
      const settled = await settleWithRetry(dependencies, {
        ...identity,
        actionHash,
        status: "externallyCompleted",
        resultReceipt: receipt
      });
      if (settled.status === "denied") return journalDeniedResponse(settled);
      return NextResponse.json({ ...receipt, replayed: false, action: settled.snapshot });
    } catch (error) {
      const cancelled = request.signal.aborted || (error instanceof Error && error.name === "AbortError");
      const settled = await settleWithRetry(dependencies, {
        ...identity,
        actionHash,
        status: cancelled ? "externallyCancelled" : "externallyFailed",
        ...(cancelled ? {} : { failureCode: "web_search_failed" })
      });
      if (settled.status === "denied") return journalDeniedResponse(settled);
      return NextResponse.json(
        {
          error: cancelled ? "检索已取消。" : "外部检索失败，请稍后重试。",
          code: cancelled ? "web_search_cancelled" : "web_search_failed",
          recoverable: false,
          action: settled.snapshot
        },
        { status: cancelled ? 499 : 502 }
      );
    }
  };
}

export const POST = createAgentTurnWebSearchActionPostHandler();

function replayResponse(
  acquired: Extract<AcquireAgentTurnExternalActionResult, { status: "ok" }>
): Response {
  const snapshot = acquired.snapshot;
  if (snapshot.status === "running") {
    return NextResponse.json({ replayed: true, action: snapshot }, { status: 202 });
  }
  if (snapshot.status === "externallyCompleted" && isSearchReceipt(snapshot.resultReceipt)) {
    return NextResponse.json({ ...snapshot.resultReceipt, replayed: true, action: snapshot });
  }
  return NextResponse.json(
    {
      error: snapshot.status === "externallyCompleted"
        ? "Search 已完成，但受限结果 Receipt 已不可用。"
        : "Search Action 已终止。",
      code: snapshot.status === "externallyCompleted"
        ? "external_action_result_unavailable"
        : snapshot.failureCode ?? "external_action_terminal",
      recoverable: false,
      action: snapshot
    },
    { status: 409 }
  );
}

function buildSearchReceipt(result: SearchResult): SearchResult {
  return {
    sources: result.sources.slice(0, 5).map((source) => ({
      title: source.title.slice(0, 300),
      url: source.url.slice(0, 2_048),
      ...(source.domain ? { domain: source.domain.slice(0, 253) } : {}),
      ...(source.snippet ? { snippet: source.snippet.slice(0, 1_000) } : {}),
      ...(source.excerpt ? { excerpt: source.excerpt.slice(0, 1_200) } : {})
    })),
    failedSourceCount: Math.max(0, result.failedSourceCount ?? 0),
    timedOutSourceCount: Math.max(0, result.timedOutSourceCount ?? 0)
  };
}

function isSearchReceipt(value: unknown): value is SearchResult {
  return isRecord(value) && Array.isArray(value.sources) && value.sources.length <= 5 &&
    value.sources.every((source) => isRecord(source) &&
      typeof source.title === "string" && typeof source.url === "string") &&
    typeof value.failedSourceCount === "number" && typeof value.timedOutSourceCount === "number";
}

async function settleWithRetry(
  dependencies: AgentTurnWebSearchActionDependencies,
  input: Parameters<typeof settleAgentTurnExternalAction>[0]
): Promise<SettleAgentTurnExternalActionResult> {
  const delays = [25, 75] as const;
  for (let attempt = 0; ; attempt += 1) {
    let result: SettleAgentTurnExternalActionResult;
    try {
      result = await dependencies.settle(input);
    } catch {
      result = {
        status: "denied",
        httpStatus: 503,
        code: "external_action_unavailable",
        error: "External Action 结算暂时不可用。",
        recoverable: false
      };
    }
    if (result.status === "ok" || result.httpStatus !== 503 || attempt >= delays.length) return result;
    await (dependencies.waitForSettlementRetry ?? wait)(delays[attempt]!);
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
