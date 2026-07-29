import { NextResponse, type NextRequest } from "next/server";

import { copyProxySupabaseResponseState } from "@/infrastructure/supabase/server";
import type { AuthRouteDecision } from "./middlewareAccess";

export function responseForAuthDecision(
  decision: AuthRouteDecision,
  request: NextRequest,
  response?: NextResponse
): NextResponse {
  if (decision.type === "load-session") {
    throw new Error("Authentication session must be loaded before resolving a middleware response.");
  }

  if (decision.type === "next") {
    return response ?? NextResponse.next({ request });
  }

  if (decision.type === "redirect-after-login") {
    return withSupabaseResponseState(NextResponse.redirect(new URL(decision.nextPath, request.url)), response);
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/login";
  redirectUrl.search = "";
  redirectUrl.searchParams.set("next", decision.nextPath);
  return withSupabaseResponseState(NextResponse.redirect(redirectUrl), response);
}

function withSupabaseResponseState(target: NextResponse, source?: NextResponse): NextResponse {
  return source ? copyProxySupabaseResponseState(source, target) : target;
}
