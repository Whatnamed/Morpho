import { expect, test } from "@playwright/test";

import { seedPayload, seedTextOnlyProject } from "./fixtures/seed";

/**
 * Browser-side half of the storage capacity evidence.
 *
 * `npm run measure:storage` measures what Morpho content costs; this measures
 * what the browser actually grants, because the Node-side figures are only
 * meaningful against a real quota. Chromium is the reference browser here — the
 * numbers are logged, not hard-coded, so a browser change shows up as a changed
 * report rather than a mysterious failure.
 */

const MIB = 1024 * 1024;

test.describe("本地存储容量", () => {
  test("实测 localStorage 配额，并核对内置案例占用", async ({ page }) => {
    await page.goto("/");

    const probe = await page.evaluate(() => {
      const key = "morpho.e2e.quota-probe";
      // 64 KiB of UTF-16 code units per write. Browsers charge
      // (key.length + value.length) * 2 bytes per entry.
      const chunk = "x".repeat(32 * 1024);
      const values: string[] = [];
      let quotaBytes = 0;
      let threwQuotaError = false;

      try {
        for (let index = 0; index < 4096; index += 1) {
          const entryKey = `${key}.${index}`;
          window.localStorage.setItem(entryKey, chunk);
          values.push(entryKey);
          quotaBytes += (entryKey.length + chunk.length) * 2;
        }
      } catch (error) {
        threwQuotaError = error instanceof DOMException && error.name === "QuotaExceededError";
      }

      const alreadyUsed = Object.keys(window.localStorage)
        .filter((entryKey) => !entryKey.startsWith(key))
        .reduce((sum, entryKey) => sum + (entryKey.length + (window.localStorage.getItem(entryKey)?.length ?? 0)) * 2, 0);

      for (const entryKey of values) {
        window.localStorage.removeItem(entryKey);
      }

      return { writtenBytes: quotaBytes, alreadyUsed, threwQuotaError };
    });

    const totalQuota = probe.writtenBytes + probe.alreadyUsed;
    console.log(
      `localStorage 实测配额 ≈ ${(totalQuota / MIB).toFixed(2)} MiB ` +
        `（探针写入 ${(probe.writtenBytes / MIB).toFixed(2)} MiB，页面已占用 ${(probe.alreadyUsed / MIB).toFixed(2)} MiB）`
    );

    // The write loop must have stopped because the browser said no, not because
    // it ran out of iterations — otherwise the number below is not a quota.
    expect(probe.threwQuotaError).toBe(true);
    expect(totalQuota).toBeGreaterThan(4 * MIB);
  });

  test("内置案例装载后占用的实际配额", async ({ page }) => {
    const seed = seedPayload();
    await page.goto(`/projects/${seed.caseStudyProjectId}`);
    await expect(page.locator(".morpho-shape-host").first()).toBeAttached({ timeout: 30_000 });

    const usage = await page.evaluate(() => {
      const entries = Object.keys(window.localStorage).map((key) => ({
        key,
        bytes: (key.length + (window.localStorage.getItem(key)?.length ?? 0)) * 2
      }));
      return {
        totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
        entries: entries.sort((left, right) => right.bytes - left.bytes).slice(0, 5)
      };
    });

    console.log(
      `内置案例装载后 localStorage 占用 ${(usage.totalBytes / MIB).toFixed(2)} MiB：\n` +
        usage.entries.map((entry) => `  ${entry.key}  ${(entry.bytes / 1024).toFixed(0)} KiB`).join("\n")
    );

    // The deployable case study has to fit, with room for the user's own work.
    expect(usage.totalBytes).toBeGreaterThan(0);
    expect(usage.totalBytes).toBeLessThan(4 * MIB);
  });

  test("本机项目记录超过保守提示线时独立提醒，删除减负后消失", async ({ page }) => {
    const seed = await seedTextOnlyProject(page);
    await page.goto("/");
    await expect(page.locator(".phome-hero h2")).toBeVisible();

    const heavyTitle = await page.evaluate(({ workspaceKey }) => {
      const ws = JSON.parse(window.localStorage.getItem(workspaceKey)!);
      ws.ai.messages.push({
        id: "msg-heavy",
        role: "user",
        body: "文".repeat(2_200_000),
        createdAt: "2026-10-01T00:00:00.000Z"
      });
      window.localStorage.setItem(workspaceKey, JSON.stringify(ws));
      return ws.project.title as string;
    }, seed.textOnly);

    await page.reload();
    const footer = page.locator(".phome-foot");
    await expect(footer).toContainText("本机项目记录较多，建议导出备份；图片存储可用空间不代表项目记录仍可继续保存。");
    await expect(footer).not.toContainText("本地图片与文件存储空间已接近上限");
    await expect(footer).not.toContainText("%");

    await page.getByRole("button", { name: `删除项目：${heavyTitle}`, exact: true }).click();
    await page.getByRole("button", { name: "删除项目", exact: true }).click();
    await expect(page.getByText(`已删除“${heavyTitle}”。`)).toBeVisible();
    await expect(footer).not.toContainText("本机项目记录较多");
  });
});
