export type ProviderChatRole = "system" | "user" | "assistant";

export type ProviderChatMessage = {
  role: ProviderChatRole;
  content: string;
};

export type MiMoConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type ProviderChatInput = {
  messages: ProviderChatMessage[];
  systemPrompt: string;
  stream: boolean;
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
