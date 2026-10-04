// F: actual client delivery plus real privileged result RPC/route invariants.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { baseUrl, sha256 } from "./p7b-l1b-runtime.mjs";

export async function runResultScenario({ runtime, actors, row, output, setTurn, journal, request }) {
  const actor=actors[0], start=runtime.stub.calls.length;
  row.steps=[];row.rpc=[];
  const rpc=async(name,effectId,operation,payload={})=>{
    const response=await fetch(`${runtime.origin}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:runtime.keys.service,
      Authorization:`Bearer ${runtime.keys.service}`,"Content-Type":"application/json"},
      body:JSON.stringify({p_actor_user_id:actor.userId,p_effect_id:effectId,p_kind:"text",p_operation:operation,p_payload:payload})});
    const data=await response.json();row.rpc.push({name,effectId,operation,payloadSha256:sha256(JSON.stringify(payload)),status:response.status,data});
    assert.equal(response.status,200,"Real result RPC must respond with its bounded contract");return data;
  };
  const vite=await createServer({appType:"custom",configFile:resolve("vitest.config.ts"),server:{middlewareMode:true}});
  let seed;
  try {
    const {createBlankWorkspace,serializeWorkspace}=await vite.ssrLoadModule("/src/domain/morpho/workspace.ts");
    const {createCatalog,summarizeProject,CATALOG_STORAGE_KEY,getProjectWorkspaceStorageKey}=await vite.ssrLoadModule("/src/infrastructure/persistence/localProjectStore.ts");
    const workspace=createBlankWorkspace("p7b-F-result-delivery");workspace.project.title="L1b immutable result delivery";
    seed={projectId:workspace.project.id,workspaceKey:getProjectWorkspaceStorageKey(workspace.project.id),workspaceValue:serializeWorkspace(workspace),
      catalogKey:CATALOG_STORAGE_KEY,catalogValue:JSON.stringify(createCatalog([summarizeProject(workspace)],workspace.project.id))};
  } finally {await vite.close();}
  row.seed={projectId:seed.projectId,sha256:sha256(seed.workspaceValue)};
  const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addCookies(actor.cookie.split("; ").map(p=>{const i=p.indexOf("=");return {name:p.slice(0,i),value:p.slice(i+1),url:baseUrl,sameSite:"Lax"};}));
  const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await context.route("**/*",route=>{const u=new URL(route.request().url());return ["127.0.0.1","localhost","[::1]"].includes(u.hostname)||["data:","blob:"].includes(u.protocol)?route.continue():route.abort("blockedbyclient");});
  await page.addInitScript(seed=>{
    const prefix="l1b-F-";
    if(!localStorage.getItem(seed.workspaceKey)){localStorage.setItem(seed.catalogKey,seed.catalogValue);localStorage.setItem(seed.workspaceKey,seed.workspaceValue);}
    const push=(name,value)=>{const rows=JSON.parse(sessionStorage.getItem(prefix+name)??"[]");rows.push(value);sessionStorage.setItem(prefix+name,JSON.stringify(rows));};
    const recovery=()=>Object.entries(localStorage).filter(([k])=>k.startsWith("morpho.agent-runtime-a-plus.recovery.v2")).map(([,v])=>JSON.parse(v)).find(r=>r.localProjectId===seed.projectId);
    const blob=async ref=>{
      if(!ref)return null;
      const db=await new Promise((yes,no)=>{const r=indexedDB.open("morpho-assets-v1");r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});
      try {const b=await new Promise((yes,no)=>{const tx=db.transaction("asset-blobs","readonly"),r=tx.objectStore("asset-blobs").get(ref);let b;
        r.onsuccess=()=>{b=r.result;};tx.oncomplete=()=>yes(b);tx.onabort=()=>no(tx.error);});return b?await b.text():null;}finally{db.close();}
    };
    const nativeSet=Storage.prototype.setItem,nativeRemove=Storage.prototype.removeItem;
    Storage.prototype.setItem=function(key,value){
      if(this===localStorage&&key===seed.workspaceKey&&!sessionStorage.getItem(prefix+"storageHealthy")&&
        value.includes('"agentTurnOutcome":"success"')&&value.includes("P7B controlled result")){
        sessionStorage.setItem(prefix+"saveFailed","true");throw new DOMException("F test-owned final Workspace save failure","QuotaExceededError");
      }return nativeSet.call(this,key,value);
    };
    Storage.prototype.removeItem=function(key){if(this===localStorage&&key.startsWith("morpho.agent-runtime-a-plus.recovery.v2")){
      const r=this.getItem(key);if(r&&JSON.parse(r).localProjectId===seed.projectId)push("clears",{record:JSON.parse(r),workspace:JSON.parse(localStorage.getItem(seed.workspaceKey))});
    }return nativeRemove.call(this,key);};
    const native=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const url=typeof input==="string"?input:input instanceof URL?input.href:input.url,method=init?.method??"GET";
      if(!url.includes("/api/ai/"))return native(input,init);
      push("http",{url,method});
      if(url.endsWith("/requests")&&method==="POST"){
        push("requests",{body:JSON.parse(String(init.body)),record:recovery()});
        const response=await native(input,init);await response.text();sessionStorage.setItem(prefix+"responseLost","true");
        throw new TypeError("F test-owned loss of original route response");
      }
      if(method==="GET"&&url.includes("/result")&&!sessionStorage.getItem(prefix+"deliver")){
        sessionStorage.setItem(prefix+"receiveBlocked","true");return new Promise(()=>{});
      }
      if(method==="POST"&&url.includes("/result")){
        const record=recovery(),ref=record?.coordinator.latestProviderOutputPayload;
        push("acks",{body:JSON.parse(String(init.body)),record,workspace:JSON.parse(localStorage.getItem(seed.workspaceKey)),
          envelope:await blob(ref?.ref),reference:ref});
        const response=await native(input,init);const data=await response.clone().json();push("responses",{url,method,status:response.status,data});
        if(!sessionStorage.getItem(prefix+"ackResponseLost")){sessionStorage.setItem(prefix+"ackResponseLost","true");throw new TypeError("F loss after durable real ACK");}
        return response;
      }
      const response=await native(input,init);push("responses",{url,method,status:response.status});return response;
    };
  },seed);
  const facts=()=>page.evaluate(key=>({workspace:JSON.parse(localStorage.getItem(key)),
    requests:JSON.parse(sessionStorage.getItem("l1b-F-requests")??"[]"),acks:JSON.parse(sessionStorage.getItem("l1b-F-acks")??"[]"),
    http:JSON.parse(sessionStorage.getItem("l1b-F-http")??"[]"),responses:JSON.parse(sessionStorage.getItem("l1b-F-responses")??"[]"),
    clears:JSON.parse(sessionStorage.getItem("l1b-F-clears")??"[]"),saveFailed:sessionStorage.getItem("l1b-F-saveFailed"),
    recoveries:Object.entries(localStorage).filter(([k])=>k.startsWith("morpho.agent-runtime-a-plus.recovery.v2")).map(([,v])=>JSON.parse(v))}),seed.workspaceKey);
  const checkpoint=async name=>{row.checkpoint=name;const value={client:await facts(),journal:await journal(),stub:runtime.stub.calls.slice(start)};
    await writeFile(resolve(output,`F-${name}.json`),JSON.stringify(value,null,2)+"\n");return value;};
  try {
    await page.goto(`${baseUrl}/projects/${seed.projectId}`);await page.locator(".ai-panel textarea").fill("请只用简短文字回复，不调用工具。");await page.locator('[aria-label="发送"]').click();
    await page.waitForFunction(()=>sessionStorage.getItem("l1b-F-receiveBlocked")==="true",null,{timeout:30_000});
    const initialClient=await facts();setTurn(initialClient.requests[0].record.serverTurnId);
    const before=await checkpoint("original-published-before-delivery"),proof=before.client.requests[0],identity={serverTurnId:proof.record.serverTurnId,
      localProjectId:seed.projectId,requestId:proof.body.requestId,stepSequence:proof.body.stepSequence};
    const original=before.journal.results.find(r=>r.binding?.serverTurnId===identity.serverTurnId);
    assert.ok(original?.published_at);assert.equal(original.acknowledged_at,null);assert.equal(before.client.acks.length,0);
    for(const [k,v]of Object.entries(identity))assert.equal(original.binding[k],v);
    const manifest=original.delivery_manifest, effectId=original.effect_id;
    const path=`/api/ai/effects/${encodeURIComponent(effectId)}/result?kind=text`;
    const ack={resultId:manifest.resultId,version:manifest.version,sha256:manifest.sha256};
    row.identity={...identity,effectId,manifest,binding:original.binding};
    const download=async m=>{
      const chunks=[];
      for(let i=0;i<m.chunkCount;i++){
        const response=await fetch(`${baseUrl}/api/ai/effects/${encodeURIComponent(m.effectId)}/result?kind=text&resultId=${encodeURIComponent(m.resultId)}&chunk=${i}`,{headers:{Cookie:actor.cookie}});
        const bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);
        chunks.push(bytes);row.steps.push({name:"chunk",resultId:m.resultId,index:i,status:response.status,byteLength:bytes.length,sha256:sha256(bytes)});
      }
      const bytes=Buffer.concat(chunks);assert.equal(bytes.length,m.byteLength);assert.equal(sha256(bytes),m.sha256);return bytes;
    };
    const got=await request(path);assert.equal(got.status,200);assert.deepEqual(got.data.result,manifest);
    const bytes=await download(manifest);await writeFile(resolve(output,"F-original-envelope.json"),bytes);
    assert.equal(JSON.parse(bytes).outputText,"P7B controlled result");assert.equal(manifest.chunkCount,Math.ceil(bytes.length/524288));
    assert.deepEqual((await request(path)).data.result,manifest);assert.deepEqual(await download(manifest),bytes);
    const changed=Buffer.from(bytes);changed[changed.length-1]^=1;
    assert.equal((await rpc("operate_external_result",effectId,"write",{resultId:manifest.resultId,index:0,base64:changed.toString("base64")})).error,"result_chunk_conflict");
    const conflicting={...original.manifest,sha256:sha256(changed),resultId:`result:${sha256(JSON.stringify([actor.userId,effectId,1,sha256(changed)]))}`};
    assert.equal((await rpc("operate_external_result",effectId,"prepare",{manifest:conflicting,binding:original.binding})).error,"result_identity_conflict");
    for(const field of ["localProjectId","requestId"]){
      assert.equal((await rpc("operate_external_result",effectId,"prepare",{manifest:original.manifest,binding:{...original.binding,[field]:"wrong-binding"}})).error,"result_identity_conflict");
    }
    const stable=await journal();assert.deepEqual(stable,before.journal,"Conflicting published bytes/binding cannot mutate original result or execution");
    for(const [body,status] of [[{...ack,resultId:`result:${"1".repeat(64)}`},409],[{...ack,version:2},400],[{...ack,sha256:"2".repeat(64)},409],
      [{...ack,localProjectId:"wrong-project"},400],[{...ack,requestId:"wrong-request"},400]]){
      assert.equal((await request(path,body)).status,status);assert.deepEqual(await journal(),stable);
    }
    assert.equal((await request(path,ack,actors[1])).status,503);assert.deepEqual(await journal(),stable);
    row.steps.push({name:"F1-F2-F5-F8",verdict:"pass",immutablePublication:true,originalBytesHash:sha256(bytes),wrongAckUnacknowledged:true});

    // Independent service-owned staging fixture: real RPC, no Provider grant or execution.
    const stagedEffect=`effect:${sha256(`F-staged:${randomUUID()}`)}`;
    const cancelled=await rpc("operate_external_effect",stagedEffect,"cancel");assert.equal(cancelled.executionGranted,false);
    const stagedBytes=Buffer.from(JSON.stringify({fixture:"F multi-chunk staged result",body:"x".repeat(524300)}));
    const stagedManifest={effectId:stagedEffect,resultId:`result:${sha256(JSON.stringify([actor.userId,stagedEffect,1,sha256(stagedBytes)]))}`,
      version:1,kind:"text",sha256:sha256(stagedBytes),byteLength:stagedBytes.length,chunkCount:Math.ceil(stagedBytes.length/524288),mimeType:"application/json"};
    const stagedPath=`/api/ai/effects/${encodeURIComponent(stagedEffect)}/result?kind=text`;
    assert.equal((await rpc("operate_external_result",stagedEffect,"prepare",{manifest:stagedManifest,binding:null})).state,"unavailable");
    await rpc("operate_external_result",stagedEffect,"write",{resultId:stagedManifest.resultId,index:0,base64:stagedBytes.subarray(0,524288).toString("base64")});
    assert.equal((await rpc("operate_external_result",stagedEffect,"publish",{resultId:stagedManifest.resultId})).error,"result_incomplete");
    assert.equal((await request(stagedPath)).status,503);
    assert.equal((await request(stagedPath,{resultId:stagedManifest.resultId,version:1,sha256:stagedManifest.sha256})).status,409);
    assert.equal((await request(stagedPath,ack)).status,409,"Wrong effect/result binding must reject ACK");
    await rpc("operate_external_result",stagedEffect,"write",{resultId:stagedManifest.resultId,index:1,base64:stagedBytes.subarray(524288).toString("base64")});
    assert.equal((await rpc("operate_external_result",stagedEffect,"read")).state,"unavailable","Complete staging is not published until real publication");
    const stagedGet=await request(stagedPath);assert.equal(stagedGet.status,200);assert.deepEqual(await download(stagedGet.data.result),stagedBytes);
    row.staged={effectId:stagedEffect,manifest:stagedGet.data.result,fixtureAuthority:"test-owned privileged real RPC; cancellation tombstone, no execution grant",verdict:"pass"};

    await page.evaluate(()=>sessionStorage.setItem("l1b-F-deliver","true"));await page.reload();
    await page.waitForFunction(()=>sessionStorage.getItem("l1b-F-saveFailed")==="true",null,{timeout:30_000});
    await page.locator(".workspace-banner.is-error").waitFor({state:"visible",timeout:30_000});
    const failed=await checkpoint("local-save-failed"), recovery=failed.client.recoveries.find(r=>r.serverTurnId===identity.serverTurnId);
    assert.equal(failed.client.acks.length,0);assert.ok(recovery?.coordinator.latestProviderOutputPayload);
    assert.equal(recovery.coordinator.lifecycle.phase,"recovering");assert.equal(recovery.coordinator.lifecycle.persistence,"failed");
    assert.equal(failed.journal.results.find(r=>r.effect_id===effectId).acknowledged_at,null);
    await page.evaluate(()=>sessionStorage.setItem("l1b-F-storageHealthy","true"));await page.reload();
    await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem("l1b-F-clears")??"[]").length===1,null,{timeout:30_000});
    const delivered=await checkpoint("durable-delivery-and-ack-loss"), ackProof=delivered.client.acks[0];
    assert.ok(ackProof);const envelope=JSON.parse(ackProof.envelope);
    assert.equal(sha256(ackProof.envelope),ackProof.reference.sha256);assert.equal(ackProof.reference.sha256,recovery.coordinator.latestProviderOutputPayload.sha256);
    assert.equal(envelope.requestId,identity.requestId);assert.equal(envelope.stepSequence,identity.stepSequence);assert.deepEqual(ackProof.body,ack);
    assert.equal(ackProof.record.coordinator.lifecycle.outcome.kind,"completed");assert.equal(ackProof.record.coordinator.lifecycle.persistence,"succeeded");
    assert.equal(ackProof.record.metadata.localPersistence,"succeeded");
    assert.ok(ackProof.workspace.ai.messages.some(m=>m.body==="P7B controlled result"&&m.status==="done"&&m.agentTurnOutcome==="success"));
    assert.equal(delivered.client.requests.length,1);assert.equal(runtime.stub.calls.length-start,1);
    for(const a of delivered.client.acks)assert.deepEqual(a.body,ack,"ACK response loss may repeat only exact same identity");
    const acknowledged=await journal();assert.ok(acknowledged.results.find(r=>r.effect_id===effectId).acknowledged_at);
    for(let i=0;i<2;i++){assert.equal((await request(path,ack)).status,200);assert.deepEqual(await journal(),acknowledged,"Duplicate ACK has no second semantic mutation");}
    await page.reload();const reloaded=await checkpoint("after-ack-reload");assert.equal(reloaded.client.requests.length,1);
    assert.equal(runtime.stub.calls.length-start,1);assert.deepEqual(await journal(),acknowledged);
    row.clientDelivery={saveFailureAckPosts:0,verifiedEnvelopeBeforeAck:true,finalWorkspaceBeforeAck:true,recoveryBeforeAck:true,
      sameResultAfterReload:true,ackResponseLoss:true,duplicateAckIdempotent:true,requestPosts:1,providerExecutions:1,
      ackPostCount:reloaded.client.acks.length,recoveryCleared:true};

    // Advance only test fixture retention clock; real cleanup RPC/route semantics remain unchanged.
    await runtime.db.query("update public.external_result set expires_at=now()-interval '1 second' where actor_user_id=$1 and effect_id=$2",[actor.userId,effectId]);
    const expired=await request(path);assert.equal(expired.status,410);assert.equal(expired.data.code,"external_result_expired");
    assert.equal((await request(path,ack)).status,410);
    assert.equal((await request(`${path}&resultId=${encodeURIComponent(manifest.resultId)}&chunk=0`)).status,410);
    assert.equal((await rpc("operate_external_result",effectId,"prepare",{manifest:conflicting,binding:original.binding})).state,"expired");
    const tombstone=await checkpoint("expired-tombstone"),saved=tombstone.journal.results.find(r=>r.effect_id===effectId);
    assert.deepEqual(saved.manifest,original.manifest);assert.equal(saved.binding,null);assert.equal(tombstone.journal.turn[0].provider_call_count,1);
    assert.equal((await runtime.db.query("select count(*)::int n from public.external_result_chunk where actor_user_id=$1 and effect_id=$2",[actor.userId,effectId])).rows[0].n,0);
    assert.equal(runtime.stub.calls.length-start,1);
    row.expired={status:410,identityRetained:true,manifestRetained:true,chunksRemoved:true,replacementResult:false,providerRetry:false};
    row.steps.push({name:"F3-F4-F6-F7",verdict:"pass"});
  } finally {
    row.pageErrors=errors;await checkpoint("final").catch(()=>{});
    await page.screenshot({path:resolve(output,"F-final.png"),fullPage:true}).catch(()=>{});await browser.close();
  }
}
