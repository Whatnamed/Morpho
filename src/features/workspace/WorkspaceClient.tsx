"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction
} from "react";

import type {
  AiTaskMode,
  AiWorkIntent,
  AssetRecord,
  CanvasView,
  ContinuityManualState,
  MorphoObject
} from "@/domain/morpho/types";
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
import { getImageCanvasSize } from "@/domain/morpho/imageSizing";
import { createDocumentExtractFile, parseDocumentFile, shouldAttemptDocumentParse } from "@/domain/morpho/documentParsing";
import { importAssetBackedObjects, importTextObject, importUrlObject } from "@/domain/morpho/imports";
import {
  addDeliveryGap,
  addObjectsToDeliverySection,
  applyDeliverySectionDraft,
  createDeliveryPreparation,
  createDeliverySection,
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
  applyConceptDirectionProposal,
  applyDesignDefinitionProposal,
  applyResearchAnalysisProposal,
  canStartOperation,
  completeImageGenerationOperation,
  createArtifactProposalOperation,
  createImageGenerationOperation,
  createResearchOperation,
  failImageGenerationOperation,
  getActiveOperation,
  interruptActiveOperations,
  markImageGenerationOperationSubmitted,
  rejectArtifactProposal,
  recordAndApplyConceptDirectionProposal,
  recordDesignDefinitionProposal,
  recordImageGenerationPlan,
  recordImageGenerationOperationResult,
  setCurrentDesignDefinition,
  updateConceptDirectionProposalDraft,
  updateDesignDefinitionProposalDraft,
  updateResearchAnalysisProposalDraft
} from "@/domain/operations/operations";
import type { ConceptDirectionProposal, OperationRecord, VisualGenerationPlan, VisualGenerationPlanItem } from "@/domain/operations/types";
import { normalizeResearchItems } from "@/domain/operations/researchItems";
import { validateVisualGenerationPlan } from "@/domain/operations/visualGenerationPlan";
import {
  archiveVisualBranch,
  attachDocumentExtractToFileObject,
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
  markFileObjectParseFailed,
  markFileObjectParsing,
  removeImageFromVisualBranch,
  renameVisualBranch,
  reorderCanvasInstances,
  restoreObject,
  restoreVisualBranch,
  setConceptDirectionStatus,
  setDefaultReference,
  type CanvasLayerReorderAction
} from "@/domain/morpho/workspace";
import type { CanvasInstance, MorphoWorkspace } from "@/domain/morpho/types";
import { readClipboardAsImportPayload } from "./canvasClipboardImport";
import { AiConversationPanel } from "./components/AiConversationPanel";
import type { PendingAiConfirmation, PendingComparisonConfirmation } from "./components/AiConversationPanel";
import { BottomDetailBar } from "./components/BottomDetailBar";
import { ConceptDirectionDetail } from "./components/ConceptDirectionDetail";
import { DesignDefinitionDetail } from "./components/DesignDefinitionDetail";
import { DeliveryPreparationPanel } from "./components/DeliveryPreparationPanel";
import { DeliveryOutputPanel } from "./components/DeliveryOutputPanel";
import { DocumentReaderPanel, type DocumentReaderExtractFragmentResult, type DocumentSourcePreview } from "./components/DocumentReaderPanel";
import { LeftRail, type DrawerMode } from "./components/LeftRail";
import { OverlayDrawers } from "./components/OverlayDrawers";
import type { LeftRailAnchor } from "./leftRailPopoverPlacement";
import { ProposalDraftCard } from "./components/ProposalDraftCard";
import { ProjectBundlePanel } from "./components/ProjectBundlePanel";
import { ResearchDetailPanel } from "./components/ResearchDetailPanel";
import { CanvasContextMenu, SelectionToolbar } from "./components/SelectionToolbar";
import { SaveFailureBanner } from "./components/SaveFailureBanner";
import { TopControls } from "./components/TopControls";
import { WorkspaceStarter } from "./components/WorkspaceStarter";
import { usePersistentWorkspace } from "./usePersistentWorkspace";
import { useWorkspaceAssetUrls } from "./useWorkspaceAssetUrls";
import { compactObjectList, getSuggestionsForSelection, type Suggestion } from "./workspaceUi";
import { getFloatingMenuPlacement, type SelectionToolbarPlacement } from "./selectionToolbar";
import {
  createSnapshotHistory,
  pushSnapshotHistoryEntry,
  redoSnapshotHistory,
  undoSnapshotHistory,
  type SnapshotHistory
} from "./workspaceUndo";
import { resolveWorkspaceShortcut } from "./workspaceShortcuts";
import {
  buildPendingImageGenerationSlots,
  removePendingImageGenerationSlot,
  type PendingImageGenerationSlot
} from "./pendingImageGenerationSlots";
import { applyImageGenerationResultCommit } from "./imageGenerationResultCommit";
import {
  popDetailNavigation,
  pushDetailNavigation,
  shouldHydratePersistedSelection,
  type DetailNavigationSnapshot
} from "./workspaceNavigation";
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
  getAvailableAiWorkIntents,
  recommendAiTaskMode,
  recommendAiWorkIntent
} from "./aiTaskRouting";
import { buildProposalDiscussionDraft, buildProposalRegenerationDraft } from "./proposalFollowupPrompts";
import { shouldAcceptDocumentReaderLoadResult } from "./documentReader";
import { loadDocumentReaderExtractWithRecovery } from "./documentReaderRecovery";
import {
  buildDocumentFragmentDraft,
  createDocumentFragmentWithContinuity,
  resolveDocumentFragmentSelection
} from "./documentFragments";
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
import { planDirectionPreviewPlacements, planVisualDevelopmentPlacements } from "./visualPreviewLayout";
import { parseManualCompactCommand } from "./manualConversationCompaction";
import {
  getDefaultImageGenerationSettings,
  inferGenerationAspectRatio,
  resolveGenerationSettings,
  resolveImageGenerationSettingsForVisualIntent,
  type ImageGenerationSettings
} from "./imageGenerationSettings";
import {
  IMAGE_GENERATION_MAX_CONCURRENCY,
  buildImageGenerationProgressMessage,
  mapWithConcurrency
} from "./imageGenerationConcurrency";
import {
  getDesignDefinitionDrafts,
  type MorphoAgentTurnMode
} from "./morphoAgent";
import { updateAiMessage } from "./aiConversationMessages";
import type { AgentTurnHost } from "./agentTurnHost";
import {
  buildAPlusImageBatchIdentity,
  buildAPlusImageChildActionId,
  classifyAPlusImageResponse,
  createAPlusExternalActionRunningError,
  findAPlusImageResultObjectId,
  hashAPlusExternalActionBody,
  isAPlusExternalActionRunningError,
  postAPlusExternalAction,
  type APlusExternalActionDescriptor
} from "./agentExternalActionClientAPlus";
import {
  acknowledgeSelectedPendingAgentConfirmation,
  cancelSelectedMorphoAgentTurn,
  recoverSelectedAgentRuntime,
  resumeSelectedAgentRuntime,
  runSelectedManualCompactionTurn,
  runSelectedMorphoAgentTurn
} from "./agentRuntimeSelector";
import { completeAgentTrace } from "./agentMessageTrace";
import { commitWorkspaceStateNow } from "./workspaceCommitBoundary";
import { readErrorResponse } from "./httpPayload";
import type { CanvasImportRequest, FocusArea } from "./tldraw/MorphoCanvas";
import type { CanvasSelectionRequest } from "./tldraw/canvasSelection";

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

type FocusRequest = {
  area?: FocusArea;
  objectId?: string;
  view?: CanvasView;
  selectionObjectIds?: string[];
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

function isActiveImageTaskStatus(state: ImageTaskState): boolean {
  return state === "preparing" || state === "submitting" || state === "waiting" || state === "downloading";
}

type DocumentReaderUiState = {
  fileObjectId: string;
  requestId: number;
  status: "loading" | "loaded" | "blocked" | "error";
  text: string;
  message?: string;
  extractAsset?: AssetRecord;
  sourcePreview?: DocumentSourcePreview;
  createdFragmentId?: string;
  initialLocation?: {
    startOffset: number;
    endOffset: number;
    label: string;
  } | null;
};

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
  const [isStorageNoticeDismissed, setStorageNoticeDismissed] = useState(false);
  const [selectedObjectSelection, setSelectedObjectSelection] = useState<{
    projectId: string;
    objectIds: string[];
  }>(() => ({
    projectId: workspace.project.id,
    objectIds: workspace.ui.lastSelectionIds
  }));
  const selectedObjectProjectIdRef = useRef(projectId);
  const selectedObjectIds = useMemo(
    () =>
      selectedObjectSelection.projectId === projectId && workspace.project.id === projectId
        ? selectedObjectSelection.objectIds
        : [],
    [projectId, selectedObjectSelection, workspace.project.id]
  );
  const setSelectedObjectIds = useCallback(
    (action: SetStateAction<string[]>) => {
      const nextProjectId = selectedObjectProjectIdRef.current;
      setSelectedObjectSelection((current) => {
        const currentObjectIds = current.projectId === nextProjectId ? current.objectIds : [];
        const nextObjectIds = typeof action === "function" ? action(currentObjectIds) : action;
        return {
          projectId: nextProjectId,
          objectIds: [...nextObjectIds]
        };
      });
    },
    []
  );
  const [aiDraft, setAiDraft] = useState("");
  const [agentTurnMode, setAgentTurnMode] = useState<MorphoAgentTurnMode>("auto");
  const [taskMode, setTaskMode] = useState<AiTaskMode>("chatAnalysis");
  const workIntent = workspace.ui.workIntent;
  const [aiOpen, setAiOpen] = useState(true);
  const [activeDrawer, setActiveDrawer] = useState<DrawerMode>(null);
  const [drawerAnchor, setDrawerAnchor] = useState<LeftRailAnchor | null>(null);
  const [highlightContinuityEntryIds, setHighlightContinuityEntryIds] = useState<string[]>([]);
  const [localEditObjectId, setLocalEditObjectId] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAiConfirmation | null>(null);
  const [textPrompt, setTextPrompt] = useState<WorkspaceTextPrompt | null>(null);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [detailProposalId, setDetailProposalId] = useState<string | null>(null);
  const [detailDesignDefinitionId, setDetailDesignDefinitionId] = useState<string | null>(null);
  const [detailConceptDirectionId, setDetailConceptDirectionId] = useState<string | null>(null);
  const [detailHoverObjectId, setDetailHoverObjectId] = useState<string | null>(null);
  const [traceStartObjectId, setTraceStartObjectId] = useState<string | null>(null);
  const [canvasTraceMode, setCanvasTraceMode] = useState<"direct" | "chain">("direct");
  const [showFailure, setShowFailure] = useState(false);
  const [showRecoveryPending, setShowRecoveryPending] = useState(false);
  const [contextWarning, setContextWarning] = useState<string | undefined>();
  const [isAiStreaming, setIsAiStreaming] = useState(false);
  const [imageTaskStatus, setImageTaskStatus] = useState<ImageTaskStatus | null>(null);
  const [pendingImageGenerationSlots, setPendingImageGenerationSlots] = useState<PendingImageGenerationSlot[]>([]);
  const [imageGenerationSettings, setImageGenerationSettings] = useState<ImageGenerationSettings>(() =>
    getDefaultImageGenerationSettings()
  );
  const [directionPreviewCount, setDirectionPreviewCount] = useState<1 | 2 | 4 | 6>(2);
  const [imageGenerationAspectMode, setImageGenerationAspectMode] = useState<"auto" | "manual">("auto");
  const [deliveryPanelOpen, setDeliveryPanelOpen] = useState(false);
  const [requestedActiveDeliveryObjectId, setActiveDeliveryObjectId] = useState<string | null>(null);
  const [activeDeliverySectionId, setActiveDeliverySectionId] = useState<string | null>(null);
  const [pendingDeliveryDraftTarget, setPendingDeliveryDraftTarget] = useState<{ deliveryObjectId: string; sectionId: string } | null>(null);
  const commitWorkspaceNow = useCallback(
    <T,>(transform: (current: MorphoWorkspace) => { workspace: MorphoWorkspace; value: T }): T =>
      commitWorkspaceStateNow(setWorkspace, transform),
    [setWorkspace]
  );
  const readWorkspaceNow = useCallback(
    () => commitWorkspaceNow((current) => ({ workspace: current, value: current })),
    [commitWorkspaceNow]
  );
  const assetUrls = useWorkspaceAssetUrls(workspace.assets);
  const abortControllerRef = useRef<AbortController | null>(null);
  const agentStreamFlushRef = useRef<(() => void) | null>(null);
  const objectOperationHistoryRef = useRef<SnapshotHistory<ObjectOperationUndoEntry>>(
    createSnapshotHistory<ObjectOperationUndoEntry>()
  );
  const detailNavigationUndoStackRef = useRef<DetailNavigationSnapshot[]>([]);
  useEffect(
    () => () => {
      agentStreamFlushRef.current?.();
      agentStreamFlushRef.current = null;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    },
    []
  );
  const latestCanvasViewRef = useRef<CanvasView>(workspace.canvas.view);
  const selectionHydratedProjectIdRef = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest>({ nonce: 0 });
  const [selectionRequest, setSelectionRequest] = useState<CanvasSelectionRequest>({ objectIds: [], nonce: 0 });
  const [documentReader, setDocumentReader] = useState<DocumentReaderUiState | null>(null);
  const [bundlePanelOpen, setBundlePanelOpen] = useState(false);
  const [archiveIncludeFullChat, setArchiveIncludeFullChat] = useState(false);
  const [archiveIncludeContinuity, setArchiveIncludeContinuity] = useState(false);
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
  const documentSourcePreviewUrlRef = useRef<string | null>(null);
  const railImportInputRef = useRef<HTMLInputElement | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectRenameDraft, setProjectRenameDraft] = useState(workspace.project.title);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{
    x: number;
    y: number;
    objectId: string | null;
    stageId: string | null;
    pagePosition: { x: number; y: number };
    openedAt: number;
  } | null>(null);
  const pendingImportPositionRef = useRef<{ x: number; y: number } | null>(null);
  const [activeResearchDetailObjectId, setActiveResearchDetailObjectId] = useState<string | null>(null);
  const [aiInputFocusNonce, setAiInputFocusNonce] = useState(0);
  const [manualSaveNotice, setManualSaveNotice] = useState<string | null>(null);
  const manualSaveNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedObjects = useMemo(
    () => compactObjectList(workspace.objects, selectedObjectIds),
    [selectedObjectIds, workspace.objects]
  );
  const requestCanvasSelection = useCallback((objectIds: string[]) => {
    const nextObjectIds = [...objectIds];
    setSelectionRequest((current) => ({ objectIds: nextObjectIds, nonce: current.nonce + 1 }));
  }, []);
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
  const deliveryObjects = useMemo(() => getDeliveryObjects(workspace), [workspace]);
  const activeDeliveryObjectId = useMemo(
    () =>
      requestedActiveDeliveryObjectId &&
      deliveryObjects.some((delivery) => delivery.id === requestedActiveDeliveryObjectId)
        ? requestedActiveDeliveryObjectId
        : deliveryObjects[0]?.id ?? null,
    [deliveryObjects, requestedActiveDeliveryObjectId]
  );
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

  useEffect(() => {
    selectedObjectProjectIdRef.current = projectId;
    selectionHydratedProjectIdRef.current = null;
  }, [projectId]);

  useEffect(() => {
    const persistedSelection = workspace.ui.lastSelectionIds;
    if (
      workspace.project.id !== projectId ||
      !shouldHydratePersistedSelection({
        hydratedProjectId: selectionHydratedProjectIdRef.current,
        projectId: workspace.project.id,
        workspaceLoaded: persistenceState.isWorkspaceLoaded
      })
    ) {
      return;
    }

    selectionHydratedProjectIdRef.current = workspace.project.id;
    requestCanvasSelection(persistedSelection);
  }, [
    persistenceState.isWorkspaceLoaded,
    projectId,
    requestCanvasSelection,
    workspace.project.id,
    workspace.ui.lastSelectionIds
  ]);

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

  const handleDrawerChange = useCallback((drawer: DrawerMode, anchor?: LeftRailAnchor) => {
    setDrawerAnchor(drawer ? anchor ?? null : null);
    setActiveDrawer(drawer);
  }, []);

  useEffect(() => {
    if (!activeDrawer) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleDrawerChange(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDrawer, handleDrawerChange]);

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

      handleDrawerChange(null);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [activeDrawer, handleDrawerChange]);

  const focusArea = useCallback((area: FocusArea) => {
    setFocusRequest((current) => ({ area, nonce: current.nonce + 1 }));
    handleDrawerChange(null);
  }, [handleDrawerChange]);

  const focusObject = useCallback((objectId: string, options: { rememberView?: boolean } = {}) => {
    if (options.rememberView) {
      detailNavigationUndoStackRef.current = pushDetailNavigation(detailNavigationUndoStackRef.current, {
        view: latestCanvasViewRef.current,
        selectedObjectIds
      });
    }
    setSelectedObjectIds([objectId]);
    setFocusRequest((current) => ({ objectId, nonce: current.nonce + 1 }));
    handleDrawerChange(null);
  }, [handleDrawerChange, selectedObjectIds, setSelectedObjectIds]);

  const locateObjectFromDetail = useCallback(
    (objectId: string) => {
      focusObject(objectId, { rememberView: true });
    },
    [focusObject]
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

  const openProjectRecords = useCallback((entryIds: string[] = []) => {
    setHighlightContinuityEntryIds(entryIds);
    handleDrawerChange("records");
  }, [handleDrawerChange]);

  const handleSetContinuityEntryManualState = useCallback(
    (entryId: string, manualState: ContinuityManualState) => {
      setWorkspace((current) => setConversationSemanticEntryManualState(current, entryId, manualState));
      setHighlightContinuityEntryIds([entryId]);
      handleDrawerChange("records");
    },
    [handleDrawerChange, setWorkspace]
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

  const pushObjectOperationUndo = useCallback(() => {
    objectOperationHistoryRef.current = pushSnapshotHistoryEntry(
      objectOperationHistoryRef.current,
      captureObjectOperationSnapshot()
    );
  }, [captureObjectOperationSnapshot]);

  const applyObjectOperationSnapshot = useCallback(
    (entry: ObjectOperationUndoEntry) => {
      setWorkspace(entry.workspace);
      requestCanvasSelection(entry.selectedObjectIds);
      setLocalEditObjectId(entry.localEditObjectId);
      setPendingConfirmation(entry.pendingConfirmation);
      setCanvasContextMenu(null);
    },
    [requestCanvasSelection, setWorkspace]
  );

  const undoLastDetailNavigation = useCallback(() => {
    const restored = popDetailNavigation(detailNavigationUndoStackRef.current);
    if (!restored) {
      return false;
    }

    detailNavigationUndoStackRef.current = restored.history;
    latestCanvasViewRef.current = restored.snapshot.view;
    setSelectedObjectIds(restored.snapshot.selectedObjectIds);
    setFocusRequest((current) => ({
      view: restored.snapshot.view,
      selectionObjectIds: restored.snapshot.selectedObjectIds,
      nonce: current.nonce + 1
    }));
    return true;
  }, [setSelectedObjectIds]);

  const undoLastObjectOperation = useCallback(() => {
    if (undoLastDetailNavigation()) {
      return true;
    }

    const result = undoSnapshotHistory(objectOperationHistoryRef.current, workspace, captureObjectOperationSnapshot);
    if (result.status === "empty") {
      return false;
    }

    if (result.status === "blocked") {
      setCanvasContextMenu(null);
      showWorkspaceNotice("撤销已暂停：此步早于 AI 生成的内容，AI 结果不进入撤销；撤销历史已保留。", 2600);
      return true;
    }

    objectOperationHistoryRef.current = result.history;
    applyObjectOperationSnapshot(result.entry);
    return true;
  }, [applyObjectOperationSnapshot, captureObjectOperationSnapshot, showWorkspaceNotice, undoLastDetailNavigation, workspace]);

  const redoLastObjectOperation = useCallback(() => {
    const result = redoSnapshotHistory(objectOperationHistoryRef.current, workspace, captureObjectOperationSnapshot);
    if (result.status === "empty") {
      return false;
    }

    if (result.status === "blocked") {
      setCanvasContextMenu(null);
      showWorkspaceNotice("重做已暂停：撤销之后已有新内容创建，重做不会移除它们；历史已保留。", 2600);
      return true;
    }

    objectOperationHistoryRef.current = result.history;
    applyObjectOperationSnapshot(result.entry);
    return true;
  }, [applyObjectOperationSnapshot, captureObjectOperationSnapshot, showWorkspaceNotice, workspace]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = (key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey);
      if (!isUndo && !isRedo) {
        return;
      }

      if (isEditableDomTarget(event.target)) {
        return;
      }

      const handled = isUndo ? undoLastObjectOperation() : redoLastObjectOperation();
      if (!handled) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [redoLastObjectOperation, undoLastObjectOperation]);

  const handleSelectionChange = useCallback(
    (objectIds: string[]) => {
      setSelectedObjectIds(objectIds);
      setCanvasContextMenu(null);
      setTraceStartObjectId((current) => {
        if (!current || (objectIds.length === 1 && objectIds[0] === current)) {
          return current;
        }
        setCanvasTraceMode("direct");
        return null;
      });
      if (objectIds.length === 0) {
        handleDrawerChange(null);
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
    [handleDrawerChange, setSelectedObjectIds, setWorkspace]
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

  const handleCanvasViewChange = useCallback(
    (view: MorphoWorkspace["canvas"]["view"]) => {
      latestCanvasViewRef.current = view;
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

  const handleCanvasLiveViewChange = useCallback((view: CanvasView) => {
    latestCanvasViewRef.current = view;
  }, []);

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
        requestCanvasSelection(nextSelection);
      }

      if (parseTargets.length > 0) {
        void parseImportedDocuments(parseTargets, setWorkspace);
      }
    },
    [requestCanvasSelection, setWorkspace]
  );
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

      void handleImportRequest({
        files: selectedFiles,
        position
      });
    },
    [handleImportRequest, workspace.canvas.view.x, workspace.canvas.view.y]
  );

  const handleContextMenuPaste = useCallback(
    async (pagePosition?: { x: number; y: number }) => {
      const position = pagePosition ?? {
        x: latestCanvasViewRef.current.x + 160,
        y: latestCanvasViewRef.current.y + 160
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
      await handleImportRequest({
        position,
        files: result.files,
        url: result.url,
        text: result.text
      });
    },
    [handleImportRequest, showWorkspaceNotice]
  );

  const handleContextMenuImportFiles = useCallback((pagePosition?: { x: number; y: number }) => {
    pendingImportPositionRef.current = pagePosition ?? {
      x: latestCanvasViewRef.current.x + 180,
      y: latestCanvasViewRef.current.y + 180
    };
    railImportInputRef.current?.click();
  }, []);

  const handleSelectAllVisibleObjects = useCallback(() => {
    requestCanvasSelection(activeCanvasObjectIds);
  }, [activeCanvasObjectIds, requestCanvasSelection]);
  const handleOpenProjectHome = useCallback(() => {
    router.push("/");
  }, [router]);
  const handleConfirmProjectRename = useCallback(() => {
    const title = projectRenameDraft.trim();
    if (!title || title === workspace.project.title) {
      setProjectMenuOpen(false);
      setProjectRenameDraft(workspace.project.title);
      return;
    }

    setWorkspace((current) => ({
      ...current,
      project: {
        ...current.project,
        title
      }
    }));
    setProjectMenuOpen(false);
  }, [projectRenameDraft, setWorkspace, workspace.project.title]);

  const handleReorderSelectedLayers = useCallback(
    (action: CanvasLayerReorderAction) => {
      setWorkspace((current) => reorderCanvasInstances(current, selectedObjectIds, action));
      setCanvasContextMenu(null);
    },
    [selectedObjectIds, setWorkspace]
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

  const executeAgentVisualGenerationPlan = useCallback(async (input: {
      workspaceSnapshot: MorphoWorkspace;
      draft: string;
      plan: VisualGenerationPlan;
      sourceObjectIds: string[];
      selectedDirectionIds: string[];
      selectedImageIds: string[];
      requestedPreviewCount?: number;
      onProgress?: (message: string) => void;
      signal: AbortSignal;
      aPlusExternalAction?: Readonly<{
        serverTurnId: string;
        localProjectId: string;
        requestId: string;
        stepSequence: number;
        actionId: string;
      }>;
      restoredExternalAction?: Readonly<APlusExternalActionDescriptor & { callId?: string }>;
      onExternalActionIntent?: (input: Readonly<{
        actionId: string;
        action: APlusExternalActionDescriptor;
      }>) => Promise<boolean> | boolean;
    }) => {
      const requestedGenerationCount =
        input.plan.kind === "directionPreview"
          ? input.requestedPreviewCount ?? 1
          : input.plan.items.length;
      const validatedPlan = validateVisualGenerationPlan(input.workspaceSnapshot, {
        plan: input.plan,
        allowedObjectIds: [
          ...input.sourceObjectIds,
          ...input.plan.items.flatMap((item) => item.referenceObjectIds)
        ],
        selectedDirectionIds: input.selectedDirectionIds,
        selectedImageIds: input.selectedImageIds,
        requestedPreviewCount: requestedGenerationCount
      });
      if (validatedPlan.status === "blocked") {
        throw new Error(validatedPlan.reason);
      }

      const aPlusBatchIdentity = input.aPlusExternalAction
        ? await buildAPlusImageBatchIdentity(
            input.aPlusExternalAction.serverTurnId,
            input.aPlusExternalAction.actionId
          )
        : undefined;
      const operationId = aPlusBatchIdentity?.operationId ??
        `operation-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const clientRequestId = aPlusBatchIdentity?.clientRequestId ??
        `client-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const generationSettings = resolveImageGenerationSettingsForVisualIntent({
        intent: input.plan.kind === "directionPreview" ? "directionPreview" : "visualDevelopment",
        aspectRatio: effectiveImageGenerationSettings.aspectRatio
      });
      const workspaceAtPlanCommit = commitWorkspaceNow((current) => {
        const existingOperation = aPlusBatchIdentity ? current.operations[operationId] : undefined;
        if (existingOperation && existingOperation.type !== "imageGeneration") {
          throw new Error("A+ 图像 Operation ID 与现有非图像 Operation 冲突。");
        }
        const existingPlan = existingOperation?.imageGeneration?.plan;
        if (existingPlan && JSON.stringify(existingPlan) !== JSON.stringify(validatedPlan.plan)) {
          throw new Error("A+ 图像 Operation 的恢复计划与原计划不一致。");
        }
        const workspaceWithOperation = existingOperation
          ? current
          : createImageGenerationOperation(current, {
              operationId,
              clientRequestId,
              prompt: input.draft,
              selectedObjectIds: input.sourceObjectIds,
              imagePixels: false,
              modelId: generationSettings.modelId,
              modelLabel: generationSettings.modelLabel,
              aspectRatio: generationSettings.aspectRatio,
              sizeOption: generationSettings.sizeOption,
              referenceObjectIds: input.sourceObjectIds,
              requestedPreviewCount: input.plan.kind === "directionPreview"
                ? requestedGenerationCount
                : undefined
            }).workspace;
        const workspaceWithPlan = existingPlan
          ? workspaceWithOperation
          : recordImageGenerationPlan(workspaceWithOperation, {
              operationId,
              plan: validatedPlan.plan
            });
        return { workspace: workspaceWithPlan, value: workspaceWithPlan };
      });

      const plannedImageSize = getPlannedImageSize(effectiveImageGenerationSettings.aspectRatio);
      const placementMap = new Map(
        (validatedPlan.plan.kind === "directionPreview"
          ? planDirectionPreviewPlacements(
              workspaceAtPlanCommit,
              validatedPlan.plan.items.map((item) => ({
                id: item.id,
                targetDirectionId: item.targetDirectionId,
                width: plannedImageSize.w,
                height: plannedImageSize.h
              }))
            )
          : planVisualDevelopmentPlacements(
              workspaceAtPlanCommit,
              validatedPlan.plan.items.map((item) => ({
                id: item.id,
                referenceObjectIds: item.referenceObjectIds,
                targetDirectionId: item.targetDirectionId,
                width: plannedImageSize.w,
                height: plannedImageSize.h
              }))
            )
        ).map((placement) => [placement.planItemId, placement.position] as const)
      );
      setPendingImageGenerationSlots((current) => [
        ...current.filter((slot) => slot.operationId !== operationId),
        ...buildPendingImageGenerationSlots({
          operationId,
          items: validatedPlan.plan.items,
          placements: placementMap,
          size: plannedImageSize
        })
      ]);

      let lastProviderTaskId: string | undefined;
      const createdObjectIds: string[] = [];
      const failedItems: string[] = [];
      const totalItems = validatedPlan.plan.items.length;
      let completedCount = 0;
      let inFlightCount = 0;
      const publishProgress = () => {
        const message = buildImageGenerationProgressMessage({
          total: totalItems,
          completed: completedCount,
          inFlight: inFlightCount,
          concurrency: IMAGE_GENERATION_MAX_CONCURRENCY
        });
        setImageTaskStatus({
          state: inFlightCount > 0 ? "submitting" : "downloading",
          message
        });
        input.onProgress?.(message);
      };

      type AgentItemResult =
        | {
            status: "existing";
            index: number;
            item: (typeof validatedPlan.plan.items)[number];
            objectId: string;
          }
        | {
            status: "ok";
            index: number;
            item: (typeof validatedPlan.plan.items)[number];
            asset: AssetRecord;
            sourceObjectIds: string[];
            providerTaskId?: string;
          }
        | {
            status: "failed";
            index: number;
            item: (typeof validatedPlan.plan.items)[number];
            reason: string;
          };

      const applyAgentItemResult = async (result: AgentItemResult) => {
        if (result.status === "existing") {
          if (!createdObjectIds.includes(result.objectId)) createdObjectIds.push(result.objectId);
          commitWorkspaceNow((current) => {
            const operation = current.operations[operationId];
            const knownResultIds = operation?.type === "imageGeneration"
              ? operation.imageGeneration?.resultObjectIds ?? []
              : [];
            return {
              workspace: knownResultIds.includes(result.objectId)
                ? current
                : recordImageGenerationOperationResult(current, {
                    operationId,
                    resultObjectId: result.objectId
                  }),
              value: undefined
            };
          });
        } else if (result.status === "ok") {
          const createdObjectId = commitWorkspaceNow((current) => {
            const committed = applyImageGenerationResultCommit(current, {
              status: "succeeded",
              operationId,
              providerTaskId: result.providerTaskId ?? lastProviderTaskId,
              asset: result.asset,
              generation: {
                modelId: generationSettings.modelId,
                modelLabel: generationSettings.modelLabel,
                aspectRatio: generationSettings.aspectRatio,
                sizeOption: generationSettings.sizeOption,
                prompt: result.item.prompt,
                compiledPrompt: result.item.prompt,
                promptContractVersion: result.item.promptContractVersion,
                editMode: result.item.editMode,
                referenceObjectIds: result.item.referenceObjectIds,
                referenceResolution: result.item.referenceResolution,
                directionId: result.item.targetDirectionId,
                visualBranchId: result.item.visualBranchId,
                operationId,
                clientRequestId: `${clientRequestId}-${result.item.id}`,
                providerTaskId: result.providerTaskId ?? lastProviderTaskId,
                title: result.item.title,
                purpose: result.item.purpose,
                role: result.item.role,
                visualIntent: result.item.visualIntent,
                visualPlan: validatedPlan.plan,
                createdAt: new Date().toISOString()
              },
              sourceObjectIds: result.sourceObjectIds,
              directionObjectId: result.item.targetDirectionId,
              visualBranchId: result.item.visualBranchId,
              title: result.item.title,
              summary: result.item.purpose,
              role: result.item.role,
              position: getGeneratedImagePlacement(
                current,
                result.item,
                result.index,
                placementMap.get(result.item.id)
              ),
              canvasSize: plannedImageSize
            });
            return { workspace: committed.workspace, value: committed.createdObjectId };
          });
          if (createdObjectId) {
            createdObjectIds.push(createdObjectId);
          }
        } else {
          failedItems.push(`${result.item.title}: ${result.reason}`);
          commitWorkspaceNow((current) => {
            const committed = applyImageGenerationResultCommit(current, {
              status: "failed",
              operationId,
              planItemId: result.item.id,
              reason: result.reason
            });
            return { workspace: committed.workspace, value: undefined };
          });
        }

        // The pending shape effect runs before workspace shape sync, so this
        // removes the matching placeholder before its image object is created.
        setPendingImageGenerationSlots((current) =>
          removePendingImageGenerationSlot(current, operationId, result.item.id)
        );
      };

      try {
        await mapWithConcurrency(
          validatedPlan.plan.items,
          input.aPlusExternalAction ? 1 : IMAGE_GENERATION_MAX_CONCURRENCY,
          async (item, itemIndex): Promise<AgentItemResult> => {
            const itemClientRequestId = `${clientRequestId}-${item.id}`;
            const aPlusActionId = input.aPlusExternalAction
              ? await buildAPlusImageChildActionId(input.aPlusExternalAction.actionId, item.id)
              : undefined;
            const existingObjectId = input.aPlusExternalAction
              ? findAPlusImageResultObjectId(workspaceAtPlanCommit, itemClientRequestId)
              : undefined;
            if (existingObjectId) {
              completedCount += 1;
              publishProgress();
              return {
                status: "existing",
                index: itemIndex,
                item,
                objectId: existingObjectId
              };
            }
            inFlightCount += 1;
            publishProgress();
            try {
              const restoredAction = input.aPlusExternalAction && aPlusActionId &&
                input.restoredExternalAction?.actionKind === "image" &&
                input.restoredExternalAction.actionId === aPlusActionId &&
                input.restoredExternalAction.callId === input.aPlusExternalAction.actionId
                ? input.restoredExternalAction
                : undefined;
              if (input.restoredExternalAction && !restoredAction) {
                throw aPlusExternalActionPayloadError(
                  "A+ Image 的持久化 Action 不属于当前恢复的 Image 项，不能重新构造请求。"
                );
              }
              const restoredImagePayload = restoredAction
                ? parsePersistedAPlusImageRequestBody(restoredAction.requestBody)
                : undefined;
              if (restoredAction && (
                await hashAPlusExternalActionBody(restoredAction.requestBody) !== restoredAction.requestHash ||
                !restoredImagePayload
              )) {
                throw aPlusExternalActionPayloadError(
                  "A+ Image 的持久化请求 Body 缺失、损坏或校验失败。"
                );
              }
              const referenceImages = restoredImagePayload
                ? { images: [], sourceObjectIds: restoredImagePayload.sourceObjectIds }
                : await collectImageReferenceDataUrls(
                    workspaceAtPlanCommit,
                    item.referenceObjectIds,
                    input.signal
                  );
              setWorkspace((current) =>
                markImageGenerationOperationSubmitted(current, {
                  operationId,
                  referenceObjectIds: item.referenceObjectIds,
                  imagePixels: restoredImagePayload
                    ? restoredImagePayload.imageCount > 0
                    : referenceImages.images.length > 0
                })
              );

              const imageInput = {
                modelId: generationSettings.modelId,
                prompt: item.prompt,
                images: referenceImages.images,
                aspectRatio: generationSettings.aspectRatio,
                sizeOption: generationSettings.sizeOption,
                referenceObjectIds: item.referenceObjectIds,
                directionObjectId: item.targetDirectionId,
                visualBranchId: item.visualBranchId,
                operationId,
                clientRequestId: itemClientRequestId
              };
              const imageRequestBody = restoredAction
                ? restoredAction.requestBody
                : JSON.stringify(input.aPlusExternalAction && aPlusActionId
                    ? {
                        localProjectId: input.aPlusExternalAction.localProjectId,
                        requestId: input.aPlusExternalAction.requestId,
                        stepSequence: input.aPlusExternalAction.stepSequence,
                        actionId: aPlusActionId,
                        claimCallId: input.aPlusExternalAction.actionId,
                        input: imageInput
                      }
                    : imageInput);
              if (input.aPlusExternalAction && aPlusActionId && !restoredAction && input.onExternalActionIntent) {
                const action: APlusExternalActionDescriptor = {
                  actionId: aPlusActionId,
                  actionKind: "image",
                  requestBody: imageRequestBody,
                  requestHash: await hashAPlusExternalActionBody(imageRequestBody)
                };
                if (!await input.onExternalActionIntent({ actionId: aPlusActionId, action })) {
                  throw aPlusExternalActionPayloadError(
                    "A+ Image Action 身份未能在发送前写入 Recovery Record。",
                    "external_action_intent_persistence_failed"
                  );
                }
              }
              const imageResponse = input.aPlusExternalAction && aPlusActionId
                ? await postAPlusExternalAction({
                    fetch,
                    url: `/api/ai/agent/turns/${encodeURIComponent(input.aPlusExternalAction.serverTurnId)}/actions/image`,
                    actionId: aPlusActionId,
                    actionKind: "image",
                    requestBody: imageRequestBody,
                    signal: input.signal,
                    message: "图像任务请求响应丢失，服务器状态未知；本地只进行同身份查询，不重复生成。"
                  })
                : await fetch("/api/ai/image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: imageRequestBody,
                    signal: input.signal
                  });
              const providerTaskId = imageResponse.headers.get("X-Morpho-Provider-Task-Id") || undefined;
              if (providerTaskId) {
                lastProviderTaskId = providerTaskId;
              }
              const imageResponseKind = classifyAPlusImageResponse(
                imageResponse.status,
                imageResponse.headers.get("Content-Type")
              );
              if (imageResponseKind === "running") {
                if (!input.aPlusExternalAction || !aPlusActionId) {
                  throw new Error("图像任务仍在执行，但缺少 A+ Action 身份，无法安全恢复。");
                }
                throw await createAPlusExternalActionRunningError({
                  actionId: aPlusActionId,
                  actionKind: "image",
                  requestBody: imageRequestBody,
                  message: "图像任务仍在服务器执行；本地只进行同身份查询，不重复生成。"
                });
              }
              if (imageResponseKind === "jsonError") {
                throw new Error(await readErrorResponse(imageResponse));
              }
              if (!imageResponse.ok) {
                throw new Error(await readErrorResponse(imageResponse));
              }

              const mimeType = imageResponse.headers.get("Content-Type") ?? "image/png";
              const blob = await imageResponse.blob();
              const file = new File([blob], makeGeneratedImageFileName(mimeType), { type: mimeType });
              const saved = await saveBlobAsLocalAsset(indexedDbBlobStore, file, "aiGeneratedImage", {
                readImageDimensions: readImageBlobDimensions
              });
              if (saved.status === "failed") {
                throw new Error(saved.reason);
              }

              return {
                status: "ok",
                index: itemIndex,
                item,
                asset: saved.asset,
                sourceObjectIds: referenceImages.sourceObjectIds,
                providerTaskId
              };
            } catch (itemError) {
              if (itemError instanceof DOMException && itemError.name === "AbortError") {
                throw itemError;
              }
              if (isAPlusExternalActionRunningError(itemError)) {
                throw itemError;
              }
              if (isAPlusExternalActionBarrierError(itemError)) {
                throw itemError;
              }
              const reason = itemError instanceof Error ? itemError.message : "图像生成失败";
              return { status: "failed", index: itemIndex, item, reason };
            } finally {
              inFlightCount = Math.max(0, inFlightCount - 1);
              completedCount += 1;
              publishProgress();
            }
          },
          { onSettled: applyAgentItemResult }
        );
      } catch (error) {
        const isCancelled = error instanceof DOMException && error.name === "AbortError";
        const isExternalActionRunning = isAPlusExternalActionRunningError(error);
        const reason = isCancelled
          ? "图像任务已取消。原输入、来源对象和已有结果已保留。"
          : error instanceof Error
            ? error.message
            : "图像任务失败。";
        if (!isExternalActionRunning) {
          commitWorkspaceNow((current) => {
            const failed = failImageGenerationOperation(current, {
              operationId,
              status: isCancelled ? "cancelled" : "failed",
              reason,
              providerTaskId: lastProviderTaskId
            });
            return { workspace: failed, value: undefined };
          });
          setImageTaskStatus({ state: isCancelled ? "cancelled" : "failed", message: reason });
        } else {
          setImageTaskStatus({ state: "waiting", message: reason });
        }
        throw error;
      } finally {
        setPendingImageGenerationSlots((current) =>
          current.filter((slot) => slot.operationId !== operationId)
        );
      }

      if (createdObjectIds.length === 0) {
        const reason = failedItems[0] ?? "所有图像计划项都生成失败了。";
        commitWorkspaceNow((current) => {
          const failed = failImageGenerationOperation(current, {
            operationId,
            status: "failed",
            reason,
            providerTaskId: lastProviderTaskId
          });
          return { workspace: failed, value: undefined };
        });
        setImageTaskStatus({ state: "failed", message: reason });
        throw new Error(reason);
      }

      const lastCreatedObjectId = createdObjectIds.at(-1) ?? createdObjectIds[0];
      const completedWorkspace = commitWorkspaceNow((current) => {
        const operation = current.operations[operationId];
        const completed = operation?.type === "imageGeneration" && operation.status === "succeeded"
          ? current
          : completeImageGenerationOperation(current, {
              operationId,
              providerTaskId: lastProviderTaskId,
              resultObjectId: lastCreatedObjectId
            });
        return { workspace: completed, value: completed };
      });
      setSelectedObjectIds(createdObjectIds);
      setFocusRequest((current) => ({ objectId: lastCreatedObjectId, nonce: current.nonce + 1 }));
      setImageTaskStatus({
        state: "succeeded",
        message:
          failedItems.length > 0
            ? `部分完成：已保存 ${createdObjectIds.length} 张，失败 ${failedItems.length} 项。`
            : `已完成：已保存 ${createdObjectIds.length} 张新图像。`
      });

      return {
        workspace: completedWorkspace,
        createdObjectIds,
        failedItems
      };
    },
    [commitWorkspaceNow, effectiveImageGenerationSettings, setFocusRequest, setImageTaskStatus, setSelectedObjectIds, setWorkspace]
  );

  const agentTurnHost = useMemo<AgentTurnHost>(
    () => ({
      commitWorkspace: commitWorkspaceNow,
      readWorkspace: readWorkspaceNow,
      persistWorkspace: flushWorkspace,
      ui: {
        setContextWarning,
        clearPendingDeliveryDraftTarget: () => {
          setPendingDeliveryDraftTarget(null);
        },
        setStreaming: setIsAiStreaming,
        setDraft: setAiDraft,
        setTaskMode,
        openConversation: () => {
          setAiOpen(true);
        },
        showFailure: () => {
          setShowRecoveryPending(false);
          setShowFailure(true);
        },
        showRecoveryPending: () => {
          setShowFailure(false);
          setShowRecoveryPending(true);
        },
        setPendingConfirmation,
        selectObjects: setSelectedObjectIds,
        focusObject: (objectId) => {
          setFocusRequest((current) => ({ objectId, nonce: current.nonce + 1 }));
        },
        openProposal: setActiveProposalId
      },
      abortSlot: {
        get: () => abortControllerRef.current,
        set: (value) => {
          abortControllerRef.current = value;
        }
      },
      streamFlushSlot: {
        get: () => agentStreamFlushRef.current,
        set: (value) => {
          agentStreamFlushRef.current = value;
        }
      },
      fetch,
      executeVisualGenerationPlan: executeAgentVisualGenerationPlan,
      now: Date.now,
      randomSuffix: () => Math.random().toString(36).slice(2, 8)
    }),
    [commitWorkspaceNow, executeAgentVisualGenerationPlan, flushWorkspace, readWorkspaceNow, setSelectedObjectIds]
  );

  const recoveredAgentRuntimeProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!persistenceState.isWorkspaceLoaded || recoveredAgentRuntimeProjectRef.current === projectId) {
      return;
    }
    recoveredAgentRuntimeProjectRef.current = projectId;
    void recoverSelectedAgentRuntime(projectId, agentTurnHost);
  }, [agentTurnHost, persistenceState.isWorkspaceLoaded, projectId]);

  const handleSendMorphoAgentTurn = useCallback(async () => {
    const draft = aiDraft.trim();
    if (!draft || isAiStreaming) {
      return;
    }

    if (showRecoveryPending) {
      const recoveryResult = await resumeSelectedAgentRuntime(projectId, agentTurnHost);
      if (recoveryResult === "pending") {
        setShowFailure(false);
        setShowRecoveryPending(true);
        return;
      }
      if (recoveryResult === "failed") {
        setShowRecoveryPending(false);
        setShowFailure(true);
        return;
      }
      setShowRecoveryPending(false);
      setShowFailure(false);
    }

    const turnInput = {
      draft,
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
    if (parseManualCompactCommand(draft).matched) {
      await runSelectedManualCompactionTurn(turnInput, agentTurnHost);
      return;
    }
    await runSelectedMorphoAgentTurn(turnInput, agentTurnHost);
  }, [
    agentTurnHost,
    agentTurnMode,
    aiDraft,
    directionPreviewCount,
    effectiveImageGenerationSettings.modelId,
    isAiStreaming,
    pendingDeliveryDraftTarget,
    recommendedTaskMode,
    recommendedWorkIntent,
    selectedObjectIds,
    selectedObjects,
    taskMode,
    workIntent,
    projectId,
    showRecoveryPending
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
        chat: "full",
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
  }, [workspace]);

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
    [applyDeliveryOperation, setSelectedObjectIds]
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

  const handleCancelAiRequest = useCallback(async () => {
    if (await cancelSelectedMorphoAgentTurn(projectId)) {
      return;
    }
    agentStreamFlushRef.current?.();
    agentStreamFlushRef.current = null;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsAiStreaming(false);
    setImageTaskStatus((current) =>
      current && isActiveImageTaskStatus(current.state)
        ? {
            state: "cancelled",
            message: "当前 AI 任务已停止。原输入、已保存对象和已有结果会保留。"
          }
        : current
    );
    commitWorkspaceNow((current) => {
      const activeMessage = [...current.ai.messages]
        .reverse()
        .find((message) => message.status === "streaming" && message.agentTrace);
      let next = current;
      if (activeMessage?.agentTrace) {
        next = updateAiMessage(
          next,
          activeMessage.id,
          activeMessage.body || "当前 Agent 回合已取消。原输入、选择和已完成步骤已保留。",
          "cancelled",
          {
            agentTrace: completeAgentTrace(activeMessage.agentTrace, "cancelled", new Date().toISOString())
          }
        );
      }
      next = interruptActiveOperations(next, "用户停止了当前 AI 任务。原输入、已保存对象和已有结果会保留。");
      return { workspace: next, value: undefined };
    });
  }, [commitWorkspaceNow, projectId]);

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
        setSelectedObjectIds([result.researchObject.id]);
        setFocusRequest((current) => ({ objectId: result.researchObject.id, nonce: current.nonce + 1 }));
        setActiveProposalId(null);
        setDetailProposalId(null);
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
        setSelectedObjectIds([result.designDefinitionObject.id]);
        setFocusRequest((current) => ({ objectId: result.designDefinitionObject.id, nonce: current.nonce + 1 }));
        setActiveProposalId(null);
        setDetailProposalId(null);
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
          setFocusRequest((current) => ({ objectId: result.directions[0].id, nonce: current.nonce + 1 }));
        }
        setActiveProposalId(null);
        setDetailProposalId(null);
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
  }, [activeProposal, setSelectedObjectIds, setWorkspace, workspace]);

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
          setSelectedObjectIds([result.researchObject.id]);
          setFocusRequest((current) => ({ objectId: result.researchObject.id, nonce: current.nonce + 1 }));
          setActiveProposalId(null);
          setDetailProposalId(null);
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
          setSelectedObjectIds([result.designDefinitionObject.id]);
          setFocusRequest((current) => ({ objectId: result.designDefinitionObject.id, nonce: current.nonce + 1 }));
          setActiveProposalId(null);
          setDetailProposalId(null);
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
            setFocusRequest((current) => ({ objectId: result.directions[0].id, nonce: current.nonce + 1 }));
          }
          setActiveProposalId(null);
          setDetailProposalId(null);
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
    [setSelectedObjectIds, setWorkspace, workspace]
  );

  const handleRejectProposal = useCallback(
    (proposalId: string) => {
      setWorkspace((current) => rejectArtifactProposal(current, proposalId, "用户明确放弃当前草案。"));
      setActiveProposalId((current) => (current === proposalId ? null : current));
      setDetailProposalId((current) => (current === proposalId ? null : current));
      setSelectedObjectIds((current) => current.filter((selectedId) => selectedId !== proposalId));
    },
    [setSelectedObjectIds, setWorkspace]
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
    await acknowledgeSelectedPendingAgentConfirmation(projectId);

    if (pendingConfirmation.kind === "batchGenerateVisuals" || pendingConfirmation.kind === "agentGenerateVisuals") {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsAiStreaming(true);
      setShowFailure(false);
      setPendingConfirmation(null);
      setAiDraft("");
      setImageTaskStatus({
        state: "preparing",
        message: `正在批量生成 ${pendingConfirmation.plan.items.length} 张图像`
      });

      try {
        const result = await executeAgentVisualGenerationPlan({
          workspaceSnapshot: workspace,
          draft: pendingConfirmation.draft,
          plan: pendingConfirmation.plan,
          sourceObjectIds: pendingConfirmation.sourceObjectIds,
          selectedDirectionIds: pendingConfirmation.selectedDirectionIds,
          selectedImageIds: pendingConfirmation.selectedImageIds,
          signal: controller.signal
        });
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
        abortControllerRef.current = null;
        setIsAiStreaming(false);
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
          setFocusRequest((focus) => ({ objectId: placed.directions[0].id, nonce: focus.nonce + 1 }));
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
        const controller = new AbortController();
        abortControllerRef.current = controller;
        setIsAiStreaming(true);
        setShowFailure(false);
        setPendingConfirmation(null);
        setAiDraft("");
        try {
          const result = await executeAgentVisualGenerationPlan({
            workspaceSnapshot: workspace,
            draft: pendingConfirmation.draft,
            plan: pendingConfirmation.visualPlan,
            sourceObjectIds: pendingConfirmation.sourceObjectIds,
            selectedDirectionIds: pendingConfirmation.selectedDirectionIds,
            selectedImageIds: pendingConfirmation.selectedImageIds,
            signal: controller.signal
          });
          setWorkspace(() => result.workspace);
        } finally {
          abortControllerRef.current = null;
          setIsAiStreaming(false);
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
  }, [
    executeAgentVisualGenerationPlan,
    pendingConfirmation,
    projectId,
    pushObjectOperationUndo,
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
    void acknowledgeSelectedPendingAgentConfirmation(projectId);
    setPendingConfirmation(null);
    setAiDraft("");
    showWorkspaceNotice(`已替换默认参考为「${pendingConfirmation.targetTitle}」，直接延展素材已标记待复核`);
  }, [pendingConfirmation, projectId, pushObjectOperationUndo, setWorkspace, showWorkspaceNotice]);

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
    setDetailProposalId((current) => (current && removedIds.includes(current) ? null : current));
    setCanvasContextMenu(null);
  }, [pushObjectOperationUndo, selectedObjects, setSelectedObjectIds, setWorkspace]);

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
    setDetailProposalId((current) => (current && removedIds.includes(current) ? null : current));
    setCanvasContextMenu(null);
  }, [pushObjectOperationUndo, selectedObjects, setSelectedObjectIds, setWorkspace]);

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
        confidence: draftResult.draft.confidence,
        state: draftResult.draft.state,
        note: draftResult.draft.note,
        position: {
          x: workspace.canvas.view.x + 240,
          y: workspace.canvas.view.y + 180
        }
      });
      setWorkspace(result.workspace);
      setSelectedObjectIds([result.keyConclusion.id]);
      setFocusRequest((current) => ({ objectId: result.keyConclusion.id, nonce: current.nonce + 1 }));
      showWorkspaceNotice(`已保存关键结论「${result.keyConclusion.title}」`);
    },
    [pushObjectOperationUndo, setSelectedObjectIds, setWorkspace, showWorkspaceNotice, workspace]
  );

  const handleOpenResearchDetail = useCallback(() => {
    const research = selectedObjects.find((object) => object.type === "research");
    if (!research) {
      return;
    }

    setActiveResearchDetailObjectId(research.id);
  }, [selectedObjects]);

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
      setFocusRequest((current) => ({ objectId: result.activeObjectIds[0], nonce: current.nonce + 1 }));
    }
    setActiveResearchDetailObjectId(null);
  }, [selectedObjects, setSelectedObjectIds, setWorkspace, workspace]);

  const handleApplyResearchExtractionSelection = useCallback(
    (selectedKeys: string[]) => {
      if (!activeResearchDetailObjectId) {
        return;
      }

      const result = applyResearchExtractionSelection(workspace, activeResearchDetailObjectId, selectedKeys);
      setWorkspace(result.workspace);
      if (result.activeObjectIds.length > 0) {
        setSelectedObjectIds(result.activeObjectIds);
        setFocusRequest((current) => ({ objectId: result.activeObjectIds[0], nonce: current.nonce + 1 }));
      }
    },
    [activeResearchDetailObjectId, setSelectedObjectIds, setWorkspace, workspace]
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
          confidence: keyConclusionCandidate.confidence,
          note: keyConclusionCandidate.note,
          position: {
            x: workspace.canvas.view.x + 240,
            y: workspace.canvas.view.y + 180
          },
          comparison: comparisonMetadata
        });
        setWorkspace(result.workspace);
        setSelectedObjectIds([result.keyConclusion.id]);
        setFocusRequest((current) => ({ objectId: result.keyConclusion.id, nonce: current.nonce + 1 }));
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
    [pushObjectOperationUndo, setSelectedObjectIds, setWorkspace, showWorkspaceNotice, workspace]
  );

  const cleanupDocumentSourcePreview = useCallback(() => {
    if (documentSourcePreviewUrlRef.current) {
      URL.revokeObjectURL(documentSourcePreviewUrlRef.current);
      documentSourcePreviewUrlRef.current = null;
    }
  }, []);

  const handleOpenDocumentReader = useCallback(
    (fileObjectId: string, initialLocation?: { startOffset: number; endOffset: number; label: string } | null) => {
      documentReaderAbortRef.current?.abort();
      cleanupDocumentSourcePreview();
      const requestId = documentReaderRequestRef.current + 1;
      documentReaderRequestRef.current = requestId;
      const abortController = new AbortController();
      documentReaderAbortRef.current = abortController;
      setSelectedObjectIds([]);
      setLocalEditObjectId(null);
      setCanvasContextMenu(null);

      setDocumentReader({
        fileObjectId,
        requestId,
        status: "loading",
        text: "",
        initialLocation
      });

      void Promise.all([
        loadDocumentReaderExtractWithRecovery(
          workspace,
          fileObjectId,
          indexedDbBlobStore,
          abortController.signal,
          setWorkspace
        ),
        loadDocumentSourcePreview(workspace, fileObjectId, indexedDbBlobStore, abortController.signal)
      ])
        .then(
        ([result, sourcePreview]) => {
          setDocumentReader((current) => {
            if (
              !current ||
              !shouldAcceptDocumentReaderLoadResult(
                { openFileObjectId: current.fileObjectId, requestId: current.requestId },
                { fileObjectId, requestId }
              )
            ) {
              revokeDocumentSourcePreview(sourcePreview);
              return current;
            }

            documentSourcePreviewUrlRef.current = sourcePreview.status === "ready" ? sourcePreview.url : null;
            if (result.status === "loaded") {
              return {
                ...current,
                status: "loaded",
                text: result.text,
                extractAsset: result.asset,
                sourcePreview,
                initialLocation,
                message: undefined
              };
            }

            return {
              ...current,
              status: result.status,
              text: "",
              extractAsset: undefined,
              sourcePreview,
              initialLocation: undefined,
              message: result.message
            };
          });
        }
        )
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }

          setDocumentReader((current) =>
            current && current.fileObjectId === fileObjectId && current.requestId === requestId
              ? {
                  ...current,
                  status: "error",
                  text: "",
                  message: error instanceof Error ? error.message : "文档阅读器打开失败。"
                }
              : current
          );
        });
    },
    [cleanupDocumentSourcePreview, setSelectedObjectIds, setWorkspace, workspace]
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
    [setSelectedObjectIds, setWorkspace]
  );

  const handleCloseDocumentReader = useCallback(() => {
    documentReaderAbortRef.current?.abort();
    documentReaderAbortRef.current = null;
    documentReaderRequestRef.current += 1;
    cleanupDocumentSourcePreview();
    setDocumentReader(null);
  }, [cleanupDocumentSourcePreview]);

  useEffect(
    () => () => {
      documentReaderAbortRef.current?.abort();
      cleanupDocumentSourcePreview();
    },
    [cleanupDocumentSourcePreview]
  );

  const documentReaderFile = documentReader ? workspace.objects[documentReader.fileObjectId] : undefined;
  const documentReaderInitialLocation = documentReader?.initialLocation ?? null;
  const selectAllCanvasObjects = useCallback(() => {
    if (activeCanvasObjectIds.length === 0) {
      return false;
    }

    requestCanvasSelection(activeCanvasObjectIds);
    setCanvasContextMenu(null);
    setWorkspace((current) => ({
      ...current,
      ui: {
        ...current.ui,
        lastSelectionIds: activeCanvasObjectIds
      }
    }));
    return true;
  }, [activeCanvasObjectIds, requestCanvasSelection, setWorkspace]);

  const clearCanvasSelection = useCallback(() => {
    if (selectedObjectIds.length === 0) {
      return false;
    }

    requestCanvasSelection([]);
    setCanvasContextMenu(null);
    setWorkspace((current) => ({
      ...current,
      ui: {
        ...current.ui,
        lastSelectionIds: []
      }
    }));
    return true;
  }, [requestCanvasSelection, selectedObjectIds.length, setWorkspace]);

  const closeTopWorkspaceSurface = useCallback(() => {
    if (canvasContextMenu) {
      setCanvasContextMenu(null);
      return true;
    }
    if (detailProposalId) {
      setDetailProposalId(null);
      return true;
    }
    if (detailDesignDefinitionId) {
      setDetailDesignDefinitionId(null);
      return true;
    }
    if (detailConceptDirectionId) {
      setDetailConceptDirectionId(null);
      return true;
    }
    if (activeResearchDetailObjectId) {
      setActiveResearchDetailObjectId(null);
      return true;
    }
    if (documentReader) {
      handleCloseDocumentReader();
      return true;
    }
    if (deliveryPanelOpen) {
      setDeliveryPanelOpen(false);
      return true;
    }
    if (deliveryOutputPanelOpen) {
      setDeliveryOutputPanelOpen(false);
      return true;
    }
    if (bundlePanelOpen) {
      setBundlePanelOpen(false);
      return true;
    }
    if (projectMenuOpen) {
      setProjectMenuOpen(false);
      return true;
    }
    if (activeDrawer) {
      handleDrawerChange(null);
      return true;
    }

    return clearCanvasSelection();
  }, [
    activeDrawer,
    activeResearchDetailObjectId,
    bundlePanelOpen,
    canvasContextMenu,
    clearCanvasSelection,
    deliveryOutputPanelOpen,
    deliveryPanelOpen,
    detailConceptDirectionId,
    detailDesignDefinitionId,
    detailProposalId,
    documentReader,
    handleCloseDocumentReader,
    handleDrawerChange,
    projectMenuOpen
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
      onOpenDeliveryPreparation={() => openDeliveryPreparation(toolbarObjects[0]?.type === "delivery" ? toolbarObjects[0].id : undefined)}
      onLocalEdit={handleLocalEdit}
      onReferenceIntent={handleReferenceIntent}
      onHide={handleHideSelected}
      onDelete={handleDeleteSelected}
      onOpenProposalDetail={() => { const object = toolbarObjects.find((item) => item.type === "proposalDraft"); if (object?.type === "proposalDraft") { setDetailDesignDefinitionId(null); setDetailConceptDirectionId(null); setActiveProposalId(object.proposalId); setDetailProposalId(object.proposalId); } }}
      onApplyProposal={() => { const object = toolbarObjects.find((item) => item.type === "proposalDraft"); if (object?.type === "proposalDraft") handleApplyProposalFromCanvas(object.proposalId); }}
      onRejectProposal={() => { const object = toolbarObjects.find((item) => item.type === "proposalDraft"); if (object?.type === "proposalDraft") handleRejectProposal(object.proposalId); }}
      onContinueProposalDiscussion={() => { const object = toolbarObjects.find((item) => item.type === "proposalDraft"); if (object?.type === "proposalDraft") handleContinueProposalDiscussion(object.proposalId); }}
      onOpenDesignDefinitionDetail={() => { const object = toolbarObjects.find((item) => item.type === "designDefinition"); if (object?.type === "designDefinition") { setDetailProposalId(null); setDetailConceptDirectionId(null); setDetailDesignDefinitionId(object.id); } }}
      onOpenConceptDirectionDetail={() => { const object = toolbarObjects.find((item) => item.type === "conceptDirection"); if (object?.type === "conceptDirection") { setDetailProposalId(null); setDetailDesignDefinitionId(null); setDetailConceptDirectionId(object.id); } }}
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
          deliveryOutputPanelOpen ? "output" : "x",
          bundlePanelOpen ? "bundle" : "x",
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
        onImportRequest={handleImportRequest}
        onContextMenuRequest={(request) => {
          setCanvasContextMenu({
            x: request.x,
            y: request.y,
            objectId: request.objectId,
            stageId: request.stageId,
            pagePosition: request.pagePosition,
            openedAt: Date.now()
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
            onClick={() => setDetailProposalId(null)}
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
            onClick={() => setDetailDesignDefinitionId(null)}
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
            onClick={() => setDetailConceptDirectionId(null)}
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
          handleImportRequest({
            files,
            position: {
              x: workspace.canvas.view.x + 160,
              y: workspace.canvas.view.y + 160
            }
          })
        }
        onSearch={() => handleDrawerChange("search")}
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
        projectMenuOpen={projectMenuOpen}
        projectRenameDraft={projectRenameDraft}
        onProjectMenuToggle={() => {
          if (!projectMenuOpen) {
            setProjectRenameDraft(workspace.project.title);
          }
          setProjectMenuOpen((current) => !current);
        }}
        onProjectRenameDraftChange={setProjectRenameDraft}
        onProjectRenameConfirm={handleConfirmProjectRename}
        onOpenProjectHome={handleOpenProjectHome}
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
          restorePreview={inspectedBackup?.preview ?? null}
          busyLabel={bundleBusyLabel}
          message={bundleMessage}
          onClose={() => setBundlePanelOpen(false)}
          onArchiveIncludeFullChatChange={setArchiveIncludeFullChat}
          onArchiveIncludeContinuityChange={setArchiveIncludeContinuity}
          onExportArchive={handleExportHumanArchive}
          onExportBackup={handleExportEditableBackup}
          onInspectBackup={handleInspectEditableBackup}
          onCancelRestorePreview={handleCancelRestorePreview}
          onConfirmRestoreBackup={handleConfirmRestoreEditableBackup}
        />
      ) : null}
      <LeftRail
        activeDrawer={activeDrawer}
        onDrawerChange={handleDrawerChange}
        onAddToCanvas={handleRailAddToCanvas}
      />
      <OverlayDrawers
        mode={activeDrawer}
        workspace={workspace}
        highlightedRecordIds={highlightContinuityEntryIds}
        onClose={() => handleDrawerChange(null)}
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
            if (Date.now() - canvasContextMenu.openedAt < 220) {
              return;
            }
            setCanvasContextMenu(null);
          }}
          onContextMenuCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (Date.now() - canvasContextMenu.openedAt < 220) {
              return;
            }
            setCanvasContextMenu(null);
          }}
          onWheelCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setCanvasContextMenu(null);
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
          onClose={() => setCanvasContextMenu(null)}
          onCopySummary={handleCopySelectedSummary}
          onAskAi={handleAskAi}
          onLocalEdit={handleLocalEdit}
          onReferenceIntent={handleReferenceIntent}
          onHide={handleHideSelected}
          onDelete={handleDeleteSelected}
          onReorderLayer={handleReorderSelectedLayers}
          onClearSelection={() => requestCanvasSelection([])}
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
            setDetailDesignDefinitionId(null);
            setDetailConceptDirectionId(null);
            setActiveProposalId(proposalObject.proposalId);
            setDetailProposalId(proposalObject.proposalId);
            setCanvasContextMenu(null);
          }}
          onApplyProposal={() => {
            const proposalObject = contextMenuObjects.find((object) => object.type === "proposalDraft");
            if (proposalObject?.type !== "proposalDraft") {
              return;
            }
            handleApplyProposalFromCanvas(proposalObject.proposalId);
            setCanvasContextMenu(null);
          }}
          onRejectProposal={() => {
            const proposalObject = contextMenuObjects.find((object) => object.type === "proposalDraft");
            if (proposalObject?.type !== "proposalDraft") {
              return;
            }
            handleRejectProposal(proposalObject.proposalId);
            setCanvasContextMenu(null);
          }}
          onContinueProposalDiscussion={() => {
            const proposalObject = contextMenuObjects.find((object) => object.type === "proposalDraft");
            if (proposalObject?.type !== "proposalDraft") {
              return;
            }
            handleContinueProposalDiscussion(proposalObject.proposalId);
            setCanvasContextMenu(null);
          }}
          onOpenDesignDefinitionDetail={() => {
            const definition = contextMenuObjects.find((object) => object.type === "designDefinition");
            if (definition?.type === "designDefinition") {
              setDetailProposalId(null);
              setDetailConceptDirectionId(null);
              setDetailDesignDefinitionId(definition.id);
            }
            setCanvasContextMenu(null);
          }}
          onOpenConceptDirectionDetail={() => {
            const direction = contextMenuObjects.find((object) => object.type === "conceptDirection");
            if (direction?.type === "conceptDirection") {
              setDetailProposalId(null);
              setDetailDesignDefinitionId(null);
              setDetailConceptDirectionId(direction.id);
            }
            setCanvasContextMenu(null);
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

      {activeResearchDetailObject ? (
        <ResearchDetailPanel
          workspace={workspace}
          research={activeResearchDetailObject}
          onClose={() => setActiveResearchDetailObjectId(null)}
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
          void acknowledgeSelectedPendingAgentConfirmation(projectId);
          setPendingConfirmation(null);
        }}
        onFailureRetry={() => {
          void (async () => {
            setShowFailure(false);
            const result = await resumeSelectedAgentRuntime(projectId, agentTurnHost);
            setShowRecoveryPending(result === "pending");
            setShowFailure(result === "failed");
          })();
        }}
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

function getGeneratedImagePlacement(
  workspace: MorphoWorkspace,
  item: VisualGenerationPlanItem,
  index: number,
  precomputedPosition?: { x: number; y: number }
): { x: number; y: number } {
  if (precomputedPosition) {
    return precomputedPosition;
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

function getPlannedImageSize(aspectRatio: GrsImageAspectRatio): { w: number; h: number } {
  const [width, height] = aspectRatio.split(":").map(Number);
  return getImageCanvasSize({
    aspectRatio: width && height ? width / height : undefined
  });
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

function parsePersistedAPlusImageRequestBody(
  requestBody: string
): Readonly<{ sourceObjectIds: string[]; imageCount: number }> | undefined {
  try {
    const parsed = JSON.parse(requestBody) as unknown;
    if (!isWorkspaceRecord(parsed) || !isWorkspaceRecord(parsed.input)) return undefined;
    const referenceObjectIds = parsed.input.referenceObjectIds;
    const images = parsed.input.images;
    if (
      !Array.isArray(referenceObjectIds) ||
      !referenceObjectIds.every((value) => typeof value === "string") ||
      !Array.isArray(images) ||
      !images.every((value) => typeof value === "string")
    ) {
      return undefined;
    }
    return {
      sourceObjectIds: [...referenceObjectIds],
      imageCount: images.length
    };
  } catch {
    return undefined;
  }
}

function aPlusExternalActionPayloadError(
  message: string,
  code = "external_action_request_payload_unavailable"
): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function isWorkspaceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAPlusExternalActionBarrierError(value: unknown): boolean {
  return isWorkspaceRecord(value) && (
    value.code === "external_action_request_payload_unavailable" ||
    value.code === "external_action_intent_persistence_failed"
  );
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

async function loadDocumentSourcePreview(
  workspace: MorphoWorkspace,
  fileObjectId: string,
  blobStore: { get(storageKey: string): Promise<Blob | null> },
  signal: AbortSignal
): Promise<DocumentSourcePreview> {
  const file = workspace.objects[fileObjectId];
  if (!file || file.type !== "file") {
    return { status: "missing", message: "源文件对象不可用。" };
  }

  const asset = file.assetId ? workspace.assets[file.assetId] : undefined;
  if (!asset || asset.sourceType !== "originalFile") {
    return {
      status: "missing",
      fileName: file.fileName ?? file.title,
      mimeType: file.mimeType,
      message: "源文件资产不可用；下方仍可查看已保存的解析文本。"
    };
  }

  const mimeType = asset.mimeType || file.mimeType || "";
  const fileName = file.fileName ?? asset.fileName;
  if (!canPreviewOriginalDocument(mimeType)) {
    return {
      status: "unsupported",
      fileName,
      mimeType,
      message: "当前文件类型暂不能在工作台内预览原版式；下方仍可查看已提取的解析文本。"
    };
  }

  const blob = await blobStore.get(asset.storageKey);
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  if (!blob) {
    return {
      status: "missing",
      fileName,
      mimeType,
      message: "源文件 Blob 缺失；下方仍可查看已保存的解析文本。"
    };
  }

  return {
    status: "ready",
    url: URL.createObjectURL(blob),
    mimeType,
    fileName
  };
}

function revokeDocumentSourcePreview(preview: DocumentSourcePreview): void {
  if (preview.status === "ready") {
    URL.revokeObjectURL(preview.url);
  }
}

function canPreviewOriginalDocument(mimeType: string): boolean {
  return mimeType.startsWith("image/") || mimeType.startsWith("text/") || mimeType === "application/pdf";
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

function isEditableDomTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);
}

