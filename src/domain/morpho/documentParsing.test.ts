import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import {
  createDocumentExtractFile,
  isDocumentExtractAssetSource,
  parseDocumentFile,
  shouldAttemptDocumentParse
} from "./documentParsing";

describe("document parsing", () => {
  it("parses Markdown and TXT files as document extracts", async () => {
    const markdown = new File(["# Brief\n\n真实资料：夜间起身路径。"], "brief.md", { type: "text/markdown" });
    const text = new File(["用户粘贴的项目资料"], "notes.txt", { type: "text/plain" });

    const markdownResult = await parseDocumentFile(markdown);
    const textResult = await parseDocumentFile(text);

    expect(markdownResult).toMatchObject({
      status: "parsed",
      mimeType: "text/markdown",
      extractFileName: "brief.extract.txt",
      truncated: false
    });
    expect(markdownResult.status === "parsed" ? markdownResult.text : "").toContain("真实资料");
    expect(textResult).toMatchObject({
      status: "parsed",
      mimeType: "text/plain",
      extractFileName: "notes.extract.txt",
      truncated: false
    });
    expect(textResult.status === "parsed" ? textResult.text : "").toBe("用户粘贴的项目资料");
  });

  it("parses PPTX slide text in slide order with page boundaries", async () => {
    const pptx = new File([toArrayBuffer(makePptxBytes(["第一页标题", "第二页机会点"]))], "deck.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });

    const result = await parseDocumentFile(pptx);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.pageCount).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.text).toContain("--- PPTX 第 1 页 ---\n第一页标题");
      expect(result.text).toContain("--- PPTX 第 2 页 ---\n第二页机会点");
    }
  });

  it("parses PPTX slides by actual OOXML presentation order when filename numbering differs", async () => {
    const pptx = new File([toArrayBuffer(makeOoxmlPptxBytes([
      { fileNumber: 1, text: "第三张出场：实际是方案展示" },
      { fileNumber: 2, text: "第一张出场：实际是封面背景" },
      { fileNumber: 3, text: "第二张出场：实际是调研洞察" }
    ], [2, 3, 1]))], "reordered.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });

    const result = await parseDocumentFile(pptx);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.pageCount).toBe(3);
      expect(result.truncated).toBe(false);
      expect(result.text).toBe(
        "--- PPTX 第 1 页 ---\n第一张出场：实际是封面背景\n\n--- PPTX 第 2 页 ---\n第二张出场：实际是调研洞察\n\n--- PPTX 第 3 页 ---\n第三张出场：实际是方案展示"
      );
    }
  });

  it("fails closed when PPTX presentation relationship is missing, external, or traverses paths", async () => {
    const brokenRelPptx = new File([toArrayBuffer(zipSync({
      "ppt/presentation.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst><p:sldId id="256" r:id="rIdMissing"/></p:sldIdLst>
</p:presentation>`),
      "ppt/_rels/presentation.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdOther" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`),
      "ppt/slides/slide1.xml": strToU8("<p:sld><a:t>Content</a:t></p:sld>")
    }))], "broken-rel.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });

    const externalRelPptx = new File([toArrayBuffer(zipSync({
      "ppt/presentation.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst><p:sldId id="256" r:id="rIdExt"/></p:sldIdLst>
</p:presentation>`),
      "ppt/_rels/presentation.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="http://evil.com/slide.xml" TargetMode="External"/>
</Relationships>`)
    }))], "external-rel.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });

    const traversalRelPptx = new File([toArrayBuffer(zipSync({
      "ppt/presentation.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst><p:sldId id="256" r:id="rIdTrav"/></p:sldIdLst>
</p:presentation>`),
      "ppt/_rels/presentation.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdTrav" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../../evil.xml"/>
</Relationships>`)
    }))], "traversal-rel.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });

    await expect(parseDocumentFile(brokenRelPptx)).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringContaining("幻灯片关系")
    });
    await expect(parseDocumentFile(externalRelPptx)).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringContaining("外部幻灯片")
    });
    await expect(parseDocumentFile(traversalRelPptx)).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringContaining("目标文件缺失或路径无效")
    });
  });

  it("accurately reports truncated: true and appends truncation marker for over-limit plain text and PPTX", async () => {
    const overLimitText = Array.from({ length: 15_000 }, (_, i) => `【记录${i}号项目技术调研备忘与实验分析说明】`).join("\n");
    const textFile = new File([overLimitText], "large.txt", { type: "text/plain" });
    const textResult = await parseDocumentFile(textFile);

    expect(textResult.status).toBe("parsed");
    if (textResult.status === "parsed") {
      expect(textResult.truncated).toBe(true);
      expect(textResult.text.endsWith("\n\n[已截断]")).toBe(true);
      expect(textResult.text.length).toBeLessThanOrEqual(120_000);
    }

    const overLimitPptx = new File([toArrayBuffer(makePptxBytes([overLimitText]))], "large.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const pptxResult = await parseDocumentFile(overLimitPptx);

    expect(pptxResult.status).toBe("parsed");
    if (pptxResult.status === "parsed") {
      expect(pptxResult.truncated).toBe(true);
      expect(pptxResult.text.endsWith("\n\n[已截断]")).toBe(true);
      expect(pptxResult.text.length).toBeLessThanOrEqual(120_000);
    }
  });

  it("extracts text from a minimal text PDF and reports page count", async () => {
    const pdf = new File([toArrayBuffer(makeMinimalTextPdf("Nightrail source"))], "source.pdf", { type: "application/pdf" });

    const result = await parseDocumentFile(pdf);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.pageCount).toBe(1);
      expect(result.text).toContain("Nightrail source");
    }
  });

  it("fails clearly for broken PDFs and old PPT files", async () => {
    const brokenPdf = new File(["not a pdf"], "broken.pdf", { type: "application/pdf" });
    const oldPpt = new File(["legacy"], "legacy.ppt", { type: "application/vnd.ms-powerpoint" });

    expect(shouldAttemptDocumentParse(oldPpt)).toBe(true);
    expect(await parseDocumentFile(oldPpt)).toMatchObject({
      status: "failed",
      reason: expect.stringContaining(".ppt")
    });
    expect(await parseDocumentFile(brokenPdf)).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("PDF")
    });
  });

  it("rejects an oversized PDF before reading its bytes", async () => {
    const pdf = new File(["small placeholder"], "oversized.pdf", { type: "application/pdf" });
    Object.defineProperty(pdf, "size", { value: 64 * 1024 * 1024 + 1 });
    let arrayBufferCalls = 0;
    Object.defineProperty(pdf, "arrayBuffer", {
      value: async () => {
        arrayBufferCalls += 1;
        return new ArrayBuffer(0);
      }
    });

    await expect(parseDocumentFile(pdf)).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringContaining("64 MiB")
    });
    expect(arrayBufferCalls).toBe(0);
  });

  it("rejects oversized plain text before reading its contents", async () => {
    const text = new File(["small placeholder"], "oversized.txt", { type: "text/plain" });
    Object.defineProperty(text, "size", { value: 8 * 1024 * 1024 + 1 });
    let textCalls = 0;
    Object.defineProperty(text, "text", {
      value: async () => {
        textCalls += 1;
        return "should not be read";
      }
    });

    await expect(parseDocumentFile(text)).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringContaining("8 MiB")
    });
    expect(textCalls).toBe(0);
  });

  it("parses no more than 200 PDF pages and marks the extract partial", async () => {
    const pages = Array.from({ length: 201 }, (_, index) => `Page ${index + 1}`);
    const pdf = new File([toArrayBuffer(makeMultiPageTextPdf(pages))], "long.pdf", {
      type: "application/pdf"
    });

    const result = await parseDocumentFile(pdf);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.pageCount).toBe(200);
      expect(result.sourcePageCount).toBe(201);
      expect(result.truncated).toBe(true);
      expect(result.text).toContain("Page 200");
      expect(result.text).not.toContain("Page 201");
      expect(result.text).toContain("[已截断]");
    }
  });

  it("rejects a high-ratio PPTX slide before materializing its expanded XML", async () => {
    const pptx = new File([toArrayBuffer(zipSync({
      "ppt/slides/slide1.xml": strToU8(`<a:t>${"A".repeat(3 * 1024 * 1024)}</a:t>`)
    }))], "bomb.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });

    await expect(parseDocumentFile(pptx)).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringContaining("安全解压预算")
    });
  });

  it("creates a text extract file and identifies its asset source", () => {
    const original = new File(["brief"], "brief.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const extract = createDocumentExtractFile(original, "提取结果");

    expect(extract).toMatchObject({ name: "brief.extract.txt", type: "text/plain" });
    expect(isDocumentExtractAssetSource("documentExtract")).toBe(true);
    expect(isDocumentExtractAssetSource("originalFile")).toBe(false);
  });
});

function makePptxBytes(slides: string[]): Uint8Array {
  return makeOoxmlPptxBytes(
    slides.map((text, index) => ({ fileNumber: index + 1, text })),
    slides.map((_, index) => index + 1)
  );
}

function makeOoxmlPptxBytes(
  slides: Array<{ fileNumber: number; text: string }>,
  presentationOrderFileNumbers: number[]
): Uint8Array {
  const relsEntries = presentationOrderFileNumbers.map((fileNum, index) => {
    const rId = `rId${index + 1}`;
    return `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${fileNum}.xml"/>`;
  });
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${relsEntries.join("\n")}
</Relationships>`;

  const sldIdEntries = presentationOrderFileNumbers.map((_, index) => {
    const rId = `rId${index + 1}`;
    return `<p:sldId id="${256 + index}" r:id="${rId}"/>`;
  });
  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst>
${sldIdEntries.join("\n")}
</p:sldIdLst>
</p:presentation>`;

  const entries: Record<string, Uint8Array> = {
    "ppt/presentation.xml": strToU8(presentationXml),
    "ppt/_rels/presentation.xml.rels": strToU8(relsXml)
  };

  for (const slide of slides) {
    entries[`ppt/slides/slide${slide.fileNumber}.xml`] = strToU8(
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><a:t>${escapeXml(slide.text)}</a:t></p:spTree></p:cSld></p:sld>`
    );
  }

  return zipSync(entries);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function makeMinimalTextPdf(text: string): Uint8Array {
  return makeMultiPageTextPdf([text]);
}

function makeMultiPageTextPdf(pageTexts: string[]): Uint8Array {
  const pageObjectIds = pageTexts.map((_, index) => 4 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...pageTexts.flatMap((text, index) => {
      const safeText = text.replace(/[()\\]/g, "\\$&");
      const pageId = 4 + index * 2;
      const contentId = pageId + 1;
      const stream = `BT /F1 18 Tf 40 80 Td (${safeText}) Tj ET`;
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      ];
    })
  ];
  const encoder = new TextEncoder();
  const header = "%PDF-1.4\n";
  let body = "";
  const offsets: number[] = [0];
  let offset = header.length;
  for (const [index, object] of objects.entries()) {
    offsets.push(offset);
    const chunk = `${index + 1} 0 obj\n${object}\nendobj\n`;
    body += chunk;
    offset += chunk.length;
  }
  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((item) => `${item.toString().padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF"
  ].join("\n");
  return encoder.encode(`${header}${body}${xref}`);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
