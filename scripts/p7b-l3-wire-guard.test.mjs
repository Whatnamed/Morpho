import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require=createRequire(import.meta.url),source=readFileSync(new URL("./p7b-l3-wire-guard.cjs",import.meta.url),"utf8"),frozen=JSON.parse(readFileSync(new URL("../e2e/eval/p7b-l3-manifest.json",import.meta.url),"utf8"));
function harness({noPaid=false,budget={},transport,historical,imageHostAllowlist}={}){
  const files=new Map(),calls=[],durability=[],handles=new Map();let handle=0,key="attempt-1";
  const pixel=Buffer.from("authorized unit-test pixels"),sha=createHash("sha256").update(pixel).digest("hex"),manifest={...frozen,historical,provider:{...frozen.provider,...(imageHostAllowlist?{imageHostAllowlist}:{})},budget:{...frozen.budget,...budget}},fixture={seed:{aliases:{parent:"A"},workspaceValue:JSON.stringify({objects:{A:{assetId:"asset-A"}}})},assets:[{assetId:"asset-A",contentHash:sha}],attempts:["attempt-1","attempt-2"].map(key=>({key,plan:{items:[{prompt:"Frozen prompt"}]}}))};
  const fs={readFileSync:p=>p==="manifest"?JSON.stringify(manifest):p.endsWith("fixture.json")?JSON.stringify(fixture):p.endsWith("active-attempt.json")?JSON.stringify({key}):files.get(p),existsSync:p=>files.has(p),openSync:p=>{handles.set(++handle,p);return handle;},writeFileSync:(p,b)=>files.set(typeof p==="number"?handles.get(p):p,b),fsyncSync:fd=>durability.push(handles.get(fd)),closeSync:()=>{},renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);}};
  const context=vm.createContext({require:n=>n==="node:fs"?fs:require(n),process:{env:{MORPHO_L3_OUTPUT:"output",MORPHO_L3_MANIFEST:"manifest",MORPHO_L3_NO_PAID:String(noPaid)}},URL,Buffer,Response,fetch:async(i,init)=>{calls.push({i,init});return transport?transport(i,init):Response.json({id:"task-1",status:"running"});}});vm.runInContext(source,context);
  const body={model:frozen.provider.model,aspectRatio:frozen.provider.providerAspectRatio,replyType:"json",prompt:"Frozen prompt",images:["data:image/jpeg;base64,"+pixel.toString("base64")]};
  return{calls,durability,fetch:(changes={})=>context.fetch(frozen.provider.baseUrl+"/v1/api/generate",{method:"POST",body:JSON.stringify({...body,...changes})}),json:suffix=>JSON.parse([...files].find(([p])=>p.endsWith(suffix))[1]),activate:next=>{key=next;},context};
}
test("unauthorized reference, prompt or model/config drift never reaches paid egress",async()=>{
  for(const change of [{images:["data:image/jpeg;base64,"+Buffer.from("default E").toString("base64")]},{prompt:"changed"},{model:"gpt-image-2.5"},{aspectRatio:"16:9"},{quality:"high"}]){const h=harness();await assert.rejects(h.fetch(change),/L3 hard stop/);assert.equal(h.calls.length,0);assert.equal(h.json("paid-ledger.json").paidSubmissions,0);}
});
test("zero-paid actual-wire audit captures exact input without submission or count",async()=>{
  const h=harness({noPaid:true});await h.fetch();assert.equal(h.calls.length,0);assert.equal(h.json("preflight-wire.json").paidEgress,false);assert.equal(h.json("paid-ledger.json").paidSubmissions,0);
});
test("count and conservative tariff are fsynced before actual submission; duplicate is blocked",async()=>{
  let h;h=harness({transport:()=>{assert.equal(h.json("paid-ledger.json").paidSubmissions,1);assert.ok(h.durability.some(p=>p.endsWith("paid-ledger.json.tmp")));return Response.json({id:"task-1"});}});
  await h.fetch();assert.equal(h.json("paid-ledger.json").estimatedCostCny,0.03);await assert.rejects(h.fetch(),/Duplicate paid effect/);assert.equal(h.calls.length,1);
});
test("submission and money ceilings take the stricter limit",async()=>{
  for(const budget of [{paidSubmissions:0},{directEstimatedCostCny:0.02}]){const h=harness({budget});await assert.rejects(h.fetch(),/ceiling/);assert.equal(h.calls.length,0);}
  const h=harness({budget:{paidSubmissions:1}});await h.fetch();h.activate("attempt-2");await assert.rejects(h.fetch(),/ceiling/);assert.equal(h.calls.length,1);
});
test("Provider error counts as the original attempt without replacement or retry",async()=>{
  const h=harness({transport:()=>Response.json({error:"declined"},{status:400})});await h.fetch();assert.equal(h.json("paid-ledger.json").paidSubmissions,1);assert.equal(h.json("attempt-1-provider-response.json").status,400);assert.equal(h.calls.length,1);
});
test("ambiguous transport blocks every later attempt without automatic retry",async()=>{
  const h=harness({transport:()=>{throw Error("socket lost");}});await assert.rejects(h.fetch(),/Ambiguous/);h.activate("attempt-2");await assert.rejects(h.fetch(),/already stopped/);assert.equal(h.calls.length,1);assert.equal(h.json("paid-ledger.json").attempts[0].status,"sent / outcome unknown");
});
test("real Text and other external routes fail before egress",async()=>{
  const h=harness();await assert.rejects(h.context.fetch("https://api.aijws.com/v1/responses",{method:"POST"}),/Unexpected external route/);assert.equal(h.calls.length,0);
});
test("historical diagnostic consumption is durable carry-forward, never a fresh capability trial",async()=>{
  const h=harness({historical:{paidSubmissions:1,estimatedCostCny:0.03,attempts:[{key:"historical-D1"}]},budget:{paidSubmissions:9,baselineSubmissions:8}});
  await h.fetch();const ledger=h.json("paid-ledger.json");assert.equal(ledger.paidSubmissions,2);assert.equal(ledger.baselineSubmissions,1);assert.equal(ledger.estimatedCostCny,0.06);assert.equal(ledger.attempts[0].key,"historical-D1");
  for(const options of [{historical:{paidSubmissions:9,estimatedCostCny:0.27},budget:{paidSubmissions:9}},{historical:{paidSubmissions:1,estimatedCostCny:0.49},budget:{paidSubmissions:9}},{historical:{paidSubmissions:1,estimatedCostCny:0.03},budget:{paidSubmissions:9,baselineSubmissions:0}}]){const blocked=harness(options);await assert.rejects(blocked.fetch(),/ceiling/);assert.equal(blocked.calls.length,0);}
});
test("same-result CDN GET and redirects are allowed only after the bound Provider metadata; no paid count increment",async()=>{
  const resultUrl="https://file4.aitohumanize.com/result.png",redirected="https://file27.aitohumanize.com/result.png";
  const h=harness({imageHostAllowlist:["file*.aitohumanize.com"],transport:(url,init)=>init.method==="POST"?Response.json({id:"same-task",status:"succeeded",results:[{url:resultUrl}]}):url===resultUrl?new Response(null,{status:302,headers:{location:redirected}}):new Response("pixels",{headers:{"content-type":"image/png"}})});
  await h.fetch();await h.context.fetch(resultUrl,{method:"GET"});await h.context.fetch(redirected,{method:"GET"});assert.equal(h.calls.length,3);assert.equal(h.json("paid-ledger.json").paidSubmissions,1);
  const absent=harness({imageHostAllowlist:["file*.aitohumanize.com"]});await assert.rejects(absent.context.fetch(resultUrl,{method:"GET"}),/Unexpected external route/);assert.equal(absent.calls.length,0);
});
