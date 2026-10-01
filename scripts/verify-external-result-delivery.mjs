// Local PGlite only. Loads the real Journal and P3 migrations; no DB URL/secrets/network.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
if (!process.argv[2]) throw new Error("Pass a local PGlite module path.");
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const actor = randomUUID(), other = randomUUID(), turn = randomUUID();
const hash = (s) => createHash("sha256").update(s).digest("hex");
const effect = (s) => `effect:${hash(s)}`;
let checks = 0;
const check = (condition, name) => { assert.ok(condition, name); checks++; };
const call = async (id, kind, operation, payload = {}, owner = actor) =>
  (await db.query("select public.operate_external_result($1::uuid,$2,$3,$4,$5::jsonb) as result",
    [owner,effect(id),kind,operation,JSON.stringify(payload)])).rows[0].result;
const register = async (id, kind = "image", frozenRequest = "{}", operation = "register") =>
  (await db.query("select public.operate_external_effect($1::uuid,$2,$3,$4,$5::jsonb) as result", [actor,effect(id),kind,operation,
    JSON.stringify({ frozenRequest, requestDigest: hash(frozenRequest), namespace: { provider: "grsai", baseUrl: "https://fake.test",
      credentialScope: hash("fake") }, attemptId: randomUUID(), ...(operation === "correction" ? { correction: "cacheCompatibility" } : {}) })])).rows[0].result;
const manifest = (id, kind, bytes) => ({ effectId:effect(id),resultId:`result:${hash(id)}`,version:1,kind,
  sha256:hash(bytes),byteLength:bytes.length,mimeType:kind==='image'?'image/png':'application/json',chunkCount:Math.ceil(bytes.length/524288) });
const prepare = async (id, kind, bytes, binding = null) => {
  const m = manifest(id,kind,bytes);
  await register(id,kind);
  const prepared = await call(id,kind,'prepare',{manifest:m,binding});
  check(!prepared.error, `${id} prepare`);
  return m;
};
const write = async (id, kind, m, bytes) => {
  for (let i=0;i<m.chunkCount;i++) check(!(await call(id,kind,'write',{resultId:m.resultId,index:i,
    base64:bytes.subarray(i*524288,(i+1)*524288).toString('base64')})).error,`${id} write ${i}`);
};
try {
  await db.exec(`create schema auth; create schema private;
    create role anon; create role authenticated; create role service_role;
    create table auth.users(id uuid primary key); insert into auth.users values('${actor}'),('${other}');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.app_user_access(user_id uuid primary key,status text);
    insert into public.app_user_access values('${actor}','active'),('${other}','active');`);
  const dir = new URL('../supabase/migrations/',import.meta.url);
  for (const name of ['20260729012105_add_agent_turn_journal.sql','20260729093000_add_agent_turn_external_actions.sql',
    '20260810025000_harden_agent_turn_admission.sql','20260812090000_harden_agent_tool_claim_settlement_boundary.sql',
    '20261001090000_add_external_effect_observation.sql']) await db.exec(await readFile(new URL(name,dir),'utf8'));
  const sql = await readFile(new URL((await readdir(dir)).find((n)=>n.endsWith('_add_external_result_delivery.sql')),dir),'utf8');
  await register('pre-p3b');
  check((await db.query('select frozen_request from public.external_effect_attempt where effect_id=$1',[effect('pre-p3b')])).rows[0].frozen_request==='{}','Existing P3A ordinary attempt has duplicated body');
  await db.exec(sql); await db.exec(sql);
  check((await db.query('select frozen_request from public.external_effect_attempt where effect_id=$1',[effect('pre-p3b')])).rows[0].frozen_request===null,'Forward migration removes exact ordinary duplicate');
  check((await db.query('select frozen_request from public.external_effect where effect_id=$1',[effect('pre-p3b')])).rows[0].frozen_request==='{}','Forward migration preserves exact logical input');
  const priv=(await db.query(`select has_table_privilege('authenticated','public.external_result','select') as read,
    has_function_privilege('authenticated','public.operate_external_result(uuid,text,text,text,jsonb)','execute') as write,
    has_function_privilege('service_role','public.operate_external_result(uuid,text,text,text,jsonb)','execute') as server`)).rows[0];
  check(!priv.read&&!priv.write&&priv.server,'Server-only tables/RPC');
  check((await call('old','image','read')).state==='absent','No fabricated legacy result');
  const bytes=Buffer.alloc(524289,97), m=await prepare('image','image',bytes);
  check((await call('image','image','publish',{resultId:m.resultId})).error==='result_incomplete','Incomplete never deliverable');
  await write('image','image',m,bytes);
  check((await call('image','image','publish',{resultId:m.resultId})).state==='available','Publish complete bytes');
  check((await call('image','image','publish',{resultId:m.resultId})).state==='available','Duplicate publish');
  check((await call('image','image','read',{},other)).state==='absent','Other owner cannot read');
  check((await call('image','image','ack',{resultId:m.resultId,version:1,sha256:hash('wrong')})).error==='result_ack_conflict','Wrong ACK rejected');
  for(let i=0;i<2;i++)check((await call('image','image','ack',{resultId:m.resultId,version:1,sha256:m.sha256})).acknowledged,'Idempotent ACK');
  check(Buffer.from((await call('image','image','chunk',{resultId:m.resultId,index:0})).base64,'base64').equals(bytes.subarray(0,524288)),'Same bytes redelivery');
  check((await db.query('select frozen_request from public.external_effect_attempt where effect_id=$1',[effect('image')])).rows[0].frozen_request===null,'Ordinary attempt references first body');
  await db.query(`update public.external_result set expires_at=now()-interval '1 second' where effect_id=$1`,[effect('image')]);
  check((await call('image','image','read')).state==='expired','Honest expired tombstone');
  check((await db.query('select count(*)::integer as n from public.external_result_chunk where effect_id=$1',[effect('image')])).rows[0].n===0,'Expired bytes erased');
  await db.query(`update public.external_effect set created_at=now()-interval '25 hours' where effect_id=$1`,[effect('image')]);
  check(!(await register('image')).executionGranted,'Expired input never grants execution');
  check((await db.query('select frozen_request,request_digest from public.external_effect where effect_id=$1',[effect('image')])).rows[0].frozen_request===null,'Expired raw erased, digest retained');
  // Real Request settlement + Tool claim publication in the same transaction as the result.
  await db.query(`insert into private.agent_turn_journal(server_turn_id,user_id,local_project_id,creation_idempotency_key,
    server_execution_status,latest_step_sequence,latest_request_id,latest_request_hash,provider_call_count)
    values($1,$2,'project','create','provider_running',1,'request',$3,1)`,[turn,actor,hash('request')]);
  await db.query(`insert into private.agent_turn_request_journal(server_turn_id,request_id,step_sequence,request_hash,
    execution_started_at,execution_expires_at) values($1,'request',1,$2,now(),now()+interval '15 minutes')`,[turn,hash('request')]);
  const text=Buffer.from(JSON.stringify({outputText:'hello',toolCalls:[]}));
  const binding={serverTurnId:turn,localProjectId:'project',requestId:'request',stepSequence:1,status:'awaitingNextRequest',
    claims:[{toolCallId:'call',actionKind:'image',claimHash:hash('claim'),maxActionCount:1}]};
  const tm=await prepare('text','text',text,binding);await write('text','text',tm,text);
  check((await call('text','text','publish',{resultId:tm.resultId})).state==='available','Text+claims atomic publish');
  check((await db.query('select count(*)::integer as n from private.agent_turn_external_action_claim where server_turn_id=$1',[turn])).rows[0].n===1,'Original Tool claim recorded');
  await call('text','text','publish',{resultId:tm.resultId});
  check((await db.query('select count(*)::integer as n from private.agent_turn_external_action_claim where server_turn_id=$1',[turn])).rows[0].n===1,'Redelivery cannot duplicate claims');
  // Partial Image recovery writes under the existing manifest/binding; no prepare or replacement.
  await db.query(`insert into private.agent_turn_external_action_journal(server_turn_id,request_id,step_sequence,
    action_id,action_kind,claim_call_id,action_hash,execution_expires_at)
    values($1,'request',1,'image-action','image','call',$2,now()+interval '15 minutes')`,[turn,hash('image-action')]);
  const ib={serverTurnId:turn,localProjectId:'project',requestId:'request',stepSequence:1,
    actionId:'image-action',actionHash:hash('image-action')};
  const im=await prepare('partial-bound','image',bytes,ib);
  const first={resultId:im.resultId,index:0,base64:bytes.subarray(0,524288).toString('base64')};
  check(!(await call('partial-bound','image','write',first)).error,'Stage first Image chunk');
  check((await call('partial-bound','image','publish',{resultId:im.resultId})).error==='result_incomplete','Partial bound Image unavailable');
  check((await call('partial-bound','image','write',{...first,base64:Buffer.alloc(524288,9).toString('base64')})).error==='result_chunk_conflict','Conflicting staged chunk cannot overwrite');
  await write('partial-bound','image',im,bytes);
  check((await call('partial-bound','image','publish',{resultId:im.resultId})).state==='available','Fill original bound escrow without prepare');
  check((await db.query('select binding from public.external_result where effect_id=$1',[effect('partial-bound')])).rows[0].binding.actionId==='image-action','Original A+ binding retained');
  check((await db.query("select execution_status from private.agent_turn_external_action_journal where server_turn_id=$1 and action_id='image-action'",[turn])).rows[0].execution_status==='externally_completed','Original action settled by recovered publication');
  await db.query("update public.external_result set expires_at=now()-interval '1 second' where effect_id=$1",[effect('partial-bound')]);
  check((await call('partial-bound','image','write',first)).state==='expired','Expired Image rejects retrieved bytes');
  check((await call('partial-bound','image','publish',{resultId:im.resultId})).state==='expired','Expired Image cannot republish');
  const summary=Buffer.from(JSON.stringify({summary:{threadGoal:'goal'},sourceBoundary:{sourceDigest:hash('messages')}}));
  const sm=await prepare('summary','compaction',summary);await write('summary','compaction',sm,summary);
  check((await call('summary','compaction','publish',{resultId:sm.resultId})).state==='available','Compaction result preserved');
  const corrupt=await prepare('corrupt','image',Buffer.from('good'));await write('corrupt','image',corrupt,Buffer.from('evil'));
  check((await call('corrupt','image','publish',{resultId:corrupt.resultId})).error==='result_incomplete','Hash corruption cannot publish');
  check((await call('summary','compaction','prepare',{manifest:{...sm,sha256:hash('new')},binding:null})).error==='result_identity_conflict','Same execution cannot replace result');
  // Capacity is reserved before paid submission, under the same per-owner advisory lock.
  let denied = false;
  for (let i=0;i<12;i++) {
    const registration=await register(`capacity-${i}`);
    if (registration.error==='result_capacity_exceeded') { check(!registration.executionGranted,'Capacity denial grants no POST'); denied=true; break; }
  }
  check(denied,'Per-owner result capacity blocks new admission');
  await db.exec(`update public.external_effect set created_at=now()-interval '25 hours';
    update public.external_result set expires_at=now()-interval '1 second'; select public.cleanup_external_result_payloads();`);
  check((await register('after-cleanup')).executionGranted,'Expired reservations release capacity');
  check((await db.query('select count(*)::integer as n from public.external_result_chunk')).rows[0].n===0,'Global maintenance erases idle expired results');
  check((await call('summary','compaction','ack',{resultId:sm.resultId,version:1,sha256:sm.sha256})).state==='expired','Expired ACK is not fabricated success');
  console.log(`P3B local SQL: ${checks} checks passed (actual migrations/RPC, no production).`);
} finally { await db.close(); }
