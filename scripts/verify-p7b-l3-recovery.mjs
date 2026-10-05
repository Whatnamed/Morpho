// Zero-paid Chromium regression: native production persistence/recovery, fixed escrow API fixture.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, open } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { buildL3Fixture, hash } from "./p7b-l3-fixture.mjs";

const output=resolve("output/playwright/p7b-l3",new Date().toISOString().replaceAll(":","-")+"-zero-paid-recovery");
await mkdir(output,{recursive:true});await buildL3Fixture(output);
const fixture=JSON.parse(await readFile(resolve(output,"fixture.json")));
const bundled=await build({entryPoints:[resolve("scripts/p7b-l3-browser-entry.ts")],bundle:true,write:false,platform:"browser",format:"iife",alias:{"@":resolve("src")},tsconfig:resolve("tsconfig.json")});
const fixtureMetadata=JSON.parse(await readFile(resolve(output,"fixture-metadata.json")));
const pixels=await readFile(resolve("public",fixture.assets.find(a=>a.contentHash===fixtureMetadata.sourceAsset.contentHash).publicPath.slice(1)));
const origin="http://127.0.0.1:55439",verdict={mode:"zero-paid fixed API fixture / real Chromium localStorage + IndexedDB",paidGeneratePosts:0,cases:[]};
async function run(name,mode){
  const profile=resolve(output,name+"-profile"),calls=[],exports=[];let manifest,context,page,pending=mode==="pending";
  const routes=async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    if(url.pathname==="/eval-l3-host")return route.fulfill({contentType:"text/html",body:"<!doctype html>"});
    if(url.pathname.startsWith("/case-study/"))return route.fulfill({body:await readFile(resolve("public",url.pathname.slice(1))),contentType:url.pathname.endsWith(".png")?"image/png":"image/jpeg"});
    calls.push({url:url.href,method});
    if(url.pathname==="/api/ai/image"&&method==="POST"){
      const body=JSON.parse(request.postData());const effectId="effect:"+hash(JSON.stringify(["image",body.clientRequestId]));
      manifest={effectId,resultId:"result:"+hash(pixels),version:1,kind:"image",sha256:hash(pixels),byteLength:pixels.length,mimeType:"image/jpeg",chunkCount:Math.ceil(pixels.length/(512*1024)),expiresAt:new Date(Date.now()+86400000).toISOString()};
      return route.fulfill({status:502,json:{code:"image_generation_failed",error:"Zero-paid fixture: result response lost after intent persistence"}});
    }
    if(url.pathname===`/api/ai/effects/${encodeURIComponent(manifest.effectId)}/result`){
      if(method==="POST")return route.fulfill({json:{acknowledged:true}});
      if(pending)return route.fulfill({status:503,json:{deliveryPending:true}});
      if(url.searchParams.has("chunk")){const n=Number(url.searchParams.get("chunk"));return route.fulfill({body:pixels.subarray(n*512*1024,(n+1)*512*1024),contentType:"image/jpeg"});}
      return route.fulfill({json:{result:manifest},headers:{"X-Morpho-Provider-Task-Id":"zero-paid-original-task"}});
    }
    throw Error("Unexpected route / paid egress forbidden: "+url.href);
  };
  async function launch(){context=await chromium.launchPersistentContext(profile,{headless:true});await context.route("**/*",routes);await context.exposeFunction("l3CaptureBeforeEgress",async snapshot=>{exports.push(snapshot);const file=await open(resolve(output,name+"-before-post.json"),"wx");try{await file.writeFile(JSON.stringify(snapshot,null,2));await file.sync();}finally{await file.close();}});page=await context.newPage();await page.goto(origin+"/eval-l3-host");await page.addScriptTag({content:bundled.outputFiles[0].text});}
  try{
    await launch();const before=await page.evaluate(s=>window.l3.initialize(s),fixture.seed);
    const failed=await page.evaluate(({a,aliases})=>window.l3.execute(a,aliases),{a:fixture.attempts[0],aliases:fixture.seed.aliases});
    assert.ok(failed.error);assert.equal(exports.length,1);const snapshot=failed.recovery;assert.equal(snapshot.intents.length,1);assert.equal(snapshot.intents[0].sha256,exports[0].intents[0].sha256);assert.equal(snapshot.intents[0].requestBodySha256,exports[0].intents[0].requestBodySha256);assert.equal(snapshot.intents[0].draftSha256,exports[0].intents[0].draftSha256);
    await writeFile(resolve(output,name+"-original-intent.json"),JSON.stringify(snapshot,null,2));
    await page.reload();await page.addScriptTag({content:bundled.outputFiles[0].text});await page.evaluate(s=>window.l3.initialize(s),fixture.seed);assert.deepEqual((await page.evaluate(()=>window.l3.capture())).intents,snapshot.intents);
    await context.close();await launch();await page.evaluate(s=>window.l3.initialize(s),fixture.seed);assert.deepEqual((await page.evaluate(()=>window.l3.capture())).intents,snapshot.intents);
    if(mode==="rehydrate"){
      await context.close();context=await chromium.launch({headless:true}).then(b=>b.newContext());
      const owner=context.browser();await context.route("**/*",routes);page=await context.newPage();await page.goto(origin+"/eval-l3-host");await page.addScriptTag({content:bundled.outputFiles[0].text});await page.evaluate(s=>window.l3.rehydrate(s),snapshot);await page.evaluate(s=>window.l3.initialize(s),fixture.seed);
      context.extraOwner=owner;assert.deepEqual((await page.evaluate(()=>window.l3.capture())).intents,snapshot.intents);
    }
    const start=calls.length;let expected=structuredClone(snapshot),result,error;
    if(mode==="missing"||mode==="corrupt")await page.evaluate(({key,mode})=>window.l3.damageIntent(key,mode),{key:snapshot.intents[0].key,mode});
    if(mode==="hashMismatch")expected.intents[0].sha256="0".repeat(64);
    if(mode==="invalidBlob"){expected.intents[0].base64=Buffer.from("invalid JSON").toString("base64");expected.intents[0].byteLength=12;expected.intents[0].sha256=hash("invalid JSON");}
    try{result=await page.evaluate(s=>window.l3.recover(s),expected);}catch(e){error=e.message;}
    const recoveryCalls=calls.slice(start),invalid=["missing","corrupt","hashMismatch","invalidBlob"].includes(mode);
    if(invalid){assert.ok(error);assert.equal(recoveryCalls.length,0);const current=await page.evaluate(s=>window.l3.initialize(s),fixture.seed);assert.deepEqual(current.workspace.objects,before.workspace.objects);}
    else{
      assert.equal(error,undefined);assert.ok(recoveryCalls.every(c=>c.url.includes(encodeURIComponent(manifest.effectId))));assert.equal(recoveryCalls.filter(c=>c.method==="POST").length,pending?0:1);
      const images=Object.values(result.workspace.objects).filter(o=>o.type==="image"&&!before.workspace.objects[o.id]);assert.equal(images.length,pending?0:1);
      if(pending){assert.deepEqual(result.recovery.intents,snapshot.intents);}
      else{
        const image=images[0],fact=result.images.find(i=>i.objectId===image.id);assert.equal(fact.sha256,manifest.sha256);assert.equal(image.generation.clientRequestId,snapshot.intents[0].clientRequestId);assert.equal(image.generation.lineage.identityParent.objectId,fixture.seed.aliases.parent);assert.equal(image.generation.providerTaskId,"zero-paid-original-task");assert.deepEqual(image.generation.lineage,JSON.parse(Buffer.from(snapshot.intents[0].base64,"base64").toString()).draft.generation.lineage);
        const ack=result.wire.find(w=>w.method==="POST");assert.deepEqual(ack.durableAtAck.workspace.objects[image.id],image);assert.equal(ack.durableAtAck.images.find(i=>i.objectId===image.id).sha256,manifest.sha256);assert.equal(result.recovery.intents.length,0);
        await page.reload();await page.addScriptTag({content:bundled.outputFiles[0].text});const reopened=await page.evaluate(s=>window.l3.initialize(s),fixture.seed);assert.deepEqual(reopened.workspace.objects[image.id],image);assert.deepEqual(reopened.images.find(i=>i.objectId===image.id),fact);
      }
      await writeFile(resolve(output,name+"-result.json"),JSON.stringify(result,null,2));
    }
    verdict.cases.push({name,mode,status:"pass",intentSha256:snapshot.intents[0].sha256,requestBodySha256:snapshot.intents[0].requestBodySha256,draftSha256:snapshot.intents[0].draftSha256,recoveryCalls,paidGeneratePosts:0,error:error??null});
  }finally{if(context){const owner=context.extraOwner;await context.close();if(owner)await owner.close();}}
}
try{for(const mode of ["nativeReopen","rehydrate","missing","corrupt","hashMismatch","invalidBlob","pending"])await run(mode,mode);verdict.status="pass";}catch(e){verdict.status="failed";verdict.error=e.message;process.exitCode=1;}
await writeFile(resolve(output,"verdict.json"),JSON.stringify(verdict,null,2)+"\n");console.log(JSON.stringify({output,...verdict}));
