import { deflateSync } from "node:zlib";
import { zipSync } from "fflate";

/**
 * Deterministic import fixtures built in Node: a valid text-layer PDF, a valid
 * PPTX (real zip with `ppt/slides/slideN.xml` text runs, which is exactly what
 * `documentParsing.ts` reads), and a real PNG. No fixture file is committed; bytes
 * are generated per run and handed to Playwright as buffers.
 */

// ---------------------------------------------------------------- PNG --------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** RGB PNG with a horizontal gradient and sparse deterministic noise. */
export function buildPng(width: number, height: number, seed = 7): Buffer {
  const mulberry32 = (value: number) => {
    let a = value >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const random = mulberry32(seed);

  // Filter byte 0 (None) per scanline, 3 bytes per pixel.
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const t = y / height;
      const noise = random() > 0.88 ? 60 : 0;
      raw[offset] = Math.min(255, Math.round(60 + 150 * t + noise));
      raw[offset + 1] = Math.min(255, Math.round(120 + 80 * (1 - t) + noise));
      raw[offset + 2] = Math.min(255, Math.round(150 + 60 * t + noise));
      offset += 3;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 6 })),
    pngChunk("IEND", new Uint8Array(0))
  ]);
}

// ---------------------------------------------------------------- PDF --------

function pdfEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Minimal but spec-shaped PDF: catalog, page tree, one Helvetica font object, and
 * per-page content streams of real text-showing operators. pdf.js parses this into
 * a genuine text layer, which is what `parsePdfDocument` extracts.
 */
export function buildPdf(pageCount: number, linesPerPage = 42, lineLength = 88): Buffer {
  const objects: string[] = [];
  const line = (index: number) =>
    `Morpho performance fixture page line ${String(index).padStart(4, "0")} ${"x".repeat(
      Math.max(8, lineLength - 40 - String(index).length)
    )} end of line.`;

  const pageObjectIds: number[] = [];
  // 1 catalog, 2 pages, 3 font; pages start at 4, each page uses 2 objects (page + content).
  const firstPageObject = 4;
  for (let page = 0; page < pageCount; page += 1) {
    pageObjectIds.push(firstPageObject + page * 2);
  }

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  for (let page = 0; page < pageCount; page += 1) {
    const pageId = firstPageObject + page * 2;
    const contentId = pageId + 1;
    const content = [`BT /F1 11 Tf 72 740 Td 14 TL`];
    for (let index = 0; index < linesPerPage; index += 1) {
      content.push(`(${pdfEscape(line(page * linesPerPage + index))}) Tj T*`);
    }
    content.push("ET");
    const stream = content.join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    const body = objects[id];
    if (body === undefined) {
      throw new Error(`PDF object ${id} missing.`);
    }
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  const count = objects.length; // includes object 0
  pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// --------------------------------------------------------------- PPTX --------

function pptxSlideXml(index: number, lines: number): string {
  const runs = Array.from(
    { length: lines },
    (_, line) =>
      `<a:p><a:r><a:rPr lang="en-US" sz="1200"/><a:t>Morpho PPTX fixture slide ${index} line ${line + 1} — 设计考察记录与结构说明。</a:t></a:r></a:p>`
  ).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title ${index}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${runs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  );
}

export function buildPptx(slideCount: number, linesPerSlide = 8): Buffer {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
        `${Array.from(
          { length: slideCount },
          (_, index) =>
            `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
        ).join("")}</Types>`
    ),
    "_rels/.rels": Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
    ),
    "ppt/presentation.xml": Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
        `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
        `<p:sldIdLst>${Array.from(
          { length: slideCount },
          (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`
        ).join("")}</p:sldIdLst></p:presentation>`
    ),
    "ppt/_rels/presentation.xml.rels": Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `${Array.from(
          { length: slideCount },
          (_, index) =>
            `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`
        ).join("")}</Relationships>`
    )
  };
  for (let slide = 1; slide <= slideCount; slide += 1) {
    files[`ppt/slides/slide${slide}.xml`] = Buffer.from(pptxSlideXml(slide, linesPerSlide));
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}

export function buildTextFile(lines: number): Buffer {
  return Buffer.from(
    Array.from(
      { length: lines },
      (_, index) => `设计调研记录 ${index + 1}：材料工艺观察与使用场景约束的逐条整理，用于性能夹具的文本体积。`
    ).join("\n"),
    "utf8"
  );
}
