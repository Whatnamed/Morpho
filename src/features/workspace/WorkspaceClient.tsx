"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AiTaskMode,
  AiWorkIntent,
  AssetRecord,
  ContinuityManualState,
  DeliveryObject,
  ImageRole,
  MorphoObject
} from "@/domain/morpho/types";
import type { GrsImageAspectRatio } from "@/domain/morpho/grsImageModels";
import { GRS_REFERENCE_IMAGE_LIMIT } from "@/domain/morpho/imageLimits";
import { hasPendingDesignDefinitionRevisionProposal } from "@/domain/morpho/derivedState";
import { traceDesignChain, type DesignTraceResult } from "@/domain/morpho/designTrace";
import { createGeneratedImageFromAsset } from "@/domain/morpho/generation";
import { createDocumentExtractFile, parseDocumentFile, shouldAttemptDocumentParse } from "@/domain/morpho/documentParsing";
import { importAssetBackedObjects, importTextObject, importUrlObject } from "@/domain/morpho/imports";
import {
  addDeliveryGap,
  addObjectsToDeliverySection,
  applyDeliverySectionDraft,
  createDeliveryPreparation,
  createDeliverySection,
  createDeliverySectionDraft,
  discardDeliverySectionDraft,
  moveDeliveryReference,
  moveDeliverySection,
  refreshDeliveryReferenceSnapshot,
  removeDeliveryGap,
  removeDeliveryReference,
  removeDeliverySection,
  setDeliveryGapStatus,
  updateDeliveryReferenceEditorial,
  updateDeliverySection
} from "@/domain/morpho/deliveryPreparation";
import {
  parseDeliverySectionDraftPayload,
  sanitizeDeliverySectionDraftStreamForDisplay,
  stripDeliverySectionDraftTechnicalBlocks,
  validateDeliverySectionDraftPayload
} from "@/domain/morpho/deliverySectionDraftBlock";
import {
  applyConceptDirectionProposal,
  applyDesignDefinitionProposal,
  applyResearchAnalysisProposal,
  canStartOperation,
  completeImageGenerationOperation,
  createArtifactProposalOperation,
  createImageGenerationOperation,
  createResearchOperation,
  detectResearchSourceChanges,
  failImageGenerationOperation,
  markImageGenerationOperationSubmitted,
  rejectArtifactProposal,
  recordConceptDirectionProposal,
  recordDesignDefinitionProposal,
  recordImageGenerationPlan,
  recordImageGenerationOperationItemFailure,
  recordImageGenerationOperationResult,
  updateConceptDirectionProposalDraft,
  updateDesignDefinitionProposalDraft,
  updateResearchAnalysisProposalDraft
} from "@/domain/operations/operations";
import type { ArtifactProposal, ConceptDirectionProposal, OperationRecord, VisualGenerationPlanItem } from "@/domain/operations/types";
import { parseConceptDirectionProposalPayload } from "@/domain/operations/conceptDirectionProposal";
import { parseDesignDefinitionProposalPayload } from "@/domain/operations/designDefinitionProposal";
import { parseResearchAnalysisProposalPayload } from "@/domain/operations/researchProposal";
import {
  parseVisualGenerationPlanPayload,
  validateRequestedPreviewCount,
  validateVisualGenerationPlan
} from "@/domain/operations/visualGenerationPlan";
import {
  archiveVisualBranch,
  attachDocumentExtractToFileObject,
  assignImageToVisualBranch,
  buildKeyConclusionDraftFromResearchSource,
  createKeyConclusion,
  createAiDraftFromSuggestion,
  deleteObject,
  clearDefaultReference,
  eliminateDirection,
  createVisualBranch,
  hideObject,
  markFileObjectParseFailed,
  markFileObjectParsing,
  removeImageFromVisualBranch,
  renameVisualBranch,
  restoreObject,
  restoreVisualBranch,
  setConceptDirectionStatus,
  setDefaultReference,
  setKeyConclusionState,
  setImageRole
} from "@/domain/morpho/workspace";
import type { CanvasInstance, MorphoWorkspace } from "@/domain/morpho/types";
import type { ProviderCitation } from "@/server/ai/types";
import { AiConversationPanel } from "./components/AiConversationPanel";
import type { PendingAiConfirmation, PendingComparisonConfirmation } from "./components/AiConversationPanel";
import { BottomDetailBar } from "./components/BottomDetailBar";
import { DeliveryPreparationPanel } from "./components/DeliveryPreparationPanel";
import { DeliveryOutputPanel } from "./components/DeliveryOutputPanel";
import { DocumentReaderPanel, type DocumentReaderExtractFragmentResult } from "./components/DocumentReaderPanel";
import { LeftRail, type DrawerMode } from "./components/LeftRail";
import { OverlayDrawers } from "./components/OverlayDrawers";
import { ProjectBundlePanel } from "./components/ProjectBundlePanel";
import { TopControls } from "./components/TopControls";
import { usePersistentWorkspace } from "./usePersistentWorkspace";
import { useWorkspaceAssetUrls } from "./useWorkspaceAssetUrls";
import { compactObjectList, getSuggestionsForSelection, type Suggestion } from "./workspaceUi";
import { buildDeliverySectionContext, getDeliveryObjects, type DeliveryReferenceReaderTransition } from "./deliveryPreparationUi";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import {
  downloadProjectBundleFile,
  exportEditableProjectBackupBundle,
  exportHumanReadableArchiveBundle,
  inspectEditableProjectBackupBundle,
  type InspectedEditableProjectBackupBundle,
  restoreEditableProjectBackupBundle
} from "@/features/archive/projectBundleClient";
import {
  exportDeliveryOutputPackage,
  inspectDeliveryOutputPackage,
  type InspectDeliveryOutputResult
} from "@/features/delivery-output/deliveryOutputClient";
import { readImageBlobDimensions, saveBlobAsLocalAsset } from "@/infrastructure/assets/localAssetWorkflow";
import {
  expectsConceptDirectionProposal,
  expectsDesignDefinitionProposal,
  getAvailableAiWorkIntents,
  recommendAiTaskMode,
  recommendAiWorkIntent,
  resolveAiContextTask,
  resolveTaskModeForSend,
  resolveWorkIntentForSend
} from "./aiTaskRouting";
import { buildProposalDiscussionDraft, buildProposalRegenerationDraft } from "./proposalFollowupPrompts";
import { buildWebSearchOptions, collectMiMoImageAttachments, shouldAttachImagesForMiMo } from "./aiAttachments";
import { collectDocumentExtractsForAi } from "./documentContext";
import { loadDocumentReaderExtract, shouldAcceptDocumentReaderLoadResult } from "./documentReader";
import {
  buildDocumentFragmentDraft,
  createDocumentFragmentWithContinuity,
  resolveDocumentFragmentLocation,
  resolveDocumentFragmentSelection
} from "./documentFragments";
import { resolveComparisonWritebackSourceObjectIds } from "./comparisonDecision";
import {
  validateComparisonActionTarget,
  validateComparisonKeyConclusionSources,
  type ComparisonActionKind
} from "./comparisonAction";
import {
  buildProviderComparisonBackgroundContext,
  buildProviderTaskContext,
  buildTaskContext,
  taskContextKindFromAiTask,
  type TaskContextDefaultReference
} from "./taskContext";
import { setConversationSemanticEntryManualState } from "@/domain/morpho/projectContinuity";
import {
  applyConversationCheckpoint,
  buildConversationContextForRequest,
  buildConversationLaneKey,
  parseConversationCheckpointPayload,
  resolveConversationLaneAnchors,
  sanitizeConversationAssistantStreamForDisplay,
  stripAssistantTechnicalBlocks
} from "@/domain/morpho/conversationCheckpoint";
import {
  applyComparisonAnalysis,
  resolveStoredComparisonSourceRefs,
  buildComparisonAuthorization,
  parseComparisonAnalysisPayload,
  sanitizeComparisonAssistantStreamForDisplay,
  stripComparisonAnalysisBlock,
  validateComparisonAnalysis
} from "@/domain/morpho/comparisonAnalysis";
import type { ComparisonDecisionMetadata } from "@/domain/morpho/types";
import { applyConversationSemanticPatchFromReply } from "./workspaceSemanticPatch";
import { buildSameReplyStructuredWritePolicy, prepareAiSendBeforeProvider } from "./aiSendGuards";
import { applyResearchProposalWithSemanticPatch } from "./researchSemanticPatch";
import { planDirectionPreviewPlacements } from "./visualPreviewLayout";
import {
  classifyVisualGenerationIntent,
  resolveVisualGenerationTarget,
  type VisualGenerationIntent
} from "./visualGenerationRouting";
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

type DocumentReaderUiState = {
  fileObjectId: string;
  requestId: number;
  status: "loading" | "loaded" | "blocked" | "error";
  text: string;
  message?: string;
  extractAsset?: AssetRecord;
  createdFragmentId?: string;
  initialLocation?: {
    startOffset: number;
    endOffset: number;
    label: string;
  } | null;
};

export function WorkspaceClient({ projectId }: WorkspaceClientProps) {
  const router = useRouter();
  const [workspace, setWorkspace, persistenceState] = usePersistentWorkspace(projectId);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>(() => workspace.ui.lastSelectionIds);
  const [aiDraft, setAiDraft] = useState("");
  const [taskMode, setTaskMode] = useState<AiTaskMode>("chatAnalysis");
  const [workIntent, setWorkIntent] = useState<AiWorkIntent>(() => workspace.ui.workIntent);
  const [aiOpen, setAiOpen] = useState(true);
  const [activeDrawer, setActiveDrawer] = useState<DrawerMode>(null);
  const [highlightContinuityEntryIds, setHighlightContinuityEntryIds] = useState<string[]>([]);
  const [localEditObjectId, setLocalEditObjectId] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAiConfirmation | null>(null);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [traceStartObjectId, setTraceStartObjectId] = useState<string | null>(null);
  const [showFailure, setShowFailure] = useState(false);
  const [contextWarning, setContextWarning] = useState<string | undefined>();
  const [isAiStreaming, setIsAiStreaming] = useState(false);
  const [imageTaskStatus, setImageTaskStatus] = useState<ImageTaskStatus | null>(null);
  const [imageGenerationSettings, setImageGenerationSettings] = useState<ImageGenerationSettings>(() =>
    getDefaultImageGenerationSettings()
  );
  const [directionPreviewCount, setDirectionPreviewCount] = useState<1 | 2 | 4 | 6>(2);
  const [imageGenerationAspectMode, setImageGenerationAspectMode] = useState<"auto" | "manual">("auto");
  const [deliveryPanelOpen, setDeliveryPanelOpen] = useState(false);
  const [activeDeliveryObjectId, setActiveDeliveryObjectId] = useState<string | null>(null);
  const [activeDeliverySectionId, setActiveDeliverySectionId] = useState<string | null>(null);
  const [pendingDeliveryDraftTarget, setPendingDeliveryDraftTarget] = useState<{ deliveryObjectId: string; sectionId: string } | null>(null);
  const assetUrls = useWorkspaceAssetUrls(workspace.assets);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest>({ area: "visual", nonce: 0 });
  const [documentReader, setDocumentReader] = useState<DocumentReaderUiState | null>(null);
  const [bundlePanelOpen, setBundlePanelOpen] = useState(false);
  const [archiveIncludeFullChat, setArchiveIncludeFullChat] = useState(false);
  const [archiveIncludeContinuity, setArchiveIncludeContinuity] = useState(false);
  const [backupIncludeFullChat, setBackupIncludeFullChat] = useState(false);
  const [bundleBusyLabel, setBundleBusyLabel] = useState<string | null>(null);
  const [bundleMessage, setBundleMessage] = useState<{
    tone: "neutral" | "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [inspectedBackup, setInspectedBackup] = useState<InspectedEditableProjectBackupBundle | null>(null);
  const [deliveryOutputPanelOpen, setDeliveryOutputPanelOpen] = useState(false);
  const [deliveryOutputBusyLabel, setDeliveryOutputBusyLabel] = useState<string | null>(null);
  const [deliveryOutputMessage, setDeliveryOutputMessage] = useState<{
    tone: "neutral" | "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [deliveryOutputPreflight, setDeliveryOutputPreflight] = useState<InspectDeliveryOutputResult | null>(null);
  const deliveryOutputInspectRequestRef = useRef(0);
  const documentReaderRequestRef = useRef(0);
  const documentReaderAbortRef = useRef<AbortController | null>(null);

  const selectedObjects = useMemo(
    () => compactObjectList(workspace.objects, selectedObjectIds),
    [selectedObjectIds, workspace.objects]
  );
  const keyConclusionCandidates = useMemo(
    () =>
      Object.values(workspace.objects).filter(
        (object): object is Extract<MorphoObject, { type: "keyConclusion" }> =>
          object.type === "keyConclusion" && object.visibility === "active"
      ),
    [workspace.objects]
  );
  const hasPendingDesignDefinitionRevisionDraft = useMemo(
    () =>
      selectedObjects.length === 1 &&
      selectedObjects[0].type === "designDefinition" &&
      hasPendingDesignDefinitionRevisionProposal(workspace, selectedObjects[0].id),
    [selectedObjects, workspace]
  );

  const suggestions = useMemo(
    () =>
      getSuggestionsForSelection(selectedObjects, {
        hasCurrentDesignDefinition: Boolean(workspace.workingState.currentDesignDefinitionId)
      }),
    [selectedObjects, workspace.workingState.currentDesignDefinitionId]
  );
  const recommendedTaskMode = useMemo(
    () => recommendAiTaskMode(aiDraft, selectedObjects.map((object) => object.type)),
    [aiDraft, selectedObjects]
  );
  const recommendedWorkIntent = useMemo(
    () =>
      recommendAiWorkIntent({
        draft: aiDraft,
        selectedObjects,
        hasCurrentDesignDefinition: Boolean(workspace.workingState.currentDesignDefinitionId)
      }),
    [aiDraft, selectedObjects, workspace.workingState.currentDesignDefinitionId]
  );
  const availableWorkIntents = useMemo(
    () =>
      getAvailableAiWorkIntents({
        taskMode,
        selectedObjects,
        hasCurrentDesignDefinition: Boolean(workspace.workingState.currentDesignDefinitionId)
      }),
    [selectedObjects, taskMode, workspace.workingState.currentDesignDefinitionId]
  );
  const activeProposal = useMemo(() => {
    const selectedProposal =
      activeProposalId && workspace.artifactProposals[activeProposalId]?.status === "pending"
        ? workspace.artifactProposals[activeProposalId]
        : undefined;
    if (selectedProposal) {
      return selectedProposal;
    }

    return Object.values(workspace.artifactProposals)
      .filter((proposal) => proposal.status === "pending")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }, [activeProposalId, workspace.artifactProposals]);
  const deliveryObjects = useMemo(() => getDeliveryObjects(workspace), [workspace]);
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

  useEffect(() => {
    setWorkIntent(workspace.ui.workIntent);
  }, [workspace.ui.workIntent]);

  useEffect(() => {
    if (!activeDeliveryObjectId && deliveryObjects[0]) {
      setActiveDeliveryObjectId(deliveryObjects[0].id);
      return;
    }
    if (activeDeliveryObjectId && !deliveryObjects.some((delivery) => delivery.id === activeDeliveryObjectId)) {
      setActiveDeliveryObjectId(deliveryObjects[0]?.id ?? null);
    }
  }, [activeDeliveryObjectId, deliveryObjects]);

  useEffect(() => {
    const persistedSelection = workspace.ui.lastSelectionIds;
    setSelectedObjectIds((current) =>
      current.join("|") === persistedSelection.join("|") ? current : [...persistedSelection]
    );
  }, [workspace.ui.lastSelectionIds]);

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

  const handleWorkIntentChange = useCallback(
    (nextWorkIntent: AiWorkIntent) => {
      setWorkIntent(nextWorkIntent);
      setWorkspace((current) => {
        if (current.ui.workIntent === nextWorkIntent) {
          return current;
        }

        return {
          ...current,
          ui: {
            ...current.ui,
            workIntent: nextWorkIntent
          }
        };
      });
    },
    [setWorkspace]
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

  const openProjectRecords = useCallback((entryIds: string[] = []) => {
    setHighlightContinuityEntryIds(entryIds);
    setActiveDrawer("records");
  }, []);

  const handleSetContinuityEntryManualState = useCallback(
    (entryId: string, manualState: ContinuityManualState) => {
      setWorkspace((current) => setConversationSemanticEntryManualState(current, entryId, manualState));
      setHighlightContinuityEntryIds([entryId]);
      setActiveDrawer("records");
    },
    [setWorkspace]
  );

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
      const successfulAssetFiles: Array<{ asset: AssetRecord; file: File }> = [];
      const failureReasons: string[] = [];

      for (const file of request.files ?? []) {
        const sourceType = file.type.startsWith("image/") ? "originalImage" : "originalFile";
        const saved = await saveBlobAsLocalAsset(indexedDbBlobStore, file, sourceType, {
          readImageDimensions: readImageBlobDimensions
        });
        if (saved.status === "ok") {
          successfulAssets.push(saved.asset);
          successfulAssetFiles.push({ asset: saved.asset, file });
        } else {
          failureReasons.push(`${file.name}: ${saved.reason}`);
        }
      }

      let nextSelection: string[] = [];
      let parseTargets: Array<{ objectId: string; file: File }> = [];
      setWorkspace((current) => {
        let next = current;

        if (successfulAssets.length > 0) {
          const imported = importAssetBackedObjects(next, {
            assets: successfulAssets,
            position: request.position
          });
          next = imported.workspace;
          nextSelection = imported.objectIds;
          const fileByAssetId = new Map(successfulAssetFiles.map((entry) => [entry.asset.id, entry.file]));
          parseTargets = imported.objectIds
            .map((objectId) => next.objects[objectId])
            .filter((object) => object?.type === "file")
            .map((object) => ({
              objectId: object.id,
              file: object.assetId ? fileByAssetId.get(object.assetId) : undefined
            }))
            .filter((target): target is { objectId: string; file: File } => Boolean(target.file));
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

      if (parseTargets.length > 0) {
        void parseImportedDocuments(parseTargets, setWorkspace);
      }
    },
    [setWorkspace]
  );
  const activeDesignTrace = useMemo<DesignTraceResult | null>(() => {
    if (!traceStartObjectId || !workspace.objects[traceStartObjectId]) {
      return null;
    }

    return traceDesignChain(workspace, traceStartObjectId);
  }, [traceStartObjectId, workspace]);

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

      const context = buildTaskContext(workspace, {
        kind: "research",
        draft,
        selectedObjectIds
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
      const objectSummaries = makeTaskObjectSummaries(context.semanticSummaries);

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
          ? await collectMiMoImageAttachments(workspace, context.imageObjectIds, controller.signal)
          : { attachments: [], skippedObjectIds: [], warning: undefined };
        const documentResult = await collectDocumentExtractsForAi(
          workspace,
          context.documentObjectIds,
          indexedDbBlobStore,
          controller.signal
        );
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
            documentExtracts: documentResult.extracts,
            webSearch,
            defaultReferenceStatus: summarizeTaskDefaultReferenceStatus(context.defaultReference),
            taskContext: buildProviderTaskContext(context)
          }),
          signal: controller.signal
        });

        if (!response.ok || !response.body) {
          const failure = await readErrorResponse(response);
          throw new Error(failure);
        }

        const streamResult = await readAiEventStream(response.body, (assistantBody) => {
          setWorkspace((current) => updateAiMessage(current, assistantMessageId, sanitizeConversationAssistantStreamForDisplay(assistantBody), "streaming"));
        });
        const visibleResearchText = stripAssistantTechnicalBlocks(streamResult.text);
        const assistantBody = [attachmentResult.warning, documentResult.warning, visibleResearchText]
          .filter(Boolean)
          .join("\n\n");

        const parsedProposal = parseResearchAnalysisProposalPayload(streamResult.text);
        if (parsedProposal.status === "failed") {
          const fallbackBody = [
            assistantBody || "MiMo 没有返回可显示文本。",
            "本次研究结果未能整理为可保存草案；你可以继续追问、补充要求或重试研究任务。"
          ].join("\n\n");
          setWorkspace((current) => {
            const withMessage = updateAiMessage(current, assistantMessageId, fallbackBody, "done");
            const withCitations = streamResult.citations.length > 0
              ? storeMessageCitations(withMessage, {
                  messageId: assistantMessageId,
                  operationId,
                  citations: streamResult.citations
                })
              : withMessage;
            const semanticPatchResult = applyConversationSemanticPatchFromReply({
              workspace: withCitations,
              taskMode: "researchOperation",
              context,
              draft,
              userMessageId,
              userMessageCreatedAt: now,
              assistantText: streamResult.text
            });
            return semanticPatchResult.status === "applied"
              ? updateAiMessage(semanticPatchResult.workspace, assistantMessageId, fallbackBody, "done", {
                  continuityEntryIds: semanticPatchResult.entryIds
                })
              : withCitations;
          });
          return;
        }

        const proposalId = `proposal-research-${operationId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        let appliedResearchObjectId: string | undefined;
        setWorkspace((current) => {
          const result = applyResearchProposalWithSemanticPatch({
            workspace: updateAiMessage(current, assistantMessageId, assistantBody || "MiMo 没有返回可显示文本。", "done"),
            proposal: {
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
            },
            position: getPlacementNearObjects(current, context.objectIds, {
              x: current.canvas.view.x + 220,
              y: current.canvas.view.y + 180
            }),
            context,
            draft,
            userMessageId,
            userMessageCreatedAt: now,
            assistantText: streamResult.text
          });

          if (result.status === "updated") {
            const researchObject = result.workspace.objects[result.researchObjectId];
            appliedResearchObjectId = result.researchObjectId;
            return updateAiMessage(
              result.workspace,
              assistantMessageId,
              [
                assistantBody || "MiMo 没有返回可显示文本。",
                `已识别为：研究任务。已自动创建研究卡「${researchObject?.title ?? "研究卡"}」，来源对象 ${
                  context.objectIds.length
                } 个，${webSearch ? "已允许联网补充" : "未启用联网搜索"}。`
              ].join("\n\n"),
              "done",
              {
                citationIds: result.proposalCitationIds,
                continuityEntryIds: result.semanticPatch.status === "applied" ? result.semanticPatch.entryIds : undefined
              }
            );
          }

          return updateAiMessage(
            result.workspace,
            assistantMessageId,
            [assistantBody || "MiMo 没有返回可显示文本。", `${result.reason} 研究卡未自动创建。`].join("\n\n"),
            "failed",
            {
              citationIds: result.proposalCitationIds,
              continuityEntryIds: result.semanticPatch.status === "applied" ? result.semanticPatch.entryIds : undefined
            }
          );
        });
        if (appliedResearchObjectId) {
          setSelectedObjectIds([appliedResearchObjectId]);
          setFocusRequest((current) => ({ objectId: appliedResearchObjectId, nonce: current.nonce + 1 }));
        }
        setActiveProposalId(null);
        setPendingConfirmation(null);
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

  const handleRunVisualGenerationOperation = useCallback(
    async (draft: string) => {
      const intent = classifyVisualGenerationIntent(draft, selectedObjects);
      if (!intent) {
        setAiDraft(draft);
        setImageTaskStatus({
          state: "failed",
          message: "没有识别到明确的方向预览或图片视觉迭代目标。请先选择 1-3 个方向，或选择要继续发展的图片。"
        });
        setWorkspace((current) =>
          appendAiAssistantFailureMessage(
            current,
            "image-generation-intent-blocked",
            "已识别到图像生成措辞，但缺少明确目标：请选择 1-3 个概念方向生成首张预览，或选择图片做视觉迭代。",
            undefined
          )
        );
        return;
      }

      const operationGate = canStartOperation(workspace);
      if (operationGate.status === "blocked") {
        setAiDraft(draft);
        setImageTaskStatus({ state: "failed", message: operationGate.reason });
        setWorkspace((current) => appendOperationBlockedMessage(current, operationGate.operation, operationGate.reason));
        return;
      }

      const selectedDirectionIds = selectedObjects
        .filter((object) => object.type === "conceptDirection")
        .map((object) => object.id);
      const selectedImageIds = selectedObjects.filter((object) => object.type === "image").map((object) => object.id);
      if (intent === "directionPreview" && (selectedDirectionIds.length === 0 || selectedDirectionIds.length > 3)) {
        const message = "方向预览首版一次只支持选择 1-3 个概念方向。";
        setAiDraft(draft);
        setImageTaskStatus({ state: "failed", message });
        setWorkspace((current) => appendAiAssistantFailureMessage(current, "direction-preview-blocked", message, undefined));
        return;
      }
      const requestedPreviewCount = intent === "directionPreview" ? directionPreviewCount : 1;
      if (intent === "directionPreview") {
        const countValidation = validateRequestedPreviewCount(selectedDirectionIds.length, requestedPreviewCount);
        if (countValidation.status === "blocked") {
          setAiDraft(draft);
          setImageTaskStatus({ state: "failed", message: countValidation.reason });
          setWorkspace((current) => appendAiAssistantFailureMessage(current, "direction-preview-count-blocked", countValidation.reason, undefined));
          return;
        }
      }

      const initialVisualTarget =
        intent === "visualDevelopment"
          ? resolveVisualGenerationTarget(workspace, selectedObjects, selectedObjectIds)
          : { status: "ready" as const };
      if (initialVisualTarget.status === "blocked") {
        setContextWarning(initialVisualTarget.reason);
        setImageTaskStatus({ state: "failed", message: initialVisualTarget.reason });
        return;
      }

      const context = buildTaskContext(workspace, {
        kind: intent,
        draft,
        selectedObjectIds,
        targetDirectionIds: selectedDirectionIds.length > 0 ? selectedDirectionIds : initialVisualTarget.directionId ? [initialVisualTarget.directionId] : [],
        visualBranchId: initialVisualTarget.visualBranchId
      });
      const operationId = `operation-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const clientRequestId = `client-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const userMessageId = `ai-user-image-${Date.now()}`;
      const assistantMessageId = `ai-assistant-image-${Date.now()}`;
      const controller = new AbortController();
      const objectSummaries = makeTaskObjectSummaries(context.semanticSummaries);
      abortControllerRef.current = controller;
      setIsAiStreaming(true);
      setAiDraft("");
      setAiOpen(true);
      setShowFailure(false);
      setImageTaskStatus({
        state: "preparing",
        message:
          intent === "directionPreview"
            ? `正在整理本次 Context：${selectedDirectionIds.length} 个方向 × 每方向 ${requestedPreviewCount} 张 = 总计 ${selectedDirectionIds.length * requestedPreviewCount} 张。`
            : "正在整理本次 Context：将纳入已选图片、方向、分支和必要资料。"
      });
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
          directionObjectId: initialVisualTarget.directionId,
          visualBranchId: initialVisualTarget.visualBranchId,
          requestedPreviewCount: intent === "directionPreview" ? requestedPreviewCount : undefined
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
                body:
                  intent === "directionPreview"
                    ? `正在整理本次 Context：目标 ${selectedDirectionIds.length} 个方向，每方向 ${requestedPreviewCount} 张，总计 ${selectedDirectionIds.length * requestedPreviewCount} 张；不会覆盖已有图片。`
                    : "正在整理本次 Context：会创建新图像对象，不覆盖来源图、默认参考或交付引用。",
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

      const createdObjectIds: string[] = [];
      const failedItems: string[] = [];
      let lastProviderTaskId: string | undefined;

      try {
        const attachmentResult = await collectMiMoImageAttachments(workspace, context.imageObjectIds, controller.signal);
        const documentResult = await collectDocumentExtractsForAi(
          workspace,
          context.documentObjectIds,
          indexedDbBlobStore,
          controller.signal
        );
        const contextWarnings = [
          context.skipped.length > 0 ? `${context.skipped.length} 个对象未进入本次 Context。` : "",
          attachmentResult.warning,
          documentResult.warning
        ].filter(Boolean);
        setContextWarning(contextWarnings.join(" ") || undefined);
        setImageTaskStatus({
          state: "preparing",
          message: "正在分析视觉目标：MiMo 将只看到本次已授权的图片、文档提取和对象摘要。"
        });
        const planResponse = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draft,
            task: intent,
            taskMode: "imageGeneration",
            workIntent: "discussion",
            messages: workspace.ai.messages.map((message) => ({ role: message.role, body: message.body })),
            objectSummaries,
            attachments: attachmentResult.attachments,
            documentExtracts: documentResult.extracts,
            defaultReferenceStatus: summarizeTaskDefaultReferenceStatus(context.defaultReference),
            taskContext: buildProviderTaskContext(context)
          }),
          signal: controller.signal
        });

        if (!planResponse.ok || !planResponse.body) {
          const failure = await readErrorResponse(planResponse);
          throw new Error(failure);
        }

        const planStream = await readAiEventStream(planResponse.body, (assistantBody) => {
          setWorkspace((current) => updateAiMessage(current, assistantMessageId, sanitizeConversationAssistantStreamForDisplay(assistantBody), "streaming"));
        });
        const parsedPlan = parseVisualGenerationPlanPayload(planStream.text);
        if (parsedPlan.status === "failed") {
          throw new Error(parsedPlan.reason);
        }
        if (parsedPlan.plan.kind !== intent) {
          throw new Error("MiMo 返回的视觉计划类型与当前识别任务不一致。");
        }

        const validatedPlan = validateVisualGenerationPlan(workspace, {
          plan: parsedPlan.plan,
          allowedObjectIds: context.objectIds,
          selectedDirectionIds,
          selectedImageIds,
          requestedPreviewCount
        });
        if (validatedPlan.status === "blocked") {
          throw new Error(validatedPlan.reason);
        }
        const directionPreviewPlacementMap =
          intent === "directionPreview"
            ? new Map(
                planDirectionPreviewPlacements(
                  workspace,
                  validatedPlan.plan.items.map((planItem) => ({
                    id: planItem.id,
                    targetDirectionId: planItem.targetDirectionId,
                    width: 320,
                    height: 240
                  }))
                ).map((placement) => [placement.planItemId, placement.position] as const)
              )
            : new Map<string, { x: number; y: number }>();

        setWorkspace((current) =>
          updateAiMessage(
            recordImageGenerationPlan(current, {
              operationId,
              plan: validatedPlan.plan
            }),
            assistantMessageId,
            `已形成生成计划：${validatedPlan.plan.items.length} 项。接下来将顺序生成，当前模型 ${effectiveImageGenerationSettings.modelLabel}，不会覆盖来源图。`,
            "streaming"
          )
        );

        for (const [index, item] of validatedPlan.plan.items.entries()) {
          try {
            setImageTaskStatus({
              state: "submitting",
              message: `正在生成第 ${index + 1} / ${validatedPlan.plan.items.length} 张：${item.title}`
            });
            setWorkspace((current) =>
              updateAiMessage(
                current,
                assistantMessageId,
                `生成 ${index + 1}/${validatedPlan.plan.items.length}：${item.title}`,
                "streaming"
              )
            );

            const referenceImages = await collectImageReferenceDataUrls(workspace, item.referenceObjectIds, controller.signal);
            setWorkspace((current) =>
              markImageGenerationOperationSubmitted(current, {
                operationId,
                referenceObjectIds: item.referenceObjectIds,
                imagePixels: referenceImages.images.length > 0
              })
            );

            const imageResponse = await fetch("/api/ai/image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                modelId: effectiveImageGenerationSettings.modelId,
                prompt: item.prompt,
                images: referenceImages.images,
                aspectRatio: effectiveImageGenerationSettings.aspectRatio,
                sizeOption: effectiveImageGenerationSettings.sizeOption,
                referenceObjectIds: item.referenceObjectIds,
                directionObjectId: item.targetDirectionId,
                visualBranchId: item.visualBranchId,
                operationId,
                clientRequestId
              }),
              signal: controller.signal
            });
            lastProviderTaskId = imageResponse.headers.get("X-Morpho-Provider-Task-Id") || lastProviderTaskId;

            if (!imageResponse.ok) {
              const failure = await readErrorResponse(imageResponse);
              throw new Error(failure);
            }

            setImageTaskStatus({
              state: "downloading",
              message: `正在保存结果：${index + 1}/${validatedPlan.plan.items.length} ${item.title}`
            });
            const mimeType = imageResponse.headers.get("Content-Type") ?? "image/png";
            const blob = await imageResponse.blob();
            const file = new File([blob], makeGeneratedImageFileName(mimeType), { type: mimeType });
            const saved = await saveBlobAsLocalAsset(indexedDbBlobStore, file, "aiGeneratedImage", {
              readImageDimensions: readImageBlobDimensions
            });
            if (saved.status === "failed") {
              throw new Error(saved.reason);
            }

            let createdObjectId = "";
            setWorkspace((current) => {
              const generated = createGeneratedImageFromAsset(current, {
                asset: saved.asset,
                generation: {
                  modelId: effectiveImageGenerationSettings.modelId,
                  modelLabel: effectiveImageGenerationSettings.modelLabel,
                  aspectRatio: effectiveImageGenerationSettings.aspectRatio,
                  sizeOption: effectiveImageGenerationSettings.sizeOption,
                  prompt: item.prompt,
                  referenceObjectIds: item.referenceObjectIds,
                  directionId: item.targetDirectionId,
                  visualBranchId: item.visualBranchId,
                  operationId,
                  clientRequestId,
                  providerTaskId: lastProviderTaskId,
                  title: item.title,
                  purpose: item.purpose,
                  role: item.role,
                  visualPlan: validatedPlan.plan,
                  createdAt: new Date().toISOString()
                },
                sourceObjectIds: referenceImages.sourceObjectIds,
                directionObjectId: item.targetDirectionId,
                visualBranchId: item.visualBranchId,
                title: item.title,
                summary: item.purpose,
                role: item.role,
                position: getGeneratedImagePlacement(current, validatedPlan.plan.items, item, index, directionPreviewPlacementMap.get(item.id))
              });
              createdObjectId = generated.createdObjectId;
              return recordImageGenerationOperationResult(generated.workspace, {
                operationId,
                providerTaskId: lastProviderTaskId,
                resultObjectId: generated.createdObjectId
              });
            });
            if (createdObjectId) {
              createdObjectIds.push(createdObjectId);
            }
          } catch (itemError) {
            const itemMessage = itemError instanceof Error ? itemError.message : "图像计划项生成失败。";
            failedItems.push(`${item.title}: ${itemMessage}`);
            setWorkspace((current) =>
              recordImageGenerationOperationItemFailure(current, {
                operationId,
                planItemId: item.id,
                reason: itemMessage
              })
            );
          }
        }

        if (createdObjectIds.length === 0) {
          throw new Error(failedItems[0] ?? "所有图像计划项都生成失败。");
        }

        const lastCreatedObjectId = createdObjectIds.at(-1) ?? createdObjectIds[0];
        setWorkspace((current) =>
          updateAiMessage(
            completeImageGenerationOperation(current, {
              operationId,
              providerTaskId: lastProviderTaskId,
              resultObjectId: lastCreatedObjectId
            }),
            assistantMessageId,
            [
              `图像任务完成：成功 ${createdObjectIds.length} 张，失败 ${failedItems.length} 项。`,
              intent === "directionPreview"
                ? "每张首版预览已绑定对应方向，角色为概念图；没有自动设置主方向或默认参考。"
                : "新图已写入来源、版本、方向和视觉分支关系；来源图没有被覆盖。",
              failedItems.length > 0 ? `失败项：${failedItems.join("；")}` : ""
            ]
              .filter(Boolean)
              .join("\n\n"),
            "done"
          )
        );
        setSelectedObjectIds(createdObjectIds);
        setFocusRequest((current) => ({ objectId: lastCreatedObjectId, nonce: current.nonce + 1 }));
        setImageTaskStatus({
          state: "succeeded",
          message: failedItems.length > 0 ? `部分完成：已保存 ${createdObjectIds.length} 张，失败 ${failedItems.length} 项。` : `已完成：已保存 ${createdObjectIds.length} 张新图像。`
        });
      } catch (error) {
        const isCancelled = error instanceof DOMException && error.name === "AbortError";
        const message = isCancelled
          ? "图像任务已取消。原输入、来源对象和已有结果已保留。"
          : error instanceof Error
            ? error.message
            : "图像任务失败。";
        setAiDraft(draft);
        setImageTaskStatus({ state: isCancelled ? "cancelled" : "failed", message });
        setWorkspace((current) =>
          updateAiMessage(
            failImageGenerationOperation(current, {
              operationId,
              status: isCancelled ? "cancelled" : "failed",
              reason: message,
              providerTaskId: lastProviderTaskId
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
    },
    [
      effectiveImageGenerationSettings,
      directionPreviewCount,
      selectedObjectIds,
      selectedObjects,
      setWorkspace,
      workspace
    ]
  );

  const handleSendAiMessage = useCallback(async () => {
    const draft = aiDraft.trim();
    if (!draft || isAiStreaming) {
      return;
    }

    const executionTaskMode = resolveTaskModeForSend({ currentTaskMode: taskMode, recommendedTaskMode });
    const executionWorkIntent = resolveWorkIntentForSend({
      currentWorkIntent: executionTaskMode === "chatAnalysis" ? workIntent : "discussion",
      recommendedWorkIntent
    });
    if (executionTaskMode === "researchOperation") {
      await handleRunResearchOperation(draft);
      return;
    }

    if (executionTaskMode === "imageGeneration") {
      await handleRunVisualGenerationOperation(draft);
      return;
    }

    const preflight = prepareAiSendBeforeProvider({
      workspace,
      selectedObjectIds,
      executionWorkIntent,
      draft
    });
    if (preflight.status === "blocked") {
      setAiOpen(preflight.aiOpen);
      setContextWarning(preflight.contextWarning);
      setAiDraft(preflight.aiDraft);
      return;
    }

    const isDeliverySectionPreparation = executionWorkIntent === "prepareDeliverySection";
    const task = resolveAiContextTask(executionTaskMode, executionWorkIntent);
    const context = buildTaskContext(workspace, {
      kind: taskContextKindFromAiTask(task),
      draft,
      selectedObjectIds: isDeliverySectionPreparation ? [] : selectedObjectIds
    });
    const deliveryDraftTarget = isDeliverySectionPreparation ? pendingDeliveryDraftTarget : null;
    const deliveryCandidate = deliveryDraftTarget ? workspace.objects[deliveryDraftTarget.deliveryObjectId] : undefined;
    const deliveryObject: DeliveryObject | undefined = deliveryCandidate?.type === "delivery" ? deliveryCandidate : undefined;
    const deliverySectionContext =
      deliveryObject && deliveryDraftTarget
        ? buildDeliverySectionContext(workspace, deliveryObject, deliveryDraftTarget.sectionId)
        : undefined;
    if (isDeliverySectionPreparation && !deliverySectionContext) {
      setAiDraft(draft);
      setContextWarning("请先选择一个至少包含一项交付引用的章节，再生成本节说明草稿。");
      setPendingDeliveryDraftTarget(null);
      return;
    }
    const shouldCreateSemanticOperation =
      expectsDesignDefinitionProposal(executionWorkIntent) || expectsConceptDirectionProposal(executionWorkIntent);
    const semanticOperationGate = shouldCreateSemanticOperation ? canStartOperation(workspace) : { status: "ok" as const };
    if (semanticOperationGate.status === "blocked") {
      setAiDraft(draft);
      setWorkspace((current) => appendOperationBlockedMessage(current, semanticOperationGate.operation, semanticOperationGate.reason));
      return;
    }
    const semanticOperationId = shouldCreateSemanticOperation
      ? `operation-${task}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      : undefined;
    const semanticOperationCreated =
      semanticOperationId && (task === "designDefinition" || task === "conceptDirection")
        ? createArtifactProposalOperation(workspace, {
            operationId: semanticOperationId,
            type: task,
            userInput: draft,
            selectedObjectIds: context.objectIds,
            workIntent: executionWorkIntent
          })
        : undefined;
    setContextWarning(context.defaultReference.status === "hidden" ? context.defaultReference.reason : undefined);

    const now = new Date().toISOString();
    const userMessageId = `ai-user-${Date.now()}`;
    const assistantMessageId = `ai-assistant-${Date.now()}`;
    const conversationLaneAnchors = resolveConversationLaneAnchors(workspace, isDeliverySectionPreparation ? [] : selectedObjectIds);
    const conversationLaneKey = buildConversationLaneKey({
      currentFocus: workspace.projectContinuity.currentFocus,
      taskKind: context.kind,
      anchorObjectIds: conversationLaneAnchors.anchorObjectIds,
      targetDirectionIds: conversationLaneAnchors.targetDirectionIds,
      visualBranchId: conversationLaneAnchors.visualBranchId
    });
    const conversationContext = buildConversationContextForRequest({
      workspace,
      laneKey: conversationLaneKey,
      taskMode: executionTaskMode,
      workIntent: executionWorkIntent,
      draft,
      hasPendingProposal: Boolean(activeProposal)
    });
    const objectSummaries = makeTaskObjectSummaries(context.semanticSummaries);
    const controller = new AbortController();
    const webSearch =
      isDeliverySectionPreparation ? undefined : buildWebSearchOptions({ draft, taskMode: executionTaskMode });
    abortControllerRef.current = controller;
    setIsAiStreaming(true);
    setAiDraft("");
    setAiOpen(true);
    if (pendingConfirmation?.kind !== "deleteObject") {
      setPendingConfirmation(null);
    }

    setWorkspace((current) => {
      const operationWorkspace = semanticOperationCreated ? semanticOperationCreated.workspace : current;
      return {
        ...operationWorkspace,
      ai: {
        ...operationWorkspace.ai,
        messages: [
          ...operationWorkspace.ai.messages,
          {
            id: userMessageId,
            role: "user",
            body: draft,
            createdAt: now,
            contextObjectIds: isDeliverySectionPreparation ? [] : context.objectIds,
            taskMode: executionTaskMode,
            recommendedTaskMode,
            workIntent: executionWorkIntent,
            recommendedWorkIntent,
            conversationLaneKey
          },
          {
            id: assistantMessageId,
            role: "assistant",
            body: "",
            createdAt: now,
            status: "streaming",
            contextObjectIds: isDeliverySectionPreparation ? [] : context.objectIds,
            taskMode: executionTaskMode,
            workIntent: executionWorkIntent,
            conversationLaneKey
          }
        ]
      }
      };
    });

    try {
      const attachmentResult =
        isDeliverySectionPreparation
          ? { attachments: [], skippedObjectIds: [], entries: [], warning: undefined }
          : shouldAttachImagesForMiMo({
                draft,
                taskMode: executionTaskMode,
                selectedObjects
              })
            ? await collectMiMoImageAttachments(workspace, context.imageObjectIds, controller.signal)
            : { attachments: [], skippedObjectIds: [], entries: [], warning: undefined };
      const documentResult =
        isDeliverySectionPreparation
          ? { extracts: [], warning: undefined }
          : await collectDocumentExtractsForAi(
              workspace,
              context.documentObjectIds,
              indexedDbBlobStore,
              controller.signal
            );
      const warnings = isDeliverySectionPreparation
        ? []
        : [
            context.skipped.length > 0 ? `${context.skipped.length} 个对象未进入本次 Context。` : "",
            attachmentResult.warning,
            documentResult.warning
          ].filter(Boolean);
      setContextWarning(warnings.join(" ") || undefined);
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          task,
          taskMode: executionTaskMode,
          workIntent: executionWorkIntent,
          messages: isDeliverySectionPreparation ? [] : conversationContext.recentMessages,
          objectSummaries: isDeliverySectionPreparation ? [] : objectSummaries,
          attachments: attachmentResult.attachments,
          documentExtracts: documentResult.extracts,
          conversationContext: isDeliverySectionPreparation
            ? undefined
            : {
                checkpoint: conversationContext.checkpoint
                  ? {
                      threadGoal: conversationContext.checkpoint.threadGoal,
                      progress: conversationContext.checkpoint.progress,
                      openThreads: conversationContext.checkpoint.openThreads,
                      nextTurnAnchor: conversationContext.checkpoint.nextTurnAnchor
                    }
                  : undefined,
                recentMessageCount: conversationContext.recentMessages.length,
                checkpointRequested: conversationContext.checkpointRequested
              },
          webSearch,
          defaultReferenceStatus: isDeliverySectionPreparation ? undefined : summarizeTaskDefaultReferenceStatus(context.defaultReference),
          taskContext:
            context.kind === "comparison" || isDeliverySectionPreparation
              ? undefined
              : buildProviderTaskContext(context),
          comparisonContext:
            context.kind === "comparison" && !isDeliverySectionPreparation
              ? {
                  sourceObjectIds: context.objectIds,
                  attachedImageObjectIds: attachmentResult.entries
                    .filter((entry) => entry.status === "ready")
                    .map((entry) => entry.objectId),
                  unavailableImageObjectIds: context.imageObjectIds.filter(
                    (objectId) =>
                      !attachmentResult.entries
                        .filter((entry) => entry.status === "ready")
                        .map((entry) => entry.objectId)
                        .includes(objectId)
                  ),
                  attachedDocumentObjectIds: documentResult.extracts.map((extract) => extract.objectId),
                  unavailableDocumentObjectIds: context.documentObjectIds.filter(
                    (objectId) => !documentResult.extracts.some((extract) => extract.objectId === objectId)
                  ),
                  backgroundObjectIds: [context.designDefinitionRevision?.designDefinitionId].filter(
                    (objectId): objectId is string => Boolean(objectId)
                  ),
                  documentFragmentExtracts: context.documentFragmentExtracts
                }
              : undefined,
          comparisonBackgroundContext:
            context.kind === "comparison" && !isDeliverySectionPreparation ? buildProviderComparisonBackgroundContext(context) : undefined,
          deliverySectionContext: isDeliverySectionPreparation ? deliverySectionContext : undefined
        }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const failure = await readErrorResponse(response);
        throw new Error(failure);
      }

      const streamResult = await readAiEventStream(response.body, (assistantBody) => {
        const sanitizedAssistantBody = isDeliverySectionPreparation
          ? sanitizeDeliverySectionDraftStreamForDisplay(assistantBody)
          : sanitizeComparisonAssistantStreamForDisplay(sanitizeConversationAssistantStreamForDisplay(assistantBody));
        setWorkspace((current) => updateAiMessage(current, assistantMessageId, sanitizedAssistantBody, "streaming"));
      });
      const visibleAssistantText = isDeliverySectionPreparation
        ? stripDeliverySectionDraftTechnicalBlocks(streamResult.text)
        : stripComparisonAnalysisBlock(stripAssistantTechnicalBlocks(streamResult.text));
      const assistantBody = [attachmentResult.warning, documentResult.warning, visibleAssistantText]
        .filter(Boolean)
        .join("\n\n");
      const resolvedAssistantBody = assistantBody || "MiMo 没有返回可显示文本。";
      const structuredWritePolicy = buildSameReplyStructuredWritePolicy(streamResult.text, executionWorkIntent);
      const designDefinitionProposal = isDeliverySectionPreparation ? null : parseDesignDefinitionProposalPayload(streamResult.text);
      const conceptDirectionProposal = isDeliverySectionPreparation ? null : parseConceptDirectionProposalPayload(streamResult.text);
      const deliverySectionDraft =
        isDeliverySectionPreparation && deliverySectionContext
          ? parseDeliverySectionDraftPayload(streamResult.text)
          : null;
      const designDefinitionProposalId =
        designDefinitionProposal?.status === "ok"
          ? `proposal-definition-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          : null;
      const conceptDirectionProposalId =
        conceptDirectionProposal?.status === "ok"
          ? `proposal-direction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          : null;
      const comparisonAuthorizationResult =
        executionWorkIntent === "comparison"
          ? buildComparisonAuthorization({
              workspace,
              selectedObjectIds,
              userMessageId,
              assistantMessageId,
              createdAt: now,
              comparisonGoal: draft,
              imageAttachmentObjectIds: attachmentResult.entries
                .filter((entry) => entry.status === "ready")
                .map((entry) => entry.objectId),
              documentExtractObjectIds: documentResult.extracts.map((extract) => extract.objectId),
              documentFragmentExtractObjectIds: context.documentFragmentExtracts.map((fragment) => fragment.objectId)
            })
          : null;
      const parsedComparisonAnalysis =
        structuredWritePolicy.allowComparisonAnalysis && !isDeliverySectionPreparation
          ? parseComparisonAnalysisPayload(streamResult.text)
          : null;

      let appliedComparisonAnalysisId: string | null = null;
      setWorkspace((current) => {
        let nextWorkspace = updateAiMessage(current, assistantMessageId, resolvedAssistantBody, "done");
        if (streamResult.citations.length > 0) {
          nextWorkspace = storeMessageCitations(nextWorkspace, {
            messageId: assistantMessageId,
            operationId: assistantMessageId,
            citations: streamResult.citations
          });
        }

        if (deliverySectionDraft?.status === "ok" && deliverySectionContext) {
          const validation = validateDeliverySectionDraftPayload(deliverySectionDraft.draft, {
            deliveryObjectId: deliverySectionContext.deliveryObjectId,
            sectionId: deliverySectionContext.sectionId,
            referenceIds: deliverySectionContext.references.map((reference) => reference.referenceId)
          });
          if (validation.status === "ok") {
            const createdDraft = createDeliverySectionDraft(nextWorkspace, {
              deliveryObjectId: deliverySectionContext.deliveryObjectId,
              sectionId: deliverySectionContext.sectionId,
              userMessageId,
              assistantMessageId,
              title: deliverySectionDraft.draft.title,
              narrative: deliverySectionDraft.draft.narrative,
              captions: deliverySectionDraft.draft.captions,
              suggestedGaps: deliverySectionDraft.draft.suggestedGaps,
              now
            });
            nextWorkspace =
              createdDraft.status === "updated"
                ? updateAiMessage(
                    createdDraft.workspace,
                    assistantMessageId,
                    `${resolvedAssistantBody}\n\n已生成一份待确认的交付说明草稿。应用前不会写入章节、图注或待补内容。`,
                    "done"
                  )
                : updateAiMessage(nextWorkspace, assistantMessageId, `${resolvedAssistantBody}\n\n${createdDraft.reason}`, "failed");
          } else {
            nextWorkspace = updateAiMessage(nextWorkspace, assistantMessageId, `${resolvedAssistantBody}\n\n${validation.reason}`, "failed");
          }
        } else if (designDefinitionProposal?.status === "ok" && designDefinitionProposalId) {
          const currentDefinitionId = nextWorkspace.workingState.currentDesignDefinitionId;
          const currentDefinitionObject = currentDefinitionId ? nextWorkspace.objects[currentDefinitionId] : undefined;
          const currentDefinition =
            currentDefinitionObject?.type === "designDefinition" ? currentDefinitionObject : undefined;
          const proposed = recordDesignDefinitionProposal(nextWorkspace, {
            proposalId: designDefinitionProposalId,
            workIntent: executionWorkIntent,
            title: designDefinitionProposal.proposal.title,
            summary: designDefinitionProposal.proposal.summary,
            projectGoal: designDefinitionProposal.proposal.projectGoal,
            targetUsers: designDefinitionProposal.proposal.targetUsers,
            primaryScenarios: designDefinitionProposal.proposal.primaryScenarios,
            coreProblem: designDefinitionProposal.proposal.coreProblem,
            designPrinciples: designDefinitionProposal.proposal.designPrinciples,
            constraints: designDefinitionProposal.proposal.constraints,
            avoidDirections: designDefinitionProposal.proposal.avoidDirections,
            opportunities: designDefinitionProposal.proposal.opportunities,
            openQuestions: designDefinitionProposal.proposal.openQuestions,
            changeNote: designDefinitionProposal.proposal.changeNote,
            sourceObjectIds: context.objectIds,
            citations: streamResult.citations,
            operationId: semanticOperationId,
            basedOnDesignDefinitionId: currentDefinition?.id,
            basedOnRevisionId: currentDefinition?.currentRevisionId
          });
          nextWorkspace = updateAiMessage(proposed.workspace, assistantMessageId, resolvedAssistantBody, "done", {
            citationIds: proposed.proposal.citationIds
          });
        } else if (conceptDirectionProposal?.status === "ok" && conceptDirectionProposalId) {
          const basedOnDefinitionId = nextWorkspace.workingState.currentDesignDefinitionId;
          const basedOnDefinitionObject = basedOnDefinitionId ? nextWorkspace.objects[basedOnDefinitionId] : undefined;
          const applicationScope = resolveConceptDirectionApplicationScope(
            nextWorkspace,
            selectedObjectIds,
            executionWorkIntent
          );
          const proposed = recordConceptDirectionProposal(nextWorkspace, {
            proposalId: conceptDirectionProposalId,
            workIntent: executionWorkIntent,
            applicationMode: applicationScope.applicationMode,
            targetDirectionId: applicationScope.targetDirectionId,
            parentDirectionIds: applicationScope.parentDirectionIds,
            title: conceptDirectionProposal.proposal.title,
            summary: conceptDirectionProposal.proposal.summary,
            directions: conceptDirectionProposal.proposal.directions,
            sourceObjectIds: context.objectIds,
            citations: streamResult.citations,
            operationId: semanticOperationId,
            basedOnDesignDefinitionId:
              basedOnDefinitionObject?.type === "designDefinition" ? basedOnDefinitionObject.id : undefined,
            basedOnRevisionId:
              basedOnDefinitionObject?.type === "designDefinition"
                ? basedOnDefinitionObject.currentRevisionId
                : undefined
          });
          nextWorkspace = updateAiMessage(proposed.workspace, assistantMessageId, resolvedAssistantBody, "done", {
            citationIds: proposed.proposal.citationIds
          });
        } else {
          if (
            comparisonAuthorizationResult?.status === "ready" &&
            parsedComparisonAnalysis?.status === "ok" &&
            "authorization" in comparisonAuthorizationResult
          ) {
            const validation = validateComparisonAnalysis(parsedComparisonAnalysis.analysis, comparisonAuthorizationResult.authorization);
            if (validation.status === "ok") {
              nextWorkspace = applyComparisonAnalysis(nextWorkspace, validation.analysis);
              appliedComparisonAnalysisId = validation.analysis.id;
            }
          }

          if (structuredWritePolicy.allowSemanticPatch && !isDeliverySectionPreparation) {
            const semanticPatchResult = applyConversationSemanticPatchFromReply({
              workspace: nextWorkspace,
              taskMode: executionTaskMode,
              context,
              draft,
              userMessageId,
              userMessageCreatedAt: now,
              assistantText: streamResult.text
            });
            nextWorkspace = semanticPatchResult.workspace;
            const parsedConversationCheckpoint = structuredWritePolicy.allowConversationCheckpoint && conversationContext.checkpointRequested
              ? parseConversationCheckpointPayload(streamResult.text)
              : { status: "empty" as const, reason: "checkpoint not requested" };
            if (parsedConversationCheckpoint.status === "ok") {
              const checkpointSourceMessages = nextWorkspace.ai.messages.filter(
                (message) =>
                  message.conversationLaneKey === conversationLaneKey &&
                  message.taskMode === "chatAnalysis" &&
                  message.status !== "failed" &&
                  message.status !== "streaming" &&
                  (message.role === "user" || message.role === "assistant")
              );
              const checkpointResult = applyConversationCheckpoint(nextWorkspace, {
                laneKey: conversationLaneKey,
                currentFocus: nextWorkspace.projectContinuity.currentFocus,
                taskKind: context.kind,
                anchorObjectIds: conversationLaneAnchors.anchorObjectIds,
                targetDirectionIds: conversationLaneAnchors.targetDirectionIds,
                visualBranchId: conversationLaneAnchors.visualBranchId,
                sourceStartMessageId: conversationContext.checkpoint?.sourceStartMessageId ?? checkpointSourceMessages[0]?.id ?? userMessageId,
                sourceEndMessageId: assistantMessageId,
                sourceMessageCount: checkpointSourceMessages.length,
                assistantMessageId,
                checkpoint: parsedConversationCheckpoint.checkpoint,
                hasPendingProposal: Boolean(activeProposal) || structuredWritePolicy.hasBlockingProposalBlock,
                now
              });
              nextWorkspace = checkpointResult.workspace;
            }
            if (semanticPatchResult.status === "applied") {
              nextWorkspace = updateAiMessage(nextWorkspace, assistantMessageId, resolvedAssistantBody, "done", {
                continuityEntryIds: semanticPatchResult.entryIds
              });
            }
          }
        }

        return nextWorkspace;
      });

      if (designDefinitionProposalId || conceptDirectionProposalId) {
        setActiveProposalId(designDefinitionProposalId ?? conceptDirectionProposalId);
        setPendingConfirmation(null);
      } else if (appliedComparisonAnalysisId) {
        setPendingConfirmation(null);
      }
      if (isDeliverySectionPreparation) {
        setPendingDeliveryDraftTarget(null);
      }
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
    activeProposal,
    aiDraft,
    handleRunResearchOperation,
    handleRunVisualGenerationOperation,
    isAiStreaming,
    recommendedTaskMode,
    recommendedWorkIntent,
    pendingConfirmation?.kind,
    pendingDeliveryDraftTarget,
    selectedObjectIds,
    selectedObjects,
    setWorkspace,
    taskMode,
    workIntent,
    workspace
  ]);

  const openDeliveryPreparation = useCallback((deliveryObjectId?: string) => {
    const targetId = deliveryObjectId ?? selectedObjects.find((object) => object.type === "delivery")?.id ?? activeDeliveryObjectId;
    if (targetId) {
      setActiveDeliveryObjectId(targetId);
    }
    setDeliveryPanelOpen(true);
  }, [activeDeliveryObjectId, selectedObjects]);

  const handleInspectDeliveryOutput = useCallback(async (deliveryObjectId: string) => {
    const requestId = deliveryOutputInspectRequestRef.current + 1;
    deliveryOutputInspectRequestRef.current = requestId;
    setDeliveryOutputBusyLabel("正在检查素材状态…");
    setDeliveryOutputMessage(null);
    try {
      const result = await inspectDeliveryOutputPackage(workspace, {
        deliveryObjectId,
        blobStore: indexedDbBlobStore
      });
      if (deliveryOutputInspectRequestRef.current !== requestId) {
        return;
      }
      setDeliveryOutputPreflight(result);
      if (result.status === "blocked" || result.status === "failed") {
        setDeliveryOutputMessage({
          tone: result.status === "blocked" ? "warning" : "error",
          text: result.reason
        });
      }
    } catch {
      if (deliveryOutputInspectRequestRef.current !== requestId) {
        return;
      }
      setDeliveryOutputPreflight({
        status: "failed",
        reason: "导出前检查失败，请稍后重试。",
        diagnostics: []
      });
      setDeliveryOutputMessage({
        tone: "error",
        text: "导出前检查失败，请稍后重试。"
      });
    } finally {
      if (deliveryOutputInspectRequestRef.current === requestId) {
        setDeliveryOutputBusyLabel(null);
      }
    }
  }, [workspace]);

  const handleExportDeliveryOutput = useCallback(async (deliveryObjectId: string) => {
    setDeliveryOutputBusyLabel("正在导出交付输出包…");
    setDeliveryOutputMessage(null);
    try {
      const result = await exportDeliveryOutputPackage(workspace, {
        deliveryObjectId,
        blobStore: indexedDbBlobStore,
        download: true
      });
      if (result.status !== "ok") {
        setDeliveryOutputMessage({
          tone: result.status === "blocked" ? "warning" : "error",
          text: result.reason
        });
        return;
      }
      setDeliveryOutputPreflight({
        status: "ok",
        manifest: result.manifest,
        diagnostics: result.diagnostics,
        summary: result.summary
      });
      setDeliveryOutputMessage({
        tone: result.summary.missingOrMismatchedAssets > 0 ? "warning" : "success",
        text:
          result.summary.missingOrMismatchedAssets > 0
            ? `输出包已导出，但有 ${result.summary.missingOrMismatchedAssets} 项素材未完整带出。请查看压缩包中的 asset-index.md 和 gaps-and-next-steps.md。`
            : "输出包已导出。包含章节结构、素材、图注、来源映射和待补内容。"
      });
    } catch {
      setDeliveryOutputMessage({
        tone: "error",
        text: "交付输出包导出失败，请稍后重试。"
      });
    } finally {
      setDeliveryOutputBusyLabel(null);
    }
  }, [workspace]);

  const handleExportHumanArchive = useCallback(async () => {
    setBundleBusyLabel("正在导出可读归档…");
    setBundleMessage(null);
    setInspectedBackup(null);
    try {
      const result = await exportHumanReadableArchiveBundle(workspace, {
        blobStore: indexedDbBlobStore,
        chat: archiveIncludeFullChat ? "full" : "none",
        projectContinuity: archiveIncludeContinuity ? "current" : "none"
      });
      if (result.status !== "ok") {
        setBundleMessage({
          tone: result.status === "blocked" ? "warning" : "error",
          text: result.reason
        });
        return;
      }
      downloadProjectBundleFile(result.file);
      setBundleMessage({
        tone: result.diagnostics.some((diagnostic) => diagnostic.severity === "warning") ? "warning" : "success",
        text: summarizeBundleDiagnostics("归档已导出。", result.diagnostics)
      });
    } catch {
      setBundleMessage({
        tone: "error",
        text: "归档导出失败，请稍后重试。"
      });
    } finally {
      setBundleBusyLabel(null);
    }
  }, [archiveIncludeContinuity, archiveIncludeFullChat, workspace]);

  const handleExportEditableBackup = useCallback(async () => {
    setBundleBusyLabel("正在导出可编辑备份…");
    setBundleMessage(null);
    setInspectedBackup(null);
    try {
      const result = await exportEditableProjectBackupBundle(workspace, {
        blobStore: indexedDbBlobStore,
        chat: backupIncludeFullChat ? "full" : "none",
        projectContinuity: "current"
      });
      if (result.status !== "ok") {
        setBundleMessage({
          tone: result.status === "blocked" ? "warning" : "error",
          text: result.reason
        });
        return;
      }
      downloadProjectBundleFile(result.file);
      setBundleMessage({
        tone: result.diagnostics.some((diagnostic) => diagnostic.severity === "warning") ? "warning" : "success",
        text: summarizeBundleDiagnostics("备份已导出。", result.diagnostics)
      });
    } catch {
      setBundleMessage({
        tone: "error",
        text: "备份导出失败，请稍后重试。"
      });
    } finally {
      setBundleBusyLabel(null);
    }
  }, [backupIncludeFullChat, workspace]);

  const handleInspectEditableBackup = useCallback(async (file: File) => {
    setBundleBusyLabel("正在读取备份包…");
    setBundleMessage(null);
    setInspectedBackup(null);
    try {
      const result = await inspectEditableProjectBackupBundle(file);
      if (result.status !== "ok") {
        setBundleMessage({
          tone: "error",
          text: result.reason
        });
        return;
      }
      setInspectedBackup(result.backup);
      setBundleMessage({
        tone: result.preview.warningCount > 0 ? "warning" : "neutral",
        text:
          result.preview.warningCount > 0
            ? `备份已读取，有 ${result.preview.warningCount} 条 warning。确认后将恢复为新项目副本。`
            : "备份已读取。请确认后恢复为新项目副本。"
      });
    } catch {
      setBundleMessage({
        tone: "error",
        text: "无法读取备份包。文件可能损坏，或不是 Morpho 可编辑备份。"
      });
    } finally {
      setBundleBusyLabel(null);
    }
  }, []);

  const handleCancelRestorePreview = useCallback(() => {
    setInspectedBackup(null);
    setBundleMessage(null);
  }, []);

  const handleConfirmRestoreEditableBackup = useCallback(async () => {
    if (!inspectedBackup) {
      setBundleMessage({
        tone: "error",
        text: "请先选择并预览一个可编辑备份包。"
      });
      return;
    }

    setBundleBusyLabel("正在恢复可编辑备份…");
    setBundleMessage(null);
    try {
      const result = await restoreEditableProjectBackupBundle(inspectedBackup, {
        blobStore: indexedDbBlobStore,
        storage: window.localStorage
      });
      if (result.status !== "ok") {
        setBundleMessage({
          tone: "error",
          text: result.reason
        });
        return;
      }
      setInspectedBackup(null);
      setBundlePanelOpen(false);
      setBundleMessage({
        tone: "success",
        text: "备份已恢复为新的项目副本。"
      });
      startTransition(() => {
        router.push(`/projects/${encodeURIComponent(result.projectId)}`);
      });
    } catch {
      setBundleMessage({
        tone: "error",
        text: "恢复备份失败，请重新选择备份包后再试。"
      });
    } finally {
      setBundleBusyLabel(null);
    }
  }, [inspectedBackup, router]);

  const applyDeliveryOperation = useCallback(
    (operation: (current: MorphoWorkspace) => { status: "updated"; workspace: MorphoWorkspace } | { status: "blocked"; workspace: MorphoWorkspace; reason: string }) => {
      let blockedReason: string | undefined;
      setWorkspace((current) => {
        const result = operation(current);
        if (result.status === "blocked") {
          blockedReason = result.reason;
          return current;
        }
        return result.workspace;
      });
      setContextWarning(blockedReason);
    },
    [setWorkspace]
  );

  const handleCreateDelivery = useCallback(
    (input: { title: string; format: "board" | "presentation" }) => {
      let createdId: string | undefined;
      applyDeliveryOperation((current) => {
        const result = createDeliveryPreparation(current, {
          title: input.title,
          format: input.format,
          position: {
            x: current.canvas.view.x + 220,
            y: current.canvas.view.y + 180
          }
        });
        if (result.status === "updated") {
          createdId = result.deliveryObjectId;
        }
        return result;
      });
      if (createdId) {
        setActiveDeliveryObjectId(createdId);
        setSelectedObjectIds([createdId]);
        setFocusRequest((current) => ({ objectId: createdId, nonce: current.nonce + 1 }));
      }
    },
    [applyDeliveryOperation]
  );

  const handleCreateDeliverySection = useCallback(
    (input: { deliveryObjectId: string; title: string; purpose?: string }) => {
      applyDeliveryOperation((current) =>
        createDeliverySection(current, {
          deliveryObjectId: input.deliveryObjectId,
          title: input.title,
          purpose: input.purpose
        })
      );
    },
    [applyDeliveryOperation]
  );

  const handleRequestDeliverySectionDraft = useCallback(
    (input: { deliveryObjectId: string; sectionId: string }) => {
      const delivery = workspace.objects[input.deliveryObjectId];
      if (!delivery || delivery.type !== "delivery") {
        setContextWarning("交付准备包不可用。");
        return;
      }
      const context = buildDeliverySectionContext(workspace, delivery, input.sectionId);
      if (!context || context.references.length === 0) {
        setContextWarning("请先为本章节加入至少一项交付引用。");
        return;
      }
      setPendingDeliveryDraftTarget(input);
      setActiveDeliveryObjectId(input.deliveryObjectId);
      setAiOpen(true);
      setTaskMode("chatAnalysis");
      handleWorkIntentChange("prepareDeliverySection");
      setAiDraft(`请基于“${context.sectionTitle}”这一节的交付引用快照，生成一份本节说明草稿，并给出必要的图注和待补内容建议。`);
    },
    [handleWorkIntentChange, workspace]
  );

  const handleApplyDeliveryDraft = useCallback(
    (input: { deliveryObjectId: string; draftId: string }) => {
      applyDeliveryOperation((current) => applyDeliverySectionDraft(current, input));
    },
    [applyDeliveryOperation]
  );

  const handleDiscardDeliveryDraft = useCallback(
    (input: { deliveryObjectId: string; draftId: string }) => {
      applyDeliveryOperation((current) => discardDeliverySectionDraft(current, input));
    },
    [applyDeliveryOperation]
  );

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
      if (suggestion.workIntent) {
        handleWorkIntentChange(suggestion.workIntent);
      }
    },
    [handleWorkIntentChange, selectedObjectIds, workspace]
  );

  const handleAskAi = useCallback(() => {
    setAiOpen(true);
    setTaskMode("chatAnalysis");
    handleWorkIntentChange("discussion");
    if (selectedObjects[0]) {
      setAiDraft(`请基于“${selectedObjects[0].title}”继续分析下一步。`);
    }
  }, [handleWorkIntentChange, selectedObjects]);

  const handleToggleDesignTrace = useCallback(() => {
    const target = selectedObjects[0];
    if (!target) {
      return;
    }

    setTraceStartObjectId((current) => (current === target.id ? null : target.id));
  }, [selectedObjects]);

  const handleReviseDirectionIntent = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }

    setAiOpen(true);
    setTaskMode("chatAnalysis");
    handleWorkIntentChange("reviseConceptDirection");
    setAiDraft(`请基于“${target.title}”的当前修订，生成一份修订当前方向的草案；应用后必须复用同一个方向对象，不要创建新方向。`);
  }, [handleWorkIntentChange, selectedObjects]);

  const handleSplitDirectionIntent = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }

    setAiOpen(true);
    setTaskMode("chatAnalysis");
    handleWorkIntentChange("splitConceptDirection");
    setAiDraft(`请把“${target.title}”拆分成两条或更多可比较的概念方向草案；不要淘汰、隐藏或替换原方向。`);
  }, [handleWorkIntentChange, selectedObjects]);

  const handleMergeDirectionsIntent = useCallback(() => {
    const directions = selectedObjects.filter((object) => object.type === "conceptDirection");
    if (directions.length < 2) {
      return;
    }

    setAiOpen(true);
    setTaskMode("chatAnalysis");
    handleWorkIntentChange("mergeConceptDirections");
    setAiDraft(`请把这些已选方向合并成一个新的概念方向草案：${directions.map((direction) => direction.title).join("、")}。父方向必须保留，不要自动淘汰或隐藏。`);
  }, [handleWorkIntentChange, selectedObjects]);

  const handleCreateVisualBranch = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }
    const label = window.prompt("请输入新视觉分支名称。", "未分组视觉探索");
    const trimmedLabel = label?.trim();
    if (!trimmedLabel) {
      return;
    }

    setWorkspace((current) => {
      const result = createVisualBranch(current, {
        directionId: target.id,
        label: trimmedLabel
      });
      if (result.status === "blocked") {
        setContextWarning(result.reason);
        return current;
      }
      return result.workspace;
    });
  }, [selectedObjects, setWorkspace]);

  const handleRenameVisualBranch = useCallback(
    (branchId: string) => {
      const branch = workspace.visualBranches[branchId];
      const label = window.prompt("请输入新的视觉分支名称。", branch?.label ?? "");
      const trimmedLabel = label?.trim();
      if (!trimmedLabel) {
        return;
      }

      setWorkspace((current) => {
        const result = renameVisualBranch(current, branchId, trimmedLabel);
        if (result.status === "blocked") {
          setContextWarning(result.reason);
          return current;
        }
        return result.workspace;
      });
    },
    [setWorkspace, workspace.visualBranches]
  );

  const handleArchiveVisualBranch = useCallback(
    (branchId: string) => {
      setWorkspace((current) => {
        const result = archiveVisualBranch(current, branchId);
        if (result.status === "blocked") {
          setContextWarning(result.reason);
          return current;
        }
        return result.workspace;
      });
    },
    [setWorkspace]
  );

  const handleRestoreVisualBranch = useCallback(
    (branchId: string) => {
      setWorkspace((current) => {
        const result = restoreVisualBranch(current, branchId);
        if (result.status === "blocked") {
          setContextWarning(result.reason);
          return current;
        }
        return result.workspace;
      });
    },
    [setWorkspace]
  );

  const handleAssignImageToVisualBranch = useCallback(
    (branchId: string) => {
      const target = selectedObjects.find((object) => object.type === "image");
      if (!target) {
        return;
      }

      setWorkspace((current) => {
        const result = assignImageToVisualBranch(current, target.id, branchId);
        if (result.status === "blocked") {
          setContextWarning(result.reason);
          return current;
        }
        return result.workspace;
      });
    },
    [selectedObjects, setWorkspace]
  );

  const handleRemoveImageFromVisualBranch = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "image");
    if (!target) {
      return;
    }

    setWorkspace((current) => {
      const result = removeImageFromVisualBranch(current, target.id);
      if (result.status === "blocked") {
        setContextWarning(result.reason);
        return current;
      }
      return result.workspace;
    });
  }, [selectedObjects, setWorkspace]);

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

    const plannedIntent = classifyVisualGenerationIntent(draft, selectedObjects);
    if (plannedIntent) {
      await handleRunVisualGenerationOperation(draft);
      return;
    }

    const operationGate = canStartOperation(workspace);
    if (operationGate.status === "blocked") {
      setAiDraft(draft);
      setImageTaskStatus({ state: "failed", message: operationGate.reason });
      setWorkspace((current) => appendOperationBlockedMessage(current, operationGate.operation, operationGate.reason));
      return;
    }

    const initialVisualTarget = resolveVisualGenerationTarget(workspace, selectedObjects, selectedObjectIds);
    if (initialVisualTarget.status === "blocked") {
      setContextWarning(initialVisualTarget.reason);
      setImageTaskStatus({ state: "failed", message: initialVisualTarget.reason });
      return;
    }

    const context = buildTaskContext(workspace, {
      kind: "visualDevelopment",
      draft,
      selectedObjectIds,
      explicitObjectIds: explicitImageId ? [explicitImageId] : [],
      targetDirectionIds: initialVisualTarget.directionId ? [initialVisualTarget.directionId] : [],
      visualBranchId: initialVisualTarget.visualBranchId
    });
    setContextWarning(context.defaultReference.status === "hidden" ? context.defaultReference.reason : undefined);

    const now = new Date().toISOString();
    const operationId = `operation-image-${Date.now()}`;
    const clientRequestId = `client-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
        directionObjectId: initialVisualTarget.directionId,
        visualBranchId: initialVisualTarget.visualBranchId
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
      const referenceImages = await collectImageReferenceDataUrls(workspace, context.imageObjectIds, controller.signal);
      const sourceObjectIds = referenceImages.sourceObjectIds;
      const visualTarget = resolveVisualGenerationTarget(
        workspace,
        selectedObjects,
        sourceObjectIds,
        initialVisualTarget.visualBranchId
      );
      if (visualTarget.status === "blocked") {
        throw new Error(visualTarget.reason);
      }
      const directionObjectId = visualTarget.directionId;
      const visualBranchId = visualTarget.visualBranchId;
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
          visualBranchId,
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
            visualBranchId,
            operationId,
            clientRequestId,
            providerTaskId,
            createdAt: new Date().toISOString()
          },
          sourceObjectIds,
          directionObjectId,
          visualBranchId
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
    handleRunVisualGenerationOperation,
    isAiStreaming,
    localEditObjectId,
    selectedObjectIds,
    selectedObjects,
    setWorkspace,
    workspace
  ]);

  const handleApplyProposal = useCallback((allowSourceChanged = false) => {
    if (!activeProposal) {
      return;
    }

    if (activeProposal.type === "researchAnalysis") {
      const result = applyResearchAnalysisProposal(workspace, activeProposal.id, {
        position: {
          x: workspace.canvas.view.x + 220,
          y: workspace.canvas.view.y + 180
        },
        allowSourceChanged
      });

      if (result.status === "updated") {
        setWorkspace(result.workspace);
        setSelectedObjectIds([result.researchObject.id]);
        setFocusRequest((current) => ({ objectId: result.researchObject.id, nonce: current.nonce + 1 }));
        setActiveProposalId(null);
      } else {
        setWorkspace(
          appendAiAssistantFailureMessage(
            result.workspace,
            "research-proposal-failed",
            `${result.reason} 请重新整理来源后再确认。`,
            activeProposal.id
          )
        );
      }

      setAiDraft("");
      setTaskMode("chatAnalysis");
      return;
    }

    if (activeProposal.type === "designDefinition") {
      const result = applyDesignDefinitionProposal(workspace, activeProposal.id, { allowSourceChanged });
      if (result.status === "updated") {
        setWorkspace(result.workspace);
        setSelectedObjectIds([result.designDefinitionObject.id]);
        setFocusRequest((current) => ({ objectId: result.designDefinitionObject.id, nonce: current.nonce + 1 }));
        setActiveProposalId(null);
      } else {
        setWorkspace(
          appendAiAssistantFailureMessage(
            result.workspace,
            "design-definition-proposal-failed",
            `${result.reason} 请复核后再确认。`,
            activeProposal.id
          )
        );
      }

      setAiDraft("");
      setTaskMode("chatAnalysis");
      return;
    }

    if (activeProposal.type === "conceptDirection") {
      const result = applyConceptDirectionProposal(workspace, activeProposal.id, {
        position: {
          x: workspace.canvas.view.x + 260,
          y: workspace.canvas.view.y + 220
        },
        allowSourceChanged
      });
      if (result.status === "updated") {
        setWorkspace(result.workspace);
        setSelectedObjectIds(result.directions.map((direction) => direction.id));
        if (result.directions[0]) {
          setFocusRequest((current) => ({ objectId: result.directions[0].id, nonce: current.nonce + 1 }));
        }
        setActiveProposalId(null);
      } else {
        setWorkspace(
          appendAiAssistantFailureMessage(
            result.workspace,
            "concept-direction-proposal-failed",
            `${result.reason} 请复核后再确认。`,
            activeProposal.id
          )
        );
      }

      setAiDraft("");
      setTaskMode("chatAnalysis");
    }
  }, [activeProposal, setWorkspace, workspace]);

  const handleRejectProposal = useCallback(
    (proposalId: string) => {
      setWorkspace((current) => rejectArtifactProposal(current, proposalId, "用户明确放弃当前草案。"));
      setActiveProposalId((current) => (current === proposalId ? null : current));
    },
    [setWorkspace]
  );

  const handleSaveResearchProposalDraft = useCallback(
    (proposalId: string, input: Parameters<typeof updateResearchAnalysisProposalDraft>[2]) => {
      setWorkspace((current) => updateResearchAnalysisProposalDraft(current, proposalId, input));
      setActiveProposalId(proposalId);
    },
    [setWorkspace]
  );

  const handleSaveDesignDefinitionProposalDraft = useCallback(
    (proposalId: string, input: Parameters<typeof updateDesignDefinitionProposalDraft>[2]) => {
      setWorkspace((current) => updateDesignDefinitionProposalDraft(current, proposalId, input));
      setActiveProposalId(proposalId);
    },
    [setWorkspace]
  );

  const handleSaveConceptDirectionProposalDraft = useCallback(
    (proposalId: string, input: Parameters<typeof updateConceptDirectionProposalDraft>[2]) => {
      setWorkspace((current) => updateConceptDirectionProposalDraft(current, proposalId, input));
      setActiveProposalId(proposalId);
    },
    [setWorkspace]
  );

  const handleContinueProposalDiscussion = useCallback(
    (proposalId: string) => {
      const proposal = workspace.artifactProposals[proposalId];
      if (!proposal || proposal.status !== "pending") {
        return;
      }

      setAiOpen(true);
      setTaskMode("chatAnalysis");
      handleWorkIntentChange(proposal.workIntent ?? "discussion");
      setActiveProposalId(proposalId);
      setAiDraft(buildProposalDiscussionDraft(proposal));
    },
    [handleWorkIntentChange, workspace.artifactProposals]
  );

  const handleRegenerateProposal = useCallback(
    (proposalId: string) => {
      const proposal = workspace.artifactProposals[proposalId];
      if (!proposal || proposal.status !== "pending") {
        return;
      }

      setAiOpen(true);
      setTaskMode("chatAnalysis");
      handleWorkIntentChange(proposal.workIntent ?? "discussion");
      setActiveProposalId(proposalId);
      setAiDraft(buildProposalRegenerationDraft(proposal));
    },
    [handleWorkIntentChange, workspace.artifactProposals]
  );

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

    if (isComparisonPendingConfirmation(pendingConfirmation)) {
      if (pendingConfirmation.reasonRequired && !pendingConfirmation.userReason.trim()) {
        return;
      }

      const comparisonMetadata: ComparisonDecisionMetadata = {
        comparisonAnalysisId: pendingConfirmation.comparisonAnalysisId,
        comparisonAssistantMessageId: pendingConfirmation.comparisonAssistantMessageId,
        comparisonSourceObjectIds: [...pendingConfirmation.comparisonSourceObjectIds],
        userReason: pendingConfirmation.userReason.trim() || undefined
      };
      setWorkspace((current) => {
        const validation = validatePendingComparisonConfirmation(current, pendingConfirmation);
        if (validation.status !== "ok") {
          return current;
        }

        if (pendingConfirmation.kind === "compareSetPrimary") {
          return setConceptDirectionStatus(
            current,
            pendingConfirmation.targetObjectId,
            "primary",
            buildComparisonDecisionReason(pendingConfirmation),
            comparisonMetadata
          );
        }

        if (pendingConfirmation.kind === "compareSetAlternative") {
          return setConceptDirectionStatus(
            current,
            pendingConfirmation.targetObjectId,
            "alternative",
            buildComparisonDecisionReason(pendingConfirmation),
            comparisonMetadata
          );
        }

        if (pendingConfirmation.kind === "compareEliminate") {
          return eliminateDirection(current, pendingConfirmation.targetObjectId, {
            reason: buildComparisonDecisionReason(pendingConfirmation),
            comparison: comparisonMetadata
          });
        }

        if (pendingConfirmation.kind === "compareRestoreAlternative") {
          return setConceptDirectionStatus(
            current,
            pendingConfirmation.targetObjectId,
            "alternative",
            buildComparisonDecisionReason(pendingConfirmation),
            comparisonMetadata
          );
        }

        if (pendingConfirmation.kind === "compareSetDefaultReference") {
          return setDefaultReference(current, pendingConfirmation.targetObjectId, {
            reason: buildComparisonDecisionReason(pendingConfirmation),
            comparison: comparisonMetadata
          });
        }

        if (pendingConfirmation.kind === "compareClearDefaultReference") {
          return clearDefaultReference(current, pendingConfirmation.targetObjectId, {
            reason: buildComparisonDecisionReason(pendingConfirmation),
            comparison: comparisonMetadata
          });
        }

        const keyConclusionDraft = pendingConfirmation.keyConclusionDraft;
        const result = createKeyConclusion(current, {
          title: keyConclusionDraft.title,
          body: keyConclusionDraft.body,
          summary: keyConclusionDraft.summary,
          sourceObjectIds: resolveComparisonWritebackSourceObjectIds(pendingConfirmation),
          confidence: keyConclusionDraft.confidence,
          note: pendingConfirmation.userReason.trim() || undefined,
          position: {
            x: current.canvas.view.x + 240,
            y: current.canvas.view.y + 180
          },
          comparison: comparisonMetadata
        });
        return result.workspace;
      });
      setPendingConfirmation(null);
      setAiDraft("");
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

    if (pendingConfirmation.kind === "createKeyConclusion") {
      const result = createKeyConclusion(workspace, {
        title: pendingConfirmation.conclusionTitle,
        body: pendingConfirmation.body,
        summary: pendingConfirmation.summary,
        sourceObjectIds: pendingConfirmation.sourceObjectIds,
        citationIds: pendingConfirmation.citationIds,
        confidence: pendingConfirmation.confidence,
        state: pendingConfirmation.state,
        note: pendingConfirmation.note,
        position: {
          x: workspace.canvas.view.x + 240,
          y: workspace.canvas.view.y + 180
        }
      });

      setWorkspace(result.workspace);
      setSelectedObjectIds([result.keyConclusion.id]);
      setFocusRequest((current) => ({ objectId: result.keyConclusion.id, nonce: current.nonce + 1 }));
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
    const reason = window.prompt("请输入或编辑淘汰理由。淘汰不会隐藏、删除方向，也不会移除图片、修订或 lineage。", "");
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      return;
    }

    setWorkspace((current) =>
      eliminateDirection(current, target.id, {
        reason: trimmedReason
      })
    );
  }, [selectedObjects, setWorkspace]);

  const handleSetDirectionPrimary = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }

    setWorkspace((current) =>
      setConceptDirectionStatus(current, target.id, "primary", "用户在底部详情栏明确将该方向设为主方向。")
    );
  }, [selectedObjects, setWorkspace]);

  const handleSetDirectionAlternative = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }

    setWorkspace((current) =>
      setConceptDirectionStatus(current, target.id, "alternative", "用户在底部详情栏明确将该方向转为备选方向。")
    );
  }, [selectedObjects, setWorkspace]);

  const handleRestoreDirectionAsAlternative = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }

    setWorkspace((current) =>
      setConceptDirectionStatus(current, target.id, "alternative", "用户将已淘汰方向恢复为备选方向。")
    );
  }, [selectedObjects, setWorkspace]);

  const handleSaveKeyConclusionFromResearchItem = useCallback(
    (input: { researchObjectId: string; sourceKind: "finding" | "opportunity" | "constraint" | "openQuestion" | "evidence"; index: number }) => {
      const research = workspace.objects[input.researchObjectId];
      if (!research || research.type !== "research") {
        return;
      }

      const draftResult = buildKeyConclusionDraftFromResearchSource(workspace, input.researchObjectId, {
        kind: input.sourceKind,
        index: input.index
      });
      if (draftResult.status !== "ready") {
        setAiOpen(true);
        setAiDraft(draftResult.reason);
        return;
      }

      setAiOpen(true);
      setTaskMode("chatAnalysis");
      setPendingConfirmation({
        kind: "createKeyConclusion",
        sourceObjectIds: draftResult.draft.sourceObjectIds,
        sourceTitle: research.title,
        conclusionTitle: draftResult.draft.title,
        body: draftResult.draft.body,
        summary: draftResult.draft.summary,
        citationIds: draftResult.draft.citationIds,
        confidence: draftResult.draft.confidence,
        state: draftResult.draft.state,
        note: draftResult.draft.note
      });
    },
    [workspace]
  );

  const handleCopyItemToDraft = useCallback((text: string) => {
    setAiOpen(true);
    setTaskMode("chatAnalysis");
    setWorkIntent("discussion");
    setAiDraft(text);
  }, []);

  const handleContinueQuestion = useCallback((text: string) => {
    setAiOpen(true);
    setTaskMode("chatAnalysis");
    setWorkIntent("discussion");
    setAiDraft(`请继续追问：${text}`);
  }, []);

  const handleSetKeyConclusionState = useCallback(
    (keyConclusionId: string, nextState: "active" | "needsVerification" | "superseded" | "archived", supersededById?: string) => {
      setWorkspace((current) => {
        const result = setKeyConclusionState(current, keyConclusionId, nextState, {
          supersededById,
          reason: "用户在底部详情栏中明确修改关键结论状态。"
        });
        return result.workspace;
      });
    },
    [setWorkspace]
  );

  const handleUpdatePendingKeyConclusion = useCallback(
    (patch: Partial<Extract<PendingAiConfirmation, { kind: "createKeyConclusion" }>>) => {
      setPendingConfirmation((current) => {
        if (!current || current.kind !== "createKeyConclusion") {
          return current;
        }

        return {
          ...current,
          ...patch
        };
      });
    },
    []
  );

  const handleUpdatePendingComparison = useCallback(
    (patch: Pick<PendingComparisonConfirmation, "userReason">) => {
      setPendingConfirmation((current) => {
        if (!current || !isComparisonPendingConfirmation(current)) {
          return current;
        }

        return {
          ...current,
          userReason: patch.userReason
        };
      });
    },
    []
  );

  const handleRequestComparisonAction = useCallback(
    (analysisId: string, action: ComparisonActionKind, objectId?: string) => {
      const analysis = workspace.ai.comparisonAnalyses?.[analysisId];
      if (!analysis) {
        return;
      }

      const validation = validateComparisonActionTarget(workspace, analysisId, action, objectId);
      if (validation.status !== "ok") {
        return;
      }

      const summary = analysis.conclusionSummary;
      const keyConclusionDraft = analysis.keyConclusionCandidate
        ? {
            title: analysis.keyConclusionCandidate.title,
            body: analysis.keyConclusionCandidate.body,
            summary: analysis.keyConclusionCandidate.summary,
            confidence: analysis.keyConclusionCandidate.confidence
          }
        : undefined;

      if (action === "createKeyConclusion") {
        const keyConclusionCandidate = analysis.keyConclusionCandidate;
        if (!keyConclusionDraft || !keyConclusionCandidate) {
          return;
        }

        setAiOpen(true);
        setTaskMode("chatAnalysis");
        setPendingConfirmation({
          kind: "compareCreateKeyConclusion",
          targetTitle: keyConclusionDraft.title,
          comparisonAnalysisId: analysis.id,
          comparisonAssistantMessageId: analysis.assistantMessageId,
          comparisonSourceObjectIds: [...analysis.sourceObjectIds],
          keyConclusionSourceObjectIds: [...keyConclusionCandidate.sourceObjectIds],
          summary,
          userReason: "",
          reasonRequired: false,
          keyConclusionDraft
        });
        return;
      }

      if (!objectId) {
        return;
      }

      const targetObject = validation.targetObject;
      if (!targetObject) {
        return;
      }

      const base = {
        targetObjectId: targetObject.id,
        targetTitle: targetObject.title,
        comparisonAnalysisId: analysis.id,
        comparisonAssistantMessageId: analysis.assistantMessageId,
        comparisonSourceObjectIds: [...analysis.sourceObjectIds],
        summary,
        userReason: "",
        keyConclusionDraft
      };

      if (action === "setPrimary" && targetObject.type === "conceptDirection") {
        setPendingConfirmation({ ...base, kind: "compareSetPrimary", reasonRequired: false });
        return;
      }

      if (action === "setAlternative" && targetObject.type === "conceptDirection") {
        setPendingConfirmation({ ...base, kind: "compareSetAlternative", reasonRequired: false });
        return;
      }

      if (action === "eliminate" && targetObject.type === "conceptDirection") {
        setPendingConfirmation({ ...base, kind: "compareEliminate", reasonRequired: true });
        return;
      }

      if (action === "restoreAlternative" && targetObject.type === "conceptDirection") {
        setPendingConfirmation({ ...base, kind: "compareRestoreAlternative", reasonRequired: true });
        return;
      }

      if (action === "setDefaultReference" && targetObject.type === "image") {
        setPendingConfirmation({ ...base, kind: "compareSetDefaultReference", reasonRequired: true });
        return;
      }

      if (action === "clearDefaultReference" && targetObject.type === "image") {
        setPendingConfirmation({ ...base, kind: "compareClearDefaultReference", reasonRequired: true });
      }
    },
    [workspace]
  );

  function isComparisonPendingConfirmation(
    confirmation: PendingAiConfirmation
  ): confirmation is PendingComparisonConfirmation {
    return (
      confirmation.kind === "compareSetPrimary" ||
      confirmation.kind === "compareSetAlternative" ||
      confirmation.kind === "compareEliminate" ||
      confirmation.kind === "compareRestoreAlternative" ||
      confirmation.kind === "compareSetDefaultReference" ||
      confirmation.kind === "compareClearDefaultReference" ||
      confirmation.kind === "compareCreateKeyConclusion"
    );
  }

  function buildComparisonDecisionReason(confirmation: PendingComparisonConfirmation): string {
    return confirmation.userReason.trim() || "用户已明确确认此 Compare 决定。";
  }

  const handleSetImageRole = useCallback(
    (role: ImageRole) => {
      const target = selectedObjects.find((object) => object.type === "image");
      if (!target) {
        return;
      }

      setWorkspace((current) =>
        setImageRole(current, target.id, role, {
          reason: `用户在底部详情栏明确将图片角色标记为 ${role}。`
        })
      );
    },
    [selectedObjects, setWorkspace]
  );

  const handleOpenDocumentReader = useCallback(
    (fileObjectId: string, initialLocation?: { startOffset: number; endOffset: number; label: string } | null) => {
      documentReaderAbortRef.current?.abort();
      const requestId = documentReaderRequestRef.current + 1;
      documentReaderRequestRef.current = requestId;
      const abortController = new AbortController();
      documentReaderAbortRef.current = abortController;

      setDocumentReader({
        fileObjectId,
        requestId,
        status: "loading",
        text: "",
        initialLocation
      });

      void loadDocumentReaderExtract(workspace, fileObjectId, indexedDbBlobStore, abortController.signal).then(
        (result) => {
          setDocumentReader((current) => {
            if (
              !current ||
              !shouldAcceptDocumentReaderLoadResult(
                { openFileObjectId: current.fileObjectId, requestId: current.requestId },
                { fileObjectId, requestId }
              )
            ) {
              return current;
            }

            if (result.status === "loaded") {
              return {
                ...current,
                status: "loaded",
                text: result.text,
                extractAsset: result.asset,
                initialLocation,
                message: undefined
              };
            }

            return {
              ...current,
              status: result.status,
              text: "",
              extractAsset: undefined,
              initialLocation: undefined,
              message: result.message
            };
          });
        }
      );
    },
    [workspace]
  );

  const handleOpenDeliveryReferenceReader = useCallback(
    (transition: DeliveryReferenceReaderTransition) => {
      setActiveDeliveryObjectId(transition.activeDeliveryObjectId);
      setActiveDeliverySectionId(transition.activeSectionId);
      if (transition.closeDeliveryPanel) {
        setDeliveryPanelOpen(false);
      }
      handleOpenDocumentReader(transition.fileObjectId, transition.initialLocation);
    },
    [handleOpenDocumentReader]
  );

  const handleExtractDocumentFragment = useCallback(
    (input: { blockIds: string[]; title: string; summary: string }): DocumentReaderExtractFragmentResult => {
      if (!documentReader || documentReader.status !== "loaded") {
        return { status: "blocked", reason: "Document reader is not ready." };
      }

      const file = workspace.objects[documentReader.fileObjectId];
      if (!file || file.type !== "file") {
        return { status: "blocked", reason: "Document fragment source file is unavailable." };
      }

      const selection = resolveDocumentFragmentSelection(workspace, {
        fileObjectId: file.id,
        extractAssetId: documentReader.extractAsset?.id ?? file.extractedAssetId ?? "",
        blockIds: input.blockIds,
        title: input.title,
        sourceText: documentReader.text
      });
      if (selection.status !== "ready") {
        setDocumentReader((current) =>
          current && current.fileObjectId === file.id
            ? {
                ...current,
                status: "loaded",
                message: selection.reason,
                createdFragmentId: undefined
              }
            : current
        );
        return { status: "blocked", reason: selection.reason };
      }

      const draft = buildDocumentFragmentDraft(workspace, selection, {
        title: input.title,
        summary: input.summary
      });
      if (draft.status !== "ready") {
        setDocumentReader((current) =>
          current && current.fileObjectId === file.id
            ? {
                ...current,
                status: "loaded",
                message: draft.reason,
                createdFragmentId: undefined
              }
            : current
        );
        return { status: "blocked", reason: draft.reason };
      }

      const created = createDocumentFragmentWithContinuity(workspace, draft.draft);
      setWorkspace(created.workspace);
      setDocumentReader((current) =>
        current && current.fileObjectId === file.id
          ? {
              ...current,
              status: "loaded",
              createdFragmentId: created.fragment.id,
              message: "已提取到画布"
            }
          : current
      );
      return { status: "created", fragmentId: created.fragment.id };
    },
    [documentReader, setWorkspace, workspace]
  );

  const handleViewCreatedDocumentFragment = useCallback(
    (fragmentId: string) => {
      setDocumentReader(null);
      setSelectedObjectIds([fragmentId]);
      setWorkspace((current) => ({
        ...current,
        ui: {
          ...current.ui,
          lastSelectionIds: [fragmentId]
        }
      }));
      setFocusRequest((current) => ({ objectId: fragmentId, nonce: current.nonce + 1 }));
    },
    [setWorkspace]
  );

  const handleCloseDocumentReader = useCallback(() => {
    documentReaderAbortRef.current?.abort();
    documentReaderAbortRef.current = null;
    documentReaderRequestRef.current += 1;
    setDocumentReader(null);
  }, []);

  useEffect(
    () => () => {
      documentReaderAbortRef.current?.abort();
    },
    []
  );

  const documentReaderFile = documentReader ? workspace.objects[documentReader.fileObjectId] : undefined;
  const documentReaderInitialLocation = documentReader?.initialLocation ?? null;

  return (
    <main className="workspace">
      <MorphoCanvas
        workspace={workspace}
        annotatedObjectId={localEditObjectId}
        traceObjectIds={activeDesignTrace?.objectIds ?? []}
        traceEdges={activeDesignTrace?.edges ?? []}
        assetUrls={assetUrls}
        focusRequest={focusRequest}
        onSelectionChange={handleSelectionChange}
        onInstancesChange={handleInstancesChange}
        onViewChange={handleCanvasViewChange}
        onImportRequest={handleImportRequest}
      />

      <TopControls
        projectTitle={workspace.project.title}
        persistenceError={
          persistenceState.phase === "error" && persistenceState.error && !persistenceState.migrationError
            ? persistenceState.error
            : undefined
        }
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
        onOpenDeliveryPreparation={() => openDeliveryPreparation()}
        onOpenProjectBundles={() => {
          setBundleMessage(null);
          setDeliveryOutputPanelOpen(false);
          setBundlePanelOpen((current) => !current);
        }}
        onOpenDeliveryOutput={() => {
          setDeliveryOutputMessage(null);
          setDeliveryOutputPreflight(null);
          setBundlePanelOpen(false);
          setDeliveryOutputPanelOpen((current) => !current);
        }}
      />
      {deliveryOutputPanelOpen ? (
        <DeliveryOutputPanel
          workspace={workspace}
          selectedObjectIds={selectedObjectIds}
          activeDeliveryObjectId={activeDeliveryObjectId}
          busyLabel={deliveryOutputBusyLabel}
          message={deliveryOutputMessage}
          preflight={deliveryOutputPreflight}
          onClose={() => setDeliveryOutputPanelOpen(false)}
          onInspect={handleInspectDeliveryOutput}
          onExport={handleExportDeliveryOutput}
        />
      ) : null}
      {bundlePanelOpen ? (
        <ProjectBundlePanel
          archiveIncludeFullChat={archiveIncludeFullChat}
          archiveIncludeContinuity={archiveIncludeContinuity}
          backupIncludeFullChat={backupIncludeFullChat}
          restorePreview={inspectedBackup?.preview ?? null}
          busyLabel={bundleBusyLabel}
          message={bundleMessage}
          onClose={() => setBundlePanelOpen(false)}
          onArchiveIncludeFullChatChange={setArchiveIncludeFullChat}
          onArchiveIncludeContinuityChange={setArchiveIncludeContinuity}
          onBackupIncludeFullChatChange={setBackupIncludeFullChat}
          onExportArchive={handleExportHumanArchive}
          onExportBackup={handleExportEditableBackup}
          onInspectBackup={handleInspectEditableBackup}
          onCancelRestorePreview={handleCancelRestorePreview}
          onConfirmRestoreBackup={handleConfirmRestoreEditableBackup}
        />
      ) : null}
      <LeftRail activeDrawer={activeDrawer} onDrawerChange={setActiveDrawer} />
      <OverlayDrawers
        mode={activeDrawer}
        workspace={workspace}
        highlightedRecordIds={highlightContinuityEntryIds}
        onClose={() => setActiveDrawer(null)}
        onFocusArea={focusArea}
        onRestoreObject={handleRestoreObject}
        onLocateObject={focusObject}
        onSetContinuityEntryManualState={handleSetContinuityEntryManualState}
      />

      {documentReader && documentReaderFile?.type === "file" ? (
        <DocumentReaderPanel
          key={`${documentReader.fileObjectId}-${documentReader.requestId}`}
          file={documentReaderFile}
          extractAsset={documentReader.extractAsset}
          text={documentReader.text}
          status={documentReader.status}
          message={documentReader.message}
          initialLocation={documentReaderInitialLocation}
          createdFragmentId={documentReader.createdFragmentId}
          onExtractFragment={handleExtractDocumentFragment}
          onViewCreatedFragment={handleViewCreatedDocumentFragment}
          onClose={handleCloseDocumentReader}
        />
      ) : null}

      {deliveryPanelOpen ? (
        <DeliveryPreparationPanel
          workspace={workspace}
          assetUrls={assetUrls}
          selectedObjects={selectedObjects}
          activeDeliveryObjectId={activeDeliveryObjectId}
          activeDeliverySectionId={activeDeliverySectionId}
          isStreaming={isAiStreaming}
          onClose={() => setDeliveryPanelOpen(false)}
          onCreateDelivery={handleCreateDelivery}
          onSelectDelivery={(deliveryObjectId) => {
            setActiveDeliveryObjectId(deliveryObjectId);
            setActiveDeliverySectionId(null);
          }}
          onSelectDeliverySection={setActiveDeliverySectionId}
          onLocateObject={focusObject}
          onOpenDeliveryReferenceReader={handleOpenDeliveryReferenceReader}
          onAddSelectedObjects={(input) =>
            applyDeliveryOperation((current) =>
              addObjectsToDeliverySection(current, {
                ...input
              })
            )
          }
          onCreateSection={handleCreateDeliverySection}
          onUpdateSection={(input) => applyDeliveryOperation((current) => updateDeliverySection(current, input))}
          onMoveSection={(input) => applyDeliveryOperation((current) => moveDeliverySection(current, input))}
          onRemoveSection={(input) => applyDeliveryOperation((current) => removeDeliverySection(current, input))}
          onMoveReference={(input) => applyDeliveryOperation((current) => moveDeliveryReference(current, input))}
          onRemoveReference={(input) => applyDeliveryOperation((current) => removeDeliveryReference(current, input))}
          onUpdateReferenceEditorial={(input) =>
            applyDeliveryOperation((current) => updateDeliveryReferenceEditorial(current, input))
          }
          onRefreshReference={(input) =>
            applyDeliveryOperation((current) =>
              refreshDeliveryReferenceSnapshot(current, {
                ...input,
                reason: "用户在交付准备面板中确认更新为当前版本。"
              })
            )
          }
          onAddGap={(input) =>
            applyDeliveryOperation((current) =>
              addDeliveryGap(current, {
                ...input,
                origin: "manual"
              })
            )
          }
          onSetGapStatus={(input) => applyDeliveryOperation((current) => setDeliveryGapStatus(current, input))}
          onRemoveGap={(input) => applyDeliveryOperation((current) => removeDeliveryGap(current, input))}
          onRequestSectionDraft={handleRequestDeliverySectionDraft}
          onApplyDraft={handleApplyDeliveryDraft}
          onDiscardDraft={handleDiscardDeliveryDraft}
        />
      ) : null}

      <AiConversationPanel
        workspace={workspace}
        selectedObjects={selectedObjects}
        suggestions={suggestions}
        draft={aiDraft}
        isOpen={aiOpen}
        isLocalEditMode={isImageTaskMode}
        taskMode={taskMode}
        recommendedTaskMode={recommendedTaskMode}
        workIntent={workIntent}
        recommendedWorkIntent={recommendedWorkIntent}
        availableWorkIntents={availableWorkIntents}
        activeProposal={activeProposal}
        isStreaming={isAiStreaming}
        imageGenerationSettings={effectiveImageGenerationSettings}
        imageGenerationModelOptions={imageGenerationModelOptions}
        directionPreviewCount={directionPreviewCount}
        pendingConfirmation={pendingConfirmation}
        showFailure={showFailure}
        imageTaskStatus={imageTaskStatus}
        contextWarning={contextWarning}
        migrationError={persistenceState.migrationError}
        onToggleOpen={() => setAiOpen((open) => !open)}
        onDraftChange={setAiDraft}
        onTaskModeChange={setTaskMode}
        onWorkIntentChange={handleWorkIntentChange}
        onImageGenerationSettingsChange={updateImageGenerationSettings}
        onDirectionPreviewCountChange={setDirectionPreviewCount}
        onSuggestionClick={handleSuggestionClick}
        onSendMessage={handleSendAiMessage}
        onCancelRequest={handleCancelAiRequest}
        onRunLocalEdit={handleRunLocalEdit}
        onApplyProposal={handleApplyProposal}
        onRejectProposal={handleRejectProposal}
        onContinueProposalDiscussion={handleContinueProposalDiscussion}
        onRegenerateProposal={handleRegenerateProposal}
        onSaveResearchProposalDraft={handleSaveResearchProposalDraft}
        onSaveDesignDefinitionProposalDraft={handleSaveDesignDefinitionProposalDraft}
        onSaveConceptDirectionProposalDraft={handleSaveConceptDirectionProposalDraft}
        onUpdatePendingKeyConclusion={handleUpdatePendingKeyConclusion}
        onUpdatePendingComparison={handleUpdatePendingComparison}
        onRequestComparisonAction={handleRequestComparisonAction}
        onLocateObject={focusObject}
        onConfirmPending={handleConfirmPending}
        onCancelPending={() => setPendingConfirmation(null)}
        onFailureRetry={() => setShowFailure(false)}
        onOpenProjectRecords={openProjectRecords}
      />

      <BottomDetailBar
        workspace={workspace}
        selectedObjects={selectedObjects}
        assets={workspace.assets}
        hasPendingDesignDefinitionRevisionDraft={hasPendingDesignDefinitionRevisionDraft}
        relations={workspace.relations}
        directionLineage={workspace.directionLineage}
        visualBranches={workspace.visualBranches}
        decisionRecords={workspace.decisionRecords}
        activeDesignTrace={activeDesignTrace}
        isDesignTraceActive={Boolean(activeDesignTrace)}
        onToggleDesignTrace={handleToggleDesignTrace}
        onAskAi={handleAskAi}
        onReviseDirection={handleReviseDirectionIntent}
        onSplitDirection={handleSplitDirectionIntent}
        onMergeDirections={handleMergeDirectionsIntent}
        onCreateVisualBranch={handleCreateVisualBranch}
        onRenameVisualBranch={handleRenameVisualBranch}
        onArchiveVisualBranch={handleArchiveVisualBranch}
        onRestoreVisualBranch={handleRestoreVisualBranch}
        onAssignImageToVisualBranch={handleAssignImageToVisualBranch}
        onRemoveImageFromVisualBranch={handleRemoveImageFromVisualBranch}
        onLocalEdit={handleLocalEdit}
        onReferenceIntent={handleReferenceIntent}
        onHide={handleHideSelected}
        onDelete={handleDeleteSelected}
        onEliminateDirection={handleEliminateDirection}
        onSetDirectionPrimary={handleSetDirectionPrimary}
        onSetDirectionAlternative={handleSetDirectionAlternative}
        onRestoreDirectionAsAlternative={handleRestoreDirectionAsAlternative}
        keyConclusionCandidates={keyConclusionCandidates}
        onSaveKeyConclusionFromResearchItem={handleSaveKeyConclusionFromResearchItem}
        onCopyItemToDraft={handleCopyItemToDraft}
        onContinueQuestion={handleContinueQuestion}
        onSetKeyConclusionState={handleSetKeyConclusionState}
        onSetImageRole={handleSetImageRole}
        onOpenDocumentReader={handleOpenDocumentReader}
        onOpenDeliveryPreparation={openDeliveryPreparation}
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

function getPlacementNearObjects(
  workspace: MorphoWorkspace,
  sourceObjectIds: string[],
  fallback: { x: number; y: number }
): { x: number; y: number } {
  const sourceInstances = sourceObjectIds
    .map((objectId) => workspace.canvas.instances.find((instance) => instance.objectId === objectId))
    .filter((instance): instance is CanvasInstance => Boolean(instance));

  if (sourceInstances.length === 0) {
    return fallback;
  }

  const right = Math.max(...sourceInstances.map((instance) => instance.position.x + instance.size.w));
  const top = Math.min(...sourceInstances.map((instance) => instance.position.y));
  return {
    x: right + 92,
    y: top
  };
}

function getGeneratedImagePlacement(
  workspace: MorphoWorkspace,
  planItems: VisualGenerationPlanItem[],
  item: VisualGenerationPlanItem,
  index: number,
  precomputedDirectionPreviewPosition?: { x: number; y: number }
): { x: number; y: number } {
  if (precomputedDirectionPreviewPosition) {
    return precomputedDirectionPreviewPosition;
  }

  if (item.targetDirectionId) {
    const directionItems = planItems.filter((candidate) => candidate.targetDirectionId === item.targetDirectionId);
    if (directionItems.length > 1 || item.role === "conceptImage") {
      const placements = planDirectionPreviewPlacements(
        workspace,
        directionItems.map((candidate) => ({
          id: candidate.id,
          targetDirectionId: candidate.targetDirectionId,
          width: 320,
          height: 240
        }))
      );
      const placement = placements.find((candidate) => candidate.planItemId === item.id);
      if (placement) {
        return placement.position;
      }
    }
  }

  const sourceInstance = item.referenceObjectIds
    .map((objectId) => workspace.canvas.instances.find((instance) => instance.objectId === objectId))
    .find(Boolean);
  if (sourceInstance) {
    return {
      x: sourceInstance.position.x + sourceInstance.size.w + 92,
      y: sourceInstance.position.y + index * 34
    };
  }

  const directionInstance = item.targetDirectionId
    ? workspace.canvas.instances.find((instance) => instance.objectId === item.targetDirectionId)
    : undefined;
  if (directionInstance) {
    return {
      x: directionInstance.position.x,
      y: directionInstance.position.y + directionInstance.size.h + 72 + index * 36
    };
  }

  return {
    x: workspace.canvas.view.x + 180 + index * 42,
    y: workspace.canvas.view.y + 180 + index * 42
  };
}

async function parseImportedDocuments(
  targets: Array<{ objectId: string; file: File }>,
  setWorkspace: (updater: (current: MorphoWorkspace) => MorphoWorkspace) => void
): Promise<void> {
  for (const target of targets) {
    if (!shouldAttemptDocumentParse(target.file)) {
      continue;
    }

    setWorkspace((current) => markFileObjectParsing(current, target.objectId));
    const parsed = await parseDocumentFile(target.file);
    if (parsed.status === "failed") {
      setWorkspace((current) =>
        markFileObjectParseFailed(current, {
          fileObjectId: target.objectId,
          reason: parsed.reason
        })
      );
      continue;
    }

    const extractFile = createDocumentExtractFile(target.file, parsed.text);
    const saved = await saveBlobAsLocalAsset(indexedDbBlobStore, extractFile, "documentExtract");
    if (saved.status === "failed") {
      setWorkspace((current) =>
        markFileObjectParseFailed(current, {
          fileObjectId: target.objectId,
          reason: saved.reason
        })
      );
      continue;
    }

    setWorkspace((current) =>
      attachDocumentExtractToFileObject(current, {
        fileObjectId: target.objectId,
        extractAsset: saved.asset,
        extractedCharCount: parsed.text.length,
        extractedPageCount: parsed.pageCount
      })
    );
  }
}

function resolveConceptDirectionApplicationScope(
  workspace: MorphoWorkspace,
  selectedObjectIds: string[],
  workIntent: AiWorkIntent
): Pick<ConceptDirectionProposal, "applicationMode" | "targetDirectionId" | "parentDirectionIds"> {
  const selectedDirectionIds = selectedObjectIds.filter(
    (objectId) => workspace.objects[objectId]?.type === "conceptDirection"
  );

  switch (workIntent) {
    case "reviseConceptDirection":
      return {
        applicationMode: "revise",
        targetDirectionId: selectedDirectionIds.length === 1 ? selectedDirectionIds[0] : undefined,
        parentDirectionIds: []
      };
    case "splitConceptDirection":
      return {
        applicationMode: "split",
        parentDirectionIds: selectedDirectionIds.length === 1 ? [selectedDirectionIds[0] as string] : []
      };
    case "mergeConceptDirections":
      return {
        applicationMode: "merge",
        parentDirectionIds: selectedDirectionIds.length >= 2 ? selectedDirectionIds : []
      };
    case "createConceptDirections":
    default:
      return {
        applicationMode: "create",
        parentDirectionIds: []
      };
  }
}

function appendOperationBlockedMessage(
  workspace: MorphoWorkspace,
  operation: OperationRecord,
  reason: string
): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: [
        ...workspace.ai.messages,
        {
          id: `ai-operation-blocked-${Date.now()}`,
          role: "assistant",
          body: `${reason} 当前未完成任务：${operation.userInput}（${operation.status}）。`,
          status: "failed",
          createdAt: new Date().toISOString(),
          operationId: operation.id
        }
      ]
    }
  };
}

function makeTaskObjectSummaries(summaries: Array<{ id: string; type: string; title: string; summary: string; detail?: string }>) {
  return summaries.map((summary) => ({
    id: summary.id,
    type: summary.type,
    title: summary.title,
    summary: summary.detail ? `${summary.summary}\n${summary.detail}` : summary.summary
  }));
}

function summarizeBundleDiagnostics(base: string, diagnostics: Array<{ severity: "info" | "warning" | "error" }>): string {
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  if (errorCount > 0) {
    return `${base} 另有 ${errorCount} 条错误诊断。`;
  }
  if (warningCount > 0) {
    return `${base} 另有 ${warningCount} 条 warning，请检查包内说明。`;
  }
  return base;
}

function summarizeTaskDefaultReferenceStatus(status: TaskContextDefaultReference): string {
  switch (status.status) {
    case "included":
      return `included:${status.objectId}:${status.reason}`;
    case "hidden":
      return `hidden:${status.objectId}:${status.reason}`;
    case "missing":
      return `missing:${status.reason}`;
    case "notIncluded":
      return status.objectId ? `notIncluded:${status.objectId}:${status.reason}` : `notIncluded:${status.reason}`;
  }
}

function updateAiMessage(
  workspace: MorphoWorkspace,
  messageId: string,
  body: string,
  status: "streaming" | "done" | "failed",
  options: { citationIds?: string[]; continuityEntryIds?: string[] } = {}
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
              continuityEntryIds: options.continuityEntryIds ?? message.continuityEntryIds,
              error: status === "failed" ? body : undefined
            }
          : message
      )
    }
  };
}

function appendAiAssistantFailureMessage(
  workspace: MorphoWorkspace,
  prefix: string,
  body: string,
  proposalId?: string
): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: [
        ...workspace.ai.messages,
        {
          id: `${prefix}-${Date.now()}`,
          role: "assistant",
          body,
          status: "failed",
          createdAt: new Date().toISOString(),
          proposalId
        }
      ]
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
    if (signal.aborted || images.length >= GRS_REFERENCE_IMAGE_LIMIT) {
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

function buildKeyConclusionDraftFromObject(object: MorphoObject):
  | {
      title: string;
      body: string;
      summary: string;
      confidence: "supported" | "partial" | "needsVerification";
      state?: "active" | "needsVerification";
      note: string;
    }
  | null {
  switch (object.type) {
    case "research": {
      const primaryClaim =
        object.findings[0] ??
        object.opportunities[0] ??
        object.constraints[0] ??
        object.openQuestions[0] ??
        object.summary;
      return {
        title: truncateForTitle(primaryClaim || object.title, "关键结论"),
        summary: primaryClaim || object.summary,
        body: buildResearchConclusionBody(object),
        confidence: inferResearchConfidence(object),
        state: inferResearchConfidence(object) === "needsVerification" ? "needsVerification" : "active",
        note: `用户从研究对象“${object.title}”中明确保留关键结论。`
      };
    }
    case "text":
      return {
        title: truncateForTitle(object.title || object.summary, "关键结论"),
        summary: object.summary,
        body: object.body,
        confidence: "needsVerification",
        state: "needsVerification",
        note: `用户从文本对象“${object.title}”中保留关键结论，后续仍需复核。`
      };
    case "link":
      return {
        title: truncateForTitle(object.editableTitle || object.title, "关键结论"),
        summary: object.summary,
        body: [object.description, object.summary, object.url].filter(Boolean).join("\n\n"),
        confidence: "needsVerification",
        state: "needsVerification",
        note: `用户从链接对象“${object.title}”中保留关键结论，后续仍需复核来源有效性。`
      };
    case "file":
      return {
        title: truncateForTitle(object.title, "关键结论"),
        summary: object.summary,
        body: [object.summary, object.fileName, object.mimeType].filter(Boolean).join("\n\n"),
        confidence: "needsVerification",
        state: "needsVerification",
        note: `用户从文件对象“${object.title}”中保留关键结论，后续仍需复核原始资料。`
      };
    default:
      return null;
  }
}

function buildResearchConclusionBody(object: Extract<MorphoObject, { type: "research" }>): string {
  const lines = [
    object.summary,
    object.findings[0] ? `发现：${object.findings[0]}` : undefined,
    object.opportunities[0] ? `机会：${object.opportunities[0]}` : undefined,
    object.constraints[0] ? `约束：${object.constraints[0]}` : undefined,
    object.openQuestions[0] ? `待验证：${object.openQuestions[0]}` : undefined
  ].filter(Boolean);

  return lines.join("\n");
}

function inferResearchConfidence(object: Extract<MorphoObject, { type: "research" }>): "supported" | "partial" | "needsVerification" {
  const confidences = object.evidence?.map((item) => item.confidence) ?? [];
  if (confidences.includes("needsVerification")) {
    return "needsVerification";
  }

  if (confidences.includes("partial") || confidences.length === 0) {
    return "partial";
  }

  return "supported";
}

function getObjectCitationIds(object: MorphoObject): string[] {
  if (object.type === "research") {
    return [...(object.provenance?.citationIds ?? [])];
  }

  return [];
}

function truncateForTitle(input: string, fallback: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
}

function validatePendingComparisonConfirmation(
  current: MorphoWorkspace,
  confirmation: PendingComparisonConfirmation
): ReturnType<typeof validateComparisonActionTarget> {
  const targetValidation = validateComparisonActionTarget(
    current,
    confirmation.comparisonAnalysisId,
    comparisonActionFromPending(confirmation),
    "targetObjectId" in confirmation ? confirmation.targetObjectId : undefined
  );
  if (targetValidation.status !== "ok" || confirmation.kind !== "compareCreateKeyConclusion") {
    return targetValidation;
  }
  return validateComparisonKeyConclusionSources(
    current,
    confirmation.comparisonAnalysisId,
    confirmation.keyConclusionSourceObjectIds
  );
}

function comparisonActionFromPending(confirmation: PendingComparisonConfirmation): ComparisonActionKind {
  switch (confirmation.kind) {
    case "compareSetPrimary":
      return "setPrimary";
    case "compareSetAlternative":
      return "setAlternative";
    case "compareEliminate":
      return "eliminate";
    case "compareRestoreAlternative":
      return "restoreAlternative";
    case "compareSetDefaultReference":
      return "setDefaultReference";
    case "compareClearDefaultReference":
      return "clearDefaultReference";
    case "compareCreateKeyConclusion":
      return "createKeyConclusion";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
