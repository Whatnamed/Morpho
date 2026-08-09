import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import { unzipWithBudget, type ZipExtractionBudget } from "./boundedZip";

describe("bounded ZIP extraction", () => {
  it("rejects a high-ratio entry before accepting its expanded output", async () => {
    const zipped = zipSync({ "bomb.txt": strToU8("0".repeat(2 * 1024 * 1024)) });

    await expect(unzipWithBudget(zipped, budget({ maxCompressionRatio: 20 })))
      .rejects.toMatchObject({ code: "compression_ratio_limit" });
  });

  it("rejects excessive central-directory entries", async () => {
    const entries = Object.fromEntries(
      Array.from({ length: 6 }, (_value, index) => [`entry-${index}.txt`, strToU8("x")])
    );

    await expect(unzipWithBudget(zipSync(entries), budget({ maxEntries: 5 })))
      .rejects.toMatchObject({ code: "entry_limit" });
  });

  it("materializes only explicitly included paths", async () => {
    const zipped = zipSync({
      "ppt/slides/slide1.xml": strToU8("<a:t>safe</a:t>"),
      "ppt/media/unrelated.bin": new Uint8Array(1024 * 1024)
    });
    const files = await unzipWithBudget(zipped, budget({
      include: (entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name)
    }));

    expect(Object.keys(files)).toEqual(["ppt/slides/slide1.xml"]);
  });
});

function budget(overrides: Partial<ZipExtractionBudget> = {}): ZipExtractionBudget {
  return {
    maxCompressedBytes: 8 * 1024 * 1024,
    maxEntries: 20,
    maxIncludedEntries: 20,
    maxEntryUncompressedBytes: 4 * 1024 * 1024,
    maxTotalUncompressedBytes: 8 * 1024 * 1024,
    maxCompressionRatio: 200,
    timeoutMs: 5_000,
    include: () => true,
    ...overrides
  };
}
