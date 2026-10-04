import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const source=readFileSync(new URL("./p7b-l2-wire-guard.cjs",import.meta.url),"utf8");
const frozen=JSON.parse(readFileSync(new URL("../e2e/eval/p7b-l2-manifest.json",import.meta.url),"utf8"));
function harness({noPaid=false,slice="L2-3",budget={},reply,transport}={}){
  const files=new Map(),calls=[];
  const manifest={...frozen,budget:{...frozen.budget,...budget}};
  const fs={readFileSync:p=>p==="manifest"?JSON.stringify(manifest):p.endsWith("active-trial.json")?JSON.stringify({key:slice+"-trial-1",slice}):files.get(p),writeFileSync:(p,v)=>files.set(p,v),appendFileSync:(p,v)=>files.set(p,(files.get(p)??"")+v),existsSync:p=>files.has(p)};
  const context=vm.createContext({require:n=>n==="node:fs"?fs:require(n),process:{env:{MORPHO_L2_MANIFEST:"manifest",MORPHO_L2_OUTPUT:"output",MORPHO_L2_NO_PAID:String(noPaid)}},URL,Buffer,Response,
    fetch:async(input,init)=>{calls.push({input,init});if(transport)return transport(input,init);return Response.json(reply??{usage:{input_tokens:50,output_tokens:20,input_tokens_details:{cached_tokens:10}}});}});
  vm.runInContext(source,context);
  const fetch=()=>context.fetch(frozen.provider.endpoint,{method:"POST",body:JSON.stringify({model:frozen.provider.model,reasoning:{effort:"high"},input:[{role:"user",content:[{type:"input_text",text:"Fixed data"}]}],tools:[]})});
  const settled=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};
  return {fetch,calls,files,context,settled,json:suffix=>JSON.parse([...files].find(([p])=>p.endsWith(suffix))[1])};
}
test("zero-paid production wire audit exposes missing required Research tool before egress",async()=>{
  const h=harness({noPaid:true,slice:"L2-1"});await assert.rejects(h.fetch(),/Required create_research_analysis omitted/);
  assert.equal(h.calls.length,0);assert.equal(h.json("no-paid-server-wire.json").networkSent,false);assert.equal(h.json("hard-blocker.json").ledger.requests,0);
});
test("normal wire preserves production content and only adds bounded output allocation",async()=>{
  const h=harness();await h.fetch();await h.settled();const w=h.json("request.json"),{max_output_tokens,...body}=w.finalWire;
  assert.deepEqual(body,w.productionBody);assert.equal(max_output_tokens,4096);assert.equal(h.json("ledger.json").inputTokens,50);assert.equal(h.calls.length,1);
});
test("request/input/output/cost exhaustion blocks before actual transport",async()=>{
  for(const budget of [{textRequests:0},{inputTokens:1},{outputTokensIncludingReasoning:0},{costCny:0}]){
    const h=harness({budget});await assert.rejects(h.fetch(),/budget|limit/i);assert.equal(h.calls.length,0);
  }
});
test("ambiguous transport is captured and never retried",async()=>{
  const h=harness({transport:()=>{throw Error("socket lost");}});await assert.rejects(h.fetch(),/no retry/);await assert.rejects(h.fetch(),/already stopped/);assert.equal(h.calls.length,1);
});
test("missing raw usage stops subsequent submission",async()=>{
  const h=harness({reply:{output:[]}});await h.fetch();await h.settled();await assert.rejects(h.fetch(),/Missing bounded original Provider usage/);assert.equal(h.calls.length,1);
});
test("concurrent requests wait for prior usage and remaining budget before send",async()=>{
  let release;const wait=new Promise(r=>{release=r;});
  const h=harness({budget:{textRequests:1},transport:async()=>{await wait;return Response.json({usage:{input_tokens:10,output_tokens:20}});}});
  const a=h.fetch(),b=h.fetch();await h.settled();assert.equal(h.calls.length,1);release();await a;await assert.rejects(b,/Pre-send budget limit/);assert.equal(h.calls.length,1);assert.equal(h.json("ledger.json").outputTokens,20);
});
