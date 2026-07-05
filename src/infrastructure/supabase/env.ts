export type SupabasePublicConfig =
  | {
      status: "ok";
      url: string;
      publishableKey: string;
    }
  | {
      status: "failed";
      reason: string;
    };

export function loadSupabasePublicConfig(env: Record<string, string | undefined>): SupabasePublicConfig {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    return {
      status: "failed",
      reason: "Supabase 配置缺失：请设置 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY。"
    };
  }

  return {
    status: "ok",
    url,
    publishableKey
  };
}

export function isAuthRequired(env: Record<string, string | undefined>): boolean {
  const value = env.MORPHO_AUTH_REQUIRED?.trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "off" && value !== "no";
}
