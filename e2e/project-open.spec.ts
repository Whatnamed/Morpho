import { expect, test } from "@playwright/test";

import { seedPayload, seedProject, shapeSelector } from "./fixtures/seed";

test.describe("打开项目", () => {
  test("空白项目落到空画布，不会预置内容", async ({ page }) => {
    const seed = seedPayload();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`/projects/${seed.blankProjectId}`);

    await expect(page.locator(".project-name strong")).toHaveText("未命名项目");
    await expect(page.locator('[aria-label="AI 对话"]')).toBeVisible();
    // A blank project must not inherit any other project's canvas objects.
    await expect(page.locator(".morpho-shape-host")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("内置案例带真实内容开出来，并保持项目 id 稳定", async ({ page }) => {
    const seed = seedPayload();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`/projects/${seed.caseStudyProjectId}`);

    await expect(page.locator(".project-name strong")).toHaveText("测试");
    await expect(page.locator(".morpho-shape-host").first()).toBeAttached({ timeout: 30_000 });
    const shapeCount = await page.locator(".morpho-shape-host").count();
    expect(shapeCount).toBeGreaterThan(10);

    const storedProjectIds = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) => key.startsWith("morpho.project."))
    );
    expect(storedProjectIds).toContain(`morpho.project.${seed.caseStudyProjectId}.workspace.v1`);
    expect(errors).toEqual([]);
  });

  test("预置的验收样本项目按种子状态开出来", async ({ page }) => {
    const seed = await seedProject(page);
    await page.goto(`/projects/${seed.seedProjectId}`);

    await expect(page.locator(".project-name strong")).toHaveText(seed.seedProjectTitle);
    await expect(page.locator(shapeSelector(seed.objectIds.keyConclusion))).toBeVisible();
    await expect(page.locator(".morpho-shape-host")).toHaveCount(Object.keys(seed.canvasInstanceIds).length);
  });
});
