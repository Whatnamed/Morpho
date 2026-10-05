import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");

/** Pixel authority and persisted manifest identity are two different assertions. */
export async function assertL3ReferenceHashes(images, references, frozenDecodedSha256, productionHashBridge) {
  const decodedHashes=images.map(data=>sha(Buffer.from(data.split(",")[1],"base64")));
  assert.deepEqual(decodedHashes,[frozenDecodedSha256],"Decoded Provider pixels differ from frozen source");
  const productHashes=await Promise.all(images.map(data=>productionHashBridge(data)));
  assert.deepEqual(references.filter(r=>r.status==="sent").map(r=>r.pixelHash),productHashes,"Manifest pixelHash differs from production helper");
  return {decodedHashes,productHashes};
}
