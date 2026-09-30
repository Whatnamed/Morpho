import { expect, test } from "@playwright/test";
import { seedPayload, seedTextOnlyProject } from "./fixtures/seed";

test("schema 17 Research remains review-required and an unbound item inherits no whole-card citations", async ({ page }) => {
  const seed = seedPayload();
  await page.addInitScript((seed) => {
    if (localStorage.getItem(seed.textOnly.workspaceKey) !== null) return;
    const workspace = JSON.parse(seed.textOnly.workspaceValue);
    workspace.schemaVersion = 17;
    const research = workspace.objects[seed.textOnly.objectIds.research];
    research.provenance = { operationId: "historical-research", proposalId: "historical-proposal", sourceObjectIds: [], citationIds: ["historical-unbound-citation"], didUseWebSearch: true };
    localStorage.setItem(seed.catalogKey, seed.textOnly.catalogValue);
    localStorage.setItem(seed.textOnly.workspaceKey, JSON.stringify(workspace));
  }, seed);
  await page.goto(`/projects/${seed.textOnly.projectId}`);
  const workspace = JSON.parse(seed.textOnly.workspaceValue);
  const instance = workspace.canvas.instances.find((instance: { objectId: string }) => instance.objectId === seed.textOnly.objectIds.research);
  const shape = page.locator(`.tl-shape[data-shape-id="shape:${instance.id}"]`);
  await expect(shape).toBeVisible();
  const box = await shape.boundingBox();
  if (!box) throw new Error("Research shape missing");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("button", { name: "查看研究详情" })).toBeVisible();
  await page.getByRole("button", { name: "查看研究详情" }).click();
  const panel = page.getByRole("dialog", { name: "研究与分析详情" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("依据待复核").first()).toBeVisible();
  const item = panel.locator(".research-panel-item").first();
  const text = await item.locator(".research-panel-item-text").innerText();
  await item.click();
  await panel.getByRole("button", { name: "更新画布摘录" }).click();
  await expect.poll(async () => page.evaluate(({ key, text, existingId }) => {
    const workspace = JSON.parse(localStorage.getItem(key)!);
    const conclusion = Object.values(workspace.objects).find((object) => {
      const item = object as { id: string; type: string; body?: string };
      return item.id !== existingId && item.type === "keyConclusion" && item.body === text.replace(/\n/g, "：");
    }) as { confidence?: string; citationIds?: string[] } | undefined;
    return { schemaVersion: workspace.schemaVersion, confidence: conclusion?.confidence, citationIds: conclusion?.citationIds };
  }, { key: seed.textOnly.workspaceKey, text, existingId: seed.textOnly.objectIds.keyConclusion })).toEqual({ schemaVersion: 18, confidence: "needsVerification", citationIds: [] });
});

test("a user resolves and restores an open question through the domain UI and persists its provenance", async ({ page }) => {
  const seed = await seedTextOnlyProject(page);
  const question = "单手操作是否可行仍待确认";
  await page.addInitScript(({ key, value, question }) => {
    if (localStorage.getItem(key) && JSON.parse(localStorage.getItem(key)!).projectContinuity.recordEntries.some((entry: { id: string }) => entry.id === "semantic-question")) return;
    const workspace = JSON.parse(value);
    const createdAt = "2026-09-30T00:00:00.000Z";
    workspace.ai.messages.push({ id: "question-user", role: "user", body: question, createdAt, contextVisibility: "model" });
    workspace.projectContinuity.recordEntries.push({ id: "semantic-question", dedupeKey: "semantic-question", origin: "conversationSemanticPatch", manualState: "active", stage: "research", category: "openQuestion", semanticKind: "openQuestion", scope: "project", summary: `待确认问题：${question}`, evidenceQuote: question, sourceMessageId: "question-user", sourceRefs: [{ kind: "message", id: "question-user", snapshot: { title: "用户原话", summarySnippet: question } }], createdAt, updatedAt: createdAt, validity: "current" });
    localStorage.setItem(key, JSON.stringify(workspace));
  }, { key: seed.textOnly.workspaceKey, value: seed.textOnly.workspaceValue, question });
  await page.goto(`/projects/${seed.textOnly.projectId}`);
  await page.getByRole("button", { name: "项目记录", exact: true }).click();
  await page.getByRole("tab", { name: "历史与来源" }).click();
  const row = page.locator("article.continuity-record").filter({ hasText: question });
  await row.getByRole("button", { name: "标记已解决" }).click();
  const state = () => page.evaluate((key) => {
    const workspace = JSON.parse(localStorage.getItem(key)!);
    const entry = workspace.projectContinuity.recordEntries.find((entry: { id: string }) => entry.id === "semantic-question");
    return { manualState: entry?.manualState, origin: entry?.lifecycleEvidence?.origin };
  }, seed.textOnly.workspaceKey);
  await expect.poll(state).toEqual({ manualState: "resolved", origin: "userAction" });
  await page.reload();
  await page.getByRole("button", { name: "项目记录", exact: true }).click();
  await page.getByRole("tab", { name: "历史与来源" }).click();
  await expect(row.getByText("已解决", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "恢复为当前有效" }).click();
  await expect.poll(state).toEqual({ manualState: "active", origin: "userAction" });
});
