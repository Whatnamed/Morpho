import type {
  APlusAgentProviderRequest,
  AgentTurnJournalSnapshot,
  AgentTurnRequestStreamEvent
} from "@/shared/agentTurnJournalProtocol";
import {
  createAgentTurnLifecycleState,
  reduceAgentTurnLifecycle,
  type AgentTurnError,
  type AgentTurnEvent,
  type AgentTurnLifecycleState,
  type AgentTurnTransitionResult
} from "./agentTurnLifecycle";

export type AgentTurnCoordinatorHost = Readonly<{
  createServerTurn(input: {
    localProjectId: string;
    creationIdempotencyKey: string;
  }): Promise<{
    snapshot: AgentTurnJournalSnapshot;
    replayed: boolean;
  }>;
  executeExternalRequest(
    input: {
      serverTurnId: string;
      localProjectId: string;
      requestId: string;
      stepSequence: number;
      providerRequest: APlusAgentProviderRequest;
    },
    observer: (event: AgentTurnRequestStreamEvent) => void
  ): Promise<AgentTurnCoordinatorExecutionHandshake>;
  queryServerTurn(input: {
    serverTurnId: string;
    localProjectId: string;
  }): Promise<AgentTurnJournalSnapshot>;
}>;

export type AgentTurnCoordinatorExecutionHandshake =
  | Readonly<{
      status: "started";
      complete: () => Promise<AgentTurnCoordinatorTransportResult>;
    }>
  | Readonly<{ status: "replayed" }>
  | Readonly<{
      status: "denied";
      code: string;
      error: string;
      recoverable: boolean;
    }>;

export type AgentTurnCoordinatorTransportResult =
  | Readonly<{ status: "ended"; finalFrameReceived: boolean }>
  | Readonly<{ status: "interrupted"; code: string }>;

export type AgentTurnCoordinatorActionResult =
  | Readonly<{
      status: "ok";
      lifecycle: AgentTurnLifecycleState;
      requestId?: string;
      stepSequence?: number;
    }>
  | Readonly<{
      status: "denied";
      code: string;
      error: string;
      recoverable: boolean;
      lifecycle?: AgentTurnLifecycleState;
    }>;

type ActiveRequest = {
  requestId: string;
  stepSequence: number;
  providerRequest: APlusAgentProviderRequest;
  lifecycleStarted: boolean;
  retryAllowed: boolean;
};

type Reducer = (
  state: AgentTurnLifecycleState,
  event: AgentTurnEvent
) => AgentTurnTransitionResult;

export class AgentTurnCoordinator {
  private lifecycle: AgentTurnLifecycleState | undefined;
  private serverSnapshot: AgentTurnJournalSnapshot | undefined;
  private activeRequest: ActiveRequest | undefined;
  private lastRequest: Pick<ActiveRequest, "requestId" | "stepSequence"> | undefined;
  private executionInFlight = false;
  private syncGeneration = 0;

  constructor(
    private readonly input: Readonly<{
      localProjectId: string;
      creationIdempotencyKey: string;
      host: AgentTurnCoordinatorHost;
      createRequestId: () => string;
      reducer?: Reducer;
      onDisplayEvent?: (event: AgentTurnRequestStreamEvent) => void;
    }>
  ) {}

  async initialize(): Promise<AgentTurnCoordinatorActionResult> {
    if (this.lifecycle) {
      return this.denied("already_initialized", "Coordinator 已经绑定 Server Turn。");
    }
    const created = await this.input.host.createServerTurn({
      localProjectId: this.input.localProjectId,
      creationIdempotencyKey: this.input.creationIdempotencyKey
    });
    if (
      created.snapshot.localProjectId !== this.input.localProjectId ||
      created.snapshot.status !== "created" ||
      created.snapshot.latestStepSequence !== 0 ||
      created.snapshot.latestRequestId !== null
    ) {
      return this.denied(
        "server_turn_binding_mismatch",
        "Server Turn 创建结果与本地 Project 或初始状态不匹配。"
      );
    }
    this.serverSnapshot = cloneSnapshot(created.snapshot);
    this.lifecycle = createAgentTurnLifecycleState(created.snapshot.serverTurnId);
    const prepared = this.dispatch({
      type: "PREPARATION_COMPLETED",
      turnId: created.snapshot.serverTurnId
    });
    return prepared.status === "denied" ? prepared : this.ok();
  }

  startInitialRequest(
    providerRequest: APlusAgentProviderRequest
  ): Promise<AgentTurnCoordinatorActionResult> {
    return this.startNewRequest(providerRequest, "initial");
  }

  startContinuation(
    providerRequest: APlusAgentProviderRequest
  ): Promise<AgentTurnCoordinatorActionResult> {
    return this.startNewRequest(providerRequest, "continuation");
  }

  async retryActiveRequest(): Promise<AgentTurnCoordinatorActionResult> {
    if (!this.lifecycle || !this.activeRequest) {
      return this.denied("no_active_request", "当前没有可重试的 A+ Request。");
    }
    if (this.executionInFlight || !this.activeRequest.retryAllowed) {
      return this.denied("request_in_flight", "当前 Request 尚未进入可重试状态。");
    }
    if (this.lifecycle.phase === "recovering") {
      const resolved = this.dispatch({
        type: "RECOVERY_RESOLVED",
        turnId: this.lifecycle.turnId,
        faultId: this.lifecycle.faultId
      });
      if (resolved.status === "denied") return resolved;
    }
    return this.executeActiveRequest(true);
  }

  async recoverServerExecutionStatus(): Promise<AgentTurnCoordinatorActionResult> {
    if (!this.lifecycle) {
      return this.denied("not_initialized", "Coordinator 尚未创建 Server Turn。");
    }
    const expected = this.activeRequest ?? this.lastRequest;
    if (!expected) {
      return this.denied("no_request_to_recover", "当前 Server Turn 尚无可恢复 Request。");
    }
    return this.recover(expected, this.syncGeneration);
  }

  getLifecycleSnapshot(): AgentTurnLifecycleState | undefined {
    return this.lifecycle ? immutableClone(this.lifecycle) : undefined;
  }

  getServerSnapshot(): AgentTurnJournalSnapshot | undefined {
    return this.serverSnapshot ? immutableClone(this.serverSnapshot) : undefined;
  }

  private async startNewRequest(
    providerRequest: APlusAgentProviderRequest,
    kind: "initial" | "continuation"
  ): Promise<AgentTurnCoordinatorActionResult> {
    if (!this.lifecycle) {
      return this.denied("not_initialized", "Coordinator 尚未创建 Server Turn。");
    }
    if (this.executionInFlight || this.activeRequest) {
      return this.denied("request_in_flight", "同一 Turn 同一时间只能有一个活动 Request。");
    }
    if (kind === "initial" && this.lifecycle.serverExecutionStatus !== "created") {
      return this.denied("initial_request_already_started", "首次 A+ Request 已经开始。");
    }
    if (kind === "continuation" && this.lifecycle.serverExecutionStatus !== "awaitingNextRequest") {
      return this.denied("continuation_not_allowed", "Server Turn 尚未等待下一次 Request。");
    }
    const requestId = this.input.createRequestId();
    if (!requestId.trim()) {
      return this.denied("invalid_request_id", "Request ID 生成器返回了空标识。");
    }
    const stepSequence = (this.lastRequest?.stepSequence ?? 0) + 1;
    this.syncGeneration += 1;
    this.activeRequest = {
      requestId,
      stepSequence,
      providerRequest: copyProviderRequest(providerRequest),
      lifecycleStarted: false,
      retryAllowed: false
    };
    return this.executeActiveRequest(false);
  }

  private async executeActiveRequest(retry: boolean): Promise<AgentTurnCoordinatorActionResult> {
    const active = this.activeRequest;
    const lifecycle = this.lifecycle;
    if (!active || !lifecycle) {
      return this.denied("no_active_request", "活动 Request 已不存在。");
    }
    this.executionInFlight = true;
    active.retryAllowed = false;
    const generation = this.syncGeneration;
    try {
      const handshake = await this.input.host.executeExternalRequest(
        {
          serverTurnId: lifecycle.turnId,
          localProjectId: this.input.localProjectId,
          requestId: active.requestId,
          stepSequence: active.stepSequence,
          providerRequest: copyProviderRequest(active.providerRequest)
        },
        (event) => {
          this.observeStreamEvent(event);
        }
      );
      if (generation !== this.syncGeneration || this.activeRequest !== active) {
        return this.denied("stale_request_result", "旧 Request 的握手结果已被拒绝。");
      }
      if (handshake.status === "denied") {
        const classified = classifyHandshakeFailure(handshake);
        const recorded = this.recordHandshakeFailure(active, handshake, classified);
        if (recorded.status === "denied") return recorded;
        if (classified.kind === "retryable") {
          const recovery = this.dispatch({
            type: "RECOVERY_STARTED",
            turnId: lifecycle.turnId,
            faultId: `${active.requestId}:${handshake.code}`
          });
          if (recovery.status === "denied") return recovery;
          active.retryAllowed = true;
          return this.denied(handshake.code, handshake.error, true);
        }
        if (!retry && !active.lifecycleStarted && recorded.status === "ok") {
          const finalized = this.dispatch({ type: "TURN_FINALIZED", turnId: lifecycle.turnId });
          this.activeRequest = undefined;
          return finalized.status === "denied"
            ? finalized
            : this.denied(handshake.code, handshake.error);
        }
        active.retryAllowed = false;
        return this.denied(handshake.code, handshake.error);
      }
      if (!active.lifecycleStarted) {
        const started = this.dispatch({
          type: "PROVIDER_REQUEST_STARTED",
          turnId: lifecycle.turnId,
          requestId: active.requestId,
          stepSequence: active.stepSequence
        });
        if (started.status === "denied") return started;
        active.lifecycleStarted = true;
      }
      if (handshake.status === "replayed") {
        active.retryAllowed = true;
        return this.recover(active, generation);
      }
      const completion = await handshake.complete();
      if (generation !== this.syncGeneration) {
        return this.denied("stale_request_result", "旧 Request 的传输结果已被拒绝。");
      }
      if (completion.status === "interrupted" || !completion.finalFrameReceived) {
        active.retryAllowed = true;
        return this.recover(active, generation);
      }
      if (this.activeRequest === active && this.lifecycle?.serverExecutionStatus === "providerRunning") {
        active.retryAllowed = true;
        return this.recover(active, generation);
      }
      return this.ok(active);
    } catch {
      if (this.activeRequest === active) active.retryAllowed = true;
      return this.recover(active, generation);
    } finally {
      this.executionInFlight = false;
    }
  }

  private observeStreamEvent(event: AgentTurnRequestStreamEvent): AgentTurnCoordinatorActionResult {
    const lifecycle = this.lifecycle;
    if (!lifecycle) return this.denied("not_initialized", "Coordinator 尚未创建 Server Turn。");
    if (event.requestId !== this.activeRequest?.requestId || event.stepSequence !== this.activeRequest.stepSequence) {
      return this.denied("stale_request_event", "旧 Request SSE 事件已被拒绝。");
    }
    let result: AgentTurnCoordinatorActionResult;
    switch (event.type) {
      case "streamActivity":
        result = this.dispatch({
          type: "STREAM_ACTIVITY_OBSERVED",
          turnId: lifecycle.turnId,
          requestId: event.requestId,
          stepSequence: event.stepSequence,
          sequence: event.sequence
        });
        break;
      case "providerOutput":
        result = this.dispatch({
          type: "PROVIDER_OUTPUT_RECEIVED",
          turnId: lifecycle.turnId,
          requestId: event.requestId,
          stepSequence: event.stepSequence,
          producedUserVisibleEffect: event.producedUserVisibleEffect
        });
        break;
      case "externalError":
        if (event.code === "provider_cancelled") {
          result = this.dispatch({
            type: "CANCELLATION_REQUESTED",
            turnId: lifecycle.turnId,
            reason: "providerCancelled"
          });
        } else {
          result = this.dispatch({
            type: "EXTERNAL_ERROR_RECORDED",
            turnId: lifecycle.turnId,
            requestId: event.requestId,
            stepSequence: event.stepSequence,
            faultId: `${event.requestId}:${event.code}`,
            error: {
              kind: "terminal",
              code: event.code,
              message: "Server external execution failed.",
              recoverable: false
            }
          });
        }
        break;
      case "serverStatus":
        result = this.observeServerStatus(event.requestId, event.stepSequence, event.status);
        break;
      default:
        return assertNever(event);
    }
    if (result.status === "ok") this.forwardDisplayEvent(event);
    return result;
  }

  private async recover(
    expected: Pick<ActiveRequest, "requestId" | "stepSequence">,
    generation: number
  ): Promise<AgentTurnCoordinatorActionResult> {
    const lifecycle = this.lifecycle;
    if (!lifecycle) return this.denied("not_initialized", "Coordinator 尚未创建 Server Turn。");
    let snapshot: AgentTurnJournalSnapshot;
    try {
      snapshot = await this.input.host.queryServerTurn({
        serverTurnId: lifecycle.turnId,
        localProjectId: this.input.localProjectId
      });
    } catch {
      return this.denied("journal_query_failed", "Server Turn Journal 查询失败。");
    }
    if (generation !== this.syncGeneration) {
      return this.denied("stale_query_result", "旧 Request 的 Journal 查询结果已被拒绝。");
    }
    if (
      snapshot.serverTurnId !== lifecycle.turnId ||
      snapshot.localProjectId !== this.input.localProjectId
    ) {
      return this.recordCoordinatorConflict(
        "server_turn_binding_mismatch",
        "Journal 返回了不匹配的 User/Project Turn 绑定。"
      );
    }
    if (
      this.activeRequest &&
      !this.activeRequest.lifecycleStarted &&
      snapshot.status === "created" &&
      snapshot.latestRequestId === null &&
      snapshot.latestStepSequence === 0
    ) {
      this.activeRequest.retryAllowed = true;
      return this.denied(
        "request_not_observed",
        "Journal 尚未观察到该 Request；重试必须复用原 Request ID、Sequence 和内容。"
      );
    }
    if (
      snapshot.latestRequestId !== expected.requestId ||
      snapshot.latestStepSequence !== expected.stepSequence
    ) {
      return this.recordCoordinatorConflict(
        "journal_request_mismatch",
        "Journal 返回了不匹配的 Request ID 或 Sequence。"
      );
    }
    if (this.activeRequest && !this.activeRequest.lifecycleStarted) {
      const started = this.dispatch({
        type: "PROVIDER_REQUEST_STARTED",
        turnId: lifecycle.turnId,
        requestId: expected.requestId,
        stepSequence: expected.stepSequence
      });
      if (started.status === "denied") return started;
      this.activeRequest.lifecycleStarted = true;
    }
    this.serverSnapshot = cloneSnapshot(snapshot);
    if (
      snapshot.status === "awaitingNextRequest" &&
      this.lifecycle?.providerOutput.kind === "none"
    ) {
      const unavailable = this.dispatch({
        type: "PROVIDER_OUTPUT_UNAVAILABLE",
        turnId: lifecycle.turnId,
        requestId: expected.requestId,
        stepSequence: expected.stepSequence
      });
      if (unavailable.status === "denied") return unavailable;
      this.settleLocalRequest(expected.requestId, expected.stepSequence);
      return this.ok(this.lastRequest);
    }
    const observed = this.observeServerStatus(
      expected.requestId,
      expected.stepSequence,
      snapshot.status
    );
    if (observed.status === "denied") return observed;
    if (snapshot.status === "providerRunning" && this.activeRequest) {
      this.activeRequest.retryAllowed = true;
    }
    return this.ok(this.activeRequest ?? expected);
  }

  private observeServerStatus(
    requestId: string,
    stepSequence: number,
    status: AgentTurnJournalSnapshot["status"]
  ): AgentTurnCoordinatorActionResult {
    const lifecycle = this.lifecycle;
    if (!lifecycle) return this.denied("not_initialized", "Coordinator 尚未创建 Server Turn。");
    if (status === "created") {
      return this.denied("invalid_server_status", "活动 Request 不能恢复为 created。");
    }
    const observed = this.dispatch({
      type: "SERVER_EXECUTION_STATUS_OBSERVED",
      turnId: lifecycle.turnId,
      requestId,
      stepSequence,
      status
    });
    if (observed.status === "denied") return observed;
    if (status === "awaitingNextRequest") {
      this.settleLocalRequest(requestId, stepSequence);
      return this.ok(this.lastRequest);
    }
    if (
      status === "externallyCompleted" ||
      status === "externallyCancelled" ||
      status === "externallyFailed"
    ) {
      const finalized = this.dispatch({ type: "TURN_FINALIZED", turnId: lifecycle.turnId });
      if (finalized.status === "denied") return finalized;
      this.settleLocalRequest(requestId, stepSequence);
    }
    return this.ok(this.activeRequest ?? this.lastRequest);
  }

  private settleLocalRequest(requestId: string, stepSequence: number): void {
    this.lastRequest = { requestId, stepSequence };
    if (
      this.activeRequest?.requestId === requestId &&
      this.activeRequest.stepSequence === stepSequence
    ) {
      this.activeRequest = undefined;
    }
  }

  private recordHandshakeFailure(
    active: ActiveRequest,
    failure: Extract<AgentTurnCoordinatorExecutionHandshake, { status: "denied" }>,
    error: Exclude<AgentTurnError, { kind: "cancelled" }>
  ): AgentTurnCoordinatorActionResult {
    const lifecycle = this.lifecycle!;
    const event: AgentTurnEvent = active.lifecycleStarted
      ? {
          type: "EXTERNAL_ERROR_RECORDED",
          turnId: lifecycle.turnId,
          requestId: active.requestId,
          stepSequence: active.stepSequence,
          faultId: `${active.requestId}:${failure.code}`,
          error
        }
      : {
          type: "ERROR_RECORDED",
          turnId: lifecycle.turnId,
          faultId: `${active.requestId}:${failure.code}`,
          error
        };
    return this.dispatch(event);
  }

  private forwardDisplayEvent(event: AgentTurnRequestStreamEvent): void {
    if (!this.input.onDisplayEvent) return;
    try {
      this.input.onDisplayEvent(immutableClone(event));
    } catch {
      // Display consumers are observational and cannot affect lifecycle authority.
    }
  }

  private recordCoordinatorConflict(code: string, error: string): AgentTurnCoordinatorActionResult {
    if (!this.lifecycle) return this.denied(code, error);
    const recorded = this.dispatch({
      type: "ERROR_RECORDED",
      turnId: this.lifecycle.turnId,
      faultId: `coordinator:${code}`,
      error: { kind: "conflict", code, message: error, recoverable: false }
    });
    return recorded.status === "denied" ? recorded : this.denied(code, error);
  }

  private dispatch(event: AgentTurnEvent): AgentTurnCoordinatorActionResult {
    if (!this.lifecycle) return this.denied("not_initialized", "Coordinator 尚未创建 Server Turn。");
    const reduced = (this.input.reducer ?? reduceAgentTurnLifecycle)(this.lifecycle, event);
    if (!reduced.ok) {
      return this.denied(reduced.error.code, reduced.error.message);
    }
    this.lifecycle = reduced.state;
    return this.ok();
  }

  private ok(
    request?: Pick<ActiveRequest, "requestId" | "stepSequence">
  ): AgentTurnCoordinatorActionResult {
    if (!this.lifecycle) {
      return this.denied("not_initialized", "Coordinator 尚未创建 Server Turn。");
    }
    return {
      status: "ok",
      lifecycle: immutableClone(this.lifecycle),
      ...(request
        ? { requestId: request.requestId, stepSequence: request.stepSequence }
        : {})
    };
  }

  private denied(
    code: string,
    error: string,
    recoverable = false
  ): AgentTurnCoordinatorActionResult {
    return {
      status: "denied",
      code,
      error,
      recoverable,
      ...(this.lifecycle ? { lifecycle: immutableClone(this.lifecycle) } : {})
    };
  }
}

function classifyHandshakeFailure(
  failure: Extract<AgentTurnCoordinatorExecutionHandshake, { status: "denied" }>
): Exclude<AgentTurnError, { kind: "cancelled" }> {
  const base = { code: failure.code, message: failure.error };
  if (failure.code === "quota_exceeded" || failure.code === "provider_limit") {
    return { kind: "quotaExceeded", ...base, recoverable: false };
  }
  if (
    failure.recoverable ||
    failure.code === "journal_unavailable" ||
    failure.code === "supabase_unavailable" ||
    failure.code === "auth_unavailable"
  ) {
    return { kind: "retryable", ...base, recoverable: true };
  }
  if (
    failure.code === "not_found" ||
    failure.code === "creation_key_conflict" ||
    failure.code === "request_id_conflict" ||
    failure.code === "sequence_conflict" ||
    failure.code === "sequence_replay" ||
    failure.code === "sequence_skip" ||
    failure.code === "terminal_turn" ||
    failure.code === "status_conflict" ||
    failure.code === "request_not_latest"
  ) {
    return { kind: "conflict", ...base, recoverable: false };
  }
  return { kind: "terminal", ...base, recoverable: false };
}

function copyProviderRequest(request: APlusAgentProviderRequest): APlusAgentProviderRequest {
  return {
    input: request.input.map((message) => ({
      role: message.role,
      content: message.content.map((part) => ({ ...part }))
    })),
    promptContractVersion: request.promptContractVersion,
    mode: request.mode,
    capabilityIntent: {
      comparisonAnalysis: request.capabilityIntent.comparisonAnalysis
    },
    ...(request.previousRuntimeItem
      ? {
          previousRuntimeItem: {
            id: request.previousRuntimeItem.id,
            contentHash: request.previousRuntimeItem.contentHash,
            effectiveToolProfile: request.previousRuntimeItem.effectiveToolProfile,
            mode: request.previousRuntimeItem.mode,
            promptContractVersion: request.previousRuntimeItem.promptContractVersion,
            placement: request.previousRuntimeItem.placement,
            sequence: request.previousRuntimeItem.sequence,
            renderedText: request.previousRuntimeItem.renderedText,
            ...(request.previousRuntimeItem.predecessorItemId
              ? { predecessorItemId: request.previousRuntimeItem.predecessorItemId }
              : {})
          }
        }
      : {})
  };
}

function cloneSnapshot(snapshot: AgentTurnJournalSnapshot): AgentTurnJournalSnapshot {
  return structuredClone(snapshot);
}

function immutableClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach((item) => deepFreeze(item));
    Object.freeze(value);
  }
  return value;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Coordinator event: ${JSON.stringify(value)}`);
}
