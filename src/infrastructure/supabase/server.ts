import { clearAuthCookiesAtScopes, createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

import { loadSupabasePublicConfig } from "./env";

const SUPABASE_AUTH_RESPONSE_HEADER_NAMES = ["cache-control", "expires", "pragma"] as const;
const SUPABASE_AUTH_NO_CACHE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache"
} as const;

type SupabaseCookieUpdate = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function createServerSupabaseClient() {
  const config = loadSupabasePublicConfig(process.env);
  if (config.status === "failed") {
    return config;
  }

  const cookieStore = await cookies();
  return {
    status: "ok" as const,
    client: createServerClient(config.url, config.publishableKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot set cookies; proxy and route handlers refresh them.
          }
        }
      }
    })
  };
}

export function createProxySupabaseClient(request: NextRequest, response: NextResponse) {
  const config = loadSupabasePublicConfig(process.env);
  if (config.status === "failed") {
    return config;
  }

  return {
    status: "ok" as const,
    client: createServerClient(config.url, config.publishableKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          applyProxySupabaseCookieUpdates(request, response, cookiesToSet, headers);
        }
      }
    })
  };
}

export function applyProxySupabaseCookieUpdates(
  request: NextRequest,
  response: NextResponse,
  cookiesToSet: SupabaseCookieUpdate[],
  headers: Record<string, string>
): void {
  cookiesToSet.forEach(({ name, value, options }) => {
    request.cookies.set(name, value);
    response.cookies.set(name, value, options);
  });

  copySupabaseAuthResponseHeaders(headers, response.headers);
}

export async function clearProxySupabaseAuthCookies(
  request: NextRequest,
  response: NextResponse,
  supabaseUrl: string,
  originalCookieNames: readonly string[] = request.cookies.getAll().map(({ name }) => name)
): Promise<void> {
  const storageKey = getSupabaseAuthStorageKey(supabaseUrl);
  const cookieRoots = [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`];
  const scopes: Array<Partial<CookieOptions>> = [
    {
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      secure: isSecureProxyRequest(request)
    }
  ];

  for (const cookieRoot of cookieRoots) {
    await clearAuthCookiesAtScopes({
      getAll: () => originalCookieNames.map((name) => ({ name, value: "" })),
      setAll: (cookiesToSet, headers) => applyProxySupabaseCookieUpdates(request, response, cookiesToSet, headers),
      storageKey: cookieRoot,
      scopes
    });
  }

  copySupabaseAuthResponseHeaders(SUPABASE_AUTH_NO_CACHE_HEADERS, response.headers);
}

function isSecureProxyRequest(request: NextRequest): boolean {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return (
    process.env.VERCEL === "1" ||
    request.nextUrl.protocol === "https:" ||
    new URL(request.url).protocol === "https:" ||
    forwardedProtocol === "https"
  );
}

export function getSupabaseAuthStorageKey(supabaseUrl: string): string {
  const hostnamePrefix = new URL(supabaseUrl).hostname.split(".")[0];
  return `sb-${hostnamePrefix}-auth-token`;
}

export function copyProxySupabaseResponseState(source: NextResponse, target: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  copySupabaseAuthResponseHeaders(source.headers, target.headers);
  return target;
}

function copySupabaseAuthResponseHeaders(source: Headers | Record<string, string>, target: Headers): void {
  for (const headerName of SUPABASE_AUTH_RESPONSE_HEADER_NAMES) {
    const value = source instanceof Headers ? source.get(headerName) : getHeaderValue(source, headerName);
    if (value) {
      target.set(headerName, value);
    }
  }
}

function getHeaderValue(headers: Record<string, string>, targetName: string): string | undefined {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === targetName);
  return entry?.[1];
}
