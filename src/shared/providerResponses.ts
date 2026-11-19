export type ResponseTextContentPart = {
  type: "input_text";
  text: string;
};

export type ResponseOutputTextContentPart = {
  type: "output_text";
  text: string;
};

export type ResponseImageContentPart = {
  type: "input_image";
  image_url: string;
};

export type ResponseMessageInput = {
  role: "system" | "user" | "assistant";
  content: Array<ResponseTextContentPart | ResponseOutputTextContentPart | ResponseImageContentPart>;
};

export type ResponseFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};

export type ResponseWebSearchTool = {
  type: "web_search_preview";
  search_context_size?: "low" | "medium" | "high";
};

export type ResponseTool = ResponseFunctionTool | ResponseWebSearchTool;

export type ResponseFunctionToolOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

export type ProviderCitation = {
  title: string;
  url?: string;
  domain?: string;
  snippet?: string;
};
