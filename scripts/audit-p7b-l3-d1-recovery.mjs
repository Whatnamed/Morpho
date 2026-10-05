// Read-only readiness audit. No credentials, Provider calls or reconstructed Recovery intent.
import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const originalRun = "2026-10-05T05-03-54.495Z-21972";
const original = resolve("output/playwright/p7b-l3", originalRun);
const read = async (name) => JSON.parse(await readFile(resolve(original, name), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const evidence = JSON.parse(await readFile("docs/operations/p7b-3-l3-evidence.json", "utf8"));
for (const artifact of evidence.artifacts) {
  assert.equal(sha(await readFile(artifact.path)), artifact.sha256, `Original artifact changed: ${artifact.path}`);
}
const [after, journal, attempt, receipt] = await Promise.all([
  read("L3-1-trial-1-after.json"), read("L3-1-trial-1-journal.json"),
  read("L3-1-trial-1-attempt.json"), read("L3-1-trial-1-provider-response.json")
]);
assert.equal(journal.effects.length, 1);
assert.equal(journal.attempts.length, 1);
const effect = journal.effects[0], task = journal.attempts[0];
assert.equal(effect.effect_id, attempt.effectId);
assert.equal(effect.execution_state, "succeeded");
assert.equal(task.provider_task_id, JSON.parse(receipt.raw).id);
assert.equal(effect.effect_id, "effect:" + sha(JSON.stringify(["image", attempt.clientRequestId])));
const request = after.wire.find((w) => w.url === "/api/ai/image" && w.method === "POST");
assert.equal(JSON.parse(request.body).clientRequestId, attempt.clientRequestId);
const indexPair = after.intents.find(([key]) => key === "morpho.independent-image-delivery.v1." + after.workspace.project.id);
assert.ok(indexPair, "Original pending index must be preserved");
const entry = JSON.parse(indexPair[1]).find((e) => e.effectId === effect.effect_id);
assert.ok(entry, "Original pending index identity must match");

// The original browser exporter stored only localStorage entries; its IndexedDB blobs were
// never exported. A surviving index or request body is not the original requestBody+draft blob.
assert.equal(Object.hasOwn(after, "intentBlobs"), false);
const files = (await readdir(original, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
const host = await readFile(resolve(original, "browser-host.js"), "utf8");
assert.ok(host.includes("morpho.independent-image-delivery.v1."));
const audit = {
  version: "p7b-l3-d1-recovery-readiness-1",
  sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  originalRun, originalArtifactsVerified: evidence.artifacts.length,
  effectId: effect.effect_id, clientRequestId: attempt.clientRequestId,
  providerTaskId: task.provider_task_id, journalExecutionState: effect.execution_state,
  pendingIndexKey: entry.key, retainedIndex: true, retainedExactClientBody: true,
  retainedIntentBlob: false, originalBrowserContext: "nonpersistent context closed in original runner finally",
  retainedFiles: files,
  status: "blocked / original client Recovery intent unavailable",
  blocker: { id: "P7B-3-D2", category: "Eval harness / recovery evidence capture",
    reason: "Original IndexedDB intent requestBody+draft was not exported; no surviving original browser profile. Cannot run native independent delivery recovery without inventing an old intent." },
  resultRecovery: "not_attempted / missing original local boundary",
  newGeneratePosts: 0, newProviderGetRequests: 0, newDownloads: 0, newAcknowledgements: 0,
  cumulativePaidSubmissions: 1, cumulativeEstimatedCostCny: 0.03,
  remainingAttemptsStarted: 0,
  modelAuthorization: { authorizedForRemainingAttempts: "gpt-image-2.5", applied: false,
    originalTaskModel: "gpt-image-2", reason: "Conditional continuation stopped before new submissions; original execution cannot change model." }
};
const output = resolve("output/playwright/p7b-l3", new Date().toISOString().replaceAll(":", "-") + "-d1-recovery-audit");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "recovery-readiness.json"), JSON.stringify(audit, null, 2) + "\n");
await writeFile(resolve(output, "build-provenance.json"), await readFile(".next/morpho-build-provenance.json"));
console.log(JSON.stringify({ output, status: audit.status, blocker: audit.blocker, paid: audit.newGeneratePosts }));
