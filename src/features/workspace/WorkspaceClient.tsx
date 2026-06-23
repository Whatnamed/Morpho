"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";

import {
  addLocalModificationVariants,
  createAiDraftFromSuggestion
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

export function WorkspaceClient() {
  const [workspace, setWorkspace] = usePersistentWorkspace();
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>(["image-soft-rail-v2"]);
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
    setShowReferenceConfirm(false);
    setAiDraft("");
  }, []);

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
        onAskAi={handleAskAi}
        onLocalEdit={handleLocalEdit}
        onReferenceIntent={handleReferenceIntent}
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
