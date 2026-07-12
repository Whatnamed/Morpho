import { describe, expect, it } from "vitest";

import { loadAuthRuntimeConfig } from "@/infrastructure/supabase/env";
import { resolveAuthRouteDecision } from "./middlewareAccess";

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
