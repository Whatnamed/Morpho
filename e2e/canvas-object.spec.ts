import { expect, test } from "@playwright/test";

import { readStoredWorkspace, seedProject, shapeSelector } from "./fixtures/seed";
import { clickEmptyCanvas, selectObject } from "./fixtures/canvas";
import { agentTurnCallCount, installAgentMock, setAgentResponse } from "./fixtures/agentMock";
import { textAnswerScript } from "./support/agentSse";

test.describe("画布对象操作", () => {
  test("选中对象后点击空白处取消选择", async ({ page }) => {
    const seed = await seedProject(page);
    await page.goto(`/projects/${seed.seedProjectId}`);

    const toolbar = page.locator('[aria-label="选中对象工具"]');
    await expect(page.locator(shapeSelector(seed.objectIds.keyConclusion))).toBeVisible();
    await expect(toolbar).toBeHidden();

    await selectObject(page, seed.objectIds.keyConclusion);
    await expect(toolbar).toBeVisible();
    await expect
      .poll(async () => (await readStoredWorkspace(page)).ui.lastSelectionIds)
      .toEqual([seed.objectIds.keyConclusion]);

    await clickEmptyCanvas(page);

    await expect(toolbar).toBeHidden();
    await expect
      .poll(async () => (await readStoredWorkspace(page)).ui.lastSelectionIds)
      .toEqual([]);
  });

  test("隐藏对象后可以从已隐藏内容里恢复", async ({ page }) => {
    const seed = await seedProject(page);
    await page.goto(`/projects/${seed.seedProjectId}`);

    await selectObject(page, seed.objectIds.research);
    await page.locator('[aria-label="隐藏对象"]').click();

    await expect(page.locator(shapeSelector(seed.objectIds.research))).toBeHidden();
    await expect
      .poll(async () => (await readStoredWorkspace(page)).objects[seed.objectIds.research]?.visibility)
      .toBe("hidden");
    // Hiding is not deleting: the object must still be in the workspace.
    expect((await readStoredWorkspace(page)).objects[seed.objectIds.research]).toBeDefined();

    await page.getByRole("button", { name: "已隐藏内容", exact: true }).click();
    const drawer = page.locator('section.side-drawer[aria-label="已隐藏内容"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "恢复并定位" }).first()).toBeVisible();

    await drawer.getByRole("button", { name: "恢复并定位" }).first().click();

    await expect
      .poll(async () => (await readStoredWorkspace(page)).objects[seed.objectIds.research]?.visibility)
      .toBe("active");
    await expect(page.locator(shapeSelector(seed.objectIds.research))).toBeVisible();
  });

  test("替换后续默认参考先给出两个选项，未确认前不改状态", async ({ page }) => {
    const seed = await seedProject(page);
    await page.goto(`/projects/${seed.seedProjectId}`);

    await selectObject(page, seed.objectIds.otherImage);
    await page.locator('[aria-label="设为后续默认参考"]').click();

    const confirmCard = page.locator(".confirm-card").first();
    await expect(confirmCard).toBeVisible();
    // Both options are offered because the seed keeps one image generated from
    // the current anchor; neither is preselected.
    const replaceOnly = confirmCard.getByRole("button", { name: "只替换默认参考" });
    const replaceAndReview = confirmCard.getByRole("button", { name: "替换并标记相关素材待复核" });
    await expect(replaceOnly).toBeVisible();
    await expect(replaceAndReview).toBeVisible();

    // The anchor must not move until the person picks one of the two options.
    const beforeChoice = await readStoredWorkspace(page);
    expect(beforeChoice.workingState.currentDefaultReferenceId).toBe(seed.objectIds.defaultReferenceImage);

    await replaceOnly.click();

    await expect
      .poll(async () => (await readStoredWorkspace(page)).workingState.currentDefaultReferenceId)
      .toBe(seed.objectIds.otherImage);
    // "只替换" must not touch the derived material.
    const afterChoice = await readStoredWorkspace(page);
    expect(afterChoice.objects[seed.objectIds.derivedImage]?.pendingReview).toBeUndefined();
  });

  test("撤销遇到 AI 生成内容时暂停，并保留撤销历史", async ({ page }) => {
    const seed = await seedProject(page);
    await installAgentMock(page);
    await page.goto(`/projects/${seed.seedProjectId}`);

    // 1. A manual operation that is undoable on its own.
    await selectObject(page, seed.objectIds.research);
    await page.locator('[aria-label="隐藏对象"]').click();
    await expect
      .poll(async () => (await readStoredWorkspace(page)).objects[seed.objectIds.research]?.visibility)
      .toBe("hidden");

    // 2. An AI turn that adds messages after that snapshot.
    await setAgentResponse(page, { kind: "stream", chunks: textAnswerScript().chunks, chunkDelayMs: 10 });
    await page.locator(".ai-panel textarea").fill("请给出一个简短回应。");
    await page.locator('[aria-label="发送"]').click();
    await expect.poll(async () => agentTurnCallCount(page)).toBe(1);
    await expect
      .poll(async () => (await readStoredWorkspace(page)).ai.messages.length)
      .toBeGreaterThan(1);

    // 3. Undo now crosses the AI content and must stop rather than discard it.
    await page.keyboard.press("Control+z");
    const notice = page.getByText("撤销已暂停", { exact: false });
    await expect(notice).toBeVisible();
    expect((await readStoredWorkspace(page)).objects[seed.objectIds.research]?.visibility).toBe("hidden");

    // 4. The blocked attempt must not have consumed the entry: a second press is
    //    blocked the same way. A popped stack would report empty and stay silent.
    await expect(notice).toBeHidden({ timeout: 8_000 });
    await page.keyboard.press("Control+z");
    await expect(page.getByText("撤销已暂停", { exact: false })).toBeVisible();
  });
});
