// Compact durable receipts; full pixels, states and Server bodies stay ignored.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile,writeFile,readdir,stat } from "node:fs/promises";
import { resolve,relative } from "node:path";
import { createHash } from "node:crypto";
const digest=b=>createHash("sha256").update(b).digest("hex"),root=process.cwd();
const runPath=resolve(process.argv[2]),read=async p=>JSON.parse(await readFile(p,"utf8"));
const verdict=await read(resolve(runPath,"verdict.json")),diagnostic=await read(resolve(runPath,"authority-diagnostic.json")),wire=await read(resolve(runPath,"no-paid-server-wire.json"));
const manifest=await read("e2e/eval/p7b-l2-manifest.json"),lock=await read("e2e/eval/p7b-l2-fixture-lock.json");
assert.equal(verdict.fixtureMetadata.bundleSha256,lock.bundleSha256);assert.equal(verdict.ledger.requests,0);assert.equal(wire.networkSent,false);
assert.equal(diagnostic.omittedRequiredTool,"create_research_analysis");
const accepted=await read("docs/operations/p7a-evidence/closeout.json"),frozen={};
for(const [file,expected]of Object.entries(accepted.frozen.files)){const actual=digest((await readFile(file,"utf8")).replaceAll("\r\n","\n"));assert.equal(actual,expected);frozen[file]=actual;}
execFileSync("git",["diff","--exit-code",manifest.base,"--","src","supabase","e2e/eval/contracts.ts","e2e/eval/contract-lock.json","e2e/eval/kitchen-materials.json","e2e/eval/p7b-l1b-contract.json","e2e/support/p7Seed.ts","docs/operations/p7b-1-l1b.md","docs/operations/p7b-1-l1b-evidence.json"]);
const calibrationPath=resolve("output/playwright/p7b-l2/2026-10-04T12-59-28.625Z-22660-preflight");
await writeFile(resolve(calibrationPath,"classification.json"),JSON.stringify({classification:"invalid harness UI calibration, not an executed L2 quality trial or product D1",originalRawVerdictPreserved:true,
  reason:"Eval omitted native Delivery panel opening; first six browser preparation attempts reached intercepted client POST only. Passing labels did not attest required tool validity. Later independent authority audit confirmed first genuine D1 at L2-1.",paidProviderCalls:0},null,2)+"\n");
const artifacts=[];
for(const directory of [calibrationPath,runPath,resolve("output/playwright/p7b-l2/preflight"),resolve("output/playwright/p7b-l2/preflight-repeat")]){
  for(const name of await readdir(directory)){
    const path=resolve(directory,name);if(!(await stat(path)).isFile())continue;const bytes=await readFile(path);
    artifacts.push({path:relative(root,path).replaceAll("\\","/"),bytes:bytes.length,sha256:digest(bytes),retainedInGit:false});
  }
}
const receipt={version:"p7b-l2-evidence-1",branch:"codex/p7b-l2-limited-baseline",base:manifest.base,
  status:"blocked / awaiting web review",programStatus:"validating",predecessors:{p7a:"accepted",p7b1:"ACCEPTED / closed; not re-audited"},laterStages:"P7B-3/P7C/L4 not_started; no main merge",
  preregistration:{sourceSha:"c5225eb2866d4d15cb626444f7fc043c0878da40",manifestSha256:verdict.manifestSha256,fixtureBundleSha256:lock.bundleSha256,manifestPath:"e2e/eval/p7b-l2-manifest.json",fixtureLockPath:"e2e/eval/p7b-l2-fixture-lock.json",frozenBeforePaid:true,originalP7FrozenFiles:frozen},
  runIdentity:{runId:verdict.runId,sourceSha:verdict.sourceSha,build:verdict.build,mode:"Zero-paid actual production Server egress audit; not a real model quality trial",environment:verdict.environment.environment,databaseIdentity:verdict.environment.databaseIdentity},
  provider:manifest.provider,pricing:manifest.pricing,budget:manifest.budget,
  blocker:{...diagnostic,serverBodySha256:wire.productionBodySha256,actualServerInputCaptured:true,networkSent:false,productFix:null},
  actualExecution:{agentQualityInteractions:0,diagnosticAgentInteractions:1,textProviderRequests:0,realImageCalls:0,realSearchCalls:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,estimatedCostCny:0,productionWrites:0,modelOutputs:0,toolExecutions:0,escrowResults:0,acknowledgments:0,
    journalReservedProviderCallCount:1,journalCountMeaning:"Local Journal acquired one request before Eval egress stop; this reservation is not actual upstream execution or billed usage"},
  slices:manifest.slices.map(s=>({id:s.id,checkpoint:s.checkpoint,dimensions:s.dimensions,preregisteredTrials:2,trials:[1,2].map(t=>({trial:t,status:"not_run",qualityVerdict:"ungraded",reason:s.id==="L2-1"&&t===1?"Pre-paid authority gate blocked":"First genuine product blocker; no paid trials begun"})),firstAttempt:"not_measured",twoTrialConsistency:"not_measured",userRescue:0})),
  attribution:{context:"No omission claim beyond captured authority failure; other slices' final input unverified",tool:"Required Research candidate tool omitted",model:"not_called; no capability quality conclusion",adapter:"No original model response to evaluate",executor:"No model-directed tool execution; not evaluated"},
  validation:{wireGuardTests:"7/7 pass, mocked transport only",fixtureRepeat:"Two independent reconstructions byte-identical",actualProductionBoundary:"Isolated real Next/Auth/PostgREST/Journal; final Server input captured and stopped before external fetch",targetedLint:"pass",typecheck:"pass",cleanProductionBuild:"pass",frozenHashes:"unchanged",productSqlPredecessorContent:"unchanged",diffCheck:"pass",fullUnitChromiumL1b:"not rerun; no product changes"},
  limits:["Not a completed L2 baseline or web acceptance","All 16 paid quality trials unexecuted","Delivery UI calibration correction not re-executed after independent D1 stop","No multimodal quality evidence","No independent human/judge grading","No real model/image/hosted/production acceptance","No provider billing ledger assertion"],
  artifactIndex:artifacts};
await writeFile("docs/operations/p7b-2-l2-evidence.json",JSON.stringify(receipt,null,2)+"\n");console.log(JSON.stringify({run:verdict.runId,status:receipt.status,artifacts:artifacts.length,frozenVerified:true}));
