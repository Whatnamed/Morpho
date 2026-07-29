import { NextResponse, type NextRequest } from "next/server";

import { loadAuthRuntimeConfig } from "@/infrastructure/supabase/env";
import { clearProxySupabaseAuthCookies, createProxySupabaseClient } from "@/infrastructure/supabase/server";
import {
  classifyAuthSessionError,
  resolveAuthRouteDecision,
  toSafeAuthErrorLogFields
} from "@/server/auth/middlewareAccess";
import { responseForAuthDecision } from "@/server/auth/middlewareResponse";

export async function middleware(request: NextRequest) {
  const auth = loadAuthRuntimeConfig(process.env);
  const pathname = request.nextUrl.pathname;
  const initialDecision = resolveAuthRouteDecision({
    auth,
    pathname,
    search: request.nextUrl.search,
    session: "unknown"
  });

  if (initialDecision.type !== "load-session") {
    return responseForAuthDecision(initialDecision, request);
  }

  const originalCookieNames = request.cookies.getAll().map(({ name }) => name);
  const response = NextResponse.next({ request });
  const supabase = createProxySupabaseClient(request, response);
  if (supabase.status === "failed") {
    return responseForAuthDecision(
      resolveAuthRouteDecision({
        auth: {
          ...auth,
          supabase
        },
        pathname,
        search: request.nextUrl.search,
        session: "unknown"
      }),
      request,
      response
    );
  }

  const {
    data: { user },
    error
  } = await supabase.client.auth.getUser();
  const errorKind = classifyAuthSessionError(error);
  if (errorKind === "terminal-stale-session" && auth.supabase.status === "ok") {
    await clearProxySupabaseAuthCookies(request, response, auth.supabase.url, originalCookieNames);
  } else if (errorKind === "unknown") {
    console.error(
      JSON.stringify({
        event: "morpho_auth_session_load_failed",
        kind: errorKind,
        ...toSafeAuthErrorLogFields(error)
      })
    );
  }

  const decision = resolveAuthRouteDecision({
    auth,
    pathname,
    search: request.nextUrl.search,
    session: errorKind === "none" && user ? "authenticated" : "anonymous"
  });

  return responseForAuthDecision(decision, request, response);
}

export const config = {
  matcher: ["/((?!api|auth|_next/static|_next/image|favicon.ico).*)"]
};
