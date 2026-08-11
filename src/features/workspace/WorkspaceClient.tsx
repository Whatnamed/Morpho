"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction
} from "react";

import type {
  AiTaskMode,
  AiWorkIntent,
  CanvasView,
  ContinuityManualState,
  MorphoObject
} from "@/domain/morpho/types";
import { isAssignableKeyConclusionCategory } from "@/domain/morpho/types";
import type { GrsImageAspectRatio } from "@/domain/morpho/grsImageModels";
import type { ConversationTokenLimits } from "@/domain/morpho/conversationCompaction";
import { MORPHO_AGENT_CONTEXT_POLICY } from "@/domain/morpho/agentContextPolicy";
import { GRS_REFERENCE_IMAGE_LIMIT } from "@/domain/morpho/imageLimits";
import { hasPendingDesignDefinitionRevisionProposal } from "@/domain/morpho/derivedState";
import { traceDesignChain, type DesignTraceResult } from "@/domain/morpho/designTrace";
import {
  areStageRegionRecordsEqual,
  ensureStageRegions,
  fitStageRegionToVisibleMembers,
  getStageRegions,
  hasVisibleStageRegionMembers,
  resetStageRegionStyle,
  updateStageRegionStyle,
  type StageRegionRecord
} from "@/domain/morpho/stageRegions";
import { collectPrimaryCanvasTrace } from "./tldraw/primaryCanvasTrace";
import {
  getActiveOperation,
  setCurrentDesignDefinition,
} from "@/domain/operations/operations";
import type { ConceptDirectionProposal, OperationRecord } from "@/domain/operations/types";
import {
  archiveVisualBranch,
  assignImageToVisualBranch,
  buildKeyConclusionDraftFromResearchSource,
  createKeyConclusion,
  createAiDraftFromSuggestion,
  deleteObjects,
  clearDefaultReference,
  clearVisualReviewMark,
  collectDefaultReferenceReviewTargets,
  hideObjects,
  removeImageFromVisualBranch,
  reorderCanvasInstances,
  restoreObject,
  restoreVisualBranch,
  setKeyConclusionCategory,
  setConceptDirectionStatus,
  setDefaultReference,
  type ResearchKeyConclusionSource,
  type CanvasLayerReorderAction
} from "@/domain/morpho/workspace";
import type { AssignableKeyConclusionCategory, CanvasInstance, MorphoWorkspace } from "@/domain/morpho/types";
import { readClipboardAsImportPayload } from "./canvasClipboardImport";
import { AiConversationPanel } from "./components/AiConversationPanel";
import type { PendingAiConfirmation } from "./workspaceConfirmation";
import { BottomDetailBar } from "./components/BottomDetailBar";
import { ConceptDirectionDetail } from "./components/ConceptDirectionDetail";
import { DesignDefinitionDetail } from "./components/DesignDefinitionDetail";
import { DeliveryPreparationPanel } from "./components/DeliveryPreparationPanel";
import { DeliveryOutputPanel } from "./components/DeliveryOutputPanel";
import { DocumentReaderPanel } from "./components/DocumentReaderPanel";
import { LeftRail } from "./components/LeftRail";
import { OverlayDrawers } from "./components/OverlayDrawers";
import { ProposalDraftCard } from "./components/ProposalDraftCard";
import { ProjectBundlePanel } from "./components/ProjectBundlePanel";
import { ResearchDetailPanel } from "./components/ResearchDetailPanel";
import { CanvasContextMenu, SelectionToolbar } from "./components/SelectionToolbar";
import { SaveFailureBanner } from "./components/SaveFailureBanner";
import { TopControls } from "./components/TopControls";
import { WorkspaceStarter } from "./components/WorkspaceStarter";
import { usePersistentWorkspace } from "./usePersistentWorkspace";
import { useDeliveryOutputController } from "./useDeliveryOutputController";
import { useProjectBundleController } from "./useProjectBundleController";
import { useWorkspaceAssetUrls } from "./useWorkspaceAssetUrls";
import { compactObjectList, getKeyConclusionCategoryLabel, getSuggestionsForSelection, type Suggestion } from "./workspaceUi";
import { getFloatingMenuPlacement, type SelectionToolbarPlacement } from "./selectionToolbar";
import { resolveWorkspaceShortcut } from "./workspaceShortcuts";
import type { DeliveryReferenceReaderTransition } from "./deliveryPreparationUi";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import {
  getAvailableAiWorkIntents,
  recommendAiTaskMode,
  recommendAiWorkIntent
} from "./aiTaskRouting";
import { useDocumentReaderController } from "./useDocumentReaderController";
import { useDeliveryPreparationController } from "./useDeliveryPreparationController";
import {
  useWorkspaceSurfaceController,
  type WorkspaceExternalSurfacePorts
} from "./useWorkspaceSurfaceController";
import {
  useWorkspaceSelectionNavigationController
} from "./useWorkspaceSelectionNavigationController";
import { useWorkspaceObjectHistoryController } from "./useWorkspaceObjectHistoryController";
import { isComparisonPendingConfirmation } from "./comparisonDecision";
import { useWorkspaceComparisonDecisionController } from "./useWorkspaceComparisonDecisionController";
import {
  useWorkspaceImportController,
  type WorkspaceImportSessionHandle
} from "./useWorkspaceImportController";
import {
  applyResearchExtractionSelection,
  getResearchExtractionRecommendationKeys
} from "./researchExtraction";
import {
  type TaskContextDefaultReference
} from "./taskContext";
import { setConversationSemanticEntryManualState } from "@/domain/morpho/projectContinuity";
import {
  getDefaultImageGenerationSettings,
  inferGenerationAspectRatio,
  resolveGenerationSettings,
  type ImageGenerationSettings
} from "./imageGenerationSettings";
import {
  type MorphoAgentTurnMode
} from "./morphoAgent";
import {
  commitWorkspaceStateNow,
  createWorkspaceMutationBlockedError
} from "./workspaceCommitBoundary";
import { canMutateWorkspace as resolveCanMutateWorkspace } from "./workspacePersistence";
import { ensureWorkspaceStageRegionsIfWritable } from "./workspaceNormalization";
import {
  applyWorkspaceTextPromptIfCurrent,
  createWorkspaceTextPromptSession,
  isWorkspaceTextPromptSessionCurrent,
  type WorkspaceTextPrompt,
  type WorkspaceTextPromptCommitResult,
  type WorkspaceTextPromptSession,
  type WorkspaceTextPromptState
} from "./workspaceTextPrompt";
import { useWorkspaceAgentRuntimeController } from "./useWorkspaceAgentRuntimeController";
import { useWorkspaceProposalWorkflowController } from "./useWorkspaceProposalWorkflowController";
import {
  useWorkspaceVisualGenerationController
} from "./useWorkspaceVisualGenerationController";
import { useWorkspaceConfirmationController } from "./useWorkspaceConfirmationController";
import { useWorkspaceConfirmationExecutionController } from "./useWorkspaceConfirmationExecutionController";
import type { PendingImageGenerationSlot } from "./pendingImageGenerationSlots";
import type {
  ImageTaskStatus
} from "./workspaceVisualGenerationExecution";
import type { FocusArea } from "./tldraw/MorphoCanvas";

const MorphoCanvas = dynamic(() => import("./tldraw/MorphoCanvas").then((mod) => mod.MorphoCanvas), {
  ssr: false,
  loading: () => <div className="workspace-canvas" aria-label="画布正在加载" />
});

const CONVERSATION_TOKEN_LIMITS_TEST_KEY = "morpho:test:conversation-token-limits";

export function readConversationTokenLimitsOverride(): ConversationTokenLimits | undefined {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") {
    return undefined;
  }
  const raw = window.localStorage.getItem(CONVERSATION_TOKEN_LIMITS_TEST_KEY);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ConversationTokenLimits>;
    const values = [
      parsed.windowTokens,
      parsed.prepareTokens,
      parsed.compactTokens,
      parsed.targetUncompressedTokens,
      parsed.responseReserveTokens,
      parsed.prepareItemCount ?? MORPHO_AGENT_CONTEXT_POLICY.prepareItemCount,
      parsed.compactItemCount ?? MORPHO_AGENT_CONTEXT_POLICY.compactItemCount
    ];
    if (!values.every((value) => Number.isSafeInteger(value) && (value ?? 0) > 0)) {
      return undefined;
    }
    const limits: ConversationTokenLimits = {
      ...(parsed as ConversationTokenLimits),
      prepareItemCount: parsed.prepareItemCount ?? MORPHO_AGENT_CONTEXT_POLICY.prepareItemCount,
      compactItemCount: parsed.compactItemCount ?? MORPHO_AGENT_CONTEXT_POLICY.compactItemCount
    };
    if (
      limits.prepareTokens >= limits.compactTokens ||
      limits.compactTokens >= limits.windowTokens ||
      limits.targetUncompressedTokens >= limits.compactTokens ||
      limits.responseReserveTokens >= limits.windowTokens ||
      limits.prepareItemCount >= limits.compactItemCount
    ) {
      return undefined;
    }
    return limits;
  } catch {
    return undefined;
  }
}

type WorkspaceClientProps = {
  projectId: string;
};

type PendingImportPicker = {
  projectId: string;
  session: WorkspaceImportSessionHandle;
  position?: { x: number; y: number };
};

type SaveResearchKeyConclusionInput = {
  researchObjectId: string;
} & ResearchKeyConclusionSource;

type ObjectOperationUndoEntry = {
  workspace: MorphoWorkspace;
  selectedObjectIds: string[];
  localEditObjectId: string | null;
};

export function WorkspaceClient({ projectId }: WorkspaceClientProps) {
  const router = useRouter();
  const [workspace, setPersistentWorkspace, persistenceState, flushWorkspace] = usePersistentWorkspace(projectId);
  const workspaceReady = persistenceState.isWorkspaceLoaded && workspace.project.id === projectId;
  const canMutateWorkspace = resolveCanMutateWorkspace({
    persistence: persistenceState,
    isWorkspaceLoaded: persistenceState.isWorkspaceLoaded,
    routeProjectId: projectId,
    workspaceProjectId: workspace.project.id,
    migrationError: persistenceState.migrationError
  });
  const canMutateWorkspaceRef = useRef(canMutateWorkspace);
  const workspaceRef = useRef(workspace);
  useLayoutEffect(() => {
    canMutateWorkspaceRef.current = canMutateWorkspace;
    workspaceRef.current = workspace;
  }, [canMutateWorkspace, workspace]);
  const setWorkspace = useCallback(
    (action: SetStateAction<MorphoWorkspace>) => {
      if (!canMutateWorkspaceRef.current) return;
      setPersistentWorkspace(action);
    },
    [setPersistentWorkspace]
  );
  const workspaceSurface = useWorkspaceSurfaceController({
    projectId,
    projectTitle: workspace.project.title,
    workspaceReady
  });
  const {
    activeDrawer,
    drawerAnchor,
    highlightedContinuityEntryIds,
    projectMenuOpen,
    projectRenameDraft,
    canvasContextMenu,
    detailProposalId,
    detailDesignDefinitionId,
    detailConceptDirectionId,
    activeResearchDetailObjectId,
    changeDrawer,
    openProjectRecords,
    toggleProjectMenu,
    setProjectRenameDraft,
    consumeProjectRename,
    openCanvasContextMenu,
    closeCanvasContextMenu,
    canDismissCanvasContextMenu,
    openProposalDetail,
    closeProposalDetail,
    closeProposalDetailIf,
    openDesignDefinitionDetail,
    closeDesignDefinitionDetail,
    openConceptDirectionDetail,
    closeConceptDirectionDetail,
    openResearchDetail,
    closeResearchDetail,
    closeTopSurface
  } = workspaceSurface;
  const {
    selectedObjectIds,
    selectionRequest,
    focusRequest,
    setSelectedObjectIds,
    requestCanvasSelection,
    acceptCanvasSelection,
    focusArea: requestFocusArea,
    focusObject: requestFocusObject,
    requestObjectFocus,
    locateObjectFromDetail: requestLocateObjectFromDetail,
    undoDetailNavigation,
    commitCanvasView,
    observeCanvasView,
    getLatestCanvasView,
    clearCanvasSelection: clearControllerCanvasSelection,
    selectAllCanvasObjects: selectAllControllerCanvasObjects
  } = useWorkspaceSelectionNavigationController({
    projectId,
    workspace,
    workspaceReady,
    updateWorkspace: setWorkspace
  });
  const handleProjectBundleWorkspaceRestored = useCallback(
    ({ projectId: restoredProjectId }: { projectId: string }) => {
      startTransition(() => {
        router.push(`/projects/${encodeURIComponent(restoredProjectId)}`);
      });
    },
    [router]
  );
  const {
    isOpen: isDeliveryOutputOpen,
    busyLabel: deliveryOutputBusyLabel,
    message: deliveryOutputMessage,
    preflight: deliveryOutputPreflight,
    close: closeDeliveryOutput,
    toggle: toggleDeliveryOutput,
    inspect: inspectDeliveryOutput,
    exportPackage: exportDeliveryOutput
  } = useDeliveryOutputController({ projectId, workspaceReady, workspace });
  const {
    isOpen: isProjectBundleOpen,
    archiveIncludeFullChat,
    archiveIncludeContinuity,
    busyLabel: bundleBusyLabel,
    message: bundleMessage,
    inspectedBackup,
    close: closeProjectBundle,
    toggle: toggleProjectBundle,
    setArchiveIncludeFullChat,
    setArchiveIncludeContinuity,
    exportEditableBackup,
    exportReadableArchive,
    inspectBackup,
    clearInspectedBackup,
    restoreBackup
  } = useProjectBundleController({
    projectId,
    workspaceReady,
    canMutateWorkspace,
    workspace,
    onWorkspaceRestored: handleProjectBundleWorkspaceRestored
  });
  const [isStorageNoticeDismissed, setStorageNoticeDismissed] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [agentTurnMode, setAgentTurnMode] = useState<MorphoAgentTurnMode>("auto");
  const [taskMode, setTaskMode] = useState<AiTaskMode>("chatAnalysis");
  const workIntent = workspace.ui.workIntent;
  const [aiOpen, setAiOpen] = useState(true);
  const [localEditObjectId, setLocalEditObjectId] = useState<string | null>(null);
  const {
    pendingConfirmation,
    requestPendingConfirmation,
    updatePendingConfirmation,
    ownsPendingConfirmation: confirmationControllerOwnsPendingConfirmation,
    clearPendingConfirmation
  } = useWorkspaceConfirmationController({
    projectId,
    workspace,
    workspaceReady: canMutateWorkspace
  });
  const [textPrompt, setTextPrompt] = useState<WorkspaceTextPromptState | null>(null);
  const textPromptSession = useMemo<WorkspaceTextPromptSession>(
    () => createWorkspaceTextPromptSession(projectId, workspace.project.id, canMutateWorkspace),
    [canMutateWorkspace, projectId, workspace.project.id]
  );
  const activeTextPromptSessionRef = useRef(textPromptSession);
  useLayoutEffect(() => {
    if (activeTextPromptSessionRef.current === textPromptSession) {
      return;
    }

    activeTextPromptSessionRef.current = textPromptSession;
    setTextPrompt((current) => (current?.session === textPromptSession ? current : null));
  }, [textPromptSession]);
  const [detailHoverObjectId, setDetailHoverObjectId] = useState<string | null>(null);
  const [traceStartObjectId, setTraceStartObjectId] = useState<string | null>(null);
  const [canvasTraceMode, setCanvasTraceMode] = useState<"direct" | "chain">("direct");
  const [contextWarning, setContextWarning] = useState<string | undefined>();
  const [imageTaskStatus, setImageTaskStatus] = useState<ImageTaskStatus | null>(null);
  const [pendingImageGenerationSlots, setPendingImageGenerationSlots] = useState<PendingImageGenerationSlot[]>([]);
  const [imageGenerationSettings, setImageGenerationSettings] = useState<ImageGenerationSettings>(() =>
    getDefaultImageGenerationSettings()
  );
  const [directionPreviewCount, setDirectionPreviewCount] = useState<1 | 2 | 4 | 6>(2);
  const [imageGenerationAspectMode, setImageGenerationAspectMode] = useState<"auto" | "manual">("auto");
  const commitWorkspaceNow = useCallback(
    <T,>(transform: (current: MorphoWorkspace) => { workspace: MorphoWorkspace; value: T }): T => {
      if (!canMutateWorkspaceRef.current) throw createWorkspaceMutationBlockedError();
      return commitWorkspaceStateNow(setPersistentWorkspace, (current) => {
        if (!canMutateWorkspaceRef.current || current.project.id !== projectId) {
          throw createWorkspaceMutationBlockedError();
        }
        return transform(current);
      });
    },
    [projectId, setPersistentWorkspace]
  );
  const readWorkspaceNow = useCallback(() => workspaceRef.current, []);
  const { importRequest, captureImportSession } = useWorkspaceImportController({
    projectId,
    workspaceReady: canMutateWorkspace,
    commitWorkspace: commitWorkspaceNow,
    selectObjects: requestCanvasSelection
  });
  const assetUrls = useWorkspaceAssetUrls(workspace.assets);
  const railImportInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImportPickerRef = useRef<PendingImportPicker | null>(null);
  const pendingTopImportSessionRef = useRef<{
    projectId: string;
    session: WorkspaceImportSessionHandle;
  } | null>(null);
  useEffect(() => {
    pendingImportPickerRef.current = null;
    pendingTopImportSessionRef.current = null;
  }, [projectId, workspaceReady]);
  const [aiInputFocusNonce, setAiInputFocusNonce] = useState(0);
  const [manualSaveNotice, setManualSaveNotice] = useState<string | null>(null);
  const manualSaveNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedObjects = useMemo(
    () => compactObjectList(workspace.objects, selectedObjectIds),
    [selectedObjectIds, workspace.objects]
  );
  const activeCanvasObjectIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    workspace.canvas.instances.forEach((instance) => {
      const object = workspace.objects[instance.objectId];
      if (!object || object.visibility !== "active" || seen.has(object.id)) {
        return;
      }
      seen.add(object.id);
      ids.push(object.id);
    });
    return ids;
  }, [workspace.canvas.instances, workspace.objects]);
  const handleDeliveryCreatedCanvasFocus = useCallback(
    (deliveryObjectId: string) => {
      setSelectedObjectIds([deliveryObjectId]);
      requestObjectFocus(deliveryObjectId);
    },
    [requestObjectFocus, setSelectedObjectIds]
  );
  const deliveryPreparation = useDeliveryPreparationController({
    projectId,
    workspaceReady: canMutateWorkspace,
    workspace,
    updateWorkspace: setWorkspace,
    onBlocked: setContextWarning,
    onDeliveryCreated: handleDeliveryCreatedCanvasFocus
  });
  const {
    isOpen: deliveryPanelOpen,
    activeDeliveryObjectId,
    activeSectionId: activeDeliverySectionId,
    pendingDraftTarget: pendingDeliveryDraftTarget,
    open: openDeliveryPreparationController,
    close: closeDeliveryPreparation,
    selectDelivery: selectDeliveryPreparation,
    selectSection: selectDeliverySection,
    clearPendingDraftTarget,
    requestSectionDraft
  } = deliveryPreparation;
  const activeResearchDetailObject = useMemo(() => {
    if (!activeResearchDetailObjectId) {
      return null;
    }

    const object = workspace.objects[activeResearchDetailObjectId];
    return object?.type === "research" && object.visibility === "active" ? object : null;
  }, [activeResearchDetailObjectId, workspace.objects]);
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
  const detailProposal = useMemo(
    () =>
      detailProposalId && workspace.artifactProposals[detailProposalId]?.status === "pending"
        ? workspace.artifactProposals[detailProposalId]
        : null,
    [detailProposalId, workspace.artifactProposals]
  );
  const detailDesignDefinition = useMemo(() => {
    const object = detailDesignDefinitionId ? workspace.objects[detailDesignDefinitionId] : undefined;
    if (!object || object.type !== "designDefinition") {
      return null;
    }
    const revision = workspace.designDefinitionRevisions[object.currentRevisionId];
    return revision ? { object, revision } : null;
  }, [detailDesignDefinitionId, workspace.designDefinitionRevisions, workspace.objects]);
  const detailConceptDirection = useMemo(() => {
    const object = detailConceptDirectionId ? workspace.objects[detailConceptDirectionId] : undefined;
    if (!object || object.type !== "conceptDirection") {
      return null;
    }
    const revision = workspace.directionRevisions[object.currentRevisionId];
    return revision ? { object, revision } : null;
  }, [detailConceptDirectionId, workspace.directionRevisions, workspace.objects]);
  const activeOperation = useMemo(() => getActiveOperation(workspace), [workspace]);
  const isImageTaskMode = taskMode === "imageGeneration";
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

  const handleWorkIntentChange = useCallback(
    (nextWorkIntent: AiWorkIntent) => {
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

  const proposalWorkflow = useWorkspaceProposalWorkflowController({
    projectId,
    workspace,
    workspaceReady,
    canMutateWorkspace,
    commitWorkspace: commitWorkspaceNow,
    setSelectedObjectIds,
    requestObjectFocus,
    openProposalDetail,
    closeProposalDetail,
    closeProposalDetailIf,
    openAiPanel: () => setAiOpen(true),
    setAiDraft,
    setTaskMode,
    setWorkIntent: handleWorkIntentChange
  });
  const {
    activeProposal,
    activateProposal,
    openProposal,
    applyActiveProposal,
    applyProposal,
    rejectProposal,
    rejectProposals,
    saveResearchDraft,
    saveDesignDefinitionDraft,
    saveConceptDirectionDraft,
    continueDiscussion,
    regenerate: regenerateProposal,
    clearActiveProposalIf
  } = proposalWorkflow;

  const focusArea = useCallback(
    (area: FocusArea) => {
      requestFocusArea(area);
      changeDrawer(null);
    },
    [changeDrawer, requestFocusArea]
  );

  const focusObject = useCallback(
    (objectId: string, options: { rememberView?: boolean } = {}) => {
      requestFocusObject(objectId, options);
      changeDrawer(null);
    },
    [changeDrawer, requestFocusObject]
  );

  const locateObjectFromDetail = useCallback(
    (objectId: string) => {
      requestLocateObjectFromDetail(objectId);
      changeDrawer(null);
    },
    [changeDrawer, requestLocateObjectFromDetail]
  );

  const showWorkspaceNotice = useCallback((message: string, durationMs = 1600) => {
    setManualSaveNotice(message);
    if (manualSaveNoticeTimeoutRef.current) {
      clearTimeout(manualSaveNoticeTimeoutRef.current);
    }
    manualSaveNoticeTimeoutRef.current = setTimeout(() => {
      setManualSaveNotice(null);
      manualSaveNoticeTimeoutRef.current = null;
    }, durationMs);
  }, []);

  const requestLocalPendingConfirmation = useCallback(
    (value: PendingAiConfirmation): boolean => {
      const result = requestPendingConfirmation(value);
      if (result.status !== "accepted") {
        showWorkspaceNotice("请先处理当前待确认操作，再发起新的确认。");
        return false;
      }
      return true;
    },
    [requestPendingConfirmation, showWorkspaceNotice]
  );

  const handleManualSave = useCallback(() => {
    const result = flushWorkspace();
    if (result.phase === "readOnly") {
      showWorkspaceNotice("这个标签页仅供查看，不能修改项目。", 2600);
      return;
    }
    showWorkspaceNotice(result.phase === "error" ? "本地保存失败" : "已保存", 1400);
  }, [flushWorkspace, showWorkspaceNotice]);


  useEffect(
    () => () => {
      if (manualSaveNoticeTimeoutRef.current) {
        clearTimeout(manualSaveNoticeTimeoutRef.current);
      }
    },
    []
  );

  const handleSetContinuityEntryManualState = useCallback(
    (entryId: string, manualState: ContinuityManualState) => {
      if (!canMutateWorkspace) return;
      setWorkspace((current) => setConversationSemanticEntryManualState(current, entryId, manualState));
      openProjectRecords([entryId]);
    },
    [canMutateWorkspace, openProjectRecords, setWorkspace]
  );

  const captureObjectOperationSnapshot = useCallback(
    (): ObjectOperationUndoEntry => ({
      workspace,
      selectedObjectIds,
      localEditObjectId
    }),
    [localEditObjectId, selectedObjectIds, workspace]
  );

  const applyObjectOperationSnapshot = useCallback(
    (entry: ObjectOperationUndoEntry) => {
      setWorkspace(entry.workspace);
      requestCanvasSelection(entry.selectedObjectIds);
      setLocalEditObjectId(entry.localEditObjectId);
      closeCanvasContextMenu();
    },
    [closeCanvasContextMenu, requestCanvasSelection, setWorkspace]
  );

  const {
    pushUndoSnapshot: pushObjectOperationUndo,
    undo: undoLastObjectOperation,
    redo: redoLastObjectOperation
  } = useWorkspaceObjectHistoryController<ObjectOperationUndoEntry>({
    projectId,
    workspace,
    workspaceReady,
    captureCurrent: captureObjectOperationSnapshot,
    applyEntry: applyObjectOperationSnapshot,
    undoDetailNavigation,
    closeCanvasContextMenu,
    showNotice: showWorkspaceNotice
  });

  const comparisonDecision = useWorkspaceComparisonDecisionController({
    projectId,
    workspace,
    workspaceReady,
    pendingConfirmation,
    requestPendingConfirmation,
    updatePendingConfirmation,
    clearPendingConfirmation,
    commitWorkspace: commitWorkspaceNow,
    pushUndoSnapshot: pushObjectOperationUndo,
    setSelectedObjectIds,
    requestObjectFocus,
    showNotice: showWorkspaceNotice,
    setAiDraft,
    setTaskMode,
    openAiPanel: () => setAiOpen(true)
  });

  const handleSelectionChange = useCallback(
    (objectIds: string[]) => {
      acceptCanvasSelection(objectIds);
      closeCanvasContextMenu();
      setTraceStartObjectId((current) => {
        if (!current || (objectIds.length === 1 && objectIds[0] === current)) {
          return current;
        }
        setCanvasTraceMode("direct");
        return null;
      });
      if (objectIds.length === 0) {
        changeDrawer(null);
      }
    },
    [acceptCanvasSelection, changeDrawer, closeCanvasContextMenu]
  );

  const handleInstancesChange = useCallback(
    (instances: CanvasInstance[]) => {
      setWorkspace((current) => updateWorkspaceInstances(current, instances));
    },
    [setWorkspace]
  );

  const handleStageRegionsChange = useCallback(
    (regions: StageRegionRecord[]) => {
      setWorkspace((current) => {
        if (areStageRegionRecordsEqual(current.canvas.stageRegions, regions)) {
          return current;
        }
        return {
          ...current,
          canvas: {
            ...current.canvas,
            stageRegions: regions
          }
        };
      });
    },
    [setWorkspace]
  );

  const applyStageRegionWorkspaceMutation = useCallback(
    (mutate: (current: typeof workspace) => typeof workspace) => {
      setWorkspace((current) => {
        const next = mutate(ensureStageRegions(current));
        if (areStageRegionRecordsEqual(current.canvas.stageRegions, next.canvas.stageRegions)) {
          return current;
        }
        return next;
      });
    },
    [setWorkspace]
  );

  const handleCanvasViewChange = useCallback((view: CanvasView) => {
    commitCanvasView(view);
  }, [commitCanvasView]);

  const handleCanvasLiveViewChange = useCallback((view: CanvasView) => {
    observeCanvasView(view);
  }, [observeCanvasView]);

  const handleRailAddToCanvas = useCallback(() => {
    const importSession = captureImportSession();
    if (!importSession) {
      return;
    }
    pendingImportPickerRef.current = {
      projectId,
      session: importSession
    };
    railImportInputRef.current?.click();
  }, [captureImportSession, projectId]);
  const handleRailImportFiles = useCallback(
    (files: FileList | null) => {
      const selectedFiles = files ? Array.from(files) : [];
      const pendingPicker = pendingImportPickerRef.current;
      pendingImportPickerRef.current = null;
      if (selectedFiles.length === 0) {
        return;
      }
      if (!pendingPicker || pendingPicker.projectId !== projectId) {
        return;
      }

      const position = pendingPicker.position ?? {
        x: workspace.canvas.view.x + 180,
        y: workspace.canvas.view.y + 180
      };

      void pendingPicker.session.importRequest({
        files: selectedFiles,
        position
      });
    },
    [projectId, workspace.canvas.view.x, workspace.canvas.view.y]
  );

  const handleTopImportStart = useCallback(() => {
    const importSession = captureImportSession();
    pendingTopImportSessionRef.current = importSession
      ? { projectId, session: importSession }
      : null;
  }, [captureImportSession, projectId]);

  const handleTopImportFiles = useCallback(
    (files: File[]) => {
      const pendingSession = pendingTopImportSessionRef.current;
      pendingTopImportSessionRef.current = null;
      if (!pendingSession || pendingSession.projectId !== projectId || files.length === 0) {
        return;
      }

      void pendingSession.session.importRequest({
        files,
        position: {
          x: workspace.canvas.view.x + 160,
          y: workspace.canvas.view.y + 160
        }
      });
    },
    [projectId, workspace.canvas.view.x, workspace.canvas.view.y]
  );

  const handleContextMenuPaste = useCallback(
    async (pagePosition?: { x: number; y: number }) => {
      const importSession = captureImportSession();
      if (!importSession) {
        return;
      }
      const latestCanvasView = getLatestCanvasView();
      const position = pagePosition ?? {
        x: latestCanvasView.x + 160,
        y: latestCanvasView.y + 160
      };
      const result = await readClipboardAsImportPayload();
      // Clipboard feedback is transient chrome — never write into the AI conversation.
      if (result.status === "denied") {
        showWorkspaceNotice(result.reason, 2200);
        return;
      }
      if (result.status === "empty") {
        showWorkspaceNotice("剪贴板里没有可粘贴的图片、链接或文本", 2000);
        return;
      }
      await importSession.importRequest({
        position,
        files: result.files,
        url: result.url,
        text: result.text
      });
    },
    [captureImportSession, getLatestCanvasView, showWorkspaceNotice]
  );

  const handleContextMenuImportFiles = useCallback((pagePosition?: { x: number; y: number }) => {
    const importSession = captureImportSession();
    if (!importSession) {
      return;
    }
    const latestCanvasView = getLatestCanvasView();
    pendingImportPickerRef.current = {
      projectId,
      session: importSession,
      position: pagePosition ?? {
        x: latestCanvasView.x + 180,
        y: latestCanvasView.y + 180
      }
    };
    railImportInputRef.current?.click();
  }, [captureImportSession, getLatestCanvasView, projectId]);

  const handleSelectAllVisibleObjects = useCallback(() => {
    requestCanvasSelection(activeCanvasObjectIds);
  }, [activeCanvasObjectIds, requestCanvasSelection]);
  const handleOpenProjectHome = useCallback(() => {
    router.push("/");
  }, [router]);
  const handleConfirmProjectRename = useCallback(() => {
    const result = consumeProjectRename();
    if (result.status !== "rename") {
      return;
    }

    setWorkspace((current) => ({
      ...current,
      project: {
        ...current.project,
        title: result.title
      }
    }));
  }, [consumeProjectRename, setWorkspace]);

  const handleReorderSelectedLayers = useCallback(
    (action: CanvasLayerReorderAction) => {
      setWorkspace((current) => reorderCanvasInstances(current, selectedObjectIds, action));
      closeCanvasContextMenu();
    },
    [closeCanvasContextMenu, selectedObjectIds, setWorkspace]
  );

  const handleCopySelectedSummary = useCallback(() => {
    const target = selectedObjects[0];
    if (!target) {
      return;
    }

    const text = [target.title, target.summary].filter(Boolean).join("\n");
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  }, [selectedObjects]);
  const activeDesignTrace = useMemo<DesignTraceResult | null>(() => {
    if (!traceStartObjectId || !workspace.objects[traceStartObjectId]) {
      return null;
    }

    return traceDesignChain(workspace, traceStartObjectId);
  }, [traceStartObjectId, workspace]);

  // Canvas highlight uses primary-edge path; bottom bar keeps full designTrace summary.
  const canvasTrace = useMemo(() => {
    if (!traceStartObjectId || !workspace.objects[traceStartObjectId]) {
      if (selectedObjectIds.length === 1 && workspace.objects[selectedObjectIds[0]]) {
        return collectPrimaryCanvasTrace(workspace, selectedObjectIds[0], "direct");
      }
      return null;
    }
    return collectPrimaryCanvasTrace(workspace, traceStartObjectId, canvasTraceMode);
  }, [canvasTraceMode, selectedObjectIds, traceStartObjectId, workspace]);

  useEffect(() => {
    setWorkspace((current) => {
      return ensureWorkspaceStageRegionsIfWritable(current, canMutateWorkspace);
    });
  }, [canMutateWorkspace, setWorkspace, workspace.objects, workspace.project.id]);

  const visualGeneration = useWorkspaceVisualGenerationController({
    projectId,
    workspaceReady: canMutateWorkspace,
    effectiveImageGenerationSettings,
    commitWorkspace: commitWorkspaceNow,
    setPendingImageGenerationSlots,
    setImageTaskStatus,
    selectObjects: setSelectedObjectIds,
    focusObject: requestObjectFocus
  });
  const executeVisualGenerationPlan = visualGeneration.executeVisualGenerationPlan;
  const {
    isStreaming: isAiStreaming,
    showFailure,
    showRecoveryPending,
    send: sendAgentTurn,
    retryRecovery,
    editFailedTurn,
    cancel: cancelAiRequest,
    acknowledgePendingConfirmation,
    beginLocalAbortableTask,
    finishLocalAbortableTask
  } = useWorkspaceAgentRuntimeController({
    projectId,
    workspaceReady: canMutateWorkspace,
    commitWorkspace: commitWorkspaceNow,
    readWorkspace: readWorkspaceNow,
    persistWorkspace: flushWorkspace,
    executeVisualGenerationPlan,
    setContextWarning,
    clearPendingDeliveryDraftTarget: clearPendingDraftTarget,
    setDraft: setAiDraft,
    setTaskMode,
    openConversation: () => setAiOpen(true),
    requestPendingConfirmation,
    selectObjects: setSelectedObjectIds,
    focusObject: requestObjectFocus,
    openProposal: activateProposal,
    setImageTaskStatus
  });

  const confirmationExecution = useWorkspaceConfirmationExecutionController({
    projectId,
    workspace,
    workspaceReady: canMutateWorkspace,
    pendingConfirmation,
    ownsPendingConfirmation: confirmationControllerOwnsPendingConfirmation,
    updatePendingConfirmation,
    clearPendingConfirmation,
    commitWorkspace: commitWorkspaceNow,
    readWorkspace: readWorkspaceNow,
    pushUndoSnapshot: pushObjectOperationUndo,
    setSelectedObjectIds,
    setLocalEditObjectId,
    setAiDraft,
    setTaskMode,
    showNotice: showWorkspaceNotice,
    requestObjectFocus,
    setImageTaskStatus,
    executeVisualGenerationPlan,
    beginLocalAbortableTask,
    finishLocalAbortableTask,
    acknowledgePendingConfirmation
  });

  const handleSendMorphoAgentTurn = useCallback(() => {
    const turnInput = {
      draft: aiDraft,
      taskMode,
      recommendedTaskMode,
      workIntent,
      recommendedWorkIntent,
      selectedObjectIds,
      selectedObjects,
      pendingDeliveryDraftTarget,
      directionPreviewCount,
      agentTurnMode,
      imageGenerationModelId: effectiveImageGenerationSettings.modelId,
      readConversationTokenLimits: readConversationTokenLimitsOverride
    };
    return sendAgentTurn(turnInput);
  }, [
    agentTurnMode,
    aiDraft,
    directionPreviewCount,
    effectiveImageGenerationSettings.modelId,
    pendingDeliveryDraftTarget,
    recommendedTaskMode,
    recommendedWorkIntent,
    sendAgentTurn,
    selectedObjectIds,
    selectedObjects,
    taskMode,
    workIntent
  ]);

  const openDeliveryPreparationFromSelection = useCallback(
    (deliveryObjectId?: string) => {
      const targetId =
        deliveryObjectId ?? selectedObjects.find((object) => object.type === "delivery")?.id ?? activeDeliveryObjectId;
      openDeliveryPreparationController(targetId ?? undefined);
    },
    [activeDeliveryObjectId, openDeliveryPreparationController, selectedObjects]
  );

  const handleRequestDeliverySectionDraft = useCallback(
    (input: { deliveryObjectId: string; sectionId: string }) => {
      const result = requestSectionDraft(input);
      if (result.status !== "ready") {
        return;
      }
      setAiOpen(true);
      setTaskMode("chatAnalysis");
      handleWorkIntentChange("prepareDeliverySection");
      setAiDraft(result.prompt);
    },
    [handleWorkIntentChange, requestSectionDraft]
  );

  const handleCancelAiRequest = cancelAiRequest;

  const handleSuggestionClick = useCallback(
    (suggestion: Suggestion) => {
      const result = createAiDraftFromSuggestion(workspace, {
        selectedObjectIds,
        suggestion: suggestion.prompt
      });
      setAiDraft(result.draft);
    },
    [selectedObjectIds, workspace]
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

    setTraceStartObjectId((current) => {
      if (current === target.id && canvasTraceMode === "chain") {
        setCanvasTraceMode("direct");
        return null;
      }
      setCanvasTraceMode("chain");
      return target.id;
    });
  }, [canvasTraceMode, selectedObjects]);

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
    if (!isWorkspaceTextPromptSessionCurrent(textPromptSession, activeTextPromptSessionRef.current, workspace)) {
      return;
    }
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }
    setTextPrompt({
      session: textPromptSession,
      prompt: {
        kind: "createVisualBranch",
        directionId: target.id,
        title: "新视觉分支",
        body: "为当前方向创建一条可继续发展的视觉路线。创建分支不会移动、删除或改写现有图片。",
        label: "分支名称",
        initialValue: "未分组视觉探索"
      }
    });
  }, [selectedObjects, textPromptSession, workspace]);

  const handleRenameVisualBranch = useCallback(
    (branchId: string) => {
      if (!isWorkspaceTextPromptSessionCurrent(textPromptSession, activeTextPromptSessionRef.current, workspace)) {
        return;
      }
      const branch = workspace.visualBranches[branchId];
      if (!branch) {
        return;
      }
      setTextPrompt({
        session: textPromptSession,
        prompt: {
          kind: "renameVisualBranch",
          branchId,
          title: "重命名视觉分支",
          body: "只更新分支名称，不改变图片、方向、版本或交付引用。",
          label: "分支名称",
          initialValue: branch.label
        }
      });
    },
    [textPromptSession, workspace]
  );

  const handleSubmitTextPrompt = useCallback(
    (value: string) => {
      const promptState = textPrompt;
      if (!promptState) {
        return;
      }
      if (!isWorkspaceTextPromptSessionCurrent(promptState.session, activeTextPromptSessionRef.current, workspace)) {
        setTextPrompt((current) => (current?.session === promptState.session ? null : current));
        return;
      }
      const trimmedValue = value.trim();
      if (!trimmedValue && !promptState.prompt.allowEmpty) {
        return;
      }

      if (promptState.prompt.kind === "eliminateDirection") {
        const currentWorkspace = readWorkspaceNow();
        if (
          !isWorkspaceTextPromptSessionCurrent(
            promptState.session,
            activeTextPromptSessionRef.current,
            currentWorkspace
          )
        ) {
          setTextPrompt((current) => (current?.session === promptState.session ? null : current));
          return;
        }
        pushObjectOperationUndo();
      }

      const result = commitWorkspaceNow<WorkspaceTextPromptCommitResult>((current) => {
        const applied = applyWorkspaceTextPromptIfCurrent(
          current,
          promptState,
          activeTextPromptSessionRef.current,
          trimmedValue
        );
        if (applied.status === "stale") {
          return { workspace: current, value: applied };
        }
        if (applied.status === "blocked") {
          return { workspace: current, value: applied };
        }
        return { workspace: applied.workspace, value: applied };
      });

      if (result.status === "stale") {
        setTextPrompt((current) => (current?.session === promptState.session ? null : current));
        return;
      }
      if (result.status === "blocked") {
        setContextWarning(result.reason);
      } else if (result.notice) {
        showWorkspaceNotice(result.notice);
      }
      setTextPrompt((current) => (current?.session === promptState.session ? null : current));
    },
    [
      commitWorkspaceNow,
      pushObjectOperationUndo,
      readWorkspaceNow,
      setContextWarning,
      showWorkspaceNotice,
      textPrompt,
      workspace
    ]
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
    setAiDraft("基于原图进行定向修改：仅修改我指定的部件；尽量保留其余结构、比例、材质和构图。");
  }, [selectedObjects]);

  const handleReferenceIntent = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "image");
    if (!target) {
      return;
    }

    if (target.isDefaultReference) {
      pushObjectOperationUndo();
      setWorkspace((current) =>
        clearDefaultReference(current, target.id, {
          reason: "用户在画布上明确取消后续默认参考。"
        })
      );
      showWorkspaceNotice(`已取消「${target.title}」的后续默认参考`);
      return;
    }

    const previousReference = Object.values(workspace.objects).find(
      (object) => object.type === "image" && object.visibility === "active" && object.isDefaultReference
    );
    if (previousReference && previousReference.id !== target.id) {
      // 替换已有锚点：按产品规则先给出“只替换 / 替换并标记待复核”两个选项，不直接改状态。
      const reviewTargets = collectDefaultReferenceReviewTargets(workspace, previousReference.id, target.id);
      if (!requestLocalPendingConfirmation({
        kind: "setDefaultReference",
        targetObjectId: target.id,
        targetTitle: target.title,
        previousReferenceObjectId: previousReference.id,
        previousReferenceTitle: previousReference.title,
        reviewImageCount: reviewTargets.imageIds.length,
        reviewCollectionCount: reviewTargets.collectionIds.length,
        reviewImageIds: [...reviewTargets.imageIds],
        reviewCollectionIds: [...reviewTargets.collectionIds]
      })) {
        return;
      }
      setAiOpen(true);
      return;
    }

    pushObjectOperationUndo();
    setWorkspace((current) =>
      setDefaultReference(current, target.id, {
        reason: "用户在画布上明确设为后续默认参考。"
      })
    );
    showWorkspaceNotice(`已设「${target.title}」为后续默认参考`);
  }, [pushObjectOperationUndo, requestLocalPendingConfirmation, selectedObjects, setWorkspace, showWorkspaceNotice, workspace]);

  const handleKeepReviewedVisual = useCallback(
    (objectId: string) => {
      const target = workspace.objects[objectId];
      if (!target || (target.type !== "image" && target.type !== "imageCollection") || !target.pendingReview) {
        return;
      }

      pushObjectOperationUndo();
      setWorkspace((current) => clearVisualReviewMark(current, objectId));
      showWorkspaceNotice(`已保留「${target.title}」，待复核标记已清除`);
    },
    [pushObjectOperationUndo, setWorkspace, showWorkspaceNotice, workspace.objects]
  );

  const handleRegenerateReviewedVisual = useCallback(
    (objectId: string) => {
      const target = workspace.objects[objectId];
      if (!target || (target.type !== "image" && target.type !== "imageCollection")) {
        return;
      }

      const newReferenceId = target.pendingReview?.newDefaultReferenceId;
      const newReference = newReferenceId ? workspace.objects[newReferenceId] : undefined;
      // 只填入可编辑的自然语言，不自动发送、不直接生成。
      setAiOpen(true);
      setTaskMode("imageGeneration");
      setAiDraft(
        `基于当前后续默认参考「${newReference?.title ?? "当前默认参考"}」重新生成「${target.title}」，保持原有用途与构图意图；作为新图生成，不替换原有素材。`
      );
      setAiInputFocusNonce((value) => value + 1);
    },
    [workspace.objects]
  );

  const handleHideSelected = useCallback(() => {
    if (!canMutateWorkspace || selectedObjects.length === 0) {
      return;
    }

    const proposalObjects = selectedObjects.filter((object) => object.type === "proposalDraft");
    const objectIds = selectedObjects.filter((object) => object.type !== "proposalDraft").map((object) => object.id);
    if (objectIds.length > 0) {
      pushObjectOperationUndo();
      setWorkspace((current) => hideObjects(current, objectIds));
    }
    rejectProposals(
      proposalObjects.map((object) => object.proposalId),
      "用户从画布隐藏并放弃当前草案。"
    );
    const removedIds = [...objectIds, ...proposalObjects.map((object) => object.id)];
    setSelectedObjectIds((current) => current.filter((selectedId) => !removedIds.includes(selectedId)));
    setLocalEditObjectId((current) => (current && removedIds.includes(current) ? null : current));
    clearActiveProposalIf(removedIds);
    closeProposalDetailIf(removedIds);
    closeCanvasContextMenu();
  }, [
    clearActiveProposalIf,
    closeCanvasContextMenu,
    closeProposalDetailIf,
    pushObjectOperationUndo,
    rejectProposals,
    selectedObjects,
    setSelectedObjectIds,
    canMutateWorkspace,
    setWorkspace
  ]);

  const handleRestoreObject = useCallback(
    (objectId: string) => {
      if (!canMutateWorkspace) return;
      setWorkspace((current) => restoreObject(current, objectId));
      setSelectedObjectIds([objectId]);
      focusObject(objectId);
    },
    [canMutateWorkspace, focusObject, setSelectedObjectIds, setWorkspace]
  );

  const handleDeleteSelected = useCallback(() => {
    if (!canMutateWorkspace || selectedObjects.length === 0) {
      return;
    }

    const proposalObjects = selectedObjects.filter((object) => object.type === "proposalDraft");
    const objectIds = selectedObjects.filter((object) => object.type !== "proposalDraft").map((object) => object.id);
    if (objectIds.length > 0) {
      pushObjectOperationUndo();
      setWorkspace((current) =>
        deleteObjects(current, objectIds, {
          confirmed: true,
          reason: "用户在对象详情栏直接删除该对象。"
        }).workspace
      );
    }
    rejectProposals(
      proposalObjects.map((object) => object.proposalId),
      "用户从画布删除并放弃当前草案。"
    );
    const removedIds = [...objectIds, ...proposalObjects.map((object) => object.id)];
    setSelectedObjectIds((current) => current.filter((selectedId) => !removedIds.includes(selectedId)));
    setLocalEditObjectId((current) => (current && removedIds.includes(current) ? null : current));
    if (
      pendingConfirmation?.kind === "deleteObject" &&
      removedIds.includes(pendingConfirmation.targetObjectId)
    ) {
      clearPendingConfirmation(pendingConfirmation);
    }
    clearActiveProposalIf(removedIds);
    closeProposalDetailIf(removedIds);
    closeCanvasContextMenu();
  }, [
    clearActiveProposalIf,
    closeCanvasContextMenu,
    clearPendingConfirmation,
    closeProposalDetailIf,
    pendingConfirmation,
    pushObjectOperationUndo,
    rejectProposals,
    selectedObjects,
    setSelectedObjectIds,
    canMutateWorkspace,
    setWorkspace
  ]);

  const handleEliminateDirection = useCallback(() => {
    if (!isWorkspaceTextPromptSessionCurrent(textPromptSession, activeTextPromptSessionRef.current, workspace)) {
      return;
    }
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }
    setTextPrompt({
      session: textPromptSession,
      prompt: {
        kind: "eliminateDirection",
        directionId: target.id,
        title: "淘汰方向",
        body: "淘汰不会隐藏、删除方向，也不会移除图片、修订或 lineage。理由可选，不填也可直接淘汰。",
        label: "淘汰理由（可选）",
        initialValue: "",
        allowEmpty: true
      }
    });
  }, [selectedObjects, textPromptSession, workspace]);

  const handleSetDirectionPrimary = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }

    pushObjectOperationUndo();
    setWorkspace((current) =>
      setConceptDirectionStatus(current, target.id, "primary", "用户在画布上明确将该方向设为主方向。")
    );
    showWorkspaceNotice(`已将「${target.title}」设为主方向`);
  }, [pushObjectOperationUndo, selectedObjects, setWorkspace, showWorkspaceNotice]);

  const handleSetDirectionAlternative = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }

    pushObjectOperationUndo();
    setWorkspace((current) =>
      setConceptDirectionStatus(current, target.id, "alternative", "用户在画布上明确将该方向转为备选方向。")
    );
    showWorkspaceNotice(`已将「${target.title}」设为备选方向`);
  }, [pushObjectOperationUndo, selectedObjects, setWorkspace, showWorkspaceNotice]);

  const handleSetKeyConclusionCategory = useCallback(
    (objectId: string, category: AssignableKeyConclusionCategory) => {
      const target = workspace.objects[objectId];
      if (!target || target.type !== "keyConclusion") {
        return;
      }

      pushObjectOperationUndo();
      setWorkspace((current) => {
        const result = setKeyConclusionCategory(current, objectId, category, {
          reason: "用户在关键结论详情中补充类别。"
        });
        return result.status === "updated" ? result.workspace : current;
      });
      showWorkspaceNotice(`已将关键结论「${target.title}」归为${getKeyConclusionCategoryLabel(category)}`);
    },
    [pushObjectOperationUndo, setWorkspace, showWorkspaceNotice, workspace.objects]
  );

  const handleRestoreDirectionAsAlternative = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }

    pushObjectOperationUndo();
    setWorkspace((current) =>
      setConceptDirectionStatus(current, target.id, "alternative", "用户将已淘汰方向恢复为备选方向。")
    );
    showWorkspaceNotice(`已将「${target.title}」恢复为备选方向`);
  }, [pushObjectOperationUndo, selectedObjects, setWorkspace, showWorkspaceNotice]);

  const handleSaveKeyConclusionFromResearchItem = useCallback(
    (input: SaveResearchKeyConclusionInput) => {
      const research = workspace.objects[input.researchObjectId];
      if (!research || research.type !== "research") {
        return;
      }

      const source = input.kind === "evidence"
        ? { kind: "evidence" as const, index: input.index, category: input.category }
        : { kind: input.kind, index: input.index };
      const draftResult = buildKeyConclusionDraftFromResearchSource(workspace, input.researchObjectId, source);
      if (draftResult.status !== "ready") {
        showWorkspaceNotice(draftResult.reason);
        return;
      }

      pushObjectOperationUndo();
      const result = createKeyConclusion(workspace, {
        title: draftResult.draft.title,
        body: draftResult.draft.body,
        summary: draftResult.draft.summary,
        sourceObjectIds: draftResult.draft.sourceObjectIds,
        citationIds: draftResult.draft.citationIds,
        category: draftResult.draft.category,
        confidence: draftResult.draft.confidence,
        state: draftResult.draft.state,
        note: draftResult.draft.note,
        position: {
          x: workspace.canvas.view.x + 240,
          y: workspace.canvas.view.y + 180
        }
      });
      setWorkspace(result.workspace);
      requestFocusObject(result.keyConclusion.id);
      showWorkspaceNotice(`已保存关键结论「${result.keyConclusion.title}」`);
    },
    [pushObjectOperationUndo, requestFocusObject, setWorkspace, showWorkspaceNotice, workspace]
  );

  const handleOpenResearchDetail = useCallback(() => {
    const research = selectedObjects.find((object) => object.type === "research");
    if (!research) {
      return;
    }

    openResearchDetail(research.id);
  }, [openResearchDetail, selectedObjects]);

  const handleAutoSelectResearch = useCallback(() => {
    const research = selectedObjects.length === 1 && selectedObjects[0]?.type === "research" ? selectedObjects[0] : undefined;
    if (!research) {
      return;
    }

    const selectedKeys = getResearchExtractionRecommendationKeys(workspace, research.id);
    if (selectedKeys.length === 0) {
      setAiOpen(true);
      setTaskMode("chatAnalysis");
      setAiDraft("这张研究卡暂时没有可保留的研究点。");
      return;
    }

    const result = applyResearchExtractionSelection(workspace, research.id, selectedKeys);
    setWorkspace(result.workspace);
    if (result.activeObjectIds.length > 0) {
      setSelectedObjectIds(result.activeObjectIds);
      requestObjectFocus(result.activeObjectIds[0]);
    }
    closeResearchDetail();
  }, [closeResearchDetail, requestObjectFocus, selectedObjects, setSelectedObjectIds, setWorkspace, workspace]);

  const handleApplyResearchExtractionSelection = useCallback(
    (selectedKeys: string[]) => {
      if (!activeResearchDetailObjectId) {
        return;
      }

      const result = applyResearchExtractionSelection(workspace, activeResearchDetailObjectId, selectedKeys);
      setWorkspace(result.workspace);
      if (result.activeObjectIds.length > 0) {
        setSelectedObjectIds(result.activeObjectIds);
        requestObjectFocus(result.activeObjectIds[0]);
      }
    },
    [activeResearchDetailObjectId, requestObjectFocus, setSelectedObjectIds, setWorkspace, workspace]
  );

  const handleCopyItemToDraft = useCallback((text: string) => {
    setAiOpen(true);
    setTaskMode("chatAnalysis");
    handleWorkIntentChange("discussion");
    setAiDraft(text);
  }, [handleWorkIntentChange]);

  const handleContinueQuestion = useCallback((text: string) => {
    setAiOpen(true);
    setTaskMode("chatAnalysis");
    handleWorkIntentChange("discussion");
    setAiDraft(`请继续追问：${text}`);
  }, [handleWorkIntentChange]);

  const handleViewCreatedDocumentFragment = useCallback(
    (fragmentId: string) => {
      acceptCanvasSelection([fragmentId]);
      requestObjectFocus(fragmentId);
    },
    [acceptCanvasSelection, requestObjectFocus]
  );

  const {
    state: documentReader,
    open: openDocumentReader,
    close: handleCloseDocumentReader,
    extractFragment: handleExtractDocumentFragment,
    viewCreatedFragment: handleViewCreatedDocumentFragmentFromReader
  } = useDocumentReaderController({
    projectId,
    workspaceReady,
    canMutateWorkspace,
    workspace,
    updateWorkspace: setWorkspace,
    blobStore: indexedDbBlobStore,
    onViewCreatedFragment: handleViewCreatedDocumentFragment
  });

  const handleOpenDocumentReader = useCallback(
    (fileObjectId: string, initialLocation?: Parameters<typeof openDocumentReader>[1]) => {
      setSelectedObjectIds([]);
      setLocalEditObjectId(null);
      closeCanvasContextMenu();
      openDocumentReader(fileObjectId, initialLocation);
    },
    [closeCanvasContextMenu, openDocumentReader, setSelectedObjectIds]
  );

  const handleOpenDeliveryReferenceReader = useCallback(
    (transition: DeliveryReferenceReaderTransition) => {
      selectDeliveryPreparation(transition.activeDeliveryObjectId);
      selectDeliverySection(transition.activeSectionId);
      if (transition.closeDeliveryPanel) {
        closeDeliveryPreparation();
      }
      handleOpenDocumentReader(transition.fileObjectId, transition.initialLocation);
    },
    [closeDeliveryPreparation, handleOpenDocumentReader, selectDeliveryPreparation, selectDeliverySection]
  );

  const documentReaderFile = documentReader ? workspace.objects[documentReader.fileObjectId] : undefined;
  const documentReaderInitialLocation = documentReader?.initialLocation ?? null;
  const selectAllCanvasObjects = useCallback(() => {
    const handled = selectAllControllerCanvasObjects(activeCanvasObjectIds);
    if (handled) {
      closeCanvasContextMenu();
    }
    return handled;
  }, [activeCanvasObjectIds, closeCanvasContextMenu, selectAllControllerCanvasObjects]);

  const clearCanvasSelection = useCallback(() => {
    const handled = clearControllerCanvasSelection();
    if (handled) {
      closeCanvasContextMenu();
    }
    return handled;
  }, [clearControllerCanvasSelection, closeCanvasContextMenu]);

  const closeTopWorkspaceSurface = useCallback(() => {
    const ports: WorkspaceExternalSurfacePorts = {
      documentReaderOpen: Boolean(documentReader),
      closeDocumentReader: handleCloseDocumentReader,
      deliveryPreparationOpen: deliveryPanelOpen,
      closeDeliveryPreparation,
      deliveryOutputOpen: isDeliveryOutputOpen,
      closeDeliveryOutput,
      projectBundleOpen: isProjectBundleOpen,
      closeProjectBundle,
      clearCanvasSelection
    };
    return closeTopSurface(ports);
  }, [
    clearCanvasSelection,
    closeDeliveryPreparation,
    closeDeliveryOutput,
    closeProjectBundle,
    closeTopSurface,
    deliveryPanelOpen,
    documentReader,
    handleCloseDocumentReader,
    isDeliveryOutputOpen,
    isProjectBundleOpen
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveWorkspaceShortcut(event, event.target);
      if (!shortcut) {
        return;
      }

      let handled = false;
      switch (shortcut) {
        case "deleteSelection":
          if (!canMutateWorkspace) {
            handled = true;
          } else if (!canvasContextMenu && selectedObjects.length > 0) {
            handleDeleteSelected();
            handled = true;
          }
          break;
        case "selectAllCanvas":
          handled = selectAllCanvasObjects();
          break;
        case "focusAiInput":
          setAiOpen(true);
          setAiInputFocusNonce((current) => current + 1);
          handled = true;
          break;
        case "manualSave":
          handleManualSave();
          handled = true;
          break;
        case "closeOrClearSelection":
          handled = closeTopWorkspaceSurface();
          break;
      }

      if (!handled) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    canvasContextMenu,
    canMutateWorkspace,
    closeTopWorkspaceSurface,
    handleDeleteSelected,
    handleManualSave,
    selectAllCanvasObjects,
    selectedObjects.length
  ]);

  const viewportSize =
    typeof window === "undefined"
      ? { w: 1280, h: 800 }
      : {
          w: window.innerWidth,
          h: window.innerHeight
        };
  const contextMenuObjects =
    canvasContextMenu?.objectId && !selectedObjectIds.includes(canvasContextMenu.objectId)
      ? compactObjectList(workspace.objects, [canvasContextMenu.objectId])
      : canvasContextMenu?.stageId
        ? []
        : selectedObjects;
  const contextMenuKind: "object" | "stage" | "empty" = canvasContextMenu?.objectId
    ? "object"
    : canvasContextMenu?.stageId
      ? "stage"
      : "empty";
  const contextMenuStage = useMemo(() => {
    if (!canvasContextMenu?.stageId) {
      return null;
    }
    const region = getStageRegions(workspace).find((item) => item.id === canvasContextMenu.stageId);
    if (!region) {
      return null;
    }
    return {
      id: region.id,
      title: region.title,
      locked: Boolean(region.locked),
      canFit: !region.locked && hasVisibleStageRegionMembers(workspace, region.id)
    };
  }, [canvasContextMenu, workspace]);
  const contextMenuPlacement = canvasContextMenu
    ? getFloatingMenuPlacement(canvasContextMenu, viewportSize, {
        menu: { w: 220, h: 340 },
        margin: 18
      })
      : null;
  const renderSelectionToolbar = (
    toolbarObjects: MorphoObject[],
    placement: SelectionToolbarPlacement,
    onMeasure?: (size: { w: number; h: number }) => void,
    isMeasuring?: boolean
  ) => (
    <SelectionToolbar
      selectedObjects={toolbarObjects}
      placement={placement}
      onMeasure={onMeasure}
      isMeasuring={isMeasuring}
      isDesignTraceActive={Boolean(traceStartObjectId) && canvasTraceMode === "chain"}
      onAskAi={handleAskAi}
      onToggleDesignTrace={handleToggleDesignTrace}
      onOpenResearchDetail={handleOpenResearchDetail}
      onAutoSelectResearch={handleAutoSelectResearch}
      onOpenDocumentReader={() => { const primary = toolbarObjects[0]; if (primary?.type === "file") handleOpenDocumentReader(primary.id); else if (primary?.type === "documentFragment") handleOpenDocumentReader(primary.source.fileObjectId); }}
      onOpenDeliveryPreparation={() => openDeliveryPreparationFromSelection(toolbarObjects[0]?.type === "delivery" ? toolbarObjects[0].id : undefined)}
      onLocalEdit={handleLocalEdit}
      onReferenceIntent={handleReferenceIntent}
      onHide={handleHideSelected}
      onDelete={handleDeleteSelected}
       onOpenProposalDetail={() => { const object = toolbarObjects.find((item) => item.type === "proposalDraft"); if (object?.type === "proposalDraft") openProposal(object.proposalId); }}
       onApplyProposal={() => { const object = toolbarObjects.find((item) => item.type === "proposalDraft"); if (object?.type === "proposalDraft") applyProposal(object.proposalId); }}
       onRejectProposal={() => { const object = toolbarObjects.find((item) => item.type === "proposalDraft"); if (object?.type === "proposalDraft") rejectProposal(object.proposalId); }}
       onContinueProposalDiscussion={() => { const object = toolbarObjects.find((item) => item.type === "proposalDraft"); if (object?.type === "proposalDraft") continueDiscussion(object.proposalId); }}
      onOpenDesignDefinitionDetail={() => { const object = toolbarObjects.find((item) => item.type === "designDefinition"); if (object?.type === "designDefinition") openDesignDefinitionDetail(object.id); }}
      onOpenConceptDirectionDetail={() => { const object = toolbarObjects.find((item) => item.type === "conceptDirection"); if (object?.type === "conceptDirection") openConceptDirectionDetail(object.id); }}
      onSetCurrentDesignDefinition={() => { const object = toolbarObjects.find((item) => item.type === "designDefinition"); if (object?.type === "designDefinition") setWorkspace((current) => setCurrentDesignDefinition(current, object.id)); }}
      onReviseDirection={handleReviseDirectionIntent}
      onSplitDirection={handleSplitDirectionIntent}
      onMergeDirections={handleMergeDirectionsIntent}
      onCreateVisualBranch={handleCreateVisualBranch}
      onSetDirectionPrimary={handleSetDirectionPrimary}
      onSetDirectionAlternative={handleSetDirectionAlternative}
      onRestoreDirectionAsAlternative={handleRestoreDirectionAsAlternative}
      onEliminateDirection={handleEliminateDirection}
      onReorderLayer={handleReorderSelectedLayers}
    />
  );

  const showWorkspaceStarter =
    persistenceState.phase !== "loading" &&
    !persistenceState.migrationError &&
    workspace.ai.messages.length === 0 &&
    !Object.values(workspace.objects).some((object) => object.visibility === "active");

  const handleConfirmPending = useCallback(async () => {
    if (pendingConfirmation && isComparisonPendingConfirmation(pendingConfirmation)) {
      comparisonDecision.confirm();
      return;
    }
    await confirmationExecution.confirm();
  }, [comparisonDecision, confirmationExecution, pendingConfirmation]);

  return (
    <main className="workspace">
      {/* Ordered by how much is at stake: an unsaved change outranks a read-only
          tab, which outranks a browser that has merely not promised to keep data. */}
      {persistenceState.phase === "error" && !persistenceState.migrationError ? (
        <SaveFailureBanner
          kind={persistenceState.failureKind ?? "unknown"}
          stage={persistenceState.failedStage}
          workspace={workspace}
        />
      ) : persistenceState.phase === "readOnly" ? (
        <div className="workspace-banner" role="status">
          <strong>这个项目已在另一个标签页打开</strong>
          <span>
            为了不让两个标签页互相覆盖，这里仅供查看，不能编辑、导入或发起 AI 操作。关闭另一个标签页后刷新本页，即可继续编辑。
          </span>
        </div>
      ) : persistenceState.storageDurability === "bestEffort" && !isStorageNoticeDismissed ? (
        <div className="workspace-banner" role="status">
          <strong>当前浏览器尚未允许长期保存</strong>
          <span>长时间不打开，或设备空间紧张时，本地项目可能被浏览器清空。建议在“归档”里导出一份可恢复备份。</span>
          <button className="workspace-banner-dismiss" type="button" onClick={() => setStorageNoticeDismissed(true)}>
            知道了
          </button>
        </div>
      ) : null}
      <input
        ref={railImportInputRef}
        className="sr-only"
        type="file"
        multiple
        disabled={!canMutateWorkspace}
        tabIndex={-1}
        onChange={(event) => {
          handleRailImportFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      {manualSaveNotice ? (
        <div className="workspace-save-toast" role="status" aria-live="polite">
          {manualSaveNotice}
        </div>
      ) : null}
      <MorphoCanvas
        workspace={workspace}
        readOnly={!canMutateWorkspace}
        annotatedObjectId={localEditObjectId}
        canvasTrace={canvasTrace}
        highlightedObjectId={detailHoverObjectId}
        assetUrls={assetUrls}
        pendingImageGenerationSlots={pendingImageGenerationSlots}
        focusRequest={focusRequest}
        selectionRequest={selectionRequest}
        floatingChromeKey={[
          activeDrawer ?? "none",
          aiOpen ? "ai" : "x",
          deliveryPanelOpen ? "delivery" : "x",
          isDeliveryOutputOpen ? "output" : "x",
          isProjectBundleOpen ? "bundle" : "x",
          documentReader ? "reader" : "x",
          detailProposal ? "proposal" : "x",
          detailDesignDefinition ? "def" : "x",
          detailConceptDirection ? "concept" : "x"
        ].join(":")}
        renderSelectionToolbar={canMutateWorkspace ? renderSelectionToolbar : undefined}
        onSelectionChange={handleSelectionChange}
        onInstancesChange={handleInstancesChange}
        onStageRegionsChange={handleStageRegionsChange}
        onViewChange={handleCanvasViewChange}
        onLiveViewChange={handleCanvasLiveViewChange}
        onImportRequest={importRequest}
        onContextMenuRequest={(request) => {
          if (!canMutateWorkspace) return;
          openCanvasContextMenu({
            x: request.x,
            y: request.y,
            objectId: request.objectId,
            stageId: request.stageId,
            pagePosition: request.pagePosition
          });
          if (request.objectId && !selectedObjectIds.includes(request.objectId)) {
            requestCanvasSelection([request.objectId]);
          }
          if (request.stageId) {
            // Stage selection lives in the editor; clear Morpho object selection so toolbars don't mix.
            setSelectedObjectIds([]);
          }
        }}
      />

      {showWorkspaceStarter ? (
        <WorkspaceStarter
          onStartChat={() => {
            setAiOpen(true);
            setAiInputFocusNonce((current) => current + 1);
          }}
          onImport={handleRailAddToCanvas}
        />
      ) : null}

      {detailProposal ? (
        <aside className="proposal-detail-dialog" aria-label="草案详情">
          <button
            className="proposal-detail-close"
            type="button"
            aria-label="关闭草案详情"
            onClick={closeProposalDetail}
          >
            ×
          </button>
          <ProposalDraftCard
            workspace={workspace}
            proposal={detailProposal}
            onApply={(allowSourceChanged) => applyProposal(detailProposal.id, { allowSourceChanged })}
            onReject={rejectProposal}
            onContinueDiscussion={continueDiscussion}
            onRegenerate={regenerateProposal}
            onSaveResearchDraft={saveResearchDraft}
            onSaveDesignDefinitionDraft={saveDesignDefinitionDraft}
            onSaveConceptDirectionDraft={saveConceptDirectionDraft}
          />
        </aside>
      ) : null}

      {detailDesignDefinition ? (
        <aside className="proposal-detail-dialog" aria-label="设计定义详情">
          <button
            className="proposal-detail-close"
            type="button"
            aria-label="关闭设计定义详情"
            onClick={closeDesignDefinitionDetail}
          >
            ×
          </button>
          <DesignDefinitionDetail
            object={detailDesignDefinition.object}
            revision={detailDesignDefinition.revision}
          />
        </aside>
      ) : null}

      {detailConceptDirection ? (
        <aside className="proposal-detail-dialog" aria-label="概念方向详情">
          <button
            className="proposal-detail-close"
            type="button"
            aria-label="关闭概念方向详情"
            onClick={closeConceptDirectionDetail}
          >
            ×
          </button>
          <ConceptDirectionDetail
            object={detailConceptDirection.object}
            revision={detailConceptDirection.revision}
          />
        </aside>
      ) : null}

      {textPrompt?.session === textPromptSession && textPromptSession.workspaceReady ? (
        <WorkspaceTextPromptDialog
          prompt={textPrompt.prompt}
          onCancel={() =>
            setTextPrompt((current) => (current?.session === textPrompt.session ? null : current))
          }
          onSubmit={handleSubmitTextPrompt}
        />
      ) : null}

      <TopControls
        projectTitle={workspace.project.title}
        canMutateWorkspace={canMutateWorkspace}
        persistenceError={
          persistenceState.phase === "error" && persistenceState.error && !persistenceState.migrationError
            ? persistenceState.error
            : undefined
        }
        onImportFiles={handleTopImportFiles}
        onImportStart={handleTopImportStart}
        onSearch={() => changeDrawer("search")}
        onFocusOverview={() => focusArea("overview")}
        onOpenDeliveryPreparation={() => openDeliveryPreparationFromSelection()}
        onOpenProjectBundles={() => {
          closeDeliveryOutput();
          toggleProjectBundle();
        }}
        onOpenDeliveryOutput={() => {
          closeProjectBundle();
          toggleDeliveryOutput();
        }}
        projectMenuOpen={projectMenuOpen}
        projectRenameDraft={projectRenameDraft}
        onProjectMenuToggle={toggleProjectMenu}
        onProjectRenameDraftChange={setProjectRenameDraft}
        onProjectRenameConfirm={handleConfirmProjectRename}
        onOpenProjectHome={handleOpenProjectHome}
      />
      {isDeliveryOutputOpen ? (
        <DeliveryOutputPanel
          workspace={workspace}
          selectedObjectIds={selectedObjectIds}
          activeDeliveryObjectId={activeDeliveryObjectId}
          busyLabel={deliveryOutputBusyLabel}
          message={deliveryOutputMessage}
          preflight={deliveryOutputPreflight}
          onClose={closeDeliveryOutput}
          onInspect={inspectDeliveryOutput}
          onExport={exportDeliveryOutput}
        />
      ) : null}
      {isProjectBundleOpen ? (
        <ProjectBundlePanel
          canMutateWorkspace={canMutateWorkspace}
          archiveIncludeFullChat={archiveIncludeFullChat}
          archiveIncludeContinuity={archiveIncludeContinuity}
          restorePreview={inspectedBackup?.preview ?? null}
          busyLabel={bundleBusyLabel}
          message={bundleMessage}
          onClose={closeProjectBundle}
          onArchiveIncludeFullChatChange={setArchiveIncludeFullChat}
          onArchiveIncludeContinuityChange={setArchiveIncludeContinuity}
          onExportArchive={exportReadableArchive}
          onExportBackup={exportEditableBackup}
          onInspectBackup={inspectBackup}
          onCancelRestorePreview={clearInspectedBackup}
          onConfirmRestoreBackup={restoreBackup}
        />
      ) : null}
      <LeftRail
        activeDrawer={activeDrawer}
        onDrawerChange={changeDrawer}
        onAddToCanvas={handleRailAddToCanvas}
      />
      <OverlayDrawers
        mode={activeDrawer}
        workspace={workspace}
        canMutateWorkspace={canMutateWorkspace}
        highlightedRecordIds={highlightedContinuityEntryIds}
        onClose={() => changeDrawer(null)}
        onFocusArea={focusArea}
        onRestoreObject={handleRestoreObject}
        onLocateObject={focusObject}
        onSetContinuityEntryManualState={handleSetContinuityEntryManualState}
        anchor={drawerAnchor}
      />

      {canvasContextMenu ? (
        <div
          className="canvas-menu-dismiss-layer"
          aria-hidden="true"
          onPointerDownCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!canDismissCanvasContextMenu()) {
              return;
            }
            closeCanvasContextMenu();
          }}
          onContextMenuCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!canDismissCanvasContextMenu()) {
              return;
            }
            closeCanvasContextMenu();
          }}
          onWheelCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closeCanvasContextMenu();
          }}
        />
      ) : null}
      {canvasContextMenu ? (
        <CanvasContextMenu
          x={contextMenuPlacement?.x ?? canvasContextMenu.x}
          y={contextMenuPlacement?.y ?? canvasContextMenu.y}
          kind={contextMenuKind}
          selectedObjects={contextMenuObjects}
          stage={contextMenuStage}
          hasSelection={selectedObjectIds.length > 0}
          onClose={closeCanvasContextMenu}
          onCopySummary={handleCopySelectedSummary}
          onAskAi={handleAskAi}
          onLocalEdit={handleLocalEdit}
          onReferenceIntent={handleReferenceIntent}
          onHide={handleHideSelected}
          onDelete={handleDeleteSelected}
          onReorderLayer={handleReorderSelectedLayers}
          onClearSelection={clearCanvasSelection}
          onFocusOverview={() => focusArea("overview")}
          onPasteHere={() => {
            void handleContextMenuPaste(canvasContextMenu.pagePosition);
          }}
          onImportFiles={() => handleContextMenuImportFiles(canvasContextMenu.pagePosition)}
          onSelectAllVisible={handleSelectAllVisibleObjects}
          onFitStage={() => {
            if (!canvasContextMenu.stageId) return;
            applyStageRegionWorkspaceMutation((current) => fitStageRegionToVisibleMembers(current, canvasContextMenu.stageId!));
          }}
          onToggleStageLock={() => {
            if (!canvasContextMenu.stageId) return;
            const stageId = canvasContextMenu.stageId;
            applyStageRegionWorkspaceMutation((current) => {
              const region = getStageRegions(current).find((item) => item.id === stageId);
              if (!region) return current;
              return updateStageRegionStyle(current, stageId, { locked: !region.locked });
            });
          }}
          onResetStageStyle={() => {
            if (!canvasContextMenu.stageId) return;
            applyStageRegionWorkspaceMutation((current) => resetStageRegionStyle(current, canvasContextMenu.stageId!));
          }}
          onOpenProposalDetail={() => {
            const proposalObject = contextMenuObjects.find((object) => object.type === "proposalDraft");
            if (proposalObject?.type !== "proposalDraft") {
              return;
            }
            openProposal(proposalObject.proposalId);
            closeCanvasContextMenu();
          }}
          onApplyProposal={() => {
            const proposalObject = contextMenuObjects.find((object) => object.type === "proposalDraft");
            if (proposalObject?.type !== "proposalDraft") {
              return;
            }
            applyProposal(proposalObject.proposalId);
            closeCanvasContextMenu();
          }}
          onRejectProposal={() => {
            const proposalObject = contextMenuObjects.find((object) => object.type === "proposalDraft");
            if (proposalObject?.type !== "proposalDraft") {
              return;
            }
            rejectProposal(proposalObject.proposalId);
            closeCanvasContextMenu();
          }}
          onContinueProposalDiscussion={() => {
            const proposalObject = contextMenuObjects.find((object) => object.type === "proposalDraft");
            if (proposalObject?.type !== "proposalDraft") {
              return;
            }
            continueDiscussion(proposalObject.proposalId);
            closeCanvasContextMenu();
          }}
          onOpenDesignDefinitionDetail={() => {
            const definition = contextMenuObjects.find((object) => object.type === "designDefinition");
            if (definition?.type === "designDefinition") {
              openDesignDefinitionDetail(definition.id);
            }
            closeCanvasContextMenu();
          }}
          onOpenConceptDirectionDetail={() => {
            const direction = contextMenuObjects.find((object) => object.type === "conceptDirection");
            if (direction?.type === "conceptDirection") {
              openConceptDirectionDetail(direction.id);
            }
            closeCanvasContextMenu();
          }}
        />
      ) : null}

      {documentReader && documentReaderFile?.type === "file" ? (
        <DocumentReaderPanel
          key={`${documentReader.fileObjectId}-${documentReader.requestId}`}
          file={documentReaderFile}
          extractAsset={documentReader.extractAsset}
          sourcePreview={documentReader.sourcePreview}
          text={documentReader.text}
          status={documentReader.status}
          message={documentReader.message}
          initialLocation={documentReaderInitialLocation}
          createdFragmentId={documentReader.createdFragmentId}
          onExtractFragment={handleExtractDocumentFragment}
          onViewCreatedFragment={handleViewCreatedDocumentFragmentFromReader}
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
          onClose={deliveryPreparation.close}
          onCreateDelivery={deliveryPreparation.createDelivery}
          onSelectDelivery={deliveryPreparation.selectDelivery}
          onSelectDeliverySection={deliveryPreparation.selectSection}
          onLocateObject={focusObject}
          onOpenDeliveryReferenceReader={handleOpenDeliveryReferenceReader}
          onAddSelectedObjects={deliveryPreparation.addSelectedObjects}
          onCreateSection={deliveryPreparation.createSection}
          onUpdateSection={deliveryPreparation.updateSection}
          onMoveSection={deliveryPreparation.moveSection}
          onRemoveSection={deliveryPreparation.removeSection}
          onMoveReference={deliveryPreparation.moveReference}
          onRemoveReference={deliveryPreparation.removeReference}
          onUpdateReferenceEditorial={deliveryPreparation.updateReferenceEditorial}
          onRefreshReference={deliveryPreparation.refreshReference}
          onAddGap={deliveryPreparation.addGap}
          onSetGapStatus={deliveryPreparation.setGapStatus}
          onRemoveGap={deliveryPreparation.removeGap}
          onRequestSectionDraft={handleRequestDeliverySectionDraft}
          onApplyDraft={deliveryPreparation.applyDraft}
          onDiscardDraft={deliveryPreparation.discardDraft}
        />
      ) : null}

      {activeResearchDetailObject ? (
        <ResearchDetailPanel
          workspace={workspace}
          research={activeResearchDetailObject}
          onClose={closeResearchDetail}
          onApplySelection={handleApplyResearchExtractionSelection}
        />
      ) : null}

      <AiConversationPanel
        workspace={workspace}
        selectedObjects={selectedObjects}
        suggestions={suggestions}
        draft={aiDraft}
        isOpen={aiOpen}
        isImageTaskContext={taskMode === "imageGeneration" || recommendedTaskMode === "imageGeneration"}
        isImageGenerationAuthorized={taskMode === "imageGeneration"}
        turnMode={agentTurnMode}
        activeProposal={activeProposal}
        activeOperation={activeOperation}
        isStreaming={isAiStreaming}
        imageGenerationSettings={effectiveImageGenerationSettings}
        directionPreviewCount={directionPreviewCount}
        pendingConfirmation={comparisonDecision.pendingConfirmation}
        showFailure={showFailure}
        showRecoveryPending={showRecoveryPending}
        imageTaskStatus={imageTaskStatus}
        contextWarning={contextWarning}
        migrationError={persistenceState.migrationError}
        canMutateWorkspace={canMutateWorkspace}
        focusInputRequestNonce={aiInputFocusNonce}
        onToggleOpen={() => setAiOpen((open) => !open)}
        onDraftChange={setAiDraft}
        onTurnModeChange={setAgentTurnMode}
        onImageGenerationAuthorizationChange={(authorized) =>
          setTaskMode(authorized ? "imageGeneration" : "chatAnalysis")
        }
        onImageGenerationSettingsChange={updateImageGenerationSettings}
        onDirectionPreviewCountChange={setDirectionPreviewCount}
        onSuggestionClick={handleSuggestionClick}
        onSendMessage={handleSendMorphoAgentTurn}
        onCancelRequest={handleCancelAiRequest}
        onApplyProposal={applyActiveProposal}
        onRejectProposal={rejectProposal}
        onContinueProposalDiscussion={continueDiscussion}
        onRegenerateProposal={regenerateProposal}
        onSaveResearchProposalDraft={saveResearchDraft}
        onSaveDesignDefinitionProposalDraft={saveDesignDefinitionDraft}
        onSaveConceptDirectionProposalDraft={saveConceptDirectionDraft}
        onUpdatePendingKeyConclusion={confirmationExecution.updatePendingKeyConclusion}
        onUpdatePendingComparison={comparisonDecision.updatePendingReason}
        onRequestComparisonAction={comparisonDecision.requestAction}
        onLocateObject={focusObject}
        onConfirmPending={handleConfirmPending}
        onConfirmPendingSecondary={confirmationExecution.confirmWithReviewMarks}
        onCancelPending={() => {
          if (pendingConfirmation && isComparisonPendingConfirmation(pendingConfirmation)) {
            comparisonDecision.cancel();
            return;
          }
          void confirmationExecution.cancel();
        }}
        onFailureRetry={retryRecovery}
        onFailureEdit={editFailedTurn}
        onOpenProjectRecords={openProjectRecords}
      />

      {!documentReader ? (
        <BottomDetailBar
          workspace={workspace}
          selectedObjects={selectedObjects}
          assets={workspace.assets}
          assetUrls={assetUrls}
          hasPendingDesignDefinitionRevisionDraft={hasPendingDesignDefinitionRevisionDraft}
          relations={workspace.relations}
          directionLineage={workspace.directionLineage}
          visualBranches={workspace.visualBranches}
          decisionRecords={workspace.decisionRecords}
          activeDesignTrace={activeDesignTrace}
          onRenameVisualBranch={handleRenameVisualBranch}
          onArchiveVisualBranch={handleArchiveVisualBranch}
          onRestoreVisualBranch={handleRestoreVisualBranch}
          onSaveKeyConclusionFromResearchItem={handleSaveKeyConclusionFromResearchItem}
          onSetKeyConclusionCategory={handleSetKeyConclusionCategory}
          onCopyItemToDraft={handleCopyItemToDraft}
          onContinueQuestion={handleContinueQuestion}
          onOpenDocumentReader={handleOpenDocumentReader}
          onPreviewObject={setDetailHoverObjectId}
          onLocateObject={locateObjectFromDetail}
          onKeepReviewedVisual={handleKeepReviewedVisual}
          onRegenerateReviewedVisual={handleRegenerateReviewedVisual}
        />
      ) : null}
    </main>
  );
}

function WorkspaceTextPromptDialog({
  prompt,
  onCancel,
  onSubmit
}: {
  prompt: WorkspaceTextPrompt;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(prompt.initialValue);
  const canSubmit = Boolean(prompt.allowEmpty) || Boolean(value.trim());

  return (
    <aside className="workspace-text-prompt" aria-label={prompt.title}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) {
            return;
          }
          onSubmit(value);
        }}
      >
        <div className="workspace-text-prompt-header">
          <strong>{prompt.title}</strong>
          <button type="button" aria-label="关闭" onClick={onCancel}>
            ×
          </button>
        </div>
        <p>{prompt.body}</p>
        <label>
          <span>{prompt.label}</span>
          <textarea autoFocus rows={3} value={value} onChange={(event) => setValue(event.currentTarget.value)} />
        </label>
        <div className="workspace-text-prompt-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button className="brand" type="submit" disabled={!canSubmit}>
            {prompt.kind === "eliminateDirection" ? "确认淘汰" : "确认"}
          </button>
        </div>
      </form>
    </aside>
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

function buildKeyConclusionDraftFromObject(object: MorphoObject):
  | {
      title: string;
      body: string;
      summary: string;
      category: AssignableKeyConclusionCategory | null;
      confidence: "supported" | "partial" | "needsVerification";
      state?: "active" | "needsVerification";
      note: string;
    }
  | null {
  switch (object.type) {
    case "research": {
      const primaryClaim = object.findings[0]
        ? { category: "finding" as const, text: object.findings[0] }
        : object.opportunities[0]
          ? { category: "opportunity" as const, text: object.opportunities[0] }
          : object.constraints[0]
            ? { category: "constraint" as const, text: object.constraints[0] }
            : object.openQuestions[0]
              ? { category: "openQuestion" as const, text: object.openQuestions[0] }
              : null;
      if (!primaryClaim) {
        return null;
      }
      return {
        title: truncateForTitle(primaryClaim.text || object.title, "关键结论"),
        summary: primaryClaim.text || object.summary,
        body: buildResearchConclusionBody(object),
        category: primaryClaim.category,
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
        category: null,
        confidence: "needsVerification",
        state: "needsVerification",
        note: `用户从文本对象“${object.title}”中保留关键结论，后续仍需复核。`
      };
    case "link":
      return {
        title: truncateForTitle(object.editableTitle || object.title, "关键结论"),
        summary: object.summary,
        body: [object.description, object.summary, object.url].filter(Boolean).join("\n\n"),
        category: null,
        confidence: "needsVerification",
        state: "needsVerification",
        note: `用户从链接对象“${object.title}”中保留关键结论，后续仍需复核来源有效性。`
      };
    case "file":
      return {
        title: truncateForTitle(object.title, "关键结论"),
        summary: object.summary,
        body: [object.summary, object.fileName, object.mimeType].filter(Boolean).join("\n\n"),
        category: null,
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

