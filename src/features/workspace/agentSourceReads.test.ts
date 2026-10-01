import { describe, expect, it } from "vitest";
import { createTestWorkspace } from "@/domain/morpho/workspace";
import type { TurnTaskContract } from "@/shared/turnTaskContract";
import { readAgentWorkspaceSource, requirementCovered } from "./agentSourceReads";

function fixture() {
  const workspace = createTestWorkspace();
  const file = Object.values(workspace.objects).find((object) => object.type === "file")!;
  if (file.type !== "file") throw new Error("file fixture");
  file.parseStatus = "parsed"; file.extractedAssetId = "extract-p2b";
  workspace.assets[file.extractedAssetId] = { id: file.extractedAssetId, fileName: "extract.txt", mimeType: "text/plain", size: 10020, storageKey: "extract-p2b", sourceType: "documentExtract", createdAt: "2026-10-01T00:00:00Z" };
  const contract: TurnTaskContract = { version: 1, userGoal: "通读", primaryFocus: "discussion", execution: { taskMode: "chatAnalysis", taskModeSource: "userSelected", workIntent: "discussion", workIntentSource: "userSelected" }, requiredReads: [], completionConditions: [], activities: [{ id: "read", kind: "discussion", instruction: "通读", sourceObjectIds: [file.id], targetObjectIds: [], referenceObjectIds: [], excludedObjectIds: [], includeDefaultReference: false, requiredFacts: [], expectedOutputs: ["chatAnswer"], effectGrants: [] }] };
  const text = `  ${"文".repeat(10000)}  `;
  const input = { workspace, contract, callId: "read-1", generatedObjectIds: [], signal: new AbortController().signal, blobStore: { get: async () => new Blob([text]), put: async () => {}, delete: async () => {} } };
  return { file, input, text };
}

describe("bounded source reads and exact coverage", () => {
  it("invalidates current source coverage while retaining an explicit historical revision", async () => {
    const { input } = fixture();
    const workspace = input.workspace;
    const direction = Object.values(workspace.objects).find((object) => object.type === "conceptDirection")!;
    if (direction.type !== "conceptDirection") throw new Error("direction fixture");
    const revisionId = direction.currentRevisionId;
    const requirement = { tool: "read_workspace_source" as const, kind: "object" as const, objectId: direction.id };
    const result = await readAgentWorkspaceSource({ ...input, readableObjectIds: [direction.id], args: { kind: "object", objectId: direction.id } });
    const receipts = [{ ...result.receipt, delivered: true }];
    expect(requirementCovered(requirement, receipts, workspace)).toBe(true);
    const nextId = `${revisionId}-next`;
    workspace.directionRevisions[nextId] = { ...workspace.directionRevisions[revisionId]!, id: nextId, summary: "new current revision" };
    direction.currentRevisionId = nextId;
    expect(requirementCovered(requirement, receipts, workspace)).toBe(false);
    expect(requirementCovered({ ...requirement, revisionId }, receipts, workspace)).toBe(true);
    direction.visibility = "hidden";
    expect(requirementCovered({ ...requirement, revisionId }, receipts, workspace)).toBe(false);
  });

  it("bounds metadata reads without treating image metadata as pixels", async () => {
    const { input } = fixture();
    const image = Object.values(input.workspace.objects).find((object) => object.type === "image")!;
    image.summary = "metadata".repeat(2000);
    const activity = input.contract.activities[0]!;
    const contract = { ...input.contract, activities: [{ ...activity, sourceObjectIds: [image.id] }] };
    const result = await readAgentWorkspaceSource({ ...input, contract, args: { kind: "object", objectId: image.id } });
    expect(result.text).toHaveLength(8000);
    expect(result.receipt).toMatchObject({ status: "summary", representation: "metadata", range: { start: 0, end: 8000, nextStart: 8000 } });
    expect(requirementCovered({ tool: "read_workspace_source", kind: "image", objectId: image.id }, [{ ...result.receipt, delivered: true }])).toBe(false);
  });

  it("preserves UTF-16 offsets, next ranges and distinguishes a document from its extract availability", async () => {
    const { file, input, text } = fixture();
    const first = await readAgentWorkspaceSource({ ...input, args: { kind: "document", objectId: file.id, length: 2200 } });
    const second = await readAgentWorkspaceSource({ ...input, callId: "read-2", args: { kind: "document", objectId: file.id, start: 2200, length: 8000 } });
    expect(first.text).toBe(text.slice(0, 2200));
    expect(first.receipt).toMatchObject({ status: "partial", range: { start: 0, end: 2200, total: text.length, nextStart: 2200 }, delivered: false });
    const requirement = { tool: "read_workspace_source" as const, kind: "document" as const, objectId: file.id };
    expect(requirementCovered(requirement, [first.receipt, second.receipt])).toBe(false);
    expect(requirementCovered(requirement, [{ ...first.receipt, delivered: true }])).toBe(false);
    expect(requirementCovered(requirement, [first.receipt, second.receipt].map((receipt) => ({ ...receipt, delivered: true })))).toBe(true);
  });

  it("does not union ranges from different content, revisions or incarnations", async () => {
    const { file, input } = fixture();
    const first = (await readAgentWorkspaceSource({ ...input, args: { kind: "document", objectId: file.id, length: 2200 } })).receipt;
    const second = (await readAgentWorkspaceSource({ ...input, args: { kind: "document", objectId: file.id, start: 2200 } })).receipt;
    const requirement = { tool: "read_workspace_source" as const, kind: "document" as const, objectId: file.id };
    for (const key of ["fingerprint", "contentHash", "revisionId", "incarnationId", "assetId"] as const) expect(requirementCovered(requirement, [{ ...first, delivered: true }, { ...second, delivered: true, [key]: "different" }])).toBe(false);
  });

  it("keeps parser truncation partial even after the full available extract is read", async () => {
    const { file, input } = fixture(); file.extractionTruncated = true;
    const result = await readAgentWorkspaceSource({ ...input, args: { kind: "document", objectId: file.id, length: 8000 } });
    expect(result.receipt.extractionTruncated).toBe(true);
    expect(requirementCovered({ tool: "read_workspace_source", kind: "document", objectId: file.id }, [{ ...result.receipt, delivered: true, range: { start: 0, end: 10004, total: 10004 } }])).toBe(false);
    expect(requirementCovered({ tool: "read_workspace_source", kind: "document", objectId: file.id, start: 0, end: 8000 }, [{ ...result.receipt, delivered: true }])).toBe(true);
  });

  it("distinguishes missing, hidden, outside scope and missing Blob", async () => {
    const { file, input } = fixture();
    expect((await readAgentWorkspaceSource({ ...input, blobStore: { ...input.blobStore, get: async () => null }, args: { kind: "document", objectId: file.id } })).receipt.status).toBe("unavailable");
    file.visibility = "hidden";
    expect((await readAgentWorkspaceSource({ ...input, args: { kind: "document", objectId: file.id } })).receipt.status).toBe("unavailable");
    delete input.workspace.objects[file.id];
    expect((await readAgentWorkspaceSource({ ...input, args: { kind: "document", objectId: file.id } })).receipt.status).toBe("missing");
    expect((await readAgentWorkspaceSource({ ...input, args: { kind: "object", objectId: "outside" } })).receipt.status).toBe("unavailable");
  });

  it("requires exact memory keys and conversation keyword, not the Tool name", () => {
    const base = { id: "memory", source: "tool" as const, kind: "memory" as const, objectId: "project", status: "full" as const, delivered: true, keys: ["projectOverview"] };
    expect(requirementCovered({ tool: "read_project_memory", requiredKeys: ["designBrief"] }, [base])).toBe(false);
    expect(requirementCovered({ tool: "search_project_conversation", requiredMode: "keyword", keyword: "budget" }, [{ ...base, kind: "conversation", query: { mode: "keyword", keyword: "budgetplus" } }])).toBe(false);
  });
});
