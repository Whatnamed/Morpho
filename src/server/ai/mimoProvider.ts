import type { MiMoConfig, ProviderChatInput, ProviderRequest } from "./types";

export function createMiMoChatRequest(config: MiMoConfig, input: ProviderChatInput): ProviderRequest {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: {
      model: config.model,
      messages: [{ role: "system", content: input.systemPrompt }, ...input.messages],
      stream: input.stream
    }
  };
}

export async function streamMiMoChat(config: MiMoConfig, input: ProviderChatInput): Promise<ReadableStream<Uint8Array>> {
  const providerRequest = createMiMoChatRequest(config, input);
  const response = await fetch(providerRequest.url, {
    method: "POST",
    headers: providerRequest.headers,
    body: JSON.stringify(providerRequest.body)
  });

  if (!response.ok || !response.body) {
    throw new Error(`MiMo provider returned ${response.status}`);
  }

  return response.body.pipeThrough(createOpenAiCompatibleTextTransform());
}

export function createOpenAiCompatibleTextTransform(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const token of parseOpenAiCompatibleSse(lines.join("\n"))) {
        controller.enqueue(encoder.encode(token));
      }
    },
    flush(controller) {
      for (const token of parseOpenAiCompatibleSse(buffer)) {
        controller.enqueue(encoder.encode(token));
      }
    }
  });
}

export function parseOpenAiCompatibleSse(text: string): string[] {
  const tokens: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }

    try {
      const parsed = JSON.parse(payload) as unknown;
      const content = extractStreamingContent(parsed);
      if (content) {
        tokens.push(content);
      }
    } catch {
      // Ignore malformed provider chunks; the final route error handles transport failures.
    }
  }

  return tokens;
}

function extractStreamingContent(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return "";
  }

  const firstChoice = value.choices[0] as unknown;
  if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) {
    return "";
  }

  return typeof firstChoice.delta.content === "string" ? firstChoice.delta.content : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
