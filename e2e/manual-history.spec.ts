import { expect, test, type Page } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedProject, seedTextOnlyProject, readStoredWorkspace, shapeSelector } from "./fixtures/seed";
import { clickEmptyCanvas, selectObject, shapeCentre } from "./fixtures/canvas";
import { installAgentMock, setAgentResponse, setAgentRequestScript, agentTurnCallCount } from "./fixtures/agentMock";
import { toolCallTurnScript, textAnswerScript } from "./support/agentSse";
import type { MorphoWorkspace } from "@/domain/morpho/types";

async function mutationKey(page: Page, key = "Control+z") {
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press(key);
}
async function stored(page: Page, key: string): Promise<MorphoWorkspace> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
}

function currentProjections(workspace: MorphoWorkspace) {
  return {
    memory: Object.values(workspace.projectMemory.documents).map((document) => document.currentRevisionId ? workspace.projectMemory.revisions[document.currentRevisionId]?.sections : undefined),
    stages: Object.values(workspace.projectMemory.stageRecords).map((record) => record.currentRevisionId ? workspace.projectMemory.stageRevisions[record.currentRevisionId]?.sections : undefined),
    stageMetadata: Object.values(workspace.projectMemory.stageRecords).map((record) => record.currentRevisionId ? workspace.projectMemory.stageRevisions[record.currentRevisionId]?.itemMetadata : undefined)
  };
}

async function selectStoredObject(page: Page, key: string, id: string) {
  const instance = (await stored(page, key)).canvas.instances.find((i) => i.objectId === id)!;
  const shape = page.locator(`.tl-shape[data-shape-id="shape:${instance.id}"]`);
  await expect(shape).toBeVisible();
  // Use an exposed part of the real card, not its potentially occluded centre.
  const point = await page.evaluate((selector) => {
    const shape = document.querySelector(selector)!;
    const box = shape.getBoundingClientRect();
    const blocked = [...document.querySelectorAll(".tl-shape:has(.morpho-shape-host), .ai-panel, .floating-cluster, .rail, .selection-toolbar, .workspace-banner, [aria-label='对象详情']")].filter((node) => node !== shape).map((node) => node.getBoundingClientRect());
    for (let y = Math.max(box.top + 14, 14); y < Math.min(box.bottom - 14, innerHeight - 14); y += 12) {
      for (let x = Math.max(box.left + 14, 14); x < Math.min(box.right - 14, innerWidth - 14); x += 12) {
        if (blocked.every((b) => x < b.left || x > b.right || y < b.top || y > b.bottom)) return { x, y };
      }
    }
    throw new Error("No exposed card area after canvas navigation.");
  }, `.tl-shape[data-shape-id="shape:${instance.id}"]`);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await stored(page, key)).ui.lastSelectionIds).toEqual([id]);
}

test("one pointer drag owns one layout entry; renderer/selection writes do not consume Undo", async ({ page }) => {
  const seed = await seedProject(page); await page.goto(`/projects/${seed.seedProjectId}`);
  await selectObject(page, seed.objectIds.research);
  await expect(page.getByRole("button", { name: "撤销人工操作", exact: true })).toBeDisabled();
  const position = async () => (await stored(page, seed.workspaceKey)).canvas.instances.find((i) => i.objectId === seed.objectIds.research)!.position;
  const before = await position(), point = await shapeCentre(page, seed.objectIds.research);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 40, point.y + 15, { steps: 5 });
  await page.waitForTimeout(200); // Cross the persist debounce while still dragging.
  await page.mouse.move(point.x + 80, point.y + 30, { steps: 5 }); await page.mouse.up();
  await expect.poll(position).not.toEqual(before);
  const after = await position();
  await mutationKey(page); await expect.poll(position).toEqual(before);
  await expect(page.getByRole("button", { name: "撤销人工操作", exact: true })).toBeDisabled();
  await mutationKey(page, "Control+Shift+z"); await expect.poll(position).toEqual(after);
});

test("hide -> independent Agent Research write -> Undo/Redo preserves its full result and runtime", async ({ page }) => {
  const seed = await seedProject(page); await installAgentMock(page); await page.goto(`/projects/${seed.seedProjectId}`);
  await selectObject(page, seed.objectIds.research); await page.getByRole("button", { name: "隐藏对象", exact: true }).click();
  const script = toolCallTurnScript({ toolName: "create_research_analysis", argumentsText: JSON.stringify({ title: "P6H independent B", summary: "独立研究结果", findings: ["观察：独立发现"], opportunities: [], constraints: [], openQuestions: [], evidence: [] }) });
  await setAgentRequestScript(page, [{ kind: "stream", chunks: script.first, chunkDelayMs: 15 }, { kind: "stream", chunks: script.second, chunkDelayMs: 15 }]);
  await page.locator(".ai-panel textarea").fill("请创建研究分析卡，保存一条独立研究结果。"); await page.getByRole("button", { name: "发送", exact: true }).click();

  await expect.poll(async () => Object.values((await stored(page, seed.workspaceKey)).objects).some((o) => o.title === "P6H independent B")).toBe(true);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  const current = await stored(page, seed.workspaceKey), b = Object.values(current.objects).find((o) => o.title === "P6H independent B")!;
  await mutationKey(page);
  await expect.poll(async () => (await stored(page, seed.workspaceKey)).objects[seed.objectIds.research].visibility).toBe("active");
  const undo = await stored(page, seed.workspaceKey);
  expect(undo.objects[b.id]).toEqual(b); expect(undo.ai).toEqual(current.ai); expect(undo.operations).toEqual(current.operations);
  await mutationKey(page, "Control+y");
  await expect.poll(async () => (await stored(page, seed.workspaceKey)).objects[seed.objectIds.research].visibility).toBe("hidden");
  const redo = await stored(page, seed.workspaceKey);
  expect(redo.objects[b.id]).toEqual(b); expect(redo.ai).toEqual(current.ai); expect(redo.operations).toEqual(current.operations);
  expect(await agentTurnCallCount(page)).toBe(2);
});

test("manual paste/create and delete preserve identity and AI messages through real shortcuts and reload", async ({ page }) => {
  const seed = await seedProject(page); await installAgentMock(page); await page.goto(`/projects/${seed.seedProjectId}`); await expect(page.locator(".tl-container")).toBeVisible(); await clickEmptyCanvas(page);
  await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.setData("text/plain", "P6H manual pasted text");
    document.querySelector(".tl-container")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect.poll(async () => Object.values((await stored(page, seed.workspaceKey)).objects).some((o) => o.title === "P6H manual pasted text")).toBe(true);
  const created = Object.values((await stored(page, seed.workspaceKey)).objects).find((o) => o.title === "P6H manual pasted text")!;
  await setAgentResponse(page, { kind: "stream", chunks: textAnswerScript().chunks }); await page.locator(".ai-panel textarea").fill("请给出一句简短回应。"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(async () => agentTurnCallCount(page)).toBe(1); await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  const ai = (await stored(page, seed.workspaceKey)).ai;
  await mutationKey(page); await expect.poll(async () => (await stored(page, seed.workspaceKey)).objects[created.id]).toBeUndefined();
  await mutationKey(page, "Control+Shift+z"); await expect.poll(async () => (await stored(page, seed.workspaceKey)).objects[created.id]?.incarnationId).toBe(created.incarnationId);
  await page.getByRole("button", { name: "收起 AI 面板", exact: true }).click();
  await page.getByRole("button", { name: "回到项目概览", exact: true }).click();
  await page.waitForTimeout(500);
  await selectStoredObject(page, seed.workspaceKey, created.id);
  await page.getByRole("button", { name: "删除对象", exact: true }).click(); await expect.poll(async () => (await stored(page, seed.workspaceKey)).objects[created.id]).toBeUndefined();
  await mutationKey(page); await expect.poll(async () => (await stored(page, seed.workspaceKey)).objects[created.id]?.incarnationId).toBe(created.incarnationId);
  await mutationKey(page, "Control+y"); await expect.poll(async () => (await stored(page, seed.workspaceKey)).objects[created.id]).toBeUndefined();
  expect((await stored(page, seed.workspaceKey)).ai).toEqual(ai);
  await page.reload(); await expect(page.locator(shapeSelector(seed.objectIds.research))).toBeVisible();
  expect((await stored(page, seed.workspaceKey)).objects[created.id]).toBeUndefined(); expect((await stored(page, seed.workspaceKey)).ai).toEqual(ai);
  await expect(page.getByRole("button", { name: "撤销人工操作", exact: true })).toBeDisabled();
});

test("detail source navigation preserves mutation shortcut ownership and has its own Alt+Left return", async ({ page }) => {
  const seed = await seedProject(page);
  await page.addInitScript(({ key, from, to }) => {
    const w = JSON.parse(localStorage.getItem(key)!);
    if (!w.relations.some((r: { id: string }) => r.id === "p6h-navigation-source")) {
      w.relations.push({ id: "p6h-navigation-source", kind: "source", fromObjectId: from, toObjectId: to, note: "source navigation fixture" });
      localStorage.setItem(key, JSON.stringify(w));
    }
  }, { key: seed.workspaceKey, from: seed.objectIds.defaultReferenceImage, to: seed.objectIds.derivedImage });
  await page.goto(`/projects/${seed.seedProjectId}`);
  // Give the fixture one real source relation, so the source tab is meaningful.
  await selectObject(page, seed.objectIds.research); await page.getByRole("button", { name: "隐藏对象", exact: true }).click();
  await selectObject(page, seed.objectIds.derivedImage); await page.getByRole("tab", { name: "来源", exact: true }).click();
  const source = page.locator("button.detail-object-reference").first(); await expect(source).toBeVisible(); const id = await source.getAttribute("data-object-id"); expect(id).toBeTruthy(); await source.click();
  await expect.poll(async () => (await readStoredWorkspace(page)).ui.lastSelectionIds).toEqual([id]);
  await expect.poll(async () => (await readStoredWorkspace(page)).canvas.view.zoom).toBeGreaterThan(1);
  const view = (await readStoredWorkspace(page)).canvas.view;
  await mutationKey(page); await expect.poll(async () => (await readStoredWorkspace(page)).objects[seed.objectIds.research].visibility).toBe("active");
  expect((await readStoredWorkspace(page)).canvas.view).toEqual(view);
  await mutationKey(page, "Control+y"); await expect.poll(async () => (await readStoredWorkspace(page)).objects[seed.objectIds.research].visibility).toBe("hidden");
  await mutationKey(page, "Alt+ArrowLeft"); await expect.poll(async () => (await readStoredWorkspace(page)).ui.lastSelectionIds).toEqual([seed.objectIds.derivedImage]);
});

test("Delivery section/reference/editorial mutations undo in order and retain a valid Editable Backup", async ({ page }) => {
  const seed = await seedTextOnlyProject(page); await page.goto(`/projects/${seed.textOnly.projectId}`);
  await page.getByRole("button", { name: "知道了", exact: true }).click();
  await page.getByRole("button", { name: "交付准备", exact: true }).click();
  const panel = page.locator('section[aria-label="交付准备"]'); await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "新建", exact: true }).click();
  await panel.getByLabel("章节标题", { exact: true }).fill("P6H edited section");
  await mutationKey(page); await expect(panel.getByLabel("章节标题", { exact: true })).not.toHaveValue("P6H edited section");
  await mutationKey(page, "Control+y"); await expect(panel.getByLabel("章节标题", { exact: true })).toHaveValue("P6H edited section");
  await panel.getByRole("button", { name: "关闭交付准备" }).click();
  // Text-only fixture cards share stable selectors through the main seed helper.
  await page.getByRole("button", { name: "回到项目概览", exact: true }).click();
  await page.waitForTimeout(500);
  await selectStoredObject(page, seed.textOnly.workspaceKey, seed.textOnly.objectIds.keyConclusion);
  await page.getByRole("button", { name: "交付准备", exact: true }).click();
  await panel.getByRole("button", { name: "加入当前选中对象", exact: true }).click();
  const key = seed.textOnly.workspaceKey;
  await expect.poll(async () => Object.keys((await stored(page, key)).deliveryReferences).length).toBe(1);
  await panel.getByPlaceholder("图注 / 引用说明").fill("P6H caption");
  await mutationKey(page); await expect(panel.getByPlaceholder("图注 / 引用说明")).toHaveValue("");
  await mutationKey(page, "Control+Shift+z"); await expect(panel.getByPlaceholder("图注 / 引用说明")).toHaveValue("P6H caption");
  await panel.getByPlaceholder("内部备注").fill("P6H note"); await mutationKey(page); await expect(panel.getByPlaceholder("内部备注")).toHaveValue(""); await mutationKey(page, "Control+y"); await expect(panel.getByPlaceholder("内部备注")).toHaveValue("P6H note");
  await panel.getByRole("button", { name: "移除引用", exact: true }).click(); await expect.poll(async () => Object.keys((await stored(page, key)).deliveryReferences).length).toBe(0);
  await mutationKey(page); await expect(panel.getByPlaceholder("图注 / 引用说明")).toHaveValue("P6H caption");
  await panel.getByRole("button", { name: "关闭交付准备" }).click(); await page.getByRole("button", { name: "归档", exact: true }).click();
  const archive = page.locator('[aria-label="项目归档与恢复"]');
  const [download] = await Promise.all([page.waitForEvent("download"), archive.getByRole("button", { name: "导出备份", exact: true }).click()]);
  const dir = await mkdtemp(join(tmpdir(), "morpho-p6h-backup-")), path = join(dir, download.suggestedFilename()); await download.saveAs(path); await archive.locator('input[type="file"]').setInputFiles(path);
  await expect(page.locator(".restore-preview-card")).toBeVisible();
  await page.reload(); await expect(page.locator(".morpho-shape-host").first()).toBeVisible();
  const reloaded = await stored(page, key); expect(Object.values(reloaded.deliveryReferences)[0].editorial).toEqual({ caption: "P6H caption", note: "P6H note" });
});

test("Delivery section Undo/Redo compensates its actual Continuity, Current Focus and current projections", async ({ page }) => {
  const seed = await seedTextOnlyProject(page), key = seed.textOnly.workspaceKey;
  await page.goto(`/projects/${seed.textOnly.projectId}`); await page.getByRole("button", { name: "知道了", exact: true }).click();
  await page.getByRole("button", { name: "交付准备", exact: true }).click();
  const panel = page.locator('section[aria-label="交付准备"]');
  const initial = await stored(page, key);
  await panel.getByRole("button", { name: "新建", exact: true }).click();
  await expect(panel.getByLabel("新增章节标题", { exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page, key)).projectContinuity.recordEntries.some((entry) => entry.dedupeKey.startsWith("deliveryPreparationChanged:created:") && !initial.projectContinuity.recordEntries.some((old) => old.id === entry.id))).toBe(true);
  const before = await stored(page, key);
  await panel.getByLabel("新增章节标题", { exact: true }).fill("P6H continuity section"); await panel.getByRole("button", { name: "新增章节", exact: true }).click();
  const hasSection = async () => Object.values((await stored(page, key)).objects).some((object) => object.type === "delivery" && object.sections.some((section) => section.title === "P6H continuity section"));
  await expect.poll(hasSection).toBe(true);
  const after = await stored(page, key), entry = after.projectContinuity.recordEntries.find((entry) => !before.projectContinuity.recordEntries.some((old) => old.id === entry.id) && entry.dedupeKey.startsWith("deliveryPreparationChanged:sectionChanged:"))!;
  expect(entry).toBeDefined();
  await mutationKey(page); await expect.poll(hasSection).toBe(false);
  const undo = await stored(page, key);
  expect(undo.projectContinuity.recordEntries.find((record) => record.id === entry.id)).toMatchObject({ summary: entry.summary, manualState: "withdrawn" });
  expect(undo.projectContinuity.currentFocus).toEqual(before.projectContinuity.currentFocus);
  expect(JSON.stringify(currentProjections(undo))).not.toContain(entry.id);
  expect(JSON.stringify(currentProjections(undo))).not.toContain(entry.summary);
  await mutationKey(page, "Control+Shift+z"); await expect.poll(hasSection).toBe(true);
  const redo = await stored(page, key);
  expect(redo.projectContinuity.recordEntries.find((record) => record.id === entry.id)?.manualState).toBe("active");
  expect(redo.projectContinuity.currentFocus).toEqual(after.projectContinuity.currentFocus);
  expect(JSON.stringify(currentProjections(redo))).toContain(entry.summary);
  expect(JSON.stringify(currentProjections(redo).stageMetadata)).toContain(entry.id);
});


test("Direction status shortcuts are symmetric; later Agent confirmation causes an explicit retained conflict", async ({ page }) => {
  const seed = await seedTextOnlyProject(page); await installAgentMock(page);
  const key = seed.textOnly.workspaceKey;
  await page.addInitScript((key) => {
    const w = JSON.parse(localStorage.getItem(key)!);
    if (w.objects["p6h-direction-a"]) return;
    const id = "p6h-direction-a", revisionId = "p6h-direction-a-v1";
    w.objects[id] = { id, incarnationId: "p6h-direction-incarnation", type: "conceptDirection", title: "P6H direction", summary: "manual status fixture", createdBy: "user", visibility: "active", status: "primary", keywords: [], currentRevisionId: revisionId, revisionIds: [revisionId], lineageRootId: id };
    w.directionRevisions[revisionId] = { id: revisionId, directionId: id, revisionNumber: 1, title: "P6H direction", summary: "manual status fixture", conceptStatement: "fixture", keywords: [], strategy: "fixture", differentiators: [], visualSignals: [], risks: [], openQuestions: [], sourceObjectIds: [], citationIds: [], createdAt: "2026-10-03T00:00:00Z", isCurrent: true };
    w.canvas.instances.push({ id: "p6h-direction-instance", objectId: id, position: { x: 140, y: 430 }, size: { w: 260, h: 180 } });
    localStorage.setItem(key, JSON.stringify(w));
  }, key);
  await page.goto(`/projects/${seed.textOnly.projectId}`); await selectStoredObject(page, key, "p6h-direction-a");
  await page.getByRole("button", { name: "设为备选方向", exact: true }).click();
  await expect.poll(async () => (await stored(page, key)).workingState.primaryDirectionId).toBeUndefined();
  await mutationKey(page); await expect.poll(async () => (await stored(page, key)).workingState.primaryDirectionId).toBe("p6h-direction-a");
  await mutationKey(page, "Control+y"); await expect.poll(async () => (await stored(page, key)).workingState.primaryDirectionId).toBeUndefined();
  const script = toolCallTurnScript({ toolName: "request_confirmation", argumentsText: JSON.stringify({ action: "eliminateDirection", targetObjectId: "p6h-direction-a", reason: "独立 Agent 状态动作", impact: "淘汰方向并保留历史" }) });
  const read = toolCallTurnScript({ toolName: "read_selected_context", argumentsText: "{}" });
  await setAgentRequestScript(page, [{ kind: "stream", chunks: read.first }, { kind: "stream", chunks: script.first.map((chunk) => chunk.replaceAll("call-e2e-tool-1", "call-p6h-confirm")) }, { kind: "stream", chunks: script.second }]);
  await page.locator(".ai-panel textarea").fill("请淘汰当前选中的方向，先请求我确认。"); await page.getByRole("button", { name: "发送", exact: true }).click();
  const confirmation = page.locator(".confirm-card").first(); await expect(confirmation).toBeVisible(); await confirmation.locator("button.brand-button").click();
  await expect.poll(async () => (await stored(page, key)).objects["p6h-direction-a"]).toMatchObject({ status: "eliminated" });
  const current = await stored(page, key), calls = await agentTurnCallCount(page);
  for (let i = 0; i < 2; i++) {
    await mutationKey(page); await expect(page.getByText("撤销已暂停", { exact: false })).toBeVisible();
    expect(await stored(page, key)).toEqual(current);
  }
  await expect(page.getByRole("button", { name: "撤销人工操作", exact: true })).toBeEnabled();
  expect(await agentTurnCallCount(page)).toBe(calls);
});
