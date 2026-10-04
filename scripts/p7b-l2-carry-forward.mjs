import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
export async function writeL2CarryForward(output,manifest){
  const receipt=JSON.parse(await readFile("docs/operations/p7b-2-l2-evidence.json","utf8"));
  const historical=receipt.d1FixAndLimitedRun,runId=historical.realRun.runId;
  const path=`output/playwright/p7b-l2/${runId}/wire-001-response.txt`,bytes=await readFile(path);
  const digest=createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest,historical.artifactIndex.find(a=>a.path===path).sha256,"Historical response changed");
  const events=bytes.toString("utf8").split(/\r?\n/).filter(l=>l.startsWith("data: ")).flatMap(l=>{try{return [JSON.parse(l.slice(6))];}catch{return[];}});
  const usage=events.findLast(e=>e.response?.status==="completed"&&e.response.usage)?.response.usage;
  assert.equal(usage.input_tokens,37777);assert.equal(usage.output_tokens,606);assert.equal(usage.input_tokens_details.cached_tokens,0);
  const rates=manifest.pricing.cnyPerMillion,cost=(usage.input_tokens*rates.input+usage.output_tokens*rates.output)/1e6;assert.equal(cost,0.0122421);
  const carry={version:"p7b-l2-continuation-accounting-2",source:{runId,path,sha256:digest,authority:"Original completed Provider response usage; original raw ledger/verdict unchanged"},
    totals:{requests:1,inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,cachedInputTokens:0,estimatedCny:cost},
    policy:"User-approved D2 correction: completed actual usage is authoritative; byte estimates are projections only; gate the next upstream action after durable settlement",qualityTrialCount:0};
  await writeFile(resolve(output,"carry-forward.json"),JSON.stringify(carry,null,2)+"\n");return carry;
}
