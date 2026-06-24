"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AiContextTask, AssetRecord, MorphoObject } from "@/domain/morpho/types";
import { createGeneratedImageFromAsset } from "@/domain/morpho/generation";
import { importAssetBackedObjects, importTextObject, importUrlObject } from "@/domain/morpho/imports";
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
import { AiConversationPanel } from "./components/AiConversationPanel";
import type { PendingAiConfirmation } from "./components/AiConversationPanel";
import { BottomDetailBar } from "./components/BottomDetailBar";
import { LeftRail, type DrawerMode } from "./components/LeftRail";
import { OverlayDrawers } from "./components/OverlayDrawers";
import { TopControls } from "./components/TopControls";
import { usePersistentWorkspace } from "./usePersistentWorkspace";
import { compactObjectList, getSuggestionsForSelection, type Suggestion } from "./workspaceUi";
import { indexedDbBlobStore, getAssetObjectUrl } from "@/infrastructure/assets/indexedDbAssetStore";
import { saveBlobAsLocalAsset } from "@/infrastructure/assets/localAssetWorkflow";
import { shouldUseGrsImageTask } from "./aiTaskRouting";
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
  const [aiOpen, setAiOpen] = useState(true);
  const [activeDrawer, setActiveDrawer] = useState<DrawerMode>(null);
  const [localEditObjectId, setLocalEditObjectId] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAiConfirmation | null>(null);
  const [showFailure, setShowFailure] = useState(false);
  const [contextWarning, setContextWarning] = useState<string | undefined>();
  const [isAiStreaming, setIsAiStreaming] = useState(false);
  const [imageTaskStatus, setImageTaskStatus] = useState<ImageTaskStatus | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const assetUrlsRef = useRef<Record<string, string>>({});
  const abortControllerRef = useRef<AbortController | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest>({ area: "visual", nonce: 0 });

  const selectedObjects = useMemo(
    () => compactObjectList(workspace.objects, selectedObjectIds),
    [selectedObjectIds, workspace.objects]
  );

  const suggestions = useMemo(() => getSuggestionsForSelection(selectedObjects), [selectedObjects]);
  const isImageTaskMode = useMemo(
    () => Boolean(localEditObjectId) || shouldUseGrsImageTask(aiDraft, selectedObjects.map((object) => object.type)),
    [aiDraft, localEditObjectId, selectedObjects]
  );
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

  const handleImportRequest = useCallback(
    async (request: CanvasImportRequest) => {
      const successfulAssets: AssetRecord[] = [];
      const failureReasons: string[] = [];

      for (const file of request.files ?? []) {
        const sourceType = file.type.startsWith("image/") ? "originalImage" : "originalFile";
        const saved = await saveBlobAsLocalAsset(indexedDbBlobStore, file, sourceType);
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

  const handleSendAiMessage = useCallback(async () => {
    const draft = aiDraft.trim();
    if (!draft || isAiStreaming) {
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
    const objectSummaries = context.objectIds
      .map((objectId) => workspace.objects[objectId])
      .filter((object): object is MorphoObject => Boolean(object))
      .map((object) => ({
        id: object.id,
        type: object.type,
        title: object.title,
        summary: object.summary
      }));
    const controller = new AbortController();
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
          { id: userMessageId, role: "user", body: draft, createdAt: now, contextObjectIds: context.objectIds },
          { id: assistantMessageId, role: "assistant", body: "", createdAt: now, status: "streaming", contextObjectIds: context.objectIds }
        ]
      }
    }));

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          task,
          messages: workspace.ai.messages.map((message) => ({ role: message.role, body: message.body })),
          objectSummaries,
          defaultReferenceStatus: summarizeDefaultReferenceStatus(context.defaultReferenceStatus)
        }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const failure = await readErrorResponse(response);
        throw new Error(failure);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantBody = "";
      let isDone = false;
      while (!isDone) {
        const result = await reader.read();
        isDone = result.done;
        if (result.value) {
          assistantBody += decoder.decode(result.value, { stream: !isDone });
          setWorkspace((current) => updateAiMessage(current, assistantMessageId, assistantBody, "streaming"));
        }
      }

      setWorkspace((current) => updateAiMessage(current, assistantMessageId, assistantBody || "MiMo 没有返回可显示文本。", "done"));
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
  }, [aiDraft, isAiStreaming, selectedObjectIds, selectedObjects, setWorkspace, workspace]);

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
    const userMessageId = `ai-user-image-${Date.now()}`;
    const assistantMessageId = `ai-assistant-image-${Date.now()}`;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsAiStreaming(true);
    setImageTaskStatus({ state: "preparing", message: "正在准备本次图像任务的最小参考。" });
    setShowFailure(false);
    setAiDraft("");
    setAiOpen(true);
    setWorkspace((current) => ({
      ...current,
      ai: {
        ...current.ai,
        messages: [
          ...current.ai.messages,
          { id: userMessageId, role: "user", body: draft, createdAt: now, contextObjectIds: context.objectIds },
          {
            id: assistantMessageId,
            role: "assistant",
            body: "图像任务准备中：会创建新图像对象，不会覆盖来源图、默认参考或交付引用。",
            createdAt: now,
            status: "streaming",
            contextObjectIds: context.objectIds
          }
        ]
      }
    }));

    try {
      const referenceImages = await collectImageReferenceDataUrls(workspace, context.objectIds, controller.signal);
      const sourceObjectIds = referenceImages.sourceObjectIds;
      const directionObjectId = findGenerationDirectionId(workspace, selectedObjects, sourceObjectIds);
      const pixelNote =
        referenceImages.images.length === 0
          ? "本次没有可读取的本地图片像素，仅基于对象标题、摘要和你的描述请求 GrsAI。"
          : `本次会发送 ${referenceImages.images.length} 张明确参考图像。`;

      setWorkspace((current) => updateAiMessage(current, assistantMessageId, `图像任务提交中：${pixelNote}`, "streaming"));
      setImageTaskStatus({ state: "submitting", message: "正在提交 GrsAI 图像生成请求。" });

      const responsePromise = fetch("/api/ai/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: draft,
          images: referenceImages.images,
          aspectRatio: "4:3"
        }),
        signal: controller.signal
      });

      setImageTaskStatus({ state: "waiting", message: "GrsAI 正在生成或返回结果。" });
      const response = await responsePromise;

      if (!response.ok) {
        const failure = await readErrorResponse(response);
        throw new Error(failure);
      }

      setImageTaskStatus({ state: "downloading", message: "正在保存生成结果到本地资产库。" });
      const mimeType = response.headers.get("Content-Type") ?? "image/png";
      const blob = await response.blob();
      const file = new File([blob], makeGeneratedImageFileName(mimeType), { type: mimeType });
      const saved = await saveBlobAsLocalAsset(indexedDbBlobStore, file, "aiGeneratedImage");
      if (saved.status === "failed") {
        throw new Error(saved.reason);
      }

      const createdObjectId = `image-generated-${saved.asset.id}`;
      setWorkspace((current) => {
        const generated = createGeneratedImageFromAsset(current, {
          asset: saved.asset,
          prompt: draft,
          sourceObjectIds,
          directionObjectId
        });

        return updateAiMessage(
          generated.workspace,
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
      setWorkspace((current) => updateAiMessage(current, assistantMessageId, message, "failed"));
    } finally {
      abortControllerRef.current = null;
      setIsAiStreaming(false);
    }
  }, [aiDraft, isAiStreaming, localEditObjectId, selectedObjectIds, selectedObjects, setWorkspace, workspace]);

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
  }, [pendingConfirmation, setWorkspace]);

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
        isStreaming={isAiStreaming}
        pendingConfirmation={pendingConfirmation}
        showFailure={showFailure}
        imageTaskStatus={imageTaskStatus}
        contextWarning={contextWarning}
        migrationError={persistenceState.migrationError}
        onToggleOpen={() => setAiOpen((open) => !open)}
        onDraftChange={setAiDraft}
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

  if (/生成|继续|发展|局部|场景|cmf|角度|细节|参考|图像|图片/.test(text) || selectedObjects.some((object) => object.type === "image")) {
    return "visualDevelopment";
  }

  return "general";
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
  status: "streaming" | "done" | "failed"
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
              error: status === "failed" ? body : undefined
            }
          : message
      )
    }
  };
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
