import type { AuthRuntimeConfig } from "@/infrastructure/supabase/env";
import { sanitizeNextPath } from "@/server/auth/redirects";

export type AuthSessionState = "unknown" | "anonymous" | "authenticated";

export type AuthRouteDecision =
  | {
      type: "next";
    }
  | {
      type: "load-session";
    }
  | {
      type: "redirect-to-login";
      nextPath: string;
    }
  | {
      type: "redirect-after-login";
      nextPath: string;
    };

type ResolveAuthRouteDecisionInput = {
  auth: AuthRuntimeConfig;
  pathname: string;
  search: string;
  session: AuthSessionState;
};

export function resolveAuthRouteDecision({
  auth,
  pathname,
  search,
  session
}: ResolveAuthRouteDecisionInput): AuthRouteDecision {
  if (!auth.authRequired) {
    return { type: "next" };
  }

  const isLoginRoute = pathname === "/login";
  if (auth.supabase.status === "failed") {
    return isLoginRoute
      ? { type: "next" }
      : {
          type: "redirect-to-login",
          nextPath: sanitizeNextPath(`${pathname}${search}`)
        };
  }

  if (session === "unknown") {
    return { type: "load-session" };
  }

  if (session === "anonymous") {
    return isLoginRoute
      ? { type: "next" }
      : {
          type: "redirect-to-login",
          nextPath: sanitizeNextPath(`${pathname}${search}`)
        };
  }

  return isLoginRoute
    ? {
        type: "redirect-after-login",
        nextPath: sanitizeNextPath(new URLSearchParams(search).get("next") ?? undefined)
      }
    : { type: "next" };
}
