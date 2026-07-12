import type { OpenAiCompatibleResponseRequest } from "./openaiCompatibleProvider";

export function filterAgentRequestForConfig(
  request: OpenAiCompatibleResponseRequest,
  config: { webSearchEnabled: boolean }
): OpenAiCompatibleResponseRequest {
  if (config.webSearchEnabled) {
    return request;
  }

  return {
    ...request,
    tools: request.tools?.filter((tool) => tool.type !== "function" || tool.name !== "search_web_evidence")
  };
}
