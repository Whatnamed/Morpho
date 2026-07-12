import { NextResponse, type NextRequest } from "next/server";

import { isAuthRequired } from "@/infrastructure/supabase/env";
import { createProxySupabaseClient } from "@/infrastructure/supabase/server";
import { sanitizeNextPath } from "@/server/auth/redirects";

export async function middleware(request: NextRequest) {
  if (!isAuthRequired(process.env)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request
  });
  const supabase = createProxySupabaseClient(request, response);
  if (supabase.status === "failed") {
    return response;
  }

  const {
    data: { user }
  } = await supabase.client.auth.getUser();
  const pathname = request.nextUrl.pathname;

  if (!user && pathname !== "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", sanitizeNextPath(`${pathname}${request.nextUrl.search}`));
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL(sanitizeNextPath(request.nextUrl.searchParams.get("next") ?? undefined), request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|auth|_next/static|_next/image|favicon.ico).*)"]
};
