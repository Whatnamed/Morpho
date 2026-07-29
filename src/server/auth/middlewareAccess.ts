import type { AuthRuntimeConfig } from "@/infrastructure/supabase/env";
import { sanitizeNextPath } from "@/server/auth/redirects";

export type AuthSessionState = "unknown" | "anonymous" | "authenticated";
export type AuthSessionErrorKind = "none" | "session-missing" | "terminal-stale-session" | "unknown";

export type SafeAuthErrorLogFields = {
  name: string;
  code?: string;
  status?: number;
};

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

export function classifyAuthSessionError(error: unknown): AuthSessionErrorKind {
  if (error == null) {
    return "none";
  }

  const record = toErrorRecord(error);
  if (record?.name === "AuthSessionMissingError") {
    return "session-missing";
  }

  if (record?.name === "AuthApiError" && record.code === "refresh_token_not_found") {
    return "terminal-stale-session";
  }

  return "unknown";
}

export function toSafeAuthErrorLogFields(error: unknown): SafeAuthErrorLogFields {
  const record = toErrorRecord(error);
  const name = isSafeAuthLabel(record?.name) ? record.name : "UnknownAuthError";
  const code = isSafeAuthLabel(record?.code) ? record.code : undefined;
  const status =
    typeof record?.status === "number" && Number.isInteger(record.status) && record.status >= 100 && record.status <= 599
      ? record.status
      : undefined;

  return {
    name,
    ...(code ? { code } : {}),
    ...(status ? { status } : {})
  };
}

function toErrorRecord(error: unknown): Record<string, unknown> | null {
  return typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
}

function isSafeAuthLabel(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value);
}
