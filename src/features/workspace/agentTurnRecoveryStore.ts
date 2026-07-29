import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import type {
  AiTaskMode,
  AiWorkIntent,
  ProjectMemoryKey,
  StageRecordKey
} from "@/domain/morpho/types";
import type { ProviderCitation } from "@/server/ai/types";
import type { ConversationTokenLimits } from "@/domain/morpho/conversationCompaction";
import type {
  APlusAgentContinuationItem,
  APlusAgentProviderRequest
} from "@/shared/agentTurnJournalProtocol";
import type { PendingAiConfirmation } from "./components/AiConversationPanel";
import type { AgentTurnCoordinatorRecoverySnapshot } from "./agentTurnCoordinator";
import type { AgentTurnCompactionMode } from "./agentTurnLifecycle";
import type { MorphoAgentTurnMode } from "./morphoAgent";
import type {
  APlusExternalActionKind,
  APlusExternalActionStatus
} from "./agentExternalActionClientAPlus";
import type {
  RequiredAgentReadRequirement,
  RequiredAgentReadToolName
} from "./agentTaskStrategy";

const STORAGE_PREFIX = "morpho.agent-runtime-a-plus.recovery.v2";
const LEGACY_STORAGE_PREFIX = "morpho.agent-runtime-a-plus.recovery.v1";
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_PAYLOAD_BYTES = 32 * 1024 * 1024;

export const A_PLUS_TURN_RECOVERY_RECORD_VERSION = 2 as const;

export type APlusTurnRecoveryFacts = Readonly<{
  requiredReadState: Readonly<{
    requiredTools: readonly RequiredAgentReadToolName[];
    requirements: readonly RequiredAgentReadRequirement[];
    completedTools: readonly RequiredAgentReadToolName[];
    failedTools: readonly RequiredAgentReadToolName[];
    reminderInserted: boolean;
    repairAttempted: boolean;
    exhausted: boolean;
  }>;
  collectedCitations: readonly ProviderCitation[];
  hasWebSearchEvidence: boolean;
  memoryUpdateReminderInserted: boolean;
  handledMemoryCandidateIndexes: readonly number[];
  memoryUpdateEntryIds: readonly string[];
  memoryUpdateKeys: readonly ProjectMemoryKey[];
  stageRecordUpdateKeys: readonly StageRecordKey[];
  finalText: string;
  pendingConfirmationCreated: boolean;
  hasAgentToolResult: boolean;
}>;

export type APlusTurnRecoveryRuntime = Readonly<{
  input: Readonly<{
    draft: string;
    taskMode: AiTaskMode;
    recommendedTaskMode: AiTaskMode;
    workIntent: AiWorkIntent;
    recommendedWorkIntent: AiWorkIntent;
    selectedObjectIds: readonly string[];
    pendingDeliveryDraftTarget: Readonly<{
      deliveryObjectId: string;
      sectionId: string;
    }> | null;
    directionPreviewCount: number;
    agentTurnMode: MorphoAgentTurnMode;
    imageGenerationModelId: string;
    conversationTokenLimits?: ConversationTokenLimits;
  }>;
  providerBaseRequest: APlusAgentProviderRequest;
  continuationItems: readonly APlusAgentContinuationItem[];
  localAgentTurnId: string;
  createdAt: string;
  executionTaskMode: AiTaskMode;
  executionWorkIntent: AiWorkIntent;
  imageAttachmentObjectIds: readonly string[];
  documentExtractObjectIds: readonly string[];
  allowStructuredComparison: boolean;
  facts: APlusTurnRecoveryFacts;
}>;

export type APlusTurnRecoveryMetadata = Readonly<{
  userMessageId: string;
  assistantMessageId: string;
  traceId?: string;
  pendingConfirmation?: Readonly<{
    confirmationId: string;
    callId: string;
    value: PendingAiConfirmation;
  }>;
  compaction?: Readonly<{
    mode: AgentTurnCompactionMode;
    actionId: string;
    expectedPreviousRevisionId?: string;
    summaryApplyState: "notApplied" | "applied" | "failed";
    appliedRevisionId?: string;
  }>;
  pendingExternalAction?: Readonly<{
    status: APlusExternalActionStatus;
    actionId: string;
    actionKind: APlusExternalActionKind;
    callId?: string;
    requestBody: string;
    requestHash: string;
    lastObservedAt: string;
  }>;
  toolExecutionIntents?: readonly Readonly<{
    callId: string;
    stableOperationId: string;
    status: "intent" | "terminal";
    observedAt: string;
  }>[];
  localPersistence: "notRequired" | "required" | "succeeded" | "failed";
  runtime: APlusTurnRecoveryRuntime;
}>;

export type APlusTurnRecoveryRecord = Readonly<{
  recordVersion: typeof A_PLUS_TURN_RECOVERY_RECORD_VERSION;
  localProjectId: string;
  serverTurnId: string;
  creationIdempotencyKey: string;
  coordinator: AgentTurnCoordinatorRecoverySnapshot;
  metadata: APlusTurnRecoveryMetadata;
  updatedAt: string;
}>;

type PersistedPayloadReference = Readonly<{
  ref: string;
  sha256: string;
  byteLength: number;
}>;

type PersistedActiveRequest = Readonly<{
  requestId: string;
  stepSequence: number;
  providerPayload: PersistedPayloadReference;
  lifecycleStarted: boolean;
  retryAllowed: boolean;
  reconciliationOnly: boolean;
}>;

type PersistedConfirmationReference = Readonly<{
  confirmationId: string;
  callId: string;
  payload: PersistedPayloadReference;
}>;

type PersistedRecoveryRecord = Readonly<{
  recordVersion: typeof A_PLUS_TURN_RECOVERY_RECORD_VERSION;
  localProjectId: string;
  serverTurnId: string;
  creationIdempotencyKey: string;
  coordinator: Omit<
    AgentTurnCoordinatorRecoverySnapshot,
    "activeRequest" | "latestProviderOutput"
  > & {
    activeRequest?: PersistedActiveRequest;
    latestProviderOutputPayload?: PersistedPayloadReference;
  };
  metadata: Omit<APlusTurnRecoveryMetadata, "pendingConfirmation" | "pendingExternalAction" | "runtime"> & {
    pendingConfirmation?: PersistedConfirmationReference;
    pendingExternalAction?: Omit<
      NonNullable<APlusTurnRecoveryMetadata["pendingExternalAction"]>,
      "requestBody"
    >;
    pendingExternalActionPayload?: PersistedPayloadReference;
    runtimePayload: PersistedPayloadReference;
  };
  updatedAt: string;
}>;

export type AgentTurnRecoveryStorage = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}>;

export type AgentTurnRecoveryPayloadStore = Readonly<{
  put(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | null>;
  delete(ref: string): Promise<void>;
}>;

export type AgentTurnRecoveryStore = Readonly<{
  save(record: APlusTurnRecoveryRecord): Promise<void>;
  load(localProjectId: string): Promise<
    | { status: "none" }
    | { status: "ok"; record: APlusTurnRecoveryRecord }
    | { status: "invalid"; reason: string }
  >;
  clear(localProjectId: string): Promise<void>;
}>;

export function createAgentTurnRecoveryStore(options: Readonly<{
  storage?: AgentTurnRecoveryStorage;
  payloadStore?: AgentTurnRecoveryPayloadStore;
}> = {}): AgentTurnRecoveryStore {
  const storage = options.storage ?? browserStorage();
  const payloadStore = options.payloadStore ?? indexedDbRecoveryPayloadStore;

  return {
    async save(record) {
      validateRecordIdentity(record);
      const previous = readPersisted(storage, record.localProjectId);
      const active = record.coordinator.activeRequest;
      const providerPayload = active
        ? await persistPayload(
            payloadStore,
            `provider:${record.serverTurnId}:${active.requestId}:${active.stepSequence}`,
            JSON.stringify(active.providerRequest),
            MAX_PROVIDER_PAYLOAD_BYTES
          )
        : undefined;
      const latestProviderOutput = record.coordinator.latestProviderOutput;
      const latestProviderOutputPayload = latestProviderOutput
        ? await persistPayload(
            payloadStore,
            `output:${record.serverTurnId}:${latestProviderOutput.requestId}:${latestProviderOutput.stepSequence}`,
            JSON.stringify(latestProviderOutput),
            MAX_PROVIDER_PAYLOAD_BYTES
          )
        : undefined;
      const confirmation = record.metadata.pendingConfirmation
        ? await persistPayload(
            payloadStore,
            `confirmation:${record.serverTurnId}:${record.metadata.pendingConfirmation.confirmationId}`,
            JSON.stringify(record.metadata.pendingConfirmation.value),
            MAX_METADATA_BYTES
          )
        : undefined;
      const pendingExternalAction = record.metadata.pendingExternalAction;
      const pendingExternalActionPayload = pendingExternalAction
        ? await persistPayload(
            payloadStore,
            `external-action:${record.serverTurnId}:${pendingExternalAction.actionId}`,
            pendingExternalAction.requestBody,
            MAX_PROVIDER_PAYLOAD_BYTES
          )
        : undefined;
      const runtimePayload = await persistPayload(
        payloadStore,
        `runtime:${record.serverTurnId}`,
        JSON.stringify(record.metadata.runtime),
        MAX_PROVIDER_PAYLOAD_BYTES
      );
      const {
        activeRequest: _activeRequest,
        latestProviderOutput: _latestProviderOutput,
        ...coordinator
      } = record.coordinator;
      const {
        pendingConfirmation: _pendingConfirmation,
        pendingExternalAction: _pendingExternalAction,
        runtime: _runtime,
        ...metadata
      } = record.metadata;
      const persistedExternalAction = pendingExternalAction
        ? (() => {
            const { requestBody: _requestBody, ...descriptor } = pendingExternalAction;
            return descriptor;
          })()
        : undefined;
      const persisted: PersistedRecoveryRecord = {
        recordVersion: A_PLUS_TURN_RECOVERY_RECORD_VERSION,
        localProjectId: record.localProjectId,
        serverTurnId: record.serverTurnId,
        creationIdempotencyKey: record.creationIdempotencyKey,
        coordinator: {
          ...coordinator,
          ...(active && providerPayload
            ? {
                activeRequest: {
                  requestId: active.requestId,
                  stepSequence: active.stepSequence,
                  providerPayload,
                  lifecycleStarted: active.lifecycleStarted,
                  retryAllowed: active.retryAllowed,
                  reconciliationOnly: active.reconciliationOnly
                }
            }
            : {}),
          ...(latestProviderOutputPayload
            ? { latestProviderOutputPayload }
            : {})
        },
        metadata: {
          ...metadata,
          runtimePayload,
            ...(record.metadata.pendingConfirmation && confirmation
            ? {
                pendingConfirmation: {
                  confirmationId: record.metadata.pendingConfirmation.confirmationId,
                  callId: record.metadata.pendingConfirmation.callId,
                  payload: confirmation
                }
              }
            : {}),
          ...(persistedExternalAction && pendingExternalActionPayload
            ? {
                pendingExternalAction: persistedExternalAction,
                pendingExternalActionPayload
              }
            : {})
        },
        updatedAt: record.updatedAt
      };
      const serialized = JSON.stringify(persisted);
      if (utf8Length(serialized) > MAX_METADATA_BYTES) {
        throw new Error("A+ Recovery metadata exceeds the bounded local record size.");
      }
      storage.setItem(recoveryKey(record.localProjectId), serialized);
      await deleteReplacedPayloads(payloadStore, previous, persisted);
    },

    async load(localProjectId) {
      if (!isIdentifier(localProjectId)) return { status: "invalid", reason: "项目 ID 无效。" };
      const raw = storage.getItem(recoveryKey(localProjectId));
      if (raw === null) {
        if (storage.getItem(legacyRecoveryKey(localProjectId)) !== null) {
          return { status: "invalid", reason: "A+ Recovery Record 仍是 v1，必须重新建立 v2 恢复边界。" };
        }
        return { status: "none" };
      }
      if (!raw || utf8Length(raw) > MAX_METADATA_BYTES) {
        return { status: "invalid", reason: "A+ Recovery Record 元数据无效或过大。" };
      }
      const persisted = readPersisted(storage, localProjectId);
      if (!persisted) return { status: "invalid", reason: "A+ Recovery Record JSON 无法解析。" };
      if (!isPersistedRecoveryRecord(persisted, localProjectId)) {
        return { status: "invalid", reason: "A+ Recovery Record 结构无效。" };
      }
      try {
        const active = persisted.coordinator.activeRequest;
        const providerRequest = active
          ? await loadVerifiedPayload(payloadStore, active.providerPayload)
          : undefined;
        const latestProviderOutputReference = persisted.coordinator.latestProviderOutputPayload;
        const latestProviderOutputPayload = latestProviderOutputReference
          ? await loadVerifiedPayload(payloadStore, latestProviderOutputReference)
          : undefined;
        const confirmation = persisted.metadata.pendingConfirmation;
        const confirmationValue = confirmation
          ? await loadVerifiedPayload(payloadStore, confirmation.payload)
            : undefined;
        const pendingExternalAction = persisted.metadata.pendingExternalAction;
        const pendingExternalActionPayloadReference = persisted.metadata.pendingExternalActionPayload;
        const pendingExternalActionBody = pendingExternalActionPayloadReference
          ? await loadVerifiedPayload(payloadStore, pendingExternalActionPayloadReference)
          : undefined;
        const runtimePayload = await loadVerifiedPayload(
          payloadStore,
          persisted.metadata.runtimePayload
        );
        if (
          (active && providerRequest === undefined) ||
          (latestProviderOutputReference && latestProviderOutputPayload === undefined) ||
          (confirmation && confirmationValue === undefined) ||
          (pendingExternalAction && pendingExternalActionBody === undefined) ||
          (!pendingExternalAction && pendingExternalActionPayloadReference !== undefined) ||
          (pendingExternalAction && pendingExternalActionBody !== undefined &&
            await sha256Hex(pendingExternalActionBody) !== pendingExternalAction.requestHash) ||
          runtimePayload === undefined
        ) {
          return { status: "invalid", reason: "A+ Recovery payload 缺失或校验失败。" };
        }
        const {
          activeRequest: _active,
          latestProviderOutputPayload: _latestProviderOutputPayload,
          ...coordinator
        } = persisted.coordinator;
        const {
          pendingConfirmation: _confirmation,
          pendingExternalAction: _pendingExternalAction,
          pendingExternalActionPayload: _pendingExternalActionPayload,
          runtimePayload: _runtimePayload,
          ...metadata
        } = persisted.metadata;
        const runtime = JSON.parse(runtimePayload) as unknown;
        if (!isRecoveryRuntime(runtime)) {
          return { status: "invalid", reason: "A+ Recovery runtime payload 结构无效。" };
        }
        const latestProviderOutput = latestProviderOutputPayload
          ? JSON.parse(latestProviderOutputPayload) as unknown
          : undefined;
        if (latestProviderOutput !== undefined && !isRecoveryProviderOutput(latestProviderOutput)) {
          return { status: "invalid", reason: "A+ Recovery Provider Output 结构无效。" };
        }
        const reconstructed: APlusTurnRecoveryRecord = {
          recordVersion: A_PLUS_TURN_RECOVERY_RECORD_VERSION,
          localProjectId: persisted.localProjectId,
          serverTurnId: persisted.serverTurnId,
          creationIdempotencyKey: persisted.creationIdempotencyKey,
          coordinator: {
            ...coordinator,
            ...(active && providerRequest
              ? {
                  activeRequest: {
                    requestId: active.requestId,
                    stepSequence: active.stepSequence,
                    providerRequest: JSON.parse(providerRequest) as unknown,
                    lifecycleStarted: active.lifecycleStarted,
                    retryAllowed: active.retryAllowed,
                    reconciliationOnly: active.reconciliationOnly
                }
              }
              : {}),
            ...(latestProviderOutput
              ? { latestProviderOutput }
              : {})
          } as AgentTurnCoordinatorRecoverySnapshot,
          metadata: {
            ...metadata,
            runtime,
            ...(confirmation && confirmationValue
              ? {
                  pendingConfirmation: {
                    confirmationId: confirmation.confirmationId,
                    callId: confirmation.callId,
                    value: JSON.parse(confirmationValue) as PendingAiConfirmation
                  }
                }
              : {}),
            ...(pendingExternalAction && pendingExternalActionBody !== undefined
              ? {
                  pendingExternalAction: {
                    ...pendingExternalAction,
                    requestBody: pendingExternalActionBody
                  }
                }
              : {})
          },
          updatedAt: persisted.updatedAt
        };
        return { status: "ok", record: reconstructed };
      } catch {
        return { status: "invalid", reason: "A+ Recovery payload 无法读取。" };
      }
    },

    async clear(localProjectId) {
      const persisted = readPersisted(storage, localProjectId);
      storage.removeItem(recoveryKey(localProjectId));
      storage.removeItem(legacyRecoveryKey(localProjectId));
      if (persisted) {
        await Promise.all(payloadReferences(persisted).map((ref) => payloadStore.delete(ref)));
      }
    }
  };
}

const indexedDbRecoveryPayloadStore: AgentTurnRecoveryPayloadStore = {
  async put(ref, value) {
    await indexedDbBlobStore.put(ref, new Blob([value], { type: "application/json" }));
  },
  async get(ref) {
    const blob = await indexedDbBlobStore.get(ref);
    return blob ? blob.text() : null;
  },
  async delete(ref) {
    await indexedDbBlobStore.delete(ref);
  }
};

function browserStorage(): AgentTurnRecoveryStorage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("A+ Recovery Store 只能在浏览器 Workspace 中使用。");
  }
  return window.localStorage;
}

async function persistPayload(
  store: AgentTurnRecoveryPayloadStore,
  baseRef: string,
  value: string,
  maximumBytes: number
): Promise<PersistedPayloadReference> {
  const byteLength = utf8Length(value);
  if (byteLength > maximumBytes) throw new Error("A+ Recovery payload exceeds its bounded size.");
  const sha256 = await sha256Hex(value);
  const ref = `${STORAGE_PREFIX}.${baseRef}:${sha256}`;
  await store.put(ref, value);
  return { ref, sha256, byteLength };
}

async function loadVerifiedPayload(
  store: AgentTurnRecoveryPayloadStore,
  reference: PersistedPayloadReference
): Promise<string | undefined> {
  const value = await store.get(reference.ref);
  if (
    value === null ||
    utf8Length(value) !== reference.byteLength ||
    await sha256Hex(value) !== reference.sha256
  ) return undefined;
  return value;
}

function readPersisted(
  storage: AgentTurnRecoveryStorage,
  localProjectId: string
): PersistedRecoveryRecord | undefined {
  const raw = storage.getItem(recoveryKey(localProjectId));
  if (!raw || utf8Length(raw) > MAX_METADATA_BYTES) return undefined;
  try {
    return JSON.parse(raw) as PersistedRecoveryRecord;
  } catch {
    return undefined;
  }
}

function isPersistedRecoveryRecord(
  value: unknown,
  localProjectId: string
): value is PersistedRecoveryRecord {
  if (!isRecord(value) || !isRecord(value.coordinator) || !isRecord(value.metadata)) return false;
  if (
    value.recordVersion !== A_PLUS_TURN_RECOVERY_RECORD_VERSION ||
    value.localProjectId !== localProjectId ||
    !isIdentifier(value.localProjectId) ||
    !isIdentifier(value.serverTurnId) ||
    !isIdentifier(value.creationIdempotencyKey) ||
    typeof value.updatedAt !== "string" ||
    value.coordinator.localProjectId !== localProjectId ||
    !isIdentifier(value.metadata.userMessageId) ||
    !isIdentifier(value.metadata.assistantMessageId) ||
    !["notRequired", "required", "succeeded", "failed"].includes(String(value.metadata.localPersistence)) ||
    !isPayloadReference(value.metadata.runtimePayload)
  ) return false;
  const active = value.coordinator.activeRequest;
  if (active !== undefined && !isPersistedActiveRequest(active)) return false;
  const latestProviderOutput = value.coordinator.latestProviderOutputPayload;
  if (latestProviderOutput !== undefined && !isPayloadReference(latestProviderOutput)) return false;
  const confirmation = value.metadata.pendingConfirmation;
  const pendingExternalAction = value.metadata.pendingExternalAction;
  const pendingExternalActionPayload = value.metadata.pendingExternalActionPayload;
  const toolExecutionIntents = value.metadata.toolExecutionIntents;
  return (pendingExternalAction === undefined || isPersistedExternalActionMetadata(pendingExternalAction)) &&
    (pendingExternalAction === undefined
      ? pendingExternalActionPayload === undefined
      : isPayloadReference(pendingExternalActionPayload)) &&
    (toolExecutionIntents === undefined || (
      Array.isArray(toolExecutionIntents) &&
      toolExecutionIntents.length <= 128 &&
      toolExecutionIntents.every(isPersistedToolExecutionIntent)
    )) &&
    (confirmation === undefined || (
    isRecord(confirmation) &&
    isIdentifier(confirmation.confirmationId) &&
    isIdentifier(confirmation.callId) &&
    isPayloadReference(confirmation.payload)
  ));
}

function isPersistedToolExecutionIntent(value: unknown): boolean {
  return isRecord(value) &&
    isIdentifier(value.callId) &&
    isIdentifier(value.stableOperationId) &&
    (value.status === "intent" || value.status === "terminal") &&
    typeof value.observedAt === "string";
}

function isPersistedExternalActionMetadata(value: unknown): boolean {
  return isRecord(value) &&
    (value.status === "acquired" ||
      value.status === "running" ||
      value.status === "completedWithPayload" ||
      value.status === "completedPayloadUnavailable" ||
      value.status === "cancelled" ||
      value.status === "failed" ||
      value.status === "conflict") &&
    isIdentifier(value.actionId) &&
    (value.actionKind === "webSearch" || value.actionKind === "image" || value.actionKind === "compaction") &&
    (value.callId === undefined || isIdentifier(value.callId)) &&
    typeof value.requestHash === "string" &&
    /^[0-9a-f]{64}$/.test(value.requestHash) &&
    typeof value.lastObservedAt === "string";
}

function isPersistedActiveRequest(value: unknown): value is PersistedActiveRequest {
  return isRecord(value) &&
    isIdentifier(value.requestId) &&
    Number.isSafeInteger(value.stepSequence) &&
    (value.stepSequence as number) >= 1 &&
    typeof value.lifecycleStarted === "boolean" &&
    typeof value.retryAllowed === "boolean" &&
    typeof value.reconciliationOnly === "boolean" &&
    isPayloadReference(value.providerPayload);
}

function isPayloadReference(value: unknown): value is PersistedPayloadReference {
  return isRecord(value) &&
    typeof value.ref === "string" && value.ref.startsWith(`${STORAGE_PREFIX}.`) &&
    typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256) &&
    Number.isSafeInteger(value.byteLength) &&
    (value.byteLength as number) >= 1 &&
    (value.byteLength as number) <= MAX_PROVIDER_PAYLOAD_BYTES;
}

function validateRecordIdentity(record: APlusTurnRecoveryRecord): void {
  if (
    !isIdentifier(record.localProjectId) ||
    !isIdentifier(record.serverTurnId) ||
    !isIdentifier(record.creationIdempotencyKey) ||
    record.coordinator.localProjectId !== record.localProjectId ||
    record.coordinator.serverSnapshot.serverTurnId !== record.serverTurnId ||
    record.coordinator.lifecycle.turnId !== record.serverTurnId
  ) throw new Error("A+ Recovery Record identity is inconsistent.");
}

async function deleteReplacedPayloads(
  store: AgentTurnRecoveryPayloadStore,
  previous: PersistedRecoveryRecord | undefined,
  next: PersistedRecoveryRecord
): Promise<void> {
  if (!previous) return;
  const retained = new Set(payloadReferences(next));
  await Promise.all(
    payloadReferences(previous)
      .filter((ref) => !retained.has(ref))
      .map((ref) => store.delete(ref))
  );
}

function payloadReferences(record: PersistedRecoveryRecord): string[] {
  return [
    record.coordinator.activeRequest?.providerPayload.ref,
    record.coordinator.latestProviderOutputPayload?.ref,
    record.metadata.pendingConfirmation?.payload.ref,
    record.metadata.pendingExternalActionPayload?.ref,
    record.metadata.runtimePayload.ref
  ].filter((value): value is string => Boolean(value));
}

function isRecoveryRuntime(value: unknown): value is APlusTurnRecoveryRuntime {
  if (!isRecord(value) || !isRecord(value.input) || !isRecord(value.providerBaseRequest)) {
    return false;
  }
  const input = value.input;
  return typeof input.draft === "string" && input.draft.length <= 24_000 &&
    typeof input.taskMode === "string" &&
    typeof input.recommendedTaskMode === "string" &&
    typeof input.workIntent === "string" &&
    typeof input.recommendedWorkIntent === "string" &&
    Array.isArray(input.selectedObjectIds) &&
    input.selectedObjectIds.every(isIdentifier) &&
    Number.isSafeInteger(input.directionPreviewCount) &&
    (input.agentTurnMode === "auto" || input.agentTurnMode === "confirm") &&
    typeof input.imageGenerationModelId === "string" &&
    Array.isArray(value.continuationItems) &&
    isIdentifier(value.localAgentTurnId) &&
    typeof value.createdAt === "string" &&
    typeof value.executionTaskMode === "string" &&
    typeof value.executionWorkIntent === "string" &&
    Array.isArray(value.imageAttachmentObjectIds) &&
    value.imageAttachmentObjectIds.every(isIdentifier) &&
    Array.isArray(value.documentExtractObjectIds) &&
    value.documentExtractObjectIds.every(isIdentifier) &&
    typeof value.allowStructuredComparison === "boolean" &&
    isRecoveryFacts(value.facts);
}

function isRecoveryFacts(value: unknown): value is APlusTurnRecoveryFacts {
  if (!isRecord(value) || !isRecord(value.requiredReadState)) return false;
  const reads = value.requiredReadState;
  return Array.isArray(reads.requiredTools) &&
    reads.requiredTools.every((tool) =>
      tool === "read_project_memory" ||
      tool === "read_stage_record" ||
      tool === "search_project_conversation"
    ) &&
    Array.isArray(reads.requirements) &&
    reads.requirements.every(isRecoveryReadRequirement) &&
    Array.isArray(reads.completedTools) &&
    reads.completedTools.every((tool) => typeof tool === "string") &&
    Array.isArray(reads.failedTools) &&
    reads.failedTools.every((tool) => typeof tool === "string") &&
    typeof reads.reminderInserted === "boolean" &&
    typeof reads.repairAttempted === "boolean" &&
    typeof reads.exhausted === "boolean" &&
    Array.isArray(value.collectedCitations) &&
    value.collectedCitations.length <= 512 &&
    value.collectedCitations.every(isRecoveryCitation) &&
    typeof value.hasWebSearchEvidence === "boolean" &&
    typeof value.memoryUpdateReminderInserted === "boolean" &&
    Array.isArray(value.handledMemoryCandidateIndexes) &&
    value.handledMemoryCandidateIndexes.every((item) => Number.isSafeInteger(item) && item >= 0) &&
    Array.isArray(value.memoryUpdateEntryIds) &&
    value.memoryUpdateEntryIds.every(isIdentifier) &&
    Array.isArray(value.memoryUpdateKeys) &&
    value.memoryUpdateKeys.every(isIdentifier) &&
    Array.isArray(value.stageRecordUpdateKeys) &&
    value.stageRecordUpdateKeys.every(isIdentifier) &&
    typeof value.finalText === "string" && value.finalText.length <= 240_000 &&
    typeof value.pendingConfirmationCreated === "boolean" &&
    typeof value.hasAgentToolResult === "boolean";
}

function isRecoveryReadRequirement(value: unknown): value is RequiredAgentReadRequirement {
  if (!isRecord(value) || typeof value.tool !== "string") return false;
  if (value.tool === "read_project_memory") {
    return Array.isArray(value.requiredKeys) && value.requiredKeys.every(isIdentifier);
  }
  if (value.tool === "read_stage_record") {
    return Array.isArray(value.requiredStages) && value.requiredStages.every(isIdentifier);
  }
  return value.tool === "search_project_conversation" &&
    (value.requiredMode === "earliest" || value.requiredMode === "latest" || value.requiredMode === "keyword") &&
    (value.keyword === undefined || typeof value.keyword === "string");
}

function isRecoveryCitation(value: unknown): value is ProviderCitation {
  return isRecord(value) &&
    typeof value.title === "string" &&
    (value.url === undefined || typeof value.url === "string") &&
    (value.domain === undefined || typeof value.domain === "string") &&
    (value.snippet === undefined || typeof value.snippet === "string");
}

function isRecoveryProviderOutput(
  value: unknown
): value is NonNullable<AgentTurnCoordinatorRecoverySnapshot["latestProviderOutput"]> {
  if (
    !isRecord(value) ||
    value.type !== "providerOutput" ||
    !isIdentifier(value.requestId) ||
    !Number.isSafeInteger(value.stepSequence) ||
    (value.stepSequence as number) < 1 ||
    (value.stepSequence as number) > 10_000 ||
    typeof value.outputText !== "string" ||
    value.outputText.length > 240_000 ||
    typeof value.producedUserVisibleEffect !== "boolean" ||
    !Array.isArray(value.toolCallIds) ||
    !Array.isArray(value.toolCalls) ||
    value.toolCallIds.length !== value.toolCalls.length ||
    value.toolCallIds.length > 64 ||
    !value.toolCallIds.every(isIdentifier) ||
    new Set(value.toolCallIds).size !== value.toolCallIds.length
  ) return false;
  const toolCallIds = value.toolCallIds;
  const toolCalls = value.toolCalls;
  return toolCalls.every((call, index) =>
    isRecord(call) &&
    call.callId === toolCallIds[index] &&
    isIdentifier(call.callId) &&
    isIdentifier(call.name) &&
    typeof call.argumentsText === "string" &&
    call.argumentsText.length >= 2 &&
    call.argumentsText.length <= 120_000
  );
}

function recoveryKey(localProjectId: string): string {
  return `${STORAGE_PREFIX}.${localProjectId}`;
}

function legacyRecoveryKey(localProjectId: string): string {
  return `${LEGACY_STORAGE_PREFIX}.${localProjectId}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 && value.length <= 160 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
