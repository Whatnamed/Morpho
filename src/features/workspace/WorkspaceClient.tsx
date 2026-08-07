"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
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
  applyConceptDirectionProposal,
  applyDesignDefinitionProposal,
  applyResearchAnalysisProposal,
  canStartOperation,
  createArtifactProposalOperation,
  createResearchOperation,
  getActiveOperation,
  rejectArtifactProposal,
  recordAndApplyConceptDirectionProposal,
  recordDesignDefinitionProposal,
  setCurrentDesignDefinition,
  updateConceptDirectionProposalDraft,
  updateDesignDefinitionProposalDraft,
  updateResearchAnalysisProposalDraft
} from "@/domain/operations/operations";
import type { ConceptDirectionProposal, OperationRecord } from "@/domain/operations/types";
import { normalizeResearchItems } from "@/domain/operations/researchItems";
import {
  archiveVisualBranch,
  assignImageToVisualBranch,
  buildKeyConclusionDraftFromResearchSource,
  createKeyConclusion,
  createAiDraftFromSuggestion,
  deleteObjects,
  deleteObject,
  clearDefaultReference,
  clearVisualReviewMark,
  collectDefaultReferenceReviewTargets,
  eliminateDirection,
  createVisualBranch,
  hideObjects,
  removeImageFromVisualBranch,
  renameVisualBranch,
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
import type { PendingAiConfirmation, PendingComparisonConfirmation } from "./components/AiConversationPanel";
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
import { buildProposalDiscussionDraft, buildProposalRegenerationDraft } from "./proposalFollowupPrompts";
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
import { useWorkspaceImportController } from "./useWorkspaceImportController";
import { resolveComparisonWritebackSourceObjectIds } from "./comparisonDecision";
import {
  applyResearchExtractionSelection,
  constrainResearchEvidence,
  getResearchExtractionRecommendationKeys
} from "./researchExtraction";
import {
  validateComparisonActionTarget,
  validateComparisonKeyConclusionSources,
  type ComparisonActionKind
} from "./comparisonAction";
import {
  buildTaskContext,
  type TaskContextDefaultReference
} from "./taskContext";
import { setConversationSemanticEntryManualState } from "@/domain/morpho/projectContinuity";
import {
  applyComparisonAnalysis,
  buildComparisonAuthorization,
  validateComparisonAnalysis
} from "@/domain/morpho/comparisonAnalysis";
import type { ComparisonDecisionMetadata } from "@/domain/morpho/types";
import { applyResearchProposalWithSemanticPatch } from "./researchSemanticPatch";
import {
  getPlacementNearObjects,
  getProposalPlacement,
  getSiblingProposalPlacement
} from "./proposalDraftPlacement";
import {
  getDefaultImageGenerationSettings,
  inferGenerationAspectRatio,
  resolveGenerationSettings,
  type ImageGenerationSettings
} from "./imageGenerationSettings";
import {
  getDesignDefinitionDrafts,
  type MorphoAgentTurnMode
} from "./morphoAgent";
import { commitWorkspaceStateNow } from "./workspaceCommitBoundary";
import { useWorkspaceAgentRuntimeController } from "./useWorkspaceAgentRuntimeController";
import {
  useWorkspaceVisualGenerationController
} from "./useWorkspaceVisualGenerationController";
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

type SaveResearchKeyConclusionInput = {
  researchObjectId: string;
} & ResearchKeyConclusionSource;

type ObjectOperationUndoEntry = {
  workspace: MorphoWorkspace;
  selectedObjectIds: string[];
  localEditObjectId: string | null;
  pendingConfirmation: PendingAiConfirmation | null;
};

type WorkspaceTextPrompt =
  | {
      kind: "createVisualBranch";
      directionId: string;
      title: string;
      body: string;
      label: string;
      initialValue: string;
      allowEmpty?: false;
    }
  | {
      kind: "renameVisualBranch";
      branchId: string;
      title: string;
      body: string;
      label: string;
      initialValue: string;
      allowEmpty?: false;
    }
  | {
      kind: "eliminateDirection";
      directionId: string;
      title: string;
      body: string;
      label: string;
      initialValue: string;
      allowEmpty: true;
      comparison?: ComparisonDecisionMetadata;
    };

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

export function WorkspaceClient({ projectId }: WorkspaceClientProps) {
  const router = useRouter();
  const [workspace, setWorkspace, persistenceState, flushWorkspace] = usePersistentWorkspace(projectId);
  const workspaceReady = persistenceState.isWorkspaceLoaded && workspace.project.id === projectId;
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
  } = useDeliveryOutputController({ workspace });
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
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAiConfirmation | null>(null);
  const [textPrompt, setTextPrompt] = useState<WorkspaceTextPrompt | null>(null);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
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
    <T,>(transform: (current: MorphoWorkspace) => { workspace: MorphoWorkspace; value: T }): T =>
      commitWorkspaceStateNow(setWorkspace, transform),
    [setWorkspace]
  );
  const readWorkspaceNow = useCallback(
    () => commitWorkspaceNow((current) => ({ workspace: current, value: current })),
    [commitWorkspaceNow]
  );
  const { importRequest } = useWorkspaceImportController({
    projectId,
    workspaceReady,
    commitWorkspace: commitWorkspaceNow,
    selectObjects: requestCanvasSelection
  });
  const assetUrls = useWorkspaceAssetUrls(workspace.assets);
  const railImportInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImportPositionRef = useRef<{ x: number; y: number } | null>(null);
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
  const activeProposal = useMemo(() => {
    return activeProposalId && workspace.artifactProposals[activeProposalId]?.status === "pending"
      ? workspace.artifactProposals[activeProposalId]
      : undefined;
  }, [activeProposalId, workspace.artifactProposals]);
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

  const handleManualSave = useCallback(() => {
    const result = flushWorkspace();
    if (result.phase === "readOnly") {
      showWorkspaceNotice("这个标签页是只读的，改动不会保存。", 2600);
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
      setWorkspace((current) => setConversationSemanticEntryManualState(current, entryId, manualState));
      openProjectRecords([entryId]);
    },
    [openProjectRecords, setWorkspace]
  );

  const captureObjectOperationSnapshot = useCallback(
    (): ObjectOperationUndoEntry => ({
      workspace,
      selectedObjectIds,
      localEditObjectId,
      pendingConfirmation
    }),
    [localEditObjectId, pendingConfirmation, selectedObjectIds, workspace]
  );

  const applyObjectOperationSnapshot = useCallback(
    (entry: ObjectOperationUndoEntry) => {
      setWorkspace(entry.workspace);
      requestCanvasSelection(entry.selectedObjectIds);
      setLocalEditObjectId(entry.localEditObjectId);
      setPendingConfirmation(entry.pendingConfirmation);
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
    railImportInputRef.current?.click();
  }, []);
  const handleRailImportFiles = useCallback(
    (files: FileList | null) => {
      const selectedFiles = files ? Array.from(files) : [];
      if (selectedFiles.length === 0) {
        return;
      }

      const position = pendingImportPositionRef.current ?? {
        x: workspace.canvas.view.x + 180,
        y: workspace.canvas.view.y + 180
      };
      pendingImportPositionRef.current = null;

      void importRequest({
        files: selectedFiles,
        position
      });
    },
    [importRequest, workspace.canvas.view.x, workspace.canvas.view.y]
  );

  const handleContextMenuPaste = useCallback(
    async (pagePosition?: { x: number; y: number }) => {
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
      await importRequest({
        position,
        files: result.files,
        url: result.url,
        text: result.text
      });
    },
    [getLatestCanvasView, importRequest, showWorkspaceNotice]
  );

  const handleContextMenuImportFiles = useCallback((pagePosition?: { x: number; y: number }) => {
    const latestCanvasView = getLatestCanvasView();
    pendingImportPositionRef.current = pagePosition ?? {
      x: latestCanvasView.x + 180,
      y: latestCanvasView.y + 180
    };
    railImportInputRef.current?.click();
  }, [getLatestCanvasView]);

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
      const next = ensureStageRegions(current);
      return next === current ? current : next;
    });
  }, [setWorkspace, workspace.project.id, workspace.objects]);

  const visualGeneration = useWorkspaceVisualGenerationController({
    projectId,
    workspaceReady,
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
    cancel: cancelAiRequest,
    acknowledgePendingConfirmation,
    beginLocalAbortableTask,
    finishLocalAbortableTask
  } = useWorkspaceAgentRuntimeController({
    projectId,
    workspaceReady,
    commitWorkspace: commitWorkspaceNow,
    readWorkspace: readWorkspaceNow,
    persistWorkspace: flushWorkspace,
    executeVisualGenerationPlan,
    setContextWarning,
    clearPendingDeliveryDraftTarget: clearPendingDraftTarget,
    setDraft: setAiDraft,
    setTaskMode,
    openConversation: () => setAiOpen(true),
    setPendingConfirmation,
    selectObjects: setSelectedObjectIds,
    focusObject: requestObjectFocus,
    openProposal: setActiveProposalId,
    setImageTaskStatus
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
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }
    setTextPrompt({
      kind: "createVisualBranch",
      directionId: target.id,
      title: "新视觉分支",
      body: "为当前方向创建一条可继续发展的视觉路线。创建分支不会移动、删除或改写现有图片。",
      label: "分支名称",
      initialValue: "未分组视觉探索"
    });
  }, [selectedObjects]);

  const handleRenameVisualBranch = useCallback(
    (branchId: string) => {
      const branch = workspace.visualBranches[branchId];
      if (!branch) {
        return;
      }
      setTextPrompt({
        kind: "renameVisualBranch",
        branchId,
        title: "重命名视觉分支",
        body: "只更新分支名称，不改变图片、方向、版本或交付引用。",
        label: "分支名称",
        initialValue: branch.label
      });
    },
    [workspace.visualBranches]
  );

  const handleSubmitTextPrompt = useCallback(
    (value: string) => {
      if (!textPrompt) {
        return;
      }
      const trimmedValue = value.trim();
      if (!trimmedValue && !textPrompt.allowEmpty) {
        return;
      }

      if (textPrompt.kind === "createVisualBranch") {
        setWorkspace((current) => {
          const result = createVisualBranch(current, {
            directionId: textPrompt.directionId,
            label: trimmedValue
          });
          if (result.status === "blocked") {
            setContextWarning(result.reason);
            return current;
          }
          return result.workspace;
        });
      } else if (textPrompt.kind === "renameVisualBranch") {
        setWorkspace((current) => {
          const result = renameVisualBranch(current, textPrompt.branchId, trimmedValue);
          if (result.status === "blocked") {
            setContextWarning(result.reason);
            return current;
          }
          return result.workspace;
        });
      } else {
        const reason =
          trimmedValue ||
          (textPrompt.comparison
            ? "用户从 Compare 明确淘汰该方向。"
            : "用户明确淘汰该方向。");
        pushObjectOperationUndo();
        setWorkspace((current) =>
          eliminateDirection(current, textPrompt.directionId, {
            reason,
            comparison: textPrompt.comparison
              ? {
                  ...textPrompt.comparison,
                  userReason: trimmedValue || undefined
                }
              : undefined
          })
        );
        const direction = workspace.objects[textPrompt.directionId];
        showWorkspaceNotice(
          direction?.type === "conceptDirection" ? `已淘汰方向「${direction.title}」` : "已淘汰方向"
        );
      }

      setTextPrompt(null);
    },
    [pushObjectOperationUndo, setWorkspace, showWorkspaceNotice, textPrompt, workspace.objects]
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

  const handleApplyProposal = useCallback((allowSourceChanged = false) => {
    if (!activeProposal) {
      return;
    }

    if (activeProposal.type === "researchAnalysis") {
      const position = getProposalDraftCanvasPosition(workspace, activeProposal.id, {
        x: workspace.canvas.view.x + 220,
        y: workspace.canvas.view.y + 180
      });
      const result = applyResearchAnalysisProposal(workspace, activeProposal.id, {
        position,
        allowSourceChanged
      });

      if (result.status === "updated") {
        setWorkspace(
          appendAiAssistantNotice(
            result.workspace,
            "research-proposal-applied",
            `已保存到画布：研究卡「${result.researchObject.title}」。我已选中并定位到它。`,
            activeProposal.id
          )
        );
        requestFocusObject(result.researchObject.id);
        setActiveProposalId(null);
        closeProposalDetail();
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
        setWorkspace(
          appendAiAssistantNotice(
            result.workspace,
            "design-definition-proposal-applied",
            `已应用到画布：设计定义「${result.designDefinitionObject.title}」。我已选中并定位到它。`,
            activeProposal.id
          )
        );
        requestFocusObject(result.designDefinitionObject.id);
        setActiveProposalId(null);
        closeProposalDetail();
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
      const position = getProposalDraftCanvasPosition(workspace, activeProposal.id, {
        x: workspace.canvas.view.x + 260,
        y: workspace.canvas.view.y + 220
      });
      const result = applyConceptDirectionProposal(workspace, activeProposal.id, {
        position,
        allowSourceChanged
      });
      if (result.status === "updated") {
        setWorkspace(
          appendAiAssistantNotice(
            result.workspace,
            "concept-direction-proposal-applied",
            `已应用到画布：${result.directions.length} 个概念方向。我已选中并定位到第一个方向。`,
            activeProposal.id
          )
        );
        setSelectedObjectIds(result.directions.map((direction) => direction.id));
        if (result.directions[0]) {
          requestObjectFocus(result.directions[0].id);
        }
        setActiveProposalId(null);
        closeProposalDetail();
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
  }, [activeProposal, closeProposalDetail, requestFocusObject, requestObjectFocus, setSelectedObjectIds, setWorkspace, workspace]);

  const handleApplyProposalFromCanvas = useCallback(
    (proposalId: string, allowSourceChanged = false) => {
      setActiveProposalId(proposalId);
      const proposal = workspace.artifactProposals[proposalId];
      if (!proposal || proposal.status !== "pending") {
        return;
      }

      if (proposal.type === "researchAnalysis") {
        const position = getProposalDraftCanvasPosition(workspace, proposal.id, {
          x: workspace.canvas.view.x + 220,
          y: workspace.canvas.view.y + 180
        });
        const result = applyResearchAnalysisProposal(workspace, proposal.id, {
          position,
          allowSourceChanged
        });

        if (result.status === "updated") {
          setWorkspace(
            appendAiAssistantNotice(
              result.workspace,
              "research-proposal-applied",
              `已保存到画布：研究卡「${result.researchObject.title}」。我已选中并定位到它。`,
              proposal.id
            )
          );
          requestFocusObject(result.researchObject.id);
          setActiveProposalId(null);
          closeProposalDetail();
        } else {
          setWorkspace(
            appendAiAssistantFailureMessage(
              result.workspace,
              "research-proposal-failed",
              `${result.reason} 请整理来源后再确认。`,
              proposal.id
            )
          );
        }

        setAiDraft("");
        setTaskMode("chatAnalysis");
        return;
      }

      if (proposal.type === "designDefinition") {
        const result = applyDesignDefinitionProposal(workspace, proposal.id, { allowSourceChanged });
        if (result.status === "updated") {
          setWorkspace(
            appendAiAssistantNotice(
              result.workspace,
              "design-definition-proposal-applied",
              `已应用到画布：设计定义「${result.designDefinitionObject.title}」。我已选中并定位到它。`,
              proposal.id
            )
          );
          requestFocusObject(result.designDefinitionObject.id);
          setActiveProposalId(null);
          closeProposalDetail();
        } else {
          setWorkspace(
            appendAiAssistantFailureMessage(
              result.workspace,
              "design-definition-proposal-failed",
              `${result.reason} 请复核后再确认。`,
              proposal.id
            )
          );
        }

        setAiDraft("");
        setTaskMode("chatAnalysis");
        return;
      }

      if (proposal.type === "conceptDirection") {
        const position = getProposalDraftCanvasPosition(workspace, proposal.id, {
          x: workspace.canvas.view.x + 260,
          y: workspace.canvas.view.y + 220
        });
        const result = applyConceptDirectionProposal(workspace, proposal.id, {
          position,
          allowSourceChanged
        });
        if (result.status === "updated") {
          setWorkspace(
            appendAiAssistantNotice(
              result.workspace,
              "concept-direction-proposal-applied",
              `已应用到画布：${result.directions.length} 个概念方向。我已选中并定位到第一个方向。`,
              proposal.id
            )
          );
          setSelectedObjectIds(result.directions.map((direction) => direction.id));
          if (result.directions[0]) {
            requestObjectFocus(result.directions[0].id);
          }
          setActiveProposalId(null);
          closeProposalDetail();
        } else {
          setWorkspace(
            appendAiAssistantFailureMessage(
              result.workspace,
              "concept-direction-proposal-failed",
              `${result.reason} 请复核后再确认。`,
              proposal.id
            )
          );
        }

        setAiDraft("");
        setTaskMode("chatAnalysis");
      }
    },
    [closeProposalDetail, requestFocusObject, requestObjectFocus, setSelectedObjectIds, setWorkspace, workspace]
  );

  const handleRejectProposal = useCallback(
    (proposalId: string) => {
      setWorkspace((current) => rejectArtifactProposal(current, proposalId, "用户明确放弃当前草案。"));
      setActiveProposalId((current) => (current === proposalId ? null : current));
      closeProposalDetailIf([proposalId]);
      setSelectedObjectIds((current) => current.filter((selectedId) => selectedId !== proposalId));
    },
    [closeProposalDetailIf, setSelectedObjectIds, setWorkspace]
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
      setPendingConfirmation({
        kind: "setDefaultReference",
        targetObjectId: target.id,
        targetTitle: target.title,
        previousReferenceObjectId: previousReference.id,
        previousReferenceTitle: previousReference.title,
        reviewImageCount: reviewTargets.imageIds.length,
        reviewCollectionCount: reviewTargets.collectionIds.length
      });
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
  }, [pushObjectOperationUndo, selectedObjects, setWorkspace, showWorkspaceNotice, workspace]);

  const handleConfirmPending = useCallback(async () => {
    if (!pendingConfirmation) {
      return;
    }
    await acknowledgePendingConfirmation();

    if (pendingConfirmation.kind === "batchGenerateVisuals" || pendingConfirmation.kind === "agentGenerateVisuals") {
      const localTask = beginLocalAbortableTask();
      if (!localTask) {
        return;
      }
      setPendingConfirmation(null);
      setAiDraft("");
      setImageTaskStatus({
        state: "preparing",
        message: `正在批量生成 ${pendingConfirmation.plan.items.length} 张图像`
      });

      try {
        const result = await executeVisualGenerationPlan({
          workspaceSnapshot: workspace,
          draft: pendingConfirmation.draft,
          plan: pendingConfirmation.plan,
          sourceObjectIds: pendingConfirmation.sourceObjectIds,
          selectedDirectionIds: pendingConfirmation.selectedDirectionIds,
          selectedImageIds: pendingConfirmation.selectedImageIds,
          signal: localTask.signal
        });
        if (!localTask.isCurrent()) {
          return;
        }
        setWorkspace(() =>
          appendAiAssistantNotice(
            result.workspace,
            "agent-batch-generate-visuals",
            result.failedItems.length > 0
              ? `已按确认生成并保存 ${result.createdObjectIds.length} 张新图像，另有 ${result.failedItems.length} 项失败。`
              : `已按确认生成并保存 ${result.createdObjectIds.length} 张新图像。`
          )
        );
      } catch (error) {
        if (!localTask.isCurrent()) {
          return;
        }
        const isCancelled = error instanceof DOMException && error.name === "AbortError";
        const message = isCancelled
          ? "批量图像生成已取消。"
          : error instanceof Error
            ? error.message
            : "批量图像生成失败。";
        setAiDraft(pendingConfirmation.draft);
        setImageTaskStatus({ state: isCancelled ? "cancelled" : "failed", message });
        setWorkspace((current) =>
          appendAiAssistantFailureMessage(current, "agent-batch-generate-visuals", message)
        );
      } finally {
        finishLocalAbortableTask(localTask.controller);
      }
      return;
    }

    if (pendingConfirmation.kind === "agentCreateResearchAnalysis") {
      setWorkspace((current) => {
        const operationGate = canStartOperation(current);
        if (operationGate.status === "blocked") {
          return appendAiAssistantFailureMessage(current, "agent-confirm-research", operationGate.reason);
        }
        const created = createResearchOperation(current, {
          userInput: pendingConfirmation.draft,
          selectedObjectIds: pendingConfirmation.sourceObjectIds,
          allowWebSearch: pendingConfirmation.citations.length > 0
        });
        const proposalId = `proposal-research-${created.operation.id}-${Date.now()}`;
        const applied = applyResearchProposalWithSemanticPatch({
          workspace: created.workspace,
          proposal: {
            proposalId,
            operationId: created.operation.id,
            title: pendingConfirmation.args.title,
            summary: pendingConfirmation.args.summary,
            findings: normalizeResearchItems(pendingConfirmation.args.findings),
            opportunities: normalizeResearchItems(pendingConfirmation.args.opportunities),
            constraints: normalizeResearchItems(pendingConfirmation.args.constraints),
            openQuestions: normalizeResearchItems(pendingConfirmation.args.openQuestions),
            evidence: constrainResearchEvidence(
              pendingConfirmation.args,
              pendingConfirmation.sourceObjectIds,
              pendingConfirmation.citations
            ),
            sourceObjectIds: pendingConfirmation.sourceObjectIds,
            citations: pendingConfirmation.citations
          },
          position: getPlacementNearObjects(created.workspace, pendingConfirmation.sourceObjectIds, {
            x: created.workspace.canvas.view.x + 220,
            y: created.workspace.canvas.view.y + 180
          }),
          context: buildTaskContext(current, {
            kind: "general",
            draft: pendingConfirmation.draft,
            selectedObjectIds: pendingConfirmation.sourceObjectIds
          }),
          draft: pendingConfirmation.draft,
          userMessageId: `ai-user-confirm-${Date.now()}`,
          userMessageCreatedAt: new Date().toISOString(),
          assistantText: ""
        });
        return applied.workspace;
      });
      setPendingConfirmation(null);
      setAiDraft("");
      return;
    }

    if (pendingConfirmation.kind === "agentCreateDesignDefinitionProposal") {
      setWorkspace((current) => {
        const operationGate = canStartOperation(current);
        if (operationGate.status === "blocked") {
          return appendAiAssistantFailureMessage(current, "agent-confirm-definition", operationGate.reason);
        }
        const operationId = `operation-designDefinition-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const created = createArtifactProposalOperation(current, {
          operationId,
          type: "designDefinition",
          userInput: pendingConfirmation.draft,
          selectedObjectIds: pendingConfirmation.sourceObjectIds,
          workIntent: "createDesignDefinition"
        });
        const basedOnDefinitionId = current.workingState.currentDesignDefinitionId;
        const basedOnDefinitionObject = basedOnDefinitionId ? current.objects[basedOnDefinitionId] : undefined;
        const proposalPlacement = getProposalPlacement(created.workspace, pendingConfirmation.sourceObjectIds, "definition");
        let nextWorkspace = created.workspace;
        for (const [proposalIndex, proposalDraft] of getDesignDefinitionDrafts(pendingConfirmation.args).entries()) {
          const recorded = recordDesignDefinitionProposal(nextWorkspace, {
            operationId,
            workIntent: "createDesignDefinition",
            title: proposalDraft.title,
            summary: proposalDraft.summary,
            projectGoal: proposalDraft.projectGoal,
            targetUsers: proposalDraft.targetUsers,
            primaryScenarios: proposalDraft.primaryScenarios,
            coreProblem: proposalDraft.coreProblem,
            designPrinciples: proposalDraft.designPrinciples,
            constraints: proposalDraft.constraints,
            avoidDirections: proposalDraft.avoidDirections,
            opportunities: proposalDraft.opportunities,
            openQuestions: proposalDraft.openQuestions,
            changeNote: proposalDraft.changeNote,
            sourceObjectIds: pendingConfirmation.sourceObjectIds,
            citations: pendingConfirmation.citations,
            basedOnDesignDefinitionId:
              basedOnDefinitionObject?.type === "designDefinition" ? basedOnDefinitionObject.id : undefined,
            basedOnRevisionId:
              basedOnDefinitionObject?.type === "designDefinition"
                ? basedOnDefinitionObject.currentRevisionId
                : undefined,
            position: getSiblingProposalPlacement(proposalPlacement, proposalIndex)
          });
          nextWorkspace = recorded.workspace;
        }
        return nextWorkspace;
      });
      setPendingConfirmation(null);
      setAiDraft("");
      return;
    }

    if (pendingConfirmation.kind === "agentCreateConceptDirectionProposal") {
      setWorkspace((current) => {
        const operationGate = canStartOperation(current);
        if (operationGate.status === "blocked") {
          return appendAiAssistantFailureMessage(current, "agent-confirm-direction", operationGate.reason);
        }
        const operationId = `operation-conceptDirection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const created = createArtifactProposalOperation(current, {
          operationId,
          type: "conceptDirection",
          userInput: pendingConfirmation.draft,
          selectedObjectIds: pendingConfirmation.sourceObjectIds,
          workIntent: "createConceptDirections"
        });
        const basedOnDefinitionId = current.workingState.currentDesignDefinitionId;
        const basedOnDefinitionObject = basedOnDefinitionId ? current.objects[basedOnDefinitionId] : undefined;
        const placed = recordAndApplyConceptDirectionProposal(created.workspace, {
          operationId,
          workIntent: "createConceptDirections",
          title: pendingConfirmation.args.title,
          summary: pendingConfirmation.args.summary,
          directions: pendingConfirmation.args.directions,
          sourceObjectIds: pendingConfirmation.sourceObjectIds,
          citations: pendingConfirmation.citations,
          basedOnDesignDefinitionId: basedOnDefinitionObject?.type === "designDefinition" ? basedOnDefinitionObject.id : undefined,
          basedOnRevisionId: basedOnDefinitionObject?.type === "designDefinition" ? basedOnDefinitionObject.currentRevisionId : undefined,
          position: getProposalPlacement(created.workspace, pendingConfirmation.sourceObjectIds, "direction")
        });
        if (placed.status === "blocked") {
          return appendAiAssistantFailureMessage(placed.workspace, "agent-confirm-direction", placed.reason, placed.proposal.id);
        }
        setSelectedObjectIds(placed.directions.map((direction) => direction.id));
        if (placed.directions[0]) {
          requestObjectFocus(placed.directions[0].id);
        }
        return appendAiAssistantNotice(
          placed.workspace,
          "agent-confirm-direction-applied",
          `已应用到画布：${placed.directions.length} 个概念方向。我已选中并定位到第一个方向。`,
          placed.proposal.id
        );
      });
      setPendingConfirmation(null);
      setAiDraft("");
      return;
    }

    if (pendingConfirmation.kind === "agentCreateComparisonAnalysis") {
      setWorkspace((current) => {
        const authorizationResult = buildComparisonAuthorization({
          workspace: current,
          selectedObjectIds: pendingConfirmation.selectedObjectIds,
          userMessageId: pendingConfirmation.userMessageId,
          assistantMessageId: pendingConfirmation.assistantMessageId,
          createdAt: new Date().toISOString(),
          comparisonGoal: pendingConfirmation.args.comparisonGoal,
          imageAttachmentObjectIds: pendingConfirmation.imageAttachmentObjectIds,
          documentExtractObjectIds: pendingConfirmation.documentExtractObjectIds,
          documentFragmentExtractObjectIds: pendingConfirmation.documentFragmentExtractObjectIds
        });
        if (!("authorization" in authorizationResult)) {
          return appendAiAssistantFailureMessage(
            current,
            "agent-confirm-comparison",
            authorizationResult.status === "blocked" ? authorizationResult.reason : "Compare authorization was not created."
          );
        }
        const validation = validateComparisonAnalysis(pendingConfirmation.args, authorizationResult.authorization);
        if (validation.status !== "ok") {
          return appendAiAssistantFailureMessage(current, "agent-confirm-comparison", validation.reason);
        }
        return applyComparisonAnalysis(current, validation.analysis);
      });
      setPendingConfirmation(null);
      setAiDraft("");
      return;
    }

    if (pendingConfirmation.kind === "agentRequestedAction") {
      setWorkspace((current) =>
        applyRequestedAgentAction(current, pendingConfirmation, {
          executeVisuals: pendingConfirmation.visualPlan
            ? undefined
            : "缺少可执行的视觉生成计划，未改变项目状态。"
        })
      );
      if (pendingConfirmation.action === "batchGenerateVisuals" && pendingConfirmation.visualPlan) {
        const localTask = beginLocalAbortableTask();
        if (!localTask) {
          return;
        }
        setPendingConfirmation(null);
        setAiDraft("");
        try {
          const result = await executeVisualGenerationPlan({
            workspaceSnapshot: workspace,
            draft: pendingConfirmation.draft,
            plan: pendingConfirmation.visualPlan,
            sourceObjectIds: pendingConfirmation.sourceObjectIds,
            selectedDirectionIds: pendingConfirmation.selectedDirectionIds,
            selectedImageIds: pendingConfirmation.selectedImageIds,
            signal: localTask.signal
          });
          if (!localTask.isCurrent()) {
            return;
          }
          setWorkspace(() => result.workspace);
        } finally {
          finishLocalAbortableTask(localTask.controller);
        }
      }
      setPendingConfirmation(null);
      setAiDraft("");
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
          category: keyConclusionDraft.category,
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
      pushObjectOperationUndo();
      setWorkspace((current) =>
        setDefaultReference(current, pendingConfirmation.targetObjectId, {
          reason: "用户在默认参考确认卡中明确只替换后续默认参考。"
        })
      );
      setPendingConfirmation(null);
      setAiDraft("");
      showWorkspaceNotice(`已替换后续默认参考为「${pendingConfirmation.targetTitle}」`);
      return;
    }

    if (pendingConfirmation.kind === "createKeyConclusion") {
      if (!pendingConfirmation.category) {
        showWorkspaceNotice("请选择关键结论类别后再保存。");
        return;
      }
      const result = createKeyConclusion(workspace, {
        title: pendingConfirmation.conclusionTitle,
        body: pendingConfirmation.body,
        summary: pendingConfirmation.summary,
        sourceObjectIds: pendingConfirmation.sourceObjectIds,
        citationIds: pendingConfirmation.citationIds,
        category: pendingConfirmation.category,
        confidence: pendingConfirmation.confidence,
        state: pendingConfirmation.state,
        note: pendingConfirmation.note,
        position: {
          x: workspace.canvas.view.x + 240,
          y: workspace.canvas.view.y + 180
        }
      });

      setWorkspace(result.workspace);
      requestFocusObject(result.keyConclusion.id);
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
  }, [
    acknowledgePendingConfirmation,
    beginLocalAbortableTask,
    executeVisualGenerationPlan,
    finishLocalAbortableTask,
    pendingConfirmation,
    pushObjectOperationUndo,
    requestFocusObject,
    requestObjectFocus,
    setSelectedObjectIds,
    setWorkspace,
    showWorkspaceNotice,
    workspace
  ]);

  const handleConfirmPendingWithReviewMarks = useCallback(() => {
    if (pendingConfirmation?.kind !== "setDefaultReference") {
      return;
    }

    pushObjectOperationUndo();
    setWorkspace((current) =>
      setDefaultReference(current, pendingConfirmation.targetObjectId, {
        reason: "用户在默认参考确认卡中选择替换默认参考，并标记直接延展素材待复核。",
        markReplacedDerivativesForReview: true
      })
    );
    void acknowledgePendingConfirmation();
    setPendingConfirmation(null);
    setAiDraft("");
    showWorkspaceNotice(`已替换默认参考为「${pendingConfirmation.targetTitle}」，直接延展素材已标记待复核`);
  }, [acknowledgePendingConfirmation, pendingConfirmation, pushObjectOperationUndo, setWorkspace, showWorkspaceNotice]);

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
    if (selectedObjects.length === 0) {
      return;
    }

    const proposalObjects = selectedObjects.filter((object) => object.type === "proposalDraft");
    const objectIds = selectedObjects.filter((object) => object.type !== "proposalDraft").map((object) => object.id);
    if (objectIds.length > 0) {
      pushObjectOperationUndo();
    }
    setWorkspace((current) => {
      const hidden = objectIds.length > 0 ? hideObjects(current, objectIds) : current;
      return proposalObjects.reduce(
        (next, object) => rejectArtifactProposal(next, object.proposalId, "用户从画布隐藏并放弃当前草案。"),
        hidden
      );
    });
    const removedIds = [...objectIds, ...proposalObjects.map((object) => object.id)];
    setSelectedObjectIds((current) => current.filter((selectedId) => !removedIds.includes(selectedId)));
    setLocalEditObjectId((current) => (current && removedIds.includes(current) ? null : current));
    setActiveProposalId((current) => (current && removedIds.includes(current) ? null : current));
    closeProposalDetailIf(removedIds);
    closeCanvasContextMenu();
  }, [closeCanvasContextMenu, closeProposalDetailIf, pushObjectOperationUndo, selectedObjects, setSelectedObjectIds, setWorkspace]);

  const handleRestoreObject = useCallback(
    (objectId: string) => {
      setWorkspace((current) => restoreObject(current, objectId));
      setSelectedObjectIds([objectId]);
      focusObject(objectId);
    },
    [focusObject, setSelectedObjectIds, setWorkspace]
  );

  const handleDeleteSelected = useCallback(() => {
    if (selectedObjects.length === 0) {
      return;
    }

    const proposalObjects = selectedObjects.filter((object) => object.type === "proposalDraft");
    const objectIds = selectedObjects.filter((object) => object.type !== "proposalDraft").map((object) => object.id);
    if (objectIds.length > 0) {
      pushObjectOperationUndo();
    }
    setWorkspace((current) => {
      const deleted =
        objectIds.length > 0
          ? deleteObjects(current, objectIds, {
              confirmed: true,
              reason: "用户在对象详情栏直接删除该对象。"
            }).workspace
          : current;
      return proposalObjects.reduce(
        (next, object) => rejectArtifactProposal(next, object.proposalId, "用户从画布删除并放弃当前草案。"),
        deleted
      );
    });
    const removedIds = [...objectIds, ...proposalObjects.map((object) => object.id)];
    setSelectedObjectIds((current) => current.filter((selectedId) => !removedIds.includes(selectedId)));
    setLocalEditObjectId((current) => (current && removedIds.includes(current) ? null : current));
    setPendingConfirmation((current) =>
      current?.kind === "deleteObject" && removedIds.includes(current.targetObjectId) ? null : current
    );
    setActiveProposalId((current) => (current && removedIds.includes(current) ? null : current));
    closeProposalDetailIf(removedIds);
    closeCanvasContextMenu();
  }, [closeCanvasContextMenu, closeProposalDetailIf, pushObjectOperationUndo, selectedObjects, setSelectedObjectIds, setWorkspace]);

  const handleEliminateDirection = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "conceptDirection");
    if (!target) {
      return;
    }
    setTextPrompt({
      kind: "eliminateDirection",
      directionId: target.id,
      title: "淘汰方向",
      body: "淘汰不会隐藏、删除方向，也不会移除图片、修订或 lineage。理由可选，不填也可直接淘汰。",
      label: "淘汰理由（可选）",
      initialValue: "",
      allowEmpty: true
    });
  }, [selectedObjects]);

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
        showWorkspaceNotice(validation.reason);
        return;
      }

      const comparisonMetadata: ComparisonDecisionMetadata = {
        comparisonAnalysisId: analysis.id,
        comparisonAssistantMessageId: analysis.assistantMessageId,
        comparisonSourceObjectIds: [...analysis.sourceObjectIds]
      };

      if (action === "createKeyConclusion") {
        const keyConclusionCandidate = analysis.keyConclusionCandidate;
        if (!keyConclusionCandidate) {
          return;
        }
        if (!isAssignableKeyConclusionCategory(keyConclusionCandidate.category)) {
          showWorkspaceNotice("Compare 候选关键结论仍是待分类状态，不能直接保存。");
          return;
        }

        const sourceCheck = validateComparisonKeyConclusionSources(
          workspace,
          analysisId,
          keyConclusionCandidate.sourceObjectIds
        );
        if (sourceCheck.status !== "ok") {
          showWorkspaceNotice(sourceCheck.reason);
          return;
        }

        pushObjectOperationUndo();
        const result = createKeyConclusion(workspace, {
          title: keyConclusionCandidate.title,
          body: keyConclusionCandidate.body,
          summary: keyConclusionCandidate.summary,
          sourceObjectIds: [...keyConclusionCandidate.sourceObjectIds],
          category: keyConclusionCandidate.category,
          confidence: keyConclusionCandidate.confidence,
          note: keyConclusionCandidate.note,
          position: {
            x: workspace.canvas.view.x + 240,
            y: workspace.canvas.view.y + 180
          },
          comparison: comparisonMetadata
        });
        setWorkspace(result.workspace);
       requestFocusObject(result.keyConclusion.id);
        showWorkspaceNotice(`已保存关键结论「${result.keyConclusion.title}」`);
        return;
      }

      if (!objectId) {
        return;
      }

      const targetObject = validation.targetObject;
      if (!targetObject) {
        return;
      }

      if (action === "eliminate" && targetObject.type === "conceptDirection") {
        setTextPrompt({
          kind: "eliminateDirection",
          directionId: targetObject.id,
          title: "淘汰方向",
          body: "从 Compare 结果淘汰该方向。淘汰不会隐藏或删除方向。理由可选，不填也可直接淘汰。",
          label: "淘汰理由（可选）",
          initialValue: "",
          allowEmpty: true,
          comparison: comparisonMetadata
        });
        return;
      }

      pushObjectOperationUndo();

      if (action === "setPrimary" && targetObject.type === "conceptDirection") {
        setWorkspace((current) =>
          setConceptDirectionStatus(
            current,
            targetObject.id,
            "primary",
            "用户从 Compare 明确将该方向设为主方向。",
            comparisonMetadata
          )
        );
        showWorkspaceNotice(`已将「${targetObject.title}」设为主方向`);
        return;
      }

      if (action === "setAlternative" && targetObject.type === "conceptDirection") {
        setWorkspace((current) =>
          setConceptDirectionStatus(
            current,
            targetObject.id,
            "alternative",
            "用户从 Compare 明确将该方向设为备选方向。",
            comparisonMetadata
          )
        );
        showWorkspaceNotice(`已将「${targetObject.title}」设为备选方向`);
        return;
      }

      if (action === "restoreAlternative" && targetObject.type === "conceptDirection") {
        setWorkspace((current) =>
          setConceptDirectionStatus(
            current,
            targetObject.id,
            "alternative",
            "用户从 Compare 明确将该方向恢复为备选。",
            comparisonMetadata
          )
        );
        showWorkspaceNotice(`已将「${targetObject.title}」恢复为备选方向`);
        return;
      }

      if (action === "setDefaultReference" && targetObject.type === "image") {
        setWorkspace((current) =>
          setDefaultReference(current, targetObject.id, {
            reason: "用户从 Compare 明确设为后续默认参考。",
            comparison: comparisonMetadata
          })
        );
        showWorkspaceNotice(`已设「${targetObject.title}」为后续默认参考`);
        return;
      }

      if (action === "clearDefaultReference" && targetObject.type === "image") {
        setWorkspace((current) =>
          clearDefaultReference(current, targetObject.id, {
            reason: "用户从 Compare 明确取消后续默认参考。",
            comparison: comparisonMetadata
          })
        );
        showWorkspaceNotice(`已取消「${targetObject.title}」的后续默认参考`);
      }
    },
    [pushObjectOperationUndo, requestFocusObject, setWorkspace, showWorkspaceNotice, workspace]
  );

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
          if (!canvasContextMenu && selectedObjects.length > 0) {
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
  const handleOpenProposalDetail = useCallback(
    (proposalId: string) => {
      setActiveProposalId(proposalId);
      openProposalDetail(proposalId);
    },
    [openProposalDetail]
  );
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
      onOpenProposalDetail={() => { const object = toolbarObjects.find((item) => item.type === "proposalDraft"); if (object?.type === "proposalDraft") handleOpenProposalDetail(object.proposalId); }}
      onApplyProposal={() => { const object = toolbarObjects.find((item) => item.type === "proposalDraft"); if (object?.type === "proposalDraft") handleApplyProposalFromCanvas(object.proposalId); }}
      onRejectProposal={() => { const object = toolbarObjects.find((item) => item.type === "proposalDraft"); if (object?.type === "proposalDraft") handleRejectProposal(object.proposalId); }}
      onContinueProposalDiscussion={() => { const object = toolbarObjects.find((item) => item.type === "proposalDraft"); if (object?.type === "proposalDraft") handleContinueProposalDiscussion(object.proposalId); }}
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
            为了不让两个标签页互相覆盖，这里暂时只读：改动不会保存。关闭另一个标签页后刷新本页，即可继续编辑。
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
        renderSelectionToolbar={renderSelectionToolbar}
        onSelectionChange={handleSelectionChange}
        onInstancesChange={handleInstancesChange}
        onStageRegionsChange={handleStageRegionsChange}
        onViewChange={handleCanvasViewChange}
        onLiveViewChange={handleCanvasLiveViewChange}
        onImportRequest={importRequest}
        onContextMenuRequest={(request) => {
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
          onImport={() => railImportInputRef.current?.click()}
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
            onApply={(allowSourceChanged) => handleApplyProposalFromCanvas(detailProposal.id, allowSourceChanged)}
            onReject={handleRejectProposal}
            onContinueDiscussion={handleContinueProposalDiscussion}
            onRegenerate={handleRegenerateProposal}
            onSaveResearchDraft={handleSaveResearchProposalDraft}
            onSaveDesignDefinitionDraft={handleSaveDesignDefinitionProposalDraft}
            onSaveConceptDirectionDraft={handleSaveConceptDirectionProposalDraft}
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

      {textPrompt ? (
        <WorkspaceTextPromptDialog
          prompt={textPrompt}
          onCancel={() => setTextPrompt(null)}
          onSubmit={handleSubmitTextPrompt}
        />
      ) : null}

      <TopControls
        projectTitle={workspace.project.title}
        persistenceError={
          persistenceState.phase === "error" && persistenceState.error && !persistenceState.migrationError
            ? persistenceState.error
            : undefined
        }
        onImportFiles={(files) =>
          importRequest({
            files,
            position: {
              x: workspace.canvas.view.x + 160,
              y: workspace.canvas.view.y + 160
            }
          })
        }
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
            handleOpenProposalDetail(proposalObject.proposalId);
            closeCanvasContextMenu();
          }}
          onApplyProposal={() => {
            const proposalObject = contextMenuObjects.find((object) => object.type === "proposalDraft");
            if (proposalObject?.type !== "proposalDraft") {
              return;
            }
            handleApplyProposalFromCanvas(proposalObject.proposalId);
            closeCanvasContextMenu();
          }}
          onRejectProposal={() => {
            const proposalObject = contextMenuObjects.find((object) => object.type === "proposalDraft");
            if (proposalObject?.type !== "proposalDraft") {
              return;
            }
            handleRejectProposal(proposalObject.proposalId);
            closeCanvasContextMenu();
          }}
          onContinueProposalDiscussion={() => {
            const proposalObject = contextMenuObjects.find((object) => object.type === "proposalDraft");
            if (proposalObject?.type !== "proposalDraft") {
              return;
            }
            handleContinueProposalDiscussion(proposalObject.proposalId);
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
        turnMode={agentTurnMode}
        activeProposal={activeProposal}
        activeOperation={activeOperation}
        isStreaming={isAiStreaming}
        imageGenerationSettings={effectiveImageGenerationSettings}
        directionPreviewCount={directionPreviewCount}
        pendingConfirmation={pendingConfirmation}
        showFailure={showFailure}
        showRecoveryPending={showRecoveryPending}
        imageTaskStatus={imageTaskStatus}
        contextWarning={contextWarning}
        migrationError={persistenceState.migrationError}
        focusInputRequestNonce={aiInputFocusNonce}
        onToggleOpen={() => setAiOpen((open) => !open)}
        onDraftChange={setAiDraft}
        onTurnModeChange={setAgentTurnMode}
        onImageGenerationSettingsChange={updateImageGenerationSettings}
        onDirectionPreviewCountChange={setDirectionPreviewCount}
        onSuggestionClick={handleSuggestionClick}
        onSendMessage={handleSendMorphoAgentTurn}
        onCancelRequest={handleCancelAiRequest}
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
        onConfirmPendingSecondary={handleConfirmPendingWithReviewMarks}
        onCancelPending={() => {
          void acknowledgePendingConfirmation();
          setPendingConfirmation(null);
        }}
        onFailureRetry={retryRecovery}
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

function getProposalDraftCanvasPosition(
  workspace: MorphoWorkspace,
  proposalId: string,
  fallback: { x: number; y: number }
): { x: number; y: number } {
  return workspace.canvas.instances.find((instance) => instance.objectId === proposalId)?.position ?? fallback;
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

function applyRequestedAgentAction(
  workspace: MorphoWorkspace,
  confirmation: Extract<PendingAiConfirmation, { kind: "agentRequestedAction" }>,
  options: { executeVisuals?: string }
): MorphoWorkspace {
  switch (confirmation.action) {
    case "applyDesignDefinition": {
      if (!confirmation.targetObjectId) {
        return appendAiAssistantFailureMessage(workspace, "agent-request-apply-definition", "缺少要应用的设计定义 proposal。");
      }
      const result = applyDesignDefinitionProposal(workspace, confirmation.targetObjectId, {});
      return result.status === "updated"
        ? result.workspace
        : appendAiAssistantFailureMessage(workspace, "agent-request-apply-definition", result.reason);
    }
    case "setDirectionPrimary":
      return confirmation.targetObjectId
        ? setConceptDirectionStatus(workspace, confirmation.targetObjectId, "primary", confirmation.reason)
        : appendAiAssistantFailureMessage(workspace, "agent-request-primary", "缺少要设为主方向的对象。");
    case "setDirectionAlternative":
      return confirmation.targetObjectId
        ? setConceptDirectionStatus(workspace, confirmation.targetObjectId, "alternative", confirmation.reason)
        : appendAiAssistantFailureMessage(workspace, "agent-request-alternative", "缺少要设为备选方向的对象。");
    case "eliminateDirection":
      return confirmation.targetObjectId
        ? eliminateDirection(workspace, confirmation.targetObjectId, { reason: confirmation.reason })
        : appendAiAssistantFailureMessage(workspace, "agent-request-eliminate", "缺少要淘汰的方向对象。");
    case "setDefaultReference":
      return confirmation.targetObjectId
        ? setDefaultReference(workspace, confirmation.targetObjectId, { reason: confirmation.reason })
        : appendAiAssistantFailureMessage(workspace, "agent-request-default-reference", "缺少要设为默认参考的图像对象。");
    case "batchGenerateVisuals":
      return options.executeVisuals
        ? appendAiAssistantFailureMessage(workspace, "agent-request-batch-generate", options.executeVisuals)
        : workspace;
  }
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

function appendAiAssistantNotice(
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
          status: "done",
          createdAt: new Date().toISOString(),
          proposalId
        }
      ]
    }
  };
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

