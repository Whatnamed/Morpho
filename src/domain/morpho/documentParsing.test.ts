import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import { parseDocumentFile, shouldAttemptDocumentParse } from "./documentParsing";

describe("document parsing", () => {
  it("parses Markdown and TXT files as document extracts", async () => {
    const markdown = new File(["# Brief\n\n真实资料：夜间起身路径。"], "brief.md", { type: "text/markdown" });
    const text = new File(["用户粘贴的项目资料"], "notes.txt", { type: "text/plain" });

    const markdownResult = await parseDocumentFile(markdown);
    const textResult = await parseDocumentFile(text);

    expect(markdownResult).toMatchObject({
      status: "parsed",
      mimeType: "text/markdown",
      extractFileName: "brief.extract.txt"
    });
    expect(markdownResult.status === "parsed" ? markdownResult.text : "").toContain("真实资料");
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
      expect(result.text).toContain("--- PPTX 第 1 页 ---\n第一页标题");
      expect(result.text).toContain("--- PPTX 第 2 页 ---\n第二页机会点");
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
});

function makePptxBytes(slides: string[]): Uint8Array {
  const entries = Object.fromEntries(
    slides.map((text, index) => [
      `ppt/slides/slide${index + 1}.xml`,
      strToU8(`<p:sld><p:cSld><p:spTree><a:t>${escapeXml(text)}</a:t></p:spTree></p:cSld></p:sld>`)
    ])
  );
  return zipSync(entries);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function makeMinimalTextPdf(text: string): Uint8Array {
  const safeText = text.replace(/[()\\]/g, "\\$&");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${safeText.length + 42} >>\nstream\nBT /F1 18 Tf 40 80 Td (${safeText}) Tj ET\nendstream`
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
