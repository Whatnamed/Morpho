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

export type ProviderWebSearchOptions = {
  enabled: boolean;
  maxKeyword?: number;
  forceSearch: boolean;
  limit?: number;
};

export type ProviderCitation = {
  title: string;
  url?: string;
  domain?: string;
  snippet?: string;
};
