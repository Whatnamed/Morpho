import { describe, expect, it, vi } from "vitest";

import {
  attachDocumentExtractToFileObject,
  createTestWorkspace
} from "@/domain/morpho/workspace";
import { importAssetBackedObjects } from "@/domain/morpho/imports";
import type { AssetRecord } from "@/domain/morpho/types";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";

import { createAgentTurnHostFake, type AgentTurnHostFake } from "./agentTurnHostFake";
import type { AgentTurnHost } from "./agentTurnHost";
import {
  A_PLUS_DOCUMENT_EXTRACT_SERIALIZATION_CAP,
  prepareAgentTurnProductAPlus,
  serializeDocumentExtractEvidence,
  type RunMorphoAgentTurnAPlusInput
} from "./agentTurnProductPreparationAPlus";
import type { AiDocumentExtract } from "./documentContext";

describe("A+ document extract serialization and disclosure", () => {
  it("marks a short extract complete at the serialization boundary", () => {
    const extract: AiDocumentExtract = {
      objectId: "file-brief",
      title: "产品简报",
      fileName: "brief.txt",
      text: "简报正文共一百字左右，完整收录进入提示词。",
      charCount: 21,
      truncated: false
    };

    const serialized = serializeDocumentExtractEvidence(extract);

    expect(serialized).toContain("- 产品简报（file-brief）[完整收录：21 字]");
    expect(serialized).toContain("简报正文共一百字左右，完整收录进入提示词。");
    expect(serialized).not.toContain("部分收录");
  });

  it("visibly marks an extract longer than 2,200 chars as partial and bounds serialized body", () => {
    const rawContent = "一二三四五六七八九十".repeat(300); // 3,000 chars > 2,200
    const extract: AiDocumentExtract = {
      objectId: "file-spec",
      title: "需求规格",
      fileName: "spec.txt",
      text: rawContent,
      charCount: 3000,
      truncated: false
    };

    const serialized = serializeDocumentExtractEvidence(extract);

    expect(serialized).toContain("- 需求规格（file-spec）[部分收录：模型输入截断至前 2200 字（上下文提取 3000 字）]");
    const bodyText = serialized.split("\n").slice(1).join("\n");
    expect(bodyText).toHaveLength(A_PLUS_DOCUMENT_EXTRACT_SERIALIZATION_CAP);
    expect(bodyText).toBe(rawContent.slice(0, A_PLUS_DOCUMENT_EXTRACT_SERIALIZATION_CAP));
  });

  it("keeps collector-level truncation visible when serialization cap is not exceeded", () => {
    const text2000 = "前置截断内容".repeat(300); // 1,800 chars <= 2,200
    const extract: AiDocumentExtract = {
      objectId: "file-large-doc",
      title: "大文件摘录",
      fileName: "large.pdf",
      text: text2000,
      charCount: 15_000,
      truncated: true,
      extractionTruncated: true
    };

    const serialized = serializeDocumentExtractEvidence(extract);

    expect(serialized).toContain("部分收录");
    expect(serialized).toContain("模型输入收录 1800 字");
    expect(serialized).toContain("解析阶段已截断（已知 15000 字）");
    expect(serialized).not.toContain("完整收录");
  });

  it("distinguishes both collector truncation and second-boundary truncation when both occur", () => {
    const text4000 = "超长上下文提取".repeat(600); // 4,200 chars > 2,200
    const extract: AiDocumentExtract = {
      objectId: "file-huge-doc",
      title: "超大文件",
      fileName: "huge.pdf",
      text: text4000,
      charCount: 50_000,
      truncated: true,
      contextTruncated: true,
      extractionTruncated: true
    };

    const serialized = serializeDocumentExtractEvidence(extract);

    expect(serialized).toContain("模型输入截断至前 2200 字（上下文提取 4200 字）");
    expect(serialized).toContain("按上下文预算截断（已知 50000 字）");
    expect(serialized).toContain("解析阶段已截断（已知 50000 字）");
    const bodyText = serialized.split("\n").slice(1).join("\n");
    expect(bodyText).toHaveLength(2200);
  });

  it("verifies production prepareAgentTurnProductAPlus pipeline persists identical documentExtract text in ProviderInputSnapshot and sends to providerRequest", async () => {
    const baseWorkspace = createTestWorkspace();
    const sourceAsset: AssetRecord = {
      id: "asset-spec-source",
      fileName: "requirements.txt",
      mimeType: "text/plain",
      size: 3000,
      createdAt: "2026-06-26T00:00:00.000Z",
      storageKey: "blob:asset-spec-source",
      sourceType: "originalFile"
    };
    const extractAsset: AssetRecord = {
      id: "asset-spec-extract",
      fileName: "requirements.extract.txt",
      mimeType: "text/plain",
      size: 3000,
      createdAt: "2026-06-26T00:00:00.000Z",
      storageKey: "blob:asset-spec-extract",
      sourceType: "documentExtract"
    };

    const imported = importAssetBackedObjects(baseWorkspace, {
      assets: [sourceAsset],
      position: { x: 200, y: 200 }
    });
    const fileObjectId = imported.objectIds[0] ?? "";
    const longDocumentContent = "核心技术规范与设计约束。".repeat(250); // 3,000 chars > 2,200

    const workspace = attachDocumentExtractToFileObject(imported.workspace, {
      fileObjectId,
      extractAsset,
      extractedCharCount: 3000,
      extractedPageCount: 1,
      extractionTruncated: false,
      parsedAt: "2026-06-26T00:00:00.000Z"
    });

    const fake = createAgentTurnHostFake({ workspace });
    const host = hostFromFake(fake);

    const getSpy = vi.spyOn(indexedDbBlobStore, "get").mockImplementation(async (key: string) => {
      if (key === extractAsset.storageKey) {
        return new Blob([longDocumentContent], { type: "text/plain" });
      }
      return null;
    });

    try {
      const turnInput: RunMorphoAgentTurnAPlusInput = {
        draft: "结合需求规格分析技术方案",
        taskMode: "chatAnalysis",
        recommendedTaskMode: "chatAnalysis",
        workIntent: "discussion",
        recommendedWorkIntent: "discussion",
        selectedObjectIds: [fileObjectId],
        selectedObjects: [workspace.objects[fileObjectId]!],
        pendingDeliveryDraftTarget: null,
        directionPreviewCount: 1,
        agentTurnMode: "auto",
        imageGenerationModelId: "test-model",
        readConversationTokenLimits: () => undefined
      };

      const prepared = await prepareAgentTurnProductAPlus(turnInput, host);

      // 1. Inspect user message committed to workspace by host.commitWorkspace
      const committedWorkspace = host.readWorkspace();
      const userMessage = committedWorkspace.ai.messages.find((m) => m.role === "user");
      expect(userMessage).toBeDefined();
      const snapshot = userMessage?.providerInputSnapshot;
      expect(snapshot).toBeDefined();
      const snapshotExtractPart = snapshot?.textParts.find((p) => p.kind === "documentExtract");
      expect(snapshotExtractPart).toBeDefined();
      const snapshotText = snapshotExtractPart?.text ?? "";
      // 2. Inspect providerRequest.input message (the last user message in the input array)
      const userProviderMsg = [...prepared.providerRequest.input].reverse().find((m) => m.role === "user");
      expect(userProviderMsg).toBeDefined();
      const providerInputTextPart = userProviderMsg?.content.find(
        (part): part is { type: "input_text"; text: string } =>
          part.type === "input_text" && "text" in part && typeof part.text === "string" && part.text.includes("<untrusted_document_evidence>")
      );
      expect(providerInputTextPart).toBeDefined();
      const providerText = providerInputTextPart?.text ?? "";

      // 3. Prove genuine identity between provider-visible text and persisted snapshot
      expect(providerText).toBe(snapshotText);

      // 4. Assert truncation disclosure contents
      expect(snapshotText).toContain("requirements.txt");
      expect(snapshotText).toContain("[部分收录：模型输入截断至前 2200 字（上下文提取 3000 字）]");
      expect(snapshotText).not.toContain("完整收录");
    } finally {
      getSpy.mockRestore();
    }
  });
});

function hostFromFake(fake: AgentTurnHostFake): AgentTurnHost {
  return {
    commitWorkspace: fake.commitWorkspace,
    readWorkspace: fake.readWorkspace,
    persistWorkspace: fake.persistWorkspace,
    ui: {
      setContextWarning: fake.createUiRecorder("warning"),
      clearPendingDeliveryDraftTarget: fake.createUiRecorder("clearDelivery"),
      setStreaming: fake.createUiRecorder("streaming"),
      setDraft: fake.createUiRecorder("draft"),
      setTaskMode: fake.createUiRecorder("taskMode"),
      openConversation: fake.createUiRecorder("openConversation"),
      showFailure: fake.createUiRecorder("failure"),
      requestPendingConfirmation: (value) => {
        fake.createUiRecorder("confirmation")(value);
        return { status: "accepted", origin: "agent" };
      },
      selectObjects: fake.createUiRecorder("selection"),
      focusObject: fake.createUiRecorder("focus"),
      openProposal: fake.createUiRecorder("proposal")
    },
    abortSlot: fake.abortSlot,
    streamFlushSlot: fake.streamFlushSlot,
    fetch: fake.fetch,
    executeVisualGenerationPlan: async ({ workspaceSnapshot }) => ({
      workspace: workspaceSnapshot,
      createdObjectIds: [],
      failedItems: []
    }),
    now: fake.now,
    randomSuffix: fake.randomSuffix
  };
}
