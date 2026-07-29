import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import { responseForAuthDecision } from "./middlewareResponse";

function createSupabaseResponse(request: NextRequest) {
  const response = NextResponse.next({ request });
  response.cookies.set({
    name: "sb-example-auth-token.0",
    value: "refreshed-session",
    path: "/",
    sameSite: "lax",
    secure: true
  });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("X-Unrelated", "must-not-propagate");
  return response;
}

describe("responseForAuthDecision", () => {
  it("preserves Supabase refresh cookies and auth cache headers on redirect-after-login", () => {
    const request = new NextRequest("https://morpho.example/login?next=%2Fprojects%2Fproject-a");
    const response = responseForAuthDecision(
      { type: "redirect-after-login", nextPath: "/projects/project-a" },
      request,
      createSupabaseResponse(request)
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://morpho.example/projects/project-a");
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

  it("preserves stale-session cleanup cookies on the single redirect to login", () => {
    const request = new NextRequest("https://morpho.example/projects/project-a?view=canvas");
    const source = createSupabaseResponse(request);
    source.cookies.set({
      name: "sb-example-auth-token.0",
      value: "",
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: true
    });

    const response = responseForAuthDecision(
      { type: "redirect-to-login", nextPath: "/projects/project-a?view=canvas" },
      request,
      source
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://morpho.example/login?next=%2Fprojects%2Fproject-a%3Fview%3Dcanvas"
    );
    expect(response.cookies.get("sb-example-auth-token.0")).toMatchObject({ value: "", maxAge: 0, path: "/" });
  });

  it("returns the original response for non-redirect decisions", () => {
    const request = new NextRequest("https://morpho.example/login");
    const source = createSupabaseResponse(request);

    expect(responseForAuthDecision({ type: "next" }, request, source)).toBe(source);
  });
});
