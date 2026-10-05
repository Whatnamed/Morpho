import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createServer } from "vite";
import { assertL3ReferenceHashes } from "./p7b-l3-hash-assertions.mjs";
const vite=await createServer({configFile:resolve("vitest.config.ts"),server:{middlewareMode:true},appType:"custom"});
const {hashProviderImageDataUrl}=await vite.ssrLoadModule("/src/domain/morpho/providerInputSnapshot.ts");
const bytes=await readFile("public/case-study/current/assets/c1fa9574e8a7870179327f4cf4bd175fb37c3036dfa513e3933dda4b62e4ecdc.jpg");
const data="data:image/jpeg;base64,"+bytes.toString("base64"),sha=b=>createHash("sha256").update(b).digest("hex");
try {
  await test("manifest identity uses the actual production helper while decoded pixels independently bind frozen A",async()=>{
    const expected=hashProviderImageDataUrl(data),result=await assertL3ReferenceHashes([data],[{status:"sent",pixelHash:expected}],sha(bytes),hashProviderImageDataUrl);
    assert.equal(expected,"34d97d256df0d6c832ecc53ceaf3e3b9b0eeb80c4480647d35b7d100acaf9293");assert.equal(result.productHashes[0],expected);assert.equal(result.decodedHashes[0],"c1fa9574e8a7870179327f4cf4bd175fb37c3036dfa513e3933dda4b62e4ecdc");
  });
  await test("bare data URL SHA256 is rejected as a product pixelHash oracle",async()=>{
    assert.notEqual(sha(data),hashProviderImageDataUrl(data));await assert.rejects(assertL3ReferenceHashes([data],[{status:"sent",pixelHash:sha(data)}],sha(bytes),hashProviderImageDataUrl),/production helper/);
  });
  await test("changed data URL content changes the product hash and cannot pass frozen decoded authority",async()=>{
    const changed=Buffer.from(bytes);changed[0]^=1;const altered="data:image/jpeg;base64,"+changed.toString("base64");assert.notEqual(hashProviderImageDataUrl(altered),hashProviderImageDataUrl(data));await assert.rejects(assertL3ReferenceHashes([altered],[{status:"sent",pixelHash:hashProviderImageDataUrl(altered)}],sha(bytes),hashProviderImageDataUrl),/frozen source/);
  });
}finally{await vite.close();}
