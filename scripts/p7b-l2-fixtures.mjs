import assert from "node:assert/strict";
import { createServer } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
export const hash = value => createHash("sha256").update(value).digest("hex");
const fixedTime="2026-10-04T00:00:00.000Z";
export async function buildL2Fixtures(directory) {
  const vite=await createServer({appType:"custom",configFile:resolve("vitest.config.ts"),server:{middlewareMode:true}});
  const modules=await Promise.all(["workspace","derivedState","conversationCompaction","deliveryPreparation"].map(n=>vite.ssrLoadModule(`/src/domain/morpho/${n}.ts`)));
  const store=await vite.ssrLoadModule("/src/infrastructure/persistence/localProjectStore.ts");
  const caseSeed=await vite.ssrLoadModule("/e2e/support/p7Seed.ts");
  const manifest=JSON.parse(await readFile("e2e/eval/p7b-l2-manifest.json","utf8"));
  const NativeDate=Date,cryptoDescriptor=Object.getOwnPropertyDescriptor(globalThis,"crypto");
  let counter=0;
  const rng=()=>`00000000-0000-4000-8000-${String(++counter).padStart(12,"0")}`;
  const seeds=[];
  try {
    globalThis.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:[fixedTime]));} static now(){return new NativeDate(fixedTime).getTime();} };
    Object.defineProperty(globalThis,"crypto",{configurable:true,value:{subtle:globalThis.crypto.subtle,randomUUID:rng}});
    for(const slice of manifest.slices) {
      counter=0;
      let workspace=modules[0].createBlankWorkspace(`p7b-l2-${slice.id}`),aliases={},assets=[];
      const note={id:"notes",incarnationId:"l2-notes",type:"text",title:"湿区资料：观察与相冲突的资料声称",createdBy:"user",visibility:"active",
        summary:"两人租房；折叠接缝清洁冲突；宽度/承重未知",body:"场景观察：洗碗后海绵、杯子、抹布混放，台面积水。用户：租房两人共用，不永久打孔。竞品A声称折叠能打开表面方便清洁；访谈B说折叠接缝可能积水，需验证清洁路径。两者未做对照试验。台面宽度未测量，承重与耐久未验证。"};
      workspace.project.title="L2 厨房湿区可撤除收纳";workspace.objects.notes=note;
      if(["directions","reversal","compacted"].includes(slice.fixture)){
        for(const [i,removable] of (slice.fixture==="directions"?[false]:[false,true]).entries()){
          const id=`definition-r${i+1}`,revision={id,designDefinitionId:"definition",revisionNumber:i+1,title:"两人租房厨房湿区",summary:removable?"当前：可撤除，不永久固定":"旧：暂按固定安装探索",
            projectGoal:"减少积水并改善清洁",targetUsers:["租房两人"],primaryScenarios:["洗碗后共享台面"],coreProblem:"湿物混放、接缝积水",designPrinciples:["清洁路径可检查",removable?"无需破坏，可撤除":"暂按固定点支撑"],constraints:[removable?"可撤除；禁止永久打孔":"暂按固定安装研究，未确定许可","台面宽度未知","承重/耐久未验证"],avoidDirections:["把未验证性能写成成果"],opportunities:[],openQuestions:["排水路径与共享使用冲突"],sourceObjectIds:["notes"],citationIds:[],createdAt:fixedTime,isCurrent:true,...(i?{previousRevisionId:"definition-r1",changeNote:"用户撤销固定安装，明确应用可撤除定义"}:{})};
          if(i)workspace.designDefinitionRevisions["definition-r1"].isCurrent=false;
          workspace.designDefinitionRevisions[id]=revision;
          workspace.objects.definition={id:"definition",incarnationId:"l2-definition",type:"designDefinition",title:revision.title,summary:revision.summary,problem:revision.coreProblem,principles:revision.designPrinciples,avoid:revision.avoidDirections,currentRevisionId:id,revisionIds:i?["definition-r1",id]:[id],isCurrentEffective:true,createdBy:"user",visibility:"active"};
          workspace.decisionRecords.push({id:`l2-apply-${i+1}`,kind:"applyDesignDefinition",createdAt:fixedTime,summary:revision.summary,reason:i?"租约不允许永久安装；采用可撤除约束":"为比较稳固性，先把固定支撑当作暂定探索前提",relatedObjectIds:["definition"],effect:{kind:"applyDesignDefinition",targetObjectId:"definition",targetIncarnationId:"l2-definition",revisionId:id}});
        }
        const definitions=["挂架分区：利用立面、独立沥水篮，依赖挂点许可","可拆台面架：独立脚垫与滑出接水盘，占用台面但可迁移","卷帘沥水垫：跨水槽排水、卷起收纳，承载路径需实测"];
        definitions.forEach((text,i)=>{const id=`direction-${"ABC"[i]}`,rev=`${id}-r1`;workspace.objects[id]={id,incarnationId:`l2-${id}`,type:"conceptDirection",title:`厨房方向 ${"ABC"[i]}`,summary:text,status:i===0?"primary":"alternative",keywords:[text],currentRevisionId:rev,revisionIds:[rev],lineageRootId:id,createdBy:"user",visibility:"active"};workspace.directionRevisions[rev]={id:rev,directionId:id,revisionNumber:1,title:`厨房方向 ${"ABC"[i]}`,summary:text,conceptStatement:text,keywords:[],strategy:text,differentiators:[text],visualSignals:[],risks:["承重、清洁与尺寸未验证"],openQuestions:["共享使用与排水"],sourceObjectIds:["notes"],citationIds:[],basedOnDefinitionRevisionId:workspace.objects.definition.currentRevisionId,createdAt:fixedTime,isCurrent:true};});
      }
      if(slice.fixture==="compacted"){
        workspace.ai.messages=Array.from({length:12},(_,i)=>({id:`l2-history-${i}`,role:i%2?"assistant":"user",body:i===0?"2026-09-20：先暂按固定支撑探索，因为共享时担心晃动；固定许可和承重没有验证。":i===1?"旧暂定固定路线只是探索，不是性能验证。":i===10?"2026-10-03 用户已撤销固定前提，应用可撤除定义，保留旧理由。":`厨房讨论记录 ${i}：清洁和共享`,createdAt:`2026-09-20T00:00:${String(i).padStart(2,"0")}Z`,...(i%2?{status:"done"}:{})}));
        const applied=modules[2].applyConversationSummaryRevision(workspace,{sourceMessageIds:workspace.ai.messages.slice(0,8).map(m=>m.id),summary:{threadGoal:"厨房湿区，旧固定支撑暂定路线",establishedContext:["租房两人共享"],decisionsAndReasons:["旧：暂按固定点支撑研究，担心共享时晃动，许可和承重未验证"],activeWork:[],unresolvedQuestions:["清洁、许可、承重未知"],referencedObjects:["definition"]},now:fixedTime});assert.equal(applied.status,"applied");workspace=applied.workspace;
      }
      if(slice.fixture==="delivery"){
        const created=modules[3].createDeliveryPreparation(workspace,{title:"厨房湿区方案准备",format:"board",position:{x:100,y:100},now:fixedTime});assert.equal(created.status,"updated");workspace=created.workspace;
        const delivery=workspace.objects[created.deliveryObjectId];aliases.delivery=delivery.id;aliases.section=delivery.sections[0].id;
        const added=modules[3].addObjectsToDeliverySection(workspace,{deliveryObjectId:delivery.id,sectionId:aliases.section,sourceObjectIds:["notes"]});assert.equal(added.status,"updated");workspace=added.workspace;
      }
      if(slice.fixture==="case"){
        const seeded=caseSeed.buildP7Seed();workspace=JSON.parse(seeded.workspaceValue);aliases=seeded.aliases;assets=seeded.assets;
        workspace.project={...workspace.project,id:`p7b-l2-${slice.id}`,title:"L2 原浮标案例隔离 checkpoint"};
      }else{
        workspace=modules[1].reconcileWorkspaceDerivedState(workspace);
        const visible=Object.keys(workspace.objects);workspace.canvas.instances=visible.map((id,i)=>({id:`l2-instance-${id}`,objectId:id,position:{x:100+(i%3)*260,y:100+Math.floor(i/3)*210},size:{w:230,h:180}}));
      }
      workspace.ui.aiOpen=true;workspace.ui.lastSelectionIds=slice.select.map(id=>aliases[id]??id);
      if(slice.fixture==="delivery")workspace.ui.activeDrawer="delivery";
      const seed={version:manifest.fixtureVersion,sliceId:slice.id,aliases,projectId:workspace.project.id,workspaceKey:store.getProjectWorkspaceStorageKey(workspace.project.id),workspaceValue:modules[0].serializeWorkspace(workspace),catalogKey:store.CATALOG_STORAGE_KEY,catalogValue:JSON.stringify(store.createCatalog([store.summarizeProject(workspace)],workspace.project.id)),assets,selectedIds:workspace.ui.lastSelectionIds};
      assert.equal(JSON.parse(seed.workspaceValue).schemaVersion,18);
      for(const a of assets){const b=await readFile(resolve("public",a.publicPath.slice(1)));assert.equal(hash(b),a.contentHash);assert.equal(b.length,a.size);}
      seeds.push(seed);
    }
  }finally{globalThis.Date=NativeDate;Object.defineProperty(globalThis,"crypto",cryptoDescriptor);await vite.close();}
  await mkdir(directory,{recursive:true});
  const bytes=JSON.stringify(seeds,null,2)+"\n";await writeFile(resolve(directory,"fixtures.json"),bytes);
  const metadata={version:manifest.fixtureVersion,bundleSha256:hash(bytes),source:"Deterministic explicit Eval-owned checkpoint overlays; current domain serialization/reconciliation; original case retains all historical semantic data/assets",slices:seeds.map(s=>({id:s.sliceId,projectId:s.projectId,workspaceSha256:hash(s.workspaceValue),selectedIds:s.selectedIds,assetCount:s.assets.length,assetHashes:s.assets.map(a=>a.contentHash)}))};
  await writeFile(resolve(directory,"fixture-metadata.json"),JSON.stringify(metadata,null,2)+"\n");
  return metadata;
}
if(process.argv[1]?.endsWith("p7b-l2-fixtures.mjs"))console.log(JSON.stringify(await buildL2Fixtures(process.argv[2]??"output/playwright/p7b-l2/preflight")));
