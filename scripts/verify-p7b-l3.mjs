import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile,writeFile,mkdir,open } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServerClient } from "@supabase/ssr";
import { startIsolatedBoundary,baseUrl,ports } from "./p7b-l1b-runtime.mjs";
import { readBuildProvenance } from "./build-provenance.mjs";
import { buildL3Fixture,hash } from "./p7b-l3-fixture.mjs";
const git=args=>execFileSync("git",args,{encoding:"utf8"}).trim(),preflight=process.argv.includes("--preflight"),freeze=process.argv.includes("--freeze-fixture"),root=process.cwd();
if(!freeze&&git(["status","--porcelain","--untracked-files=no"]))throw Error("Clean tracked source required");
const runId=new Date().toISOString().replaceAll(":","-")+"-"+process.pid+(preflight?"-preflight":""),output=resolve("output/playwright/p7b-l3",runId);await mkdir(output,{recursive:true});
const save=(n,v)=>writeFile(resolve(output,n),JSON.stringify(v,null,2)+"\n");
const manifestPath="e2e/eval/p7b-l3-postfix-manifest.json",manifestBytes=await readFile(manifestPath),manifest=JSON.parse(manifestBytes);
const originalLedger=await readFile(resolve("output/playwright/p7b-l3",manifest.historical.runId,"paid-ledger.json"));assert.equal(hash(originalLedger),manifest.historical.ledgerSha256,"Historical paid ledger changed");
const metadata=await buildL3Fixture(output),fixture=JSON.parse(await readFile(resolve(output,"fixture.json")));
if(freeze){await writeFile("e2e/eval/p7b-l3-fixture-lock.json",JSON.stringify(metadata,null,2)+"\n");console.log(JSON.stringify({output,fixtureHash:metadata.bundleSha256,attempts:metadata.attempts.length,source:metadata.sourceAsset}));process.exit(0);}
assert.equal(metadata.bundleSha256,JSON.parse(await readFile("e2e/eval/p7b-l3-fixture-lock.json")).bundleSha256,"Frozen fixture changed");
nextEnv.loadEnvConfig(root);const imageKey=process.env.MORPHO_GRS_API_KEY;if(!imageKey)throw Error("Image credential missing / zero paid");
assert.equal(process.env.MORPHO_GRS_BASE_URL,manifest.provider.baseUrl);assert.equal(process.env.MORPHO_GRS_DEFAULT_MODEL,manifest.provider.model);
const bundle=await build({entryPoints:[resolve("scripts/p7b-l3-browser-entry.ts")],bundle:true,write:false,platform:"browser",format:"iife",alias:{"@":resolve("src")},tsconfig:resolve("tsconfig.json")});
await writeFile(resolve(output,"browser-host.js"),bundle.outputFiles[0].contents);
const run={version:manifest.version,runId,sourceSha:git(["rev-parse","HEAD"]),manifestSha256:hash(manifestBytes),fixtureSha256:metadata.bundleSha256,manifest,mode:preflight?"zero-paid final production wire":"real L3 smoke",attempts:[],hardBlocker:null,status:"invalid_run",textPaid:0,productionWrites:0};
let runtime,browser,server;
try{
  runtime=await startIsolatedBoundary("temp/p7b-l1b-tools",output);run.environment=runtime.facts;
  const buildProcess=runtime.launch(process.execPath,[resolve("scripts/build-production.mjs"),"--strict"],runtime.appEnv,root),code=await new Promise(r=>buildProcess.once("exit",r));await writeFile(resolve(output,"build.log"),buildProcess.safeLog);assert.equal(code,0,"Clean production build failed");
  run.build=await readBuildProvenance();assert.equal(run.build.sourceSha,run.sourceSha);assert.equal(run.build.isDirty,false);await save("run-manifest.json",{...run,freezeTime:new Date().toISOString(),attemptOrder:fixture.attempts.map(a=>a.key)});
  server=runtime.launch(process.execPath,[resolve("node_modules/next/dist/bin/next"),"start","-p",String(ports.app),"-H","127.0.0.1"],{
    ...runtime.appEnv,MORPHO_GRS_API_KEY:imageKey,MORPHO_GRS_BASE_URL:manifest.provider.baseUrl,MORPHO_GRS_FALLBACK_BASE_URLS:manifest.provider.fallbackBaseUrls.join(","),MORPHO_GRS_DEFAULT_MODEL:manifest.provider.model,MORPHO_GRS_IMAGE_HOST_ALLOWLIST:manifest.provider.imageHostAllowlist.join(","),
    MORPHO_L3_OUTPUT:output,MORPHO_L3_MANIFEST:resolve(manifestPath),MORPHO_L3_NO_PAID:String(preflight),NODE_OPTIONS:`--require ${resolve("scripts/p7b-l3-wire-guard.cjs")}`,
    MORPHO_BUILD_SOURCE_SHA:run.sourceSha,MORPHO_BUILD_ID:run.build.buildId,MORPHO_BUILD_SOURCE_TREE_SHA256:run.build.sourceTreeSha256,MORPHO_BUILD_ARTIFACT_SHA256:run.build.artifactSha256,MORPHO_BUILD_IS_DIRTY:"false"
  },root);await runtime.wait(`${baseUrl}/login`,server);
  let cookies=[];const auth=createServerClient(runtime.origin,runtime.keys.anon,{cookies:{getAll:()=>cookies,setAll:u=>{cookies=u;}}});
  const signed=await auth.auth.signUp({email:`l3-${randomUUID()}@example.test`,password:randomUUID()+"Aa1!"});if(signed.error||!signed.data.session)throw Error("Isolated Auth unavailable");
  const userId=signed.data.user.id;await runtime.db.query("update public.app_user_access set status='active' where user_id=$1",[userId]);
  for(const attempt of(preflight?fixture.attempts.slice(0,1):fixture.attempts)){
    const row={key:attempt.key,status:"running"};run.attempts.push(row);await save("active-attempt.json",{key:attempt.key});
    const profile=resolve(output,attempt.key+"-profile"),context=await chromium.launchPersistentContext(profile,{headless:true});await context.addCookies(cookies.map(c=>({...c,url:baseUrl,sameSite:"Lax"})));
    await context.exposeFunction("l3CaptureBeforeEgress",async capture=>{
      const file=await open(resolve(output,`${attempt.key}-intent-before-post.json`),"wx");try{await file.writeFile(JSON.stringify(capture,null,2)+"\n");await file.sync();}finally{await file.close();}
    });
    const page=await context.newPage();await context.route(`${baseUrl}/eval-l3-host`,r=>r.fulfill({contentType:"text/html",body:"<!doctype html><title>L3 isolated execution host</title>"}));
    try{
      await page.goto(`${baseUrl}/eval-l3-host`);await page.addScriptTag({content:bundle.outputFiles[0].text});
      const initial=await page.evaluate(seed=>window.l3.initialize(seed),fixture.seed);await save(`${attempt.key}-before.json`,initial);
      const started=Date.now(),facts=await page.evaluate(({attempt,aliases})=>window.l3.execute(attempt,aliases),{attempt,aliases:fixture.seed.aliases});row.latencyMs=Date.now()-started;await save(`${attempt.key}-after.json`,facts);
      const captured=JSON.parse(await readFile(resolve(output,`${attempt.key}-intent-before-post.json`)));assert.equal(captured.intents.length,1,"Original intent capture missing");row.intent={...captured.intents[0],base64:undefined};
      const effects=(await runtime.db.query("select * from public.external_effect where actor_user_id=$1",[userId])).rows,attempts=(await runtime.db.query("select * from public.external_effect_attempt where actor_user_id=$1",[userId])).rows,observations=(await runtime.db.query("select * from public.external_effect_observation where actor_user_id=$1",[userId])).rows,results=(await runtime.db.query("select effect_id,manifest,binding,published_at,acknowledged_at from public.external_result where actor_user_id=$1",[userId])).rows;
      await save(`${attempt.key}-journal.json`,{effects,attempts,observations,results});
      const block=await readFile(resolve(output,"hard-blocker.json"),"utf8").then(JSON.parse).catch(e=>{if(e.code!=="ENOENT")throw e;return null;});if(block)throw Object.assign(Error(block.reason),{block});
      const posts=facts.wire.filter(w=>w.method==="POST"&&w.url==="/api/ai/image");assert.equal(posts.length,1,"Duplicate local image POST");const request=JSON.parse(posts[0].body);
      assert.deepEqual(request.referenceObjectIds,[fixture.seed.aliases.parent]);assert.deepEqual(request.images.map(data=>hash(Buffer.from(data.split(",")[1],"base64"))),[metadata.sourceAsset.contentHash]);assert.equal(request.prompt,attempt.plan.items[0].prompt);
      const generated=Object.values(facts.workspace.objects).filter(o=>o.type==="image"&&!initial.workspace.objects[o.id]);
      row.clientRequestId=request.clientRequestId;row.effectId="effect:"+hash(JSON.stringify(["image",request.clientRequestId]));row.error=facts.error??null;row.operationStates=Object.values(facts.workspace.operations).filter(o=>!initial.workspace.operations[o.id]);
      const originalBlob=Buffer.from(captured.intents[0].base64,"base64"),originalIntent=JSON.parse(originalBlob.toString("utf8"));assert.equal(originalBlob.length,captured.intents[0].byteLength);assert.equal(hash(originalBlob),captured.intents[0].sha256);assert.equal(originalIntent.effectId,row.effectId);assert.equal(originalIntent.requestBody,posts[0].body);assert.equal(hash(originalIntent.requestBody),captured.intents[0].requestBodySha256);assert.equal(hash(JSON.stringify(originalIntent.draft)),captured.intents[0].draftSha256);assert.equal(originalIntent.draft.operationId,request.operationId);assert.equal(originalIntent.draft.generation.clientRequestId,request.clientRequestId);
      assert.equal(facts.workspace.workingState.currentDefaultReferenceId,initial.workspace.workingState.currentDefaultReferenceId);
      assert.deepEqual(facts.workspace.decisionRecords,initial.workspace.decisionRecords);
      for(const [id,o]of Object.entries(initial.workspace.objects))assert.deepEqual(facts.workspace.objects[id],o,"Source object overwritten");
      for(const a of initial.images)assert.deepEqual(facts.images.find(n=>n.objectId===a.objectId),a,"Source pixel/asset overwritten");
      if(preflight){assert.equal(generated.length,0);row.status="zero-paid final wire pass";continue;}
      const journalEffect=effects.find(e=>e.effect_id===row.effectId),effectAttempts=attempts.filter(a=>a.effect_id===row.effectId);assert.ok(journalEffect);assert.equal(effectAttempts.length,1,"Repeated paid effect attempt");
      const finalWire=JSON.parse(await readFile(resolve(output,`${attempt.key}-provider-request.json`)));assert.equal(journalEffect.request_digest,finalWire.bodySha256);row.requestDigest=finalWire.bodySha256;const rawProvider=JSON.parse(await readFile(resolve(output,`${attempt.key}-provider-response.json`)));row.providerReceipt=rawProvider;row.journalAttemptId=effectAttempts[0].attempt_id;row.journalTaskId=effectAttempts[0].provider_task_id;
      if(facts.error){
        const effectState=journalEffect.execution_state;assert.ok(["failed","rejected","cancelled"].includes(effectState),"Ambiguous/undelivered image execution");assert.equal(generated.length,0);row.status="Provider failed / valid attempt";await page.reload();await page.addScriptTag({content:bundle.outputFiles[0].text});const reopened=await page.evaluate(seed=>window.l3.initialize(seed),fixture.seed);await save(`${attempt.key}-reopen.json`,reopened);continue;
      }
      assert.equal(generated.length,1,"Success must create one new object");const image=generated[0],asset=facts.workspace.assets[image.assetId],pixel=facts.images.find(a=>a.objectId===image.id);assert.ok(!initial.workspace.assets[asset.id]);
      assert.equal(image.generation.lineage.identityParent.objectId,fixture.seed.aliases.parent);assert.equal(image.directionId,fixture.seed.aliases.direction);assert.equal(image.visualBranchId,fixture.seed.aliases.branch);
      assert.deepEqual(image.generation.lineage,request.visualLineage);assert.deepEqual(image.generation.providerInputs,request.visualProviderInputs);
      // Product pixelHash binds the exact data URL; decoded bytes were independently checked above.
      const frozenDataUrl="data:"+metadata.sourceAsset.mimeType+";base64,"+(await readFile(resolve("public",metadata.sourceAsset.publicPath.slice(1)))).toString("base64");
      assert.deepEqual(image.generation.providerInputs.references.filter(r=>r.status==="sent").map(r=>({id:r.source.objectId,hash:r.pixelHash,role:r.role,index:r.payloadIndex})),[{id:fixture.seed.aliases.parent,hash:hash(frozenDataUrl),role:"identity",index:0}]);
      assert.deepEqual(facts.workspace.relations.filter(r=>r.kind==="version"&&r.toObjectId===image.id).map(r=>r.fromObjectId),[fixture.seed.aliases.parent]);
      const delivery=image.generation.delivery;assert.equal(pixel.sha256,delivery.sha256);assert.ok(pixel.width>0&&pixel.height>0);assert.equal(pixel.bytes,delivery.byteLength);
      const ack=facts.wire.filter(w=>w.method==="POST"&&w.url.includes("/result?"));assert.equal(ack.length,1);assert.equal(ack[0].status,200);assert.deepEqual(ack[0].durableAtAck.workspace.objects[image.id],image);assert.equal(ack[0].durableAtAck.images.find(a=>a.objectId===image.id).sha256,delivery.sha256);
      assert.ok(results.find(r=>r.effect_id===row.effectId)?.acknowledged_at,"Server ACK not durable");
      const exported=await page.evaluate(key=>window.l3.exportImage(key),asset.storageKey),bytes=Buffer.from(exported.base64,"base64");assert.equal(hash(bytes),pixel.sha256);const artifact=`${attempt.key}-result.${exported.mimeType.includes("png")?"png":"jpg"}`;await writeFile(resolve(output,artifact),bytes);
      await page.reload();await page.addScriptTag({content:bundle.outputFiles[0].text});const reopened=await page.evaluate(seed=>window.l3.initialize(seed),fixture.seed);await save(`${attempt.key}-reopen.json`,reopened);
      assert.deepEqual(reopened.workspace.objects[image.id],image);assert.deepEqual(reopened.images.find(a=>a.objectId===image.id),pixel);
      row.status="success / automatic gates pass / visual grading pending";row.objectId=image.id;row.assetId=asset.id;row.providerTaskId=image.generation.providerTaskId;row.resultId=delivery.resultId;row.pixel=pixel;row.artifact=artifact;
    }catch(e){row.status="hard blocker";row.error=e.message;run.hardBlocker=e.block??{id:"P7B-3-D3",key:attempt.key,reason:e.message};throw e;}
    finally{await save(`${attempt.key}-attempt.json`,row);await save("progress.json",run);await context.close();}
    const reopenedContext=await chromium.launchPersistentContext(profile,{headless:true});try{const reopenedPage=await reopenedContext.newPage();await reopenedContext.route(`${baseUrl}/eval-l3-host`,r=>r.fulfill({contentType:"text/html",body:"<!doctype html>"}));await reopenedPage.goto(`${baseUrl}/eval-l3-host`);await reopenedPage.addScriptTag({content:bundle.outputFiles[0].text});const reopened=await reopenedPage.evaluate(seed=>window.l3.initialize(seed),fixture.seed);await save(`${attempt.key}-browser-reopen.json`,reopened);if(row.objectId){assert.equal(reopened.images.find(i=>i.objectId===row.objectId).sha256,row.pixel.sha256);const after=JSON.parse(await readFile(resolve(output,`${attempt.key}-after.json`)));assert.deepEqual(reopened.workspace.objects[row.objectId],after.workspace.objects[row.objectId]);}row.browserReopen="pass";await save(`${attempt.key}-attempt.json`,row);}finally{await reopenedContext.close();}
  }
  run.status=preflight?"zero-paid preflight complete":"L3 execution complete / visual grading pending";
}catch(e){run.status="hard blocker / stopped";run.hardBlocker??={id:"P7B-3-D3",reason:e.message};}
finally{
  if(browser)await browser.close();if(server)await writeFile(resolve(output,"server.log"),server.safeLog.replaceAll(imageKey,"[redacted]"));if(runtime)await runtime.stop();
  run.ledger=await readFile(resolve(output,"paid-ledger.json"),"utf8").then(JSON.parse).catch(()=>null);await save("verdict.json",run);console.log(JSON.stringify({output,source:run.sourceSha,status:run.status,attempts:run.attempts.map(({key,status,artifact,error})=>({key,status,artifact,error})),ledger:run.ledger,blocker:run.hardBlocker}));
}process.exitCode=run.hardBlocker?1:0;
