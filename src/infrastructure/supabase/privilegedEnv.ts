export type SupabasePrivilegedConfig =
  | {
      status: "ok";
      url: string;
      secretKey: string;
    }
  | {
      status: "failed";
      reason: string;
    };

/** Server-only configuration loader; never import this module from a client component. */
export function loadSupabasePrivilegedConfig(
  env: Record<string, string | undefined>
): SupabasePrivilegedConfig {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();

  if (!url || !secretKey || secretKey.startsWith("sb_publishable_")) {
    return {
      status: "failed",
      reason: "Supabase privileged server configuration is unavailable."
    };
  }

  return {
    status: "ok",
    url,
    secretKey
  };
}
