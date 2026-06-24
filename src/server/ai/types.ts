export type ProviderChatRole = "system" | "user" | "assistant";

export type ProviderChatMessage = {
  role: ProviderChatRole;
  content: string;
};

export type MiMoConfig = {
  apiKeys: string[];
  textModel: string;
  multimodalModel: string;
  baseUrl: string;
  webSearchEnabled: boolean;
};

export type ProviderChatInput = {
  messages: ProviderChatMessage[];
  systemPrompt: string;
  stream: boolean;
  capability: "text" | "multimodal";
};

export type ProviderRequest = {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    messages: ProviderChatMessage[];
    stream: boolean;
  };
};
