"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { AiTaskMode, AiWorkIntent, MorphoWorkspace } from "@/domain/morpho/types";
import type { ArtifactProposal } from "@/domain/operations/types";
import { buildProposalDiscussionDraft, buildProposalRegenerationDraft } from "./proposalFollowupPrompts";
import type { WorkspaceCommitTransform } from "./workspaceCommitBoundary";
import {
  applyArtifactProposalWorkflow,
  rejectArtifactProposalWorkflow,
  type ConceptDirectionProposalDraftInput,
  type DesignDefinitionProposalDraftInput,
  type ProposalApplyWorkflowOptions,
  type ResearchProposalDraftInput,
  updateArtifactProposalDraft
} from "./workspaceProposalWorkflow";

type ProposalWorkflowSession = Readonly<{
  projectId: string;
  workspaceReady: boolean;
  generation: symbol;
}>;

type ActiveProposalState = Readonly<{
  session: ProposalWorkflowSession;
  proposalId: string;
}>;

type CommitValue<T> =
  | {
      committed: true;
      result: T;
    }
  | {
      committed: false;
    };

export type UseWorkspaceProposalWorkflowControllerInput = Readonly<{
  projectId: string;
  workspace: MorphoWorkspace;
  workspaceReady: boolean;
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  setSelectedObjectIds: Dispatch<SetStateAction<string[]>>;
  requestObjectFocus: (objectId: string) => void;
  openProposalDetail: (proposalId: string) => void;
  closeProposalDetail: () => void;
  closeProposalDetailIf: (objectIds: string[]) => void;
  openAiPanel: () => void;
  setAiDraft: (draft: string) => void;
  setTaskMode: (taskMode: AiTaskMode) => void;
  setWorkIntent: (workIntent: AiWorkIntent) => void;
}>;

export type WorkspaceProposalWorkflowController = Readonly<{
  activeProposal?: ArtifactProposal;
  activateProposal: (proposalId: string) => void;
  openProposal: (proposalId: string) => void;
  applyActiveProposal: (allowSourceChanged?: boolean) => void;
  applyProposal: (proposalId: string, options?: ProposalApplyWorkflowOptions) => void;
  rejectProposal: (proposalId: string, rejectedReason?: string) => void;
  rejectProposals: (proposalIds: string[], rejectedReason?: string) => void;
  saveResearchDraft: (proposalId: string, input: ResearchProposalDraftInput) => void;
  saveDesignDefinitionDraft: (proposalId: string, input: DesignDefinitionProposalDraftInput) => void;
  saveConceptDirectionDraft: (proposalId: string, input: ConceptDirectionProposalDraftInput) => void;
  continueDiscussion: (proposalId: string) => void;
  regenerate: (proposalId: string) => void;
  clearActiveProposalIf: (objectIds: string[]) => void;
}>;

export function useWorkspaceProposalWorkflowController({
  projectId,
  workspace,
  workspaceReady,
  commitWorkspace: commitWorkspaceInput,
  setSelectedObjectIds,
  requestObjectFocus,
  openProposalDetail,
  closeProposalDetail,
  closeProposalDetailIf,
  openAiPanel,
  setAiDraft,
  setTaskMode,
  setWorkIntent
}: UseWorkspaceProposalWorkflowControllerInput): WorkspaceProposalWorkflowController {
  const session = useMemo<ProposalWorkflowSession>(
    () => ({
      projectId,
      workspaceReady,
      generation: Symbol("workspace-proposal-session")
    }),
    [projectId, workspaceReady]
  );
  const currentSessionRef = useRef<ProposalWorkflowSession>(session);
  const latestWorkspaceRef = useRef<MorphoWorkspace>(workspace);
  const [activeProposalState, setActiveProposalState] = useState<ActiveProposalState | null>(null);

  useLayoutEffect(() => {
    currentSessionRef.current = session;
    latestWorkspaceRef.current = workspace;
  }, [session, workspace]);

  useEffect(() => {
    // A project/readiness transition invalidates the active Proposal attention; ordinary rerenders keep it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveProposalState((current) => (current?.session === session ? current : null));
  }, [session]);

  const isCurrentSession = useCallback((expectedSession: ProposalWorkflowSession): boolean => {
    const currentSession = currentSessionRef.current;
    return currentSession === expectedSession && expectedSession.workspaceReady;
  }, []);

  const commitWorkflow = useCallback(
    <T,>(
      expectedSession: ProposalWorkflowSession,
      transform: (current: MorphoWorkspace) => { workspace: MorphoWorkspace; value: T }
    ): T | undefined => {
      if (!isCurrentSession(expectedSession)) {
        return undefined;
      }

      const committed = commitWorkspaceInput<CommitValue<T>>((current) => {
        if (!isCurrentSession(expectedSession) || current.project.id !== expectedSession.projectId) {
          return {
            workspace: current,
            value: { committed: false }
          };
        }

        const result = transform(current);
        return {
          workspace: result.workspace,
          value: {
            committed: true,
            result: result.value
          }
        };
      });

      return committed.committed ? committed.result : undefined;
    },
    [commitWorkspaceInput, isCurrentSession]
  );

  const activateProposal = useCallback(
    (proposalId: string) => {
      if (!isCurrentSession(session)) {
        return;
      }
      setActiveProposalState({ session, proposalId });
    },
    [isCurrentSession, session]
  );

  const openProposal = useCallback(
    (proposalId: string) => {
      if (!isCurrentSession(session)) {
        return;
      }
      setActiveProposalState({ session, proposalId });
      openProposalDetail(proposalId);
    },
    [isCurrentSession, openProposalDetail, session]
  );

  const applyProposal = useCallback(
    (proposalId: string, options: ProposalApplyWorkflowOptions = {}) => {
      if (!isCurrentSession(session)) {
        return;
      }

      setActiveProposalState({ session, proposalId });
      const result = commitWorkflow(session, (current) => {
        const workflowResult = applyArtifactProposalWorkflow(current, proposalId, options);
        return {
          workspace: workflowResult.workspace,
          value: workflowResult
        };
      });
      if (!result) {
        return;
      }

      if (result.status === "unsupported") {
        return;
      }

      if (result.status === "blocked" && !result.shouldResetComposer) {
        setActiveProposalState((current) =>
          current?.session === session && current.proposalId === proposalId ? null : current
        );
        return;
      }

      setAiDraft("");
      setTaskMode("chatAnalysis");

      if (result.status === "blocked") {
        return;
      }

      setSelectedObjectIds(result.selectionObjectIds);
      if (result.focusObjectId) {
        requestObjectFocus(result.focusObjectId);
      }
      setActiveProposalState((current) =>
        current?.session === session && current.proposalId === proposalId ? null : current
      );
      closeProposalDetail();
    },
    [
      closeProposalDetail,
      commitWorkflow,
      isCurrentSession,
      requestObjectFocus,
      session,
      setAiDraft,
      setSelectedObjectIds,
      setTaskMode
    ]
  );

  const applyActiveProposal = useCallback(
    (allowSourceChanged = false) => {
      if (!activeProposalState || activeProposalState.session !== session) {
        return;
      }
      applyProposal(activeProposalState.proposalId, { allowSourceChanged });
    },
    [activeProposalState, applyProposal, session]
  );

  const rejectProposals = useCallback(
    (proposalIds: string[], rejectedReason = "用户明确放弃当前草案。") => {
      if (!isCurrentSession(session)) {
        return;
      }

      const uniqueProposalIds = [...new Set(proposalIds)];
      if (uniqueProposalIds.length === 0) {
        return;
      }

      const rejectedIds = commitWorkflow(session, (current) => {
        let nextWorkspace = current;
        const committedIds: string[] = [];
        for (const proposalId of uniqueProposalIds) {
          const workflowResult = rejectArtifactProposalWorkflow(nextWorkspace, proposalId, rejectedReason);
          if (workflowResult.status === "rejected") {
            nextWorkspace = workflowResult.workspace;
            committedIds.push(proposalId);
          }
        }
        return {
          workspace: nextWorkspace,
          value: committedIds
        };
      });
      if (!rejectedIds || rejectedIds.length === 0) {
        return;
      }

      setActiveProposalState((current) =>
        current?.session === session && rejectedIds.includes(current.proposalId) ? null : current
      );
      closeProposalDetailIf(rejectedIds);
      setSelectedObjectIds((current) => current.filter((selectedId) => !rejectedIds.includes(selectedId)));
    },
    [closeProposalDetailIf, commitWorkflow, isCurrentSession, session, setSelectedObjectIds]
  );

  const rejectProposal = useCallback(
    (proposalId: string, rejectedReason = "用户明确放弃当前草案。") => {
      rejectProposals([proposalId], rejectedReason);
    },
    [rejectProposals]
  );

  const saveDraft = useCallback(
    (update: Parameters<typeof updateArtifactProposalDraft>[1]) => {
      if (!isCurrentSession(session)) {
        return;
      }

      const committed = commitWorkflow(session, (current) => ({
        workspace: updateArtifactProposalDraft(current, update),
        value: true
      }));
      if (committed) {
        setActiveProposalState({ session, proposalId: update.proposalId });
      }
    },
    [commitWorkflow, isCurrentSession, session]
  );

  const saveResearchDraft = useCallback(
    (proposalId: string, input: ResearchProposalDraftInput) =>
      saveDraft({ type: "researchAnalysis", proposalId, input }),
    [saveDraft]
  );
  const saveDesignDefinitionDraft = useCallback(
    (proposalId: string, input: DesignDefinitionProposalDraftInput) =>
      saveDraft({ type: "designDefinition", proposalId, input }),
    [saveDraft]
  );
  const saveConceptDirectionDraft = useCallback(
    (proposalId: string, input: ConceptDirectionProposalDraftInput) =>
      saveDraft({ type: "conceptDirection", proposalId, input }),
    [saveDraft]
  );

  const continueDiscussion = useCallback(
    (proposalId: string) => {
      const proposal = getPendingProposal(latestWorkspaceRef.current, proposalId);
      if (!isCurrentSession(session) || !proposal) {
        return;
      }

      openAiPanel();
      setTaskMode("chatAnalysis");
      setWorkIntent(proposal.workIntent ?? "discussion");
      setActiveProposalState({ session, proposalId });
      setAiDraft(buildProposalDiscussionDraft(proposal));
    },
    [isCurrentSession, openAiPanel, session, setAiDraft, setTaskMode, setWorkIntent]
  );

  const regenerate = useCallback(
    (proposalId: string) => {
      const proposal = getPendingProposal(latestWorkspaceRef.current, proposalId);
      if (!isCurrentSession(session) || !proposal) {
        return;
      }

      openAiPanel();
      setTaskMode("chatAnalysis");
      setWorkIntent(proposal.workIntent ?? "discussion");
      setActiveProposalState({ session, proposalId });
      setAiDraft(buildProposalRegenerationDraft(proposal));
    },
    [isCurrentSession, openAiPanel, session, setAiDraft, setTaskMode, setWorkIntent]
  );

  const clearActiveProposalIf = useCallback(
    (objectIds: string[]) => {
      if (!isCurrentSession(session)) {
        return;
      }
      setActiveProposalState((current) =>
        current?.session === session && objectIds.includes(current.proposalId) ? null : current
      );
    },
    [isCurrentSession, session]
  );

  const activeProposal = useMemo(() => {
    if (
      !activeProposalState ||
      activeProposalState.session !== session ||
      !workspaceReady ||
      workspace.project.id !== projectId
    ) {
      return undefined;
    }

    const proposal = workspace.artifactProposals[activeProposalState.proposalId];
    return proposal?.status === "pending" ? proposal : undefined;
  }, [activeProposalState, projectId, session, workspace, workspaceReady]);

  return {
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
    regenerate,
    clearActiveProposalIf
  };
}

function getPendingProposal(workspace: MorphoWorkspace, proposalId: string): ArtifactProposal | undefined {
  const proposal = workspace.artifactProposals[proposalId];
  return proposal?.status === "pending" ? proposal : undefined;
}
