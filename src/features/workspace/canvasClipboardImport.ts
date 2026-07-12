/**
 * Clipboard → Morpho import payload helpers for context-menu paste.
 * Keeps browser clipboard access out of domain modules.
 */

export type ClipboardImportPayload = {
  files: File[];
  text?: string;
  url?: string;
};

export type ReadClipboardImportResult =
  | ({ status: "ok" } & ClipboardImportPayload)
  | { status: "empty" }
  | { status: "denied"; reason: string };

export function getUrlFromPlainText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // not a URL
  }
  return "";
}

export function buildClipboardImportPayload(input: { files: File[]; text: string }): ClipboardImportPayload | null {
  const files = input.files.filter((file) => file.size > 0);
  const text = input.text.trim();
  const url = getUrlFromPlainText(text);
  if (files.length === 0 && !text) {
    return null;
  }
  return {
    files,
    url: url || undefined,
    text: files.length === 0 && !url ? text : undefined
  };
}

/**
 * Read the system clipboard for Morpho import. Uses async Clipboard API when
 * available; falls back to readText. Image paste requires clipboard.read().
 */
export async function readClipboardAsImportPayload(
  clipboard: Pick<Clipboard, "read" | "readText"> | undefined = typeof navigator !== "undefined" ? navigator.clipboard : undefined
): Promise<ReadClipboardImportResult> {
  if (!clipboard) {
    return { status: "denied", reason: "当前环境无法读取剪贴板。" };
  }

  const files: File[] = [];
  let text = "";

  try {
    if (typeof clipboard.read === "function") {
      const items = await clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            const ext = type.split("/")[1] || "png";
            files.push(new File([blob], `paste.${ext}`, { type }));
          } else if (type === "text/plain" && !text) {
            text = await (await item.getType(type)).text();
          }
        }
      }
    } else if (typeof clipboard.readText === "function") {
      text = await clipboard.readText();
    }
  } catch {
    return { status: "denied", reason: "无法读取剪贴板，请检查浏览器权限后重试。" };
  }

  const payload = buildClipboardImportPayload({ files, text });
  if (!payload) {
    return { status: "empty" };
  }
  return { status: "ok", ...payload };
}
