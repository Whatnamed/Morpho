import { describe, expect, it } from "vitest";

import { MORPHO_AGENT_PROMPT_CONTRACT_VERSION } from "./agentPromptRegistry";
import {
  createAgentTurnLifecycleState,
  reduceAgentTurnLifecycle
} from "./agentTurnLifecycle";
import {
  A_PLUS_TURN_RECOVERY_RECORD_VERSION,
  createAgentTurnRecoveryStore,
  type AgentTurnRecoveryPayloadStore,
  type AgentTurnRecoveryStorage,
  type APlusTurnRecoveryRecord
} from "./agentTurnRecoveryStore";

const TURN_ID = "019fa9c0-7b9d-7a20-8f31-2c676296c9d1";

describe("A+ local Recovery Store", () => {
  it("keeps exact Provider payloads out of localStorage and verifies them on load", async () => {
    const fixture = createFixture();
    const record = recoveryRecord("large ".repeat(50_000));

    await fixture.store.save(record);

    const metadata = [...fixture.storageValues.values()][0] ?? "";
    expect(metadata).not.toContain("large large");
    expect(fixture.payloadValues.size).toBeGreaterThanOrEqual(2);
    await expect(fixture.store.load("project-test")).resolves.toEqual({
      status: "ok",
      record
    });
  });

  it("stores a large observed Tool payload behind a verified IndexedDB reference", async () => {
    const fixture = createFixture();
    const record = recoveryRecordWithLargeProviderOutput();

    await fixture.store.save(record);

    const metadata = [...fixture.storageValues.values()][0] ?? "";
    expect(metadata).not.toContain("recovery-tool-marker");
    expect([...fixture.payloadValues.values()].some((value) =>
      value.includes("recovery-tool-marker")
    )).toBe(true);
    await expect(fixture.store.load("project-test")).resolves.toEqual({
      status: "ok",
      record
    });
  });

  it("stores a pending External Action body behind a verified payload reference", async () => {
    const fixture = createFixture();
    const record: APlusTurnRecoveryRecord = {
      ...recoveryRecord("exact request"),
      metadata: {
        ...recoveryRecord("exact request").metadata,
        pendingExternalAction: {
          status: "running",
          actionId: "image-action-1",
          actionKind: "image",
          requestBody: "image-body-".repeat(200_000),
          requestHash: "".padStart(64, "0"),
          lastObservedAt: "2026-07-29T00:00:00.000Z"
        }
      }
    };
    const { subtle } = crypto;
    const digest = await subtle.digest(
      "SHA-256",
      new TextEncoder().encode(record.metadata.pendingExternalAction!.requestBody)
    );
    const requestHash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const withHash: APlusTurnRecoveryRecord = {
      ...record,
      metadata: {
        ...record.metadata,
        pendingExternalAction: {
          ...record.metadata.pendingExternalAction!,
          requestHash
        }
      }
    };

    await fixture.store.save(withHash);

    const metadata = [...fixture.storageValues.values()][0] ?? "";
    expect(metadata).not.toContain("image-body-");
    expect([...fixture.payloadValues.values()].some((value) => value.startsWith("image-body-"))).toBe(true);
    await expect(fixture.store.load("project-test")).resolves.toEqual({
      status: "ok",
      record: withHash
    });
  });

  it("reports malformed metadata as invalid instead of silently treating it as absent", async () => {
    const fixture = createFixture();
    fixture.storageValues.set(
      "morpho.agent-runtime-a-plus.recovery.v1.project-test",
      "{broken"
    );

    await expect(fixture.store.load("project-test")).resolves.toMatchObject({
      status: "invalid"
    });
  });

  it("rejects a payload whose hash no longer matches and clears every referenced blob", async () => {
    const fixture = createFixture();
    await fixture.store.save(recoveryRecord("exact request"));
    const firstRef = [...fixture.payloadValues.keys()][0]!;
    fixture.payloadValues.set(firstRef, "tampered");

    await expect(fixture.store.load("project-test")).resolves.toMatchObject({
      status: "invalid"
    });
    await fixture.store.clear("project-test");
    expect(fixture.storageValues.size).toBe(0);
    expect(fixture.payloadValues.size).toBe(0);
  });
});

function createFixture() {
  const storageValues = new Map<string, string>();
  const payloadValues = new Map<string, string>();
  const storage: AgentTurnRecoveryStorage = {
    getItem: (key) => storageValues.get(key) ?? null,
    setItem: (key, value) => storageValues.set(key, value),
    removeItem: (key) => {
      storageValues.delete(key);
    }
  };
  const payloadStore: AgentTurnRecoveryPayloadStore = {
    put: async (ref, value) => {
      payloadValues.set(ref, value);
    },
    get: async (ref) => payloadValues.get(ref) ?? null,
    delete: async (ref) => {
      payloadValues.delete(ref);
    }
  };
  return {
    storageValues,
    payloadValues,
    store: createAgentTurnRecoveryStore({ storage, payloadStore })
  };
}

function recoveryRecord(text: string): APlusTurnRecoveryRecord {
  const prepared = reduceAgentTurnLifecycle(
    createAgentTurnLifecycleState(TURN_ID),
    { type: "PREPARATION_COMPLETED", turnId: TURN_ID }
  );
  if (!prepared.ok) throw new Error(prepared.error.message);
  const providerRequest = {
    input: [{ role: "user" as const, content: [{ type: "input_text" as const, text }] }],
    promptContractVersion: MORPHO_AGENT_PROMPT_CONTRACT_VERSION,
    mode: "auto" as const,
    capabilityIntent: { comparisonAnalysis: false }
  };
  return {
    recordVersion: A_PLUS_TURN_RECOVERY_RECORD_VERSION,
    localProjectId: "project-test",
    serverTurnId: TURN_ID,
    creationIdempotencyKey: "creation-a",
    coordinator: {
      recordVersion: 1,
      localProjectId: "project-test",
      creationIdempotencyKey: "creation-a",
      lifecycle: prepared.state,
      serverSnapshot: {
        serverTurnId: TURN_ID,
        localProjectId: "project-test",
        status: "created",
        latestRequestId: null,
        latestStepSequence: 0,
        counters: { provider: 0, webSearch: 0, image: 0 },
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
        terminalAt: null
      },
      activeRequest: {
        requestId: "request-1",
        stepSequence: 1,
        providerRequest,
        lifecycleStarted: false,
        retryAllowed: true,
        reconciliationOnly: false
      }
    },
    metadata: {
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
      localPersistence: "succeeded",
      runtime: {
        input: {
          draft: "讨论项目",
          taskMode: "chatAnalysis",
          recommendedTaskMode: "chatAnalysis",
          workIntent: "discussion",
          recommendedWorkIntent: "discussion",
          selectedObjectIds: [],
          pendingDeliveryDraftTarget: null,
          directionPreviewCount: 1,
          agentTurnMode: "auto",
          imageGenerationModelId: "test-image-model"
        },
        providerBaseRequest: providerRequest,
        continuationItems: [],
        localAgentTurnId: "local-turn-1",
        createdAt: "2026-07-29T00:00:00.000Z",
        executionTaskMode: "chatAnalysis",
        executionWorkIntent: "discussion",
        imageAttachmentObjectIds: [],
        documentExtractObjectIds: [],
        allowStructuredComparison: false,
        facts: {
          requiredReadState: {
            requiredTools: [],
            requirements: [],
            completedTools: [],
            failedTools: [],
            reminderInserted: false,
            repairAttempted: false,
            exhausted: false
          },
          collectedCitations: [],
          hasWebSearchEvidence: false,
          memoryUpdateReminderInserted: false,
          handledMemoryCandidateIndexes: [],
          memoryUpdateEntryIds: [],
          memoryUpdateKeys: [],
          stageRecordUpdateKeys: [],
          finalText: "",
          pendingConfirmationCreated: false,
          hasAgentToolResult: false
        }
      }
    },
    updatedAt: "2026-07-29T00:00:00.000Z"
  };
}

function recoveryRecordWithLargeProviderOutput(): APlusTurnRecoveryRecord {
  const base = recoveryRecord("exact request");
  let lifecycle = base.coordinator.lifecycle;
  const started = reduceAgentTurnLifecycle(lifecycle, {
    type: "PROVIDER_REQUEST_STARTED",
    turnId: TURN_ID,
    requestId: "request-1",
    stepSequence: 1
  });
  if (!started.ok) throw new Error(started.error.message);
  lifecycle = started.state;
  const output = reduceAgentTurnLifecycle(lifecycle, {
    type: "PROVIDER_OUTPUT_RECEIVED",
    turnId: TURN_ID,
    requestId: "request-1",
    stepSequence: 1,
    producedUserVisibleEffect: false
  });
  if (!output.ok) throw new Error(output.error.message);
  lifecycle = output.state;
  const awaiting = reduceAgentTurnLifecycle(lifecycle, {
    type: "SERVER_EXECUTION_STATUS_OBSERVED",
    turnId: TURN_ID,
    requestId: "request-1",
    stepSequence: 1,
    status: "awaitingNextRequest"
  });
  if (!awaiting.ok) throw new Error(awaiting.error.message);
  const toolCalls = Array.from({ length: 24 }, (_, index) => ({
    callId: `call-${index}`,
    name: "create_research_analysis",
    argumentsText: JSON.stringify({
      marker: "recovery-tool-marker",
      payload: "x".repeat(100_000)
    })
  }));
  const { activeRequest: _activeRequest, ...coordinator } = base.coordinator;
  return {
    ...base,
    coordinator: {
      ...coordinator,
      lifecycle: awaiting.state,
      serverSnapshot: {
        ...base.coordinator.serverSnapshot,
        status: "awaitingNextRequest",
        latestRequestId: "request-1",
        latestStepSequence: 1,
        counters: { provider: 1, webSearch: 0, image: 0 }
      },
      latestProviderOutput: {
        type: "providerOutput",
        requestId: "request-1",
        stepSequence: 1,
        outputText: "",
        producedUserVisibleEffect: false,
        toolCallIds: toolCalls.map((call) => call.callId),
        toolCalls
      },
      lastRequest: { requestId: "request-1", stepSequence: 1 }
    }
  };
}
