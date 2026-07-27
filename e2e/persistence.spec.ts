import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { readStoredWorkspace, seedProject, seedTextOnlyProject, shapeSelector } from "./fixtures/seed";
import { selectObject } from "./fixtures/canvas";

test.describe("项目持久化", () => {
  test("刷新后恢复项目内容、画布视图与选择", async ({ page }) => {
    const seed = await seedProject(page);
    await page.goto(`/projects/${seed.seedProjectId}`);
    await expect(page.locator(shapeSelector(seed.objectIds.keyConclusion))).toBeVisible();

    await selectObject(page, seed.objectIds.keyConclusion);

    // Pan the canvas so the restored view is distinguishable from the seeded one.
    await page.mouse.move(600, 500);
    await page.mouse.wheel(140, 220);
    await expect
      .poll(async () => {
        const view = (await readStoredWorkspace(page)).canvas.view;
        return view.x !== 0 || view.y !== 0;
      })
      .toBe(true);

    const before = await readStoredWorkspace(page);
    await page.reload();
    await expect(page.locator(shapeSelector(seed.objectIds.keyConclusion))).toBeVisible();

    const after = await readStoredWorkspace(page);
    expect(Object.keys(after.objects).sort()).toEqual(Object.keys(before.objects).sort());
    expect(after.canvas.view.x).toBeCloseTo(before.canvas.view.x, 1);
    expect(after.canvas.view.y).toBeCloseTo(before.canvas.view.y, 1);
    expect(after.canvas.view.zoom).toBeCloseTo(before.canvas.view.zoom, 3);
    // The persisted selection survives the reload as data.
    expect(after.ui.lastSelectionIds).toEqual([seed.objectIds.keyConclusion]);
  });

  test("刷新后画布重新选中上次选择的对象", async ({ page }) => {
    const seed = await seedProject(page);
    await page.goto(`/projects/${seed.seedProjectId}`);
    await expect(page.locator(shapeSelector(seed.objectIds.keyConclusion))).toBeVisible();
    await selectObject(page, seed.objectIds.keyConclusion);
    await expect
      .poll(async () => (await readStoredWorkspace(page)).ui.lastSelectionIds)
      .toEqual([seed.objectIds.keyConclusion]);

    await page.reload();
    await expect(page.locator(shapeSelector(seed.objectIds.keyConclusion))).toBeVisible();
    await expect(page.locator('[aria-label="选中对象工具"]')).toBeVisible();
  });

  test("导出可编辑备份后能恢复成新的独立项目副本", async ({ page }) => {
    // Uses the asset-free project: an editable backup embeds every binary, and a
    // project whose blobs are missing is correctly refused rather than exported.
    const seed = await seedTextOnlyProject(page);
    await page.goto(`/projects/${seed.textOnly.projectId}`);
    await expect(page.locator(".morpho-shape-host").first()).toBeVisible();

    await page.getByRole("button", { name: "归档" }).click();
    const panel = page.locator('[aria-label="项目归档与恢复"]');
    await expect(panel).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: "导出备份" }).click()
    ]);
    const backupDir = await mkdtemp(join(tmpdir(), "morpho-e2e-backup-"));
    const backupPath = join(backupDir, download.suggestedFilename());
    await download.saveAs(backupPath);
    expect(download.suggestedFilename()).toMatch(/\.zip$/);

    await panel.locator('input[type="file"]').setInputFiles(backupPath);

    // Restoring is a two-step decision: a preview first, nothing written yet.
    const preview = page.locator(".restore-preview-card");
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(preview).toContainText("不会覆盖当前项目");
    const projectKeysBeforeConfirm = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) => key.startsWith("morpho.project."))
    );
    expect(projectKeysBeforeConfirm).toHaveLength(1);

    // The archive panel does not scroll, so its confirm row falls below a 900px
    // viewport once the restore preview is open (see the reachability test below).
    // Give the window the height a user would need until that is fixed.
    await page.setViewportSize({ width: 1440, height: 1200 });
    await preview.getByRole("button", { name: "确认恢复" }).click();

    await expect
      .poll(
        async () =>
          page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("morpho.project.")).length),
        { timeout: 30_000 }
      )
      .toBe(2);

    // The original project must be untouched by the restore.
    const original = await readStoredWorkspace(page, seed.textOnly.projectId);
    expect(original.project.id).toBe(seed.textOnly.projectId);
    expect(Object.keys(original.objects)).toHaveLength(2);

    const restoredKey = (
      await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("morpho.project.")))
    ).find((key) => !key.includes(seed.textOnly.projectId));
    expect(restoredKey).toBeDefined();

    const restored = JSON.parse(
      (await page.evaluate((key: string) => window.localStorage.getItem(key), restoredKey as string)) ?? "null"
    ) as Awaited<ReturnType<typeof readStoredWorkspace>>;
    expect(restored.project.id).not.toBe(seed.textOnly.projectId);
    expect(Object.keys(restored.objects).sort()).toEqual(Object.keys(original.objects).sort());
  });

  // KNOWN GAP (2026-07-27): `.archive-panel` is ~975px tall with `overflow-y:
  // hidden`, so opening the restore preview pushes 取消/确认恢复 to y≈928 — off
  // screen and unreachable on any window shorter than that, with no way to scroll
  // to them. Kept as a failing expectation so the fix has a test to turn green.
  test.fail("恢复预览的确认按钮在 900px 高的窗口里可点", async ({ page }) => {
    const seed = await seedTextOnlyProject(page);
    await page.goto(`/projects/${seed.textOnly.projectId}`);
    await expect(page.locator(".morpho-shape-host").first()).toBeVisible();

    await page.getByRole("button", { name: "归档" }).click();
    const panel = page.locator('[aria-label="项目归档与恢复"]');
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: "导出备份" }).click()
    ]);
    const backupDir = await mkdtemp(join(tmpdir(), "morpho-e2e-reach-"));
    const backupPath = join(backupDir, download.suggestedFilename());
    await download.saveAs(backupPath);
    await panel.locator('input[type="file"]').setInputFiles(backupPath);

    const confirmRestore = page.locator(".restore-preview-card").getByRole("button", { name: "确认恢复" });
    await expect(confirmRestore).toBeVisible({ timeout: 20_000 });
    const box = await confirmRestore.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0);
  });
});
