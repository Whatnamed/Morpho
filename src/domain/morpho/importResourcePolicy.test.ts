import { describe, expect, it } from "vitest";

import {
  IMPORT_RESOURCE_POLICY,
  preflightImportResourceMetadata,
  validateImportImageDimensions
} from "./importResourcePolicy";

describe("import resource policy", () => {
  it("rejects file-count and aggregate-byte excess before resource work", () => {
    const tooMany = Array.from({ length: IMPORT_RESOURCE_POLICY.maxFilesPerBatch + 1 }, (_, index) =>
      new File(["x"], `file-${index}.txt`, { type: "text/plain" })
    );
    expect(() => preflightImportResourceMetadata(tooMany)).toThrow(/最多导入 32/);

    const largeImages = Array.from({ length: 3 }, (_, index) =>
      fakeSizedFile(`image-${index}.png`, "image/png", 48 * 1024 * 1024)
    );
    expect(() => preflightImportResourceMetadata(largeImages)).toThrow(/文件总大小/);
  });

  it("classifies extensions when browsers omit MIME and enforces kind limits", () => {
    expect(preflightImportResourceMetadata([new File(["pdf"], "brief.pdf")])[0]?.kind).toBe("pdf");
    expect(() => preflightImportResourceMetadata([
      fakeSizedFile("notes.txt", "", IMPORT_RESOURCE_POLICY.maxBytesByKind.text + 1)
    ])).toThrow(/文本文件/);
  });

  it("rejects unsafe per-image and aggregate decoded pixel counts", () => {
    const file = new File(["image"], "reference.png", { type: "image/png" });
    expect(() => validateImportImageDimensions(file, {
      width: 8_000,
      height: 6_000,
      aspectRatio: 4 / 3
    }, 0)).toThrow(/分辨率/);

    expect(() => validateImportImageDimensions(file, {
      width: 7_500,
      height: 5_000,
      aspectRatio: 1.5
    }, 70_000_000)).toThrow(/总分辨率/);
  });
});

function fakeSizedFile(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}
