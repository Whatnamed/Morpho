// Native client cancel, real production routes/RPC, and controlled late observations.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { baseUrl, sha256 } from "./p7b-l1b-runtime.mjs";

async function waitUntil(test, label) {
  for(let i=0;i<300;i++) { if(await test()) return; await new Promise(r=>setTimeout(r,50)); }
  throw Error(`Test-owned scheduling timeout: ${label}`);
}

export async function runCancellationScenario({ runtime, actor, row, output, setTurn, journal, request }) {
  row.cases=[];
  let oldTurn;
  for(const mode of ["running-cancelled","running-late-success"]) {
    const c={name:mode}; row.cases.push(c);
    const start=runtime.stub.calls.length;
    const vite=await createServer({ appType:"custom",configFile:resolve("vitest.config.ts"),server:{middlewareMode:true} });
    let seed;
    try {
      const {createBlankWorkspace,serializeWorkspace}=await vite.ssrLoadModule("/src/domain/morpho/workspace.ts");
      const {createCatalog,summarizeProject,CATALOG_STORAGE_KEY,getProjectWorkspaceStorageKey}=await vite.ssrLoadModule("/src/infrastructure/persistence/localProjectStore.ts");
      const workspace=createBlankWorkspace(`p7b-cancel-${mode}`); workspace.project.title="L1b controlled cancellation";
      seed={projectId:workspace.project.id,workspaceKey:getProjectWorkspaceStorageKey(workspace.project.id),workspaceValue:serializeWorkspace(workspace),
        catalogKey:CATALOG_STORAGE_KEY,catalogValue:JSON.stringify(createCatalog([summarizeProject(workspace)],workspace.project.id))};
    } finally { await vite.close(); }
    c.seed={projectId:seed.projectId,sha256:sha256(seed.workspaceValue)};
    runtime.stub.next=mode;
    const browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    await context.addCookies(actor.cookie.split("; ").map(pair=>{const i=pair.indexOf("=");return {name:pair.slice(0,i),value:pair.slice(i+1),url:baseUrl,sameSite:"Lax"};}));
    const page=await context.newPage(); const errors=[]; page.on("pageerror",e=>errors.push(e.message));
    await context.route("**/*",route=>{const u=new URL(route.request().url());return ["127.0.0.1","localhost","[::1]"].includes(u.hostname)||["data:","blob:"].includes(u.protocol)?route.continue():route.abort("blockedbyclient");});
    await page.addInitScript(seed=>{
      if(!localStorage.getItem(seed.workspaceKey)){localStorage.setItem(seed.catalogKey,seed.catalogValue);localStorage.setItem(seed.workspaceKey,seed.workspaceValue);}
      const prefix="l1b-E-";
      const push=(key,value)=>{const data=JSON.parse(sessionStorage.getItem(prefix+key)??"[]");data.push(value);sessionStorage.setItem(prefix+key,JSON.stringify(data));};
      const recoveries=()=>Object.entries(localStorage).filter(([k])=>k.startsWith("morpho.agent-runtime-a-plus.recovery.v2")).map(([,v])=>JSON.parse(v));
      const nativeRemove=Storage.prototype.removeItem;
      Storage.prototype.removeItem=function(key){
        if(this===localStorage&&key.startsWith("morpho.agent-runtime-a-plus.recovery.v2")){
          const value=this.getItem(key),record=value?JSON.parse(value):null;
          if(record?.localProjectId===seed.projectId) push("clears",{record,durableWorkspace:JSON.parse(localStorage.getItem(seed.workspaceKey))});
        }
        return nativeRemove.call(this,key);
      };
      const native=window.fetch.bind(window);
      window.fetch=async(input,init)=>{
        const url=typeof input==="string"?input:input instanceof URL?input.href:input.url,method=init?.method??"GET";
        if(!url.includes("/api/ai/"))return native(input,init);
        const body=init?.body?JSON.parse(String(init.body)):null;
        push("http",{url,method,body});
        if(method==="POST"&&url.endsWith("/requests"))push("posts",{body,record:recoveries().find(r=>r.localProjectId===seed.projectId)});
        if(method==="POST"&&url.endsWith("/cancel"))push("cancels",{body,record:recoveries().find(r=>r.localProjectId===seed.projectId)});
        if(method==="POST"&&url.includes("/result"))push("acks",{body,durableWorkspace:JSON.parse(localStorage.getItem(seed.workspaceKey)),record:recoveries().find(r=>r.localProjectId===seed.projectId)});
        try {
          const response=await native(input,init);
          const data=response.headers.get("content-type")?.includes("application/json")?await response.clone().json():null;
          push("responses",{url,method,status:response.status,data});return response;
        } catch(error){push("errors",{url,method,name:error.name});throw error;}
      };
    },seed);
    const facts=()=>page.evaluate(key=>({workspace:JSON.parse(localStorage.getItem(key)),
      http:JSON.parse(sessionStorage.getItem("l1b-E-http")??"[]"),posts:JSON.parse(sessionStorage.getItem("l1b-E-posts")??"[]"),
      cancels:JSON.parse(sessionStorage.getItem("l1b-E-cancels")??"[]"),acks:JSON.parse(sessionStorage.getItem("l1b-E-acks")??"[]"),
      responses:JSON.parse(sessionStorage.getItem("l1b-E-responses")??"[]"),clears:JSON.parse(sessionStorage.getItem("l1b-E-clears")??"[]"),
      recoveries:Object.entries(localStorage).filter(([k])=>k.startsWith("morpho.agent-runtime-a-plus.recovery.v2")).map(([,v])=>JSON.parse(v))}),seed.workspaceKey);
    const checkpoint=async label=>{c.checkpoint=label;const client=await facts();if(client.posts[0]?.record?.serverTurnId)setTurn(client.posts[0].record.serverTurnId);
      const value={client,journal:await journal(),stub:runtime.stub.calls.slice(start)};
      await writeFile(resolve(output,`E-${mode}-${label}.json`),JSON.stringify(value,null,2)+"\n");return value;};
    try {
      await page.goto(`${baseUrl}/projects/${seed.projectId}`);
      await page.locator(".ai-panel textarea").fill("请只用简短文字回复，不调用工具。");await page.locator('[aria-label="发送"]').click();
      await waitUntil(async()=>{const client=await facts();if(!client.posts[0]?.record?.serverTurnId)return false;setTurn(client.posts[0].record.serverTurnId);
        return (await journal()).effects.some(e=>e.execution_state==="running"&&e.cancel_requested_at===null);},"Provider observed running");
      const running=await checkpoint("running"),proof=running.client.posts[0],turn=proof.record.serverTurnId;
      const identity={localProjectId:seed.projectId,requestId:proof.body.requestId,stepSequence:proof.body.stepSequence};
      const effectId=`effect:${sha256(JSON.stringify(["a-plus",turn,seed.projectId,"text",identity.requestId,identity.stepSequence]))}`;
      const effect=running.journal.effects.find(e=>e.effect_id===effectId);
      assert.ok(effect);assert.equal(running.client.posts.length,1);assert.equal(runtime.stub.calls.length-start,1);
      c.identity={serverTurnId:turn,...identity,effectId,attemptId:effect.latest_attempt_id,requestDigest:effect.request_digest};
      // Wrong identities exercise real routes before cancelling the exact current request.
      const isolated=await journal();
      for(const [path,body,status] of [
        [`/api/ai/agent/turns/${turn}/requests/cancel`,{...identity,requestId:"wrong-request"},409],
        [`/api/ai/agent/turns/${turn}/requests/cancel`,{...identity,stepSequence:2},409],
        [`/api/ai/agent/turns/${turn}/requests/cancel`,{...identity,localProjectId:"wrong-project"},404],
        [`/api/ai/agent/turns/${oldTurn??randomUUID()}/requests/cancel`,identity,404],
        [`/api/ai/agent/turns/${turn}/requests/cancel`,{...identity,effectId:"wrong-effect"},400]
      ])assert.equal((await request(path,body)).status,status);
      assert.deepEqual(await journal(),isolated,"Wrong cancellation identity cannot mutate current execution");
      c.wrongIdentities="pass / current Journal unchanged";
      if(mode==="running-late-success") {runtime.cancelResponseBarrier.effectId=effectId;runtime.cancelResponseBarrier.persisted=null;}
      await page.locator('[aria-label="停止当前任务"]').click();
      if(mode==="running-late-success") {
        await waitUntil(()=>runtime.cancelResponseBarrier.persisted,"Real cancel intent persisted before delayed response");
        const cancelled=await checkpoint("durable-intent");
        assert.ok(cancelled.journal.effects.find(e=>e.effect_id===effectId).cancel_requested_at);
        assert.equal(cancelled.journal.turn[0].server_execution_status,"provider_running");
        runtime.stub.held.splice(0).forEach(release=>release());
        await waitUntil(async()=>(await journal()).turn[0].server_execution_status==="externally_completed","Original execution completes before process-local abort");
        const published=await checkpoint("late-success-before-cancel-response");
        assert.equal(published.journal.effects.find(e=>e.effect_id===effectId).execution_state,"succeeded");
        assert.ok(published.journal.results.find(r=>r.effect_id===effectId).published_at);
        runtime.cancelResponseBarrier.effectId=null;runtime.cancelResponseBarrier.release();runtime.cancelResponseBarrier.release=null;
      }
      await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem("l1b-E-responses")??"[]").some(r=>r.url.endsWith("/cancel")&&r.status===200),null,{timeout:30_000});
      await waitUntil(async()=>["externally_cancelled","externally_completed"].includes((await journal()).turn[0].server_execution_status),"Journal settles independently of local Abort");
      const cancelled=await checkpoint("cancel-observed");
      const current=cancelled.journal.effects.find(e=>e.effect_id===effectId);
      assert.ok(current.cancel_requested_at);assert.equal(current.latest_attempt_id,effect.latest_attempt_id);
      assert.equal(cancelled.client.cancels.length,1);assert.deepEqual(cancelled.client.cancels[0].body,identity);
      assert.equal(cancelled.client.posts.length,1);assert.equal(runtime.stub.calls.length-start,1);
      if(mode==="running-cancelled") {
        assert.ok(current.local_abort_observed_at);assert.notEqual(current.execution_state,"cancelled","Local Abort cannot prove Provider cancellation");
        await waitUntil(()=>runtime.stub.calls[start].providerOutcome==="cancelled","Controlled Provider confirms its cancellation");
        // Trusted test-owned late observation via actual privileged PostgREST RPC.
        // Text relay lookup is not claimed; no browser observation authority is added.
        const payload={p_actor_user_id:actor.userId,p_effect_id:effectId,p_kind:"text",p_operation:"observe",
          p_payload:{attemptId:effect.latest_attempt_id,observationId:sha256(`E-confirmed-cancel:${effectId}`),observation:{kind:"cancelled",responseId:"resp-p7b-local"}}};
        const response=await fetch(`${runtime.origin}/rest/v1/rpc/operate_external_effect`,{method:"POST",headers:{apikey:runtime.keys.service,Authorization:`Bearer ${runtime.keys.service}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
        c.trustedLateObservation={status:response.status,data:await response.json(),source:"Controlled Provider cancellation receipt / test-owned privileged real RPC observer"};
        assert.equal(c.trustedLateObservation.status,200);assert.equal(c.trustedLateObservation.data.snapshot.executionState,"cancelled");
        const observed=await request(`/api/ai/effects/${effectId}?kind=text`);assert.equal(observed.data.effect.executionState,"cancelled");
      }
      await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem("l1b-E-clears")??"[]").length===1,null,{timeout:30_000});
      const final=await checkpoint("terminal");
      const finalEffect=final.journal.effects.find(e=>e.effect_id===effectId);
      const cleared=final.client.clears[0],assistant=cleared.durableWorkspace.ai.messages.find(m=>m.role==="assistant");
      assert.equal(final.client.posts.length,1);assert.equal(runtime.stub.calls.length-start,1);assert.equal(final.journal.turn[0].provider_call_count,1);
      assert.ok(finalEffect.cancel_requested_at);assert.equal(final.client.recoveries.length,0);
      if(mode==="running-cancelled") {
        assert.equal(finalEffect.execution_state,"cancelled");assert.equal(final.journal.turn[0].server_execution_status,"externally_cancelled");
        assert.equal(assistant.agentTurnOutcome,"cancelledDuringProvider");assert.equal(final.client.acks.length,0);
        assert.equal(final.journal.results.filter(r=>r.effect_id===effectId).length,0);
      } else {
        assert.equal(finalEffect.execution_state,"succeeded");assert.equal(final.journal.turn[0].server_execution_status,"externally_completed");
        assert.notEqual(assistant.agentTurnOutcome,"success","Cancel intent must not be erased by external success");
        const result=final.journal.results.find(r=>r.effect_id===effectId);
        assert.equal(result.binding.requestId,identity.requestId);assert.equal(result.binding.stepSequence,identity.stepSequence);
        assert.equal(final.client.acks.length,1);assert.deepEqual(final.client.acks[0].body,{resultId:result.manifest.resultId,version:result.manifest.version,sha256:result.manifest.sha256});
        c.lateResult={manifest:result.manifest,binding:result.binding,acknowledgedAt:result.acknowledged_at};
      }
      c.terminal={serverStatus:final.journal.turn[0].server_execution_status,effectState:finalEffect.execution_state,
        cancelRequestedAt:finalEffect.cancel_requested_at,localAbortObservedAt:finalEffect.local_abort_observed_at,
        canonicalOutcome:cleared.record.coordinator.lifecycle.outcome,assistantOutcome:assistant.agentTurnOutcome,
        providerExecutions:1,requestPosts:1,ackPosts:final.client.acks.length,recoveryCleared:true};
      c.verdict="pass";oldTurn=turn;
    } finally {
      c.pageErrors=errors;await checkpoint("final").catch(()=>{});
      await page.screenshot({path:resolve(output,`E-${mode}-final.png`),fullPage:true}).catch(()=>{});
      runtime.cancelResponseBarrier.effectId=null;runtime.cancelResponseBarrier.release?.();runtime.cancelResponseBarrier.release=null;
      runtime.stub.held.splice(0).forEach(release=>release());runtime.stub.next="complete";await browser.close();
    }
  }
}
