// Append a receipt without repairing D2 or rewriting any original raw verdict/ledger.
import assert from "node:assert/strict";
import { readFile,writeFile,readdir,stat } from "node:fs/promises";
import { resolve,relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const sha=b=>createHash("sha256").update(b).digest("hex"),read=async p=>JSON.parse(await readFile(p,"utf8"));
const preflightPath=resolve(process.argv[2]),runPath=resolve(process.argv[3]),receiptPath="docs/operations/p7b-2-l2-evidence.json";
const receipt=await read(receiptPath),manifest=await read("e2e/eval/p7b-l2-manifest.json");
assert.ok(!receipt.d1FixAndLimitedRun,"This append-only receipt already exists");
for(const a of receipt.artifactIndex)assert.equal(sha(await readFile(a.path)),a.sha256,`Original raw artifact changed: ${a.path}`);
for(const [p,h]of Object.entries(receipt.preregistration.originalP7FrozenFiles))assert.equal(sha((await readFile(p,"utf8")).replaceAll("\r\n","\n")),h);
assert.equal(sha(await readFile("e2e/eval/p7b-l2-manifest.json")),receipt.preregistration.manifestSha256);
execFileSync("git",["diff","--exit-code","56e94f1ce203a47078330b430c400a2720cf63cc","--","supabase","e2e/eval/p7b-l2-manifest.json","e2e/eval/p7b-l2-fixture-lock.json","e2e/eval/contracts.ts","e2e/eval/contract-lock.json","e2e/support/p7Seed.ts","docs/operations/p7b-1-l1b.md","docs/operations/p7b-1-l1b-evidence.json"]);
const preflight=await read(resolve(preflightPath,"verdict.json")),preWire=await read(resolve(preflightPath,"no-paid-server-wire.json"));
assert.equal(preflight.hardBlocker,null);assert.equal(preflight.ledger.requests,0);assert.ok(preWire.productionBody.tools.some(t=>t.name==="create_research_analysis"));
const canonical=preWire.productionBody.input.flatMap(i=>i.content??[]).find(c=>c.text?.startsWith("<morpho_turn_task_contract>"));
const contract=JSON.parse(canonical.text.split("\n")[2]);assert.equal(contract.userGoal,manifest.slices[0].prompt);
assert.ok(contract.activities.find(a=>a.kind==="research").instruction.includes("资料创建一张研究分析卡"));
const verdict=await read(resolve(runPath,"verdict.json")),request=await read(resolve(runPath,"wire-001-request.json")),raw=await readFile(resolve(runPath,"wire-001-response.txt"),"utf8");
const events=raw.split(/\r?\n/).filter(l=>l.startsWith("data: ")).flatMap(l=>{try{return [JSON.parse(l.slice(6))];}catch{return[];}});
const response=events.findLast(e=>e.response?.usage)?.response;assert.ok(response);assert.equal(response.status,"completed");
const usage=response.usage;assert.equal(usage.input_tokens,37777);assert.equal(usage.output_tokens,606);
assert.equal(verdict.ledger.requests,1);assert.equal(verdict.hardBlocker.id,"P7B-2-D2");
assert.equal(verdict.hardBlocker.reason,"Provider usage exceeded pre-send reservation");
const {max_output_tokens,...original}=request.finalWire;assert.deepEqual(original,request.productionBody);assert.equal(max_output_tokens,4096);
const cached=usage.input_tokens_details?.cached_tokens??0,rates=manifest.pricing.cnyPerMillion;
const cost=((usage.input_tokens-cached)*rates.input+cached*rates.cachedInput+usage.output_tokens*rates.output)/1e6;
const journal=await read(resolve(runPath,"L2-1-trial-1-journal.json")),facts=await read(resolve(runPath,"L2-1-trial-1-after.json"));
const trial=await read(resolve(runPath,"L2-1-trial-1-trial.json")),before=await read(resolve(runPath,"L2-1-trial-1-before.json"));
assert.deepEqual(facts.workspace.objects,before.objects);assert.deepEqual(facts.workspace.decisionRecords,before.decisionRecords);
const reconciliation={classification:"P7B-2-D2 / invalid Eval input-token reservation bound",originalLedgerPreserved:true,rawResponsePreserved:true,
  actualProviderRequests:1,providerReportedUsage:usage,estimatedCostCny:cost,inputReserve:request.inputReserve,networkRetry:0,
  finding:"Reported input usage exceeds the declared UTF-8 byte upper-bound reservation; actual total envelope was not exceeded. Guard rejected usage before adding it to raw ledger; totals here are independently recovered from original completed response.",
  trialClassification:"L2-1 trial 1 interrupted by harness blocker; no complete capability verdict. Raw executed/quality-pending label retained as history, not counted as completed baseline.",
  missingUsage:false,providerUsageAccountingExplanation:"unverified; no charge inflation or model tokenizer bug asserted",guardRepaired:false};
await writeFile(resolve(runPath,"usage-reconciliation.json"),JSON.stringify(reconciliation,null,2)+"\n");
const artifacts=[];for(const directory of [preflightPath,runPath])for(const name of await readdir(directory)){
  const path=resolve(directory,name);if(!(await stat(path)).isFile())continue;const bytes=await readFile(path);artifacts.push({path:relative(process.cwd(),path).replaceAll("\\","/"),bytes:bytes.length,sha256:sha(bytes),retainedInGit:false});
}
receipt.currentBlocker="P7B-2-D2";receipt.currentD1Status="bounded product fix complete / actual Server-wire pass";
receipt.historicalReceiptPolicy="Predecessor fields describe the preserved original zero-paid D1 receipt; currentBlocker/currentD1Status/d1FixAndLimitedRun describe the latest run and paid totals";
receipt.d1FixAndLimitedRun={d1FixSha:execFileSync("git",["rev-parse","cc2804c"],{encoding:"utf8"}).trim(),
  d1Contract:"Only actual clause-boundary reference labels or explicit reported frames strip authority; quantified Research action remains explicit; quoted/reference commands and negation/conflict fail closed. No Server/tool ownership/schema/retry change. submit_memory_update exposure unchanged.",
  zeroPaidWire:{runId:preflight.runId,sourceSha:preflight.sourceSha,build:preflight.build,status:preflight.status,serverTools:preWire.productionBody.tools.map(t=>t.name),productionBodySha256:preWire.productionBodySha256,userGoalUnchanged:true,researchInstructionPreserved:true,providerRequests:0},
  realRun:{runId:verdict.runId,sourceSha:verdict.sourceSha,build:verdict.build,manifestSha256:verdict.manifestSha256,fixtureBundleSha256:verdict.fixtureMetadata.bundleSha256,status:"interrupted / D2 / awaiting web review",hardBlocker:verdict.hardBlocker},
  accounting:reconciliation,
  execution:{agentInteractionsAttempted:1,completeQualityTrials:0,remainingNotRun:15,localRequestPosts:trial.clientRequestPosts,paidProviderRequests:1,journalReservedCallCount:journal.turns[0].provider_call_count,
    originalTextResultPublished:journal.results.length,originalTextResultAcknowledged:journal.results.filter(r=>r.acknowledged_at).length,
    localReadToolCalls:trial.assistantMessages.flatMap(m=>m.taskFulfillment?.effects??[]),researchCandidateCreated:false,authoritativeObjectsAndDecisionsUnchanged:true,reloadObjectsDurable:true,realImageCalls:0,realSearchCalls:0,productionWrites:0,automaticPaidRetry:0,
    continuation:"Step 2 / distinct continuation identity durably prepared and posted to local route, but never sent upstream; not a replay or a duplicate paid execution"},
  observations:{model:response.model,responseId:response.id,responseStatus:response.status,toolCalls:response.output.filter(o=>o.type==="function_call").map(({call_id,name,arguments:args})=>({callId:call_id,name,arguments:args})),
    outputText:response.output.filter(o=>o.type==="message").flatMap(o=>o.content.filter(c=>c.type==="output_text").map(c=>c.text)),uiOutcome:trial.assistantMessages[0].agentTurnOutcome,fulfillment:trial.assistantMessages[0].taskFulfillment.status,interruptedInteractionLatencyMs:trial.latencyMs,firstRequestLocalRoundTripMs:facts.wire.find(r=>r.url.endsWith("/requests")).endedAt-facts.wire.find(r=>r.url.endsWith("/requests")).startedAt},
  slices:manifest.slices.map(s=>({id:s.id,checkpoint:s.checkpoint,dimensions:s.dimensions,trial1:s.id==="L2-1"?"interrupted by Eval D2 after one real request":"not_run",trial2:"not_run",quality:"ungraded / no complete capability verdict",firstAttempt:"not_measured",consistency:"not_measured",userRescue:0})),
  attribution:{primary:"Eval budget reservation/accounting harness; not D1 recurrence",context:"Actual source summary and production read_selected_context receipt delivered; later slices unverified",tool:"D1 grant present; only an authorized read executed",model:"One completed read-call response retained; no complete capability failure inference",adapter:"Original response/tool call reached production client trace and immutable escrow; no observed loss of that result",executor:"Read completed locally; no new object or authoritative mutation; continuation interrupted by guard"},
  validation:{targetedAdjacentFiles:7,targetedAdjacentTests:206,wireGuardTests:7,typecheck:"pass",targetedLint:"pass",cleanBuild:"pass",diffCheck:"pass",originalRawArtifactsVerified:receipt.artifactIndex.length,frozenManifestFixtureRubric:"unchanged",schemaMigrationRetryOwnership:"unchanged"},
  productRepairOfD2:false,baselineComplete:false,programStatus:"validating",laterStages:"P7B-3/P7C/L4 not_started; no main merge",artifactIndex:artifacts};
await writeFile(receiptPath,JSON.stringify(receipt,null,2)+"\n");console.log(JSON.stringify({d1FixSha:receipt.d1FixAndLimitedRun.d1FixSha,preflight:preflight.runId,realRun:verdict.runId,paid:1,usage,costCnyEstimate:cost,newArtifacts:artifacts.length,status:"D2 / stopped"}));
