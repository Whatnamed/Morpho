// Deterministic, no-network diagnostic of the frozen prompt, never a prompt repair.
import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
const run=resolve(process.argv[2]),manifest=JSON.parse(await readFile("e2e/eval/p7b-l2-manifest.json","utf8"));
const vite=await createServer({appType:"custom",configFile:resolve("vitest.config.ts"),server:{middlewareMode:true}});
try{
  const authority=await vite.ssrLoadModule("/src/shared/userInstructionAuthority.ts");
  const frozenPrompt=manifest.slices[0].prompt;
  const stripped=authority.stripUntrustedInstructionSegments(frozenPrompt);
  const frames=[...frozenPrompt.matchAll(/(?:示例|引用|文档|资料|原文|命令|记录)[^。.!！?？\n]{0,40}[:：][^。.!！?？\n]*/gi)].map(m=>m[0]);
  const wire=JSON.parse(await readFile(resolve(run,"no-paid-server-wire.json"),"utf8"));
  const canonical=wire.productionBody.input.flatMap(i=>i.content??[]).find(c=>c.type==="input_text"&&c.text.startsWith("<morpho_turn_task_contract>"));
  assert.ok(canonical,"Actual production Server task contract missing");
  const contract=JSON.parse(canonical.text.split("\n")[2]);
  assert.equal(contract.userGoal,frozenPrompt,"Frozen user prompt changed");
  assert.equal(wire.networkSent,false);
  const tools=wire.productionBody.tools.map(t=>t.name);
  assert.ok(!tools.includes("create_research_analysis"));
  const result={diagnostic:"P7B-2-D1",status:"confirmed / no product repair",frozenPrompt,strippedUserInstruction:stripped,removedReferenceFrames:frames,
    explicitResearchActionDetected:authority.hasExplicitUserActionRequest(frozenPrompt,"createResearchAnalysis"),
    omittedRequiredTool:"create_research_analysis",serverTools:tools,serverTaskContract:contract,
    observedMemoryGrant:tools.includes("submit_memory_update"),memoryGrantInterpretation:"Observed additional candidate-memory tool; no execution or authoritative mutation proved; D1 is grounded in required Research tool omission",
    attribution:"Deterministic user-instruction authority / routing, before model. Reference-frame stripping consumes actual instruction starting at 资料...：; positive Research rule also requires action verb immediately followed by 研究/调研/分析 and does not accept 一张.",
    paidRequests:0,qualityTrials:0,productFilesChanged:false};
  await writeFile(resolve(run,"authority-diagnostic.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify({status:result.status,omittedRequiredTool:result.omittedRequiredTool,paidRequests:0}));
}finally{await vite.close();}
