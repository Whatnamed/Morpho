// Executes the first real-boundary slice; stop at its first product divergence.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { startIsolatedBoundary, sha256, baseUrl, ports } from "./p7b-l1b-runtime.mjs";
import { readBuildProvenance } from "./build-provenance.mjs";
import { runDurableClientScenario } from "./p7b-l1b-browser.mjs";

const root=process.cwd();
const boundedD1=process.argv.includes("--slice=AB");
const clientSlice=process.argv.includes("--slice=C");
const git=(args)=>execFileSync("git",args,{encoding:"utf8"}).trim();
if(git(["status","--porcelain","--untracked-files=no"])) throw Error("Clean tracked source required");
const sourceSha=git(["rev-parse","HEAD"]);
const contractBytes=await readFile("e2e/eval/p7b-l1b-contract.json");
const contract=JSON.parse(contractBytes);
const runId=new Date().toISOString().replaceAll(":","-")+"-"+process.pid;
const output=resolve("output/playwright/p7b-l1b",runId);
await mkdir(output,{recursive:true});
const verdict={schemaVersion:"p7b-l1b-run-1",runId,sourceSha,contractVersion:contract.version,contractSha256:sha256(contractBytes),
  verdict:"invalid_run",scenarios:[],firstDivergence:null,paidProviderCalls:0,paidCost:0,
  productionDataOrSchemaWrite:false,limits:["Remote migration/schema state unverified: authentication failures", "No production Journal fault injection", "No L2/L3 or L4", "No Kong/hosted Supabase/Vercel path", "Local Auth has Windows single-listener compatibility shim"]};
let runtime;
let sliceComplete=false;
try {
  runtime=await startIsolatedBoundary(process.argv[2]??"temp/p7b-l1b-tools",output);
  verdict.environment=runtime.facts;
  const build=runtime.launch(process.execPath,[resolve("scripts/build-production.mjs"),"--strict"],runtime.appEnv,root);
  const buildExit=await new Promise(r=>build.once("exit",r));
  await writeFile(resolve(output,"build.log"),build.safeLog);
  if(buildExit!==0) throw Error("Isolated production build failed; see sanitized build.log");
  verdict.build=await readBuildProvenance();
  assert.equal(verdict.build.sourceSha,sourceSha); assert.equal(verdict.build.isDirty,false);
  const server=runtime.launch(process.execPath,[resolve("node_modules/next/dist/bin/next"),"start","-p",String(ports.app),"-H","127.0.0.1"],{
    ...runtime.appEnv,NODE_OPTIONS:`--require ${resolve("scripts/p7b-l1b-network-guard.cjs")}`,
    MORPHO_BUILD_SOURCE_SHA:sourceSha,MORPHO_BUILD_ID:verdict.build.buildId,
    MORPHO_BUILD_SOURCE_TREE_SHA256:verdict.build.sourceTreeSha256,MORPHO_BUILD_ARTIFACT_SHA256:verdict.build.artifactSha256,
    MORPHO_BUILD_IS_DIRTY:"false"
  },root);
  await runtime.wait(`${baseUrl}/login`,server);
  const actors=[];
  for(let i=0;i<2;i++) {
    let cookies=[];
    const client=createServerClient(runtime.origin,runtime.keys.anon,{ cookies:{getAll:()=>cookies,setAll:updates=>{cookies=updates;} } });
    const signed=await client.auth.signUp({email:`l1b-${randomUUID()}@example.test`,password:randomUUID()+"Aa1!"});
    if(signed.error||!signed.data.session) throw Error(`Real isolated Auth signup/session failed (status ${signed.error?.status}, code ${signed.error?.code})`);
    actors.push({userId:signed.data.user.id,cookie:cookies.map(c=>`${c.name}=${c.value}`).join("; "),token:signed.data.session.access_token});
    await runtime.db.query("update public.app_user_access set status='active' where user_id=$1",[signed.data.user.id]);
  }
  const http=[];
  const request=async(path,body,actor=actors[0])=>{
    const response=await fetch(baseUrl+path,{method:body===undefined?"GET":"POST",headers:{...(actor?{Cookie:actor.cookie}:{}),"Content-Type":"application/json"},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:"manual"});
    const text=await response.text(); let data; try{data=JSON.parse(text);}catch{data={sseSha256:sha256(text),sseBytes:Buffer.byteLength(text)};}
    http.push({operation:body===undefined?"GET":"POST",path,status:response.status,requestBodySha256:body===undefined?null:sha256(JSON.stringify(body)),response:data});
    return {status:response.status,data};
  };
  const project="p7b-isolated-project";
  let turn;
  const journal=async()=>({
    turn:(await runtime.db.query(`select server_turn_id,local_project_id,server_execution_status,latest_request_id,latest_step_sequence,
      latest_request_hash,provider_call_count,bounded_failure_code from private.agent_turn_journal where server_turn_id=$1`,[turn])).rows,
    requests:(await runtime.db.query("select server_turn_id,request_id,step_sequence,request_hash from private.agent_turn_request_journal where server_turn_id=$1",[turn])).rows,
    effects:(await runtime.db.query("select effect_id,kind,request_digest,execution_state,latest_attempt_id,cancel_requested_at,local_abort_observed_at from public.external_effect where actor_user_id=$1",[actors[0].userId])).rows,
    results:(await runtime.db.query("select effect_id,manifest,manifest || jsonb_build_object('expiresAt', expires_at) as delivery_manifest,binding,published_at,acknowledged_at,expires_at from public.external_result where actor_user_id=$1",[actors[0].userId])).rows
  });
  const scenario=async(id,fn)=>{
    const start=http.length;
    const row={id,expected:contract.scenarios.find(s=>s.id===id).expected,before:turn?await journal():null};
    verdict.scenarios.push(row);
    try { await fn(row); row.verdict="pass"; }
    catch(error) {
      row.assertion=error.message;
      if(error.name!=="AssertionError") { row.verdict="invalid_run"; await writeFile(resolve(output,`scenario-${id}.json`),JSON.stringify(row,null,2)+"\n"); throw error; }
      row.verdict="fail"; verdict.firstDivergence={scenario:id,layer:"route/runtime or DB contract; attribution requires review",assertion:error.message};
    }
    row.after=turn?await journal():null;
    row.http=http.slice(start);
    row.providerStubExecutions=runtime.stub.calls.length;
    await writeFile(resolve(output,`scenario-${id}.json`),JSON.stringify(row,null,2)+"\n");
    return row.verdict==="pass";
  };
  let A;
  if(clientSlice) {
    await scenario("C",async row=>{
      row.cases=[];
      for(const fault of [false,true]) {
        const subcase={name:fault?"local_save_failure":"response_loss_reload"}; row.cases.push(subcase);
        await runDurableClientScenario({runtime,actor:actors[0],row:subcase,output,setTurn:value=>{turn=value;},fault});
      }
    });
    verdict.scenarios.unshift(...contract.scenarios.filter(s=>["A","B"].includes(s.id)).map(s=>({id:s.id,expected:s.expected,verdict:"not_run",reason:"Accepted A/B receipt retained; no D1 re-audit"})));
  } else A=await scenario("A",async(row)=>{
    const body={localProjectId:project,creationIdempotencyKey:"l1b-create-A"};
    assert.equal((await request("/api/ai/agent/turns",body,null)).status,401);
    const created=await request("/api/ai/agent/turns",body);
    assert.equal(created.status,200); turn=created.data.serverTurnId;
    assert.equal((await request("/api/ai/agent/turns",body)).data.serverTurnId,turn);
    assert.equal((await request(`/api/ai/agent/turns/${turn}?localProjectId=${project}`)).data.serverTurnId,turn);
    assert.equal((await request(`/api/ai/agent/turns/${turn}?localProjectId=${project}`,undefined,actors[1])).status,404);
    assert.equal((await request(`/api/ai/agent/turns/${turn}?localProjectId=wrong-project`)).status,404);
    const privileged=await fetch(`${runtime.origin}/rest/v1/rpc/operate_external_effect`,{method:"POST",
      headers:{apikey:runtime.keys.anon,Authorization:`Bearer ${actors[0].token}`,"Content-Type":"application/json"},
      body:JSON.stringify({p_actor_user_id:actors[0].userId,p_effect_id:"effect:"+"1".repeat(64),p_kind:"text",p_operation:"read",p_payload:{}})});
    row.authenticatedPrivilegedRpcStatus=privileged.status;
    assert.equal(privileged.status,403);
    assert.equal((await journal()).turn.length,1);
  });
  if(A) {
    await scenario("B",async(row)=>{
      const path=`/api/ai/agent/turns/${turn}/requests`;
      const body={localProjectId:project,requestId:"l1b-text-request",stepSequence:1,providerRequest:{
        input:[{role:"user",content:[{type:"input_text",text:"P7B synthetic original input"}]}],
        promptContractVersion:"morpho-agent-v3.8-2026-10-01",mode:"auto",capabilityIntent:{comparisonAnalysis:false}
      }};
      assert.equal((await request(path,body,actors[1])).status,404);
      assert.equal((await request(path,{...body,localProjectId:"wrong-project"})).status,404);
      const first=await request(path,body); assert.equal(first.status,200);
      const state=await journal();
      assert.equal(runtime.stub.calls.length,1); assert.equal(state.turn[0].provider_call_count,1);
      assert.equal(state.requests.length,1); assert.equal(state.requests[0].request_id,body.requestId);
      assert.equal(state.requests[0].step_sequence,1); assert.match(state.requests[0].request_hash,/^[a-f0-9]{64}$/);
      assert.equal(state.results.length,1); assert.ok(state.results[0].published_at);
      assert.match(state.results[0].binding.requestContentSha256,/^[a-f0-9]{64}$/);
      const replay=await request(path,body); assert.equal(replay.status,200);
      assert.equal(replay.data.result.resultId,state.results[0].manifest.resultId); assert.equal(runtime.stub.calls.length,1);
      assert.deepEqual(replay.data.result,state.results[0].delivery_manifest);
      assert.deepEqual(await journal(),state,"Exact completed replay must leave Journal/effect/result unchanged");
      row.originalRequest=body; row.exactReplayResult=replay.data.result;
      row.preConflictJournal=await journal();
      const changed={...body,providerRequest:{...body.providerRequest,input:[{role:"user",content:[{type:"input_text",text:"P7B synthetic CHANGED input"}]}]}};
      row.originalBodySha256=sha256(JSON.stringify(body)); row.changedBodySha256=sha256(JSON.stringify(changed));
      const conflict=await request(path,changed);
      row.changedBodyOutcome=conflict;
      row.frozenJournalUnchangedAfterChangedBody=JSON.stringify(row.preConflictJournal)===JSON.stringify(await journal());
      assert.equal(conflict.status,409,"Same request identity with changed Provider body must be rejected even after result publication");
      assert.equal(conflict.data.code,"request_id_conflict");
      assert.equal(Object.hasOwn(conflict.data,"result"),false);
      assert.equal(row.frozenJournalUnchangedAfterChangedBody,true);
      assert.equal(runtime.stub.calls.length,1);
    });
    sliceComplete=!verdict.firstDivergence;
  }
  verdict.verdict=verdict.firstDivergence?"product_blocker":"inconclusive";
  verdict.providerStubCalls=runtime.stub.calls;
  for(const s of contract.scenarios.filter(s=>!["A","B",...(clientSlice?["C"]:[])].includes(s.id))) verdict.scenarios.push({id:s.id,expected:s.expected,verdict:"not_run",
    reason:verdict.firstDivergence?"Stopped at first product divergence":boundedD1?"Excluded from bounded D1 A/B rerun":"Not implemented in first slice; no full L1b pass claimed"});
  if(!A&&!clientSlice) verdict.scenarios.push({id:"B",verdict:"not_run",reason:"Stopped at A divergence"});
  await writeFile(resolve(output,"server.log"),server.safeLog);
} catch(error) {
  verdict.setupError=error.message; verdict.verdict="invalid_run";
} finally {
  if(runtime) await runtime.stop();
  verdict.sliceComplete=sliceComplete;
  if(boundedD1) verdict.boundedSlice={scenarios:["A","B"],verdict:sliceComplete?"pass":verdict.verdict};
  await writeFile(resolve(output,"verdict.json"),JSON.stringify(verdict,null,2)+"\n");
}
console.log(JSON.stringify({output,verdict:verdict.verdict,firstDivergence:verdict.firstDivergence,sourceSha}));
// Teardown is already awaited; bypass the portable PG beforeExit hook's implicit code 0.
process.exit(verdict.verdict==="pass"||(boundedD1&&sliceComplete)?0:1);
