export type ServerExternalExecutionStatus =
  | "created"
  | "providerRunning"
  | "awaitingNextRequest"
  | "externallyCompleted"
  | "externallyCancelled"
  | "externallyFailed";

export type AgentTurnError =
  | { kind: "retryable"; code: string; message: string; recoverable: true }
  | { kind: "terminal"; code: string; message: string; recoverable: false }
  | { kind: "cancelled"; code: string; message: string; recoverable: false }
  | { kind: "conflict"; code: string; message: string; recoverable: false }
  | { kind: "quotaExceeded"; code: string; message: string; recoverable: false };

export type ToolCallTerminalResult =
  | {
      status: "executed";
      callId: string;
      localEffect: "none" | "produced";
      persistence: "notRequired" | "succeeded" | "failed";
      unresolvedWorkIds: readonly string[];
    }
  | {
      status: "failed";
      callId: string;
      error: Exclude<AgentTurnError, { kind: "cancelled" }>;
    }
  | { status: "cancelled"; callId: string; reason: string }
  | {
      status: "pendingConfirmation";
      callId: string;
      confirmationId: string;
      unresolvedWorkIds: readonly string[];
    };

export type ToolBatchOutcomeKind =
  | "completed"
  | "partiallyCompleted"
  | "pendingConfirmation"
  | "cancelled"
  | "failed";

export type ToolBatchOutcome = {
  kind: ToolBatchOutcomeKind;
  declaredCallCount: number;
  executedCount: number;
  failedCount: number;
  cancelledCount: number;
  pendingConfirmationCount: number;
  hasPersistenceFailure: boolean;
  unresolvedWorkIds: readonly string[];
};

export type ToolBatchAggregationError = {
  kind: "conflict";
  code:
    | "duplicateDeclaredCallId"
    | "duplicateTerminalResult"
    | "undeclaredCallId"
    | "missingTerminalResult";
  callId: string;
  recoverable: false;
};

export type ToolBatchAggregationResult =
  | { ok: true; outcome: ToolBatchOutcome }
  | { ok: false; error: ToolBatchAggregationError };

export type OverallLocalAgentTurnOutcomeKind =
  | "completed"
  | "partiallyCompleted"
  | "pendingConfirmation"
  | "cancelled"
  | "failed";

export type OverallLocalAgentTurnOutcome = {
  kind: OverallLocalAgentTurnOutcomeKind;
  reasons: readonly string[];
};

export type AgentTurnCompactionMode = "automatic" | "preContinuation" | "manual";

type ResumablePhase = "preparing" | "requestingProvider" | "continuing";

type FaultState =
  | { kind: "none" }
  | { kind: "present"; faultId: string; error: AgentTurnError };

type ConfirmationState =
  | { kind: "none" }
  | { kind: "pending"; callIds: readonly string[] };

type ExternalRequestState =
  | { kind: "none"; lastStepSequence: 0 }
  | { kind: "active"; requestId: string; stepSequence: number }
  | { kind: "settled"; requestId: string; stepSequence: number };

type ProviderOutputState =
  | { kind: "none" }
  | { kind: "received"; requestId: string; stepSequence: number }
  | { kind: "consumed"; requestId: string; stepSequence: number };

type FinalizedToolBatch = {
  declaredCallIds: readonly string[];
  results: readonly ToolCallTerminalResult[];
  outcome: ToolBatchOutcome;
};

type AgentTurnFacts = {
  turnId: string;
  serverExecutionStatus: ServerExternalExecutionStatus;
  externalRequest: ExternalRequestState;
  providerOutput: ProviderOutputState;
  providerEffectProduced: boolean;
  persistence: "notRequired" | "pending" | "succeeded" | "failed";
  unresolvedWorkIds: readonly string[];
  streamActivitySequence: number;
  fault: FaultState;
  confirmation: ConfirmationState;
  toolBatches: readonly FinalizedToolBatch[];
};

type ActiveToolBatch = {
  declaredCallIds: readonly string[];
  results: readonly ToolCallTerminalResult[];
};

export type AgentTurnLifecycleState =
  | (AgentTurnFacts & { phase: "preparing" })
  | (AgentTurnFacts & {
      phase: "compacting";
      mode: AgentTurnCompactionMode;
      resumePhase: ResumablePhase;
    })
  | (AgentTurnFacts & { phase: "requestingProvider" })
  | (AgentTurnFacts & { phase: "executingTools"; activeToolBatch: ActiveToolBatch })
  | (AgentTurnFacts & { phase: "awaitingConfirmation"; callIds: readonly string[] })
  | (AgentTurnFacts & { phase: "continuing" })
  | (AgentTurnFacts & { phase: "cancelling"; reason: string })
  | (AgentTurnFacts & {
      phase: "recovering";
      faultId: string;
      error: Extract<AgentTurnError, { kind: "retryable" }>;
      resumePhase: ResumablePhase;
    })
  | (AgentTurnFacts & { phase: "terminal"; outcome: OverallLocalAgentTurnOutcome });

export type AgentTurnEvent =
  | { type: "PREPARATION_COMPLETED"; turnId: string }
  | { type: "COMPACTION_STARTED"; turnId: string; mode: AgentTurnCompactionMode }
  | { type: "COMPACTION_COMPLETED"; turnId: string }
  | { type: "COMPACTION_FAILED"; turnId: string; faultId: string; error: AgentTurnError }
  | { type: "COMPACTION_CANCELLED"; turnId: string; reason: string }
  | { type: "PROVIDER_REQUEST_STARTED"; turnId: string; requestId: string; stepSequence: number }
  | {
      type: "SERVER_EXECUTION_STATUS_OBSERVED";
      turnId: string;
      requestId: string;
      stepSequence: number;
      status: ServerExternalExecutionStatus;
    }
  | {
      type: "STREAM_ACTIVITY_OBSERVED";
      turnId: string;
      requestId: string;
      stepSequence: number;
      sequence: number;
    }
  | {
      type: "PROVIDER_OUTPUT_RECEIVED";
      turnId: string;
      requestId: string;
      stepSequence: number;
      producedUserVisibleEffect: boolean;
    }
  | {
      type: "EXTERNAL_ERROR_RECORDED";
      turnId: string;
      requestId: string;
      stepSequence: number;
      faultId: string;
      error: Exclude<AgentTurnError, { kind: "cancelled" }>;
    }
  | { type: "TOOL_BATCH_STARTED"; turnId: string; declaredCallIds: readonly string[] }
  | { type: "TOOL_CALL_TERMINATED"; turnId: string; result: ToolCallTerminalResult }
  | { type: "TOOL_BATCH_FINALIZED"; turnId: string }
  | { type: "LOCAL_PERSISTENCE_REQUIRED"; turnId: string }
  | { type: "LOCAL_PERSISTENCE_SUCCEEDED"; turnId: string }
  | {
      type: "LOCAL_PERSISTENCE_FAILED";
      turnId: string;
      faultId: string;
      error: Exclude<AgentTurnError, { kind: "cancelled" }>;
    }
  | { type: "UNRESOLVED_WORK_RECORDED"; turnId: string; workId: string }
  | { type: "UNRESOLVED_WORK_RESOLVED"; turnId: string; workId: string }
  | {
      type: "ERROR_RECORDED";
      turnId: string;
      faultId: string;
      error: Exclude<AgentTurnError, { kind: "cancelled" }>;
    }
  | { type: "CANCELLATION_REQUESTED"; turnId: string; reason: string }
  | { type: "RECOVERY_STARTED"; turnId: string; faultId: string }
  | { type: "RECOVERY_RESOLVED"; turnId: string; faultId: string }
  | { type: "TURN_FINALIZED"; turnId: string };

export type AgentTurnTransitionError = {
  kind: "conflict";
  code:
    | "turnMismatch"
    | "illegalTransition"
    | "invalidEvent"
    | "externalRequestMismatch"
    | "externalStepSequenceConflict"
    | "unresolvedFaultConflict"
    | "conflictingToolResult"
    | "invalidServerStatusTransition"
    | "incompleteToolBatch"
    | "insufficientTerminalFacts";
  message: string;
  recoverable: false;
};

export type AgentTurnTransitionResult =
  | { ok: true; state: AgentTurnLifecycleState }
  | { ok: false; error: AgentTurnTransitionError };

export function createAgentTurnLifecycleState(turnId: string): AgentTurnLifecycleState {
  return {
    phase: "preparing",
    turnId,
    serverExecutionStatus: "created",
    externalRequest: { kind: "none", lastStepSequence: 0 },
    providerOutput: { kind: "none" },
    providerEffectProduced: false,
    persistence: "notRequired",
    unresolvedWorkIds: [],
    streamActivitySequence: 0,
    fault: { kind: "none" },
    confirmation: { kind: "none" },
    toolBatches: []
  };
}

export function aggregateToolBatchOutcome(
  declaredCallIds: readonly string[],
  results: readonly ToolCallTerminalResult[]
): ToolBatchAggregationResult {
  const declared = new Set<string>();
  for (const callId of declaredCallIds) {
    if (declared.has(callId)) {
      return aggregationError("duplicateDeclaredCallId", callId);
    }
    declared.add(callId);
  }

  const resultIds = new Set<string>();
  for (const result of results) {
    if (resultIds.has(result.callId)) {
      return aggregationError("duplicateTerminalResult", result.callId);
    }
    if (!declared.has(result.callId)) {
      return aggregationError("undeclaredCallId", result.callId);
    }
    resultIds.add(result.callId);
  }
  for (const callId of declaredCallIds) {
    if (!resultIds.has(callId)) {
      return aggregationError("missingTerminalResult", callId);
    }
  }

  let executedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let pendingConfirmationCount = 0;
  let hasPersistenceFailure = false;
  const unresolvedWorkIds = new Set<string>();
  for (const result of results) {
    switch (result.status) {
      case "executed":
        executedCount += 1;
        hasPersistenceFailure ||= result.persistence === "failed";
        result.unresolvedWorkIds.forEach((workId) => unresolvedWorkIds.add(workId));
        break;
      case "failed":
        failedCount += 1;
        break;
      case "cancelled":
        cancelledCount += 1;
        break;
      case "pendingConfirmation":
        pendingConfirmationCount += 1;
        result.unresolvedWorkIds.forEach((workId) => unresolvedWorkIds.add(workId));
        break;
      default:
        assertNever(result);
    }
  }

  const hasSuccessfulResult = executedCount > 0;
  const hasIncompleteResult =
    failedCount > 0 ||
    cancelledCount > 0 ||
    pendingConfirmationCount > 0 ||
    hasPersistenceFailure ||
    unresolvedWorkIds.size > 0;
  let kind: ToolBatchOutcomeKind;
  if (hasSuccessfulResult && hasIncompleteResult) {
    kind = "partiallyCompleted";
  } else if (pendingConfirmationCount > 0) {
    kind = "pendingConfirmation";
  } else if (failedCount > 0) {
    kind = "failed";
  } else if (cancelledCount > 0) {
    kind = "cancelled";
  } else {
    kind = "completed";
  }

  return {
    ok: true,
    outcome: {
      kind,
      declaredCallCount: declaredCallIds.length,
      executedCount,
      failedCount,
      cancelledCount,
      pendingConfirmationCount,
      hasPersistenceFailure,
      unresolvedWorkIds: [...unresolvedWorkIds]
    }
  };
}

export function reduceAgentTurnLifecycle(
  state: AgentTurnLifecycleState,
  event: AgentTurnEvent
): AgentTurnTransitionResult {
  if (event.turnId !== state.turnId) {
    return transitionError("turnMismatch", `Event for ${event.turnId} cannot update ${state.turnId}.`);
  }
  if (state.phase === "terminal") {
    return illegal(state, event);
  }

  switch (event.type) {
    case "PREPARATION_COMPLETED":
      return state.phase === "preparing" ? success({ ...state, phase: "requestingProvider" }) : illegal(state, event);
    case "COMPACTION_STARTED":
      return startCompaction(state, event.mode, event);
    case "COMPACTION_COMPLETED":
      return state.phase === "compacting"
        ? success({ ...state, phase: state.resumePhase })
        : illegal(state, event);
    case "COMPACTION_FAILED":
      return failCompaction(state, event.faultId, event.error, event);
    case "COMPACTION_CANCELLED":
      return state.phase === "compacting"
        ? terminal(state, { kind: "cancelled", reasons: [event.reason] })
        : illegal(state, event);
    case "PROVIDER_REQUEST_STARTED":
      return startProviderRequest(state, event.requestId, event.stepSequence, event);
    case "SERVER_EXECUTION_STATUS_OBSERVED":
      return observeServerStatus(state, event.requestId, event.stepSequence, event.status);
    case "STREAM_ACTIVITY_OBSERVED":
      if (state.phase !== "requestingProvider" && state.phase !== "continuing") {
        return illegal(state, event);
      }
      if (!matchesExternalRequest(state, event.requestId, event.stepSequence, true)) {
        return externalRequestMismatch(state, event.requestId, event.stepSequence);
      }
      return event.sequence > state.streamActivitySequence
        ? success({ ...state, streamActivitySequence: event.sequence })
        : transitionError("invalidEvent", "Stream activity sequence must increase.");
    case "PROVIDER_OUTPUT_RECEIVED":
      return state.phase === "requestingProvider" &&
        state.serverExecutionStatus === "providerRunning" &&
        matchesExternalRequest(state, event.requestId, event.stepSequence, true)
        ? success({
            ...state,
            phase: "continuing",
            providerOutput: {
              kind: "received",
              requestId: event.requestId,
              stepSequence: event.stepSequence
            },
            providerEffectProduced:
              state.providerEffectProduced || event.producedUserVisibleEffect
          })
        : state.phase === "requestingProvider" && state.serverExecutionStatus === "providerRunning"
          ? externalRequestMismatch(state, event.requestId, event.stepSequence)
          : illegal(state, event);
    case "EXTERNAL_ERROR_RECORDED":
      if (!matchesExternalRequest(state, event.requestId, event.stepSequence)) {
        return externalRequestMismatch(state, event.requestId, event.stepSequence);
      }
      if (
        state.serverExecutionStatus !== "providerRunning" &&
        state.serverExecutionStatus !== "externallyFailed"
      ) {
        return transitionError(
          "invalidServerStatusTransition",
          `External errors are not legal from ${state.serverExecutionStatus}.`
        );
      }
      return recordFault(state, event.faultId, event.error);
    case "TOOL_BATCH_STARTED":
      return startToolBatch(state, event.declaredCallIds, event);
    case "TOOL_CALL_TERMINATED":
      return recordToolResult(state, event.result, event);
    case "TOOL_BATCH_FINALIZED":
      return finalizeToolBatch(state, event);
    case "LOCAL_PERSISTENCE_REQUIRED":
      return success({ ...state, persistence: "pending" });
    case "LOCAL_PERSISTENCE_SUCCEEDED":
      return state.persistence === "pending"
        ? success({ ...state, persistence: "succeeded" })
        : illegal(state, event);
    case "LOCAL_PERSISTENCE_FAILED":
      return state.persistence === "pending"
        ? recordFault({ ...state, persistence: "failed" }, event.faultId, event.error)
        : illegal(state, event);
    case "UNRESOLVED_WORK_RECORDED":
      return success({ ...state, unresolvedWorkIds: addUnique(state.unresolvedWorkIds, event.workId) });
    case "UNRESOLVED_WORK_RESOLVED":
      return state.unresolvedWorkIds.includes(event.workId)
        ? success({ ...state, unresolvedWorkIds: state.unresolvedWorkIds.filter((id) => id !== event.workId) })
        : transitionError("invalidEvent", `Unknown unresolved work ${event.workId}.`);
    case "ERROR_RECORDED":
      return recordFault(state, event.faultId, event.error);
    case "CANCELLATION_REQUESTED":
      return requestCancellation(state, event.reason);
    case "RECOVERY_STARTED":
      return startRecovery(state, event.faultId, event);
    case "RECOVERY_RESOLVED":
      return state.phase === "recovering" && state.faultId === event.faultId
        ? success({ ...state, phase: state.resumePhase, fault: { kind: "none" } })
        : state.phase === "recovering"
          ? transitionError("unresolvedFaultConflict", `Recovery does not match fault ${state.faultId}.`)
          : illegal(state, event);
    case "TURN_FINALIZED": {
      if (
        state.phase !== "requestingProvider" &&
        state.phase !== "continuing" &&
        state.phase !== "awaitingConfirmation" &&
        state.phase !== "cancelling"
      ) {
        return illegal(state, event);
      }
      const outcome = deriveOverallOutcome(state);
      if (outcome?.kind === "completed" && state.serverExecutionStatus !== "externallyCompleted") {
        return transitionError(
          "insufficientTerminalFacts",
          "A completed Turn requires externallyCompleted Server execution."
        );
      }
      if (state.serverExecutionStatus === "providerRunning") {
        return transitionError(
          "insufficientTerminalFacts",
          "A Turn cannot finalize while external Provider execution is still running."
        );
      }
      return outcome ? terminal(state, outcome) : transitionError(
        "insufficientTerminalFacts",
        "The Turn has no successful output, terminal fault, cancellation, or pending confirmation."
      );
    }
    default:
      return assertNever(event);
  }
}

function deriveOverallOutcome(
  state: AgentTurnLifecycleState,
  options: { cancellationReason?: string } = {}
): OverallLocalAgentTurnOutcome | null {
  const batches = state.toolBatches.map((batch) => batch.outcome);
  const hasSuccessfulEffect = Boolean(
    state.providerEffectProduced || batches.some((batch) => batch.executedCount > 0)
  );
  const hasPending =
    state.confirmation.kind === "pending" &&
    batches.some((batch) => batch.pendingConfirmationCount > 0);
  const hasCancellation = Boolean(
    options.cancellationReason ||
      (state.phase === "cancelling" && state.reason) ||
      state.serverExecutionStatus === "externallyCancelled" ||
      batches.some((batch) => batch.cancelledCount > 0)
  );
  const hasFailure = Boolean(
    state.serverExecutionStatus === "externallyFailed" ||
      batches.some((batch) => batch.failedCount > 0) ||
      batches.some((batch) => batch.hasPersistenceFailure) ||
      state.persistence === "failed" ||
      (state.fault.kind === "present" && state.fault.error.kind !== "cancelled")
  );
  const hasUnresolved = Boolean(
    state.unresolvedWorkIds.length ||
      batches.some((batch) => batch.unresolvedWorkIds.length > 0)
  );
  const hasIncomplete = hasPending || hasCancellation || hasFailure || hasUnresolved;
  const reasons = buildOutcomeReasons(
    state,
    batches,
    options.cancellationReason ?? (state.phase === "cancelling" ? state.reason : undefined)
  );

  if (hasSuccessfulEffect && hasIncomplete) {
    return { kind: "partiallyCompleted", reasons };
  }
  if (hasPending) {
    return { kind: "pendingConfirmation", reasons };
  }
  if (hasCancellation) {
    return { kind: "cancelled", reasons };
  }
  if (hasFailure) {
    return { kind: "failed", reasons };
  }
  if (
    hasSuccessfulEffect &&
    state.persistence !== "pending" &&
    !batches.some((batch) => batch.kind === "partiallyCompleted")
  ) {
    return { kind: "completed", reasons: [] };
  }
  return null;
}

function buildOutcomeReasons(
  state: AgentTurnLifecycleState,
  batches: readonly ToolBatchOutcome[],
  cancellationReason?: string
): string[] {
  const reasons: string[] = [];
  if (cancellationReason) reasons.push(cancellationReason);
  if (state.serverExecutionStatus === "externallyFailed") reasons.push("externalExecutionFailed");
  if (state.serverExecutionStatus === "externallyCancelled") reasons.push("externalExecutionCancelled");
  if (batches.some((batch) => batch.failedCount > 0)) reasons.push("toolCallFailed");
  if (batches.some((batch) => batch.cancelledCount > 0)) reasons.push("toolCallCancelled");
  if (
    batches.some((batch) => batch.pendingConfirmationCount > 0) &&
    state.confirmation.kind === "pending"
  ) reasons.push("confirmationPending");
  if (
    batches.some((batch) => batch.hasPersistenceFailure) ||
    state.persistence === "failed"
  ) reasons.push("persistenceFailed");
  if (
    batches.some((batch) => batch.unresolvedWorkIds.length > 0) ||
    state.unresolvedWorkIds.length
  ) reasons.push("unresolvedWork");
  if (state.fault.kind === "present") reasons.push(state.fault.error.kind);
  return [...new Set(reasons)];
}

function startCompaction(
  state: Exclude<AgentTurnLifecycleState, { phase: "terminal" }>,
  mode: AgentTurnCompactionMode,
  event: AgentTurnEvent
): AgentTurnTransitionResult {
  if (state.phase !== "preparing" && state.phase !== "requestingProvider" && state.phase !== "continuing") {
    return illegal(state, event);
  }
  if (state.serverExecutionStatus === "providerRunning") {
    return transitionError("invalidServerStatusTransition", "Compaction cannot start while Provider execution is running.");
  }
  if (state.fault.kind === "present") {
    return transitionError("unresolvedFaultConflict", `Fault ${state.fault.faultId} must be resolved first.`);
  }
  return success({ ...state, phase: "compacting", mode, resumePhase: state.phase });
}

function failCompaction(
  state: Exclude<AgentTurnLifecycleState, { phase: "terminal" }>,
  faultId: string,
  error: AgentTurnError,
  event: AgentTurnEvent
): AgentTurnTransitionResult {
  if (state.phase !== "compacting") return illegal(state, event);
  if (!faultId.trim()) {
    return transitionError("invalidEvent", "Fault ID must not be empty.");
  }
  if (error.kind === "cancelled") {
    return transitionError("invalidEvent", "Cancelled compaction must use COMPACTION_CANCELLED.");
  }
  const failed = { ...state, fault: { kind: "present", faultId, error } as const };
  if (error.kind === "retryable") {
    return success({ ...failed, phase: "recovering", faultId, error, resumePhase: state.resumePhase });
  }
  return terminal(failed, deriveOverallOutcome(failed)!);
}

function startProviderRequest(
  state: Exclude<AgentTurnLifecycleState, { phase: "terminal" }>,
  requestId: string,
  stepSequence: number,
  event: AgentTurnEvent
): AgentTurnTransitionResult {
  if (!requestId.trim() || !Number.isInteger(stepSequence) || stepSequence < 1) {
    return transitionError("invalidEvent", "Provider request identity and step sequence must be valid.");
  }
  const isInitial =
    (state.phase === "preparing" || state.phase === "requestingProvider") &&
    state.serverExecutionStatus === "created" &&
    state.externalRequest.kind === "none" &&
    stepSequence === 1;
  const isContinuation =
    state.phase === "continuing" &&
    state.serverExecutionStatus === "awaitingNextRequest" &&
    state.externalRequest.kind === "settled" &&
    requestId !== state.externalRequest.requestId &&
    stepSequence === state.externalRequest.stepSequence + 1;
  if (!isInitial && !isContinuation) {
    if (
      state.externalRequest.kind !== "none" &&
      stepSequence <= state.externalRequest.stepSequence
    ) {
      return transitionError(
        "externalStepSequenceConflict",
        `External step ${stepSequence} is not newer than ${state.externalRequest.stepSequence}.`
      );
    }
    return illegal(state, event);
  }
  return success({
    ...state,
    phase: "requestingProvider",
    serverExecutionStatus: "providerRunning",
    externalRequest: { kind: "active", requestId, stepSequence },
    providerOutput: { kind: "none" },
    streamActivitySequence: 0
  });
}

function startToolBatch(
  state: Exclude<AgentTurnLifecycleState, { phase: "terminal" }>,
  declaredCallIds: readonly string[],
  event: AgentTurnEvent
): AgentTurnTransitionResult {
  if (
    state.phase !== "continuing" ||
    state.serverExecutionStatus !== "awaitingNextRequest" ||
    state.externalRequest.kind !== "settled" ||
    state.providerOutput.kind !== "received" ||
    state.providerOutput.requestId !== state.externalRequest.requestId ||
    state.providerOutput.stepSequence !== state.externalRequest.stepSequence
  ) return illegal(state, event);
  const duplicate = findDuplicate(declaredCallIds);
  if (duplicate) return transitionError("conflictingToolResult", `Duplicate declared Call ID ${duplicate}.`);
  const previouslyDeclared = new Set(state.toolBatches.flatMap((batch) => batch.declaredCallIds));
  const repeatedCallId = declaredCallIds.find((callId) => previouslyDeclared.has(callId));
  if (repeatedCallId) {
    return transitionError(
      "conflictingToolResult",
      `Call ${repeatedCallId} was already terminal in an earlier batch.`
    );
  }
  return success({
    ...state,
    phase: "executingTools",
    providerOutput: {
      kind: "consumed",
      requestId: state.providerOutput.requestId,
      stepSequence: state.providerOutput.stepSequence
    },
    activeToolBatch: { declaredCallIds: [...declaredCallIds], results: [] }
  });
}

function recordToolResult(
  state: Exclude<AgentTurnLifecycleState, { phase: "terminal" }>,
  result: ToolCallTerminalResult,
  event: AgentTurnEvent
): AgentTurnTransitionResult {
  if (state.phase !== "executingTools") return illegal(state, event);
  if (!state.activeToolBatch.declaredCallIds.includes(result.callId)) {
    return transitionError("conflictingToolResult", `Call ${result.callId} was not declared.`);
  }
  const previous = state.activeToolBatch.results.find((item) => item.callId === result.callId);
  if (previous) {
    return sameToolCallResult(previous, result)
      ? success(state)
      : transitionError("conflictingToolResult", `Call ${result.callId} already has a different terminal result.`);
  }
  return success({
    ...state,
    activeToolBatch: {
      ...state.activeToolBatch,
      results: [...state.activeToolBatch.results, result]
    }
  });
}

function finalizeToolBatch(
  state: Exclude<AgentTurnLifecycleState, { phase: "terminal" }>,
  event: AgentTurnEvent
): AgentTurnTransitionResult {
  if (state.phase !== "executingTools") return illegal(state, event);
  const aggregated = aggregateToolBatchOutcome(
    state.activeToolBatch.declaredCallIds,
    state.activeToolBatch.results
  );
  if (!aggregated.ok) {
    return transitionError("incompleteToolBatch", `${aggregated.error.code}: ${aggregated.error.callId}`);
  }
  const toolBatch: FinalizedToolBatch = {
    declaredCallIds: state.activeToolBatch.declaredCallIds,
    results: state.activeToolBatch.results,
    outcome: aggregated.outcome
  };
  const pendingCallIds = state.activeToolBatch.results
    .filter((result) => result.status === "pendingConfirmation")
    .map((result) => result.callId);
  if (pendingCallIds.length) {
    return success({
      ...state,
      phase: "awaitingConfirmation",
      callIds: pendingCallIds,
      confirmation: { kind: "pending", callIds: pendingCallIds },
      toolBatches: [...state.toolBatches, toolBatch]
    });
  }
  return success({
    ...state,
    phase: "continuing",
    toolBatches: [...state.toolBatches, toolBatch]
  });
}

function startRecovery(
  state: Exclude<AgentTurnLifecycleState, { phase: "terminal" }>,
  faultId: string,
  event: AgentTurnEvent
): AgentTurnTransitionResult {
  if (
    state.phase !== "preparing" &&
    state.phase !== "requestingProvider" &&
    state.phase !== "continuing"
  ) {
    return illegal(state, event);
  }
  if (
    state.fault.kind !== "present" ||
    state.fault.faultId !== faultId ||
    state.fault.error.kind !== "retryable"
  ) {
    return transitionError("invalidEvent", "Only an explicitly retryable error can enter recovery.");
  }
  return success({
    ...state,
    phase: "recovering",
    faultId,
    error: state.fault.error,
    resumePhase: state.phase
  });
}

function requestCancellation(
  state: Exclude<AgentTurnLifecycleState, { phase: "terminal" }>,
  reason: string
): AgentTurnTransitionResult {
  if (state.phase === "executingTools") {
    const completedCallIds = new Set(state.activeToolBatch.results.map((result) => result.callId));
    const results: ToolCallTerminalResult[] = [
      ...state.activeToolBatch.results,
      ...state.activeToolBatch.declaredCallIds
        .filter((callId) => !completedCallIds.has(callId))
        .map((callId) => ({ status: "cancelled" as const, callId, reason }))
    ];
    const aggregated = aggregateToolBatchOutcome(state.activeToolBatch.declaredCallIds, results);
    if (!aggregated.ok) {
      return transitionError("incompleteToolBatch", `${aggregated.error.code}: ${aggregated.error.callId}`);
    }
    const { activeToolBatch, ...facts } = state;
    return success({
      ...facts,
      phase: "cancelling",
      reason,
      confirmation: { kind: "none" },
      toolBatches: [
        ...facts.toolBatches,
        {
          declaredCallIds: activeToolBatch.declaredCallIds,
          results,
          outcome: aggregated.outcome
        }
      ]
    });
  }
  return success({ ...state, phase: "cancelling", reason, confirmation: { kind: "none" } });
}

function observeServerStatus(
  state: Exclude<AgentTurnLifecycleState, { phase: "terminal" }>,
  requestId: string,
  stepSequence: number,
  status: ServerExternalExecutionStatus
): AgentTurnTransitionResult {
  if (!matchesExternalRequest(state, requestId, stepSequence)) {
    return externalRequestMismatch(state, requestId, stepSequence);
  }
  if (
    (state.phase === "executingTools" || state.phase === "awaitingConfirmation") &&
    status !== "awaitingNextRequest"
  ) {
    return transitionError(
      "invalidServerStatusTransition",
      `${state.phase} requires awaitingNextRequest external status.`
    );
  }
  if (!isServerStatusTransitionAllowed(state.serverExecutionStatus, status)) {
    return transitionError(
      "invalidServerStatusTransition",
      `${state.serverExecutionStatus} cannot transition to ${status}.`
    );
  }
  return success({
    ...state,
    serverExecutionStatus: status,
    externalRequest: status === "providerRunning"
      ? { kind: "active", requestId, stepSequence }
      : { kind: "settled", requestId, stepSequence }
  });
}

function isServerStatusTransitionAllowed(
  current: ServerExternalExecutionStatus,
  next: ServerExternalExecutionStatus
): boolean {
  if (current === next) return true;
  const allowed: Record<ServerExternalExecutionStatus, readonly ServerExternalExecutionStatus[]> = {
    created: ["providerRunning", "externallyCancelled", "externallyFailed"],
    providerRunning: ["awaitingNextRequest", "externallyCompleted", "externallyCancelled", "externallyFailed"],
    awaitingNextRequest: ["externallyCompleted", "externallyCancelled", "externallyFailed"],
    externallyCompleted: [],
    externallyCancelled: [],
    externallyFailed: []
  };
  return allowed[current].includes(next);
}

function matchesExternalRequest(
  state: AgentTurnLifecycleState,
  requestId: string,
  stepSequence: number,
  requireActive = false
): boolean {
  return state.externalRequest.kind !== "none" &&
    (!requireActive || state.externalRequest.kind === "active") &&
    state.externalRequest.requestId === requestId &&
    state.externalRequest.stepSequence === stepSequence;
}

function externalRequestMismatch(
  state: AgentTurnLifecycleState,
  requestId: string,
  stepSequence: number
): AgentTurnTransitionResult {
  const active = state.externalRequest.kind === "none"
    ? "none"
    : `${state.externalRequest.requestId}/${state.externalRequest.stepSequence}`;
  return transitionError(
    "externalRequestMismatch",
    `External event ${requestId}/${stepSequence} does not match ${active}.`
  );
}

function recordFault(
  state: Exclude<AgentTurnLifecycleState, { phase: "terminal" }>,
  faultId: string,
  error: AgentTurnError
): AgentTurnTransitionResult {
  if (!faultId.trim()) {
    return transitionError("invalidEvent", "Fault ID must not be empty.");
  }
  if (error.kind === "cancelled") {
    return transitionError("invalidEvent", "Cancellation must use CANCELLATION_REQUESTED.");
  }
  if (state.fault.kind === "none") {
    return success({ ...state, fault: { kind: "present", faultId, error } });
  }
  if (state.fault.faultId === faultId && sameAgentTurnError(state.fault.error, error)) {
    return success(state);
  }
  return transitionError(
    "unresolvedFaultConflict",
    `Fault ${state.fault.faultId} must be resolved before recording ${faultId}.`
  );
}

function sameAgentTurnError(left: AgentTurnError, right: AgentTurnError): boolean {
  return left.kind === right.kind &&
    left.code === right.code &&
    left.message === right.message &&
    left.recoverable === right.recoverable;
}

function sameToolCallResult(left: ToolCallTerminalResult, right: ToolCallTerminalResult): boolean {
  if (left.status !== right.status || left.callId !== right.callId) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function findDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function addUnique(values: readonly string[], value: string): readonly string[] {
  return values.includes(value) ? values : [...values, value];
}

function terminal(
  state: Exclude<AgentTurnLifecycleState, { phase: "terminal" }>,
  outcome: OverallLocalAgentTurnOutcome
): AgentTurnTransitionResult {
  return success({ ...state, phase: "terminal", outcome });
}

function success(state: AgentTurnLifecycleState): AgentTurnTransitionResult {
  return { ok: true, state };
}

function illegal(state: AgentTurnLifecycleState, event: AgentTurnEvent): AgentTurnTransitionResult {
  return transitionError("illegalTransition", `${event.type} is not legal from ${state.phase}.`);
}

function transitionError(
  code: AgentTurnTransitionError["code"],
  message: string
): AgentTurnTransitionResult {
  return { ok: false, error: { kind: "conflict", code, message, recoverable: false } };
}

function aggregationError(
  code: ToolBatchAggregationError["code"],
  callId: string
): ToolBatchAggregationResult {
  return { ok: false, error: { kind: "conflict", code, callId, recoverable: false } };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected lifecycle value: ${JSON.stringify(value)}`);
}
