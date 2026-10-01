import { expect, test } from "@playwright/test";
import { seedProject, readStoredWorkspace } from "./fixtures/seed";
import { installAgentMock, setAgentRequestScript, agentCalls } from "./fixtures/agentMock";
import { toolCallTurnScript } from "./support/agentSse";
import type { MorphoWorkspace } from "@/domain/morpho/types";

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFh0AAAAASUVORK5CYII=";

test("known image task survives reload, retrieves the same execution and commits one local image", async ({ page }) => {
  const seed = await seedProject(page);
  await installAgentMock(page);
  await page.addInitScript((base64: string) => {
    const persisted = sessionStorage.getItem("p3a-agent-state");
    if (persisted && window.__morphoAgentMock) Object.assign(window.__morphoAgentMock, JSON.parse(persisted));
    const previous = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/actions/image") && init?.method === "POST") {
        const bodies = JSON.parse(sessionStorage.getItem("p3a-image-bodies") ?? "[]") as string[];
        bodies.push(String(init.body));
        sessionStorage.setItem("p3a-image-bodies", JSON.stringify(bodies));
        if (bodies.length === 1) {
          sessionStorage.setItem("p3a-agent-state", JSON.stringify(window.__morphoAgentMock));
          return Response.json({ effect: { version: 1, effectId: `effect:${"a".repeat(64)}`, kind: "image",
            requestDigest: "b".repeat(64), namespace: { provider: "grsai", baseUrl: "https://mock.test", credentialScope: "c".repeat(64) },
            executionState: "running", cancelRequestedAt: null, localAbortObservedAt: null,
            attemptId: "019fa9c0-7b9d-7a20-8f31-2c676296c9d1", taskId: "p3a-same-task", responseId: null } }, { status: 202 });
        }
        return new Response(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)), {
          headers: { "Content-Type": "image/png", "X-Morpho-Provider-Task-Id": "p3a-same-task" }
        });
      }
      return previous(input, init);
    };
  }, pixel);
  await page.goto(`/projects/${seed.seedProjectId}`);
  const before = Object.keys((await readStoredWorkspace(page)).objects);
  const script = toolCallTurnScript({ toolName: "generate_visuals", argumentsText: JSON.stringify({ kind: "visualDevelopment", items: [{
    id: "p3a-image", title: "P3A 图像", purpose: "概念探索", requestedReferenceObjectIds: [], changeGoals: [], preserve: [],
    allowToChange: [], productForm: [], materialsAndCmf: [], environmentAndLighting: [], avoid: [], role: "conceptImage"
  }] }), finalText: "已保存同一任务生成的图像。" });
  await setAgentRequestScript(page, [{ kind: "stream", chunks: script.first }, { kind: "stream", chunks: script.second }]);
  await page.locator(".ai-panel textarea").fill("生成一张概念图");
  await page.getByRole("button", { name: "本轮允许生图", exact: true }).click();
  await page.locator('[aria-label="发送"]').click();
  await expect.poll(async () => page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => key.startsWith("morpho.agent-runtime-a-plus.recovery.v2"))
    .some(([, value]) => value.includes("p3a-same-task")))).toBe(true);
  await page.reload();
  await expect(page.locator(".ai-panel")).toContainText("已保存同一任务生成的图像。", { timeout: 30_000 });
  await expect.poll(async () => Object.values((await readStoredWorkspace(page)).objects)
    .filter((object) => !before.includes(object.id) && object.type === "image").length).toBe(1);
  const bodies = await page.evaluate(() => JSON.parse(sessionStorage.getItem("p3a-image-bodies") ?? "[]") as string[]);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  const workspace = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!) as MorphoWorkspace, seed.workspaceKey);
  const generated = Object.values(workspace.objects).filter((object) => !before.includes(object.id) && object.type === "image");
  expect(generated[0]?.type === "image" && generated[0].generation?.providerTaskId).toBe("p3a-same-task");
  expect((await agentCalls(page)).filter((call) => call.url.endsWith("/requests") && call.method === "POST")).toHaveLength(2);
  await page.reload();
  expect(Object.values((await readStoredWorkspace(page)).objects).filter((object) => !before.includes(object.id) && object.type === "image")).toHaveLength(1);
  expect(await page.evaluate(() => (JSON.parse(sessionStorage.getItem("p3a-image-bodies") ?? "[]") as string[]).length)).toBe(2);
});
