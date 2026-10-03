import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { CONTRACT_VERSION, FIXTURE_VERSION, RUBRIC_VERSION, judgeFacts, trajectories, type OracleFact, type Verdict } from "./contracts";

export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function observedState(workspace: MorphoWorkspace, sourceIds: string[], initialIds: string[]) {
  const ids = [...new Set([...sourceIds, ...Object.keys(workspace.objects).filter((id) => !initialIds.includes(id))])];
  return {
    project: workspace.project, selection: workspace.ui.lastSelectionIds, workingState: workspace.workingState,
    objects: Object.fromEntries(ids.map((id) => [id, workspace.objects[id]])),
    assets: Object.fromEntries(ids.flatMap((id) => { const o = workspace.objects[id]; return o?.type === "image" && o.assetId ? [[o.assetId, workspace.assets[o.assetId]]] : []; })),
    relations: workspace.relations.filter((r) => ids.includes(r.fromObjectId) || ids.includes(r.toObjectId)),
    decisions: workspace.decisionRecords, drafts: workspace.deliverySectionDrafts,
    references: workspace.deliveryReferences, operations: workspace.operations,
    messages: workspace.ai.messages.filter((m) => !m.id.startsWith("p7-history") && (m.createdAt ?? "") >= "2026-10-03"),
    summaryRevisions: workspace.ai.conversationSummaryRevisions,
    directionRevisions: workspace.directionRevisions, definitionRevisions: workspace.designDefinitionRevisions
  };
}

export class EvidenceRun {
  readonly directory = resolve("output/playwright/p7", `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}`);
  readonly checkpoints: Array<{ id: string; verdict: Verdict; file: string; assertions: ReturnType<typeof judgeFacts> }> = [];
  readonly artifacts: Array<{ file: string; sha256: string; byteLength: number }> = [];
  activeCheckpoint = "setup";
  private wireBytes = 0;
  private started = Date.now();
  constructor(public build: unknown, public fixture: unknown) {}
  async save(file: string, data: unknown | Uint8Array) {
    const bytes = data instanceof Uint8Array ? data : Buffer.from(`${JSON.stringify(data, null, 2)}\n`);
    await mkdir(this.directory, { recursive: true });
    await writeFile(resolve(this.directory, file), bytes);
    this.artifacts.push({ file, sha256: hash(bytes), byteLength: bytes.length });
  }
  async wire(label: string, data: unknown) {
    const bytes = Buffer.from(JSON.stringify(data)); this.wireBytes += bytes.length;
    if (this.wireBytes > trajectories[0].budget.maxWireBytes) throw new Error("ungradable: bounded wire evidence capacity exceeded");
    await this.save(`${label}-client-wire.json`, data);
  }
  async checkpoint(page: Page, id: string, input: { event: unknown; before: unknown; after: unknown; reopen?: unknown; facts: OracleFact[] }) {
    this.activeCheckpoint = id;
    const assertions = judgeFacts(input.facts);
    const verdict = assertions.some((a) => a.verdict === "fail") ? "fail" : "pass";
    const file = `${id.replaceAll(/[^a-zA-Z0-9-]/g, "-")}.json`;
    await this.save(file, { id, verdict, ...input, assertions });
    this.checkpoints.push({ id, file, verdict, assertions });
    await this.save(`${file}.png`, await page.screenshot());
    if (verdict === "fail") throw new Error(`P7 first divergence ${id}: ${assertions.filter((a) => a.verdict === "fail").map((a) => a.label).join(", ")}`);
  }
  async finish(info: TestInfo, error?: unknown) {
    const failure = error instanceof Error ? { message: error.message, stack: error.stack } : error ? { message: String(error) } : undefined;
    const first = this.checkpoints.find((c) => c.verdict === "fail");
    await this.save("run-manifest.json", {
      schemaVersion: "p7-evidence-1", trajectory: "T2→T4", contractVersion: CONTRACT_VERSION, fixtureVersion: FIXTURE_VERSION, rubricVersion: RUBRIC_VERSION,
      sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), build: this.build, fixture: this.fixture,
      mode: "closed-loop deterministic L1 slice", attempt: info.retry + 1,
      verdict: failure ? first ? "fail" : failure.message.startsWith("invalid_run:") ? "invalid_run" : "ungradable" : "pass", firstObservableDivergence: first?.id ?? (failure ? this.activeCheckpoint : null),
      attribution: failure ? "pending fixture/oracle versus product confirmation" : "no divergence observed",
      rescueCount: 0, automaticRetryCount: info.retry, paidProviderCalls: 0, paidCost: 0, elapsedMs: Date.now() - this.started,
      inputBoundary: "client serialized Agent/Image requests only; server final wire not observed", checkpoints: this.checkpoints,
      coverage: trajectories.map((t) => ({ trajectory: t.id, checkpoints: t.checkpoints.map((c) => ({ id: c.id, status: this.checkpoints.some((done) => done.id.split("+").some((part) => part.startsWith(c.id))) ? "evaluated-slice" : "not_run" })) })),
      notRun: ["T1 execution", "T3 execution", "T2 new-angle/real visual fidelity", "L1b real routes/Journal/RPC", "L2 real model", "L3 real image", "L4 human handoff", "production Journal fault injection"],
      artifacts: this.artifacts, failure
    });
    await info.attach("p7-run-manifest", { path: resolve(this.directory, "run-manifest.json"), contentType: "application/json" });
    console.log(`P7 evidence: ${this.directory}`);
  }
}
