import { expect, test } from "@playwright/test";

import { readStoredWorkspace, seedProject } from "./fixtures/seed";
import { selectObject } from "./fixtures/canvas";
import { agentTurnCallCount, installAgentMock, releaseAgentStream, setAgentResponse } from "./fixtures/agentMock";
import { openEndedScript, textAnswerScript, turnErrorScript } from "./support/agentSse";

const draftInput = ".ai-panel textarea";

test.describe("AI 回合", () => {
  test("点击建议只填入输入框，不会自动发送", async ({ page }) => {
    const seed = await seedProject(page);
    await installAgentMock(page);
    await page.goto(`/projects/${seed.seedProjectId}`);

    await selectObject(page, seed.objectIds.keyConclusion);
    const chips = page.locator('[aria-label="可选建议"] .suggestion-chip');
    await expect(chips.first()).toBeVisible();

    const before = await readStoredWorkspace(page);
    await chips.first().click();

    // The draft is filled and stays editable natural language; nothing is sent.
    await expect(page.locator(draftInput)).not.toHaveValue("");
    const filled = await page.locator(draftInput).inputValue();
    await page.locator(draftInput).fill(`${filled}（人工补充）`);
    await expect(page.locator(draftInput)).toHaveValue(`${filled}（人工补充）`);

    expect(await agentTurnCallCount(page)).toBe(0);
    const after = await readStoredWorkspace(page);
    expect(after.ai.messages.length).toBe(before.ai.messages.length);
    expect(Object.keys(after.objects)).toEqual(Object.keys(before.objects));
  });

  test("发送后流式渲染，完成时写回助手消息", async ({ page }) => {
    const seed = await seedProject(page);
    await installAgentMock(page);
    await page.goto(`/projects/${seed.seedProjectId}`);

    const answer = "这是验收用的模拟回答，用来确认流式与落库都正确。";
    // The stream is held open after the first text delta, so the in-flight
    // assertions cannot race it to completion.
    await setAgentResponse(page, {
      kind: "stream",
      chunks: textAnswerScript({ text: answer }).chunks,
      chunkDelayMs: 20,
      holdAfterChunks: 3
    });
    await page.locator(draftInput).fill("请给出一个简短回应。");
    await page.locator('[aria-label="发送"]').click();

    // While the stream is open the send control becomes a stop control.
    await expect(page.locator('[aria-label="停止当前任务"]')).toBeVisible();
    // Partial text is on screen before the stream finishes.
    await expect(page.locator(".ai-panel")).toContainText(answer.slice(0, 8));
    await expect(page.locator(".ai-panel")).not.toContainText(answer);

    await releaseAgentStream(page);
    await expect(page.locator('[aria-label="发送"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".ai-panel")).toContainText(answer);

    await expect
      .poll(async () => {
        const stored = await readStoredWorkspace(page);
        return stored.ai.messages.filter((message) => message.role === "assistant").at(-1)?.body;
      })
      .toContain(answer);

    const stored = await readStoredWorkspace(page);
    const assistant = stored.ai.messages.filter((message) => message.role === "assistant").at(-1);
    expect(assistant?.status).toBe("done");
    expect(assistant?.agentTurnOutcome).toBe("success");
    expect(await agentTurnCallCount(page)).toBe(1);
  });

  test("取消进行中的回合，保留已发出的用户消息", async ({ page }) => {
    const seed = await seedProject(page);
    await installAgentMock(page);
    await page.goto(`/projects/${seed.seedProjectId}`);

    // Held open indefinitely: cancelling has to interrupt a turn that is really
    // still running, not one that quietly ran out of frames.
    await setAgentResponse(page, {
      kind: "stream",
      chunks: openEndedScript().chunks,
      chunkDelayMs: 20,
      holdAfterChunks: 2
    });
    await page.locator(draftInput).fill("这一轮我会中途取消。");
    await page.locator('[aria-label="发送"]').click();

    const stopButton = page.locator('[aria-label="停止当前任务"]');
    await expect(stopButton).toBeVisible();
    await stopButton.click();

    await expect(page.locator('[aria-label="发送"]')).toBeVisible({ timeout: 20_000 });
    // Persistence is debounced, so poll rather than reading the store once.
    await expect
      .poll(async () =>
        (await readStoredWorkspace(page)).ai.messages.some((message) => message.body.includes("这一轮我会中途取消。"))
      )
      .toBe(true);
    const stored = await readStoredWorkspace(page);
    const assistant = stored.ai.messages.filter((message) => message.role === "assistant").at(-1);
    expect(assistant?.status).not.toBe("streaming");
    expect(assistant?.agentTurnOutcome).not.toBe("success");
  });

  test("流内错误显示失败提示，不写入成功结论", async ({ page }) => {
    const seed = await seedProject(page);
    await installAgentMock(page);
    await page.goto(`/projects/${seed.seedProjectId}`);

    await setAgentResponse(page, { kind: "stream", chunks: turnErrorScript().chunks, chunkDelayMs: 20 });
    await page.locator(draftInput).fill("这一轮服务端会报错。");
    await page.locator('[aria-label="发送"]').click();

    await expect(page.locator(".ai-panel")).toContainText("模型返回异常", { timeout: 20_000 });
    const stored = await readStoredWorkspace(page);
    const assistant = stored.ai.messages.filter((message) => message.role === "assistant").at(-1);
    expect(assistant?.agentTurnOutcome).not.toBe("success");
  });

  test("401 与 503 都原样透出服务端说明，并保证项目未被改动", async ({ page }) => {
    const seed = await seedProject(page);
    await installAgentMock(page);
    await page.goto(`/projects/${seed.seedProjectId}`);

    const objectsBefore = Object.keys((await readStoredWorkspace(page)).objects);

    // 401 is what every AI route returns without a Supabase session. The server's
    // own wording is shown verbatim, together with the guarantee that the turn
    // changed nothing and the draft survived.
    await setAgentResponse(page, { kind: "httpError", status: 401, error: "请先登录 Morpho。" });
    await page.locator(draftInput).fill("未登录时发送。");
    await page.locator('[aria-label="发送"]').click();
    await expect(page.locator(".ai-panel")).toContainText("请先登录 Morpho。", { timeout: 20_000 });
    await expect(page.locator(".ai-panel")).toContainText("项目对象未被自动更改");
    await expect(page.locator(".ai-panel").getByRole("button", { name: "重试", exact: true })).toBeVisible();

    // 503 is the unconfigured-provider path; its own wording must survive.
    await setAgentResponse(page, { kind: "httpError", status: 503, error: "AI 服务尚未配置，请联系管理员。" });
    await page.locator(draftInput).fill("服务不可用时发送。");
    await page.locator('[aria-label="发送"]').click();
    await expect(page.locator(".ai-panel")).toContainText("AI 服务尚未配置", { timeout: 20_000 });

    // Neither failure may create or drop project objects.
    expect(Object.keys((await readStoredWorkspace(page)).objects)).toEqual(objectsBefore);
  });
});
