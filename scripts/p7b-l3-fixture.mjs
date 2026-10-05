import assert from "node:assert/strict";
import { createServer } from "vite";
import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
export const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
export async function buildL3Fixture(output){
  const vite=await createServer({appType:"custom",configFile:resolve("vitest.config.ts"),server:{middlewareMode:true}});
  const NativeDate=Date,cryptoDescriptor=Object.getOwnPropertyDescriptor(globalThis,"crypto");
  try{
    const seedModule=await vite.ssrLoadModule("/e2e/support/p7Seed.ts"),compiler=await vite.ssrLoadModule("/src/domain/operations/imagePromptCompiler.ts");
    globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:["2026-10-05T00:00:00.000Z"]));}static now(){return new NativeDate("2026-10-05T00:00:00.000Z").getTime();}};
    let i=0;Object.defineProperty(globalThis,"crypto",{configurable:true,value:{subtle:globalThis.crypto.subtle,randomUUID:()=>`00000000-0000-4000-8000-${String(++i).padStart(12,"0")}`}});
    const seed=seedModule.buildP7Seed(),workspace=JSON.parse(seed.workspaceValue),manifest=JSON.parse(await readFile("e2e/eval/p7b-l3-manifest.json","utf8"));
    const {parent,defaultReference,excluded}=seed.aliases;
    const assets=[];for(const asset of seed.assets){const bytes=await readFile(resolve("public",asset.publicPath.slice(1)));assert.equal(hash(bytes),asset.contentHash);assets.push({...asset,sha256:hash(bytes)});}
    const oracle=manifest.preserveOracle.map(p=>p.claim),attempts=[];
    for(const cls of manifest.classes)for(const trial of [1,2]){
      const key=`${cls.id}-trial-${trial}`,intent={id:key,identityParentObjectId:parent,title:`${cls.kind} controlled smoke`,purpose:cls.user,requestedReferenceObjectIds:[],referenceBindings:[],excludedReferenceObjectIds:[defaultReference,excluded],excludeDefaultReference:true,changeGoals:cls.changeGoals,preserve:oracle,allowToChange:cls.allowToChange,materialsAndCmf:cls.materialsAndCmf,viewpoint:cls.viewpoint,environmentAndLighting:cls.environmentAndLighting,productForm:[],avoid:["不要改变产品身份或生成第二个产品","不要显示或猜测不可见内部","不要把生态、声学、承载或耐久当成图像已证明的工程事实"],role:cls.role};
      const plan=compiler.compileVisualGenerationPlan({workspace,kind:"visualDevelopment",intents:[intent],selectedSourceObjectIds:[parent],modelId:manifest.provider.model,currentUserInput:cls.user,allowedReferenceObjectIds:[parent],excludedReferenceObjectIds:[defaultReference,excluded]});
      assert.deepEqual(plan.items[0].referenceObjectIds,[parent]);assert.equal(plan.items[0].lineage.identityParent.objectId,parent);
      attempts.push({key,classId:cls.id,trial,user:cls.user,intent,plan,planSha256:hash(JSON.stringify(plan))});
    }
    const fixture={version:manifest.fixtureVersion,seed,assets,attempts},bytes=JSON.stringify(fixture,null,2)+"\n";
    const sourceAssetId=workspace.objects[parent].assetId,source=assets.find(a=>a.assetId===sourceAssetId);
    const metadata={version:fixture.version,bundleSha256:hash(bytes),seedSha256:hash(seed.workspaceValue),aliases:seed.aliases,sourceAsset:source,assets:assets.map(a=>({assetId:a.assetId,sha256:a.sha256,size:a.size})),attempts};
    await writeFile(resolve(output,"fixture.json"),bytes);await writeFile(resolve(output,"fixture-metadata.json"),JSON.stringify(metadata,null,2)+"\n");return metadata;
  }finally{globalThis.Date=NativeDate;Object.defineProperty(globalThis,"crypto",cryptoDescriptor);await vite.close();}
}
