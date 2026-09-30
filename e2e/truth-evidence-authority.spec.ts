import { expect, test } from "@playwright/test";
import { seedPayload } from "./fixtures/seed";

test("Delivery action history does not request review while a reused-ID Decision does", async ({ page }) => {
  const seed = seedPayload();
  await page.addInitScript(({ key, value, catalogKey, catalogValue, conclusionId }) => {
    if (localStorage.getItem(key) !== null) return;
    const workspace = JSON.parse(value);
    workspace.objects[conclusionId].incarnationId = "later-created-conclusion";
    const createdAt = "2026-10-01T00:00:00Z";
    const kinds = ["createDeliveryPreparation", "removeDeliveryReference", "refreshDeliveryReference", "applyDeliverySectionDraft"];
    workspace.decisionRecords = kinds.map((kind, index) => ({ id: `delivery-event-${index}`, kind, summary: `Delivery 动作 ${index}`, createdAt, relatedObjectIds: [] }));
    workspace.decisionRecords.push({ id: "previous-conclusion-decision", kind: "createKeyConclusion", summary: "原对象保留结论", createdAt, relatedObjectIds: [conclusionId], effect: { kind: "createKeyConclusion", targetObjectId: conclusionId, targetIncarnationId: "original-created-conclusion" } });
    localStorage.setItem(catalogKey, catalogValue);
    localStorage.setItem(key, JSON.stringify(workspace));
  }, { key: seed.textOnly.workspaceKey, value: seed.textOnly.workspaceValue, catalogKey: seed.catalogKey, catalogValue: seed.textOnly.catalogValue, conclusionId: seed.textOnly.objectIds.keyConclusion });
  await page.goto(`/projects/${seed.textOnly.projectId}`);
  await page.getByRole("button", { name: "项目记录", exact: true }).click();
  await page.getByRole("tab", { name: "历史与来源" }).click();
  for (let index = 0; index < 4; index += 1) {
    const row = page.locator("article.continuity-record").filter({ hasText: `Delivery 动作 ${index}` });
    await expect(row.getByText("历史记录", { exact: true })).toBeVisible();
    await expect(row.getByText("待复核", { exact: true })).toHaveCount(0);
  }
  const old = page.locator("article.continuity-record").filter({ hasText: "原对象保留结论" });
  await expect(old.getByText("待复核", { exact: true })).toBeVisible();
  await expect(old).toContainText("同 ID 新对象不能继承旧决定");
});

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
  await expect(page.locator('[aria-label="当前输入语境"]')).toContainText("已选 1");
  await expect(page.getByRole("button", { name: "查看研究详情" })).toBeVisible();
  await page.getByRole("button", { name: "查看研究详情" }).click();
  const panel = page.getByRole("dialog", { name: "研究与分析详情" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("依据待复核").first()).toBeVisible();
  const item = panel.locator(".research-panel-item:not(.selected)").first();
  await item.click();
  await panel.getByRole("button", { name: "更新画布摘录" }).click();
  await expect.poll(async () => page.evaluate(({ key, existingId, researchId }) => {
    const workspace = JSON.parse(localStorage.getItem(key)!);
    const conclusion = Object.values(workspace.objects).find((object) => {
      const item = object as { id: string; type: string; researchOrigin?: { researchObjectId: string } };
      return item.id !== existingId && item.type === "keyConclusion" && item.researchOrigin?.researchObjectId === researchId;
    }) as { confidence?: string; citationIds?: string[] } | undefined;
    return { schemaVersion: workspace.schemaVersion, confidence: conclusion?.confidence, citationIds: conclusion?.citationIds };
  }, { key: seed.textOnly.workspaceKey, existingId: seed.textOnly.objectIds.keyConclusion, researchId: seed.textOnly.objectIds.research })).toEqual({ schemaVersion: 18, confidence: "needsVerification", citationIds: [] });
});

test("a user resolves and restores an open question through the domain UI and persists its provenance", async ({ page }) => {
  const seed = seedPayload();
  const question = "单手操作是否可行仍待确认";
  await page.addInitScript(({ key, value, catalogKey, catalogValue, question }) => {
    if (localStorage.getItem(key) !== null) return;
    const workspace = JSON.parse(value);
    const createdAt = "2026-09-30T00:00:00.000Z";
    workspace.ai.messages.push({ id: "question-user", role: "user", body: question, createdAt, contextVisibility: "model" });
    workspace.projectContinuity.recordEntries.push({ id: "semantic-question", dedupeKey: "semantic-question", origin: "conversationSemanticPatch", manualState: "active", stage: "research", category: "openQuestion", semanticKind: "openQuestion", scope: "project", summary: `待确认问题：${question}`, evidenceQuote: question, sourceMessageId: "question-user", sourceRefs: [{ kind: "message", id: "question-user", snapshot: { title: "用户原话", summarySnippet: question } }], createdAt, updatedAt: createdAt, validity: "current" });
    localStorage.setItem(catalogKey, catalogValue);
    localStorage.setItem(key, JSON.stringify(workspace));
  }, { key: seed.textOnly.workspaceKey, value: seed.textOnly.workspaceValue, catalogKey: seed.catalogKey, catalogValue: seed.textOnly.catalogValue, question });
  await page.goto(`/projects/${seed.textOnly.projectId}`);
  await page.getByRole("button", { name: "项目记录", exact: true }).click();
  await page.getByRole("tab", { name: "历史与来源" }).click();
  const row = page.locator("article.continuity-record").filter({ hasText: question });
  await row.getByRole("button", { name: "标记已解决" }).click();
  const state = () => page.evaluate((key) => {
    const workspace = JSON.parse(localStorage.getItem(key)!);
    const entry = workspace.projectContinuity.recordEntries.find((entry: { dedupeKey: string }) => entry.dedupeKey === "semantic-question");
    return { manualState: entry?.manualState, origin: entry?.lifecycleEvidence?.origin };
  }, seed.textOnly.workspaceKey);
  await expect.poll(state).toEqual({ manualState: "resolved", origin: "userAction" });
  await page.reload();
  await page.getByRole("button", { name: "项目记录", exact: true }).click();
  await page.getByRole("tab", { name: "历史与来源" }).click();
  await expect(row.getByText("已解决", { exact: true }).first()).toBeVisible();
  await row.getByRole("button", { name: "恢复为当前有效" }).click();
  await expect.poll(state).toEqual({ manualState: "active", origin: "userAction" });
});
