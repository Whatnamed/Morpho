import { describe, expect, it, vi } from "vitest";

import {
  isAuthSubmissionDisabled,
  navigateAfterAuthentication,
  submitEmailPasswordAuth,
  type EmailPasswordAuthClient
} from "./emailPasswordAuth";

function createClient(overrides: Partial<EmailPasswordAuthClient["auth"]> = {}): EmailPasswordAuthClient {
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { access_token: "token" }, user: {} }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { session: { access_token: "token" }, user: { identities: [{}] } }, error: null }),
      ...overrides
    }
  };
}

describe("submitEmailPasswordAuth", () => {
  it("uses signInWithPassword for sign-in and returns an authenticated outcome", async () => {
    const client = createClient();

    await expect(
      submitEmailPasswordAuth(client, {
        mode: "sign-in",
        email: "  owner@example.com ",
        password: "password",
        passwordConfirmation: ""
      })
    ).resolves.toEqual({ status: "authenticated" });

    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: "owner@example.com", password: "password" });
    expect(client.auth.signUp).not.toHaveBeenCalled();
  });

  it("uses signUp for registration and returns an authenticated outcome when Supabase returns a session", async () => {
    const client = createClient();

    await expect(
      submitEmailPasswordAuth(client, {
        mode: "sign-up",
        email: "tester@example.com",
        password: "password",
        passwordConfirmation: "password"
      })
    ).resolves.toEqual({ status: "authenticated" });

    expect(client.auth.signUp).toHaveBeenCalledWith({ email: "tester@example.com", password: "password" });
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("does not call Supabase when registration passwords do not match", async () => {
    const client = createClient();

    await expect(
      submitEmailPasswordAuth(client, {
        mode: "sign-up",
        email: "tester@example.com",
        password: "first",
        passwordConfirmation: "second"
      })
    ).resolves.toEqual({ status: "error", message: "两次输入的密码不一致。" });

    expect(client.auth.signUp).not.toHaveBeenCalled();
  });

  it("reports the email-confirmation configuration fallback when signup has no session", async () => {
    const client = createClient({
      signUp: vi.fn().mockResolvedValue({ data: { session: null, user: { identities: [{}] } }, error: null })
    });

    await expect(
      submitEmailPasswordAuth(client, {
        mode: "sign-up",
        email: "tester@example.com",
        password: "password",
        passwordConfirmation: "password"
      })
    ).resolves.toEqual({ status: "confirmation-required" });
  });

  it("maps existing-email errors to a Chinese sign-in prompt", async () => {
    const client = createClient({
      signUp: vi.fn().mockResolvedValue({ data: { session: null, user: null }, error: { message: "User already registered" } })
    });

    await expect(
      submitEmailPasswordAuth(client, {
        mode: "sign-up",
        email: "tester@example.com",
        password: "password",
        passwordConfirmation: "password"
      })
    ).resolves.toEqual({ status: "error", message: "这个邮箱已经注册，请直接登录。" });
  });
});

describe("navigateAfterAuthentication", () => {
  it("uses one explicit navigation", () => {
    const navigate = vi.fn();

    navigateAfterAuthentication(navigate, "/projects");

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/projects");
  });
});

describe("isAuthSubmissionDisabled", () => {
  it("disables both authentication modes when configuration is unavailable", () => {
    expect(isAuthSubmissionDisabled(false, "Supabase configuration is unavailable")).toBe(true);
    expect(isAuthSubmissionDisabled(true)).toBe(true);
    expect(isAuthSubmissionDisabled(false)).toBe(false);
  });
});
