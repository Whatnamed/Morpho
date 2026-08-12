import { describe, expect, it, vi } from "vitest";

import { createClient } from "@supabase/supabase-js";
import { loadSupabasePrivilegedConfig } from "./privilegedEnv";
import { createPrivilegedServerSupabaseClient } from "./privilegedServer";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: vi.fn() }))
}));

describe("Supabase privileged server configuration", () => {
  it("fails closed without the server-only secret", () => {
    const result = loadSupabasePrivilegedConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co"
    });

    expect(result).toEqual({
      status: "failed",
      reason: "Supabase privileged server configuration is unavailable."
    });
    expect(JSON.stringify(result)).not.toContain("SUPABASE_SECRET_KEY");
  });

  it("fails closed when a publishable key is supplied as the privileged secret", () => {
    const result = loadSupabasePrivilegedConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "sb_publishable_test"
    });

    expect(result).toEqual({
      status: "failed",
      reason: "Supabase privileged server configuration is unavailable."
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("creates a cookie-free client with session persistence disabled", () => {
    const result = createPrivilegedServerSupabaseClient({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_test"
    });

    expect(result.status).toBe("ok");
    expect(vi.mocked(createClient)).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "sb_secret_test",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    );
  });
});
