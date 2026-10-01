import { expect, test } from "@playwright/test";
import { seedProject, readStoredWorkspace } from "./fixtures/seed";
import { installAgentMock, setAgentRequestScript, agentCalls } from "./fixtures/agentMock";
import { toolCallTurnScript } from "./support/agentSse";
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFh0AAAAASUVORK5CYII=";

for (const fault of ["lost_response", "asset_abort"] as const) test(`P3B ${fault}: reload saves same escrowed image, ACK loss only repeats ACK`, async ({ page }) => {
  const seed = await seedProject(page);
  await installAgentMock(page);
  await page.addInitScript(({ base64, fault }) => {
    const persisted = sessionStorage.getItem("p3b-agent-state");
    if (persisted && window.__morphoAgentMock) Object.assign(window.__morphoAgentMock, JSON.parse(persisted));
    const previous = window.fetch.bind(window);
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const resultId = `result:${"b".repeat(64)}`, effectId = `effect:${"a".repeat(64)}`;
    if (fault === "asset_abort") {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
        if (value instanceof Blob && value.type === "image/png" && !sessionStorage.getItem("p3b-aborted")) {
          sessionStorage.setItem("p3b-aborted", "true");
          request.addEventListener("success", () => this.transaction.abort());
        }
        return request;
      };
    }
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/actions/image") && init?.method === "POST") {
        const bodies: string[] = JSON.parse(sessionStorage.getItem("p3b-image-bodies") ?? "[]");
        bodies.push(String(init.body)); sessionStorage.setItem("p3b-image-bodies", JSON.stringify(bodies));
        sessionStorage.setItem("p3b-agent-state", JSON.stringify(window.__morphoAgentMock));
        if (bodies.length === 1) sessionStorage.setItem("p3b-provider-count", "1");
        if (bodies.length === 1 && fault === "lost_response") throw new TypeError("HTTP lost after escrow publish");
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return Response.json({ result: { effectId, resultId, version: 1, kind: "image",
          sha256: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2,"0")).join(""),
          byteLength: bytes.length, mimeType: "image/png", chunkCount: 1, expiresAt: "2099-01-01T00:00:00Z" } });
      }
      if (url.includes("/effects/") && url.includes("/result?")) {
        if (init?.method === "POST") {
          const workspaces = Object.entries(localStorage).filter(([key]) => key.startsWith("morpho.project.") && key.endsWith(".workspace.v1"))
            .map(([, value]) => { try { return JSON.parse(value); } catch { return undefined; } });
          const images = workspaces.flatMap((w) => Object.values(w?.objects ?? {})) as Array<{ type: string; assetId?: string; generation?: { delivery?: { resultId: string } } }>;
          const saved = images.find((o) => o.type === "image" && o.generation?.delivery?.resultId === resultId);
          sessionStorage.setItem("p3b-ack-after-workspace", saved ? "true" : "false");
          const ackBodies: string[] = JSON.parse(sessionStorage.getItem("p3b-acks") ?? "[]");
          ackBodies.push(String(init.body)); sessionStorage.setItem("p3b-acks", JSON.stringify(ackBodies));
          if (ackBodies.length === 1) throw new TypeError("ACK committed but response lost");
          return Response.json({ acknowledged: true });
        }
        return new Response(bytes);
      }
      return previous(input, init);
    };
  }, { base64: pixel, fault });
  await page.goto(`/projects/${seed.seedProjectId}`);
  const before = Object.keys((await readStoredWorkspace(page)).objects);
  const script = toolCallTurnScript({ toolName: "generate_visuals", argumentsText: JSON.stringify({ kind: "visualDevelopment", items: [{
    id: "p3b-image", title: "P3B 图像", purpose: "概念探索", requestedReferenceObjectIds: [], changeGoals: [], preserve: [],
    allowToChange: [], productForm: [], materialsAndCmf: [], environmentAndLighting: [], avoid: [], role: "conceptImage"
  }] }), finalText: "同一结果已持久保存。" });
  await setAgentRequestScript(page, [{ kind: "stream", chunks: script.first }, { kind: "stream", chunks: script.second }]);
  await page.locator(".ai-panel textarea").fill("生成一张概念图");
  await page.getByRole("button", { name: "本轮允许生图", exact: true }).click();
  await page.locator('[aria-label="发送"]').click();
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage)
    .filter(([k]) => k.startsWith("morpho.agent-runtime-a-plus.recovery.v2"))
    .some(([,v]) => v.includes('"actionKind":"image"')))).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem("p3b-acks"))).toBeNull();
  expect((await agentCalls(page)).filter((c) => c.url.endsWith("/requests") && c.method === "POST")).toHaveLength(1);
  await page.reload();
  await expect(page.locator(".ai-panel")).toContainText("同一结果已持久保存。", { timeout: 30_000 });
  await expect.poll(async () => Object.values((await readStoredWorkspace(page)).objects).filter((o) => !before.includes(o.id) && o.type === "image").length).toBe(1);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("p3b-ack-after-workspace"))).toBe("true");
  await page.reload();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("p3b-acks") ?? "[]").length)).toBeGreaterThanOrEqual(2);
  const facts = await page.evaluate(() => ({ bodies: JSON.parse(sessionStorage.getItem("p3b-image-bodies") ?? "[]") as string[],
    acks: JSON.parse(sessionStorage.getItem("p3b-acks") ?? "[]") as string[], provider: sessionStorage.getItem("p3b-provider-count") }));
  expect(facts.bodies).toHaveLength(2); expect(facts.bodies[0]).toBe(facts.bodies[1]);
  expect(new Set(facts.acks).size).toBe(1); expect(facts.provider).toBe("1");
  expect(Object.values((await readStoredWorkspace(page)).objects).filter((o) => !before.includes(o.id) && o.type === "image")).toHaveLength(1);
});

test("P3B Text reload retrieves the final envelope without another Provider request", async ({ page }) => {
  const seed = await seedProject(page);
  await installAgentMock(page);
  await page.addInitScript(() => {
    const persisted = sessionStorage.getItem("p3b-text-agent");
    if (persisted && window.__morphoAgentMock) Object.assign(window.__morphoAgentMock, JSON.parse(persisted));
    const previous = window.fetch.bind(window);
    const effectId = `effect:${"c".repeat(64)}`;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/requests") && init?.method === "POST") {
        await previous(input, init);
        const body = JSON.parse(String(init.body));
        sessionStorage.setItem("p3b-text-output", JSON.stringify({ type: "providerOutput", requestId: body.requestId,
          stepSequence: body.stepSequence, outputText: "从 escrow 取得同一完整文本。", producedUserVisibleEffect: true, toolCallIds: [], toolCalls: [] }));
        Object.assign(window.__morphoAgentMock!.journal!, { status: "externallyCompleted", terminalAt: new Date().toISOString(),
          externalEffect: { version: 1, effectId, kind: "text", requestDigest: "b".repeat(64), namespace: null,
            executionState: "succeeded", cancelRequestedAt: null, localAbortObservedAt: null,
            attemptId: null, taskId: null, responseId: "original-response" } });
        sessionStorage.setItem("p3b-text-agent", JSON.stringify(window.__morphoAgentMock));
        throw new TypeError("Final HTTP response lost");
      }
      if (url.includes("/effects/") && url.includes("/result?")) {
        if (init?.method === "POST") {
          sessionStorage.setItem("p3b-text-ack", String(init.body));
          return Response.json({ acknowledged: true });
        }
        const text = sessionStorage.getItem("p3b-text-output")!;
        if (url.includes("chunk=")) return new Response(text);
        if (!sessionStorage.getItem("p3b-text-delayed")) {
          sessionStorage.setItem("p3b-text-delayed", "true");
          return Response.json({ code: "result_store_unavailable" }, { status: 503 });
        }
        const bytes = new TextEncoder().encode(text), hash = await crypto.subtle.digest("SHA-256", bytes);
        return Response.json({ result: { effectId, resultId: `result:${"d".repeat(64)}`, version: 1, kind: "text",
          sha256: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2,"0")).join(""), byteLength: bytes.length,
          mimeType: "application/json", chunkCount: 1, expiresAt: "2099-01-01T00:00:00Z" } });
      }
      return previous(input, init);
    };
  });
  await page.goto(`/projects/${seed.seedProjectId}`);
  await setAgentRequestScript(page, [{ kind: "stream", chunks: [] }]);
  await page.locator(".ai-panel textarea").fill("解释当前设计的重点");
  await page.locator('[aria-label="发送"]').click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("p3b-text-delayed"))).toBe("true");
  expect(await page.evaluate(() => sessionStorage.getItem("p3b-text-ack"))).toBeNull();
  await page.reload();
  await expect(page.locator(".ai-panel")).toContainText("从 escrow 取得同一完整文本。", { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("p3b-text-ack"))).not.toBeNull();
  expect((await agentCalls(page)).filter((c) => c.url.endsWith("/requests") && c.method === "POST")).toHaveLength(1);
  await page.reload();
  const messages = (await readStoredWorkspace(page)).ai.messages.filter((m) => m.body.includes("从 escrow 取得同一完整文本。"));
  expect(messages).toHaveLength(1);
});

test("P3B Compaction reload saves one original Summary revision before ACK", async ({ page }) => {
  const seed = await seedProject(page);
  await installAgentMock(page);
  await page.addInitScript((workspaceKey) => {
    const persisted = sessionStorage.getItem("p3b-summary-agent");
    if (persisted && window.__morphoAgentMock) Object.assign(window.__morphoAgentMock, JSON.parse(persisted));
    if (!sessionStorage.getItem("p3b-summary-seeded")) {
      const workspace = JSON.parse(localStorage.getItem(workspaceKey)!);
      workspace.ai.messages.push(...["user", "assistant", "user", "assistant"].map((role, n) => ({
        id: `p3b-summary-message-${n}`, role, body: `讨论连续项目上下文 ${n}`, createdAt: `2026-10-01T00:00:0${n}Z`,
        ...(role === "assistant" ? { status: "done" } : {})
      })));
      localStorage.setItem(workspaceKey, JSON.stringify(workspace));
      sessionStorage.setItem("p3b-summary-seeded", "true");
    }
    const previous = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/actions/compaction") && init?.method === "POST") {
        const bodies = JSON.parse(sessionStorage.getItem("p3b-summary-bodies") ?? "[]");
        bodies.push(String(init.body)); sessionStorage.setItem("p3b-summary-bodies", JSON.stringify(bodies));
        sessionStorage.setItem("p3b-summary-agent", JSON.stringify(window.__morphoAgentMock));
        if (bodies.length === 1) {
          const body = JSON.parse(String(init.body));
          const payload = JSON.stringify({ summary: { threadGoal: "保留同一项目讨论上下文", establishedContext: ["连续画布"],
            decisionsAndReasons: [], activeWork: [], unresolvedQuestions: [], referencedObjects: [] },
            sourceBoundary: { sourceStartMessageId: body.sourceStartMessageId, sourceEndMessageId: body.sourceEndMessageId } });
          sessionStorage.setItem("p3b-summary-payload", payload);
          sessionStorage.setItem("p3b-summary-provider-count", "1");
          throw new TypeError("summary result response lost");
        }
        const bytes = new TextEncoder().encode(sessionStorage.getItem("p3b-summary-payload")!);
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return Response.json({ result: { effectId: `effect:${"e".repeat(64)}`, resultId: `result:${"f".repeat(64)}`, version: 1,
          kind: "compaction", sha256: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2,"0")).join(""),
          byteLength: bytes.length, mimeType: "application/json", chunkCount: 1, expiresAt: "2099-01-01T00:00:00Z" } });
      }
      if (url.includes("/effects/") && url.includes("/result")) {
        if (init?.method === "POST") {
          const workspace = JSON.parse(localStorage.getItem(workspaceKey)!);
          sessionStorage.setItem("p3b-summary-ack-after-revision", String(Object.keys(workspace.ai.conversationSummaryRevisions).length === 1));
          const acks = JSON.parse(sessionStorage.getItem("p3b-summary-acks") ?? "[]");
          acks.push(String(init.body)); sessionStorage.setItem("p3b-summary-acks", JSON.stringify(acks));
          if (acks.length === 1) throw new TypeError("summary ACK response lost");
          return Response.json({ acknowledged: true });
        }
        return new Response(sessionStorage.getItem("p3b-summary-payload"));
      }
      return previous(input, init);
    };
  }, seed.workspaceKey);
  await page.goto(`/projects/${seed.seedProjectId}`);
  await setAgentRequestScript(page, []);
  await page.locator(".ai-panel textarea").fill("/compact");
  await page.locator('[aria-label="发送"]').click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("p3b-summary-provider-count"))).toBe("1");
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage)
    .filter(([k]) => k.startsWith("morpho.agent-runtime-a-plus.recovery.v2"))
    .some(([,v]) => v.includes('"actionKind":"compaction"')))).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem("p3b-summary-acks"))).toBeNull();
  await page.reload();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("p3b-summary-ack-after-revision"))).toBe("true");
  await page.reload();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("p3b-summary-acks") ?? "[]").length)).toBeGreaterThanOrEqual(2);
  const facts = await page.evaluate((workspaceKey) => ({
    bodies: JSON.parse(sessionStorage.getItem("p3b-summary-bodies")!) as string[], acks: JSON.parse(sessionStorage.getItem("p3b-summary-acks")!) as string[],
    revisions: Object.keys(JSON.parse(localStorage.getItem(workspaceKey)!).ai.conversationSummaryRevisions).length,
    provider: sessionStorage.getItem("p3b-summary-provider-count")
  }), seed.workspaceKey);
  expect(facts.bodies).toHaveLength(2); expect(facts.bodies[0]).toBe(facts.bodies[1]);
  expect(new Set(facts.acks).size).toBe(1); expect(facts.revisions).toBe(1); expect(facts.provider).toBe("1");
  expect((await agentCalls(page)).some((c) => c.url.endsWith("/requests") && c.method === "POST")).toBe(false);
});
