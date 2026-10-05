// Append evidence from the approved budget continuation; never changes raw runs or inputs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile,writeFile,readdir,stat } from "node:fs/promises";
import { resolve,relative } from "node:path";
import { createHash } from "node:crypto";
const sha=b=>createHash("sha256").update(b).digest("hex"),read=async p=>JSON.parse(await readFile(p,"utf8"));
const path=resolve(process.argv[2]),receiptPath="docs/operations/p7b-2-l2-evidence.json";
const receipt=await read(receiptPath),manifest=await read("e2e/eval/p7b-l2-manifest.json"),extension=await read("e2e/eval/p7b-l2-budget-extension.json");
assert.ok(!receipt.budgetExtensionContinuation,"Receipt already appended");
const prior=receipt.actualUsageContinuation,oldIndex=[...receipt.artifactIndex,...receipt.d1FixAndLimitedRun.artifactIndex,...prior.artifactIndex];
for(const a of oldIndex)assert.equal(sha(await readFile(a.path)),a.sha256,`Historical artifact changed: ${a.path}`);
assert.equal(sha(await readFile("e2e/eval/p7b-l2-manifest.json")),extension.originalManifestSha256);
execFileSync("git",["diff","--exit-code","a41f8266621cd08c93aedebc49d29f035701d228","--","src","supabase","e2e/eval/p7b-l2-manifest.json","e2e/eval/p7b-l2-fixture-lock.json","e2e/eval/contracts.ts","e2e/eval/contract-lock.json","e2e/support/p7Seed.ts"]);
const run=await read(resolve(path,"verdict.json")),ledger=await read(resolve(path,"ledger.json")),carry=await read(resolve(path,"carry-forward.json"));
assert.deepEqual(carry.totals,prior.cumulativeTotals);assert.equal(run.fixtureMetadata.bundleSha256,receipt.preregistration.fixtureBundleSha256);
assert.deepEqual(run.budgetExtension,extension);assert.equal(run.hardBlocker.id,"P7B-2-D3");
const rates=manifest.pricing.cnyPerMillion,totals={...carry.totals},wires=[];
const requests=(await readdir(path)).filter(n=>/^wire-\d+-request.json$/.test(n)).sort();
for(const name of requests){
  const q=await read(resolve(path,name)),{max_output_tokens,...original}=q.finalWire;assert.deepEqual(original,q.productionBody);
  assert.ok(max_output_tokens>0&&max_output_tokens<=4096&&max_output_tokens<=extension.cumulativeBudget.outputTokensIncludingReasoning-totals.outputTokens);
  assert.ok(totals.requests<extension.cumulativeBudget.textRequests&&totals.inputTokens<extension.cumulativeBudget.inputTokens&&totals.estimatedCny<extension.cumulativeBudget.costCny);
  totals.requests++;
  const responseName=name.replace("request","response");
  let r;try{r=await read(resolve(path,responseName));}catch(e){if(e.code!=="ENOENT")throw e;}
  if(!r){wires.push({number:q.number,key:q.key,status:"sent / usage unknown",inputTokens:null,outputTokens:null,estimatedCostCny:null,startedAt:q.startedAt});continue;}
  assert.equal(sha(await readFile(resolve(path,responseName.replace(".json",".txt")))),r.rawSha256);
  const u=r.usage,c=u.input_tokens_details?.cached_tokens??0,cost=((u.input_tokens-c)*rates.input+c*rates.cachedInput+u.output_tokens*rates.output)/1e6;
  assert.ok(Math.abs(cost-r.costCnyEstimate)<1e-12);totals.inputTokens+=u.input_tokens;totals.outputTokens+=u.output_tokens;totals.cachedInputTokens+=c;totals.estimatedCny+=cost;
  wires.push({number:r.number,key:r.key,status:"actual usage settled",inputTokens:u.input_tokens,outputTokens:u.output_tokens,cachedInputTokens:c,estimatedCostCny:cost,latencyMs:r.latencyMs,rawSha256:r.rawSha256});
}
for(const k of Object.keys(totals))assert.ok(Math.abs(totals[k]-ledger[k])<1e-9,`Ledger mismatch ${k}`);
assert.equal(requests.length,ledger.runRequests);assert.equal(ledger.requests-ledger.settledRequests,1);
const key="L2-2-trial-2",row=await read(resolve(path,key+"-trial.json")),before=await read(resolve(path,key+"-before.json")),after=await read(resolve(path,key+"-after.json")),reopen=await read(resolve(path,key+"-reopen.json"));
assert.equal(row.contractVerdict,"pass");assert.deepEqual(after.workspace.objects,reopen.objects,"Durable objects mismatch");assert.deepEqual(after.workspace.deliverySectionDrafts,reopen.deliverySectionDrafts);
const citationSources=(workspace,message)=>(message.citationIds??[]).map(id=>{const {title,url,domain,snippet}=workspace.citationSnapshots[id];return{title,url,domain,snippet};});
for(const message of after.workspace.ai.messages){const restored=reopen.ai.messages.find(m=>m.id===message.id);assert.equal(restored.body,message.body);assert.deepEqual(citationSources(after.workspace,message),citationSources(reopen,restored));}
function diffPaths(a,b,p=""){
  if(Object.is(a,b))return[];
  if(a&&b&&typeof a==="object"&&typeof b==="object")return[...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diffPaths(a[k],b[k],p?`${p}.${k}`:k));
  return[p];
}
const reopenDifferences=diffPaths(after.workspace,reopen);
assert.deepEqual(after.workspace.decisionRecords,before.decisionRecords);assert.deepEqual(after.workspace.workingState.activeKeyConclusionIds,[]);
const trialWires=wires.filter(w=>w.key===key);assert.equal(trialWires.length,4);assert.ok(trialWires.every(w=>w.status==="actual usage settled"));
const addedReview={key,status:"completed",quality:"pass",scores:{Evidence:2,"Design judgment":3,"User agency":3},
  grader:"Original p7b-l2-grader-1 / root Agent preliminary evidence review; not independent human acceptance",
  reasons:["Distinguishes the accessible cleaning observation from the inaccessible competitor claim; no summary/full-text conflation or claimed engineering validation.","Specific equal-water/residue joint comparison in unfolded, half-folded and folded states, continuous wipe access and nonfolded baseline; dimensions/load/durability remain unknown.","A saved constraint evidence item is misaligned with its item's claim; usable central source distinction, but citation/item precision still needs editing. Explicit user constraint memory only; Research remains an unpromoted candidate, no authoritative decision/Definition changes."],
  excerpts:["一个相关竞品来源无法访问，另一个结果只是固定观察记录","这是验证门槛，不是已经替项目做出的结构决定"],
  latencyMs:row.latencyMs,requests:trialWires.length,inputTokens:trialWires.reduce((a,w)=>a+w.inputTokens,0),outputTokens:trialWires.reduce((a,w)=>a+w.outputTokens,0),cachedInputTokens:trialWires.reduce((a,w)=>a+w.cachedInputTokens,0),estimatedCostCny:trialWires.reduce((a,w)=>a+w.estimatedCostCny,0),
  userRescue:0,uiOutcome:row.assistantMessages[0].agentTurnOutcome,fulfillment:row.assistantMessages[0].taskFulfillment.status,toolEffects:row.assistantMessages.flatMap(m=>m.taskFulfillment.effects),
  durableReopen:{objectsDrafts:"pass",conversationBodiesAndResolvedCitationSources:"pass",fullWorkspaceEquality:false,differingPaths:reopenDifferences,qualification:"Citation IDs/duplicate citation entries and derived lastReconciledAt differ after reload. Preserve exact raw states; no claim of complete byte equality or diagnosis/fix of another product boundary."},runId:run.runId};
const trials=prior.trials.map(t=>t.key===key?addedReview:t.status==="completed"?{...t,runId:prior.run.runId}:t.key.startsWith("L2-3-")?{key:t.key,status:"infrastructure interrupted / not a valid capability trial",quality:"not_measured",userRescue:0}:t);
const events=(await readFile(resolve(path,"wire-019-response.txt"),"utf8")).split(/\r?\n/).flatMap(l=>{try{return l.startsWith("data: ")?[JSON.parse(l.slice(6))]:[];}catch{return[];}});
const responseIdentities=events.flatMap((e,i)=>e.response?[{eventIndex:i,type:e.type,id:e.response.id,status:e.response.status}]:[]);
const created=responseIdentities.filter(e=>e.type==="response.created");assert.equal(created.length,2);assert.notEqual(created[0].id,created[1].id);
const terminal=responseIdentities.find(e=>e.type==="response.completed");assert.equal(terminal.id,created[1].id);
const failed=await read(resolve(path,"L2-3-trial-1-after.json")),journal=await read(resolve(path,"L2-3-trial-1-journal.json"));
const clientRequest=failed.wire.filter(w=>w.method==="POST"&&w.url.endsWith("/requests")).at(-1),clientIdentity=JSON.parse(clientRequest.body);
assert.ok(clientRequest.response.includes("external_execution_state_unknown"));
const query=failed.wire.filter(w=>w.method==="GET"&&w.url.includes("/turns/")).at(-1),serverState=JSON.parse(query.response);
assert.equal(serverState.externalEffect.responseId,created[0].id);assert.equal(serverState.externalEffect.executionState,"running");
assert.equal(journal.turns[0].bounded_failure_code,"external_execution_state_unknown");
assert.ok(!journal.results.some(r=>r.binding.requestId===clientIdentity.requestId),"Unexpected final escrow for failed continuation");
const blocker={id:"P7B-2-D3",status:"confirmed Provider protocol / adapter compatibility hard blocker; awaiting web review",firstTrial:"L2-3-trial-1",wireNumber:19,
  facts:{responseIdentities,requestId:clientIdentity.requestId,stepSequence:clientIdentity.stepSequence,serverTurnId:serverState.serverTurnId,clientOutcome:"partialSuccess / external_execution_state_unknown",serverEffectResponseId:serverState.externalEffect.responseId,serverEffectExecutionState:serverState.externalEffect.executionState,finalResultPublished:false,rawCompletedUsage:wires.find(w=>w.number===19)},
  attribution:{confirmed:"One upstream POST delivered two response.created identities and completed only the second; native client received unknown rather than the raw final comparison; no same-request retry.",inference:"Stream parser emits each running response identity. Existing RPC rejects a changed attempt responseId with provider_identity_conflict; this matches the frozen first-ID effect and undelivered second-ID completion. No captured RPC error body, so exact thrown RPC cause is a code/evidence inference.",notClaimed:"No proof of internal reseller execution count, billing, upstream retry policy, or a Morpho product defect requiring weaker identity rules."},
  stopGap:{fact:"Runner structure/wire assertions passed despite unknown terminal outcome; next registered trial began before operator hard stop. One further paid request (#20) started after #19 actual usage settlement. No later paid request; #20 has no captured terminal usage and is not a valid capability trial.",unknownUsageRequest:20,automaticRetry:false,policy:"Count the sent request; do not invent zero usage/cost, restart trials, weaken protocol or fix another boundary in this run."},
  rawStopCalibration:"Operator hard-blocker reason was based on an earlier unresolved #19 snapshot. Its preserved ledger already shows #19 settled; current independently reconciled receipt owns classification. #20 remains unsettled. Original hard-blocker/verdict/ledger unchanged."};
const slices=manifest.slices.map(s=>{const pair=trials.filter(t=>t.key.startsWith(s.id+"-trial-")),done=pair.filter(t=>t.status==="completed");return{id:s.id,dimensions:s.dimensions,trial1:pair[0].quality,trial2:pair[1].quality,capability:done.length===2?(done.every(t=>t.quality==="pass")?"pass":done.every(t=>t.quality==="fail")?"fail":"variable"):"not_measured",firstAttempt:pair[0].quality,twoTrialConsistency:done.length===2?(pair[0].quality===pair[1].quality?"2/2 same capability verdict":"1/2 pass; variable"):"not_measured"};});
const review={blocker,totals,settledRequests:ledger.settledRequests,unknownUsageRequests:1,trials,slices};
await writeFile(resolve(path,"budget-extension-review.json"),JSON.stringify(review,null,2)+"\n");
const artifactIndex=[];for(const name of await readdir(path)){
  const artifact=resolve(path,name);if(!(await stat(artifact)).isFile())continue;const bytes=await readFile(artifact);
  artifactIndex.push({path:relative(process.cwd(),artifact).replaceAll("\\","/"),bytes:bytes.length,sha256:sha(bytes),retainedInGit:false});
}
receipt.currentBlocker=blocker;receipt.currentStop="P7B-2-D3 Provider protocol / result-delivery hard boundary / awaiting web review";
receipt.historicalReceiptPolicy="Original D1/D2 and actualUsageContinuation fields/raw runs remain historical; budgetExtensionContinuation owns the latest state. All previously completed capability trials retained without rerun; unknown request usage is not zero.";
receipt.budgetExtensionContinuation={version:"p7b-l2-budget-extension-receipt-1",extension,sourceSha:run.sourceSha,build:run.build,runId:run.runId,manifestSha256:run.manifestSha256,fixtureBundleSha256:run.fixtureMetadata.bundleSha256,
  carryForward:carry,cumulativeTotals:totals,totalsQualification:"Requests count every paid egress; token/cache/cost totals cover 19 settled requests only, with one additional sent request usage/cost unknown. Estimated tariff, not actual billing.",settledRequests:ledger.settledRequests,unknownUsageRequests:1,newPaidRequests:ledger.runRequests,newSettledRequests:wires.filter(w=>w.status==="actual usage settled").length,
  capabilityTrialsCompleted:4,capabilityTrialsInfrastructureInterrupted:2,capabilityTrialsNotRun:10,trials,slices,wires,blocker,
  userRescue:0,realImageCalls:0,realSearchCalls:0,fixedSearchFetches:ledger.searchRequests,productionWrites:0,automaticEvalRetries:0,
  validation:{guardTests:17,targetedLint:"pass",cleanProductionBuild:"pass / executed source 581f168",diffCheck:"pass",historicalArtifactHashesVerified:oldIndex.length,productSqlSchemaRetryFrozenInputs:"unchanged from reviewed a41f826"},
  status:"limited L2 partial / D3 hard stopped / awaiting web review",programStatus:"validating",laterStages:"P7B-3/P7C/L4 not_started; no main merge",artifactIndex};
await writeFile(receiptPath,JSON.stringify(receipt,null,2)+"\n");
console.log(JSON.stringify({runId:run.runId,totals,settled:ledger.settledRequests,unknown:1,slices,historicalHashesVerified:oldIndex.length,newArtifacts:artifactIndex.length,blocker:blocker.id}));
