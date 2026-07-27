export async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

export async function readErrorResponse(response: Response): Promise<string> {
  const payload = await readJsonPayload(response);
  if (isRecord(payload) && typeof payload.error === "string") {
    return payload.error;
  }
  return response.statusText || "AI 请求失败。";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
