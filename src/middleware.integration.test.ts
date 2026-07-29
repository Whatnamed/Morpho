import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { middleware } from "./middleware";

describe("authentication middleware with the real Supabase SSR client", () => {
  beforeEach(() => {
    vi.stubEnv("MORPHO_AUTH_REQUIRED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("overrides the SDK stale-session removal with the final Secure expiry cookie", async () => {
    const jwtHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const jwtPayload = Buffer.from(JSON.stringify({ sub: "contract-user", exp: 1 })).toString("base64url");
    const session = Buffer.from(
      JSON.stringify({
        access_token: `${jwtHeader}.${jwtPayload}.`,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: 1,
        refresh_token: "invalid-contract-refresh"
      })
    ).toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 400,
            error_code: "refresh_token_not_found",
            msg: "Invalid Refresh Token: Refresh Token Not Found"
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const response = await middleware(
      new NextRequest("https://morpho.example/projects/project-a", {
        headers: { cookie: `sb-example-auth-token=base64-${session}` }
      })
    );
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://morpho.example/login?next=%2Fprojects%2Fproject-a");
    expect(setCookie).toContain("sb-example-auth-token=");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("Secure");
  });
});
