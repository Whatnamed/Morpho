import { describe, expect, it, vi } from "vitest";

import {
  isAuthSubmissionDisabled,
  GENERIC_SIGNUP_MESSAGE,
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
    ).resolves.toEqual({ status: "error", message: "两次输入的密码不一致，请重新输入。" });

    expect(client.auth.signUp).not.toHaveBeenCalled();
  });

  it("returns the same signup envelope for a new account awaiting confirmation and an obfuscated existing account", async () => {
    const newAccountClient = createClient({
      signUp: vi.fn().mockResolvedValue({ data: { session: null, user: { identities: [{}] } }, error: null })
    });
    const obfuscatedExistingClient = createClient({
      signUp: vi.fn().mockResolvedValue({ data: { session: null, user: { identities: [] } }, error: null })
    });
    const input = {
      mode: "sign-up" as const,
      email: "tester@example.com",
      password: "password",
      passwordConfirmation: "password"
    };

    const newAccountOutcome = await submitEmailPasswordAuth(newAccountClient, input);
    const existingAccountOutcome = await submitEmailPasswordAuth(obfuscatedExistingClient, input);

    expect(newAccountOutcome).toEqual({ status: "signup-submitted", message: GENERIC_SIGNUP_MESSAGE });
    expect(existingAccountOutcome).toEqual(newAccountOutcome);
  });

  it("normalizes an explicit existing-email error to the same signup envelope", async () => {
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
    ).resolves.toEqual({ status: "signup-submitted", message: GENERIC_SIGNUP_MESSAGE });
  });

  it("normalizes alternate duplicate wording without relying on one provider message", async () => {
    const client = createClient({
      signUp: vi.fn().mockResolvedValue({
        data: { session: null, user: null },
        error: { message: "A user with this email address has already been registered" }
      })
    });

    await expect(
      submitEmailPasswordAuth(client, {
        mode: "sign-up",
        email: "tester@example.com",
        password: "password",
        passwordConfirmation: "password"
      })
    ).resolves.toEqual({ status: "signup-submitted", message: GENERIC_SIGNUP_MESSAGE });
  });

  it("keeps weak-password failures actionable without exposing account existence", async () => {
    const client = createClient({
      signUp: vi.fn().mockResolvedValue({
        data: { session: null, user: null },
        error: { message: "Password should be at least 8 characters", code: "weak_password" }
      })
    });

    await expect(
      submitEmailPasswordAuth(client, {
        mode: "sign-up",
        email: "tester@example.com",
        password: "short",
        passwordConfirmation: "short"
      })
    ).resolves.toEqual({
      status: "error",
      message: "密码不符合 Supabase 当前的安全要求，请调整后重试。"
    });
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
