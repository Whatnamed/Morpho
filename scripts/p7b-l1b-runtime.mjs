// Bounded local L1b setup. No remote DB inputs and no production credentials.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const root = process.cwd();
export const ports = { db: 55432, rest: 55433, auth: 55434, gateway: 55435, app: 55436 };
export const baseUrl = `http://127.0.0.1:${ports.app}`;
export const controlledCompactionSummary = {
  threadGoal:"P7B controlled original Summary",establishedContext:["Continuous conversation"],
  decisionsAndReasons:[],activeWork:[],unresolvedQuestions:[],referencedObjects:[]
};
export const controlledCompactionText = "```json\n"+JSON.stringify({morphoConversationSummary:controlledCompactionSummary})+"\n```";
const origin = `http://127.0.0.1:${ports.gateway}`;

export async function startIsolatedBoundary(toolsPath, outputPath) {
  const tools = resolve(toolsPath);
  if (!tools.startsWith(resolve(root, "temp") + sep)) throw Error("Tools must be inside ignored temp/");
  const output = resolve(outputPath);
  if (!["p7b-l1b","p7b-l2","p7b-l3"].some(name=>output.startsWith(resolve(root,`output/playwright/${name}`) + sep))) throw Error("Unsafe run directory");
  await mkdir(output, { recursive: true });
  const { default: EmbeddedPostgres } = await import(pathToFileURL(resolve(tools, "node_modules/embedded-postgres/dist/index.js")));
  const password = randomBytes(24).toString("hex");
  const jwtSecret = randomBytes(32).toString("hex");
  const jwt = (role) => {
    const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ role, iss: "p7b-local", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+7200 })).toString("base64url");
    return `${head}.${body}.${createHmac("sha256", jwtSecret).update(`${head}.${body}`).digest("base64url")}`;
  };
  const keys = { anon: jwt("anon"), service: jwt("service_role") };
  // Whitelist machine essentials; never inherit .env or Provider credentials into native services.
  const nativeEnv = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "COMSPEC"].flatMap(k => process.env[k] ? [[k,process.env[k]]] : []));
  // Official Windows PostgREST dynamically loads libpq from the portable PostgreSQL bin.
  nativeEnv.PATH = resolve(tools,"node_modules/@embedded-postgres/windows-x64/native/bin") + ";" + (nativeEnv.PATH ?? "");
  const children = [];
  // Test-owned scheduling barrier: preserve real RPC bytes, delay only their delivery.
  const cancelResponseBarrier = { effectId: null, persisted: null, release: null };
  let db;
  let gateway;
  const pg = new EmbeddedPostgres({ databaseDir: resolve(output,"db"), user: "postgres", password, port: ports.db,
    authMethod: "scram-sha-256", persistent: true,
    initdbFlags: ["--locale=C", "--encoding=UTF8"],
    postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "max_connections=30"],
    onLog: () => {}, onError: () => {} });
  const redact = (text) => [password,jwtSecret,keys.anon,keys.service].reduce((s,v)=>s.replaceAll(v,"[redacted]"),String(text))
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,"[redacted-jwt]");
  const launch = (exe,args,env,cwd=tools) => {
    const child = spawn(exe,args,{ cwd, env:{...nativeEnv,...env}, windowsHide:true, stdio:["ignore","pipe","pipe"] });
    child.safeLog = ""; child.localExecutable = exe;
    for (const stream of [child.stdout,child.stderr]) stream.on("data",b=> { child.safeLog=(child.safeLog+redact(b)).slice(-8192); });
    child.on("error",err=>{ child.safeLog=redact(err.message); });
    children.push(child);
    return child;
  };
  const wait = async (url,child) => {
    for(let i=0;i<100;i++) {
      if(child.exitCode!==null) throw Error(`Isolated service exited (${child.localExecutable}, exit ${child.exitCode}): ${child.safeLog}`);
      try { const response=await fetch(url); if(response.ok) return; } catch {}
      await new Promise(r=>setTimeout(r,200));
    }
    throw Error(`Isolated readiness timeout: ${child.safeLog}`);
  };
  const stop = async () => {
    cancelResponseBarrier.release?.();
    if(gateway) await new Promise(r=>gateway.close(r));
    for(const child of children.reverse()) {
      if(child.exitCode===null) { child.kill(); await new Promise(r=>{ child.once("exit",r); setTimeout(r,2000); }); }
    }
    if(db) await db.end();
    await pg.stop().catch(()=>{});
  };
  try {
    await pg.initialise(); await pg.start();
    db=pg.getPgClient("postgres","127.0.0.1"); await db.connect();
    await db.query(`create role anon nologin; create role authenticated nologin;
      create role service_role nologin bypassrls;
      create role authenticator login noinherit password '${password}';
      grant anon,authenticated,service_role to authenticator;
      create schema auth; create schema extensions;
      create extension pgcrypto with schema extensions;
      grant usage on schema public,auth to anon,authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
          nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
      create function auth.role() returns text language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
          nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') $$;`);
    // Upstream embedded-FS migration discovery is not Windows portable. Apply the pinned
    // official Auth SQL once to this fresh cluster; expand only its Namespace template.
    const authMigrations=[];
    const authMigrationDir=resolve(tools,"node_modules/.l1b-native-tools/auth/migrations");
    for(const name of (await readdir(authMigrationDir)).filter(n=>n.endsWith(".up.sql")).sort()) {
      const source=await readFile(resolve(authMigrationDir,name),"utf8");
      const sql=source.replaceAll(/\{\{\s*index \.Options "Namespace"\s*\}\}/g,"auth");
      if(sql.includes("{{")) throw Error("Unexpected official Auth migration template");
      await db.query(sql);
      authMigrations.push({name,sha256:sha256(source.replaceAll("\r\n","\n"))});
    }
    const auth=launch(resolve(tools,"auth.exe"),["serve"],{
      GOTRUE_API_HOST:"127.0.0.1",PORT:String(ports.auth),GOTRUE_SITE_URL:baseUrl,
      API_EXTERNAL_URL:`${origin}/auth/v1`,GOTRUE_DB_DRIVER:"postgres",GOTRUE_DB_NAMESPACE:"auth",
      GOTRUE_DB_DATABASE_URL:`postgres://postgres:${password}@127.0.0.1:${ports.db}/postgres?sslmode=disable&search_path=auth,public,extensions`,
      GOTRUE_JWT_SECRET:jwtSecret,GOTRUE_JWT_AUD:"authenticated",GOTRUE_JWT_DEFAULT_GROUP_NAME:"authenticated",
      GOTRUE_JWT_ADMIN_ROLES:"service_role",GOTRUE_MAILER_AUTOCONFIRM:"true",GOTRUE_EXTERNAL_EMAIL_ENABLED:"true",
      GOTRUE_LOG_LEVEL:"warn"
    });
    await wait(`http://127.0.0.1:${ports.auth}/health`,auth);
    // Fresh test-owned cluster only. Every repository migration is applied once, in order.
    const migrations=[];
    for(const name of (await readdir("supabase/migrations")).filter(n=>n.endsWith(".sql")).sort()) {
      const sql=await readFile(resolve("supabase/migrations",name),"utf8");
      await db.query(sql);
      migrations.push({ name, sha256:sha256(sql.replaceAll("\r\n","\n")) });
    }
    const rest=launch(resolve(tools,"postgrest/postgrest.exe"),[],{
      PGRST_DB_URI:`postgres://authenticator:${password}@127.0.0.1:${ports.db}/postgres`,PGRST_DB_SCHEMAS:"public",
      PGRST_DB_ANON_ROLE:"anon",PGRST_JWT_SECRET:jwtSecret,PGRST_SERVER_HOST:"127.0.0.1",PGRST_SERVER_PORT:String(ports.rest),PGRST_LOG_LEVEL:"crit"
    });
    await wait(`http://127.0.0.1:${ports.rest}/`,rest);
    const stub={ calls:[], next:"complete", held:[] };
    const responseObject = (text) => ({ id:"resp-p7b-local",object:"response",status:"completed",
      output:[{type:"message",id:"msg-p7b-local",role:"assistant",status:"completed",content:[{type:"output_text",text,annotations:[]}]}],
      usage:{input_tokens:1,output_tokens:1,total_tokens:2} });
    const serveProvider = async (request,response) => {
      let body=""; for await(const chunk of request) body+=chunk;
      const payload=JSON.parse(body);
      const mode=stub.next;
      const call={id:randomUUID(),mode,bodySha256:sha256(body),bodyBytes:Buffer.byteLength(body)};
      stub.calls.push(call);
      if(mode==="unknown") { request.socket.destroy(); return; }
      if(mode==="held") { await new Promise(r=>stub.held.push(r)); }
      if(mode==="running-cancelled"||mode==="running-late-success") {
        call.providerOutcome="running";
        response.writeHead(200,{"Content-Type":"text/event-stream"});
        response.write(`event: response.in_progress\ndata: ${JSON.stringify({type:"response.in_progress",response:{id:"resp-p7b-local",status:"in_progress"}})}\n\n`);
        await new Promise(release=>{
          stub.held.push(release);
          response.once("close",()=>{
            if(mode==="running-cancelled"&&!response.writableEnded) { call.providerOutcome="cancelled"; release(); }
          });
        });
        if(call.providerOutcome==="cancelled") return;
        call.providerOutcome="succeeded";
      }
      const text=mode==="compaction" ? controlledCompactionText : "P7B controlled result";
      if(payload.stream) {
        if(!response.headersSent) response.writeHead(200,{"Content-Type":"text/event-stream"});
        response.end(`event: response.completed\ndata: ${JSON.stringify({type:"response.completed",response:responseObject(text)})}\n\n`);
      } else {
        response.writeHead(200,{"Content-Type":"application/json"});
        response.end(JSON.stringify(responseObject(text)));
      }
    };
    gateway=createServer((request,response)=>{
      if(request.url.startsWith("/provider/v1/responses")) { void serveProvider(request,response).catch(()=>response.destroy()); return; }
      const isAuth=request.url.startsWith("/auth/v1/");
      const isRest=request.url.startsWith("/rest/v1/");
      if(!isAuth&&!isRest) { response.writeHead(404); response.end(); return; }
      const path=request.url.slice(isAuth?8:8);
      void (async()=>{
        const body=[]; for await(const b of request) body.push(b);
        const headers={...request.headers}; delete headers.host; delete headers.connection; delete headers["content-length"];
        const upstream=await fetch(`http://127.0.0.1:${isAuth?ports.auth:ports.rest}${path}`,{
          method:request.method,headers,...(["GET","HEAD"].includes(request.method)?{}:{body:Buffer.concat(body)}) });
        const bytes=Buffer.from(await upstream.arrayBuffer());
        if(isRest&&path==="/rpc/operate_external_effect"&&cancelResponseBarrier.effectId) {
          const rpc=JSON.parse(Buffer.concat(body).toString("utf8"));
          if(rpc.p_operation==="cancel"&&rpc.p_effect_id===cancelResponseBarrier.effectId) {
            cancelResponseBarrier.persisted={status:upstream.status,data:JSON.parse(bytes.toString("utf8")),effectId:rpc.p_effect_id};
            await new Promise(release=>{ cancelResponseBarrier.release=release; });
          }
        }
        response.writeHead(upstream.status,Object.fromEntries([...upstream.headers].filter(([k])=>!["content-encoding","content-length","transfer-encoding"].includes(k))));
        response.end(bytes);
      })().catch(()=>{ response.writeHead(502); response.end(); });
    });
    await new Promise((r,j)=>{ gateway.once("error",j); gateway.listen(ports.gateway,"127.0.0.1",r); });
    const appEnv={ ...nativeEnv, NODE_ENV:"production", MORPHO_AUTH_REQUIRED:"true",
      NEXT_PUBLIC_SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:keys.anon,SUPABASE_SECRET_KEY:keys.service,
      MORPHO_AI_PROVIDER:"aijws",MORPHO_AI_BASE_URL:`${origin}/provider/v1`,MORPHO_AI_API_KEY:"p7b-stub-only",
      MORPHO_AI_MODEL:"p7b-controlled",MORPHO_AI_WEB_SEARCH_ENABLED:"false",MORPHO_AI_REASONING_EFFORT:"",
      MORPHO_GRS_API_KEY:"",MORPHO_GRS_BASE_URL:`${origin}/blocked-image`,MORPHO_GRS_FALLBACK_BASE_URLS:"",
      AIJWS_API_KEY:"",AIJWS_BASE_URL:"",AIJWS_MODEL:"",GRSAI_API_KEY:"",OPENAI_API_KEY:"",
      NEXT_PUBLIC_TLDRAW_LICENSE_KEY:""
    };
    const facts={ environment:"local Windows x64; fresh isolated TCP PostgreSQL + real PostgREST + source-built Supabase Auth",
      databaseIdentity:randomUUID(),ports,migrations,authMigrations,
      postgresVersion:(await db.query("select version() as version")).rows[0].version,
      authVersion:"v2.197.0",authSource:"4eee58f296d9698a1c2c0ae14d7a0b379c7622d3",
      authPlatformShim:"cmd/serve_cmd.go: single net.ListenConfig; Unix SO_REUSEPORT only removed, no auth logic changes",
      postgrestVersion:"v16.4",remoteDatabaseAccess:false };
    await writeFile(resolve(output,"environment.json"),JSON.stringify(facts,null,2)+"\n");
    return { db,keys,origin,appEnv,stub,cancelResponseBarrier,facts,stop,launch,wait,output,
      serviceDiagnostics:()=>children.map(c=>({executable:c.localExecutable,exitCode:c.exitCode,log:c.safeLog})) };
  } catch(error) {
    await writeFile(resolve(output,"setup-failure.json"),JSON.stringify({verdict:"invalid_run",phase:"isolated setup",error:redact(error.message),
      children:children.map(c=>({executable:c.localExecutable,exitCode:c.exitCode,log:c.safeLog}))},null,2)+"\n");
    await stop(); throw Error(redact(error.message));
  }
}
