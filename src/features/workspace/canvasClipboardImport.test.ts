import { describe, expect, it } from "vitest";

import { buildClipboardImportPayload, getUrlFromPlainText, readClipboardAsImportPayload } from "./canvasClipboardImport";

describe("canvasClipboardImport", () => {
  it("extracts http(s) urls from plain text", () => {
    expect(getUrlFromPlainText("https://example.com/a")).toBe("https://example.com/a");
    expect(getUrlFromPlainText("not a url")).toBe("");
    expect(getUrlFromPlainText("ftp://nope")).toBe("");
  });

  it("builds import payload for files, urls, or plain text", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    expect(buildClipboardImportPayload({ files: [file], text: "" })).toEqual({
      files: [file],
      url: undefined,
      text: undefined
    });
    expect(buildClipboardImportPayload({ files: [], text: "https://example.com/path" })).toEqual({
      files: [],
      url: "https://example.com/path",
      text: undefined
    });
    expect(buildClipboardImportPayload({ files: [], text: "一段笔记" })).toEqual({
      files: [],
      url: undefined,
      text: "一段笔记"
    });
    expect(buildClipboardImportPayload({ files: [], text: "   " })).toBeNull();
  });

  it("maps clipboard readText into an ok payload or empty", async () => {
    const ok = await readClipboardAsImportPayload({
      readText: async () => "粘贴的资料"
    } as Clipboard);
    expect(ok).toMatchObject({ status: "ok", text: "粘贴的资料" });

    const empty = await readClipboardAsImportPayload({
      readText: async () => "  "
    } as Clipboard);
    expect(empty).toEqual({ status: "empty" });
  });
});
