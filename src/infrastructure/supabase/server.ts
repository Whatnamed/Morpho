import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

import { loadSupabasePublicConfig } from "./env";

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
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        }
      }
    })
  };
}
