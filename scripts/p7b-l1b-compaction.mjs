// G: native manual compaction, real production route/RPC, original Summary delivery.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { baseUrl, sha256, controlledCompactionSummary, controlledCompactionText } from "./p7b-l1b-runtime.mjs";

async function seedCompaction(name) {
  const vite=await createServer({appType:"custom",configFile:resolve("vitest.config.ts"),server:{middlewareMode:true}});
  try {
    const {createBlankWorkspace,serializeWorkspace}=await vite.ssrLoadModule("/src/domain/morpho/workspace.ts");
    const {applyConversationSummaryRevision,buildConversationCompactionPlan,parseConversationSummaryPayload}=await vite.ssrLoadModule("/src/domain/morpho/conversationCompaction.ts");
    const controlled=parseConversationSummaryPayload(controlledCompactionText);
    if(controlled.status!=="ok")throw Error(`Invalid controlled Summary fixture: ${controlled.reason}`);
    assert.deepEqual(controlled.summary,controlledCompactionSummary);
    const {createCatalog,summarizeProject,CATALOG_STORAGE_KEY,getProjectWorkspaceStorageKey}=await vite.ssrLoadModule("/src/infrastructure/persistence/localProjectStore.ts");
    let workspace=createBlankWorkspace(`p7b-G-${name}`);
    workspace.project.title="L1b original Compaction boundary";
    workspace.ai.messages=Array.from({length:8},(_,i)=>({id:`G-history-${i}`,role:i%2?"assistant":"user",body:`Continuous design discussion ${i}`,
      createdAt:`2026-10-04T00:00:0${i}Z`,...(i%2?{status:"done"}:{})}));
    const applied=applyConversationSummaryRevision(workspace,{sourceMessageIds:["G-history-0","G-history-1"],
      summary:{threadGoal:"Previous valid Summary",establishedContext:[],decisionsAndReasons:[],activeWork:[],unresolvedQuestions:[],referencedObjects:[]},now:"2026-10-04T00:00:10Z"});
    assert.equal(applied.status,"applied");workspace=applied.workspace;
    const plan=buildConversationCompactionPlan({workspace,force:"compact"});assert.ok(plan);
    return {projectId:workspace.project.id,workspaceKey:getProjectWorkspaceStorageKey(workspace.project.id),workspaceValue:serializeWorkspace(workspace),
      catalogKey:CATALOG_STORAGE_KEY,catalogValue:JSON.stringify(createCatalog([summarizeProject(workspace)],workspace.project.id)),
      previousRevisionId:workspace.ai.conversationCompaction.summaryRevisionId,expectedSourceIds:plan.sourceMessages.map(m=>m.id)};
  } finally {await vite.close();}
}

export async function runCompactionScenario({runtime,actor,row,output,setTurn,journal,request}) {
  row.cases=[];row.remainingTrajectories="not_run until original identity/content checks pass";
  for(const name of ["intent-failure","original-summary","source-changed","base-changed"]) {
    const fault=name==="intent-failure",c={name};row.cases.push(c);
    const seed=await seedCompaction(name),start=runtime.stub.calls.length;runtime.stub.next="compaction";
    c.seed={projectId:seed.projectId,sha256:sha256(seed.workspaceValue),previousRevisionId:seed.previousRevisionId,expectedSourceIds:seed.expectedSourceIds};
    const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:900}});
    await context.addCookies(actor.cookie.split("; ").map(p=>{const i=p.indexOf("=");return {name:p.slice(0,i),value:p.slice(i+1),url:baseUrl,sameSite:"Lax"};}));
    const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
    await context.route("**/*",route=>{const u=new URL(route.request().url());return ["127.0.0.1","localhost","[::1]"].includes(u.hostname)||["data:","blob:"].includes(u.protocol)?route.continue():route.abort("blockedbyclient");});
    await page.addInitScript(({seed,fault})=>{
      const prefix="l1b-G-";
      if(!localStorage.getItem(seed.workspaceKey)){localStorage.setItem(seed.catalogKey,seed.catalogValue);localStorage.setItem(seed.workspaceKey,seed.workspaceValue);}
      const push=(key,value)=>{const rows=JSON.parse(sessionStorage.getItem(prefix+key)??"[]");rows.push(value);sessionStorage.setItem(prefix+key,JSON.stringify(rows));};
      const recovery=()=>Object.entries(localStorage).filter(([k])=>k.startsWith("morpho.agent-runtime-a-plus.recovery.v2")).map(([,v])=>JSON.parse(v)).find(r=>r.localProjectId===seed.projectId);
      const blob=async ref=>{
        if(!ref)return null;const db=await new Promise((yes,no)=>{const r=indexedDB.open("morpho-assets-v1");r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});
        try {const b=await new Promise((yes,no)=>{const tx=db.transaction("asset-blobs","readonly"),r=tx.objectStore("asset-blobs").get(ref);let b;
          r.onsuccess=()=>{b=r.result;};tx.oncomplete=()=>yes(b);tx.onabort=()=>no(tx.error);});return b?await b.text():null;}finally{db.close();}
      };
      const nativeSet=Storage.prototype.setItem,nativeRemove=Storage.prototype.removeItem;
      Storage.prototype.setItem=function(key,value){
        if(this===localStorage&&fault&&key.startsWith("morpho.agent-runtime-a-plus.recovery.v2")&&value.includes('"actionKind":"compaction"')){
          sessionStorage.setItem(prefix+"intentFailed","true");throw new DOMException("G test-owned intent persistence failure","QuotaExceededError");
        }
        if(this===localStorage&&!fault&&key===seed.workspaceKey&&!sessionStorage.getItem(prefix+"storageHealthy")&&value.includes("P7B controlled original Summary")){
          sessionStorage.setItem(prefix+"saveFailed","true");throw new DOMException("G test-owned Summary Workspace persistence failure","QuotaExceededError");
        }return nativeSet.call(this,key,value);
      };
      Storage.prototype.removeItem=function(key){if(this===localStorage&&key.startsWith("morpho.agent-runtime-a-plus.recovery.v2")){
        const r=this.getItem(key);if(r&&JSON.parse(r).localProjectId===seed.projectId)push("clears",{record:JSON.parse(r),workspace:JSON.parse(localStorage.getItem(seed.workspaceKey))});
      }return nativeRemove.call(this,key);};
      const native=window.fetch.bind(window);
      window.fetch=async(input,init)=>{
        const url=typeof input==="string"?input:input instanceof URL?input.href:input.url,method=init?.method??"GET";
        if(!url.includes("/api/ai/"))return native(input,init);push("http",{url,method});
        if(method==="POST"&&url.endsWith("/actions/compaction")){
          const record=recovery(),requestBody=await blob(record?.metadata.pendingExternalActionPayload?.ref);
          push("posts",{url,body:String(init.body),record,durableBody:requestBody});
          const response=await native(input,init);const data=await response.clone().json();push("responses",{url,method,status:response.status,data});
          sessionStorage.setItem(prefix+"responseLost","true");throw new TypeError("G test-owned loss after original production compaction response");
        }
        if(method==="GET"&&(url.includes("/actions?")||url.includes("/result"))&&!sessionStorage.getItem(prefix+"deliver")){
          sessionStorage.setItem(prefix+"receiveBlocked","true");return new Promise(()=>{});
        }
        if(method==="POST"&&url.includes("/result")){
          push("acks",{body:JSON.parse(String(init.body)),record:recovery(),workspace:JSON.parse(localStorage.getItem(seed.workspaceKey))});
          if(!sessionStorage.getItem(prefix+"ackAllowed")){sessionStorage.setItem(prefix+"beforeAckCrash","true");return new Promise(()=>{});}
        }
        const response=await native(input,init);push("responses",{url,method,status:response.status});return response;
      };
    },{seed,fault});
    const facts=()=>page.evaluate(key=>({workspace:JSON.parse(localStorage.getItem(key)),posts:JSON.parse(sessionStorage.getItem("l1b-G-posts")??"[]"),
      acks:JSON.parse(sessionStorage.getItem("l1b-G-acks")??"[]"),http:JSON.parse(sessionStorage.getItem("l1b-G-http")??"[]"),
      responses:JSON.parse(sessionStorage.getItem("l1b-G-responses")??"[]"),clears:JSON.parse(sessionStorage.getItem("l1b-G-clears")??"[]"),
      recoveries:Object.entries(localStorage).filter(([k])=>k.startsWith("morpho.agent-runtime-a-plus.recovery.v2")).map(([,v])=>JSON.parse(v))}),seed.workspaceKey);
    const checkpoint=async label=>{c.checkpoint=label;const client=await facts();const turn=client.posts[0]?.record?.serverTurnId??client.recoveries[0]?.serverTurnId;
      if(turn)setTurn(turn);const value={client,journal:await journal(),stub:runtime.stub.calls.slice(start)};
      await writeFile(resolve(output,`G-${name}-${label}.json`),JSON.stringify(value,null,2)+"\n");return value;};
    try {
      await page.goto(`${baseUrl}/projects/${seed.projectId}`);await page.locator(".ai-panel textarea").fill("/compact");await page.locator('[aria-label="发送"]').click();
      if(fault){
        await page.waitForFunction(()=>sessionStorage.getItem("l1b-G-intentFailed")==="true"&&document.querySelector('[aria-label="发送"]'),null,{timeout:30_000});
        const failed=await checkpoint("durability-failed");assert.equal(failed.client.posts.length,0);assert.equal(runtime.stub.calls.length-start,0);
        c.verdict="pass";c.intentFailure={providerPosts:0,compactionPosts:0};continue;
      }
      await page.waitForFunction(()=>sessionStorage.getItem("l1b-G-responseLost")==="true",null,{timeout:30_000});
      const original=await checkpoint("published-before-local-delivery"),proof=original.client.posts[0],body=JSON.parse(proof.body),descriptor=proof.record.metadata.pendingExternalAction;
      assert.equal(original.client.posts.length,1);assert.equal(runtime.stub.calls.length-start,1);assert.equal(proof.durableBody,proof.body);
      assert.equal(descriptor.requestHash,sha256(proof.body));assert.equal(descriptor.actionId,body.actionId);
      assert.equal(body.expectedPreviousRevisionId,seed.previousRevisionId);assert.equal(descriptor.compactionApplyBoundary.expectedPreviousRevisionId,seed.previousRevisionId);
      assert.deepEqual(body.messages.map(m=>m.id),seed.expectedSourceIds);assert.deepEqual(descriptor.compactionApplyBoundary.sourceMessageIds,seed.expectedSourceIds);
      const result=original.journal.results.find(r=>r.binding?.actionId===body.actionId);assert.ok(result?.published_at);assert.equal(result.acknowledged_at,null);
      const effect=original.journal.effects.find(e=>e.effect_id===result.effect_id);assert.equal(effect.execution_state,"succeeded");
      c.identity={serverTurnId:proof.record.serverTurnId,localProjectId:seed.projectId,requestId:body.requestId,stepSequence:body.stepSequence,
        actionId:body.actionId,clientRequestSha256:descriptor.requestHash,actionHash:result.binding.actionHash,effectId:result.effect_id,
        attemptId:effect.latest_attempt_id,providerRequestDigest:effect.request_digest,manifest:result.delivery_manifest,binding:result.binding};
      const resultPath=`/api/ai/effects/${encodeURIComponent(result.effect_id)}/result?kind=compaction`;
      const fetched=await request(resultPath);assert.equal(fetched.status,200);assert.deepEqual(fetched.data.result,result.delivery_manifest);
      const chunks=[];
      for(let i=0;i<fetched.data.result.chunkCount;i++){
        const response=await fetch(`${baseUrl}${resultPath}&resultId=${encodeURIComponent(result.manifest.resultId)}&chunk=${i}`,{headers:{Cookie:actor.cookie}});
        assert.equal(response.status,200);chunks.push(Buffer.from(await response.arrayBuffer()));
      }
      const bytes=Buffer.concat(chunks);assert.equal(sha256(bytes),result.manifest.sha256);assert.equal(bytes.length,result.manifest.byteLength);
      const summary=JSON.parse(bytes);assert.equal(summary.summary.threadGoal,"P7B controlled original Summary");
      assert.equal(summary.sourceBoundary.expectedPreviousRevisionId,seed.previousRevisionId);
      await writeFile(resolve(output,"G-original-summary-result.json"),bytes);
      const replay=await request(new URL(proof.url).pathname,body);assert.equal(replay.status,200);assert.deepEqual(replay.data.result,result.delivery_manifest);
      assert.deepEqual(await journal(),original.journal,"Exact Summary replay cannot mutate execution/result");assert.equal(runtime.stub.calls.length-start,1);
      c.preDelivery={intentDurableBeforePost:true,exactBodyDurable:true,originalSummaryHashVerified:true,exactReplayNoExecution:true};
      if(name==="original-summary") {
        const changed={...body,messages:body.messages.map((m,i)=>i?m:{...m,body:m.body+" changed source content"})};
        const conflict=await request(new URL(proof.url).pathname,changed);
        c.changedSourceReplay={originalBody:body,changedBody:changed,originalSha256:sha256(JSON.stringify(body)),changedSha256:sha256(JSON.stringify(changed)),
          outcome:conflict,journalUnchanged:JSON.stringify(await journal())===JSON.stringify(original.journal),providerExecutions:runtime.stub.calls.length-start};
        await checkpoint("changed-content-replay");
        assert.equal(conflict.status,409,"Same Compaction action identity with changed source/body must conflict even after immutable Summary publication");
        assert.ok(!conflict.data.result,"A conflicting Compaction replay cannot return the original Summary as valid for changed content");
        assert.equal(c.changedSourceReplay.journalUnchanged,true);assert.equal(runtime.stub.calls.length-start,1);
      }

      if(name==="source-changed"||name==="base-changed") {
        // Test-owned persisted Workspace mutation, consumed by the actual reloaded client.
        // Base replacement is constructed by the existing canonical domain apply function.
        let workspace=(await facts()).workspace;
        if(name==="source-changed")workspace.ai.messages.find(m=>m.id===body.messages[0].id).body+=" externally edited source";
        else {
          const vite=await createServer({appType:"custom",configFile:resolve("vitest.config.ts"),server:{middlewareMode:true}});
          try {
            const {applyConversationSummaryRevision}=await vite.ssrLoadModule("/src/domain/morpho/conversationCompaction.ts");
            const changed=applyConversationSummaryRevision(workspace,{summary:{...summary.summary,threadGoal:"Independent replacement base"},
              sourceMessageIds:seed.expectedSourceIds,expectedPreviousRevisionId:seed.previousRevisionId,now:"2026-10-04T00:00:20Z"});
            assert.equal(changed.status,"applied");workspace=changed.workspace;
          } finally {await vite.close();}
        }
        const currentRevision=workspace.ai.conversationCompaction.summaryRevisionId,revisionCount=Object.keys(workspace.ai.conversationSummaryRevisions).length;
        await page.evaluate(({key,value})=>localStorage.setItem(key,value),{key:seed.workspaceKey,value:JSON.stringify(workspace)});
        await page.evaluate(()=>sessionStorage.setItem("l1b-G-deliver","true"));await page.reload();
        await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem("l1b-G-clears")??"[]").length>0||Object.entries(localStorage)
          .filter(([k])=>k.startsWith("morpho.agent-runtime-a-plus.recovery.v2")).some(([,v])=>JSON.parse(v).coordinator.lifecycle.fault.kind==="present"),null,{timeout:30_000});
        const stale=await checkpoint("stale-original-summary-rejected"),record=stale.client.clears.at(-1)?.record??stale.client.recoveries.find(r=>r.serverTurnId===proof.record.serverTurnId);
        assert.equal(record.coordinator.lifecycle.fault.error.code,name==="source-changed"?"compaction_source_changed":"summary_revision_conflict");
        assert.equal(stale.client.workspace.ai.conversationCompaction.summaryRevisionId,currentRevision);
        assert.equal(Object.keys(stale.client.workspace.ai.conversationSummaryRevisions).length,revisionCount);
        assert.equal(stale.client.acks.length,0);assert.equal(runtime.stub.calls.length-start,1);
        assert.equal(stale.journal.effects.find(e=>e.effect_id===result.effect_id).execution_state,"succeeded");
        assert.ok(stale.client.posts.every(p=>p.body===proof.body));
        c.currentness={verdict:"pass",localConflict:record.coordinator.lifecycle.fault.error.code,sourceMutation:name,
          originalExternalSuccessRetained:true,noStaleOverwrite:true,ackPosts:0,providerExecutions:1};c.verdict="pass";continue;
      }

      await page.evaluate(()=>sessionStorage.setItem("l1b-G-deliver","true"));await page.reload();
      await page.waitForFunction(()=>sessionStorage.getItem("l1b-G-saveFailed")==="true",null,{timeout:30_000});
      const failed=await checkpoint("summary-save-failed");assert.equal(failed.client.acks.length,0);
      assert.equal(failed.client.workspace.ai.conversationCompaction.summaryRevisionId,seed.previousRevisionId);
      const recovery=failed.client.recoveries.find(r=>r.serverTurnId===proof.record.serverTurnId);
      assert.equal(recovery.metadata.pendingExternalAction.actionId,body.actionId);assert.equal(recovery.metadata.pendingExternalAction.requestHash,descriptor.requestHash);
      await page.evaluate(()=>sessionStorage.setItem("l1b-G-storageHealthy","true"));await page.reload();
      await page.waitForFunction(()=>sessionStorage.getItem("l1b-G-beforeAckCrash")==="true",null,{timeout:30_000});
      const saved=await checkpoint("summary-durable-before-ack-crash"),revisionId=saved.client.workspace.ai.conversationCompaction.summaryRevisionId;
      assert.notEqual(revisionId,seed.previousRevisionId);assert.equal(Object.keys(saved.client.workspace.ai.conversationSummaryRevisions).length,2);
      assert.deepEqual(saved.client.workspace.ai.conversationSummaryRevisions[revisionId].summary,summary.summary);
      assert.equal(saved.client.acks[0].record.metadata.compaction.summaryApplyState,"applied");
      assert.equal(saved.journal.results.find(r=>r.effect_id===result.effect_id).acknowledged_at,null);
      await page.evaluate(()=>sessionStorage.setItem("l1b-G-ackAllowed","true"));await page.reload();
      await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem("l1b-G-clears")??"[]").length>0,null,{timeout:30_000});
      const final=await checkpoint("recovered-same-revision");
      assert.equal(final.client.workspace.ai.conversationCompaction.summaryRevisionId,revisionId);assert.equal(Object.keys(final.client.workspace.ai.conversationSummaryRevisions).length,2);
      assert.equal(runtime.stub.calls.length-start,1);assert.ok(final.client.posts.every(p=>p.body===proof.body));
      assert.ok(!final.client.http.some(h=>h.url.endsWith("/requests")&&h.method==="POST"));
      assert.ok(final.journal.results.find(r=>r.effect_id===result.effect_id).acknowledged_at);
      const ack={resultId:result.manifest.resultId,version:result.manifest.version,sha256:result.manifest.sha256};
      for(const a of final.client.acks){assert.deepEqual(a.body,ack);assert.equal(a.workspace.ai.conversationCompaction.summaryRevisionId,revisionId);}
      c.durableApplication={saveFailureAckPosts:0,originalActionRetained:true,sameRevisionAfterCrash:true,revisionId,newRevisionCount:1,
        summaryDurableBeforeAck:true,recoveryAppliedBeforeAck:true,exactAck:ack,providerExecutions:1};
      c.verdict="pass";
    } finally {
      c.pageErrors=errors;await checkpoint("final").catch(()=>{});await page.screenshot({path:resolve(output,`G-${name}-final.png`),fullPage:true}).catch(()=>{});
      runtime.stub.next="complete";await browser.close();
    }
  }
  row.remainingTrajectories="complete";
}
