import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { installAgentMock, setAgentRequestScript, agentTurnCallCount } from "./fixtures/agentMock";
import { toolCallTurnScript, textAnswerScript } from "./support/agentSse";

type Seed = { projectId: string; workspaceKey: string; catalogKey: string; catalogValue: string; core: string; history: string; noteId: string; fileId: string; proposalId: string; definitionId: string };
async function setup(page: Page, selected?: "research" | "file" | "proposal" | "history" | "note", far = false) {
  const s = JSON.parse(readFileSync(resolve("e2e/.seed/interaction.json"), "utf8")) as Seed;
  await page.addInitScript(({ s, selected, far }) => {
    if (localStorage.getItem(s.workspaceKey)) return;
    const workspace = JSON.parse(selected === "history" ? s.history : s.core) as MorphoWorkspace;
    const id = selected === "file" ? s.fileId : selected === "proposal" ? s.proposalId : selected === "history" ? s.definitionId : selected === "note" ? s.noteId : selected;
    workspace.ui.lastSelectionIds = id ? [id] : [];
    if (far) workspace.canvas.instances.find((i) => i.objectId === s.noteId)!.position = { x: 1800, y: 1000 };
    localStorage.setItem(s.catalogKey, s.catalogValue); localStorage.setItem(s.workspaceKey, JSON.stringify(workspace));
  }, { s, selected, far });
  await installAgentMock(page); await page.goto("/");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("morpho-assets-v1", 1); request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("asset-blobs")) request.result.createObjectStore("asset-blobs"); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction("asset-blobs", "readwrite"); for (const id of ["p6i-extract", "p6i-original"]) tx.objectStore("asset-blobs").put(new Blob(["P6I real document content"], { type: "text/plain" }), id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); db.close();
  });
  await page.goto(`/projects/${s.projectId}`); await expect(page.locator(".morpho-shape-host").first()).toBeVisible();
  const notice = page.getByRole("button", { name: "知道了", exact: true }); if (await notice.isVisible()) await notice.click();
  return s;
}
async function stored(page: Page, s: Seed): Promise<MorphoWorkspace> { return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), s.workspaceKey); }
async function select(page: Page, s: Seed, id: string, additive = false) {
  const instance = (await stored(page, s)).canvas.instances.find((i) => i.objectId === id)!;
  const shape = page.locator(`.tl-shape[data-shape-id="shape:${instance.id}"]`);
  await expect(shape).toBeVisible();
  let previous = await shape.boundingBox();
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(100); const next = await shape.boundingBox();
    if (next && previous && Math.abs(next.x - previous.x) < 0.5 && Math.abs(next.y - previous.y) < 0.5) break;
    previous = next;
  }
  const point = await page.evaluate((selector) => {
    const node = document.querySelector(selector)!; const box = node.getBoundingClientRect();
    const blocked = [...document.querySelectorAll(".tl-shape:has(.morpho-shape-host), .ai-panel, .floating-cluster, .left-rail, .selection-toolbar, .workspace-banner, .detail-popover, [data-workspace-surface]")].filter((other) => other !== node).map((node) => node.getBoundingClientRect());
    for (let y = Math.max(box.top + 10, 10); y < Math.min(box.bottom - 10, innerHeight - 10); y += 8) for (let x = Math.max(box.left + 10, 10); x < Math.min(box.right - 10, innerWidth - 10); x += 8) if (blocked.every((b) => x < b.left || x > b.right || y < b.top || y > b.bottom)) return { x, y };
    throw new Error("No exposed card area");
  }, `.tl-shape[data-shape-id="shape:${instance.id}"]`);
  if (additive) await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y);
  if (additive) await page.keyboard.up("Shift");
  await expect.poll(async () => (await stored(page, s)).ui.lastSelectionIds.includes(id)).toBe(true);
}
async function historyKey(page: Page, redo = false) { await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }); await page.keyboard.press(redo ? "Control+Shift+z" : "Control+z"); }
async function protect(page: Page, s: Seed, surface: string) {
  const before = await stored(page, s); const owner = page.locator(`[data-workspace-surface="${surface}"]`);
  await expect(owner).toBeVisible(); await owner.getByRole("button").first().focus();
  for (const key of ["Delete", "Backspace", "Control+a", "Meta+a"]) await page.keyboard.press(key);
  const after = await stored(page, s); expect(after.objects).toEqual(before.objects); expect(after.ui.lastSelectionIds).toEqual(before.ui.lastSelectionIds);
}

test("Research, Delivery, Archive, Reader and Proposal own destructive/select-all keys", async ({ page }) => {
  const s = await setup(page, "research");
  await page.getByRole("button", { name: "查看研究详情", exact: true }).click(); await protect(page, s, "researchDetail"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "交付准备", exact: true }).click(); await protect(page, s, "deliveryPreparation"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "归档", exact: true }).click(); await protect(page, s, "projectBundle"); await page.keyboard.press("Escape");
  await select(page, s, s.fileId); await page.getByRole("button", { name: "阅读文本", exact: true }).click(); await protect(page, s, "documentReader"); await page.keyboard.press("Escape");
  await select(page, s, s.proposalId); await page.getByRole("button", { name: "查看草案详情", exact: true }).click(); await protect(page, s, "proposalDetail");
});

test("Escape closes the visual top Archive before the lower Delivery surface", async ({ page }) => {
  const s = await setup(page, "proposal");
  await page.getByRole("button", { name: "交付准备", exact: true }).click();
  await page.getByRole("button", { name: "归档", exact: true }).click();
  await expect(page.locator('[data-workspace-surface="projectBundle"]')).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.locator('[data-workspace-surface="projectBundle"]')).toHaveCount(0);
  await expect(page.locator('[data-workspace-surface="deliveryPreparation"]')).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.locator('[data-workspace-surface="deliveryPreparation"]')).toHaveCount(0);
  expect((await stored(page, s)).artifactProposals[s.proposalId].status).toBe("pending");
});

test("Escape closes a higher Proposal before a lower Canvas menu and returns keyboard ownership", async ({ page }) => {
  const s = await setup(page, "proposal"); await page.getByRole("button", { name: "查看草案详情", exact: true }).click();
  await page.mouse.click(250, 350, { button: "right" }); await expect(page.locator('[data-workspace-surface="canvasContextMenu"]')).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.locator('[data-workspace-surface="proposalDetail"]')).toHaveCount(0);
  await expect(page.locator('[data-workspace-surface="canvasContextMenu"]')).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.locator('[data-workspace-surface="canvasContextMenu"]')).toHaveCount(0);
  expect((await stored(page, s)).artifactProposals[s.proposalId].status).toBe("pending");
});

test("Proposal hide is recoverable, mixed hide stays visibility-only, and manual Undo/Redo is symmetric", async ({ page }) => {
  const s = await setup(page, "proposal"); await select(page, s, s.noteId, true);
  await page.getByRole("button", { name: "隐藏对象", exact: true }).click();
  await expect.poll(async () => (await stored(page, s)).objects[s.proposalId].visibility).toBe("hidden");
  expect((await stored(page, s)).artifactProposals[s.proposalId].status).toBe("pending"); expect((await stored(page, s)).objects[s.noteId].visibility).toBe("hidden");
  await historyKey(page); await expect.poll(async () => (await stored(page, s)).objects[s.proposalId].visibility).toBe("active");
  await historyKey(page, true); await expect.poll(async () => (await stored(page, s)).objects[s.proposalId].visibility).toBe("hidden");
  await page.getByRole("button", { name: "已隐藏内容", exact: true }).click();
  await page.locator(".side-drawer .asset-row").filter({ hasText: "P6I pending proposal" }).getByRole("button", { name: "恢复并定位", exact: true }).click();
  await expect.poll(async () => (await stored(page, s)).objects[s.proposalId].visibility).toBe("active"); expect((await stored(page, s)).artifactProposals[s.proposalId].status).toBe("pending");
});

test("Research recommends candidates, explicit retain writes facts and keeps the earlier eighth conclusion", async ({ page }) => {
  const s = await setup(page, "research"); await page.getByRole("button", { name: "查看研究详情", exact: true }).click();
  const panel = page.locator('[data-workspace-surface="researchDetail"]');
  await panel.getByRole("button", { name: "还原", exact: true }).click(); await panel.getByRole("button", { name: /此前保留第八条/ }).click();
  await panel.getByRole("button", { name: "保留为项目依据", exact: true }).click();
  await expect.poll(async () => Object.values((await stored(page, s)).objects).filter((o) => o.type === "keyConclusion").length).toBe(1);
  await page.screenshot({ path: "temp/verification/p6i/research-retain.png" });
  const before = await stored(page, s); const retained = Object.values(before.objects).find((o) => o.type === "keyConclusion")!;
  await page.keyboard.press("Escape"); await page.getByRole("button", { name: "搜索", exact: true }).click(); await page.getByRole("textbox", { name: "搜索关键词", exact: true }).fill("P6I research"); await page.locator('[data-object-id="research"]').getByRole("button", { name: "定位", exact: true }).click(); await page.getByRole("button", { name: "推荐候选", exact: true }).click();
  expect((await stored(page, s)).objects[retained.id]).toEqual(retained); expect(Object.values((await stored(page, s)).objects).filter((o) => o.type === "keyConclusion")).toHaveLength(1);
  await panel.getByRole("button", { name: /此前保留第八条/ }).click(); // Exclude previous item from this candidate set; never revoke it.
  await panel.getByRole("button", { name: "保留为项目依据", exact: true }).click();
  await expect.poll(async () => Object.values((await stored(page, s)).objects).filter((o) => o.type === "keyConclusion").length).toBe(7);
  expect((await stored(page, s)).objects[retained.id]).toEqual(retained);
});

test("Reader preserves Canvas selection and input Context across open/close; locate preserves a multi-selection", async ({ page }) => {
  const s = await setup(page, "file"); 
  const ids = (await stored(page, s)).ui.lastSelectionIds;
  // Reader entry from selected file's Bottom Detail is a reading action over the existing multi-selection.
  await page.getByRole("button", { name: "阅读文本", exact: true }).click();
  await expect(page.locator('[data-workspace-surface="documentReader"]')).toContainText("P6I real document content");
  expect((await stored(page, s)).ui.lastSelectionIds).toEqual(ids); await expect(page.locator('[aria-label="当前输入语境"]')).toContainText("已选 1");
  await page.keyboard.press("Escape"); expect((await stored(page, s)).ui.lastSelectionIds).toEqual(ids);
  await select(page, s, s.noteId, true); const multiIds = (await stored(page, s)).ui.lastSelectionIds;
  await page.getByRole("button", { name: "搜索", exact: true }).click(); await page.getByRole("textbox", { name: "搜索关键词", exact: true }).fill("P6I research");
  await page.locator('[data-object-id="research"]').getByRole("button", { name: "定位", exact: true }).click();
  expect((await stored(page, s)).ui.lastSelectionIds).toEqual(multiIds); await expect(page.locator('[aria-label="当前输入语境"]')).toContainText("已选 2");
});

test("hidden search result explicitly restores before locating, without deciding its proposal", async ({ page }) => {
  const s = await setup(page, "proposal"); await page.getByRole("button", { name: "隐藏对象", exact: true }).click();
  await page.getByRole("button", { name: "搜索", exact: true }).click(); await page.getByRole("textbox", { name: "搜索关键词", exact: true }).fill("P6I pending proposal");
  await page.locator(`[data-object-id="${s.proposalId}"]`).getByRole("button", { name: "恢复并定位", exact: true }).click();
  await expect.poll(async () => (await stored(page, s)).objects[s.proposalId].visibility).toBe("active"); expect((await stored(page, s)).artifactProposals[s.proposalId].status).toBe("pending");
});

test("an async Research result remains discoverable without taking Reader/selection/camera attention", async ({ page }) => {
  const s = await setup(page, "file");
  const script = toolCallTurnScript({ toolName: "create_research_analysis", argumentsText: JSON.stringify({ title: "P6I delayed result", summary: "异步研究", findings: ["结果"], opportunities: [], constraints: [], openQuestions: [], evidence: [] }) });
  await setAgentRequestScript(page, [{ kind: "stream", chunks: script.first, chunkDelayMs: 600 }, { kind: "stream", chunks: script.second, chunkDelayMs: 15 }]);
  await page.locator(".ai-panel textarea").fill("请创建一张研究分析卡。"); await page.getByRole("button", { name: "发送", exact: true }).click(); await expect.poll(() => agentTurnCallCount(page)).toBe(1);
  await page.getByRole("button", { name: "阅读文本", exact: true }).click(); const before = await stored(page, s);
  const readerSearch = page.locator('[data-workspace-surface="documentReader"] input').first(); await readerSearch.fill("document");
  await expect.poll(async () => Object.values((await stored(page, s)).objects).some((o) => o.title === "P6I delayed result")).toBe(true);
  await expect(readerSearch).toBeFocused(); await expect(page.locator('[data-workspace-surface="documentReader"]')).toBeVisible();
  const after = await stored(page, s); expect(after.ui.lastSelectionIds).toEqual(before.ui.lastSelectionIds); expect(after.canvas.view).toEqual(before.canvas.view);
  await expect(page.locator(".ai-panel")).toContainText("研究");
});

for (const selectionAction of ["pointer", "keyboard"] as const) test(`late async result preserves a changed ${selectionAction} Canvas selection`, async ({ page }) => {
  const s = await setup(page, "file");
  const script = toolCallTurnScript({ toolName: "create_research_analysis", argumentsText: JSON.stringify({ title: "P6I async selection result", summary: "研究结果", findings: ["完成"], opportunities: [], constraints: [], openQuestions: [], evidence: [] }) });
  await setAgentRequestScript(page, [{ kind: "stream", chunks: script.first, chunkDelayMs: 600 }, { kind: "stream", chunks: script.second, chunkDelayMs: 15 }]);
  await page.locator(".ai-panel textarea").fill("请创建研究分析卡。"); await page.getByRole("button", { name: "发送", exact: true }).click(); await expect.poll(() => agentTurnCallCount(page)).toBe(1);
  await select(page, s, s.noteId);
  if (selectionAction === "keyboard") { await page.keyboard.press("Control+a"); await expect.poll(async () => (await stored(page, s)).ui.lastSelectionIds.length).toBe(4); }
  const before = await stored(page, s);
  await expect.poll(async () => Object.values((await stored(page, s)).objects).some((object) => object.title === "P6I async selection result")).toBe(true);
  expect((await stored(page, s)).ui.lastSelectionIds).toEqual(before.ui.lastSelectionIds); expect((await stored(page, s)).canvas.view).toEqual(before.canvas.view);
});

test("Escape dismisses an open Region popover while retaining the underlying Region and its style", async ({ page }) => {
  const s = await setup(page); const title = page.locator(".stage-region-research .stage-region-title"); const box = await title.boundingBox(); if (!box) throw new Error("title");
  await page.mouse.click(box.x + 20, box.y + 8); await page.getByRole("button", { name: "透明度", exact: true }).click();
  await expect(page.locator('[data-workspace-surface="toolbarPopover"]')).toBeVisible(); const before = await stored(page, s);
  await page.keyboard.press("Escape"); await expect(page.locator('[data-workspace-surface="toolbarPopover"]')).toHaveCount(0);
  await expect(page.locator('[aria-label="资料与研究分区工具"]')).toBeVisible(); expect((await stored(page, s)).canvas.stageRegions).toEqual(before.canvas.stageRegions);
});

test("Region drag moves only the landmark; explicit selection exposes distant members and moves them together with one Undo", async ({ page }) => {
  const s = await setup(page, undefined, true); const region = page.locator(".stage-region-research .stage-region-title"); await expect(region).toContainText("拖动仅移动地标");
  const before = await stored(page, s); const box = await region.boundingBox(); if (!box) throw new Error("region title");
  await page.mouse.move(box.x + 20, box.y + 8); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 48, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await stored(page, s)).canvas.stageRegions!.find((r) => r.key === "research")!.x).not.toBe(before.canvas.stageRegions!.find((r) => r.key === "research")!.x);
  const landmark = await stored(page, s); expect(landmark.canvas.instances).toEqual(before.canvas.instances);
  await historyKey(page); await expect.poll(async () => (await stored(page, s)).canvas.stageRegions!.find((r) => r.key === "research")!.x).toBe(before.canvas.stageRegions!.find((r) => r.key === "research")!.x);
  const resetBox = await region.boundingBox(); if (!resetBox) throw new Error("region after Undo"); await page.mouse.click(resetBox.x + 20, resetBox.y + 8);
  await page.getByRole("button", { name: /选择地标与.*个成员一起移动/ }).click(); await expect(page.locator('[aria-label="当前输入语境"]')).toContainText("已选 3");
  await expect(region).toContainText("拖动地标与 3 个已选成员一起移动");
  await expect(page.getByRole("button", { name: "编辑文本", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "temp/verification/p6i/region-joint-selection.png" });
  await page.waitForTimeout(500); const groupBox = await region.boundingBox(); if (!groupBox) throw new Error("selected region");
  const start = await stored(page, s); await page.mouse.move(groupBox.x + 6, groupBox.y + 3); await page.mouse.down(); await page.mouse.move(groupBox.x + 66, groupBox.y + 33, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await stored(page, s)).canvas.instances.find((i) => i.objectId === s.noteId)!.position).not.toEqual(start.canvas.instances.find((i) => i.objectId === s.noteId)!.position);
  const moved = await stored(page, s); for (const instance of start.canvas.instances.filter((i) => before.canvas.stageRegions!.find((r) => r.key === "research")!.memberObjectIds.includes(i.objectId))) expect(moved.canvas.instances.find((i) => i.id === instance.id)!.position).not.toEqual(instance.position);
  await historyKey(page); await expect.poll(async () => (await stored(page, s)).canvas.instances.find((i) => i.objectId === s.noteId)!.position).toEqual(start.canvas.instances.find((i) => i.objectId === s.noteId)!.position);
});

test("relations appear only on requested detail tabs", async ({ page }) => {
  const s = await setup(page, "research"); await expect(page.locator(".canvas-relationship-overlay path")).toHaveCount(0);
  await page.getByRole("tab", { name: "来源", exact: true }).click(); await expect(page.locator(".canvas-relationship-overlay path")).toHaveCount(1);
  await page.getByRole("tab", { name: "信息", exact: true }).click(); await expect(page.locator(".canvas-relationship-overlay path")).toHaveCount(0);
  const before = await stored(page, s); expect(before.objects.research.visibility).toBe("active");
});
test("historical revision reads full immutable content without changing the current Definition", async ({ page }) => {
  const s = await setup(page, "history"); await page.getByRole("tab", { name: "版本", exact: true }).click();
  await page.getByText(/阅读修订 1：/).click(); await expect(page.locator('[aria-label="对象详情"]')).toContainText("P6I historical goal body");
  expect((await stored(page, s)).objects[s.definitionId]).toEqual((JSON.parse(s.history) as MorphoWorkspace).objects[s.definitionId]);
});
test("ordinary note editing can be undone/redone without creating another semantic object", async ({ page }) => {
  const s = await setup(page, "note"); const before = await stored(page, s); await page.getByRole("button", { name: "编辑文本", exact: true }).click();
  const prompt = page.locator('[data-workspace-surface="textPrompt"]'); await prompt.getByRole("textbox").fill("P6I edited note"); await prompt.getByRole("button", { name: /确认|保存/ }).click();
  await expect.poll(async () => (await stored(page, s)).objects[s.noteId].summary).toBe("P6I edited note"); await historyKey(page); await expect.poll(async () => (await stored(page, s)).objects[s.noteId]).toEqual(before.objects[s.noteId]);
  await historyKey(page, true); await expect.poll(async () => (await stored(page, s)).objects[s.noteId].summary).toBe("P6I edited note");
});

for (const action of ["close", "detach", "purpose"] as const) test(`Delivery chapter target is visible and ${action} prevents old target from hijacking a normal send`, async ({ page }) => {
  const s = JSON.parse(readFileSync(resolve("e2e/.seed/delivery-handoff.json"), "utf8")) as { projectId: string; workspaceKey: string; catalogKey: string; catalogValue: string; normal: string };
  await page.addInitScript((s) => { if (!localStorage.getItem(s.workspaceKey)) { localStorage.setItem(s.catalogKey, s.catalogValue); localStorage.setItem(s.workspaceKey, s.normal); } }, s);
  await installAgentMock(page); await page.goto(`/projects/${s.projectId}`); await expect(page.locator(".tl-container")).toBeVisible();
  const notice = page.getByRole("button", { name: "知道了", exact: true }); if (await notice.isVisible()) await notice.click();
  await page.getByRole("button", { name: "交付准备", exact: true }).click();
  const delivery = page.locator('[data-workspace-surface="deliveryPreparation"]'); await delivery.getByRole("button", { name: /生成.*草稿/ }).click();
  await expect(page.locator('[aria-label="交付章节输入目标"]')).toBeVisible(); await expect(page.locator('[aria-label="当前输入语境"]')).toContainText("仅绑定交付章节");
  if (action === "close") await page.keyboard.press("Escape");
  else if (action === "detach") await page.getByRole("button", { name: "解除章节目标", exact: true }).click();
  else {
    await page.locator(".ai-panel textarea").fill("请生成一张新的产品图片");
    await page.getByRole("button", { name: "本轮允许生图", exact: true }).click();
    await page.getByRole("button", { name: "改为仅分析", exact: true }).click();
  }
  await expect(page.locator('[aria-label="交付章节输入目标"]')).toHaveCount(0);
  await setAgentRequestScript(page, [{ kind: "stream", chunks: textAnswerScript({ text: "P6I ordinary discussion" }).chunks }]);
  await page.locator(".ai-panel textarea").fill("你好，请只回答一个普通讨论问题，不生成草稿。"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => agentTurnCallCount(page)).toBe(1); await expect(page.locator(".ai-panel")).toContainText("P6I ordinary discussion");
  const request = await page.evaluate(() => JSON.stringify(window.__morphoAgentMock?.calls.filter((call) => call.url.endsWith("/requests"))[0]?.body));
  expect(request).not.toContain("<untrusted_delivery_section>"); expect(request).not.toContain('"prepareDeliverySection"'); expect(request).not.toContain('"deliverySectionContext"'); expect(request).not.toContain('"deliveryTarget"');
  expect(Object.keys(JSON.parse(await page.evaluate((key) => localStorage.getItem(key)!, s.workspaceKey)).deliverySectionDrafts)).toHaveLength(0);
});
