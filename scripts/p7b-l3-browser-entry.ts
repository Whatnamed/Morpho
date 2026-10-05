// Eval host ports around production visual execution and production local persistence.
import { executeWorkspaceVisualGenerationPlan } from "@/features/workspace/workspaceVisualGenerationExecution";
import { resumeIndependentImageDeliveries } from "@/features/workspace/independentImageDelivery";
import { captureRecoveryState, rehydrateRecoveryCapture, verifyStoredRecovery, type RecoveryCapture } from "./p7b-l3-recovery-capture";
import { createWorkspacePersistenceController } from "@/features/workspace/workspacePersistence";
import { persistProjectWorkspaceAndSummary } from "@/infrastructure/persistence/localProjectStore";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import { saveBlobAsLocalAsset,readImageBlobDimensions } from "@/infrastructure/assets/localAssetWorkflow";
import { resolveGenerationSettings } from "@/features/workspace/imageGenerationSettings";
import { parseWorkspace } from "@/domain/morpho/workspace";
import { hashProviderImageDataUrl } from "@/domain/morpho/providerInputSnapshot";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import type { VisualGenerationPlan } from "@/domain/operations/types";
import type { WorkspaceVisualGenerationExecutionPorts } from "@/features/workspace/workspaceVisualGenerationExecution";

type Seed={workspaceKey:string;workspaceValue:string;catalogKey:string;catalogValue:string;assets:Array<{publicPath:string;runtimeStorageKey:string;contentHash:string}>};
const bytesHash=async(b:Blob)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",await b.arrayBuffer()))].map(n=>n.toString(16).padStart(2,"0")).join("");
let workspace:MorphoWorkspace,seed:Seed;
let flushBeforeCapture: (() => void) | undefined;
const wire:Array<{url:string;method:string;body?:string;status?:number;response?:string;durableAtAck?:unknown}> = [];
async function imageFacts(ws:MorphoWorkspace){
  const facts=[];for(const o of Object.values(ws.objects).filter(o=>o.type==="image"&&o.assetId)){
    if(o.type!=="image"||!o.assetId)continue;const a=ws.assets[o.assetId],b=await indexedDbBlobStore.get(a.storageKey);
    facts.push({objectId:o.id,assetId:a.id,storageKey:a.storageKey,sha256:b?await bytesHash(b):null,bytes:b?.size,width:a.width,height:a.height});
  }return facts;
}
const productionFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  const row:{url:string;method:string;body?:string;status?:number;response?:string;durableAtAck?:unknown}={url,method:init?.method??"GET",body:init?.body?String(init.body):undefined};wire.push(row);
  if(row.method==="POST"&&url==="/api/ai/image"){
    flushBeforeCapture?.();
    const snapshot=await captureRecoveryState(seed);
    if(snapshot.intents.length!==1)throw Error("Paid attempt lacks complete original intent");
    const sink=(window as unknown as {l3CaptureBeforeEgress?:(capture:RecoveryCapture)=>Promise<void>}).l3CaptureBeforeEgress;
    if(!sink)throw Error("Eval durable intent export sink unavailable");
    await sink(snapshot); // Node fsync of original bytes must complete before handing POST to Fetch.
  }
  if(row.method==="POST"&&url.includes("/result?")){
    const durable=JSON.parse(localStorage.getItem(seed.workspaceKey)!);row.durableAtAck={workspace:durable,images:await imageFacts(durable),intentIndex:Object.entries(localStorage).filter(([k])=>k.startsWith("morpho.independent-image-delivery.v1."))};
  }
  const r=await fetch(input,init);row.status=r.status;
  if(r.headers.get("content-type")?.includes("json"))row.response=await r.clone().text();return r;
};

async function initialize(next:Seed){
  seed=next;if(!localStorage.getItem(seed.workspaceKey)){localStorage.setItem(seed.catalogKey,seed.catalogValue);localStorage.setItem(seed.workspaceKey,seed.workspaceValue);}
  const parsed=parseWorkspace(localStorage.getItem(seed.workspaceKey)!);if(parsed.status!=="ok")throw Error(parsed.reason);workspace=parsed.workspace;
  for(const a of seed.assets){let blob=await indexedDbBlobStore.get(a.runtimeStorageKey);if(!blob){blob=await(await fetch(a.publicPath)).blob();await indexedDbBlobStore.put(a.runtimeStorageKey,blob);}if(await bytesHash(blob)!==a.contentHash)throw Error("Reference pixel hash mismatch");}
  return{workspace:JSON.parse(JSON.stringify(workspace)),images:await imageFacts(workspace)};
}

function executionPorts(){
  const session={projectId:workspace.project.id,workspaceReady:true,generation:Symbol("L3 isolated session")};
  const controller=createWorkspacePersistenceController({writer:w=>persistProjectWorkspaceAndSummary(localStorage,w)});
  const events:unknown[]=[];
  const ports:WorkspaceVisualGenerationExecutionPorts={fetch:productionFetch,getCurrentSession:()=>session,assertCurrentSession:s=>{if(s!==session)throw Error("Stale Eval session");},
    commitWorkspace:(_s,transform)=>{const result=transform(workspace);workspace=result.workspace;controller.schedule(workspace);return result.value;},
    persistWorkspace:()=>controller.flush(),updatePendingImageGenerationSlots:()=>{},setImageTaskStatus:(_s,status)=>events.push(status),
    saveGeneratedAsset:file=>saveBlobAsLocalAsset(indexedDbBlobStore,file,"aiGeneratedImage",{readImageDimensions:readImageBlobDimensions}),
    deleteAsset:key=>indexedDbBlobStore.delete(key),readReferenceAsset:key=>indexedDbBlobStore.get(key),selectObjects:()=>{},focusObject:()=>{},now:Date.now,randomSuffix:()=>crypto.randomUUID().slice(0,8)};
  flushBeforeCapture=()=>{const saved=controller.flush();if(saved.phase!=="saved"||saved.isDirty)throw Error("Eval operation checkpoint not durable");};
  return {controller,events,ports};
}
async function execute(attempt:{user:string;plan:VisualGenerationPlan},aliases:{parent:string}){
  wire.length=0;const {controller,events,ports}=executionPorts();
  let result,error;try{result=await executeWorkspaceVisualGenerationPlan({workspaceSnapshot:workspace,draft:attempt.user,plan:attempt.plan,sourceObjectIds:[aliases.parent],selectedDirectionIds:[],selectedImageIds:[aliases.parent],requestedPreviewCount:1,signal:new AbortController().signal},resolveGenerationSettings({modelId:"gpt-image-2",aspectRatio:"1:1",sizeOption:"1K"}),ports);}catch(e){error=e instanceof Error?e.message:String(e);}
  const persistence=controller.flush();controller.dispose();
  return{result,error,events,persistence,workspace:JSON.parse(localStorage.getItem(seed.workspaceKey)!),images:await imageFacts(workspace),wire,recovery:await captureRecoveryState(seed),intents:Object.entries(localStorage).filter(([k])=>k.startsWith("morpho.independent-image-delivery.v1."))};
}

async function recover(expected:RecoveryCapture){
  wire.length=0;await verifyStoredRecovery(expected);const {ports,controller}=executionPorts();
  try{await resumeIndependentImageDeliveries(ports);}
  finally{controller.flush();controller.dispose();}
  return{workspace:JSON.parse(localStorage.getItem(seed.workspaceKey)!),images:await imageFacts(workspace),wire,recovery:await captureRecoveryState(seed)};
}
async function damageIntent(key:string,mode:"missing"|"corrupt"){if(mode==="missing")await indexedDbBlobStore.delete(key);else await indexedDbBlobStore.put(key,new Blob(["corrupt"]));}

async function exportImage(storageKey:string){const b=await indexedDbBlobStore.get(storageKey);if(!b)throw Error("Asset missing");return{mimeType:b.type,base64:await new Promise<string>((yes,no)=>{const reader=new FileReader();reader.onload=()=>yes(String(reader.result).split(",")[1]);reader.onerror=()=>no(reader.error);reader.readAsDataURL(b);})};}

(window as unknown as {l3:unknown}).l3={initialize,execute,exportImage,recover,hashProviderImageDataUrl,capture:()=>captureRecoveryState(seed),rehydrate:rehydrateRecoveryCapture,damageIntent};
