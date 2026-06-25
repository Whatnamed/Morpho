import { describe, expect, it } from "vitest";

import { getMiMoRouteErrorMessage, MiMoProviderError } from "./errors";

describe("MiMo route error mapping", () => {
  it("does not report provider request errors as network failures", () => {
    expect(getMiMoRouteErrorMessage(new MiMoProviderError("requestInvalid", 400))).toContain("请求格式或模型配置");
    expect(getMiMoRouteErrorMessage(new MiMoProviderError("authFailed", 401))).toContain("Key");
    expect(getMiMoRouteErrorMessage(new MiMoProviderError("rateLimited", 429))).toContain("限流");
    expect(getMiMoRouteErrorMessage(new MiMoProviderError("temporaryFailure", 502))).toContain("暂时不可用");
  });

  it("keeps real transport failures separate", () => {
    expect(getMiMoRouteErrorMessage(new TypeError("fetch failed"))).toContain("网络连接");
  });
});
