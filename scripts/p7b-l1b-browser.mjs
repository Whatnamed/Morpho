// Real client persistence/transport faults only; no mocked Auth, Journal or route results.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { baseUrl, sha256 } from "./p7b-l1b-runtime.mjs";

async function seedClient(fault) {
  const vite = await createServer({ appType: "custom", configFile: resolve("vitest.config.ts"), server: { middlewareMode: true } });
  try {
    const { createBlankWorkspace, serializeWorkspace } = await vite.ssrLoadModule("/src/domain/morpho/workspace.ts");
    const { createCatalog, summarizeProject, CATALOG_STORAGE_KEY, getProjectWorkspaceStorageKey } = await vite.ssrLoadModule("/src/infrastructure/persistence/localProjectStore.ts");
    const workspace = createBlankWorkspace(fault ? "p7b-browser-save-failure" : "p7b-browser-recovery");
    workspace.project.title = "L1b controlled client recovery";
    return { projectId: workspace.project.id, workspaceKey: getProjectWorkspaceStorageKey(workspace.project.id),
      workspaceValue: serializeWorkspace(workspace), catalogKey: CATALOG_STORAGE_KEY,
      catalogValue: JSON.stringify(createCatalog([summarizeProject(workspace)], workspace.project.id)) };
  } finally { await vite.close(); }
}

export async function runDurableClientScenario({ runtime, actor, row, output, setTurn, fault = false }) {
  const startingSubmissions = runtime.stub.calls.length;
  const seed = await seedClient(fault);
  row.seed = { projectId: seed.projectId, workspaceSha256: sha256(seed.workspaceValue), source: "current createBlankWorkspace / serializeWorkspace" };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(actor.cookie.split("; ").map(pair => {
    const split = pair.indexOf("="); return { name: pair.slice(0, split), value: pair.slice(split + 1), url: baseUrl, sameSite: "Lax" };
  }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol)
      ? route.continue() : route.abort("blockedbyclient");
  });
  await page.addInitScript(({ seed, fault }) => {
    if (!localStorage.getItem(seed.workspaceKey)) {
      localStorage.setItem(seed.catalogKey, seed.catalogValue); localStorage.setItem(seed.workspaceKey, seed.workspaceValue);
    }
    const prefix = "l1b-C-";
    if (fault) {
      const nativeSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === seed.workspaceKey && sessionStorage.getItem(prefix + "phase") === "reload" && value.includes("P7B controlled result")) {
          sessionStorage.setItem(prefix + "saveFailed", "true");
          throw new DOMException("L1b test-owned local Workspace persistence failure", "QuotaExceededError");
        }
        return nativeSet.call(this, key, value);
      };
    }
    const push = (name, value) => {
      const values = JSON.parse(sessionStorage.getItem(prefix + name) ?? "[]"); values.push(value);
      sessionStorage.setItem(prefix + name, JSON.stringify(values));
    };
    const recovery = () => Object.entries(localStorage).filter(([key]) => key.startsWith("morpho.agent-runtime-a-plus.recovery.v2"))
      .map(([, value]) => JSON.parse(value)).find(record => record.localProjectId === seed.projectId);
    const blob = async ref => {
      if (!ref) return null;
      const database = await new Promise((yes, no) => { const request = indexedDB.open("morpho-assets-v1"); request.onsuccess = () => yes(request.result); request.onerror = () => no(request.error); });
      try {
        const value = await new Promise((yes, no) => {
          const tx = database.transaction("asset-blobs", "readonly"); const req = tx.objectStore("asset-blobs").get(ref);
          let result; req.onsuccess = () => { result = req.result; }; tx.oncomplete = () => yes(result); tx.onabort = () => no(tx.error);
        });
        return value ? await value.text() : null;
      } finally { database.close(); }
    };
    const hash = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, "0")).join("");
    const native = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (!url.includes("/api/ai/")) return native(input, init);
      push("http", { url, method, phase: sessionStorage.getItem(prefix + "phase") ?? "initial" });
      if (url.endsWith("/requests") && method === "POST") {
        const body = JSON.parse(String(init.body));
        const record = recovery(); const ref = record?.coordinator.activeRequest?.providerPayload;
        const durableBody = await blob(ref?.ref);
        push("postProofs", { body, serverTurnId: record?.serverTurnId, requestId: record?.coordinator.activeRequest?.requestId,
          stepSequence: record?.coordinator.activeRequest?.stepSequence, providerPayload: ref,
          durableBody, durableBodySha256: durableBody === null ? null : await hash(durableBody), recoveryAtPost: record });
        const response = await native(input, init); await response.text();
        sessionStorage.setItem(prefix + "responseLost", "true");
        throw new TypeError("L1b test-owned transport loss after real Text route response completed");
      }
      if (url.includes("/effects/") && url.includes("/result") && method === "GET" && !sessionStorage.getItem(prefix + "phase")) {
        sessionStorage.setItem(prefix + "retrievalBlocked", "true");
        return new Promise(() => {}); // Page reload abandons this client-only receive barrier.
      }
      if (url.includes("/effects/") && url.includes("/result") && method === "POST") {
        const workspace = JSON.parse(localStorage.getItem(seed.workspaceKey)); const record = recovery();
        const ref = record?.coordinator.latestProviderOutputPayload; const envelope = await blob(ref?.ref);
        push("ackProofs", { ack: JSON.parse(String(init.body)), durableWorkspace: workspace,
          outputReference: ref, durableEnvelope: envelope, envelopeSha256: envelope === null ? null : await hash(envelope), recoveryAtAck: record });
      }
      const response = await native(input, init);
      push("responses", { url, method, status: response.status });
      return response;
    };
  }, { seed, fault });
  const facts = () => page.evaluate(({ workspaceKey }) => ({
    postProofs: JSON.parse(sessionStorage.getItem("l1b-C-postProofs") ?? "[]"),
    ackProofs: JSON.parse(sessionStorage.getItem("l1b-C-ackProofs") ?? "[]"),
    http: JSON.parse(sessionStorage.getItem("l1b-C-http") ?? "[]"), responses: JSON.parse(sessionStorage.getItem("l1b-C-responses") ?? "[]"),
    workspace: JSON.parse(localStorage.getItem(workspaceKey)),
    recoveries: Object.entries(localStorage).filter(([key]) => key.startsWith("morpho.agent-runtime-a-plus.recovery.v2")),
    responseLost: sessionStorage.getItem("l1b-C-responseLost"), retrievalBlocked: sessionStorage.getItem("l1b-C-retrievalBlocked"),
    localSaveFailed: sessionStorage.getItem("l1b-C-saveFailed")
  }), { workspaceKey: seed.workspaceKey });
  const label = fault ? "local-save-failure" : "reload";
  const checkpoint = async name => { row.checkpoint = name; const value = await facts(); await writeFile(resolve(output, `C-${label}-${name}.json`), JSON.stringify(value, null, 2) + "\n"); return value; };
  try {
    await page.goto(`${baseUrl}/projects/${seed.projectId}`);
    await page.locator(".ai-panel textarea").fill("请只用简短文字回复这条消息，不调用任何工具。");
    await page.locator('[aria-label="发送"]').click();
    await page.waitForFunction(() => sessionStorage.getItem("l1b-C-retrievalBlocked") === "true", null, { timeout: 30_000 });
    const before = await checkpoint("before-reload");
    assert.equal(before.postProofs.length, 1, "One original Text request identity before reload");
    const proof = before.postProofs[0]; setTurn(proof.serverTurnId);
    assert.equal(proof.requestId, proof.body.requestId, "POST identity must already be durable");
    assert.equal(proof.stepSequence, proof.body.stepSequence);
    assert.equal(proof.providerPayload.sha256, proof.durableBodySha256);
    assert.deepEqual(JSON.parse(proof.durableBody), proof.body.providerRequest, "Exact client request must be committed in IndexedDB before POST");
    assert.equal(before.ackProofs.length, 0); assert.equal(runtime.stub.calls.length - startingSubmissions, 1);
    row.preSend = { serverTurnId: proof.serverTurnId, requestId: proof.requestId, stepSequence: proof.stepSequence,
      clientBodySha256: sha256(JSON.stringify(proof.body)), durableProviderBodySha256: proof.durableBodySha256, verifiedBeforePost: true };
    await page.evaluate(() => sessionStorage.setItem("l1b-C-phase", "reload"));
    await page.reload();
    if (fault) {
      await page.waitForFunction(() => sessionStorage.getItem("l1b-C-saveFailed") === "true", null, { timeout: 30_000 });
      await page.locator(".workspace-banner.is-error").waitFor({ state: "visible", timeout: 30_000 });
    } else {
      await page.waitForFunction(() => JSON.parse(sessionStorage.getItem("l1b-C-responses") ?? "[]").some(r => r.method === "POST" && r.url.includes("/effects/") && r.status === 200), null, { timeout: 30_000 });
    }
    const after = await checkpoint("ack-entry");
    assert.equal(after.postProofs.length, 1, "Reload must not create a second Request POST/identity");
    assert.equal(runtime.stub.calls.length - startingSubmissions, 1, "Reload must not submit a second Provider execution");
    assert.ok(after.http.some(h => h.phase === "reload" && h.method === "GET" && h.url.includes(`/turns/${proof.serverTurnId}?`)), "Reload queries original real Server Journal");
    assert.ok(after.http.some(h => h.phase === "reload" && h.method === "GET" && h.url.includes("/effects/") && h.url.includes("chunk=")), "Reload consumes real original escrow chunks");
    if (fault) {
      assert.equal(after.localSaveFailed, "true"); assert.equal(after.ackProofs.length, 0, "Failed local save cannot ACK");
      assert.ok(after.recoveries.length > 0, "Failed local save retains recoverable original envelope");
      assert.ok(!after.workspace.ai.messages.some(m => m.role === "assistant" && m.body.includes("P7B controlled result")), "Failed save must not claim durable full result");
      const record = JSON.parse(after.recoveries[0][1]);
      row.localSaveFailure = { injected: true, ackPosts: 0, recoveryRetained: true,
        recoveryPhase: record.coordinator.lifecycle.phase, overallLocalOutcome: record.coordinator.lifecycle.outcome,
        lifecyclePersistence: record.coordinator.lifecycle.persistence, metadataLocalPersistence: record.metadata.localPersistence,
        savedAssistantBodies: after.workspace.ai.messages.filter(m => m.role === "assistant").map(m => m.body) };
      assert.notEqual(record.coordinator.lifecycle.outcome?.kind, "completed",
        "Failed final conversation persistence must not retain completed Overall Local Turn Outcome / succeeded local persistence");
    } else for (const ack of after.ackProofs) {
      assert.equal(ack.outputReference?.sha256, ack.envelopeSha256, "Verified envelope must be durable before ACK");
      assert.equal(JSON.parse(ack.durableEnvelope).requestId, proof.requestId);
      assert.ok(ack.durableWorkspace.ai.messages.some(m => m.role === "assistant" && m.body.includes("P7B controlled result")),
        "Complete assistant conversation must be durably saved before result ACK");
    }
    row.reload = { journalQuery: true, exactResultRedelivery: true, providerSubmissions: 1, requestPosts: 1,
      ...(fault ? {} : { envelopeBeforeAck: true, conversationBeforeAck: true }) };
  } finally {
    row.pageErrors = errors;
    await checkpoint("final").catch(() => {});
    await page.screenshot({ path: resolve(output, `C-${label}-final.png`), fullPage: true }).catch(() => {});
    await browser.close();
  }
}
