import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const source=readFileSync(new URL("./p7b-l2-wire-guard.cjs",import.meta.url),"utf8");
const frozen=JSON.parse(readFileSync(new URL("../e2e/eval/p7b-l2-manifest.json",import.meta.url),"utf8"));
function harness({noPaid=false,slice="L2-3",budget={},reply,transport,carry,extension}={}){
  const files=new Map(),calls=[];
  const manifest={...frozen,budget:{...frozen.budget,...budget}};
  let handle=0;const handles=new Map(),durability=[];
  const fs={readFileSync:p=>p==="manifest"?JSON.stringify(manifest):p==="extension"?JSON.stringify({cumulativeBudget:extension}):p==="carry"?JSON.stringify({totals:carry}):p.endsWith("active-trial.json")?JSON.stringify({key:slice+"-trial-1",slice}):files.get(p),
    openSync:p=>{handles.set(++handle,p);return handle;},writeFileSync:(p,v)=>files.set(typeof p==="number"?handles.get(p):p,v),fsyncSync:fd=>durability.push(handles.get(fd)),closeSync:()=>{},renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);},
    appendFileSync:(p,v)=>files.set(p,(files.get(p)??"")+v),existsSync:p=>files.has(p)};
  const context=vm.createContext({require:n=>n==="node:fs"?fs:require(n),process:{env:{MORPHO_L2_MANIFEST:"manifest",MORPHO_L2_OUTPUT:"output",MORPHO_L2_NO_PAID:String(noPaid),...(carry?{MORPHO_L2_CARRY_FORWARD:"carry"}:{}),...(extension?{MORPHO_L2_BUDGET_EXTENSION:"extension"}:{})}},URL,Buffer,Response,
    fetch:async(input,init)=>{calls.push({input,init});if(transport)return transport(input,init);return Response.json(reply??{usage:{input_tokens:50,output_tokens:20,input_tokens_details:{cached_tokens:10}}});}});
  vm.runInContext(source,context);
  const fetch=(tools=[])=>context.fetch(frozen.provider.endpoint,{method:"POST",body:JSON.stringify({model:frozen.provider.model,reasoning:{effort:"high"},input:[{role:"user",content:[{type:"input_text",text:"Fixed data"}]}],tools})});
  const settled=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};
  return {fetch,calls,files,context,settled,durability,json:suffix=>JSON.parse([...files].find(([p])=>p.endsWith(suffix))[1])};
}
test("zero-paid production wire audit exposes missing required Research tool before egress",async()=>{
  const h=harness({noPaid:true,slice:"L2-1"});await assert.rejects(h.fetch(),/Required create_research_analysis omitted/);
  assert.equal(h.calls.length,0);assert.equal(h.json("no-paid-server-wire.json").networkSent,false);assert.equal(h.json("hard-blocker.json").ledger.requests,0);
});
test("paid mode also rejects the known frozen Research authority failure before egress",async()=>{
  const h=harness({slice:"L2-1"});await assert.rejects(h.fetch(),/Required create_research_analysis omitted/);assert.equal(h.calls.length,0);assert.equal(h.json("hard-blocker.json").ledger.requests,0);
});
test("normal wire preserves production content and only adds bounded output allocation",async()=>{
  const h=harness();await h.fetch();await h.settled();const w=h.json("request.json"),{max_output_tokens,...body}=w.finalWire;
  assert.deepEqual(body,w.productionBody);assert.equal(max_output_tokens,4096);assert.equal(h.json("ledger.json").inputTokens,50);assert.equal(h.calls.length,1);
});
test("actual request/input/output/cost exhaustion blocks before actual transport",async()=>{
  for(const budget of [{textRequests:0},{inputTokens:0},{outputTokensIncludingReasoning:0},{costCny:0}]){
    const h=harness({budget});await assert.rejects(h.fetch(),/budget|limit/i);assert.equal(h.calls.length,0);
  }
});
test("ambiguous transport is captured and never retried",async()=>{
  const h=harness({transport:()=>{throw Error("socket lost");}});await assert.rejects(h.fetch(),/no retry/);await assert.rejects(h.fetch(),/already stopped/);assert.equal(h.calls.length,1);
});
test("missing raw usage stops subsequent submission",async()=>{
  const h=harness({reply:{output:[]}});await h.fetch();await h.settled();await assert.rejects(h.fetch(),/Missing\/invalid completed Provider usage/);assert.equal(h.calls.length,1);
});
test("concurrent requests wait for prior usage and remaining budget before send",async()=>{
  let release;const wait=new Promise(r=>{release=r;});
  const h=harness({budget:{textRequests:1},transport:async()=>{await wait;return Response.json({usage:{input_tokens:10,output_tokens:20}});}});
  const a=h.fetch(),b=h.fetch();await h.settled();assert.equal(h.calls.length,1);release();await a;await assert.rejects(b,/Actual cumulative budget reached/);assert.equal(h.calls.length,1);assert.equal(h.json("ledger.json").outputTokens,20);
});
test("reported usage above byte projection settles normally and keeps the valid result",async()=>{
  const h=harness({reply:{usage:{input_tokens:37777,output_tokens:606,input_tokens_details:{cached_tokens:0}}}});
  const response=await h.fetch();assert.equal(response.status,200);await h.settled();
  assert.ok(h.json("request.json").inputEstimate<37777);assert.equal(h.json("ledger.json").inputTokens,37777);assert.equal(h.json("ledger.json").estimatedCny,0.0122421);
  assert.equal([...h.files.keys()].some(p=>p.endsWith("hard-blocker.json")),false);await h.fetch();await h.settled();assert.equal(h.calls.length,2);
});
test("a second concurrent action waits for the first response body usage settlement",async()=>{
  let controller;const stream=new ReadableStream({start:c=>{controller=c;}});
  const h=harness({budget:{inputTokens:100},transport:()=>new Response(stream)});
  await h.fetch();const second=h.fetch();await h.settled();assert.equal(h.calls.length,1);assert.equal(h.json("ledger.json").inputTokens,0);
  controller.enqueue(new TextEncoder().encode(JSON.stringify({usage:{input_tokens:100,output_tokens:20}})));controller.close();
  await assert.rejects(second,/Actual cumulative budget reached/);assert.equal(h.calls.length,1);assert.equal(h.json("ledger.json").inputTokens,100);
});
test("response settlement records actual input/output/cost exhaustion before blocking the next action",async()=>{
  for(const budget of [{inputTokens:50},{outputTokensIncludingReasoning:300},{costCny:0.000001}]){
    const h=harness({budget,reply:{usage:{input_tokens:100,output_tokens:300}}});await h.fetch();await h.settled();
    assert.equal(h.json("ledger.json").inputTokens,100);assert.equal(h.json("ledger.json").outputTokens,300);assert.equal(h.json("ledger.json").settledRequests,1);
    assert.ok(h.json("response.json").usage);await assert.rejects(h.fetch(),/budget/i);assert.equal(h.calls.length,1);
  }
});
test("historical request/input/output/cache/cost are carried and remaining output caps the new body",async()=>{
  const carry={requests:1,inputTokens:37777,outputTokens:606,cachedInputTokens:0,estimatedCny:0.0122421};
  const h=harness({carry,budget:{outputTokensIncludingReasoning:1000}});await h.fetch();await h.settled();
  assert.equal(h.json("request.json").finalWire.max_output_tokens,394);
  const l=h.json("ledger.json");assert.equal(l.requests,2);assert.equal(l.runRequests,1);assert.equal(l.inputTokens,37827);assert.equal(l.outputTokens,626);assert.equal(l.cachedInputTokens,10);assert.equal(l.settledRequests,2);
  assert.ok(Math.abs(l.estimatedCny-(carry.estimatedCny+0.0000423))<1e-12);
});
test("request intent is fsynced before upstream transport",async()=>{
  let h;h=harness({transport:()=>{assert.equal(h.json("ledger.json").requests,1);assert.equal(h.json("ledger.json").settledRequests,0);assert.ok(h.durability.some(p=>p.endsWith("ledger.json.tmp")));return Response.json({usage:{input_tokens:10,output_tokens:10}});}});
  await h.fetch();await h.settled();assert.equal(h.json("ledger.json").settledRequests,1);
});
test("invalid negative/cache/total usage fails closed after capture without a second submission",async()=>{
  for(const usage of [{input_tokens:-1,output_tokens:10},{input_tokens:10,output_tokens:10,input_tokens_details:{cached_tokens:11}},{input_tokens:10,output_tokens:10,total_tokens:100}]){
    const h=harness({reply:{usage}});await h.fetch();await h.settled();await assert.rejects(h.fetch(),/Missing\/invalid/);assert.equal(h.calls.length,1);
  }
});
test("D1 exact zero-paid wire with Research grant captures without a hard blocker or paid egress",async()=>{
  const h=harness({slice:"L2-1",noPaid:true});await assert.rejects(h.fetch([{type:"function",name:"create_research_analysis"}]),/No-paid preflight egress blocked after capture/);
  assert.equal(h.calls.length,0);assert.equal(h.json("no-paid-server-wire.json").productionBody.tools[0].name,"create_research_analysis");assert.equal([...h.files.keys()].some(p=>p.endsWith("hard-blocker.json")),false);
});
test("a positive final output remainder is allocated, not called exhausted by an arbitrary floor",async()=>{
  const carry={requests:1,inputTokens:37777,outputTokens:49999,cachedInputTokens:0,estimatedCny:0.0122421};
  const h=harness({carry,reply:{usage:{input_tokens:10,output_tokens:1}}});await h.fetch();await h.settled();
  assert.equal(h.json("request.json").finalWire.max_output_tokens,1);assert.equal(h.json("ledger.json").outputTokens,50000);
  await assert.rejects(h.fetch(),/Actual output token budget exhausted/);assert.equal(h.json("hard-blocker.json").stopKind,"actual_budget_limit");assert.equal(h.calls.length,1);
});

test("explicit cumulative extension admits the historical settled ledger without changing the frozen manifest",async()=>{
  const carry={requests:13,inputTokens:641092,outputTokens:23835,cachedInputTokens:147358,estimatedCny:0.18829344};
  const extension={textRequests:64,inputTokens:4000000,outputTokensIncludingReasoning:200000,costCny:16};
  const blocked=harness({carry});await assert.rejects(blocked.fetch(),/Actual cumulative budget reached/);assert.equal(blocked.calls.length,0);
  const h=harness({carry,extension});await h.fetch();await h.settled();
  assert.equal(h.json("ledger.json").requests,14);assert.equal(h.json("ledger.json").inputTokens,641142);assert.equal(h.json("ledger.json").outputTokens,23855);
  assert.equal(h.json("request.json").finalWire.max_output_tokens,4096);assert.equal(frozen.budget.inputTokens,600000);
});

test("invalid budget override fails before upstream transport",()=>{
  for(const inputTokens of [undefined,-1,NaN])assert.throws(()=>harness({extension:{textRequests:64,inputTokens,outputTokensIncludingReasoning:200000,costCny:16}}),/Invalid L2 budget/);
});
