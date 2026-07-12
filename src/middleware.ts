import { NextResponse, type NextRequest } from "next/server";

import { loadAuthRuntimeConfig } from "@/infrastructure/supabase/env";
import { createProxySupabaseClient } from "@/infrastructure/supabase/server";
import { resolveAuthRouteDecision, type AuthRouteDecision } from "@/server/auth/middlewareAccess";

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
    data: { user }
  } = await supabase.client.auth.getUser();
  const decision = resolveAuthRouteDecision({
    auth,
    pathname,
    search: request.nextUrl.search,
    session: user ? "authenticated" : "anonymous"
  });

  return responseForAuthDecision(decision, request, response);
}

export const config = {
  matcher: ["/((?!api|auth|_next/static|_next/image|favicon.ico).*)"]
};

function responseForAuthDecision(decision: AuthRouteDecision, request: NextRequest, response?: NextResponse) {
  if (decision.type === "load-session") {
    throw new Error("Authentication session must be loaded before resolving a middleware response.");
  }

  if (decision.type === "next") {
    return response ?? NextResponse.next({ request });
  }

  if (decision.type === "redirect-after-login") {
    return NextResponse.redirect(new URL(decision.nextPath, request.url));
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/login";
  redirectUrl.search = "";
  redirectUrl.searchParams.set("next", decision.nextPath);
  return NextResponse.redirect(redirectUrl);
}
