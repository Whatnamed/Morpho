import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { enforceL2TrialBoundary, findL2TerminalStop, l2UsageState, waitForL2UsageSettlement } from "./p7b-l2-trial-boundary.mjs";
const d3=JSON.parse(readFileSync(new URL("../e2e/eval/p7b-l2-d3-stop-fixture.json",import.meta.url),"utf8"));
const sse=records=>records.map(r=>"data: "+JSON.stringify(r)+"\n\n").join("");
const success=(key="slice-1")=>({key,messages:[{agentTurnOutcome:"success",body:"Delivered answer"}],wire:[
  {method:"POST",url:"/turns/test/requests",status:200,response:sse([{type:"resultAvailable",requestId:"r1",delivery:{resultId:"result:one"}},{type:"serverStatus",status:"externallyCompleted"}])},
  {method:"GET",url:"/effects/test/result?resultId=result%3Aone",status:200,response:JSON.stringify({type:"providerOutput",requestId:"r1",outputText:"Delivered answer"})}
]});

test("D3 terminal replay stops before the next trial or its paid egress even when usage settles late",async()=>{
  const started=[],egress=[],order=[],stops=[];let ledger=d3.ledgerAtUnknown;
  await assert.rejects((async()=>{
    for(const facts of [d3.facts,success("next-trial")]){
      started.push(facts.key);
      if(facts.key==="next-trial")egress.push("paid POST");
      await enforceL2TrialBoundary(facts,{readLedger:async()=>ledger,persistStop:async s=>{order.push("durable-stop");stops.push(s);},settleUsage:async()=>{order.push("usage-settlement");ledger=d3.ledgerAfterLateUsage;return l2UsageState(ledger);}});
    }
  })(),e=>e.stop.trialStatus==="infrastructure-interrupted"&&e.stop.code==="external_execution_state_unknown"&&e.stop.usageAfterDrain.status==="settled");
  assert.deepEqual(started,["L2-3-trial-1"]);assert.deepEqual(egress,[]);assert.deepEqual(order,["durable-stop","usage-settlement"]);
  assert.equal(stops[0].usageAtDetection.unsettledRequests,1);
});

test("success and model capability failure continue the original trial order after actual settlement",async()=>{
  const rows=[success("trial-1"),{...success("trial-2"),quality:"fail",messages:[{agentTurnOutcome:"partialSuccess",body:"Insufficient design answer"}]},success("trial-3")],seen=[];
  for(const row of rows){await enforceL2TrialBoundary(row,{readLedger:async()=>d3.ledgerAfterLateUsage,persistStop:async()=>assert.fail("Quality failure must not stop"),settleUsage:async()=>{seen.push("settled-"+row.key);return l2UsageState(d3.ledgerAfterLateUsage);}});seen.push("complete-"+row.key);}
  assert.deepEqual(seen,["settled-trial-1","complete-trial-1","settled-trial-2","complete-trial-2","settled-trial-3","complete-trial-3"]);
});

test("Provider identity conflict, failed/cancelled transport, and pending delivery are hard stops",()=>{
  for(const event of [{code:"provider_identity_conflict"},{error:{code:"provider_identity_conflict"}},{type:"externalError",code:"provider_deadline_exceeded"},{deliveryPending:true},{type:"serverStatus",status:"externallyFailed"},{type:"serverStatus",status:"externallyCancelled"}]){
    const row=success();row.wire[0].response=sse([event]);assert.ok(findL2TerminalStop(row));
  }
  for(const agentTurnOutcome of ["failedDuringProvider","cancelledDuringProvider"]){const row=success();row.messages=[{agentTurnOutcome}];assert.ok(findL2TerminalStop(row));}
});

test("terminal result availability without exact client delivery is infrastructure-interrupted",async()=>{
  for(const mutate of [r=>r.wire.pop(),r=>{r.wire[1].status=503;},r=>{r.wire[1].response=JSON.stringify({type:"providerOutput",requestId:"other"});},r=>{r.wire[0].response=sse([{type:"serverStatus",status:"externallyCompleted"}]);}]){
    const row=success();mutate(row);await assert.rejects(enforceL2TrialBoundary(row,{readLedger:async()=>d3.ledgerAfterLateUsage,persistStop:async()=>{},settleUsage:async()=>l2UsageState(d3.ledgerAfterLateUsage)}),e=>e.stop.code==="external_result_undelivered");
  }
});

test("failed HTTP request and missing assistant terminal are stopped",()=>{
  const row=success();row.wire[0].status=409;assert.equal(findL2TerminalStop(row).code,"provider_request_failed");
  assert.equal(findL2TerminalStop({messages:[],wire:[]}).code,"missing_trial_terminal");
});

test("inline delivered output and quoted unknown words in a normal answer do not mint hard stops",()=>{
  const row={messages:[{agentTurnOutcome:"success",body:"The source says external_execution_state_unknown"}],wire:[{method:"POST",url:"/turns/test/requests",status:200,response:sse([{type:"providerOutput",outputText:"provider_identity_conflict quoted in evidence"}])}]};
  assert.equal(findL2TerminalStop(row),null);
});

test("normal terminal waits for actual usage before another trial can begin",async()=>{
  let release;const settlement=new Promise(r=>{release=r;});let next=false;
  const pending=enforceL2TrialBoundary(success(),{readLedger:async()=>d3.ledgerAtUnknown,persistStop:async()=>assert.fail(),settleUsage:()=>settlement}).then(()=>{next=true;});
  await new Promise(r=>setImmediate(r));assert.equal(next,false);release(l2UsageState(d3.ledgerAfterLateUsage));await pending;assert.equal(next,true);
});

test("bounded capture drain leaves request 20 usage unknown, never inserts zero or estimated usage",async()=>{
  const original=structuredClone(d3.historicalRequest20);let clock=0;
  const usage=await waitForL2UsageSettlement(async()=>d3.historicalRequest20,{timeoutMs:200,now:()=>clock,pause:async ms=>{clock+=ms;}});
  assert.equal(usage.status,"unknown");assert.equal(usage.unsettledRequests,1);assert.deepEqual(usage.ledger,original);
  await assert.rejects(enforceL2TrialBoundary(success(),{readLedger:async()=>original,persistStop:async()=>{},settleUsage:async()=>usage}),e=>e.stop.code==="usage_unsettled"&&e.stop.usageAfterDrain.ledger.requests===20);
  assert.deepEqual(d3.historicalRequest20,original);assert.deepEqual(l2UsageState(null),{status:"unknown",unsettledRequests:null,ledger:null});
});

test("existing guard hard stop is honored even with a delivered answer and settled usage",async()=>{
  let marker;await assert.rejects(enforceL2TrialBoundary(success(),{guardStop:{id:"P7B-2-BUDGET",reason:"Actual cumulative budget reached"},readLedger:async()=>d3.ledgerAfterLateUsage,persistStop:async s=>{marker=s;},settleUsage:async()=>l2UsageState(d3.ledgerAfterLateUsage)}));assert.equal(marker.id,"P7B-2-BUDGET");
});
