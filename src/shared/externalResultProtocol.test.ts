import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { EXTERNAL_REQUEST_MAX_BYTES, EXTERNAL_FROZEN_REQUEST_MAX_BYTES, EXTERNAL_INPUT_IMAGE_MAX_BYTES,
  EXTERNAL_INPUT_IMAGES_MAX_BYTES, EXTERNAL_RESULT_CHUNK_BYTES, assertExternalRequestBody } from "./externalResultProtocol";
import { validateImageInputCollection } from "@/server/image/imageInputBounds";
import { validateGrsImageRouteRequest } from "@/server/image/request";
import { MAX_AGENT_INPUT_IMAGE_BYTES, MAX_AGENT_TOTAL_INPUT_IMAGE_BYTES } from "./agentImageInputLimits";
describe("P3B serialized hosting and image capacity", () => {
  it("counts UTF-8, including escaping and non-ASCII, before sending a paid request", () => {
    expect(() => assertExternalRequestBody("x".repeat(EXTERNAL_REQUEST_MAX_BYTES))).not.toThrow();
    expect(() => assertExternalRequestBody("x".repeat(EXTERNAL_REQUEST_MAX_BYTES+1))).toThrow("4 MiB");
    expect(() => assertExternalRequestBody(JSON.stringify({ text: "中".repeat(EXTERNAL_REQUEST_MAX_BYTES / 3) }))).toThrow();
  });
  it("A+ and independent Image share decoded limits even when encoded bytes are larger", () => {
    const image = `data:image/png;base64,${Buffer.alloc(EXTERNAL_INPUT_IMAGE_MAX_BYTES).toString("base64")}`;
    expect(Buffer.byteLength(image)).toBeGreaterThan(EXTERNAL_INPUT_IMAGE_MAX_BYTES);
    expect(validateImageInputCollection([image], { maxCount: 4 }).status).toBe("ok");
    expect(validateGrsImageRouteRequest({ prompt: "test", images: [image] }).status).toBe("ok");
    const tooLarge = `data:image/png;base64,${Buffer.alloc(EXTERNAL_INPUT_IMAGE_MAX_BYTES+1).toString("base64")}`;
    expect(validateGrsImageRouteRequest({ prompt: "test", images: [tooLarge] }).status).toBe("failed");
    expect(validateImageInputCollection([image,image], { maxCount: 4 }).status).toBe("failed");
    expect(MAX_AGENT_INPUT_IMAGE_BYTES).toBe(EXTERNAL_INPUT_IMAGE_MAX_BYTES);
    expect(MAX_AGENT_TOTAL_INPUT_IMAGE_BYTES).toBe(EXTERNAL_INPUT_IMAGES_MAX_BYTES);
  });
  it("SQL and application payload/chunk caps agree and historical migrations remain unchanged", () => {
    const file = readdirSync("supabase/migrations").find((n) => n.endsWith("_add_external_result_delivery.sql"))!;
    const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
    expect(sql).toContain(String(EXTERNAL_FROZEN_REQUEST_MAX_BYTES));
    expect(sql).toContain(String(EXTERNAL_RESULT_CHUNK_BYTES));
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toContain("from public,anon,authenticated");
    expect(sql).toContain("result_reserved_bytes");
    expect(readFileSync("supabase/migrations/20261001090000_add_external_effect_observation.sql", "utf8")).toContain("37748736");
  });
});
