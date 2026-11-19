import { mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { importAssetBackedObjects, importTextObject } from "@/domain/morpho/imports";
import { attachDocumentExtractToFileObject } from "@/domain/morpho/workspace";
import { parseWorkspace } from "@/domain/morpho/workspaceCodec";
import { parseMorphoAgentToolArguments } from "@/features/workspace/morphoAgent";
import { buildMorphoAgentTools } from "@/shared/agentToolContract";
import { runAgentLab } from "../../../scripts/agent-lab/run";
import selectedSource from "../../../scripts/agent-lab/selected-source.json";
import { AGENT_LAB_HEADER, agentLabProfileId, loadAgentLabProfile, resolveAgentLabRequest } from "./agentLabProfile";

const fixtureDirectory = resolve("scripts/agent-lab");
const baseline = join(fixtureDirectory, "baseline.json");
const variant = join(fixtureDirectory, "variant.json");
const defaultTask = join(fixtureDirectory, "selected-source.json");
const root = mkdtempSync(join(tmpdir(), "morpho-agent-lab-test-"));

afterAll(() => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      for (const file of readdirSync(path)) rmSync(join(path, file));
      rmdirSync(path);
    } else rmSync(path);
  }
  rmdirSync(root);
});

function writeFixture(name: string, value: unknown) {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function scriptedTask(name: string, args: Record<string, unknown>, tool = "read_workspace_source", workspace = join(fixtureDirectory, "workspace.json")) {
  return writeFixture(name, {
    ...selectedSource,
    workspace,
    responses: [{ calls: [{ name: tool, args }] }, selectedSource.responses[1]]
  });
}

function loadWorkspace() {
  const result = parseWorkspace(readFileSync(join(fixtureDirectory, "workspace.json"), "utf8"));
  if (result.status !== "ok") throw new Error(result.reason);
  return result.workspace;
}

describe("Agent Lab", () => {
  it("assembles two profiles against the same fixture and executes the read and continuation through A+", async () => {
    const run = (profile: string) => runAgentLab({ mode: "scripted", profile, task: defaultTask, outputRoot: root });
    const a = (await run(baseline)).record;
    const b = (await run(variant)).record;
    const preview = (await runAgentLab({ mode: "preview", profile: variant, task: defaultTask, outputRoot: root })).record;
    expect(a.initialWorkspaceSha256).toBe(b.initialWorkspaceSha256);
    expect(a.profileId).not.toBe(b.profileId);
    for (const record of [a, b]) {
      expect(record).toMatchObject({
        providerRequests: 2, providerAttempts: 2, toolCalls: 1, cost: null, serverStatus: "externallyCompleted",
        final: { outcome: "success", text: selectedSource.responses[1].text }
      });
      expect(record.toolResults[0]).toMatchObject({ terminal: { status: "executed", localEffect: "none" },
        output: { output: expect.stringContaining("不得依赖重新布线") } });
      expect(record.usageByStep.map(({ usage }) => usage)).toEqual([
        { inputTokens: 160, outputTokens: 18, totalTokens: 178 },
        { inputTokens: 250, outputTokens: 20, totalTokens: 270 }
      ]);
      const continuation = JSON.stringify(record.steps[1]);
      expect(continuation).toContain("function_call_output");
      expect(continuation).toContain("不得依赖重新布线");
      expect(JSON.stringify(record.steps[0])).toContain("reasoning-delta");
    }
    expect(JSON.stringify(a.steps[0])).not.toContain("本地调试示例");
    expect(JSON.stringify(a.steps[0])).toContain('"name":"read_selected_context"');
    expect(JSON.stringify(b.steps[0])).toContain("本地调试示例");
    expect(JSON.stringify(b.steps[0])).not.toContain('"name":"read_selected_context"');
    expect(preview.providerAttempts).toBe(0);
    expect(preview.preview).toMatchObject({ methodPackIds: ["researchSynthesis"], body: {
      reasoning: { effort: "low" }, tools: [{ name: "read_workspace_source" }]
    } });
    expect(JSON.stringify(preview.preview)).toContain("保留一条能在选中资料里定位的事实");
    expect(JSON.stringify(b.steps[0])).toContain("根据本轮选中的项目资料回答");
  });

  it("retains validated arguments in the read Tool's advertised schema and prevents invalid execution", async () => {
    const tool = buildMorphoAgentTools(true, true).find((tool) => tool.type === "function" && tool.name === "read_workspace_source");
    expect(tool).toMatchObject({ parameters: { additionalProperties: false, required: ["kind", "objectId"],
      properties: { length: { type: "integer", minimum: 1, maximum: 8000 } } } });
    const args = { kind: "object", objectId: "text-import", length: 0 };
    expect(() => parseMorphoAgentToolArguments({ id: "item", callId: "call", name: "read_workspace_source",
      argumentsText: JSON.stringify(args) })).toThrow("length");
    const { record } = await runAgentLab({ mode: "scripted", profile: variant,
      task: scriptedTask("invalid.json", args), outputRoot: root });
    expect(record.toolResults[0]).toMatchObject({ terminal: { status: "failed" },
      output: { output: expect.stringContaining("invalid_tool_arguments") } });
    expect(JSON.stringify(record.toolResults)).not.toContain("不得依赖重新布线");
  });

  it("keeps source scope and the exposed Tool subset effective after the model responds", async () => {
    const other = importTextObject(loadWorkspace(), { text: "Unselected fixture evidence", position: { x: 500, y: 0 } });
    const workspace = writeFixture("other-workspace.json", other.workspace);
    const outOfScope = await runAgentLab({ mode: "scripted", profile: variant, outputRoot: root,
      task: scriptedTask("outside-scope.json", { kind: "object", objectId: other.objectIds[0] }, "read_workspace_source", workspace) });
    expect(outOfScope.record.toolResults[0]).toMatchObject({ output: { output: expect.stringContaining("目标不在本轮读取范围") } });
    expect(JSON.stringify(outOfScope.record.toolResults)).not.toContain("Unselected fixture evidence");
    const unexposed = await runAgentLab({ mode: "scripted", profile: variant, outputRoot: root,
      task: scriptedTask("unexposed.json", {}, "read_selected_context") });
    expect(unexposed.record.providerAttempts).toBe(1);
    expect(unexposed.record.toolCalls).toBe(1);
    expect(unexposed.record.toolResults).toEqual([]);
    expect(unexposed.record.serverStatus).toBe("externallyFailed");
    expect(JSON.stringify(unexposed.record.steps[0])).toContain("agent_lab_unexposed_tool");
  });

  it("reports sent and missing fixture pixels across preview and continuation without logging the image data", async () => {
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAIAAAUAAYoz4wAAAAAASUVORK5CYII=", "base64");
    writeFileSync(join(root, "pixel.png"), bytes);
    const { workspace, objectIds } = importAssetBackedObjects(loadWorkspace(), { position: { x: 500, y: 0 },
      assets: [{
        id: "lab-pixel", mimeType: "image/png", fileName: "pixel.png", size: bytes.length,
        storageKey: "lab-pixel", createdAt: "2026-11-19T00:00:00.000Z", sourceType: "originalImage"
      }]
    });
    const path = writeFixture("image-workspace.json", workspace);
    const task = { ...selectedSource, workspace: path, selectedObjectIds: [...selectedSource.selectedObjectIds, ...objectIds] };
    const withImage = await runAgentLab({ mode: "scripted", profile: variant, outputRoot: root,
      task: writeFixture("with-image.json", { ...task, assetFiles: { "lab-pixel": "pixel.png" } }) });
    const imageDigest = withImage.record.fixtureAssets[0].sha256;
    expect(withImage.record.providerAttempts).toBe(2);
    for (const step of withImage.record.steps) expect(JSON.stringify(step)).toContain(imageDigest);
    expect(JSON.stringify(withImage.record)).not.toContain(bytes.toString("base64"));
    const withoutImage = await runAgentLab({ mode: "preview", profile: variant, outputRoot: root,
      task: writeFixture("without-image.json", task) });
    expect(JSON.stringify(withoutImage.record.preview)).not.toContain('"type":"input_image"');
    expect(JSON.stringify(withoutImage.record.providerInputs)).toContain('"representation":"metadata"');
  });

  it("materializes the same fixture document through preparation and the scoped read Tool", async () => {
    const text = "调试文件中的明确要求是避免大型固定件。";
    writeFileSync(join(root, "extract.txt"), text);
    const createdAt = "2026-11-19T00:00:00.000Z";
    const imported = importAssetBackedObjects(loadWorkspace(), { position: { x: 500, y: 0 }, assets: [{
      id: "lab-file", fileName: "source.pdf", mimeType: "application/pdf", size: 10, storageKey: "lab-file",
      createdAt, sourceType: "originalFile"
    }] });
    const fileObjectId = imported.objectIds[0];
    const workspace = attachDocumentExtractToFileObject(imported.workspace, {
      fileObjectId, extractedCharCount: text.length, parsedAt: createdAt,
      extractAsset: {
        id: "lab-extract", fileName: "extract.txt", mimeType: "text/plain", size: Buffer.byteLength(text),
        storageKey: "lab-extract", createdAt, sourceType: "documentExtract"
      }
    });
    const task = writeFixture("document.json", {
      ...selectedSource, workspace: writeFixture("document-workspace.json", workspace),
      selectedObjectIds: [fileObjectId], assetFiles: { "lab-extract": "extract.txt" },
      responses: [{ calls: [{ name: "read_workspace_source", args: { kind: "document", objectId: fileObjectId } }] },
        { text: "避免大型固定件。" }]
    });
    const { record } = await runAgentLab({ mode: "scripted", profile: variant, outputRoot: root, task });
    expect(JSON.stringify(record.steps[0])).toContain(text);
    expect(record.toolResults[0]).toMatchObject({ terminal: { status: "executed" }, output: { output: expect.stringContaining(text) } });
    expect(record.final?.outcome).toBe("success");
  });

  it("requires the trusted profile and loopback opt-in, and rejects paid Tools in the profile", async () => {
    const profile = await loadAgentLabProfile(variant);
    const headers = { [AGENT_LAB_HEADER]: agentLabProfileId(profile) };
    const env = { NODE_ENV: "development", MORPHO_ALLOW_PAID_SMOKE_TESTS: "true", MORPHO_AGENT_LAB_PROFILE: variant } as const;
    const request = new Request("http://127.0.0.1:3000/api/ai/agent/turns", { headers });
    expect(await resolveAgentLabRequest(request, env)).toEqual(profile);
    expect(await resolveAgentLabRequest(request, { ...env, NODE_ENV: "production" })).toMatchObject({ status: 404 });
    expect(await resolveAgentLabRequest(request, { ...env, MORPHO_ALLOW_PAID_SMOKE_TESTS: "false" })).toMatchObject({ status: 404 });
    expect(await resolveAgentLabRequest(new Request("https://morpho.example/api/ai/agent/turns", { headers }), env))
      .toMatchObject({ status: 404 });
    expect(await resolveAgentLabRequest(request, { ...env, MORPHO_AGENT_LAB_PROFILE: baseline })).toMatchObject({ status: 409 });
    await expect(loadAgentLabProfile(writeFixture("paid-tools.json", { name: "paid", tools: ["generate_visuals"] })))
      .rejects.toThrow("registered tool with no external execution");
  });
});
