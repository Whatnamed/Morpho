// Real browser + production routes + isolated RPC. Faults detach transport only.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { baseUrl, sha256 } from "./p7b-l1b-runtime.mjs";

export async function runAmbiguousClientScenario({ runtime, actor, row, output, setTurn, mode, journal, request }) {
  const start = runtime.stub.calls.length;
  const vite = await createServer({ appType: "custom", configFile: resolve("vitest.config.ts"), server: { middlewareMode: true } });
  let seed;
  try {
    const { createBlankWorkspace, serializeWorkspace } = await vite.ssrLoadModule("/src/domain/morpho/workspace.ts");
    const { createCatalog, summarizeProject, CATALOG_STORAGE_KEY, getProjectWorkspaceStorageKey } = await vite.ssrLoadModule("/src/infrastructure/persistence/localProjectStore.ts");
    const workspace = createBlankWorkspace(`p7b-ambiguity-${mode}`);
    workspace.project.title = "L1b controlled ambiguity";
    seed = { projectId: workspace.project.id, workspaceKey: getProjectWorkspaceStorageKey(workspace.project.id),
      workspaceValue: serializeWorkspace(workspace), catalogKey: CATALOG_STORAGE_KEY,
      catalogValue: JSON.stringify(createCatalog([summarizeProject(workspace)], workspace.project.id)) };
  } finally { await vite.close(); }
  row.seed = { projectId: seed.projectId, workspaceSha256: sha256(seed.workspaceValue), source: "current domain seed" };
  runtime.stub.next = mode;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(actor.cookie.split("; ").map(pair => {
    const split = pair.indexOf("="); return { name: pair.slice(0, split), value: pair.slice(split + 1), url: baseUrl, sameSite: "Lax" };
  }));
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol)
      ? route.continue() : route.abort("blockedbyclient");
  });
  await page.addInitScript(({ seed, mode }) => {
    if (!localStorage.getItem(seed.workspaceKey)) {
      localStorage.setItem(seed.catalogKey, seed.catalogValue); localStorage.setItem(seed.workspaceKey, seed.workspaceValue);
    }
    const prefix = "l1b-D-";
    const push = (name, value) => {
      const values = JSON.parse(sessionStorage.getItem(prefix + name) ?? "[]"); values.push(value);
      sessionStorage.setItem(prefix + name, JSON.stringify(values));
    };
    const nativeRemove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function(key) {
      if (this === localStorage && key.startsWith("morpho.agent-runtime-a-plus.recovery.v2")) {
        const value = this.getItem(key), record = value ? JSON.parse(value) : null;
        if (record?.localProjectId === seed.projectId) push("clearProofs", {
          recoveryBeforeClear: record, durableWorkspace: JSON.parse(localStorage.getItem(seed.workspaceKey)) });
      }
      return nativeRemove.call(this, key);
    };
    const recovery = () => Object.entries(localStorage).filter(([key]) => key.startsWith("morpho.agent-runtime-a-plus.recovery.v2"))
      .map(([, value]) => JSON.parse(value)).find(record => record.localProjectId === seed.projectId);
    const blob = async ref => {
      if (!ref) return null;
      const db = await new Promise((yes, no) => { const r = indexedDB.open("morpho-assets-v1"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error); });
      try {
        const value = await new Promise((yes, no) => {
          const tx = db.transaction("asset-blobs", "readonly"); const r = tx.objectStore("asset-blobs").get(ref);
          let value; r.onsuccess = () => { value = r.result; }; tx.oncomplete = () => yes(value); tx.onabort = () => no(tx.error);
        });
        return value ? await value.text() : null;
      } finally { db.close(); }
    };
    const native = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (!url.includes("/api/ai/")) return native(input, init);
      const phase = sessionStorage.getItem(prefix + "phase") ?? "initial";
      push("http", { url, method, phase });
      if (url.endsWith("/requests") && method === "POST") {
        const record = recovery();
        push("postProofs", { body: JSON.parse(String(init.body)), serverTurnId: record?.serverTurnId,
          recoveryAtPost: record, durableProviderBody: await blob(record?.coordinator.activeRequest?.providerPayload?.ref) });
        const response = await native(input, init);
        if (mode === "held") await response.body.cancel(); else await response.text();
        sessionStorage.setItem(prefix + "detached", "true");
        throw new TypeError("L1b controlled transport detach after real execution admission");
      }
      if (method === "GET" && phase === "initial" && url.includes("/turns/")) {
        sessionStorage.setItem(prefix + "queryBlocked", "true"); return new Promise(() => {});
      }
      const response = await native(input, init);
      let data = null;
      if (response.headers.get("content-type")?.includes("application/json")) data = await response.clone().json();
      push("responses", { url, method, phase, status: response.status, data });
      return response;
    };
  }, { seed, mode });
  const facts = () => page.evaluate(workspaceKey => ({
    posts: JSON.parse(sessionStorage.getItem("l1b-D-postProofs") ?? "[]"), http: JSON.parse(sessionStorage.getItem("l1b-D-http") ?? "[]"),
    responses: JSON.parse(sessionStorage.getItem("l1b-D-responses") ?? "[]"), workspace: JSON.parse(localStorage.getItem(workspaceKey)),
    clearProofs: JSON.parse(sessionStorage.getItem("l1b-D-clearProofs") ?? "[]"),
    recovery: Object.entries(localStorage).filter(([key]) => key.startsWith("morpho.agent-runtime-a-plus.recovery.v2"))
      .map(([, value]) => JSON.parse(value))
  }), seed.workspaceKey);
  const checkpoint = async name => {
    row.checkpoint = name; const client = await facts();
    if (client.posts[0]?.serverTurnId) setTurn(client.posts[0].serverTurnId);
    const value = { client, journal: await journal() };
    await writeFile(resolve(output, `D-${mode}-${name}.json`), JSON.stringify(value, null, 2) + "\n"); return value;
  };
  try {
    await page.goto(`${baseUrl}/projects/${seed.projectId}`);
    await page.locator(".ai-panel textarea").fill("请只用简短文字回复，不调用工具。");
    await page.locator('[aria-label="发送"]').click();
    await page.waitForFunction(() => sessionStorage.getItem("l1b-D-queryBlocked") === "true", null, { timeout: 30_000 });
    // Wait for the actual controlled Provider to receive the request, not a local timer.
    for (let i = 0; runtime.stub.calls.length === start && i < 100; i++) await new Promise(r => setTimeout(r, 50));
    const before = await checkpoint("before-reload");
    assert.equal(before.client.posts.length, 1);
    const proof = before.client.posts[0], active = proof.recoveryAtPost.coordinator.activeRequest;
    assert.equal(active.requestId, proof.body.requestId); assert.equal(active.stepSequence, proof.body.stepSequence);
    assert.deepEqual(JSON.parse(proof.durableProviderBody), proof.body.providerRequest);
    assert.equal(sha256(proof.durableProviderBody), active.providerPayload.sha256);
    assert.equal(runtime.stub.calls.length - start, 1);
    row.identity = { serverTurnId: proof.serverTurnId, requestId: proof.body.requestId, stepSequence: proof.body.stepSequence,
      exactBodySha256: sha256(JSON.stringify(proof.body)), durableProviderBodySha256: active.providerPayload.sha256 };
    await page.evaluate(() => sessionStorage.setItem("l1b-D-phase", "reload")); await page.reload();
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem("l1b-D-responses") ?? "[]")
      .some(r => r.phase === "reload" && r.method === "GET" && r.url.includes("/turns/")), null, { timeout: 30_000 });
    if (mode === "unknown") await page.waitForFunction(workspaceKey =>
      JSON.parse(localStorage.getItem(workspaceKey)).ai.messages.some(m => m.role === "assistant" && m.status === "failed"),
    seed.workspaceKey, { timeout: 30_000 });
    const reloaded = await checkpoint("query-original");
    assert.equal(reloaded.client.posts.length, 1, "Reload cannot generate a replacement Request");
    assert.equal(runtime.stub.calls.length - start, 1);
    const effect = reloaded.journal.effects.find(e => e.effect_id === `effect:${sha256(JSON.stringify(["a-plus", proof.serverTurnId, seed.projectId, "text", proof.body.requestId, proof.body.stepSequence]))}`);
    assert.ok(effect); assert.equal(effect.execution_state, "unknown", "Transport uncertainty is not Provider failure");
    row.effectObservation = await request(`/api/ai/effects/${effect.effect_id}?kind=text`);
    assert.equal(row.effectObservation.status, 200); assert.equal(row.effectObservation.data.effect.executionState, "unknown");
    row.ambiguousJournal = reloaded.journal;
    const path = `/api/ai/agent/turns/${proof.serverTurnId}/requests`;
    const replay = await request(path, proof.body);
    assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true);
    assert.equal(runtime.stub.calls.length - start, 1, "Explicit exact replay cannot acquire a second execution");
    assert.equal((await journal()).turn[0].provider_call_count, 1);
    row.exactReplay = replay;
    if (mode === "unknown") {
      assert.equal(reloaded.journal.turn[0].bounded_failure_code, "external_execution_state_unknown");
      const observed = reloaded.client.responses.find(r => r.method === "GET" && r.url.includes("/turns/"));
      assert.equal(observed.data.failureCode, "external_execution_state_unknown");
      // Accepted A+ semantics permit administrative Turn closure with this bounded code.
      // Provider truth stays unknown; the client must not discard that distinction on reload.
      const durableUnknown = reloaded.client.workspace.ai.messages.some(m =>
        m.agentTurnOutcomeSummary?.includes("external_execution_state_unknown") || m.body.includes("无法确认外部请求是否已经执行"));
      const recoveryUnknown = reloaded.client.recovery.some(r =>
        r.coordinator.lifecycle.fault?.error?.code === "external_execution_state_unknown");
      row.clientUnknownPreserved = { durableUnknown, recoveryUnknown,
        outcomes: reloaded.client.workspace.ai.messages.map(m => ({ id: m.id, role: m.role, body: m.body,
          status: m.status, outcome: m.agentTurnOutcome, summary: m.agentTurnOutcomeSummary })) };
      assert.ok(durableUnknown || recoveryUnknown,
        "Reload must preserve Journal external_execution_state_unknown in canonical local facts or durable failure detail; generic externalExecutionFailed loses execution uncertainty");
      await page.waitForFunction(() => JSON.parse(sessionStorage.getItem("l1b-D-clearProofs") ?? "[]").length === 1,
        null, { timeout: 30_000 });
      const durable = await checkpoint("durable-unknown");
      const cleanup = durable.client.clearProofs[0];
      assert.equal(cleanup.recoveryBeforeClear.coordinator.lifecycle.serverFailureCode, "external_execution_state_unknown");
      assert.deepEqual(cleanup.recoveryBeforeClear.coordinator.lifecycle.outcome, {
        kind: "failed", reasons: ["external_execution_state_unknown"] });
      const assistant = cleanup.durableWorkspace.ai.messages.find(m => m.role === "assistant");
      assert.equal(assistant.agentTurnOutcomeSummary, "external_execution_state_unknown");
      assert.ok(assistant.body.includes("无法确认外部请求是否已经执行"));
      assert.ok(assistant.body.includes("停止自动重试"));
      assert.equal(durable.client.recovery.length, 0);
      assert.equal(durable.client.http.filter(r => r.method === "POST" && r.url.includes("/result")).length, 0);
      assert.equal(durable.journal.results.filter(r => r.effect_id === effect.effect_id).length, 0);
      assert.equal(durable.journal.turn[0].server_execution_status, "externally_failed");
      assert.equal(durable.journal.turn[0].bounded_failure_code, "external_execution_state_unknown");
      assert.equal(durable.journal.effects.find(e => e.effect_id === effect.effect_id).execution_state, "unknown");
      row.terminalUnknown = { outcome: cleanup.recoveryBeforeClear.coordinator.lifecycle.outcome,
        serverFailureCode: cleanup.recoveryBeforeClear.coordinator.lifecycle.serverFailureCode,
        durableAssistant: { body: assistant.body, status: assistant.status, outcome: assistant.agentTurnOutcome,
          summary: assistant.agentTurnOutcomeSummary }, detailBeforeCleanup: true, recoveryCleared: true,
        providerExecutions: 1, ackPosts: 0, resultCount: 0 };
    } else {
      assert.equal(reloaded.journal.turn[0].server_execution_status, "provider_running");
      const saved = reloaded.client.recovery.find(r => r.serverTurnId === proof.serverTurnId);
      assert.equal(saved.coordinator.activeRequest.requestId, proof.body.requestId);
      runtime.stub.next = "complete"; runtime.stub.held.splice(0).forEach(release => release());
      for (let i = 0; i < 200; i++) {
        if ((await journal()).turn[0].server_execution_status === "externally_completed") break;
        await new Promise(r => setTimeout(r, 50));
      }
      await page.evaluate(() => sessionStorage.setItem("l1b-D-phase", "observed")); await page.reload();
      await page.waitForFunction(() => JSON.parse(sessionStorage.getItem("l1b-D-responses") ?? "[]")
        .some(r => r.method === "POST" && r.url.includes("/result") && r.status === 200), null, { timeout: 30_000 });
      const success = await checkpoint("late-success");
      assert.equal(success.client.posts.length, 1); assert.equal(runtime.stub.calls.length - start, 1);
      assert.equal(success.journal.turn[0].server_execution_status, "externally_completed");
      assert.equal(success.journal.results.filter(r => r.effect_id === effect.effect_id).length, 1);
      assert.ok(success.journal.results.find(r => r.effect_id === effect.effect_id).acknowledged_at);
      assert.ok(success.client.workspace.ai.messages.some(m => m.role === "assistant" && m.body === "P7B controlled result" && m.status === "done"));
      row.lateSuccess = { sameRequest: true, sameEffect: effect.effect_id, providerExecutions: 1, durableConversation: true, exactResultAck: true };
    }
    row.verdict = "pass";
  } finally {
    row.pageErrors = errors;
    await checkpoint("final").catch(() => {});
    await page.screenshot({ path: resolve(output, `D-${mode}-final.png`), fullPage: true }).catch(() => {});
    runtime.stub.held.splice(0).forEach(release => release()); runtime.stub.next = "complete";
    await browser.close();
  }
}
