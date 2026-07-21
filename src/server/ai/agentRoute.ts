import type { OpenAiCompatibleResponseRequest } from "./openaiCompatibleProvider";

export function filterAgentRequestForConfig(
  request: OpenAiCompatibleResponseRequest,
  config: {
    webSearchEnabled: boolean;
    promptCache?: {
      supportsPromptCacheKey: boolean;
      supportsPromptCacheRetention: boolean;
      promptCacheRetention?: "in_memory" | "24h";
      promptCacheKeyEnabled: boolean;
    };
  }
): OpenAiCompatibleResponseRequest {
  const filteredTools = config.webSearchEnabled
    ? request.tools
    : request.tools?.filter((tool) => tool.type !== "function" || tool.name !== "search_web_evidence");
  const promptCache = config.promptCache;
  return {
    ...request,
    tools: filteredTools,
    ...(!promptCache?.supportsPromptCacheKey || !promptCache.promptCacheKeyEnabled
      ? { promptCacheKey: undefined }
      : {}),
    ...(promptCache?.supportsPromptCacheRetention && promptCache.promptCacheRetention
      ? { promptCacheRetention: promptCache.promptCacheRetention }
      : { promptCacheRetention: undefined })
  };
}
