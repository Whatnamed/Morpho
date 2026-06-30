import { describe, expect, it } from "vitest";

import { createInitialWorkspace, hideObject } from "../../domain/morpho/workspace";
import { buildTaskContext } from "./taskContext";
import { applyConversationSemanticPatchFromReply } from "./workspaceSemanticPatch";

const draft = "Keep the night light warm and do not make it look medical.";

describe("workspace conversation semantic patch helpers", () => {
  it("strips semantic JSON, writes authorized entries, and ignores provider summary", () => {
    const workspace = createInitialWorkspace();
    const context = buildTaskContext(workspace, {
      kind: "general",
      draft,
      selectedObjectIds: []
    });
    const userMessageId = "ai-user-semantic-client-1";
    const userMessageCreatedAt = "2026-06-30T11:00:00.000Z";
    const workspaceWithMessage = {
      ...workspace,
      ai: {
        ...workspace.ai,
        messages: [
          ...workspace.ai.messages,
          {
            id: userMessageId,
            role: "user" as const,
            body: draft,
            createdAt: userMessageCreatedAt,
            taskMode: "chatAnalysis" as const
          }
        ]
      }
    };
    const reply = [
      "Noted. I will keep that as a project-level preference.",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "preference",
              scope: "project",
              summary: "The provider must not write this long-term summary.",
              evidenceQuote: "Keep the night light warm",
              relatedObjectIds: [],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            }
          ]
        }
      }),
      "```"
    ].join("\n");

    const result = applyConversationSemanticPatchFromReply({
      workspace: workspaceWithMessage,
      taskMode: "chatAnalysis",
      context,
      draft,
      userMessageId,
      userMessageCreatedAt,
      assistantText: reply
    });

    expect(result.status).toBe("applied");
    expect(result.visibleBody).toBe("Noted. I will keep that as a project-level preference.");
    expect(result.visibleBody).not.toContain("morphoProjectContinuityPatch");
    if (result.status !== "applied") {
      throw new Error(result.reason);
    }
    const entry = result.workspace.projectContinuity.recordEntries.find((candidate) => candidate.id === result.entryIds[0]);

    expect(entry).toMatchObject({
      origin: "conversationSemanticPatch",
      manualState: "active",
      semanticKind: "preference",
      sourceMessageId: userMessageId,
      evidenceQuote: "Keep the night light warm"
    });
    expect(entry?.summary).not.toContain("provider");
    expect(entry?.sourceRefs).toContainEqual(
      expect.objectContaining({
        kind: "message",
        id: userMessageId,
        sourceAvailability: "active",
        snapshot: expect.objectContaining({ summarySnippet: "Keep the night light warm" })
      })
    );
  });

  it("does not write semantic entries when a proposal is present in the same reply", () => {
    const workspace = createInitialWorkspace();
    const context = buildTaskContext(workspace, {
      kind: "designDefinition",
      draft,
      selectedObjectIds: []
    });
    const reply = [
      "Here is the draft.",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "preference",
              scope: "project",
              evidenceQuote: "Keep the night light warm",
              relatedObjectIds: [],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            }
          ]
        }
      }),
      "```",
      "```json",
      JSON.stringify({
        morphoDesignDefinitionProposal: {
          title: "Definition draft",
          summary: "Draft summary",
          projectGoal: "Goal",
          coreProblem: "Problem",
          designPrinciples: ["Principle"]
        }
      }),
      "```"
    ].join("\n");

    const result = applyConversationSemanticPatchFromReply({
      workspace,
      taskMode: "chatAnalysis",
      context,
      draft,
      userMessageId: "ai-user-semantic-client-2",
      userMessageCreatedAt: "2026-06-30T11:01:00.000Z",
      assistantText: reply,
      blockWhenProposalPresent: true
    });

    expect(result.status).toBe("skipped");
    expect(result.visibleBody).not.toContain("morphoProjectContinuityPatch");
    expect(result.visibleBody).toContain("morphoDesignDefinitionProposal");
    expect(result.workspace.projectContinuity.recordEntries).toEqual(workspace.projectContinuity.recordEntries);
  });

  it("does not authorize hidden selected objects as new active semantic sources", () => {
    const workspace = hideObject(createInitialWorkspace(), "image-soft-rail-v2");
    const context = buildTaskContext(workspace, {
      kind: "visualDevelopment",
      draft,
      selectedObjectIds: ["image-soft-rail-v2"]
    });
    const reply = [
      "Noted for this image.",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "avoidance",
              scope: "visual",
              evidenceQuote: "do not make it look medical",
              relatedObjectIds: ["image-soft-rail-v2"],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            }
          ]
        }
      }),
      "```"
    ].join("\n");

    const result = applyConversationSemanticPatchFromReply({
      workspace,
      taskMode: "chatAnalysis",
      context,
      draft,
      userMessageId: "ai-user-semantic-hidden",
      userMessageCreatedAt: "2026-06-30T11:01:30.000Z",
      assistantText: reply
    });

    expect(context.objectIds).not.toContain("image-soft-rail-v2");
    expect(result.status).toBe("skipped");
    expect(result.workspace.projectContinuity.recordEntries).toEqual(workspace.projectContinuity.recordEntries);
  });

  it("skips image-generation replies even when a semantic patch block appears", () => {
    const workspace = createInitialWorkspace();
    const context = buildTaskContext(workspace, {
      kind: "visualDevelopment",
      draft,
      selectedObjectIds: []
    });
    const reply = [
      "Image plan complete.",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "avoidance",
              scope: "project",
              evidenceQuote: "do not make it look medical",
              relatedObjectIds: [],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            }
          ]
        }
      }),
      "```"
    ].join("\n");

    const result = applyConversationSemanticPatchFromReply({
      workspace,
      taskMode: "imageGeneration",
      context,
      draft,
      userMessageId: "ai-user-semantic-client-3",
      userMessageCreatedAt: "2026-06-30T11:02:00.000Z",
      assistantText: reply
    });

    expect(result.status).toBe("skipped");
    expect(result.visibleBody).toBe("Image plan complete.");
    expect(result.workspace.projectContinuity.recordEntries).toEqual(workspace.projectContinuity.recordEntries);
  });

  it("allows research-operation semantic patches when no research proposal is applied", () => {
    const workspace = createInitialWorkspace();
    const context = buildTaskContext(workspace, {
      kind: "research",
      draft,
      selectedObjectIds: []
    });
    const reply = [
      "I need one more source before creating a research card.",
      "```json",
      JSON.stringify({
        morphoProjectContinuityPatch: {
          items: [
            {
              kind: "openQuestion",
              scope: "project",
              evidenceQuote: "do not make it look medical",
              relatedObjectIds: [],
              relatedRevisionIds: [],
              relatedDecisionIds: []
            }
          ]
        }
      }),
      "```"
    ].join("\n");

    const result = applyConversationSemanticPatchFromReply({
      workspace,
      taskMode: "researchOperation",
      context,
      draft,
      userMessageId: "ai-user-semantic-client-4",
      userMessageCreatedAt: "2026-06-30T11:03:00.000Z",
      assistantText: reply
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      throw new Error(result.reason);
    }
    expect(result.workspace.projectContinuity.recordEntries.find((entry) => entry.id === result.entryIds[0])).toMatchObject({
      semanticKind: "openQuestion",
      origin: "conversationSemanticPatch"
    });
  });
});
