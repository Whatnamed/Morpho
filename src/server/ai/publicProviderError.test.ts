import { describe, expect, it } from "vitest";

import { OpenAiCompatibleProviderError } from "./openaiCompatibleProvider";
import { EXTERNAL_EXECUTION_STATE_UNKNOWN, getPublicTextProviderError } from "./publicProviderError";

describe("public Provider uncertainty", () => {
  it.each([408, 429, 500, 502, 503, 504])("maps ambiguous HTTP %s without exposing private diagnostics", (status) => {
    expect(getPublicTextProviderError(new OpenAiCompatibleProviderError(status, "private-host secret-key")))
      .toEqual(EXTERNAL_EXECUTION_STATE_UNKNOWN);
  });

  it("keeps confirmed rejection and known execution failure distinct from uncertainty", () => {
    expect(getPublicTextProviderError(new OpenAiCompatibleProviderError(400, "context_length_exceeded"))).toMatchObject({ code: "provider_context_limit", recoverable: false });
    expect(getPublicTextProviderError(new OpenAiCompatibleProviderError(400, "too many calls", "function_call_limit"))).toMatchObject({ code: "provider_function_call_limit", recoverable: false });
    expect(getPublicTextProviderError(new OpenAiCompatibleProviderError(502, "response.failed", undefined, false))).toMatchObject({ code: "provider_http_502" });
  });
});
