"use client";

import { createBrowserClient } from "@supabase/ssr";

import { loadSupabasePublicConfig } from "./env";

export function createBrowserSupabaseClient() {
  const config = loadSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  });

  if (config.status === "failed") {
    throw new Error(config.reason);
  }

  return createBrowserClient(config.url, config.publishableKey);
}
