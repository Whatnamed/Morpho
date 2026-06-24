"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";

import {
  addLocalModificationVariants,
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
import { BottomDetailBar } from "./components/BottomDetailBar";
import { LeftRail, type DrawerMode } from "./components/LeftRail";
import { OverlayDrawers } from "./components/OverlayDrawers";
import { TopControls } from "./components/TopControls";
import { usePersistentWorkspace } from "./usePersistentWorkspace";
import { compactObjectList, getSuggestionsForSelection, type Suggestion } from "./workspaceUi";
import type { FocusArea } from "./tldraw/MorphoCanvas";

const MorphoCanvas = dynamic(() => import("./tldraw/MorphoCanvas").then((mod) => mod.MorphoCanvas), {
  ssr: false,
  loading: () => <div className="workspace-canvas" aria-label="画布正在加载" />
});

type FocusRequest = {
  area: FocusArea;
  nonce: number;
};

type WorkspaceClientProps = {
  projectId: string;
};

export function WorkspaceClient({ projectId }: WorkspaceClientProps) {
  const [workspace, setWorkspace, persistenceState] = usePersistentWorkspace(projectId);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>(() => workspace.ui.lastSelectionIds);
  const [aiDraft, setAiDraft] = useState("");
  const [aiOpen, setAiOpen] = useState(true);
  const [activeDrawer, setActiveDrawer] = useState<DrawerMode>(null);
  const [localEditObjectId, setLocalEditObjectId] = useState<string | null>(null);
  const [showReferenceConfirm, setShowReferenceConfirm] = useState(false);
  const [showFailure, setShowFailure] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest>({ area: "visual", nonce: 0 });

  const selectedObjects = useMemo(
    () => compactObjectList(workspace.objects, selectedObjectIds),
    [selectedObjectIds, workspace.objects]
  );

  const suggestions = useMemo(() => getSuggestionsForSelection(selectedObjects), [selectedObjects]);
  const aiContext = useMemo(
    () =>
      assembleAiContext(workspace, {
        draft: aiDraft,
        selectedObjectIds,
        explicitObjectIds: [],
        task: "visualDevelopment"
      }),
    [aiDraft, selectedObjectIds, workspace]
  );

  const focusArea = useCallback((area: FocusArea) => {
    setFocusRequest((current) => ({ area, nonce: current.nonce + 1 }));
    setActiveDrawer(null);
  }, []);

  const handleInstancesChange = useCallback(
    (instances: CanvasInstance[]) => {
      setWorkspace((current) => updateWorkspaceInstances(current, instances));
    },
    [setWorkspace]
  );

  const handleSuggestionClick = useCallback(
    (suggestion: Suggestion) => {
      const result = createAiDraftFromSuggestion(workspace, {
        selectedObjectIds,
        suggestion: suggestion.prompt
      });
      setAiDraft(result.draft);

      if (suggestion.label === "局部修改" && selectedObjects[0]?.type === "image") {
        setLocalEditObjectId(selectedObjects[0].id);
        setShowFailure(true);
      }

      if (suggestion.label === "设为后续默认参考") {
        setShowReferenceConfirm(true);
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
    setShowFailure(true);
    setAiDraft("保留整体比例与柔光轨道语言，把转角连接件做得更一体化、少一些外露五金感。");
  }, [selectedObjects]);

  const handleRunLocalEdit = useCallback(() => {
    if (!localEditObjectId) {
      return;
    }

    setWorkspace((current) => addLocalModificationVariants(current, localEditObjectId));
    setShowFailure(false);
    setLocalEditObjectId(null);
    setAiDraft("");
  }, [localEditObjectId, setWorkspace]);

  const handleReferenceIntent = useCallback(() => {
    setAiOpen(true);
    setShowReferenceConfirm(true);
  }, []);

  const handleReferenceConfirm = useCallback(() => {
    const target = selectedObjects.find((object) => object.type === "image");
    if (target) {
      setWorkspace((current) =>
        setDefaultReference(current, target.id, {
          reason: "用户在默认参考确认卡中明确替换后续默认参考。"
        })
      );
    }

    setShowReferenceConfirm(false);
    setAiDraft("");
  }, [selectedObjects, setWorkspace]);

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
      focusArea("overview");
    },
    [focusArea, setWorkspace]
  );

  const handleDeleteSelected = useCallback(() => {
    if (!selectedObjects[0]) {
      return;
    }

    const objectId = selectedObjects[0].id;
    setWorkspace((current) => {
      const result = deleteObject(current, objectId);
      if (result.status === "updated") {
        return result.workspace;
      }

      const shouldDelete =
        typeof window !== "undefined" &&
        window.confirm(`删除会移除实时关系，但不会改写已存在的交付引用快照。\n\n${result.reasons.join("\n")}`);

      if (!shouldDelete) {
        return current;
      }

      const confirmed = deleteObject(current, objectId, {
        confirmed: true,
        reason: "用户确认删除该对象。"
      });

      return confirmed.workspace;
    });
    setSelectedObjectIds((current) => current.filter((selectedId) => selectedId !== objectId));
    setLocalEditObjectId((current) => (current === objectId ? null : current));
  }, [selectedObjects, setWorkspace]);

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
        focusRequest={focusRequest}
        onSelectionChange={setSelectedObjectIds}
        onInstancesChange={handleInstancesChange}
      />

      <TopControls
        projectTitle={workspace.project.title}
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
      />

      <AiConversationPanel
        workspace={workspace}
        selectedObjects={selectedObjects}
        suggestions={suggestions}
        draft={aiDraft}
        isOpen={aiOpen}
        isLocalEditMode={Boolean(localEditObjectId)}
        showReferenceConfirm={showReferenceConfirm}
        showFailure={showFailure}
        contextWarning={
          aiContext.defaultReferenceStatus.status === "hidden" ? aiContext.defaultReferenceStatus.message : undefined
        }
        migrationError={persistenceState.migrationError}
        onToggleOpen={() => setAiOpen((open) => !open)}
        onDraftChange={setAiDraft}
        onSuggestionClick={handleSuggestionClick}
        onRunLocalEdit={handleRunLocalEdit}
        onReferenceConfirm={handleReferenceConfirm}
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
