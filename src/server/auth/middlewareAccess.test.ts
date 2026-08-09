import { describe, expect, it } from "vitest";

import { loadAuthRuntimeConfig } from "@/infrastructure/supabase/env";
import { classifyAuthSessionError, resolveAuthRouteDecision, toSafeAuthErrorLogFields } from "./middlewareAccess";

const configuredEnvironment = {
  MORPHO_AUTH_REQUIRED: "true",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
};

describe("resolveAuthRouteDecision", () => {
  it("allows requests when authentication is explicitly disabled", () => {
    const decision = resolveAuthRouteDecision({
      auth: loadAuthRuntimeConfig({ MORPHO_AUTH_REQUIRED: "false" }),
      pathname: "/projects/project-nightrail",
      search: "",
      session: "anonymous"
    });

    expect(decision).toEqual({ type: "next" });
  });

  it("keeps normal configured authentication redirects intact", () => {
    const auth = loadAuthRuntimeConfig(configuredEnvironment);

    expect(
      resolveAuthRouteDecision({
        auth,
        pathname: "/projects/project-nightrail",
        search: "?view=canvas",
        session: "anonymous"
      })
    ).toEqual({
      type: "redirect-to-login",
      nextPath: "/projects/project-nightrail?view=canvas"
    });

    expect(
      resolveAuthRouteDecision({
        auth,
        pathname: "/login",
        search: "?next=%2Fprojects%2Fproject-nightrail",
        session: "authenticated"
      })
    ).toEqual({
      type: "redirect-after-login",
      nextPath: "/projects/project-nightrail"
    });
  });

  it("fails closed after URLSearchParams decodes an encoded backslash target", () => {
    expect(
      resolveAuthRouteDecision({
        auth: loadAuthRuntimeConfig(configuredEnvironment),
        pathname: "/login",
        search: "?next=%2F%255C%255Cevil.example%2Fprojects%2Fproject-a",
        session: "authenticated"
      })
    ).toEqual({
      type: "redirect-after-login",
      nextPath: "/"
    });
  });

  it("fails closed when required authentication lacks public Supabase configuration", () => {
    const auth = loadAuthRuntimeConfig({ MORPHO_AUTH_REQUIRED: "true" });

    expect(
      resolveAuthRouteDecision({
        auth,
        pathname: "/login",
        search: "?next=%2Fprojects%2Fproject-nightrail",
        session: "unknown"
      })
    ).toEqual({ type: "next" });

    expect(
      resolveAuthRouteDecision({
        auth,
        pathname: "/",
        search: "",
        session: "unknown"
      })
    ).toEqual({
      type: "redirect-to-login",
      nextPath: "/"
    });

    expect(
      resolveAuthRouteDecision({
        auth,
        pathname: "/projects/project-nightrail",
        search: "?view=canvas",
        session: "unknown"
      })
    ).toEqual({
      type: "redirect-to-login",
      nextPath: "/projects/project-nightrail?view=canvas"
    });
  });
});

describe("classifyAuthSessionError", () => {
  it("recognizes only the exact terminal stale refresh-token code", () => {
    expect(
      classifyAuthSessionError({
        name: "AuthApiError",
        code: "refresh_token_not_found",
        status: 400,
        message: "Invalid Refresh Token: Refresh Token Not Found"
      })
    ).toBe("terminal-stale-session");

    expect(
      classifyAuthSessionError({
        name: "AuthRetryableFetchError",
        code: "refresh_token_timeout",
        status: 503
      })
    ).toBe("unknown");
  });

  it("keeps a clean anonymous session distinct from an unknown auth failure", () => {
    expect(classifyAuthSessionError(null)).toBe("none");
    expect(classifyAuthSessionError({ name: "AuthSessionMissingError" })).toBe("session-missing");
    expect(classifyAuthSessionError(new Error("network failed"))).toBe("unknown");
  });

  it("produces log fields without messages, tokens or user identifiers", () => {
    const fields = toSafeAuthErrorLogFields({
      name: "AuthApiError",
      code: "unexpected_auth_failure",
      status: 503,
      message: "secret-bearing upstream detail",
      refresh_token: "must-not-appear",
      user_id: "must-not-appear"
    });

    expect(fields).toEqual({
      name: "AuthApiError",
      code: "unexpected_auth_failure",
      status: 503
    });
    expect(JSON.stringify(fields)).not.toContain("secret-bearing");
    expect(JSON.stringify(fields)).not.toContain("must-not-appear");
  });
});
