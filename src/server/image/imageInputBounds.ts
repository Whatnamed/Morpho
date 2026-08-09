export const MAX_INPUT_IMAGE_DECODED_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_INPUT_IMAGE_DECODED_BYTES = 24 * 1024 * 1024;

const SAFE_IMAGE_DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]*={0,2})$/i;

export type ImageInputCollectionResult =
  | { status: "ok"; images: string[]; totalDecodedBytes: number }
  | { status: "failed"; reason: string };

export function validateImageInputCollection(
  value: unknown,
  options: Readonly<{
    maxCount: number;
    maxDecodedBytes?: number;
    maxTotalDecodedBytes?: number;
  }>
): ImageInputCollectionResult {
  if (!Array.isArray(value)) return { status: "failed", reason: "images 必须是数组。" };
  if (value.length > options.maxCount) {
    return { status: "failed", reason: `参考图最多只能使用 ${options.maxCount} 张。` };
  }

  const maxDecodedBytes = options.maxDecodedBytes ?? MAX_INPUT_IMAGE_DECODED_BYTES;
  const maxTotalDecodedBytes = options.maxTotalDecodedBytes ?? MAX_TOTAL_INPUT_IMAGE_DECODED_BYTES;
  const images: string[] = [];
  let totalDecodedBytes = 0;
  for (const candidate of value) {
    const inspected = inspectSafeImageDataUrl(candidate);
    if (!inspected) return { status: "failed", reason: "参考图必须是受支持的 image data URL。" };
    if (inspected.decodedBytes > maxDecodedBytes) {
      return { status: "failed", reason: "单张参考图解码后超过 8 MiB。" };
    }
    totalDecodedBytes += inspected.decodedBytes;
    if (totalDecodedBytes > maxTotalDecodedBytes) {
      return { status: "failed", reason: "参考图解码后总量超过 24 MiB。" };
    }
    images.push(candidate);
  }

  return { status: "ok", images, totalDecodedBytes };
}

export function inspectSafeImageDataUrl(
  value: unknown
): { mimeType: string; decodedBytes: number } | undefined {
  if (typeof value !== "string") return undefined;
  const match = SAFE_IMAGE_DATA_URL.exec(value);
  if (!match || match[0].length !== value.length) return undefined;
  const payload = match[2]!;
  if (payload.length < 1) return undefined;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const unpaddedLength = payload.length - padding;
  if (unpaddedLength % 4 === 1 || (padding > 0 && payload.length % 4 !== 0)) return undefined;
  return {
    mimeType: `image/${match[1]!.toLowerCase()}`,
    decodedBytes: Math.floor((unpaddedLength * 3) / 4)
  };
}
