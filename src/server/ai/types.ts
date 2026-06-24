export type ProviderChatRole = "system" | "user" | "assistant";

export type ProviderImageUrlPart = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

export type ProviderTextPart = {
  type: "text";
  text: string;
};

export type ProviderChatContent = string | Array<ProviderTextPart | ProviderImageUrlPart>;

export type ProviderChatMessage = {
  role: ProviderChatRole;
  content: ProviderChatContent;
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
  webSearch?: ProviderWebSearchOptions;
  signal?: AbortSignal;
};

export type ProviderWebSearchOptions = {
  enabled: boolean;
  maxKeyword: number;
  forceSearch: boolean;
  limit: number;
};

export type ProviderCitation = {
  title: string;
  url?: string;
  domain?: string;
  snippet?: string;
};

export type ProviderStreamEvent =
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "citations";
      citations: ProviderCitation[];
    }
  | {
      type: "done";
    }
  | {
      type: "error";
      message: string;
};

export type ProviderRequest = {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    messages: ProviderChatMessage[];
    stream: boolean;
    thinking: {
      type: "disabled";
    };
    tools?: Array<{
      type: "web_search";
      max_keyword: number;
      force_search: boolean;
      limit: number;
    }>;
  };
};
