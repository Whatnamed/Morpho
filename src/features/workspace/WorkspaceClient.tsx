"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AiContextTask, AiTaskMode, AssetRecord, MorphoObject } from "@/domain/morpho/types";
import type { GrsImageAspectRatio } from "@/domain/morpho/grsImageModels";
import { createGeneratedImageFromAsset } from "@/domain/morpho/generation";
import { importAssetBackedObjects, importTextObject, importUrlObject } from "@/domain/morpho/imports";
import {
  canStartOperation,
  applyResearchAnalysisProposal,
  completeImageGenerationOperation,
  createImageGenerationOperation,
  createResearchOperation,
  detectResearchSourceChanges,
  failImageGenerationOperation,
  markImageGenerationOperationSubmitted,
  recordResearchAnalysisProposal
} from "@/domain/operations/operations";
import { parseResearchAnalysisProposalPayload } from "@/domain/operations/researchProposal";
import {
  assembleAiContext,
  createAiDraftFromSuggestion,
  deleteObject,
  eliminateDirection,
  hideObject,
  restoreObject,
  setDefaultReference
} from "@/domain/morpho/workspace";
import type { CanvasInstance, MorphoWorkspace } from "@/domain/morpho/types";
import type { ProviderCitation } from "@/server/ai/types";
import { AiConversationPanel } from "./components/AiConversationPanel";
import type { PendingAiConfirmation } from "./components/AiConversationPanel";
import { BottomDetailBar } from "./components/BottomDetailBar";
import { LeftRail, type DrawerMode } from "./components/LeftRail";
import { OverlayDrawers } from "./components/OverlayDrawers";
import { TopControls } from "./components/TopControls";
import { usePersistentWorkspace } from "./usePersistentWorkspace";
import { compactObjectList, getSuggestionsForSelection, type Suggestion } from "./workspaceUi";
import { indexedDbBlobStore, getAssetObjectUrl } from "@/infrastructure/assets/indexedDbAssetStore";
import { readImageBlobDimensions, saveBlobAsLocalAsset } from "@/infrastructure/assets/localAssetWorkflow";
import { recommendAiTaskMode, resolveTaskModeForSend } from "./aiTaskRouting";
import { buildWebSearchOptions, collectMiMoImageAttachments, shouldAttachImagesForMiMo } from "./aiAttachments";
import {
  getDefaultImageGenerationSettings,
  getImageGenerationModelOptions,
  inferGenerationAspectRatio,
  resolveGenerationSettings,
  type ImageGenerationSettings
} from "./imageGenerationSettings";
import type { CanvasImportRequest, FocusArea } from "./tldraw/MorphoCanvas";

const MorphoCanvas = dynamic(() => import("./tldraw/MorphoCanvas").then((mod) => mod.MorphoCanvas), {
  ssr: false,
  loading: () => <div className="workspace-canvas" aria-label="画布正在加载" />
});

type FocusRequest = {
  area?: FocusArea;
  objectId?: string;
  nonce: number;
};

type WorkspaceClientProps = {
  projectId: string;
};

type ImageTaskState = "preparing" | "submitting" | "waiting" | "downloading" | "succeeded" | "failed" | "cancelled";

type ImageTaskStatus = {
  state: ImageTaskState;
  message: string;
};

export function WorkspaceClient({ projectId }: WorkspaceClientProps) {
  const [workspace, setWorkspace, persistenceState] = usePersistentWorkspace(projectId);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>(() => workspace.ui.lastSelectionIds);
  const [aiDraft, setAiDraft] = useState("");
  const [taskMode, setTaskMode] = useState<AiTaskMode>("chatAnalysis");
  const [aiOpen, setAiOpen] = useState(true);
  const [activeDrawer, setActiveDrawer] = useState<DrawerMode>(null);
  const [localEditObjectId, setLocalEditObjectId] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAiConfirmation | null>(null);
  const [showFailure, setShowFailure] = useState(false);
  const [contextWarning, setContextWarning] = useState<string | undefined>();
  const [isAiStreaming, setIsAiStreaming] = useState(false);
  const [imageTaskStatus, setImageTaskStatus] = useState<ImageTaskStatus | null>(null);
  const [imageGenerationSettings, setImageGenerationSettings] = useState<ImageGenerationSettings>(() =>
    getDefaultImageGenerationSettings()
  );
  const [imageGenerationAspectMode, setImageGenerationAspectMode] = useState<"auto" | "manual">("auto");
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const assetUrlsRef = useRef<Record<string, string>>({});
  const abortControllerRef = useRef<AbortController | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest>({ area: "visual", nonce: 0 });

  const selectedObjects = useMemo(
    () => compactObjectList(workspace.objects, selectedObjectIds),
    [selectedObjectIds, workspace.objects]
  );

  const suggestions = useMemo(() => getSuggestionsForSelection(selectedObjects), [selectedObjects]);
  const recommendedTaskMode = useMemo(
    () => recommendAiTaskMode(aiDraft, selectedObjects.map((object) => object.type)),
    [aiDraft, selectedObjects]
  );
  const isImageTaskMode = taskMode === "imageGeneration";
  const imageGenerationModelOptions = useMemo(() => getImageGenerationModelOptions(), []);
  const inferredImageAspectRatio = useMemo(
    () => inferGenerationAspectRatio(workspace, selectedObjectIds),
    [selectedObjectIds, workspace]
  );
  const effectiveImageGenerationSettings = useMemo(
    () =>
      imageGenerationAspectMode === "auto"
        ? {
            ...imageGenerationSettings,
            aspectRatio: inferredImageAspectRatio
          }
        : imageGenerationSettings,
    [imageGenerationAspectMode, imageGenerationSettings, inferredImageAspectRatio]
  );

  const updateImageGenerationSettings = useCallback(
    (patch: { modelId?: string; aspectRatio?: GrsImageAspectRatio; sizeOption?: string }) => {
      if (patch.aspectRatio) {
        setImageGenerationAspectMode("manual");
      }

      setImageGenerationSettings((current) =>
        resolveGenerationSettings({
          modelId: patch.modelId ?? current.modelId,
          sizeOption: patch.sizeOption ?? current.sizeOption,
          aspectRatio:
            patch.aspectRatio ?? (imageGenerationAspectMode === "auto" ? inferredImageAspectRatio : current.aspectRatio)
        })
      );
    },
    [imageGenerationAspectMode, inferredImageAspectRatio]
  );

  useEffect(() => {
    if (!activeDrawer) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveDrawer(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDrawer]);

  useEffect(() => {
    if (!activeDrawer) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      if (event.target.closest(".left-rail, .project-map, .side-drawer, .search-layer")) {
        return;
      }

      setActiveDrawer(null);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [activeDrawer]);

  const focusArea = useCallback((area: FocusArea) => {
    setFocusRequest((current) => ({ area, nonce: current.nonce + 1 }));
    setActiveDrawer(null);
  }, []);

  const focusObject = useCallback((objectId: string) => {
    setSelectedObjectIds([objectId]);
    setFocusRequest((current) => ({ objectId, nonce: current.nonce + 1 }));
    setActiveDrawer(null);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadAssetUrls() {
      const imageAssets = Object.values(workspace.assets).filter(
        (asset) => asset.sourceType === "originalImage" || asset.sourceType === "aiGeneratedImage"
      );
      const entries = await Promise.all(
        imageAssets.map(async (asset) => {
          try {
            const url = await getAssetObjectUrl(asset.storageKey);
            return url ? ([asset.id, url] as const) : null;
          } catch {
            return null;
          }
        })
      );

      if (isCancelled) {
        return;
      }

      const nextAssetUrls = Object.fromEntries(
        entries.filter((entry): entry is readonly [string, string] => Boolean(entry))
      );
      Object.values(assetUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      assetUrlsRef.current = nextAssetUrls;
      setAssetUrls(nextAssetUrls);
    }

    void loadAssetUrls();

    return () => {
      isCancelled = true;
    };
  }, [workspace.assets]);

  const handleSelectionChange = useCallback(
    (objectIds: string[]) => {
      setSelectedObjectIds(objectIds);
      if (objectIds.length === 0) {
        setActiveDrawer(null);
      }
      setWorkspace((current) => {
        if (current.ui.lastSelectionIds.join("|") === objectIds.join("|")) {
          return current;
        }

        return {
          ...current,
          ui: {
            ...current.ui,
            lastSelectionIds: objectIds
          }
        };
      });
    },
    [setWorkspace]
  );

  const handleInstancesChange = useCallback(
    (instances: CanvasInstance[]) => {
      setWorkspace((current) => updateWorkspaceInstances(current, instances));
    },
    [setWorkspace]
  );

  const handleCanvasViewChange = useCallback(
    (view: MorphoWorkspace["canvas"]["view"]) => {
      setWorkspace((current) => {
        if (
          current.canvas.view.x === view.x &&
          current.canvas.view.y === view.y &&
          current.canvas.view.zoom === view.zoom &&
          current.ui.canvasView.x === view.x &&
          current.ui.canvasView.y === view.y &&
          current.ui.canvasView.zoom === view.zoom
        ) {
          return current;
        }

        return {
          ...current,
          canvas: {
            ...current.canvas,
            view
          },
          ui: {
            ...current.ui,
            canvasView: view
          }
        };
      });
    },
    [setWorkspace]
  );

  const handleImportRequest = useCallback(
    async (request: CanvasImportRequest) => {
      const successfulAssets: AssetRecord[] = [];
      const failureReasons: string[] = [];

      for (const file of request.files ?? []) {
        const sourceType = file.type.startsWith("image/") ? "originalImage" : "originalFile";
        const saved = await saveBlobAsLocalAsset(indexedDbBlobStore, file, sourceType, {
          readImageDimensions: readImageBlobDimensions
        });
        if (saved.status === "ok") {
          successfulAssets.push(saved.asset);
        } else {
          failureReasons.push(`${file.name}: ${saved.reason}`);
        }
      }

      let nextSelection: string[] = [];
      setWorkspace((current) => {
        let next = current;

        if (successfulAssets.length > 0) {
          const imported = importAssetBackedObjects(next, {
            assets: successfulAssets,
            position: request.position
          });
          next = imported.workspace;
          nextSelection = imported.objectIds;
        } else if (request.url) {
          const imported = importUrlObject(next, {
            url: request.url,
            position: request.position
          });
          next = imported.workspace;
          nextSelection = imported.objectIds;
        } else if (request.text) {
          const imported = importTextObject(next, {
            text: request.text,
            position: request.position
          });
          next = imported.workspace;
          nextSelection = imported.objectIds;
        }

        if (failureReasons.length === 0) {
          return next;
        }

        return {
          ...next,
          ai: {
            ...next.ai,
            messages: [
              ...next.ai.messages,
              {
                id: `ai-import-error-${Date.now()}`,
                role: "assistant",
                body: `有 ${failureReasons.length} 个资产没有导入成功：${failureReasons.join("；")}`,
                status: "failed",
                createdAt: new Date().toISOString()
              }
            ]
          }
        };
      });

      if (nextSelection.length > 0) {
        setSelectedObjectIds(nextSelection);
      }
    },
    [setWorkspace]
  );

  const handleRunResearchOperation = useCallback(
    async (draft: string) => {
      const operationGate = canStartOperation(workspace);
      if (operationGate.status === "blocked") {
        setAiDraft(draft);
        setWorkspace((current) => ({
          ...current,
          ai: {
            ...current.ai,
            messages: [
              ...current.ai.messages,
              {
                id: `ai-operation-blocked-${Date.now()}`,
                role: "assistant",
                body: `${operationGate.reason} 当前未完成任务：${operationGate.operation.userInput}`,
                status: "failed",
                createdAt: new Date().toISOString(),
                operationId: operationGate.operation.id
              }
            ]
          }
        }));
        return;
      }

      const context = assembleAiContext(workspace, {
        draft,
        selectedObjectIds,
        explicitObjectIds: [],
        task: "research"
      });
      const webSearch = buildWebSearchOptions({ draft, taskMode: "researchOperation" });
      const created = createResearchOperation(workspace, {
        userInput: draft,
        selectedObjectIds: context.objectIds,
        allowWebSearch: Boolean(webSearch)
      });
      const operationId = created.operation.id;
      const now = new Date().toISOString();
      const userMessageId = `ai-user-research-${Date.now()}`;
      const assistantMessageId = `ai-assistant-research-${Date.now()}`;
      const controller = new AbortController();
      const objectSummaries = makeObjectSummaries(workspace, context.objectIds);

      abortControllerRef.current = controller;
      setIsAiStreaming(true);
      setAiDraft("");
      setAiOpen(true);
      setWorkspace(() => ({
        ...created.workspace,
        ai: {
          ...created.workspace.ai,
          messages: [
            ...created.workspace.ai.messages,
            {
              id: userMessageId,
              role: "user",
              body: draft,
              createdAt: now,
              contextObjectIds: context.objectIds,
              taskMode: "researchOperation"
            },
              {
                id: assistantMessageId,
                role: "assistant",
                body: webSearch
                  ? "研究任务已开始：正在整理本地输入快照，并准备一次已授权的联网补充。"
                  : "研究任务已开始：正在整理本地输入快照。本轮未启用联网搜索。",
                createdAt: now,
                status: "streaming",
              contextObjectIds: context.objectIds,
              taskMode: "researchOperation",
              operationId
            }
          ]
        }
      }));

      try {
        const attachmentResult = shouldAttachImagesForMiMo({
          draft,
          taskMode: "researchOperation",
          selectedObjects
        })
          ? await collectMiMoImageAttachments(workspace, context.objectIds, controller.signal)
          : { attachments: [], skippedObjectIds: [], warning: undefined };
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draft,
            task: "research",
            taskMode: "researchOperation",
            messages: workspace.ai.messages.map((message) => ({ role: message.role, body: message.body })),
            objectSummaries,
            attachments: attachmentResult.attachments,
            webSearch,
            defaultReferenceStatus: "notRelevant"
          }),
          signal: controller.signal
        });

        if (!response.ok || !response.body) {
          const failure = await readErrorResponse(response);
          throw new Error(failure);
        }

        const streamResult = await readAiEventStream(response.body, (assistantBody) => {
          setWorkspace((current) => updateAiMessage(current, assistantMessageId, assistantBody, "streaming"));
        });
        const assistantBody = [attachmentResult.warning, streamResult.text].filter(Boolean).join("\n\n");

        const parsedProposal = parseResearchAnalysisProposalPayload(streamResult.text);
        if (parsedProposal.status === "failed") {
          const fallbackBody = [
            assistantBody || "MiMo 没有返回可显示文本。",
            "本次研究结果未能整理为可保存草案；你可以继续追问、补充要求或重试研究任务。"
          ].join("\n\n");
          setWorkspace((current) => {
            const withMessage = updateAiMessage(current, assistantMessageId, fallbackBody, "done");
            return streamResult.citations.length > 0
              ? storeMessageCitations(withMessage, {
                  messageId: assistantMessageId,
                  operationId,
                  citations: streamResult.citations
                })
              : withMessage;
          });
          return;
        }

        const proposalTitle = parsedProposal.proposal.title;
        const proposalId = `proposal-research-${operationId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setWorkspace((current) => {
          const proposed = recordResearchAnalysisProposal(
            updateAiMessage(current, assistantMessageId, assistantBody || "MiMo 没有返回可显示文本。", "done"),
            {
              proposalId,
              operationId,
              title: parsedProposal.proposal.title,
              summary: parsedProposal.proposal.summary,
              findings: parsedProposal.proposal.findings,
              opportunities: parsedProposal.proposal.opportunities,
              constraints: parsedProposal.proposal.constraints,
              openQuestions: parsedProposal.proposal.openQuestions,
              evidence: parsedProposal.proposal.evidence,
              sourceObjectIds: context.objectIds,
              citations: streamResult.citations,
              sourceChangedWarning: detectResearchSourceChanges(current, operationId)
            }
          );
          return updateAiMessage(proposed.workspace, assistantMessageId, assistantBody || "MiMo 没有返回可显示文本。", "done", {
            citationIds: proposed.proposal.citationIds
          });
        });
        setPendingConfirmation({
          kind: "applyResearchProposal",
          proposalId,
          targetTitle: proposalTitle
        });
      } catch (error) {
        const isCancelled = error instanceof DOMException && error.name === "AbortError";
        const message = isCancelled
          ? "研究任务已取消。原输入、选择和已完成步骤已保留。"
          : error instanceof Error
            ? error.message
            : "研究任务失败。";
        setAiDraft(draft);
        setWorkspace((current) => updateAiMessage(current, assistantMessageId, message, "failed"));
      } finally {
        abortControllerRef.current = null;
        setIsAiStreaming(false);
      }
    },
    [selectedObjectIds, selectedObjects, setWorkspace, workspace]
  );

  const handleSendAiMessage = useCallback(async () => {
    const draft = aiDraft.trim();
    if (!draft || isAiStreaming) {
      return;
    }

    const executionTaskMode = resolveTaskModeForSend({ currentTaskMode: taskMode, recommendedTaskMode });
    if (executionTaskMode === "researchOperation") {
      await handleRunResearchOperation(draft);
      return;
    }

    const task = inferAiContextTask(draft, selectedObjects);
    const context = assembleAiContext(workspace, {
      draft,
      selectedObjectIds,
      explicitObjectIds: [],
      task
    });
    setContextWarning(
      context.defaultReferenceStatus.status === "hidden" ? context.defaultReferenceStatus.message : undefined
    );

    const now = new Date().toISOString();
    const userMessageId = `ai-user-${Date.now()}`;
    const assistantMessageId = `ai-assistant-${Date.now()}`;
    const objectSummaries = makeObjectSummaries(workspace, context.objectIds);
    const controller = new AbortController();
    const webSearch = buildWebSearchOptions({ draft, taskMode: executionTaskMode });
    abortControllerRef.current = controller;
    setIsAiStreaming(true);
    setAiDraft("");
    setAiOpen(true);
    setWorkspace((current) => ({
      ...current,
      ai: {
        ...current.ai,
        messages: [
          ...current.ai.messages,
          {
            id: userMessageId,
            role: "user",
            body: draft,
            createdAt: now,
            contextObjectIds: context.objectIds,
            taskMode: executionTaskMode,
            recommendedTaskMode
          },
          {
            id: assistantMessageId,
            role: "assistant",
            body: "",
            createdAt: now,
            status: "streaming",
            contextObjectIds: context.objectIds,
            taskMode: executionTaskMode
          }
        ]
      }
    }));

    try {
      const attachmentResult = shouldAttachImagesForMiMo({
        draft,
        taskMode: executionTaskMode,
        selectedObjects
      })
        ? await collectMiMoImageAttachments(workspace, context.objectIds, controller.signal)
        : { attachments: [], skippedObjectIds: [], warning: undefined };
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          task,
          taskMode: executionTaskMode,
          messages: workspace.ai.messages.map((message) => ({ role: message.role, body: message.body })),
          objectSummaries,
          attachments: attachmentResult.attachments,
          webSearch,
          defaultReferenceStatus: summarizeDefaultReferenceStatus(context.defaultReferenceStatus)
        }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const failure = await readErrorResponse(response);
        throw new Error(failure);
      }

      const streamResult = await readAiEventStream(response.body, (assistantBody) => {
        setWorkspace((current) => updateAiMessage(current, assistantMessageId, assistantBody, "streaming"));
      });
      const assistantBody = [attachmentResult.warning, streamResult.text].filter(Boolean).join("\n\n");

      setWorkspace((current) => {
        const withMessage = updateAiMessage(current, assistantMessageId, assistantBody || "MiMo 没有返回可显示文本。", "done");
        if (streamResult.citations.length === 0) {
          return withMessage;
        }

        return storeMessageCitations(withMessage, {
          messageId: assistantMessageId,
          operationId: assistantMessageId,
          citations: streamResult.citations
        });
      });
    } catch (error) {
      const isCancelled = error instanceof DOMException && error.name === "AbortError";
      const message = isCancelled
        ? "当前请求已取消。原输入、选择和上下文已保留。"
        : error instanceof Error
          ? error.message
          : "AI 请求失败。";
      setAiDraft(draft);
      setWorkspace((current) => updateAiMessage(current, assistantMessageId, message, "failed"));
    } finally {
      abortControllerRef.current = null;
      setIsAiStreaming(false);
    }
  }, [
    aiDraft,
    handleRunResearchOperation,
    isAiStreaming,
    recommendedTaskMode,
    selectedObjectIds,
    selectedObjects,
    setWorkspace,
    taskMode,
    workspace
  ]);

  const handleCancelAiRequest = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleSuggestionClick = useCallback(
    (suggestion: Suggestion) => {
      const result = createAiDraftFromSuggestion(workspace, {
        selectedObjectIds,
        suggestion: suggestion.prompt
      });
      setAiDraft(result.draft);

      if (suggestion.label === "设为后续默认参考") {
        const target = selectedObjects.find((object) => object.type === "image");
        if (target) {
          setPendingConfirmation({
            kind: "setDefaultReference",
            targetObjectId: target.id,
            targetTitle: target.title
          });
        }
      }
    },
    [selectedObjectIds, selectedObjects, workspace]
  );

  const handleAskAi = useCallback(() => {
    setAiOpen(true);
    setTaskMode("chatAnalysis");
    if (selectedObjects[0]) {
      setAiDraft(`请基于“${selectedObjects[0].title}”继续分析下一步。`);
    }
  }, [selectedObjects]);

  const handleLocalEdit = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "image");
    if (!target) {
      return;
    }

    setAiOpen(true);
    setTaskMode("imageGeneration");
    setLocalEditObjectId(target.id);
    setAiDraft("保留整体比例与柔光轨道语言，把转角连接件做得更一体化、少一些外露五金感。");
  }, [selectedObjects]);

  const handleRunLocalEdit = useCallback(async () => {
    const draft = aiDraft.trim();
    const explicitImageId = localEditObjectId ?? selectedObjects.find((object) => object.type === "image")?.id;
    if (!draft || isAiStreaming) {
      return;
    }

    const context = assembleAiContext(workspace, {
      draft,
      selectedObjectIds,
      explicitObjectIds: explicitImageId ? [explicitImageId] : [],
      task: "visualDevelopment"
    });
    setContextWarning(
      context.defaultReferenceStatus.status === "hidden" ? context.defaultReferenceStatus.message : undefined
    );

    const now = new Date().toISOString();
    const operationId = `operation-image-${Date.now()}`;
    const clientRequestId = `client-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const initialDirectionObjectId = selectedObjects.find((object) => object.type === "conceptDirection")?.id;
    const userMessageId = `ai-user-image-${Date.now()}`;
    const assistantMessageId = `ai-assistant-image-${Date.now()}`;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsAiStreaming(true);
    setImageTaskStatus({ state: "preparing", message: "正在准备本次图像任务的最小参考。" });
    setShowFailure(false);
    setAiDraft("");
    setAiOpen(true);
    setWorkspace((current) => {
      const operationCreated = createImageGenerationOperation(current, {
        operationId,
        clientRequestId,
        prompt: draft,
        selectedObjectIds: context.objectIds,
        imagePixels: false,
        modelId: effectiveImageGenerationSettings.modelId,
        modelLabel: effectiveImageGenerationSettings.modelLabel,
        aspectRatio: effectiveImageGenerationSettings.aspectRatio,
        sizeOption: effectiveImageGenerationSettings.sizeOption,
        referenceObjectIds: context.objectIds,
        directionObjectId: initialDirectionObjectId
      });

      return {
        ...operationCreated.workspace,
        ai: {
          ...operationCreated.workspace.ai,
        messages: [
          ...operationCreated.workspace.ai.messages,
          {
            id: userMessageId,
            role: "user",
            body: draft,
            createdAt: now,
            contextObjectIds: context.objectIds,
            taskMode: "imageGeneration"
          },
          {
            id: assistantMessageId,
            role: "assistant",
            body: "图像任务准备中：会创建新图像对象，不会覆盖来源图、默认参考或交付引用。",
            createdAt: now,
            status: "streaming",
            contextObjectIds: context.objectIds,
            taskMode: "imageGeneration",
            operationId
          }
        ]
      }
      };
    });

    let providerTaskId: string | undefined;

    try {
      const referenceImages = await collectImageReferenceDataUrls(workspace, context.objectIds, controller.signal);
      const sourceObjectIds = referenceImages.sourceObjectIds;
      const directionObjectId = findGenerationDirectionId(workspace, selectedObjects, sourceObjectIds);
      const pixelNote =
        referenceImages.images.length === 0
          ? "本次没有可读取的本地图片像素，仅基于对象标题、摘要和你的描述请求 GrsAI。"
          : `本次会发送 ${referenceImages.images.length} 张明确参考图像。`;

      setWorkspace((current) =>
        updateAiMessage(
          markImageGenerationOperationSubmitted(current, {
            operationId,
            referenceObjectIds: sourceObjectIds,
            imagePixels: referenceImages.images.length > 0
          }),
          assistantMessageId,
          `图像任务提交中：${pixelNote}`,
          "streaming"
        )
      );
      setImageTaskStatus({ state: "submitting", message: "正在提交 GrsAI 图像生成请求。" });

      const responsePromise = fetch("/api/ai/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: effectiveImageGenerationSettings.modelId,
          prompt: draft,
          images: referenceImages.images,
          aspectRatio: effectiveImageGenerationSettings.aspectRatio,
          sizeOption: effectiveImageGenerationSettings.sizeOption,
          referenceObjectIds: sourceObjectIds,
          directionObjectId,
          operationId,
          clientRequestId
        }),
        signal: controller.signal
      });

      setImageTaskStatus({ state: "waiting", message: "GrsAI 正在生成或返回结果。" });
      const response = await responsePromise;
      providerTaskId = response.headers.get("X-Morpho-Provider-Task-Id") || undefined;

      if (!response.ok) {
        const failure = await readErrorResponse(response);
        throw new Error(failure);
      }

      setImageTaskStatus({ state: "downloading", message: "正在保存生成结果到本地资产库。" });
      const mimeType = response.headers.get("Content-Type") ?? "image/png";
      const blob = await response.blob();
      const file = new File([blob], makeGeneratedImageFileName(mimeType), { type: mimeType });
      const saved = await saveBlobAsLocalAsset(indexedDbBlobStore, file, "aiGeneratedImage", {
        readImageDimensions: readImageBlobDimensions
      });
      if (saved.status === "failed") {
        throw new Error(saved.reason);
      }

      const createdObjectId = `image-generated-${saved.asset.id}`;
      setWorkspace((current) => {
        const generated = createGeneratedImageFromAsset(current, {
          asset: saved.asset,
          generation: {
            modelId: effectiveImageGenerationSettings.modelId,
            modelLabel: effectiveImageGenerationSettings.modelLabel,
            aspectRatio: effectiveImageGenerationSettings.aspectRatio,
            sizeOption: effectiveImageGenerationSettings.sizeOption,
            prompt: draft,
            referenceObjectIds: sourceObjectIds,
            directionId: directionObjectId,
            operationId,
            clientRequestId,
            providerTaskId,
            createdAt: new Date().toISOString()
          },
          sourceObjectIds,
          directionObjectId
        });

        const completed = completeImageGenerationOperation(generated.workspace, {
          operationId,
          providerTaskId,
          resultObjectId: generated.createdObjectId
        });

        return updateAiMessage(
          completed,
          assistantMessageId,
          "GrsAI 已返回图像结果。已保存为独立本地资产，并在画布上创建新的图像对象；来源图、版本链、默认参考和交付引用没有被替换。",
          "done"
        );
      });
      setSelectedObjectIds([createdObjectId]);
      setFocusRequest((current) => ({ objectId: createdObjectId, nonce: current.nonce + 1 }));
      setLocalEditObjectId(null);
      setImageTaskStatus({ state: "succeeded", message: "图像结果已保存，并创建为新的画布对象。" });
    } catch (error) {
      const isCancelled = error instanceof DOMException && error.name === "AbortError";
      const message = isCancelled
        ? "图像任务已取消。原输入、来源对象和已有结果已保留。"
        : error instanceof Error
          ? error.message
          : "GrsAI 图像任务失败。";
      setAiDraft(draft);
      setImageTaskStatus({ state: isCancelled ? "cancelled" : "failed", message });
      setWorkspace((current) =>
        updateAiMessage(
          failImageGenerationOperation(current, {
            operationId,
            status: isCancelled ? "cancelled" : error instanceof TypeError ? "interrupted" : "failed",
            reason: message,
            providerTaskId
          }),
          assistantMessageId,
          message,
          "failed"
        )
      );
    } finally {
      abortControllerRef.current = null;
      setIsAiStreaming(false);
    }
  }, [
    aiDraft,
    effectiveImageGenerationSettings,
    isAiStreaming,
    localEditObjectId,
    selectedObjectIds,
    selectedObjects,
    setWorkspace,
    workspace
  ]);

  const handleReferenceIntent = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "image");
    if (!target) {
      return;
    }

    setAiOpen(true);
    setPendingConfirmation({
      kind: "setDefaultReference",
      targetObjectId: target.id,
      targetTitle: target.title
    });
  }, [selectedObjects]);

  const handleConfirmPending = useCallback(() => {
    if (!pendingConfirmation) {
      return;
    }

    if (pendingConfirmation.kind === "setDefaultReference") {
      setWorkspace((current) =>
        setDefaultReference(current, pendingConfirmation.targetObjectId, {
          reason: "用户在默认参考确认卡中明确替换后续默认参考。"
        })
      );
      setPendingConfirmation(null);
      setAiDraft("");
      return;
    }

    if (pendingConfirmation.kind === "applyResearchProposal") {
      const result = applyResearchAnalysisProposal(workspace, pendingConfirmation.proposalId, {
        position: {
          x: workspace.canvas.view.x + 220,
          y: workspace.canvas.view.y + 180
        }
      });

      if (result.status === "updated") {
        setWorkspace(result.workspace);
        setSelectedObjectIds([result.researchObject.id]);
        setFocusRequest((current) => ({ objectId: result.researchObject.id, nonce: current.nonce + 1 }));
      }

      setPendingConfirmation(null);
      setAiDraft("");
      setTaskMode("chatAnalysis");
      return;
    }

    setWorkspace((current) => {
      const result = deleteObject(current, pendingConfirmation.targetObjectId, {
        confirmed: true,
        reason: "用户在确认卡中确认删除该对象。"
      });

      return result.workspace;
    });
    setSelectedObjectIds((current) => current.filter((selectedId) => selectedId !== pendingConfirmation.targetObjectId));
    setLocalEditObjectId((current) => (current === pendingConfirmation.targetObjectId ? null : current));
    setPendingConfirmation(null);
    setAiDraft("");
  }, [pendingConfirmation, setWorkspace, workspace]);

  const handleHideSelected = useCallback(() => {
    if (!selectedObjects[0]) {
      return;
    }

    const objectId = selectedObjects[0].id;
    setWorkspace((current) => hideObject(current, objectId));
    setSelectedObjectIds((current) => current.filter((selectedId) => selectedId !== objectId));
    setLocalEditObjectId((current) => (current === objectId ? null : current));
  }, [selectedObjects, setWorkspace]);

  const handleRestoreObject = useCallback(
    (objectId: string) => {
      setWorkspace((current) => restoreObject(current, objectId));
      setSelectedObjectIds([objectId]);
      setActiveDrawer(null);
      focusObject(objectId);
    },
    [focusObject, setWorkspace]
  );

  const handleDeleteSelected = useCallback(() => {
    if (!selectedObjects[0]) {
      return;
    }

    const objectId = selectedObjects[0].id;
    const result = deleteObject(workspace, objectId);
    setPendingConfirmation({
      kind: "deleteObject",
      targetObjectId: objectId,
      targetTitle: selectedObjects[0].title,
      reasons: result.status === "requiresConfirmation" ? result.reasons : []
    });
  }, [selectedObjects, workspace]);

  const handleEliminateDirection = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }

    setWorkspace((current) =>
      eliminateDirection(current, target.id, {
        reason: "用户在底部详情栏明确淘汰该方向。"
      })
    );
  }, [selectedObjects, setWorkspace]);

  return (
    <main className="workspace">
      <MorphoCanvas
        workspace={workspace}
        annotatedObjectId={localEditObjectId}
        assetUrls={assetUrls}
        focusRequest={focusRequest}
        onSelectionChange={handleSelectionChange}
        onInstancesChange={handleInstancesChange}
        onViewChange={handleCanvasViewChange}
        onImportRequest={handleImportRequest}
      />

      <TopControls
        projectTitle={workspace.project.title}
        onImportFiles={(files) =>
          handleImportRequest({
            files,
            position: {
              x: workspace.canvas.view.x + 160,
              y: workspace.canvas.view.y + 160
            }
          })
        }
        onSearch={() => setActiveDrawer("search")}
        onFocusOverview={() => focusArea("overview")}
      />
      <LeftRail activeDrawer={activeDrawer} onDrawerChange={setActiveDrawer} />
      <OverlayDrawers
        mode={activeDrawer}
        workspace={workspace}
        onClose={() => setActiveDrawer(null)}
        onFocusArea={focusArea}
        onRestoreObject={handleRestoreObject}
        onLocateObject={focusObject}
      />

      <AiConversationPanel
        workspace={workspace}
        selectedObjects={selectedObjects}
        suggestions={suggestions}
        draft={aiDraft}
        isOpen={aiOpen}
        isLocalEditMode={isImageTaskMode}
        taskMode={taskMode}
        recommendedTaskMode={recommendedTaskMode}
        isStreaming={isAiStreaming}
        imageGenerationSettings={effectiveImageGenerationSettings}
        imageGenerationModelOptions={imageGenerationModelOptions}
        pendingConfirmation={pendingConfirmation}
        showFailure={showFailure}
        imageTaskStatus={imageTaskStatus}
        contextWarning={contextWarning}
        migrationError={persistenceState.migrationError}
        onToggleOpen={() => setAiOpen((open) => !open)}
        onDraftChange={setAiDraft}
        onTaskModeChange={setTaskMode}
        onImageGenerationSettingsChange={updateImageGenerationSettings}
        onSuggestionClick={handleSuggestionClick}
        onSendMessage={handleSendAiMessage}
        onCancelRequest={handleCancelAiRequest}
        onRunLocalEdit={handleRunLocalEdit}
        onConfirmPending={handleConfirmPending}
        onCancelPending={() => setPendingConfirmation(null)}
        onFailureRetry={() => setShowFailure(false)}
      />

      <BottomDetailBar
        selectedObjects={selectedObjects}
        relations={workspace.relations}
        decisionRecords={workspace.decisionRecords}
        onAskAi={handleAskAi}
        onLocalEdit={handleLocalEdit}
        onReferenceIntent={handleReferenceIntent}
        onHide={handleHideSelected}
        onDelete={handleDeleteSelected}
        onEliminateDirection={handleEliminateDirection}
      />
    </main>
  );
}

function updateWorkspaceInstances(workspace: MorphoWorkspace, instances: CanvasInstance[]): MorphoWorkspace {
  const updates = new Map(instances.map((instance) => [instance.id, instance]));
  let didChange = false;

  const nextInstances = workspace.canvas.instances.map((instance) => {
    const update = updates.get(instance.id);
    if (!update) {
      return instance;
    }

    const isSame =
      instance.position.x === update.position.x &&
      instance.position.y === update.position.y &&
      instance.size.w === update.size.w &&
      instance.size.h === update.size.h;

    if (isSame) {
      return instance;
    }

    didChange = true;
    return {
      ...instance,
      position: update.position,
      size: update.size
    };
  });

  if (!didChange) {
    return workspace;
  }

  return {
    ...workspace,
    canvas: {
      ...workspace.canvas,
      instances: nextInstances
    }
  };
}

function inferAiContextTask(draft: string, selectedObjects: MorphoObject[]): AiContextTask {
  const text = draft.toLowerCase();

  if (/交付|展板|ppt|作品集|图注|说明/.test(text)) {
    return "deliveryPreparation";
  }

  if (/定义|原则|边界|问题/.test(text) || selectedObjects.some((object) => object.type === "designDefinition")) {
    return "designDefinition";
  }

  if (/调研|研究|资料|限制|发现|约束/.test(text) || selectedObjects.some((object) => object.type === "research" || object.type === "file" || object.type === "link")) {
    return "research";
  }

  return "general";
}

function makeObjectSummaries(workspace: MorphoWorkspace, objectIds: string[]) {
  return objectIds
    .map((objectId) => workspace.objects[objectId])
    .filter((object): object is MorphoObject => Boolean(object))
    .map((object) => ({
      id: object.id,
      type: object.type,
      title: object.title,
      summary: object.summary
    }));
}

function summarizeDefaultReferenceStatus(status: ReturnType<typeof assembleAiContext>["defaultReferenceStatus"]): string {
  switch (status.status) {
    case "available":
      return `available:${status.objectId}`;
    case "hidden":
      return `hidden:${status.objectId}:${status.message}`;
    case "missing":
      return `missing:${status.message}`;
    case "notRelevant":
      return "notRelevant";
  }
}

function updateAiMessage(
  workspace: MorphoWorkspace,
  messageId: string,
  body: string,
  status: "streaming" | "done" | "failed",
  options: { citationIds?: string[] } = {}
): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: workspace.ai.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              body,
              status,
              citationIds: options.citationIds ?? message.citationIds,
              error: status === "failed" ? body : undefined
            }
          : message
      )
    }
  };
}

function storeMessageCitations(
  workspace: MorphoWorkspace,
  input: {
    messageId: string;
    operationId: string;
    citations: ProviderCitation[];
  }
): MorphoWorkspace {
  const now = new Date().toISOString();
  const citationEntries = input.citations.map((citation, index) => {
    const id = getAvailableCitationId(workspace, `${input.messageId}-citation-${index + 1}`);
    return {
      id,
      operationId: input.operationId,
      title: citation.title,
      url: citation.url,
      domain: citation.domain ?? domainFromUrl(citation.url),
      snippet: citation.snippet,
      retrievedAt: now
    };
  });

  return updateAiMessage(
    {
      ...workspace,
      citationSnapshots: {
        ...workspace.citationSnapshots,
        ...Object.fromEntries(citationEntries.map((citation) => [citation.id, citation]))
      }
    },
    input.messageId,
    workspace.ai.messages.find((message) => message.id === input.messageId)?.body ?? "",
    "done",
    {
      citationIds: citationEntries.map((citation) => citation.id)
    }
  );
}

async function readAiEventStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (body: string) => void
): Promise<{ text: string; citations: ProviderCitation[] }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantBody = "";
  const citations: ProviderCitation[] = [];
  let isDone = false;

  while (!isDone) {
    const result = await reader.read();
    isDone = result.done;
    if (result.value) {
      buffer += decoder.decode(result.value, { stream: !isDone });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseAiStreamEvent(line);
        if (!event) {
          continue;
        }

        if (event.type === "delta") {
          assistantBody += event.text;
          onDelta(assistantBody);
        } else if (event.type === "citations") {
          citations.push(...event.citations);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    }
  }

  if (buffer.trim()) {
    const event = parseAiStreamEvent(buffer);
    if (event?.type === "delta") {
      assistantBody += event.text;
      onDelta(assistantBody);
    } else if (event?.type === "citations") {
      citations.push(...event.citations);
    }
  }

  return { text: assistantBody, citations: dedupeCitations(citations) };
}

type AiStreamEvent =
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "citations";
      citations: ProviderCitation[];
    }
  | {
      type: "done";
    }
  | {
      type: "error";
      message: string;
    };

function parseAiStreamEvent(line: string): AiStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      return { type: "delta", text: trimmed };
    }

    if (parsed.type === "delta" && typeof parsed.text === "string") {
      return { type: "delta", text: parsed.text };
    }

    if (parsed.type === "citations" && Array.isArray(parsed.citations)) {
      return {
        type: "citations",
        citations: parsed.citations.filter(isProviderCitation)
      };
    }

    if (parsed.type === "done") {
      return { type: "done" };
    }

    if (parsed.type === "error" && typeof parsed.message === "string") {
      return { type: "error", message: parsed.message };
    }
  } catch {
    return { type: "delta", text: trimmed };
  }

  return null;
}

function isProviderCitation(value: unknown): value is ProviderCitation {
  return isRecord(value) && typeof value.title === "string";
}

function dedupeCitations(citations: ProviderCitation[]): ProviderCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = citation.url ?? `${citation.title}:${citation.snippet ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getAvailableCitationId(workspace: MorphoWorkspace, preferredId: string): string {
  if (!workspace.citationSnapshots[preferredId]) {
    return preferredId;
  }

  let suffix = 2;
  while (workspace.citationSnapshots[`${preferredId}-${suffix}`]) {
    suffix += 1;
  }
  return `${preferredId}-${suffix}`;
}

function domainFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

async function readErrorResponse(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as unknown;
    if (isRecord(payload) && typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    // Fall through to status text.
  }

  return response.statusText || "AI 请求失败。";
}

async function collectImageReferenceDataUrls(
  workspace: MorphoWorkspace,
  objectIds: string[],
  signal: AbortSignal
): Promise<{
  images: string[];
  sourceObjectIds: string[];
  missingPixelObjectIds: string[];
}> {
  const sourceObjectIds: string[] = [];
  const missingPixelObjectIds: string[] = [];
  const images: string[] = [];

  for (const objectId of objectIds) {
    if (signal.aborted || images.length >= 4) {
      break;
    }

    const object = workspace.objects[objectId];
    if (!object || object.type !== "image" || object.visibility !== "active") {
      continue;
    }

    if (!sourceObjectIds.includes(object.id)) {
      sourceObjectIds.push(object.id);
    }

    if (!object.assetId) {
      missingPixelObjectIds.push(object.id);
      continue;
    }

    const asset = workspace.assets[object.assetId];
    if (!asset) {
      missingPixelObjectIds.push(object.id);
      continue;
    }

    const blob = await indexedDbBlobStore.get(asset.storageKey);
    if (!blob) {
      missingPixelObjectIds.push(object.id);
      continue;
    }

    images.push(await blobToDataUrl(blob));
  }

  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  return { images, sourceObjectIds, missingPixelObjectIds };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("图片参考转换失败。"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("图片参考读取失败。"));
    reader.readAsDataURL(blob);
  });
}

function makeGeneratedImageFileName(mimeType: string): string {
  const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  return `grs-result-${Date.now()}.${extension}`;
}

function findGenerationDirectionId(
  workspace: MorphoWorkspace,
  selectedObjects: MorphoObject[],
  sourceObjectIds: string[]
): string | undefined {
  const selectedDirection = selectedObjects.find((object) => object.type === "conceptDirection");
  if (selectedDirection) {
    return selectedDirection.id;
  }

  for (const sourceObjectId of sourceObjectIds) {
    const sourceObject = workspace.objects[sourceObjectId];
    if (sourceObject?.type === "image" && sourceObject.directionId) {
      return sourceObject.directionId;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
