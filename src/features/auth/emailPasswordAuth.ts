export type EmailPasswordAuthMode = "sign-in" | "sign-up";

type AuthError = {
  message: string;
  code?: string;
};

type AuthResponse = {
  data: {
    session: unknown | null;
    user: {
      identities?: unknown[] | null;
    } | null;
  };
  error: AuthError | null;
};

export type EmailPasswordAuthClient = {
  auth: {
    signInWithPassword(credentials: { email: string; password: string }): Promise<AuthResponse>;
    signUp(credentials: { email: string; password: string }): Promise<AuthResponse>;
  };
};

export type EmailPasswordAuthInput = {
  mode: EmailPasswordAuthMode;
  email: string;
  password: string;
  passwordConfirmation: string;
};

export type EmailPasswordAuthOutcome =
  | { status: "authenticated" }
  | { status: "signup-submitted"; message: string }
  | { status: "error"; message: string };

export const GENERIC_SIGNUP_MESSAGE =
  "如果该邮箱可以用于注册或需要进一步确认，请检查邮箱；你也可以尝试登录。";

export async function submitEmailPasswordAuth(
  client: EmailPasswordAuthClient,
  input: EmailPasswordAuthInput
): Promise<EmailPasswordAuthOutcome> {
  const email = input.email.trim();
  const validationError = validateEmailPasswordAuth(input.mode, email, input.password, input.passwordConfirmation);
  if (validationError) {
    return { status: "error", message: validationError };
  }

  const response =
    input.mode === "sign-in"
      ? await client.auth.signInWithPassword({ email, password: input.password })
      : await client.auth.signUp({ email, password: input.password });

  if (response.error) {
    if (input.mode === "sign-up" && isExistingIdentitySignupError(response.error)) {
      return { status: "signup-submitted", message: GENERIC_SIGNUP_MESSAGE };
    }
    return { status: "error", message: mapAuthError(response.error.message, input.mode) };
  }

  if (response.data.session) {
    return { status: "authenticated" };
  }

  if (input.mode === "sign-up") {
    return { status: "signup-submitted", message: GENERIC_SIGNUP_MESSAGE };
  }

  return { status: "error", message: "服务暂时不可用，请稍后重试。" };
}

export function navigateAfterAuthentication(navigate: (path: string) => void, nextPath: string): void {
  navigate(nextPath);
}

export function isAuthSubmissionDisabled(isPending: boolean, configError?: string): boolean {
  return isPending || Boolean(configError);
}

function validateEmailPasswordAuth(
  mode: EmailPasswordAuthMode,
  email: string,
  password: string,
  passwordConfirmation: string
): string | null {
  if (!email) {
    return "请输入邮箱。";
  }

  if (!password) {
    return "请输入密码。";
  }

  if (mode === "sign-up" && password !== passwordConfirmation) {
    return "两次输入的密码不一致，请重新输入。";
  }

  return null;
}

function mapAuthError(message: string, mode: EmailPasswordAuthMode): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("password") && (normalized.includes("weak") || normalized.includes("least") || normalized.includes("short"))) {
    return "密码不符合 Supabase 当前的安全要求，请调整后重试。";
  }

  if (mode === "sign-up" && normalized.includes("email") && (normalized.includes("invalid") || normalized.includes("format"))) {
    return "邮箱格式无效，请检查后重试。";
  }

  if (mode === "sign-in" && (normalized.includes("invalid") || normalized.includes("credential") || normalized.includes("password"))) {
    return "邮箱或密码不正确。";
  }

  if (normalized.includes("disabled") || normalized.includes("blocked") || normalized.includes("not confirmed")) {
    return mode === "sign-up" ? "当前无法创建账号，请稍后重试。" : "当前账号无法使用，请稍后重试。";
  }

  return "服务暂时不可用，请稍后重试。";
}

function isExistingIdentitySignupError(error: AuthError): boolean {
  const code = error.code?.trim().toLowerCase();
  if (code === "user_already_exists" || code === "email_exists") return true;
  const message = error.message.toLowerCase();
  return message.includes("already") && (message.includes("registered") || message.includes("exists"));
}
