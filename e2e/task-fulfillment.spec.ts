import { expect, test } from "@playwright/test";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import type { APlusAgentProviderRequest } from "@/shared/agentTurnJournalProtocol";
import { seedProject, readStoredWorkspace } from "./fixtures/seed";
import { agentCalls, installAgentMock, setAgentRequestScript, setAgentResponse } from "./fixtures/agentMock";
import { textAnswerScript, toolCallTurnScript } from "./support/agentSse";

declare global { interface Window { __p2bImageCalls?: number } }

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFh0AAAAASUVORK5CYII=";

test("terminal missing reads remain unverified through persistence and reload without another request", async ({ page }) => {
  const seed = await seedProject(page);
  await installAgentMock(page);
  await page.goto(`/projects/${seed.seedProjectId}`);
  await setAgentResponse(page, { kind: "stream", chunks: textAnswerScript({ text: "我已核实项目当前设计原则。" }).chunks });
  await page.locator(".ai-panel textarea").fill("读取当前设计原则后回答");
  await page.locator('[aria-label="发送"]').click();
  await expect(page.locator(".ai-panel")).toContainText("指定来源尚未完整核实");
  const requests = (await agentCalls(page)).filter((call) => call.url.endsWith("/requests") && call.method === "POST");
  expect(requests).toHaveLength(1);
  const read = () => page.evaluate((key) => (JSON.parse(localStorage.getItem(key)!) as MorphoWorkspace).ai.messages.filter((message) => message.role === "assistant").at(-1), seed.workspaceKey);
  await expect.poll(async () => (await read())?.taskFulfillment?.status).toBe("partial");
  expect((await read())?.agentTurnOutcome).toBe("success");
  await page.reload();
  await expect(page.locator(".ai-panel")).toContainText("指定来源尚未完整核实");
  expect((await read())?.taskFulfillment?.status).toBe("partial");
});

test("bounded document reads use the actual IndexedDB extract and survive reload", async ({ page }) => {
  const seed = await seedProject(page);
  await installAgentMock(page);
  await page.goto("/");
  const fileId = await page.evaluate(async (key) => {
    const workspace = JSON.parse(localStorage.getItem(key)!) as MorphoWorkspace;
    const file: import("@/domain/morpho/types").FileObject = { id: "p2b-document", incarnationId: "p2b-document-identity", type: "file", fileKind: "document", sourceLabel: "本地测试资料", title: "P2B 文档", summary: "浏览器范围读取验收", createdBy: "user", visibility: "active", assetId: "p2b-original", fileName: "p2b.txt", parseStatus: "unparsed" };
    workspace.objects[file.id] = file;
    workspace.assets["p2b-original"] = { id: "p2b-original", fileName: "p2b.txt", mimeType: "text/plain", size: 27000, storageKey: "p2b-original", sourceType: "originalFile", createdAt: new Date().toISOString() };
    workspace.canvas.instances.push({ id: "canvas-p2b-document", objectId: file.id, position: { x: 200, y: 200 }, size: { w: 240, h: 180 } });
    file.parseStatus = "parsed"; file.extractedAssetId = "p2b-extract"; file.extractedCharCount = 9000;
    workspace.assets[file.extractedAssetId] = { id: file.extractedAssetId, fileName: "p2b.txt", mimeType: "text/plain", size: 27000, storageKey: "p2b-extract", sourceType: "documentExtract", createdAt: new Date().toISOString() };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("morpho-assets-v1", 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("asset-blobs")) request.result.createObjectStore("asset-blobs"); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("asset-blobs", "readwrite");
      transaction.objectStore("asset-blobs").put(new Blob(["文".repeat(9000)], { type: "text/plain" }), "p2b-extract");
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
    db.close(); workspace.ui.lastSelectionIds = [file.id];
    localStorage.setItem(key, JSON.stringify(workspace)); return file.id;
  }, seed.workspaceKey);
  await page.goto(`/projects/${seed.seedProjectId}`);
  const script = toolCallTurnScript({ toolName: "read_workspace_source", argumentsText: JSON.stringify({ kind: "document", objectId: fileId, start: 2200, length: 6800 }), finalText: "已读取整份提取文本。" });
  await setAgentRequestScript(page, [{ kind: "stream", chunks: script.first }, { kind: "stream", chunks: script.second }]);
  await page.locator(".ai-panel textarea").fill("通读整份文档后回答");
  await page.locator('[aria-label="发送"]').click();
  await expect(page.locator(".ai-panel")).toContainText("已读取整份提取文本。");
  const read = () => page.evaluate((key) => (JSON.parse(localStorage.getItem(key)!) as MorphoWorkspace).ai.messages.filter((message) => message.role === "assistant").at(-1)?.taskFulfillment, seed.workspaceKey);
  await expect.poll(async () => (await read())?.status).toBe("fulfilled");
  expect((await read())?.reads).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "document", source: "request", status: "partial", range: { start: 0, end: 2200, total: 9000, nextStart: 2200 } }), expect.objectContaining({ kind: "document", source: "tool", delivered: true, range: { start: 2200, end: 9000, total: 9000 } })]));
  await page.reload(); expect((await read())?.status).toBe("fulfilled");
});

test("generates two persisted images then observes their actual pixels with no extra image effect", async ({ page }) => {
  const seed = await seedProject(page);
  await installAgentMock(page);
  await page.addInitScript((base64) => {
    const previous = window.fetch.bind(window);
    window.__p2bImageCalls = 0;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/actions/image") && init?.method === "POST") { window.__p2bImageCalls! += 1; return new Response(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)), { headers: { "content-type": "image/png" } }); }
      // The simulated model learns generated IDs solely from the production
      // Runner's real Tool results, never from hidden test-side reference IDs.
      if (url.endsWith("/requests") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { stepSequence: number; providerRequest: APlusAgentProviderRequest };
        const result = body.providerRequest.continuationItems?.find((item) => item.type === "function_call_output" && item.callId === "p2b-generation");
        if (result?.type === "function_call_output" && body.stepSequence < 4) {
          const ids = (JSON.parse(result.output) as { objectIds: string[] }).objectIds;
          const response = window.__morphoAgentMock?.requestScript?.queue[0];
          if (response?.kind === "stream") response.chunks = response.chunks.map((chunk) => chunk.replaceAll("__generated__", ids[body.stepSequence - 2]!));
        }
      }
      return previous(input, init);
    };
  }, pixel);
  await page.goto("/");
  const baseline = await page.evaluate((key) => {
    const workspace = JSON.parse(localStorage.getItem(key)!) as MorphoWorkspace;
    workspace.ui.lastSelectionIds = []; workspace.workingState.currentDefaultReferenceId = undefined;
    for (const object of Object.values(workspace.objects)) if (object.type === "image") object.isDefaultReference = false;
    localStorage.setItem(key, JSON.stringify(workspace));
    return { ids: Object.keys(workspace.objects), primary: workspace.workingState.primaryDirectionId, compare: Object.keys(workspace.ai.comparisonAnalyses ?? {}) };
  }, seed.workspaceKey);
  await page.goto(`/projects/${seed.seedProjectId}`);
  const generation = toolCallTurnScript({ toolName: "generate_visuals", argumentsText: JSON.stringify({ kind: "visualDevelopment", items: [1, 2].map((id) => ({ id: `result-${id}`, title: `结果 ${id}`, purpose: "概念探索", requestedReferenceObjectIds: [], changeGoals: [], preserve: [], allowToChange: [], productForm: [], materialsAndCmf: [], environmentAndLighting: [], avoid: [], role: "conceptImage" })) }) });
  const observation = toolCallTurnScript({ toolName: "read_workspace_source", argumentsText: JSON.stringify({ kind: "image", objectId: "__generated__" }), finalText: "已观察两张新图的实际像素。" });
  const renamed = (chunks: string[], id: string) => chunks.map((chunk) => chunk.replaceAll("call-e2e-tool-1", id));
  await setAgentRequestScript(page, [{ kind: "stream", chunks: renamed(generation.first, "p2b-generation") }, { kind: "stream", chunks: renamed(observation.first, "observe-1") }, { kind: "stream", chunks: renamed(observation.first, "observe-2") }, { kind: "stream", chunks: observation.second }]);
  await page.locator(".ai-panel textarea").fill("生成两张图后再评价新生成的图");
  await page.getByRole("button", { name: "本轮允许生图", exact: true }).click();
  await page.locator('[aria-label="发送"]').click();
  await expect(page.locator(".ai-panel")).toContainText("已观察两张新图的实际像素。", { timeout: 30000 });
  await expect.poll(async () => page.evaluate((key) => (JSON.parse(localStorage.getItem(key)!) as MorphoWorkspace).ai.messages.filter((message) => message.role === "assistant").at(-1)?.taskFulfillment?.status, seed.workspaceKey)).toBe("fulfilled");
  const requests = (await agentCalls(page)).filter((call) => call.url.endsWith("/requests") && call.method === "POST");
  expect(requests).toHaveLength(4);
  const final = (requests[3]!.body as { providerRequest: APlusAgentProviderRequest }).providerRequest;
  expect(final.input.flatMap((message) => message.content).filter((part) => part.type === "input_image")).toHaveLength(2);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as MorphoWorkspace, seed.workspaceKey);
  const images = Object.values(stored.objects).filter((object) => object.type === "image" && !baseline.ids.includes(object.id));
  expect(images).toHaveLength(2);
  expect(await page.evaluate(() => window.__p2bImageCalls)).toBe(2);
  expect(stored.workingState.primaryDirectionId).toBe(baseline.primary); expect(Object.keys(stored.ai.comparisonAnalyses ?? {})).toEqual(baseline.compare);
  expect(stored.ai.messages.filter((message) => message.role === "assistant").at(-1)?.taskFulfillment?.reads.filter((receipt) => receipt.kind === "image" && receipt.delivered && receipt.representation === "pixels")).toHaveLength(2);
  await page.reload();
  expect(Object.values((await readStoredWorkspace(page)).objects).filter((object) => object.type === "image" && !baseline.ids.includes(object.id))).toHaveLength(2);
});
