import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { getProjectWriteLockName, PROJECT_CATALOG_WRITE_LOCK_NAME } from "../src/infrastructure/persistence/projectWriteLock";
import { readStoredWorkspace, seedTextOnlyProject } from "./fixtures/seed";
import type { SeedPayload } from "./support/seedWorkspace";

async function seedTwoProjects(page: Page) {
  const seed = await seedTextOnlyProject(page);
  await page.goto("/");
  await expect(page.locator(".phome-hero h2")).toBeVisible();
  await page.evaluate(({ catalogKey, catalogValue, workspaceKey, workspaceValue }) => {
    const catalog = JSON.parse(catalogValue);
    catalog.projects.push(JSON.parse(localStorage.getItem(catalogKey)!).projects[0]);
    localStorage.setItem(catalogKey, JSON.stringify(catalog));
    localStorage.setItem(workspaceKey, workspaceValue);
  }, seed);
  await page.reload();
  await expect(page.getByRole("button", { name: "重命名项目：" + seed.seedProjectTitle })).toBeVisible();
  return seed;
}

function openRename(page: Page, title: string) {
  return page.getByRole("button", { name: "重命名项目：" + title, exact: true }).click();
}

function openDelete(page: Page, title: string) {
  return page.getByRole("button", { name: "删除项目：" + title, exact: true }).click();
}

test("工作台占锁时首页管理零写入，释放后可改名并删除", async ({ page, context }) => {
  const seed = await seedTextOnlyProject(page);
  const { projectId, workspaceKey } = seed.textOnly;
  const title = (JSON.parse(seed.textOnly.workspaceValue) as { project: { title: string } }).project.title;
  await page.goto("/projects/" + projectId);
  await expect(page.locator(".project-name strong")).toHaveText(title);
  await expect.poll(() => page.evaluate(async (name) =>
    (await navigator.locks.query()).held?.some((lock) => lock.name === name), getProjectWriteLockName(projectId)
  )).toBe(true);

  const home = await context.newPage();
  await home.goto("/");
  await home.evaluate(() => {
    const { setItem, removeItem } = Storage.prototype;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage) setItem.call(sessionStorage, "home-write", key);
      setItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === localStorage) setItem.call(sessionStorage, "home-write", key);
      removeItem.call(this, key);
    };
  });

  await openRename(home, title);
  await home.getByRole("textbox", { name: "项目名称" }).fill("跨页改名");
  await home.getByRole("button", { name: "保存名称" }).click();
  const blocked = home.getByText("请关闭对应的编辑标签页后重试", { exact: false });
  await expect(blocked).toBeVisible();
  await expect(home.getByRole("textbox", { name: "项目名称" })).toHaveValue("跨页改名");

  await openDelete(home, title);
  await home.getByRole("button", { name: "删除项目", exact: true }).click();
  await expect(blocked).toBeVisible();
  expect(await home.evaluate(() => sessionStorage.getItem("home-write"))).toBeNull();
  expect((await readStoredWorkspace(home, projectId)).project.title).toBe(title);

  await page.close();
  await openRename(home, title);
  await home.getByRole("textbox", { name: "项目名称" }).fill("跨页改名");
  await home.getByRole("button", { name: "保存名称" }).click();
  await expect(home.getByText("已改名为“跨页改名”。")).toBeVisible();

  await openDelete(home, "跨页改名");
  const laterEditor = await context.newPage();
  await laterEditor.goto("/projects/" + projectId);
  await expect(laterEditor.locator(".project-name strong")).toHaveText("跨页改名");
  await laterEditor.locator(".project-menu-trigger").click();
  await laterEditor.locator(".project-menu-field input").fill("预览后改名");
  await laterEditor.getByRole("button", { name: "保存名称" }).click();
  await expect.poll(async () => (await readStoredWorkspace(laterEditor, projectId)).project.title).toBe("预览后改名");
  await laterEditor.close();

  await home.getByRole("button", { name: "删除项目", exact: true }).click();
  await expect(home.getByText("项目内容或文件范围已变化，请重新确认删除。")).toBeVisible();
  await expect(home.getByText("删除“预览后改名”？")).toBeVisible();
  expect((await readStoredWorkspace(home, projectId)).project.title).toBe("预览后改名");

  await home.getByRole("button", { name: "删除项目", exact: true }).click();
  await expect(home.getByText("已删除“预览后改名”。")).toBeVisible();
  await home.reload();
  await expect(home.getByText("这里还没有项目")).toBeVisible();
  await home.goto("/projects/" + projectId);
  await expect(home.getByText("本地项目不存在或尚未迁移", { exact: false })).toBeVisible();
  expect(await home.evaluate((key) => localStorage.getItem(key), workspaceKey)).toBeNull();
});

test("共享目录写锁串行化不同项目的提交，离开页面时取消待处理改名", async ({ page, context }) => {
  const seed = await seedTwoProjects(page);
  const title = (JSON.parse(seed.textOnly.workspaceValue) as { project: { title: string } }).project.title;
  const otherHome = await context.newPage();
  await otherHome.goto("/");
  await openRename(page, seed.seedProjectTitle);
  await openRename(otherHome, title);
  await page.getByRole("textbox", { name: "项目名称" }).fill("目录甲");
  await otherHome.getByRole("textbox", { name: "项目名称" }).fill("目录乙");

  const holdCatalog = async (expectedTitle: string) => {
    const holder = await context.newPage();
    await holder.goto("/");
    await expect(holder.getByRole("button", { name: "重命名项目：" + expectedTitle })).toBeVisible();
    await holder.evaluate((name) => new Promise<void>((ready) => {
      void navigator.locks.request(name, () => new Promise<void>(() => ready()));
    }), PROJECT_CATALOG_WRITE_LOCK_NAME);
    return holder;
  };
  const pendingCount = () => page.evaluate(async (name) =>
    (await navigator.locks.query()).pending?.filter((lock) => lock.name === name).length, PROJECT_CATALOG_WRITE_LOCK_NAME
  );

  const holder = await holdCatalog(title);
  await page.getByRole("textbox", { name: "项目名称" }).evaluate((input) => {
    for (let count = 0; count < 2; count += 1) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
  });
  await otherHome.getByRole("button", { name: "保存名称" }).click();
  await expect.poll(pendingCount).toBe(2);
  await expect(page.getByRole("button", { name: "保存名称" })).toBeDisabled();
  await holder.close();
  await expect(page.getByText("已改名为“目录甲”。")).toBeVisible();
  await expect(otherHome.getByText("已改名为“目录乙”。")).toBeVisible();
  const summaryTitles = await page.evaluate((key) => {
    const catalog = JSON.parse(localStorage.getItem(key)!) as { projects: { title: string }[] };
    return catalog.projects.map((project) => project.title).sort();
  }, seed.catalogKey);
  expect(summaryTitles).toEqual(["目录甲", "目录乙"].sort());

  await openRename(otherHome, "目录乙");
  await otherHome.getByRole("textbox", { name: "项目名称" }).fill("离开后不可提交");
  const nextHolder = await holdCatalog("目录乙");
  await otherHome.getByRole("button", { name: "保存名称" }).click();
  await expect.poll(pendingCount).toBe(1);
  await otherHome.locator(".phome-hero-card").click();
  await expect(otherHome).toHaveURL("/projects/" + seed.seedProjectId);
  await nextHolder.close();
  await expect.poll(() => page.evaluate(async (name) => {
    const locks = await navigator.locks.query();
    return [...(locks.pending ?? []), ...(locks.held ?? [])].some((lock) => lock.name === name);
  }, getProjectWriteLockName(seed.textOnly.projectId))).toBe(false);
  expect((await readStoredWorkspace(page, seed.textOnly.projectId)).project.title).toBe("目录乙");
});

test("新建正文失败留在首页，列表失败后用同一个项目重试", async ({ page }) => {
  const seed = await seedTextOnlyProject(page);
  await page.goto("/");
  await expect(page.locator(".phome-hero h2")).toBeVisible();
  await page.evaluate((catalogKey) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      const mode = sessionStorage.getItem("create-failure");
      const isWorkspace = key.startsWith("morpho.project.");
      if (this === localStorage && ((mode === "workspace" && isWorkspace) || (mode === "catalog" && key === catalogKey))) {
        throw new DOMException("test quota", "QuotaExceededError");
      }
      setItem.call(this, key, value);
    };
  }, seed.catalogKey);

  const setFailure = (mode: string) => page.evaluate((value) => sessionStorage.setItem("create-failure", value), mode);
  const create = page.getByRole("button", { name: "新建项目", exact: true });
  const workspaceKeys = () => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("morpho.project.")));
  await setFailure("workspace");
  await create.click();
  await expect(page.getByText("浏览器本地存储空间已满", { exact: false })).toBeVisible();
  await expect(page).toHaveURL("/");
  expect(await workspaceKeys()).toEqual([seed.textOnly.workspaceKey]);

  await setFailure("catalog");
  await create.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByText("可继续保存同一个项目", { exact: false })).toBeVisible();
  await expect(page).toHaveURL("/");
  const pending = (await workspaceKeys()).filter((key) => key !== seed.textOnly.workspaceKey);
  expect(pending).toHaveLength(1);
  expect(await page.evaluate((key) => localStorage.getItem(key), seed.catalogKey)).toBe(seed.textOnly.catalogValue);

  await setFailure("");
  await create.click();
  const id = pending[0].slice("morpho.project.".length, -".workspace.v1".length);
  await expect(page).toHaveURL("/projects/" + id);
  await expect(page.getByRole("button", { name: "导入", exact: true })).toBeEnabled();
  expect((await workspaceKeys()).sort()).toEqual([seed.textOnly.workspaceKey, pending[0]].sort());
});

test("首页可直接导出备份并恢复为新项目，缺图项目拒绝导出", async ({ page }) => {
  const seed = await seedTextOnlyProject(page);
  await page.goto("/");
  await expect(page.locator(".phome-hero h2")).toBeVisible();

  const textTitle = (JSON.parse(seed.textOnly.workspaceValue) as { project: { title: string } }).project.title;
  const heroOpenBox = await page.locator(".phome-hero-card").boundingBox();
  const exportButton = page.getByRole("button", { name: `导出项目备份：${textTitle}`, exact: true });
  await expect(exportButton).toBeVisible();
  const exportBox = await exportButton.boundingBox();
  expect(heroOpenBox).not.toBeNull();
  expect(exportBox).not.toBeNull();
  expect(exportBox!.y).toBeGreaterThanOrEqual(heroOpenBox!.y + heroOpenBox!.height);

  await exportButton.focus();
  await expect(exportButton).toBeFocused();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportButton.click()
  ]);
  const backupDir = await mkdtemp(join(tmpdir(), "morpho-home-backup-"));
  const backupPath = join(backupDir, download.suggestedFilename());
  await download.saveAs(backupPath);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  await expect(page.getByText("最近已保存内容", { exact: false })).toBeVisible();

  const originalBeforeRestore = await readStoredWorkspace(page, seed.textOnly.projectId);
  await page.locator('.phome-side-foot input[type="file"]').setInputFiles(backupPath);
  await expect(page.locator(".phome-restore-card")).toContainText("将恢复为新的独立项目副本");
  await page.getByRole("button", { name: "恢复为新项目", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/project-/);
  expect(page.url()).not.toContain(seed.textOnly.projectId);

  await page.goto("/");
  await expect(page.getByText("共 2 个项目")).toBeVisible();
  expect(await readStoredWorkspace(page, seed.textOnly.projectId)).toEqual(originalBeforeRestore);

  // Add a project whose required image blob is absent in IndexedDB and verify search-result export refuses it.
  await page.evaluate((payload) => {
    const catalog = JSON.parse(localStorage.getItem(payload.catalogKey)!);
    const seedCatalog = JSON.parse(payload.catalogValue);
    catalog.projects.push(seedCatalog.projects[0]);
    localStorage.setItem(payload.catalogKey, JSON.stringify(catalog));
    localStorage.setItem(payload.workspaceKey, payload.workspaceValue);
  }, seedPayloadSnapshot(seed));
  await page.reload();

  const searchInput = page.getByPlaceholder("搜索项目名称或课题");
  await searchInput.fill(seed.seedProjectTitle);
  const brokenExport = page.getByRole("button", { name: `导出项目备份：${seed.seedProjectTitle}`, exact: true });
  await expect(brokenExport).toBeVisible();

  let downloadedBroken = false;
  page.once("download", () => {
    downloadedBroken = true;
  });
  await brokenExport.click();
  await expect(page.locator(".phome-restore-message.warning, .phome-restore-message.error")).toBeVisible();
  expect(downloadedBroken).toBe(false);
});

function seedPayloadSnapshot(seed: SeedPayload) {
  return {
    catalogKey: seed.catalogKey,
    catalogValue: seed.catalogValue,
    workspaceKey: seed.workspaceKey,
    workspaceValue: seed.workspaceValue
  };
}
