import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { agentTurnCallCount, installAgentMock, setAgentRequestScript } from "./fixtures/agentMock";
import { toolCallTurnScript, textAnswerScript } from "./support/agentSse";
import type { MorphoWorkspace, DeliveryObject, DeliveryGenerationBaseline } from "@/domain/morpho/types";

type Seed = { projectId: string; workspaceKey: string; catalogKey: string; catalogValue: string; deliveryId: string; sectionId: string; referenceIds: string[]; baseline: DeliveryGenerationBaseline; normal: string; legacy: string; refresh: string; diagnostics: string };
async function seed(page: Page, variant: "normal" | "legacy" | "refresh" | "diagnostics" = "normal") {
  const s = JSON.parse(readFileSync(resolve("e2e/.seed/delivery-handoff.json"), "utf8")) as Seed;
  await page.addInitScript(({ s, variant }) => {
    if (localStorage.getItem(`p5-seeded:${variant}`)) return;
    localStorage.setItem(s.catalogKey, s.catalogValue); localStorage.setItem(s.workspaceKey, s[variant]); localStorage.setItem(`p5-seeded:${variant}`, "true");
  }, { s, variant });
  await installAgentMock(page); await page.goto(`/projects/${s.projectId}`);
  await expect(page.locator(".tl-container")).toBeVisible();
  const banner = page.locator(".workspace-banner");
  if (await banner.getByRole("button", { name: "知道了", exact: true }).isVisible()) await banner.getByRole("button", { name: "知道了", exact: true }).click();
  await page.getByRole("button", { name: "交付准备", exact: true }).click();
  return s;
}
async function stored(page: Page, s: Seed): Promise<MorphoWorkspace> { return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), s.workspaceKey); }
async function historyKey(page: Page, redo = false) {
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press(redo ? "Control+Shift+z" : "Control+z");
}

test("Delivery Draft binds actual A input while the user edits B, previews caption, and refuses overwrite", async ({ page }) => {
  const s = await seed(page), panel = page.locator('[aria-label="交付准备"]');
  const script = toolCallTurnScript({ toolName: "prepare_delivery_section_draft", argumentsText: JSON.stringify({ narrative: "Generated narrative A", captions: [{ referenceId: s.referenceIds[0], caption: "Generated caption A" }], suggestedGaps: [] }) });
  await setAgentRequestScript(page, [{ kind: "stream", chunks: script.first, chunkDelayMs: 500 }, { kind: "stream", chunks: script.second, chunkDelayMs: 10 }]);
  await panel.getByRole("button", { name: /生成.*草稿/ }).click();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => agentTurnCallCount(page)).toBe(1);
  await panel.getByRole("textbox", { name: "章节说明", exact: true }).fill("User narrative B");
  await expect.poll(async () => Object.keys((await stored(page, s)).deliverySectionDrafts).length).toBe(1);
  const current = await stored(page, s), draft = Object.values(current.deliverySectionDrafts)[0];
  expect(draft.generationBaseline).toEqual(s.baseline);
  await expect(panel.getByText("Generated caption A", { exact: false })).toBeVisible();
  await expect(panel.getByText("适用性：已过时", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "应用草稿", exact: true })).toBeDisabled();
  expect((current.objects[s.deliveryId] as DeliveryObject).sections[0].narrative).toBe("User narrative B");
  const actualInput = await page.evaluate(() => JSON.stringify(window.__morphoAgentMock?.calls.filter((call) => call.url.endsWith("/requests"))[0]?.body));
  expect(actualInput).toContain("P5 body a"); expect(actualInput).not.toContain("User narrative B");
  await page.reload(); await page.getByRole("button", { name: "交付准备", exact: true }).click();
  await expect(page.getByText("适用性：已过时", { exact: true })).toBeVisible();
});

test("repeated reference reorder agrees with output/reload and Undo/Redo retains independent Agent text", async ({ page }) => {
  const s = await seed(page), panel = page.locator('[aria-label="交付准备"]');
  const cards = panel.locator(".delivery-reference-card");
  await cards.nth(0).getByRole("button", { name: "下移", exact: true }).click();
  await cards.nth(2).getByRole("button", { name: "上移", exact: true }).click();
  const expectedIds = [s.referenceIds[1], s.referenceIds[2], s.referenceIds[0]];
  await expect.poll(async () => ((await stored(page, s)).objects[s.deliveryId] as DeliveryObject).sections[0].referenceIds).toEqual(expectedIds);
  await expect(cards.locator(".delivery-reference-head strong")).toHaveText(["P5 material b", "P5 material c", "P5 material a"]);
  await setAgentRequestScript(page, [{ kind: "stream", chunks: textAnswerScript({ text: "Independent runtime B" }).chunks, chunkDelayMs: 10 }]);
  await page.locator(".ai-panel textarea").fill("讨论当前交付的接手方式"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(async () => (await stored(page, s)).ai.messages.some((message) => message.body.includes("Independent runtime B"))).toBe(true);
  const independent = (await stored(page, s)).ai;
  await historyKey(page); await expect(cards.locator(".delivery-reference-head strong")).toHaveText(["P5 material b", "P5 material a", "P5 material c"]);
  await historyKey(page, true); await expect(cards.locator(".delivery-reference-head strong")).toHaveText(["P5 material b", "P5 material c", "P5 material a"]);
  expect((await stored(page, s)).ai).toEqual(independent);
  await panel.getByRole("button", { name: "关闭交付准备", exact: true }).click(); await page.getByRole("button", { name: "输出", exact: true }).click();
  const output = page.locator('[aria-label="交付输出"]');
  const [download] = await Promise.all([page.waitForEvent("download"), output.getByRole("button", { name: /导出/ }).click()]);
  const stream = await download.createReadStream(); if (!stream) throw new Error("download stream");
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const zip = unzipSync(Buffer.concat(chunks));
  const map = JSON.parse(strFromU8(zip["source-map.json"]));
  expect(map.sections[0].referenceIds).toEqual(expectedIds); expect(map.references.map((ref: { referenceId: string }) => ref.referenceId)).toEqual(expectedIds);
  await page.reload(); await page.getByRole("button", { name: "交付准备", exact: true }).click();
  await expect(page.locator(".delivery-reference-head strong")).toHaveText(["P5 material b", "P5 material c", "P5 material a"]);
});

test("snapshot copy review is explicit and reversible; legacy draft exposes actual captions and review before apply", async ({ page }) => {
  const s = await seed(page, "refresh"), panel = page.locator('[aria-label="交付准备"]');
  await expect(panel.getByPlaceholder("图注 / 引用说明").first()).toHaveValue("Preserved caption");
  await expect(panel.getByPlaceholder("内部备注").first()).toHaveValue("Preserved note");
  await expect(panel.getByText("快照已变化，保留的章节说明、caption / note 需要复核。", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "确认本节文案已复核", exact: true }).click();
  await expect.poll(async () => (await stored(page, s)).deliveryReferences[s.referenceIds[0]].copyReview).toBe("reviewed");
  await historyKey(page); await expect.poll(async () => (await stored(page, s)).deliveryReferences[s.referenceIds[0]].copyReview).toBe("needsReview");
  await historyKey(page, true); await expect.poll(async () => (await stored(page, s)).deliveryReferences[s.referenceIds[0]].copyReview).toBe("reviewed");
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: s.workspaceKey, value: s.legacy });
  await page.reload(); await page.getByRole("button", { name: "交付准备", exact: true }).click();
  await expect(panel.getByText("适用性：需要复核", { exact: true })).toBeVisible();
  await expect(panel.getByText(/图注.*Actual proposed caption/)).toBeVisible();
  await expect(panel.getByText(/旧草稿缺少生成时依赖基线/)).toBeVisible();
  await panel.getByRole("button", { name: "复核后覆盖并应用草稿", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "章节说明", exact: true })).toHaveValue("Legacy narrative");
});

test("Output UI exposes simultaneous diagnostics and counts missing metadata as a missing material", async ({ page }) => {
  const s = await seed(page, "diagnostics"), panel = page.locator('[aria-label="交付准备"]');
  await panel.getByRole("button", { name: "关闭交付准备", exact: true }).click(); await page.getByRole("button", { name: "输出", exact: true }).click();
  const output = page.locator('[aria-label="交付输出"]');
  for (const [label, count] of [["缺失或大小异常素材", "1"], ["来源已有更新", "1"], ["来源已隐藏", "1"], ["来源不可用", "1"], ["未应用章节草稿", "1"], ["待补内容", "1"]]) {
    await expect(output.locator("dl div").filter({ has: page.locator("dt", { hasText: label }) }).locator("dd")).toHaveText(count);
  }
  await expect(output.getByText("可导出表示输出结构可生成，不代表内容、文案或素材已经确认或验证。", { exact: true })).toBeVisible();
  expect(Object.values((await stored(page, s)).deliverySectionDrafts)[0].status).toBe("pending");
});
