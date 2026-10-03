import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
import type { ImageObject, DeliveryObject } from "@/domain/morpho/types";
import type { DeliveryOutputManifest } from "@/domain/morpho/deliveryOutput";
import type { APlusAgentProviderRequest } from "@/shared/agentTurnJournalProtocol";
import type { VisualLineageSnapshot, VisualProviderInputManifest } from "@/domain/operations/types";
import { agentCalls, setAgentRequestScript } from "./fixtures/agentMock";
import { toolCallTurnScript } from "./support/agentSse";
import { assetIdentity, readWorkspace, selectP7, setupP7, dismissP7Notice } from "./eval/browser";
import { EvidenceRun, observedState, hash } from "./eval/evidence";
import type { OracleFact } from "./eval/contracts";
import { trajectories, deferredOracles } from "./eval/contracts";

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFh0AAAAASUVORK5CYII=";
type ImageWire = { input: { images: string[]; referenceObjectIds: string[]; prompt: string; visualLineage: VisualLineageSnapshot; visualProviderInputs: VisualProviderInputManifest } };
const fact = (label: string, expected: unknown, actual: unknown): OracleFact => ({ label, expected, actual });
// P2B may append truthful delivered-pixels observations to an old generated source.
// These receipts are not a rewrite of its image content or frozen generation provenance.
function frozenImage(image: ImageObject) {
  return { ...image, generation: image.generation ? { ...image.generation, observations: undefined } : undefined };
}

test("P7A deterministic T2→T4 live closed loop", async ({ page }, info) => {
  const run = new EvidenceRun({ unobserved: true }, { notLoaded: true });
  let failure: unknown;
  let failureState: (() => Promise<unknown>) | undefined;
  try {
    const { seed, assetIdentities, fixtureHash } = await setupP7(page);
    const read = () => readWorkspace(page, seed);
    const initial = await read(); const initialIds = Object.keys(initial.objects);
    const { parent, material, excluded, defaultReference, direction, branch } = seed.aliases;
    const observe = (w: Awaited<ReturnType<typeof read>>) => observedState(w, [parent, material, excluded, defaultReference, direction], initialIds);
    failureState = async () => observe(await read());
    const served = await page.request.get("/api/build-provenance");
    const build = await served.json() as { sourceSha: string; buildId: string; sourceTreeSha256: string };
    run.build = build; run.fixture = { version: seed.version, fixtureHash, aliases: seed.aliases, assets: assetIdentities };
    await run.save("trajectory-contracts.json", { trajectories, deferredOracles });
    await run.save("start-state.json", observe(initial));
    await run.save("assets-manifest.json", assetIdentities);
    expect(served.ok()).toBe(true);
    expect(build.sourceSha).toBe(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());

    // Deterministic Agent read still executes the production local tool and receives its output.
    run.activeCheckpoint = "T2.1";
    const readScript = toolCallTurnScript({ toolName: "read_project_memory", argumentsText: JSON.stringify({ keys: ["projectOverview", "openQuestions"] }), finalText: "当前路线是守望塔；性能仍未验证。" });
    await setAgentRequestScript(page, [{ kind: "stream", chunks: readScript.first }, { kind: "stream", chunks: readScript.second }]);
    await page.locator(".ai-panel textarea").fill("项目当前路线是什么？有哪些尚未确定的部分？读取项目概览与待确认问题后回答。");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
    await expect.poll(async () => { const m = (await read()).ai.messages.filter((m) => m.role === "assistant").at(-1); return m?.id !== initial.ai.messages.at(-1)?.id && m?.status === "done" && m.body.includes("当前路线是守望塔"); }).toBe(true);
    let calls = await agentCalls(page);
    await run.wire("T2-1", calls);
    let after = await read();
    const readRequests = calls.filter((c) => c.url.endsWith("/requests") && c.method === "POST");
    const readContinuation = (readRequests.at(-1)?.body as { providerRequest: APlusAgentProviderRequest }).providerRequest;
    await run.checkpoint(page, "T2.1", { event: { mode: "discussion", selection: [], authority: "read-only", mockAnswerIsNotQualityEvidence: true }, before: observe(initial), after: observe(after), facts: [
      fact("case primary is independently frozen A", direction, after.workingState.primaryDirectionId),
      fact("raw primary status", "primary", after.objects[direction].type === "conceptDirection" ? after.objects[direction].status : undefined),
      fact("actual read result names current route", true, JSON.stringify(readContinuation.continuationItems).includes("守望塔")),
      fact("history noise did not choose direction", initial.decisionRecords, after.decisionRecords),
      fact("no object writes from discussion", initialIds.sort(), Object.keys(after.objects).sort())
    ] });

    run.activeCheckpoint = "T2.2+T2.4+T2.6";
    await selectP7(page, seed, parent); await selectP7(page, seed, material, true); await selectP7(page, seed, excluded, true);
    const beforeGeneration = await read();
    await page.evaluate((base64) => {
      const previous = window.fetch.bind(window); sessionStorage.setItem("p7-image-wire", "[]");
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/actions/image") && init?.method === "POST") {
          const ledger = JSON.parse(sessionStorage.getItem("p7-image-wire")!) as unknown[];
          ledger.push(JSON.parse(String(init.body))); sessionStorage.setItem("p7-image-wire", JSON.stringify(ledger));
          if (ledger.length === 2) return Response.json({ error: "P7 deterministic second item failure", code: "mock_image_failure" }, { status: 400 });
          if (ledger.length > 2) throw new Error("invalid_run: image script overrun");
          return new Response(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)), { headers: { "content-type": "image/png" } });
        }
        return previous(input, init);
      };
    }, PIXEL);
    const generation = toolCallTurnScript({ toolName: "generate_visuals", argumentsText: JSON.stringify({ kind: "visualDevelopment", items: [1, 2].map((id) => ({
      id: `p7-cmf-${id}`, title: `P7 CMF ${id}`, purpose: "保持守望塔身份，只改 CMF", identityParentObjectId: parent, targetDirectionId: direction,
      referenceBindings: [{ objectId: material, role: "cmf", required: true }], requestedReferenceObjectIds: [material], excludedReferenceObjectIds: [excluded], excludeDefaultReference: true,
      changeGoals: ["CMF"], preserve: ["中央塔体", "浮圈与下部装置关系", "太阳能板层级"], allowToChange: ["材料与配色"], productForm: [], materialsAndCmf: ["哑光"], environmentAndLighting: [], avoid: [], role: "cmfStudy"
    })) }), finalText: "已保存第一张；第二张失败，保留缺口。" });
    await run.save("T2-generation-fixed-responses.json", { generation, image: { successBase64: PIXEL, secondStatus: 400, secondCode: "mock_image_failure" } });
    await setAgentRequestScript(page, [{ kind: "stream", chunks: generation.first }, { kind: "stream", chunks: generation.second }]);
    const user = "只继续 A 生成两张 CMF 图，借用 M 作为材质参考，本轮不使用 X，本轮不使用默认参考，结构别动。";
    await page.locator(".ai-panel textarea").fill(user);
    await page.getByRole("button", { name: "本轮允许生图", exact: true }).click();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(async () => { const m = (await read()).ai.messages.filter((m) => m.role === "assistant").at(-1); return m?.id !== beforeGeneration.ai.messages.at(-1)?.id && m?.status === "done" && m.body.includes("已保存第一张"); }, { timeout: 45_000 }).toBe(true);
    after = await read();
    calls = await agentCalls(page); await run.wire("T2-generation", calls);
    const imageWire = await page.evaluate(() => JSON.parse(sessionStorage.getItem("p7-image-wire")!) as ImageWire[]);
    await run.wire("T2-image", imageWire);
    const children = Object.values(after.objects).filter((o): o is ImageObject => o.type === "image" && !initialIds.includes(o.id));
    const child = children[0];
    const imageCall = imageWire[0];
    const generationRequest = calls.filter((c) => c.url.endsWith("/requests") && c.method === "POST").slice(-2)[0]?.body as { providerRequest: APlusAgentProviderRequest };
    const activity = generationRequest.providerRequest.taskContract?.activities.find((a) => a.kind === "visualDevelopment");
    const expectedAssets = [parent, material].map((id) => (initial.objects[id] as ImageObject).assetId);
    const pixelIdentities = imageCall?.input.images.map((data) => hash(Buffer.from(data.split(",")[1], "base64")));
    const expectedPixelHashes = expectedAssets.map((id) => assetIdentities.find((a) => a.assetId === id)?.sha256);
    const generationFacts = [
      fact("one new object from two requests", 1, children.length), fact("two external mock attempts only", 2, imageWire.length),
      fact("actual source scope", [parent], activity?.sourceObjectIds), fact("exclusion authorization", true, activity?.excludedObjectIds.includes(excluded)),
      fact("default unchanged by turn", defaultReference, after.workingState.currentDefaultReferenceId),
      fact("actual reference IDs exact", [parent, material], imageCall?.input.referenceObjectIds),
      fact("actual reference binary identities", expectedPixelHashes, pixelIdentities),
      fact("identity parent", parent, child?.generation?.lineage?.identityParent?.objectId),
      fact("Direction", direction, child?.directionId), fact("Visual Branch", branch, child?.visualBranchId),
      fact("one direct version parent", [parent], after.relations.filter((r) => r.kind === "version" && r.toObjectId === child?.id).map((r) => r.fromObjectId)),
      fact("saved lineage equals sent lineage", imageCall?.input.visualLineage, child?.generation?.lineage),
      fact("saved input manifest equals sent input manifest", imageCall?.input.visualProviderInputs, child?.generation?.providerInputs),
      fact("honest partial fulfillment", "partial", after.ai.messages.at(-1)?.taskFulfillment?.status),
      fact("failed item fact persisted", true, JSON.stringify(after.operations).includes("P7 deterministic second item failure")),
      fact("no automatic visual verification", undefined, child?.generation?.observations),
      fact("parent content and frozen provenance remain", frozenImage(beforeGeneration.objects[parent] as ImageObject), frozenImage(after.objects[parent] as ImageObject)),
      fact("no primary/Decision mutation", beforeGeneration.decisionRecords, after.decisionRecords)
    ];
    await run.checkpoint(page, "T2.2+T2.4+T2.6", { event: { user, selection: beforeGeneration.ui.lastSelectionIds, mode: "image-enabled", authority: generationRequest.providerRequest.taskContract, injectedFault: "second Image POST returns permanent 400" }, before: observe(beforeGeneration), after: observe(after), facts: generationFacts });
    if (!child?.assetId) throw new Error("No successful live child asset");
    const childAssetId = child.assetId;
    const childBinary = await assetIdentity(page, after, childAssetId); await run.save("generated-asset.json", childBinary);
    await run.save("generated-image.png", Buffer.from(PIXEL, "base64"));
    await page.reload(); await expect(page.locator(".tl-container")).toBeVisible();
    await dismissP7Notice(page);
    const reopenedT2 = await read();
    await run.checkpoint(page, "T2.6-reload", { event: { action: "reload" }, before: observe(after), after: observe(reopenedT2), reopen: observe(reopenedT2), facts: [
      fact("saved child and lineage survive", after.objects[child.id], reopenedT2.objects[child.id]),
      fact("failure operations survive", after.operations, reopenedT2.operations),
      fact("no replay creates another Image", 2, imageWire.length),
      fact("persisted success binary", childBinary, await assetIdentity(page, reopenedT2, childAssetId)),
      fact("partial fulfillment survives", "partial", reopenedT2.ai.messages.at(-1)?.taskFulfillment?.status)
    ] });

    run.activeCheckpoint = "T2.5";
    await page.getByRole("button", { name: "回到项目概览", exact: true }).click();
    await selectP7(page, seed, parent);
    const unconfirmed = await read();
    await page.locator('[aria-label="选中对象工具"]').getByRole("button", { name: "设为后续默认参考", exact: true }).click();
    // No known descendants of E means the explicit toolbar action applies directly.
    // When descendants exist, the current product offers a second, explicit choice.
    const replaceOnly = page.locator(".confirm-card").getByRole("button", { name: "只替换默认参考", exact: true });
    if (await replaceOnly.isVisible()) await replaceOnly.click();
    await expect.poll(async () => (await read()).workingState.currentDefaultReferenceId).toBe(parent);
    after = await read();
    await run.checkpoint(page, "T2.5", { event: { selection: [parent], action: "return to old A and replace default only" }, before: observe(unconfirmed), after: observe(after), facts: [
      fact("confirmation boundary", defaultReference, unconfirmed.workingState.currentDefaultReferenceId),
      fact("explicit replacement", parent, after.workingState.currentDefaultReferenceId),
      fact("child frozen generation retained", child.generation, (after.objects[child.id] as ImageObject).generation),
      fact("other version assets retained", initial.assets, Object.fromEntries(Object.keys(initial.assets).map((id) => [id, after.assets[id]])))
    ] });

    // From this point, only actual IDs created above are used. No reseed/domain fixture writes.
    run.activeCheckpoint = "T4.1+T4.2";
    await page.getByRole("button", { name: "交付准备", exact: true }).click();
    const panel = page.locator('[aria-label="交付准备"]');
    await panel.getByLabel("交付准备标题", { exact: true }).fill("P7 三张展板准备包");
    await panel.getByLabel("交付形式", { exact: true }).selectOption("board");
    await panel.getByRole("button", { name: "新建", exact: true }).click();
    await expect.poll(async () => Object.values((await read()).objects).some((o) => o.type === "delivery" && o.title === "P7 三张展板准备包")).toBe(true);
    await panel.getByLabel("新增章节标题", { exact: true }).fill("本次视觉与验证缺口");
    await panel.getByRole("button", { name: "新增章节", exact: true }).click();
    await expect.poll(async () => Object.values((await read()).objects).some((o) => o.type === "delivery" && o.title === "P7 三张展板准备包" && o.sections.some((s) => s.title === "本次视觉与验证缺口"))).toBe(true);
    const created = await read();
    const delivery = Object.values(created.objects).find((o): o is DeliveryObject => o.type === "delivery" && o.title === "P7 三张展板准备包")!;
    const section = delivery.sections.find((s) => s.title === "本次视觉与验证缺口")!;
    async function openPackage() {
      await page.getByRole("button", { name: "交付准备", exact: true }).click();
      await panel.locator(".delivery-package-row").filter({ hasText: delivery.title }).click();
      await panel.locator(".delivery-section-tab").filter({ hasText: section.title }).click();
      await expect(panel.getByLabel("章节标题", { exact: true })).toHaveValue(section.title);
    }
    await run.checkpoint(page, "T4.1-structure", { event: { action: "create board package and chapter", delivery: delivery.id, section: section.id }, before: observe(after), after: observe(created), facts: [
      fact("board format", "board", delivery.format), fact("explicit chapter", "本次视觉与验证缺口", section.title)
    ] });
    await panel.getByRole("button", { name: "关闭交付准备", exact: true }).click();
    // Select the actual generated canvas instance; no test writes between T2 and T4.
    await page.getByRole("button", { name: "回到项目概览", exact: true }).click();
    await selectP7(page, seed, child.id);
    await openPackage();
    await panel.getByRole("button", { name: "加入当前选中对象", exact: true }).click();
    await panel.getByRole("button", { name: "关闭交付准备", exact: true }).click();
    await page.getByRole("button", { name: "回到项目概览", exact: true }).click(); await selectP7(page, seed, parent);
    await openPackage();
    await panel.getByRole("button", { name: "加入当前选中对象", exact: true }).click();
    const card = panel.locator(".delivery-reference-card").first();
    const caption = "CMF 概念图；性能与耐久尚未验证。", note = "保留第一张成功结果，第二张生成失败。";
    await card.getByPlaceholder("图注 / 引用说明").fill(caption); await card.getByPlaceholder("内部备注").fill(note);
    await panel.getByLabel("待补内容", { exact: true }).fill("仍需验证声学性能与海况耐久；第二张图未生成。");
    await panel.getByRole("button", { name: "添加", exact: true }).click();
    await expect.poll(async () => ((await read()).objects[delivery.id] as DeliveryObject).sections.find((s) => s.id === section.id)?.referenceIds.length).toBe(2);
    await expect.poll(async () => { const w = await read(); const d = w.objects[delivery.id] as DeliveryObject; return d.gaps.some((g) => g.label.includes("仍需验证")) && Object.values(w.deliveryReferences).some((r) => r.sourceObjectId === child.id && r.editorial?.caption === caption && r.editorial.note === note); }).toBe(true);
    const added = await read();
    const refs = (added.objects[delivery.id] as DeliveryObject).sections.find((s) => s.id === section.id)!.referenceIds;
    await run.checkpoint(page, "T4.1+T4.2", { event: { createPackage: delivery.id, section: section.id, addedSources: [child.id, parent], caption, note }, before: observe(created), after: observe(added), facts: [
      fact("live objects exactly bound", [child.id, parent], refs.map((id) => added.deliveryReferences[id].sourceObjectId)),
      fact("child asset snapshot exact", child.assetId, added.deliveryReferences[refs[0]].snapshot.previewAsset?.assetId),
      fact("image remains unverified", "unverified", added.deliveryReferences[refs[0]].snapshot.provenance?.status),
      fact("open gap explicit", true, (added.objects[delivery.id] as DeliveryObject).gaps.some((g) => g.status === "open" && g.label.includes("尚") || g.status === "open" && g.label.includes("仍需验证")))
    ] });

    const narrative = "守望塔沿用中央塔体、浮圈与下部装置关系。本次保存一张 CMF 图，另一张失败。声学性能与海况耐久仍未验证。";
    async function draft(label: string) {
      const before = await read();
      const sourceRead = toolCallTurnScript({ toolName: "read_workspace_source", argumentsText: JSON.stringify({ kind: "delivery", objectId: delivery.id, sectionId: section.id, start: 8000, length: 8000 }) });
      const script = toolCallTurnScript({ toolName: "prepare_delivery_section_draft", argumentsText: JSON.stringify({ narrative, captions: [{ referenceId: refs[0], caption }], suggestedGaps: [] }), finalText: "草稿待用户确认。" });
      const readChunks = sourceRead.first.map((chunk) => chunk.replaceAll("call-e2e-tool-1", "p7-delivery-read"));
      await run!.save(`${label}-fixed-responses.json`, { read: readChunks, draft: script });
      await setAgentRequestScript(page, [{ kind: "stream", chunks: readChunks }, { kind: "stream", chunks: script.first }, { kind: "stream", chunks: script.second }]);
      await panel.getByRole("button", { name: "生成本节说明草稿", exact: true }).click();
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await expect.poll(async () => { const m = (await read()).ai.messages.filter((m) => m.role === "assistant").at(-1); return m?.id !== before.ai.messages.at(-1)?.id && ["done", "failed", "cancelled"].includes(m?.status ?? ""); }, { timeout: 40_000 }).toBe(true);
      const next = await read();
      const pending = Object.values(next.deliverySectionDrafts).find((d) => d.deliveryObjectId === delivery.id && d.status === "pending");
      await run!.wire(label, await agentCalls(page));
      await run!.checkpoint(page, `${label}-generation`, { event: { action: "generate draft for explicitly selected chapter", delivery: delivery.id, section: section.id }, before: observe(before), after: observe(next), facts: [
        fact("authorized pending draft persisted", true, Boolean(pending)),
        fact("draft turn completes", "done", next.ai.messages.filter((m) => m.role === "assistant").at(-1)?.status)
      ] });
      if (!pending) throw new Error("No pending draft after authorized generation");
      await run!.checkpoint(page, `${label}-pending`, { event: { tool: "prepare_delivery_section_draft", target: { delivery: delivery.id, section: section.id } }, before: observe(before), after: observe(next), facts: [
        fact("pending not applied narrative", (before.objects[delivery.id] as DeliveryObject).sections.find((s) => s.id === section.id)?.narrative, (next.objects[delivery.id] as DeliveryObject).sections.find((s) => s.id === section.id)?.narrative),
        fact("frozen baseline exact references", refs, pending.generationBaseline?.referenceIds), fact("pending status", "pending", pending.status)
      ] });
      return pending;
    }
    run.activeCheckpoint = "T4.3";
    const discarded = await draft("T4.3-discard");
    const beforeDiscard = await read(); await panel.getByRole("button", { name: "放弃", exact: true }).click();
    await expect.poll(async () => (await read()).deliverySectionDrafts[discarded.id]?.status).toBe("discarded");
    const afterDiscard = await read();
    await run.checkpoint(page, "T4.3-discard", { event: { action: "discard", draft: discarded.id }, before: observe(beforeDiscard), after: observe(afterDiscard), facts: [
      fact("discard state", "discarded", afterDiscard.deliverySectionDrafts[discarded.id]?.status),
      fact("discard keeps applied narrative", (beforeDiscard.objects[delivery.id] as DeliveryObject).sections, (afterDiscard.objects[delivery.id] as DeliveryObject).sections)
    ] });
    const applied = await draft("T4.3-apply"); await panel.getByRole("button", { name: /^(应用草稿|复核后覆盖并应用草稿)$/ }).click();
    await expect(panel.getByLabel("章节说明", { exact: true })).toHaveValue(narrative);
    await expect.poll(async () => (await read()).deliverySectionDrafts[applied.id]?.status).toBe("applied");
    const afterApply = await read();
    await run.checkpoint(page, "T4.3-apply", { event: { action: "explicit apply", draft: applied.id }, before: observe(afterDiscard), after: observe(afterApply), facts: [
      fact("applied state", "applied", afterApply.deliverySectionDrafts[applied.id]?.status),
      fact("applied narrative", narrative, (afterApply.objects[delivery.id] as DeliveryObject).sections.find((s) => s.id === section.id)?.narrative),
      fact("no primary change", direction, afterApply.workingState.primaryDirectionId)
    ] });
    // Keep a later pending draft: source/ref changes must make it stale, not silently applied.
    const staleDraft = await draft("T4.4-stale");
    run.activeCheckpoint = "T4.4";
    const beforeSource = await read();
    await panel.getByRole("button", { name: "关闭交付准备", exact: true }).click();
    await page.getByRole("button", { name: "回到项目概览", exact: true }).click(); await selectP7(page, seed, material);
    // Supported upstream metadata change: explicitly replace A and mark its descendants for review.
    await page.locator('[aria-label="选中对象工具"]').getByRole("button", { name: "设为后续默认参考", exact: true }).click();
    await page.locator(".confirm-card").first().getByRole("button", { name: "替换并标记相关素材待复核", exact: true }).click();
    await selectP7(page, seed, child.id);
    await page.locator('[aria-label="选中对象工具"]').getByRole("button", { name: "隐藏对象", exact: true }).click();
    await openPackage();
    await expect(card).toContainText("已有更新"); await expect(card).toContainText("已隐藏");
    await expect(panel.getByText("适用性：需要复核", { exact: true })).toBeVisible();
    await expect.poll(async () => (await read()).objects[child.id]?.visibility).toBe("hidden");
    const changedSource = await read();
    await run.checkpoint(page, "T4.4", { event: { action: "explicit default replacement with descendant review, then hide upstream", source: child.id }, before: observe(beforeSource), after: observe(changedSource), facts: [
      fact("hidden source remains", "hidden", changedSource.objects[child.id]?.visibility),
      fact("frozen snapshot remains", beforeSource.deliveryReferences[refs[0]].snapshot, changedSource.deliveryReferences[refs[0]].snapshot),
      fact("other reference remains", beforeSource.deliveryReferences[refs[1]], changedSource.deliveryReferences[refs[1]]),
      fact("pending still pending", "pending", changedSource.deliverySectionDrafts[staleDraft.id].status)
    ] });
    run.activeCheckpoint = "T4.5";
    // Current UI only refreshes active sources. Restore explicitly, without touching the frozen ref.
    await panel.getByRole("button", { name: "关闭交付准备", exact: true }).click();
    await page.getByRole("button", { name: "已隐藏内容", exact: true }).click();
    const hidden = page.locator('section.side-drawer[aria-label="已隐藏内容"]');
    await hidden.locator(".asset-row").filter({ hasText: child.title }).getByRole("button", { name: "恢复并定位", exact: true }).click();
    await openPackage();
    await card.getByRole("button", { name: "更新为当前版本", exact: true }).click();
    await card.getByRole("button", { name: "确认更新", exact: true }).click();
    await expect.poll(async () => (await read()).deliveryReferences[refs[0]]?.copyReview).toBe("needsReview");
    const refreshed = await read();
    await expect(card).toContainText("需要复核");
    await expect(card.getByPlaceholder("图注 / 引用说明")).toHaveValue(caption); await expect(card.getByPlaceholder("内部备注")).toHaveValue(note);
    await run.checkpoint(page, "T4.5", { event: { action: "refresh only named reference", reference: refs[0] }, before: observe(changedSource), after: observe(refreshed), facts: [
      fact("named source review refreshed", true, Boolean(refreshed.deliveryReferences[refs[0]].snapshot.provenance?.reviewStatus)),
      fact("only named snapshot changed", changedSource.deliveryReferences[refs[1]], refreshed.deliveryReferences[refs[1]]),
      fact("caption/note preserved", { caption, note }, refreshed.deliveryReferences[refs[0]].editorial),
      fact("copy needs review", "needsReview", refreshed.deliveryReferences[refs[0]].copyReview),
      fact("narrative not auto rewritten", narrative, (refreshed.objects[delivery.id] as DeliveryObject).sections.find((s) => s.id === section.id)?.narrative),
      fact("visual still unverified", "unverified", refreshed.deliveryReferences[refs[0]].snapshot.provenance?.status)
    ] });

    run.activeCheckpoint = "T4.6";
    await panel.getByRole("button", { name: "关闭交付准备", exact: true }).click();
    await page.getByRole("button", { name: "回到项目概览", exact: true }).click(); await selectP7(page, seed, child.id);
    await page.locator('[aria-label="选中对象工具"]').getByRole("button", { name: "隐藏对象", exact: true }).click();
    await expect.poll(async () => (await read()).objects[child.id]?.visibility).toBe("hidden");
    await page.getByRole("button", { name: "输出", exact: true }).click();
    const output = page.locator('[aria-label="交付输出"]');
    // Output may retain an older case package; choose this run's actual package explicitly.
    await output.locator(".delivery-output-row").filter({ hasText: "P7 三张展板准备包" }).click();
    const beforeExport = await read();
    const [download] = await Promise.all([page.waitForEvent("download"), output.getByRole("button", { name: /导出/ }).click()]);
    const stream = await download.createReadStream(); if (!stream) throw new Error("Missing output stream");
    const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks), zip = unzipSync(bytes);
    const manifest = JSON.parse(strFromU8(zip["output-manifest.json"])) as DeliveryOutputManifest;
    const sourceMap = JSON.parse(strFromU8(zip["source-map.json"])) as { references: Array<{ referenceId: string }>; sections: Array<{ id: string; referenceIds: string[] }> };
    await run.save("delivery-output.zip", bytes); await run.save("export-manifest.json", manifest); await run.save("export-source-map.json", sourceMap);
    const exportedAsset = manifest.assets.find((a) => a.assetId === child.assetId)!;
    const afterExport = await read();
    const exportFacts = [
      fact("package identity", delivery.id, manifest.delivery.id),
      fact("source map exact chapter references", refs, sourceMap.sections.find((s) => s.id === section.id)?.referenceIds),
      fact("manifest reference IDs", refs, manifest.references.map((r) => r.referenceId)),
      fact("manifest asset identity", child.assetId, manifest.references[0]?.snapshot.previewAsset?.assetId),
      fact("export binary same persisted child", childBinary.sha256, hash(zip[exportedAsset.outputAssetPath!])),
      fact("explicit hidden source", "sourceHidden", manifest.references[0]?.inspection?.sourceVisibility),
      fact("explicit copy review", "needsReview", manifest.references[0]?.inspection?.copyReview),
      fact("explicit unverified claim", "unverified", manifest.references[0]?.inspection?.provenance.status),
      fact("pending draft stale in output", "stale", manifest.pendingSectionDrafts.find((d) => d.id === staleDraft.id)?.applicability?.status),
      fact("open gaps survive export", true, manifest.gaps.some((g) => g.status === "open" && g.label.includes("仍需验证"))),
      fact("export has no domain write", beforeExport.objects, afterExport.objects),
      fact("export has no reference write", beforeExport.deliveryReferences, afterExport.deliveryReferences)
    ];
    await page.reload(); await expect(page.locator(".tl-container")).toBeVisible();
    await dismissP7Notice(page);
    await page.getByRole("button", { name: "交付准备", exact: true }).click();
    await panel.locator(".delivery-package-row").filter({ hasText: "P7 三张展板准备包" }).click();
    await panel.getByRole("button", { name: /本次视觉与验证缺口/ }).click();
    await expect(panel.getByLabel("章节说明", { exact: true })).toHaveValue(narrative);
    const reopened = await read();
    await run.checkpoint(page, "T4.6", { event: { action: "export and reopen", delivery: delivery.id }, before: observe(beforeExport), after: observe(afterExport), reopen: observe(reopened), facts: [...exportFacts,
      fact("reference state survives reopen", refreshed.deliveryReferences, reopened.deliveryReferences),
      fact("draft states survive reopen", refreshed.deliverySectionDrafts, reopened.deliverySectionDrafts),
      fact("asset binary survives final reopen", childBinary, await assetIdentity(page, reopened, childAssetId))
    ] });
  } catch (error) {
    failure = error;
    await run.wire("failure", await agentCalls(page).catch(() => []));
    await run.save("failure-mock.json", await page.evaluate(() => ({ script: window.__morphoAgentMock?.requestScript, journal: window.__morphoAgentMock?.journal })).catch(() => ({ unavailable: true })));
    await run.save("failure-recovery-lifecycle.json", await page.evaluate(() => JSON.parse(sessionStorage.getItem("p7-last-recovery-lifecycle") ?? "null")).catch(() => ({ unavailable: true })));
    if (failureState) await run.save("failure-state.json", await failureState().catch(() => ({ unavailable: true })));
    await run.save("failure-ui.json", await page.locator(".workspace-banner, .selection-toolbar, .detail-popover, .delivery-panel, .archive-panel, .confirm-card").allTextContents().catch(() => ["page unavailable"]));
    throw error;
  } finally {
    await run.wire("compaction", await page.evaluate(() => JSON.parse(sessionStorage.getItem("p7-compaction-wire") ?? "[]")).catch(() => []));
    if (run) await run.finish(info, failure);
  }
});
