import { expect, test } from "@playwright/test";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import type { APlusAgentProviderRequest } from "@/shared/agentTurnJournalProtocol";
import { seedProject, readStoredWorkspace } from "./fixtures/seed";
import { agentCalls, installAgentMock, setAgentRequestScript } from "./fixtures/agentMock";
import { toolCallTurnScript } from "./support/agentSse";

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFh0AAAAASUVORK5CYII=";
type ImageRequest = { input: { referenceObjectIds: string[]; images: string[] } };
declare global { interface Window { __p2aImageRequests?: ImageRequest[] } }

for (const [variant, draft] of [
  ["representative", "比较 A/B，给出取舍；不要保存 Compare；然后只继续 A，生成两张 CMF 图；不要修改主方向。"],
  ["comparison scope qualifier", "只针对 A 和 B 做比较；然后只继续 A，生成两张 CMF 图。"],
  ["descriptive auxiliary mention", "比较 A/B；然后只继续 A，生成两张 CMF 图，B 的结构现在有问题，B 的环境太暗，不要改 B。"]
] as const) {
test(`mixed turn compares A+B and persists two CMF images from A only without Compare or primary writes: ${variant}`, async ({ page }) => {
  const seed = await seedProject(page);
  await installAgentMock(page);
  await page.addInitScript((base64: string) => {
    const previous = window.fetch.bind(window);
    window.__p2aImageRequests = [];
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/actions/image") && init?.method === "POST") {
        window.__p2aImageRequests!.push(JSON.parse(String(init.body)));
        return new Response(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)), { headers: { "content-type": "image/png" } });
      }
      return previous(input, init);
    };
  }, pixel);
  await page.goto("/");
  const baseline = await page.evaluate(async ({ key, base64 }) => {
    const workspace = JSON.parse(localStorage.getItem(key)!) as MorphoWorkspace;
    const images = Object.values(workspace.objects).filter((object) => object.type === "image" && object.visibility === "active").slice(0, 2);
    if (images.length !== 2) throw new Error("Need two seeded images");
    const blob = new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], { type: "image/png" });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("morpho-assets-v1", 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("asset-blobs")) request.result.createObjectStore("asset-blobs"); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("asset-blobs", "readwrite");
      images.forEach((image, index) => {
        if (image.type !== "image") throw new Error("Need image source");
        image.title = index === 0 ? "A" : "B";
        image.assetId = `p2a-source-${index}`;
        workspace.assets[image.assetId] = { id: image.assetId, fileName: `${image.title}.png`, mimeType: "image/png", size: blob.size,
          createdAt: new Date().toISOString(), storageKey: `p2a-source-${index}`, sourceType: "originalImage", width: 1, height: 1 };
        transaction.objectStore("asset-blobs").put(blob, `p2a-source-${index}`);
      });
      transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    workspace.ui.lastSelectionIds = images.map((image) => image.id);
    workspace.workingState.currentDefaultReferenceId = images[1]!.id;
    Object.values(workspace.objects).forEach((object) => { if (object.type === "image") object.isDefaultReference = object.id === images[1]!.id; });
    localStorage.setItem(key, JSON.stringify(workspace));
    return { a: images[0]!.id, b: images[1]!.id, ids: Object.keys(workspace.objects), primary: workspace.workingState.primaryDirectionId,
      compareIds: Object.keys(workspace.ai.comparisonAnalyses ?? {}), decisionIds: workspace.decisionRecords.map((decision) => decision.id) };
  }, { key: seed.workspaceKey, base64: pixel });
  await page.goto(`/projects/${seed.seedProjectId}`);
  await expect(page.locator(".ai-panel textarea")).toBeVisible();
  const script = toolCallTurnScript({ toolName: "generate_visuals", argumentsText: JSON.stringify({ kind: "visualDevelopment", items: [1, 2].map((id) => ({
    id: `cmf-${id}`, title: `CMF ${id}`, purpose: "Explore CMF on A", requestedReferenceObjectIds: [baseline.a],
    changeGoals: ["CMF"], preserve: ["geometry"], allowToChange: ["material"], productForm: [], materialsAndCmf: ["matte"],
    environmentAndLighting: [], avoid: [], role: "cmfStudy"
  })) }), finalText: "已比较 A/B，并只继续 A 生成两张 CMF 图。" });
  await setAgentRequestScript(page, [{ kind: "stream", chunks: script.first }, { kind: "stream", chunks: script.second }]);
  await page.locator(".ai-panel textarea").fill(draft);
  await page.getByRole("button", { name: "本轮允许生图", exact: true }).click();
  await page.locator('[aria-label="发送"]').click();
  await expect(page.locator(".ai-panel")).toContainText("已比较 A/B，并只继续 A 生成两张 CMF 图。", { timeout: 30_000 });
  await expect.poll(async () => {
    const workspace = await readStoredWorkspace(page);
    return Object.values(workspace.objects).filter((object) => !baseline.ids.includes(object.id) && object.type === "image").length;
  }).toBe(2);
  const requests = await page.evaluate(() => window.__p2aImageRequests!);
  expect(requests).toHaveLength(2);
  expect(requests.every((request) => request.input.referenceObjectIds.join() === baseline.a && request.input.images.length === 1)).toBe(true);
  const providerCalls = (await agentCalls(page)).filter((call) => call.url.endsWith("/requests") && call.method === "POST");
  expect(providerCalls).toHaveLength(2);
  const first = (providerCalls[0]!.body as { providerRequest: APlusAgentProviderRequest }).providerRequest;
  const next = (providerCalls[1]!.body as { providerRequest: APlusAgentProviderRequest }).providerRequest;
  expect(first.taskContract?.activities.find((activity) => activity.kind === "comparison")?.sourceObjectIds).toEqual([baseline.a, baseline.b]);
  expect(first.taskContract?.activities.find((activity) => activity.kind === "visualDevelopment")?.referenceObjectIds).toEqual([baseline.a]);
  expect(next.taskContract).toEqual(first.taskContract);
  const final = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as MorphoWorkspace, seed.workspaceKey);
  expect(final.workingState.primaryDirectionId).toBe(baseline.primary);
  expect(Object.keys(final.ai.comparisonAnalyses ?? {})).toEqual(baseline.compareIds);
  expect(final.decisionRecords.map((decision) => decision.id)).toEqual(baseline.decisionIds);
  await page.reload();
  await expect(page.locator(".ai-panel")).toContainText("已比较 A/B，并只继续 A 生成两张 CMF 图。");
  expect(Object.values((await readStoredWorkspace(page)).objects).filter((object) => !baseline.ids.includes(object.id) && object.type === "image")).toHaveLength(2);
});
}
