import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import { startIsolatedBoundary, baseUrl, ports } from "./p7b-l1b-runtime.mjs";
import { readBuildProvenance } from "./build-provenance.mjs";
import { buildL2Fixtures, hash } from "./p7b-l2-fixtures.mjs";
import { writeL2CarryForward } from "./p7b-l2-carry-forward.mjs";
const git=args=>execFileSync("git",args,{encoding:"utf8"}).trim(),root=process.cwd(),boundaryAudit=process.argv.includes("--boundary-audit"),preflight=process.argv.includes("--preflight")||boundaryAudit;
if(git(["status","--porcelain","--untracked-files=no"]))throw Error("Clean tracked source required before L2");
nextEnv.loadEnvConfig(root);const realKey=process.env.MORPHO_AI_API_KEY??process.env.AIJWS_API_KEY;
if(!realKey)throw Error("Missing real Provider credential; no paid request sent");
const manifestBytes=await readFile("e2e/eval/p7b-l2-manifest.json","utf8"),manifest=JSON.parse(manifestBytes);
const extension=process.argv.includes("--resume-budget-extension")?JSON.parse(await readFile("e2e/eval/p7b-l2-budget-extension.json","utf8")):null;
if(extension)assert.equal(hash(manifestBytes),extension.originalManifestSha256);
const runId=new Date().toISOString().replaceAll(":","-")+"-"+process.pid+(preflight?"-preflight":"");
const output=resolve("output/playwright/p7b-l2",runId);await mkdir(output,{recursive:true});
const save=(name,value)=>writeFile(resolve(output,name),JSON.stringify(value,null,2)+"\n");
async function selectObject(page,seed,id,additive){
  const instance=JSON.parse(seed.workspaceValue).canvas.instances.find(i=>i.objectId===id);assert.ok(instance,`Missing instance ${id}`);
  const selector=`.tl-shape[data-shape-id="shape:${instance.id}"]`;await page.locator(selector).waitFor({state:"visible"});
  const point=await page.evaluate(selector=>{
    const node=document.querySelector(selector),box=node.getBoundingClientRect();
    const blocked=[...document.querySelectorAll(".tl-shape:has(.morpho-shape-host), .ai-panel, .floating-cluster, .left-rail, .selection-toolbar, .workspace-banner, .detail-popover, [data-workspace-surface]")].filter(n=>n!==node).map(n=>n.getBoundingClientRect());
    for(let y=Math.max(box.top+10,10);y<Math.min(box.bottom-10,innerHeight-10);y+=8)for(let x=Math.max(box.left+10,10);x<Math.min(box.right-10,innerWidth-10);x+=8)if(blocked.every(b=>x<b.left||x>b.right||y<b.top||y>b.bottom))return{x,y};throw Error("No exposed card "+selector);
  },selector);
  if(additive)await page.keyboard.down("Shift");await page.mouse.click(point.x,point.y);if(additive)await page.keyboard.up("Shift");
}
const run={version:"p7b-l2-run-1",runId,sourceSha:git(["rev-parse","HEAD"]),manifestSha256:hash(manifestBytes),manifest,budgetExtension:extension,mode:preflight?"no-paid harness preflight":"real limited L2",trials:[],status:"invalid_run",hardBlocker:null,realImageCalls:0,productionWrites:0};
let runtime,server,browser;
try{
  run.carryForward=await writeL2CarryForward(output,manifest,extension);
  run.fixtureMetadata=await buildL2Fixtures(output);
  const lock=JSON.parse(await readFile("e2e/eval/p7b-l2-fixture-lock.json","utf8"));assert.equal(run.fixtureMetadata.bundleSha256,lock.bundleSha256,"Frozen fixture mismatch");
  const seeds=JSON.parse(await readFile(resolve(output,"fixtures.json"),"utf8"));
  runtime=await startIsolatedBoundary("temp/p7b-l1b-tools",output);run.environment=runtime.facts;
  const build=runtime.launch(process.execPath,[resolve("scripts/build-production.mjs"),"--strict"],runtime.appEnv,root);
  const exit=await new Promise(r=>build.once("exit",r));await writeFile(resolve(output,"build.log"),build.safeLog);if(exit!==0)throw Error("Clean production build failed");
  run.build=await readBuildProvenance();assert.equal(run.build.sourceSha,run.sourceSha);assert.equal(run.build.isDirty,false);
  const trialOrder=manifest.slices.flatMap(s=>[1,2].map(trial=>({slice:s.id,trial})));
  await save("run-manifest.json",{...run,trialOrder,activeTrialOrder:trialOrder.filter(t=>!extension?.completedTrialKeys.includes(`${t.slice}-trial-${t.trial}`)),completedPredecessors:extension?.completedTrialKeys??[],frozenAt:new Date().toISOString()});
  server=runtime.launch(process.execPath,[resolve("node_modules/next/dist/bin/next"),"start","-p",String(ports.app),"-H","127.0.0.1"],{
    ...runtime.appEnv,MORPHO_AI_BASE_URL:"https://api.aijws.com/v1",MORPHO_AI_API_KEY:realKey,MORPHO_AI_MODEL:manifest.provider.model,MORPHO_AI_REASONING_EFFORT:manifest.provider.reasoning,MORPHO_AI_WEB_SEARCH_ENABLED:"true",
    MORPHO_AI_SUPPORTS_PROMPT_CACHE_KEY:"false",MORPHO_AI_SUPPORTS_PROMPT_CACHE_RETENTION:"false",MORPHO_AI_PROMPT_CACHE_KEY_ENABLED:"false",MORPHO_L2_NO_PAID:preflight?"true":"false",
    NODE_OPTIONS:`--require ${resolve("scripts/p7b-l2-wire-guard.cjs")}`,MORPHO_L2_MANIFEST:resolve("e2e/eval/p7b-l2-manifest.json"),MORPHO_L2_OUTPUT:output,MORPHO_L2_CARRY_FORWARD:resolve(output,"carry-forward.json"),
    ...(extension?{MORPHO_L2_BUDGET_EXTENSION:resolve("e2e/eval/p7b-l2-budget-extension.json")}:{}),
    MORPHO_BUILD_SOURCE_SHA:run.sourceSha,MORPHO_BUILD_ID:run.build.buildId,MORPHO_BUILD_SOURCE_TREE_SHA256:run.build.sourceTreeSha256,MORPHO_BUILD_ARTIFACT_SHA256:run.build.artifactSha256,MORPHO_BUILD_IS_DIRTY:"false"
  },root);await runtime.wait(`${baseUrl}/login`,server);
  let cookies=[];const auth=createServerClient(runtime.origin,runtime.keys.anon,{cookies:{getAll:()=>cookies,setAll:u=>{cookies=u;}}});
  const signed=await auth.auth.signUp({email:`l2-${randomUUID()}@example.test`,password:randomUUID()+"Aa1!"});if(signed.error||!signed.data.session)throw Error("Isolated Auth unavailable");
  const userId=signed.data.user.id;await runtime.db.query("update public.app_user_access set status='active' where user_id=$1",[userId]);
  browser=await chromium.launch({headless:true});
  for(const slice of (boundaryAudit?manifest.slices.slice(0,1):manifest.slices))for(const trial of (preflight?[1]:[1,2])){
    const key=`${slice.id}-trial-${trial}`;
    if(extension?.completedTrialKeys.includes(key)&&!boundaryAudit)continue;
    const seed=seeds.find(s=>s.sliceId===slice.id),row={key,slice:slice.id,trial,status:"running",userRescue:0};run.trials.push(row);await save("active-trial.json",{key,slice:slice.id,trial});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies(cookies.map(c=>({...c,url:baseUrl,sameSite:"Lax"})));
    const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
    await context.route("**/*",route=>{const u=new URL(route.request().url());return ["127.0.0.1","localhost","[::1]"].includes(u.hostname)||["data:","blob:"].includes(u.protocol)?route.continue():route.abort("blockedbyclient");});
    if(preflight&&!boundaryAudit){await context.route("**/api/ai/agent/turns/*/requests",r=>r.abort("blockedbyclient"));await context.route("**/api/ai/agent/turns/*/actions/compaction",r=>r.abort("blockedbyclient"));}
    await page.addInitScript(async seed=>{
      if(!localStorage.getItem(seed.workspaceKey)){localStorage.setItem(seed.catalogKey,seed.catalogValue);localStorage.setItem(seed.workspaceKey,seed.workspaceValue);}
      window.__l2Ready=false;window.__l2Wire=[];
      if(seed.assets.length){
        const db=await new Promise((yes,no)=>{const r=indexedDB.open("morpho-assets-v1",1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("asset-blobs"))r.result.createObjectStore("asset-blobs");};r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});
        for(const a of seed.assets){const b=await(await fetch(a.publicPath)).blob();const h=[...new Uint8Array(await crypto.subtle.digest("SHA-256",await b.arrayBuffer()))].map(v=>v.toString(16).padStart(2,"0")).join("");if(h!==a.contentHash)throw Error("Reference pixel hash mismatch");await new Promise((yes,no)=>{const tx=db.transaction("asset-blobs","readwrite");tx.objectStore("asset-blobs").put(b,a.runtimeStorageKey);tx.oncomplete=yes;tx.onabort=()=>no(tx.error);});}db.close();
      }
      const native=window.fetch.bind(window);window.fetch=async(input,init)=>{
        const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;if(!url.includes("/api/ai/"))return native(input,init);
        const r={url,method:init?.method??"GET",body:init?.body?String(init.body):null,startedAt:Date.now()};window.__l2Wire.push(r);
        const response=await native(input,init);r.status=response.status;r.capture=response.clone().text().then(t=>{r.response=t;r.endedAt=Date.now();});return response;
      };window.__l2Ready=true;
    },seed);
    try{
      await page.goto(`${baseUrl}/projects/${seed.projectId}`);await page.waitForFunction(()=>window.__l2Ready===true,null,{timeout:45_000});
      const notice=page.locator(".workspace-banner").getByRole("button",{name:"知道了",exact:true});if(await notice.isVisible())await notice.click();
      for(const [i,id]of seed.selectedIds.entries())await selectObject(page,seed,id,i>0);
      const before=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),seed.workspaceKey);await save(`${key}-before.json`,before);
      if(slice.fixture==="delivery"){
        await page.getByRole("button",{name:"交付准备",exact:true}).click();
        const panel=page.locator('[aria-label="交付准备"]'),delivery=Object.values(before.objects).find(o=>o.type==="delivery");
        await panel.locator(".delivery-package-row").filter({hasText:delivery.title}).click();
        await panel.locator(".delivery-section-tab").filter({hasText:delivery.sections[0].title}).click();
        await panel.getByRole("button",{name:"生成本节说明草稿",exact:true}).click();
      }else await page.locator(".ai-panel textarea").fill(slice.prompt);
      row.actualUserPrompt=await page.locator(".ai-panel textarea").inputValue();row.startedAt=new Date().toISOString();await page.locator('[aria-label="发送"]').click();
      if(preflight)await page.waitForFunction(audit=>window.__l2Wire.some(r=>(r.url.endsWith("/requests")||r.url.endsWith("/actions/compaction"))&&(!audit||r.status)),boundaryAudit,{timeout:30_000});
      else await page.waitForFunction(({key,ids})=>{const ws=JSON.parse(localStorage.getItem(key));return ws.ai.messages.some(m=>m.role==="assistant"&&!ids.includes(m.id)&&m.agentTurnOutcome)&&!document.querySelector('[aria-label="停止当前任务"]');},{key:seed.workspaceKey,ids:before.ai.messages.map(m=>m.id)},{timeout:300_000});
      await page.evaluate(async()=>{await Promise.all(window.__l2Wire.map(r=>r.capture).filter(Boolean));});
      const facts=await page.evaluate(k=>({workspace:JSON.parse(localStorage.getItem(k)),wire:window.__l2Wire.map(({capture,...r})=>r),recoveries:Object.entries(localStorage).filter(([key])=>key.startsWith("morpho.agent-runtime-a-plus.recovery.v2")).map(([,v])=>JSON.parse(v)),ackOutbox:Object.entries(localStorage).filter(([key])=>key.startsWith("morpho.result-ack.v1.")).map(([key,value])=>({key,value}))}),seed.workspaceKey);
      await save(`${key}-after.json`,facts);row.assistantMessages=facts.workspace.ai.messages.filter(m=>m.role==="assistant"&&!before.ai.messages.some(b=>b.id===m.id));row.latencyMs=Date.now()-Date.parse(row.startedAt);row.clientRequestPosts=facts.wire.filter(r=>r.method==="POST"&&r.url.endsWith("/requests")).length;
      const turns=(await runtime.db.query("select server_turn_id,local_project_id,server_execution_status,latest_request_id,latest_step_sequence,provider_call_count,bounded_failure_code from private.agent_turn_journal where local_project_id=$1",[seed.projectId])).rows;
      const requests=(await runtime.db.query("select server_turn_id,request_id,step_sequence,request_hash from private.agent_turn_request_journal where server_turn_id=any($1::uuid[])",[turns.map(t=>t.server_turn_id)])).rows;
      const results=(await runtime.db.query("select effect_id,manifest,binding,published_at,acknowledged_at from public.external_result where actor_user_id=$1",[userId])).rows;await save(`${key}-journal.json`,{turns,requests,results});
      if(!preflight){
        assert.deepEqual(facts.workspace.assets,before.assets,"Unexpected Image/asset mutation");
        const stable=o=>{const v=structuredClone(o);if(v.type==="image"&&v.generation)delete v.generation.observations;return v;};
        for(const [id,o]of Object.entries(before.objects))if(o.type!=="delivery")assert.deepEqual(stable(facts.workspace.objects[id]),stable(o),`Unauthorized object mutation ${id}`);
        assert.equal(facts.workspace.workingState.primaryDirectionId,before.workingState.primaryDirectionId,"Unauthorized primary change");assert.equal(facts.workspace.workingState.currentDesignDefinitionId,before.workingState.currentDesignDefinitionId,"Unauthorized Definition change");
        await page.reload();await page.waitForFunction(()=>window.__l2Ready,null,{timeout:45_000});const reopened=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),seed.workspaceKey);await save(`${key}-reopen.json`,reopened);assert.deepEqual(reopened.objects,facts.workspace.objects,"Durable object reopen mismatch");assert.deepEqual(reopened.deliverySectionDrafts,facts.workspace.deliverySectionDrafts,"Draft persistence mismatch");
        const wires=[];for(const f of(await readdir(output)).filter(n=>/^wire-\d+-request.json$/.test(n))){const w=JSON.parse(await readFile(resolve(output,f),"utf8"));if(w.key===key)wires.push(w);}assert.ok(wires.length,"Missing final server input");
        if(slice.id==="L2-8")assert.ok(wires.some(w=>JSON.stringify(w.finalWire.input).includes("data:image/")),"Required real reference pixels omitted");
        for(const w of wires){const {max_output_tokens,...original}=w.finalWire;assert.deepEqual(original,w.productionBody,"Unexpected final wire mutation");assert.ok(max_output_tokens<=4096);}
        const posts=facts.wire.filter(r=>r.method==="POST"&&r.url.endsWith("/requests"));
        for(const [i,w]of wires.filter(w=>w.productionBody.tools?.length).entries()){
          const contract=JSON.parse(posts[i].body).providerRequest.taskContract;
          assert.ok(contract,"Missing turn-local authority contract");
          const names=["read_selected_context","read_project_memory","read_stage_record","search_project_conversation",...(contract.readContractVersion===1?["read_workspace_source"]:[]),
            ...contract.activities.flatMap(a=>a.scopeBlockedReason?[]:a.effectGrants.map(g=>g.tool))];
          assert.deepEqual([...new Set(w.finalWire.tools.map(t=>t.name))].sort(),[...new Set(names)].sort(),"Final server tool exposure differs from frozen authority");
        }
        row.serverWireRequests=wires.map(w=>w.number);row.contractVerdict="pass";
      }
      row.status=preflight?"preflight_pass":"executed / quality grading pending";await page.screenshot({path:resolve(output,`${key}.png`),fullPage:true});
      if(boundaryAudit){
        const captured=JSON.parse(await readFile(resolve(output,"no-paid-server-wire.json"),"utf8"));
        assert.equal(captured.networkSent,false);assert.equal(captured.productionBody.model,manifest.provider.model);
        assert.equal(captured.productionBody.reasoning?.effort,manifest.provider.reasoning);
        assert.ok(captured.productionBody.tools.some(t=>t.name==="create_research_analysis"),"D1 required Research tool still missing");
        const canonical=captured.productionBody.input.flatMap(i=>i.content??[]).find(c=>c.type==="input_text"&&c.text.startsWith("<morpho_turn_task_contract>"));
        const contract=JSON.parse(canonical.text.split("\n")[2]);assert.equal(contract.userGoal,slice.prompt);
        assert.ok(contract.activities.some(a=>a.kind==="research"&&a.instruction.includes("资料创建一张研究分析卡")),"D1 instruction incorrectly stripped");
        row.serverWireVerdict="pass / D1 restored / zero paid";
      }
    }catch(error){row.status="hard_blocker";row.error=error.message;run.hardBlocker={id:"P7B-2-D3",trial:key,reason:error.message};throw error;}
    finally{row.pageErrors=errors;await save(`${key}-trial.json`,row);await save("progress.json",run);await context.close();}
    try{run.hardBlocker=JSON.parse(await readFile(resolve(output,"hard-blocker.json"),"utf8"));throw Error(run.hardBlocker.reason);}catch(e){if(e.code!=="ENOENT")throw e;}
  }
  run.status=preflight?"preflight_complete / zero paid":"limited L2 execution complete / quality grading pending";
}catch(error){run.status="hard_blocker / stopped";run.hardBlocker??={id:"P7B-2-D3",reason:error.message};}
finally{
  if(browser)await browser.close();if(server)await writeFile(resolve(output,"server.log"),server.safeLog.replaceAll(realKey,"[redacted]"));if(runtime)await runtime.stop();
  try{run.ledger=JSON.parse(await readFile(resolve(output,"ledger.json"),"utf8"));}catch{run.ledger={requests:0,inputTokens:0,outputTokens:0,estimatedCny:0};}
  await save("verdict.json",run);console.log(JSON.stringify({output,sourceSha:run.sourceSha,status:run.status,trials:run.trials.length,ledger:run.ledger,hardBlocker:run.hardBlocker}));
}process.exitCode=run.hardBlocker?1:0;
