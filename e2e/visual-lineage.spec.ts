import { expect, test } from "@playwright/test";
import type { MorphoWorkspace, ImageObject } from "@/domain/morpho/types";
import type { VisualLineageSnapshot, VisualProviderInputManifest } from "@/domain/operations/types";
import type { APlusAgentProviderRequest } from "@/shared/agentTurnJournalProtocol";
import { seedProject } from "./fixtures/seed";
import { agentCalls, installAgentMock, setAgentRequestScript } from "./fixtures/agentMock";
import { toolCallTurnScript } from "./support/agentSse";

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFh0AAAAASUVORK5CYII=";
type ImageRequest = { input: { prompt: string; images: string[]; referenceObjectIds: string[]; visualLineage: VisualLineageSnapshot; visualProviderInputs: VisualProviderInputManifest } };
declare global { interface Window { __p4Images?: ImageRequest[] } }

for (const mode of ["generateOnly", "optionalMissing", "requiredMissing"] as const) {
  test(`P4 ${mode}: freezes parent, roles, actual inputs and honest observation on reload`, async ({ page }) => {
    const seed = await seedProject(page);
    await installAgentMock(page);
    await page.addInitScript((base64) => {
      const previous = window.fetch.bind(window);
      window.__p4Images = [];
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/actions/image") && init?.method === "POST") {
          window.__p4Images!.push(JSON.parse(String(init.body)) as ImageRequest);
          return new Response(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)), { headers: { "content-type": "image/png" } });
        }
        return previous(input, init);
      };
    }, PIXEL);
    await page.goto("/");
    const baseline = await page.evaluate(async ({ key, mode, base64 }) => {
      const workspace = JSON.parse(localStorage.getItem(key)!) as MorphoWorkspace;
      const template = Object.values(workspace.objects).find((object): object is ImageObject => object.type === "image")!;
      const directions = Object.values(workspace.objects).filter((object) => object.type === "conceptDirection");
      for (let index = directions.length; index < 2; index++) {
        const id = `p4-direction-${index}`;
        const revisionId = `${id}-revision-1`;
        const direction: import("@/domain/morpho/types").ConceptDirectionObject = { id, incarnationId: `identity-${id}`, type: "conceptDirection",
          title: `P4 方向 ${index}`, summary: "视觉归属测试方向", visibility: "active", createdBy: "user", status: "alternative", keywords: [],
          currentRevisionId: revisionId, revisionIds: [revisionId], lineageRootId: id };
        workspace.objects[id] = direction;
        workspace.directionRevisions[revisionId] = { id: revisionId, directionId: id, revisionNumber: 1, title: direction.title, summary: direction.summary,
          conceptStatement: "P4 视觉归属", keywords: [], strategy: "独立方向", differentiators: [], visualSignals: [], risks: [], openQuestions: [],
          sourceObjectIds: [], citationIds: [], createdAt: new Date().toISOString(), isCurrent: true };
        directions.push(direction);
      }
      const blob = new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], { type: "image/png" });
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("morpho-assets-v1", 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("asset-blobs")) request.result.createObjectStore("asset-blobs"); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const ids = ["p4-parent", "p4-material", "p4-environment", "p4-excluded"];
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("asset-blobs", "readwrite");
        ids.forEach((id, index) => {
          const assetId = `asset-${id}`;
          workspace.objects[id] = { ...template, id, incarnationId: `identity-${id}`, title: ["A", "M", "E", "X"][index]!, assetId,
            directionId: directions[index === 0 ? 0 : 1]!.id, visualBranchId: index === 0 ? "p4-branch" : undefined,
            isDefaultReference: false, generation: undefined, role: "reference" };
          workspace.assets[assetId] = { id: assetId, storageKey: assetId, fileName: `${id}.png`, mimeType: "image/png", size: blob.size,
            sourceType: "originalImage", width: 1, height: 1, createdAt: new Date().toISOString() };
          if (!(mode === "optionalMissing" && index === 1) && !(mode === "requiredMissing" && index === 0)) transaction.objectStore("asset-blobs").put(blob, assetId);
          workspace.canvas.instances.push({ id: `canvas-${id}`, objectId: id, position: { x: index * 260, y: 100 }, size: { w: 220, h: 220 } });
        });
        transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); transaction.onerror = () => reject(transaction.error);
      });
      db.close();
      workspace.visualBranches["p4-branch"] = { id: "p4-branch", directionId: directions[0]!.id, label: "A 视觉路线", rootObjectId: ids[0], createdAt: new Date().toISOString() };
      workspace.ui.lastSelectionIds = ids;
      workspace.workingState.currentDefaultReferenceId = undefined;
      for (const object of Object.values(workspace.objects)) if (object.type === "image") object.isDefaultReference = false;
      localStorage.setItem(key, JSON.stringify(workspace));
      return { ids: Object.keys(workspace.objects), direction: directions[0]!.id, primary: workspace.workingState.primaryDirectionId,
        decisions: workspace.decisionRecords.map((entry) => entry.id) };
    }, { key: seed.workspaceKey, mode, base64: PIXEL });
    await page.goto(`/projects/${seed.seedProjectId}`);
    const script = toolCallTurnScript({ toolName: "generate_visuals", argumentsText: JSON.stringify({ kind: "visualDevelopment", items: [{
      id: "p4-result", identityParentObjectId: "p4-parent", title: "A 的 CMF 延展", purpose: "保持 A 身份并借用材料与环境",
      targetDirectionId: baseline.direction, referenceBindings: [{ objectId: "p4-material", role: "cmf", required: false }, { objectId: "p4-environment", role: "environment", required: false }],
      requestedReferenceObjectIds: ["p4-environment", "p4-material"], excludedReferenceObjectIds: ["p4-excluded"], excludeDefaultReference: true,
      changeGoals: ["CMF"], preserve: ["产品身份与比例"], allowToChange: ["环境"], productForm: [], materialsAndCmf: [], environmentAndLighting: [], avoid: [], role: "cmfStudy"
    }] }), finalText: "本次生成处理结束。" });
    await setAgentRequestScript(page, [{ kind: "stream", chunks: script.first }, { kind: "stream", chunks: script.second }]);
    await page.locator(".ai-panel textarea").fill("只继续 A 生成一张 CMF 图，借用 M 作为材质参考，借用 E 作为环境参考，本轮不使用 X，本轮不使用默认参考。");
    await page.getByRole("button", { name: "本轮允许生图", exact: true }).click();
    await page.locator('[aria-label="发送"]').click();
    await expect(page.locator(".ai-panel")).toContainText("本次生成处理结束。", { timeout: 30_000 });
    const read = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as MorphoWorkspace, seed.workspaceKey);
    await expect.poll(async () => (await read()).ai.messages.filter((message) => message.role === "assistant").at(-1)?.status).toBe("done");
    const workspace = await read();
    const images = Object.values(workspace.objects).filter((object): object is ImageObject => object.type === "image" && !baseline.ids.includes(object.id));
    const requests = await page.evaluate(() => window.__p4Images!);
    const providerCalls = (await agentCalls(page)).filter((call) => call.url.endsWith("/requests") && call.method === "POST");
    expect(providerCalls).toHaveLength(2);
    const contract = (providerCalls[0]!.body as { providerRequest: APlusAgentProviderRequest }).providerRequest.taskContract!;
    const activity = contract.activities.find((item) => item.kind === "visualDevelopment")!;
    expect(activity.sourceObjectIds).toEqual(["p4-parent"]);
    expect(activity.referenceObjectIds).toEqual(expect.arrayContaining(["p4-parent", "p4-material", "p4-environment"]));
    expect(activity.excludedObjectIds).toContain("p4-excluded");
    expect(activity.observeGeneratedImages).toBeUndefined();
    expect(contract.activities.some((item) => item.kind === "critique" || item.kind === "comparison")).toBe(false);
    expect(contract.activities.some((item) => item.effectGrants.some((grant) => grant.tool === "submit_memory_update"))).toBe(false);
    expect(workspace.workingState.primaryDirectionId).toBe(baseline.primary);
    expect(workspace.decisionRecords.map((entry) => entry.id)).toEqual(baseline.decisions);
    if (mode === "requiredMissing") {
      expect(requests).toEqual([]);
      expect(images).toEqual([]);
      expect(workspace.ai.messages.at(-1)?.taskFulfillment?.status).not.toBe("fulfilled");
      expect(JSON.stringify(workspace.operations)).toContain("必要参考像素不可用");
      return;
    }
    expect(images).toHaveLength(1);
    expect(requests).toHaveLength(1);
    const image = images[0]!;
    expect(image.generation?.lineage).toEqual(requests[0]!.input.visualLineage);
    expect(image.generation?.providerInputs).toEqual(requests[0]!.input.visualProviderInputs);
    expect(image.generation?.compiledPrompt).toBe(requests[0]!.input.prompt);
    expect(image.generation?.referenceObjectIds).toEqual(requests[0]!.input.referenceObjectIds);
    expect(image.generation?.referenceObjectIds).not.toContain("p4-excluded");
    expect(requests[0]!.input.images).toHaveLength(mode === "optionalMissing" ? 2 : 3);
    expect(image.generation?.observations).toBeUndefined();
    expect(workspace.ai.messages.at(-1)?.taskFulfillment?.status, JSON.stringify({
      obligations: workspace.ai.messages.at(-1)?.taskFulfillment?.obligations,
      effects: workspace.ai.messages.at(-1)?.taskFulfillment?.effects,
      activities: contract.activities, execution: contract.execution
    })).toBe("fulfilled");
    expect(image.directionId).toBe(baseline.direction);
    expect(image.visualBranchId).toBe("p4-branch");
    expect(workspace.relations.filter((entry) => entry.kind === "version" && entry.toObjectId === image.id)).toEqual([expect.objectContaining({ fromObjectId: "p4-parent" })]);
    expect(image.generation?.providerInputs?.references.find((entry) => entry.source.objectId === "p4-material")?.status).toBe(mode === "optionalMissing" ? "omitted" : "sent");
    await page.getByRole("tab", { name: "来源", exact: true }).click();
    const details = page.getByLabel("图像生成来源");
    await expect(details).toContainText("身份父图：A");
    await expect(details).toContainText("尚无图像观察记录");
    await expect(details).toContainText("CMF 参考：M");
    if (mode === "optionalMissing") await expect(details).toContainText("未使用：未能读取图像");
    await page.screenshot({ path: `e2e/.artifacts/p4-${mode}.png` });
    const frozen = image.generation;
    await page.reload();
    expect((await read()).objects[image.id]).toMatchObject({ generation: frozen, directionId: baseline.direction, visualBranchId: "p4-branch" });
    expect((await agentCalls(page)).filter((call) => call.method === "POST")).toHaveLength(0);
  });
}
