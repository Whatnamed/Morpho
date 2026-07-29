import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import {
  applyProxySupabaseCookieUpdates,
  clearProxySupabaseAuthCookies,
  getSupabaseAuthStorageKey
} from "./server";

describe("Supabase proxy cookie handling", () => {
  it("applies refreshed cookies and only the required auth cache headers", () => {
    const request = new NextRequest("https://morpho.example/projects/project-a");
    const response = NextResponse.next({ request });

    applyProxySupabaseCookieUpdates(
      request,
      response,
      [
        {
          name: "sb-example-auth-token.0",
          value: "refreshed-session",
          options: { path: "/", sameSite: "lax", secure: true }
        }
      ],
      {
        "Cache-Control": "private, no-store",
        Expires: "0",
        Pragma: "no-cache",
        "X-Unrelated": "must-not-propagate"
      }
    );

    expect(request.cookies.get("sb-example-auth-token.0")?.value).toBe("refreshed-session");
    expect(response.cookies.get("sb-example-auth-token.0")).toMatchObject({
      value: "refreshed-session",
      path: "/",
      sameSite: "lax",
      secure: true
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-unrelated")).toBeNull();
  });

  it("expires only this project's exact auth cookie roots and numeric chunks", async () => {
    const request = new NextRequest("https://morpho.example/projects/project-a", {
      headers: {
        cookie: [
          "sb-example-auth-token.0=stale-a",
          "sb-example-auth-token.1=stale-b",
          "sb-example-auth-token-code-verifier.0=stale-verifier",
          "sb-example-auth-token-user=stale-user",
          "sb-example-auth-token.backup=keep",
          "sb-other-auth-token=keep",
          "morpho-preference=keep"
        ].join("; ")
      }
    });
    const response = NextResponse.next({ request });

    await clearProxySupabaseAuthCookies(request, response, "https://example.supabase.co");

    const cleared = response.cookies.getAll();
    expect(cleared.map(({ name }) => name).sort()).toEqual(
      [
        "sb-example-auth-token.0",
        "sb-example-auth-token.1",
        "sb-example-auth-token-code-verifier.0",
        "sb-example-auth-token-user"
      ].sort()
    );
    for (const cookie of cleared) {
      expect(cookie.value).toBe("");
      expect(cookie.maxAge).toBe(0);
      expect(cookie.path).toBe("/");
      expect(cookie.sameSite).toBe("lax");
      expect(cookie.secure).toBe(true);
      expect(cookie.httpOnly ?? false).toBe(false);
    }
    expect(response.cookies.get("sb-example-auth-token.backup")).toBeUndefined();
    expect(response.cookies.get("sb-other-auth-token")).toBeUndefined();
    expect(response.cookies.get("morpho-preference")).toBeUndefined();
    expect(request.cookies.get("morpho-preference")?.value).toBe("keep");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("derives the exact public Supabase auth storage key without accepting unrelated cookie names", () => {
    expect(getSupabaseAuthStorageKey("https://example.supabase.co")).toBe("sb-example-auth-token");
  });
});
