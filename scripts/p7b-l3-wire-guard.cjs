// Eval-only real image egress recorder: durable count before each paid POST, no retries.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=process.env.MORPHO_L3_OUTPUT,manifest=JSON.parse(fs.readFileSync(process.env.MORPHO_L3_MANIFEST,"utf8")),fixture=JSON.parse(fs.readFileSync(path.join(root,"fixture.json"),"utf8"));
const sha=b=>crypto.createHash("sha256").update(b).digest("hex"),native=globalThis.fetch;
const downloads=new Map();
function allowedDownload(url){return url.protocol==="https:"&&!url.username&&!url.password&&(!url.port||url.port==="443")&&(
  manifest.provider.imageHostAllowlist.includes(url.hostname)||(manifest.provider.imageHostAllowlist.includes("file*.aitohumanize.com")&&/^file[0-9]+\.aitohumanize\.com$/.test(url.hostname))||[manifest.provider.baseUrl,...manifest.provider.fallbackBaseUrls].some(b=>new URL(b).hostname===url.hostname));}
function rememberResults(key,raw){let value;try{value=JSON.parse(raw);}catch{return;}const found=downloads.get(key)??new Set();function visit(v){if(typeof v==="string"&&v.startsWith("https://")){try{const u=new URL(v);if(allowedDownload(u))found.add(u.href);}catch{}}else if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==="object")Object.values(v).forEach(visit);}visit(value);downloads.set(key,found);}
let ledger={paidSubmissions:manifest.historical?.paidSubmissions??0,estimatedCostCny:manifest.historical?.estimatedCostCny??0,textRequests:0,baselineSubmissions:0,attempts:[...(manifest.historical?.attempts??[])]};
if(process.env.MORPHO_L3_LEDGER_SEED){ledger=JSON.parse(fs.readFileSync(process.env.MORPHO_L3_LEDGER_SEED,"utf8"));if(ledger.paidSubmissions!==2||ledger.baselineSubmissions!==1||ledger.estimatedCostCny!==0.06||ledger.attempts.length!==2)throw Error("Invalid D3 continuation ledger seed");}
function write(name,value){const target=path.join(root,name),temp=target+".tmp",fd=fs.openSync(temp,"w");try{fs.writeFileSync(fd,typeof value==="string"?value:JSON.stringify(value,null,2)+"\n");fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,target);}
write("paid-ledger.json",ledger);
function hard(reason,detail={}){if(!fs.existsSync(path.join(root,"hard-blocker.json")))write("hard-blocker.json",{id:process.env.MORPHO_L3_LEDGER_SEED?"P7B-3-D4":manifest.historical?"P7B-3-D3":"P7B-3-D1",reason,...detail,ledger});throw Error("L3 hard stop: "+reason);}
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url),method=init?.method??"GET";
  if(["127.0.0.1","localhost","[::1]"].includes(url.hostname))return native(input,init);
  const current=JSON.parse(fs.readFileSync(path.join(root,"active-attempt.json"),"utf8"));
  if(method==="GET"&&allowedDownload(url)&&downloads.get(current.key)?.has(url.href)){
    const response=await native(input,init);write(`${current.key}-download-${Date.now()}.json`,{url:url.href,status:response.status,contentType:response.headers.get("content-type"),declaredBytes:response.headers.get("content-length"),location:response.headers.get("location")});
    const location=response.headers.get("location");if([301,302,303,307,308].includes(response.status)&&location){const redirected=new URL(location,url);if(allowedDownload(redirected))downloads.get(current.key).add(redirected.href);}return response;
  }
  const provider=[manifest.provider.baseUrl,...manifest.provider.fallbackBaseUrls].map(b=>new URL(b).origin).includes(url.origin);
  if(provider&&url.pathname==="/v1/api/result"&&method==="GET"){
    const active=JSON.parse(fs.readFileSync(path.join(root,"active-attempt.json"),"utf8"));
    const response=await native(input,init),raw=await response.clone().text();write(`${active.key}-poll-${Date.now()}.json`,{url:url.href,status:response.status,raw});rememberResults(active.key,raw);return response;
  }
  if(!provider||url.pathname!=="/v1/api/generate"||method!=="POST")return hard("Unexpected external route / real Text or search egress",{endpoint:url.origin+url.pathname,method});
  if(fs.existsSync(path.join(root,"hard-blocker.json")))throw Error("L3 run already stopped");
  const active=JSON.parse(fs.readFileSync(path.join(root,"active-attempt.json"),"utf8")),attempt=fixture.attempts.find(a=>a.key===active.key),body=JSON.parse(String(init.body));
  if(!attempt)return hard("Unregistered image attempt");
  const references=(body.images??[]).map(data=>sha(Buffer.from(data.split(",")[1]??"","base64")));
  const expected=fixture.assets.find(a=>a.assetId===JSON.parse(fixture.seed.workspaceValue).objects[fixture.seed.aliases.parent].assetId).contentHash;
  if(JSON.stringify(references)!==JSON.stringify([expected]))return hard("Actual Provider reference pixels violate frozen authority",{references,expected});
  if(body.model!==manifest.provider.model||body.aspectRatio!==manifest.provider.providerAspectRatio||body.replyType!=="json"||body.imageSize||body.quality||body.seed)return hard("Image Provider config drift");
  if(body.prompt!==attempt.plan.items[0].prompt)return hard("Final production prompt differs from frozen compiled visual plan",{expectedPromptHash:sha(attempt.plan.items[0].prompt),actualPromptHash:sha(body.prompt)});
  const record={key:active.key,url:url.href,body,bodySha256:sha(String(init.body)),referencePixelHashes:references,startedAt:new Date().toISOString()};
  write(`${active.key}-provider-request.json`,record);
  if(process.env.MORPHO_L3_NO_PAID==="true"){write("preflight-wire.json",{...record,paidEgress:false});return Response.json({error:"Eval zero-paid interception after exact final image wire capture"},{status:400});}
  if(ledger.attempts.some(a=>a.key===active.key))return hard("Duplicate paid effect for one registered attempt");
  if(ledger.paidSubmissions>=manifest.budget.paidSubmissions||ledger.baselineSubmissions>=(manifest.budget.baselineSubmissions??manifest.budget.paidSubmissions)||ledger.estimatedCostCny+manifest.pricing.cnyPerSubmission>manifest.budget.directEstimatedCostCny+1e-12)return hard("Paid submission / money ceiling reached");
  ledger.paidSubmissions++;ledger.baselineSubmissions++;ledger.estimatedCostCny+=manifest.pricing.cnyPerSubmission;ledger.attempts.push({key:active.key,bodySha256:record.bodySha256,status:"sent / outcome unknown"});write("paid-ledger.json",ledger);
  let response;try{response=await native(input,init);}catch(e){return hard("Ambiguous image Provider transport; no new paid request",{key:active.key,error:e.message});}
  let raw;try{raw=await response.clone().text();}catch(e){return hard("Original Provider result metadata lost; no retry",{key:active.key,error:e.message});}
  write(`${active.key}-provider-response.json`,{status:response.status,contentType:response.headers.get("content-type"),raw});
  rememberResults(active.key,raw);
  ledger.attempts.at(-1).status="response metadata captured";ledger.attempts.at(-1).httpStatus=response.status;write("paid-ledger.json",ledger);return response;
};
