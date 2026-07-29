import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/supabase/server")>();
  return {
    ...actual,
    createProxySupabaseClient: vi.fn()
  };
});

import {
  applyProxySupabaseCookieUpdates,
  createProxySupabaseClient
} from "@/infrastructure/supabase/server";
import { middleware } from "./middleware";

const createProxySupabaseClientMock = vi.mocked(createProxySupabaseClient);

describe("authentication middleware recovery", () => {
  beforeEach(() => {
    vi.stubEnv("MORPHO_AUTH_REQUIRED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
    createProxySupabaseClientMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("clears one terminal stale session, then treats the next clean request as ordinary anonymous traffic", async () => {
    const getUser = vi
      .fn()
      .mockResolvedValueOnce({
        data: { user: null },
        error: {
          name: "AuthApiError",
          code: "refresh_token_not_found",
          status: 400,
          message: "Invalid Refresh Token: Refresh Token Not Found"
        }
      })
      .mockResolvedValueOnce({
        data: { user: null },
        error: { name: "AuthSessionMissingError" }
      });
    createProxySupabaseClientMock.mockImplementation(
      () => ({ status: "ok", client: { auth: { getUser } } }) as never
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const first = await middleware(
      new NextRequest("https://morpho.example/projects/project-a", {
        headers: { cookie: "sb-example-auth-token.0=stale-session; morpho-preference=keep" }
      })
    );
    const second = await middleware(new NextRequest("https://morpho.example/projects/project-a"));

    expect(first.headers.get("location")).toBe("https://morpho.example/login?next=%2Fprojects%2Fproject-a");
    expect(first.cookies.get("sb-example-auth-token.0")).toMatchObject({ value: "", maxAge: 0, path: "/" });
    expect(first.cookies.get("morpho-preference")).toBeUndefined();
    expect(second.headers.get("location")).toBe("https://morpho.example/login?next=%2Fprojects%2Fproject-a");
    expect(second.cookies.getAll()).toEqual([]);
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("preserves a refreshed session cookie when an authenticated login request redirects", async () => {
    createProxySupabaseClientMock.mockImplementation((request, response) => {
      applyProxySupabaseCookieUpdates(
        request,
        response,
        [
          {
            name: "sb-example-auth-token.0",
            value: "rotated-session",
            options: { path: "/", sameSite: "lax", secure: true }
          }
        ],
        {
          "Cache-Control": "private, no-store",
          Expires: "0",
          Pragma: "no-cache"
        }
      );
      return {
        status: "ok",
        client: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: {} }, error: null }) } }
      } as never;
    });

    const response = await middleware(
      new NextRequest("https://morpho.example/login?next=%2Fprojects%2Fproject-a")
    );

    expect(response.headers.get("location")).toBe("https://morpho.example/projects/project-a");
    expect(response.cookies.get("sb-example-auth-token.0")).toMatchObject({
      value: "rotated-session",
      path: "/",
      sameSite: "lax",
      secure: true
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("fails closed without clearing cookies when an unknown auth error occurs", async () => {
    createProxySupabaseClientMock.mockImplementation(
      () => ({
        status: "ok",
        client: {
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: null },
              error: Object.assign(new Error("network detail must stay private"), { name: "AuthRetryableFetchError" })
            })
          }
        }
      }) as never
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await middleware(
      new NextRequest("https://morpho.example/projects/project-a", {
        headers: { cookie: "sb-example-auth-token.0=still-owned-by-sdk" }
      })
    );

    expect(response.headers.get("location")).toBe("https://morpho.example/login?next=%2Fprojects%2Fproject-a");
    expect(response.cookies.getAll()).toEqual([]);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog.mock.calls[0]?.[0]).toBe(
      JSON.stringify({
        event: "morpho_auth_session_load_failed",
        kind: "unknown",
        name: "AuthRetryableFetchError"
      })
    );
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain("network detail");
  });

  it("does not let a concurrent temporary refresh failure clear another request's rotated session", async () => {
    let releaseRequests: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    let requestIndex = 0;
    createProxySupabaseClientMock.mockImplementation((request, response) => {
      const currentIndex = requestIndex++;
      if (currentIndex === 0) {
        applyProxySupabaseCookieUpdates(
          request,
          response,
          [
            {
              name: "sb-example-auth-token.0",
              value: "rotated-session",
              options: { path: "/", sameSite: "lax", secure: true }
            }
          ],
          { "Cache-Control": "private, no-store", Expires: "0", Pragma: "no-cache" }
        );
      }

      return {
        status: "ok",
        client: {
          auth: {
            getUser: vi.fn(async () => {
              await barrier;
              return currentIndex === 0
                ? { data: { user: {} }, error: null }
                : {
                    data: { user: null },
                    error: Object.assign(new Error("temporary network failure"), {
                      name: "AuthRetryableFetchError"
                    })
                  };
            })
          }
        }
      } as never;
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const staleCookie = "sb-example-auth-token.0=same-stale-session";

    const successfulRequest = middleware(
      new NextRequest("https://morpho.example/projects/project-a", { headers: { cookie: staleCookie } })
    );
    const temporaryFailureRequest = middleware(
      new NextRequest("https://morpho.example/projects/project-a", { headers: { cookie: staleCookie } })
    );
    releaseRequests?.();
    const [successfulResponse, temporaryFailureResponse] = await Promise.all([
      successfulRequest,
      temporaryFailureRequest
    ]);

    expect(successfulResponse.status).toBe(200);
    expect(successfulResponse.cookies.get("sb-example-auth-token.0")?.value).toBe("rotated-session");
    expect(temporaryFailureResponse.headers.get("location")).toBe(
      "https://morpho.example/login?next=%2Fprojects%2Fproject-a"
    );
    expect(temporaryFailureResponse.cookies.getAll()).toEqual([]);
  });

  it("keeps authentication-disabled and missing-configuration behavior intact", async () => {
    vi.stubEnv("MORPHO_AUTH_REQUIRED", "false");
    const disabled = await middleware(new NextRequest("https://morpho.example/projects/project-a"));
    expect(disabled.status).toBe(200);
    expect(disabled.headers.get("location")).toBeNull();
    expect(createProxySupabaseClientMock).not.toHaveBeenCalled();

    vi.stubEnv("MORPHO_AUTH_REQUIRED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const missing = await middleware(new NextRequest("https://morpho.example/projects/project-a"));
    expect(missing.headers.get("location")).toBe("https://morpho.example/login?next=%2Fprojects%2Fproject-a");
    expect(createProxySupabaseClientMock).not.toHaveBeenCalled();
  });
});
