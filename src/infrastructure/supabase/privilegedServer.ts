import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadSupabasePrivilegedConfig } from "./privilegedEnv";

export type PrivilegedSupabaseClientResult =
  | {
      status: "ok";
      client: SupabaseClient;
    }
  | {
      status: "failed";
      reason: string;
    };

/**
 * Creates the server-only Supabase client used for provider-derived claims.
 * It deliberately has no SSR cookie adapter or user session state.
 */
export function createPrivilegedServerSupabaseClient(
  env: Record<string, string | undefined> = process.env
): PrivilegedSupabaseClientResult {
  const config = loadSupabasePrivilegedConfig(env);
  if (config.status === "failed") {
    return config;
  }

  return {
    status: "ok",
    client: createClient(config.url, config.secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    })
  };
}
