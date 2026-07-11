"use client";

import { ArrowRight, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  navigateAfterAuthentication,
  isAuthSubmissionDisabled,
  submitEmailPasswordAuth,
  type EmailPasswordAuthMode
} from "@/features/auth/emailPasswordAuth";
import { createBrowserSupabaseClient } from "@/infrastructure/supabase/browser";

type LoginClientProps = {
  nextPath: string;
  configError?: string;
};

export function LoginClient({ nextPath, configError }: LoginClientProps) {
  const router = useRouter();
  const [mode, setMode] = useState<EmailPasswordAuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(configError ?? null);
  const [isPending, startTransition] = useTransition();

  const changeMode = (nextMode: EmailPasswordAuthMode) => {
    setMode(nextMode);
    setPassword("");
    setPasswordConfirmation("");
    setError(configError ?? null);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        const result = await submitEmailPasswordAuth(supabase, {
          mode,
          email,
          password,
          passwordConfirmation
        });

        if (result.status === "error") {
          setError(result.message);
          return;
        }

        if (result.status === "confirmation-required") {
          setError("账号已创建，但 Supabase 当前仍要求邮箱确认。请检查 Authentication 的 Confirm email 设置。");
          return;
        }

        navigateAfterAuthentication(router.replace, nextPath);
      } catch {
        setError("服务暂时不可用，请稍后重试。");
      }
    });
  };

  return (
    <main className="login-page">
      <section className="login-card" aria-label="Morpho 账号访问">
        <div className="login-mark">
          <span>M</span>
        </div>
        <p className="login-eyebrow">Morpho</p>
        <h1>{mode === "sign-in" ? "登录以继续你的项目" : "创建 Morpho 账号"}</h1>
        <p className="login-copy">
          {mode === "sign-in" ? "使用你的邮箱和密码访问 Morpho。" : "使用邮箱和密码开始。"} 项目、画布、图片和文件仍保存在当前浏览器本地。
        </p>

        <div className="login-mode-switch" aria-label="账号操作">
          <button type="button" aria-pressed={mode === "sign-in"} onClick={() => changeMode("sign-in")}>
            登录
          </button>
          <button type="button" aria-pressed={mode === "sign-up"} onClick={() => changeMode("sign-up")}>
            注册
          </button>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label>
            邮箱
            <input
              autoComplete="email"
              inputMode="email"
              name="email"
              placeholder="name@example.com"
              spellCheck={false}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
            />
          </label>
          <label>
            密码
            <input
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              name="password"
              placeholder={mode === "sign-in" ? "输入密码" : "设置密码"}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
            />
          </label>
          {mode === "sign-up" ? (
            <label>
              确认密码
              <input
                autoComplete="new-password"
                name="password-confirmation"
                placeholder="再次输入密码"
                type="password"
                value={passwordConfirmation}
                onChange={(event) => setPasswordConfirmation(event.currentTarget.value)}
                required
              />
            </label>
          ) : null}

          {error ? (
            <div className="login-error" role="alert">
              <LockKeyhole size={15} />
              {error}
            </div>
          ) : null}

          <button className="brand-button login-submit" type="submit" disabled={isAuthSubmissionDisabled(isPending, configError)}>
            {mode === "sign-in" ? "登录" : "创建账号"}
            <ArrowRight size={15} />
          </button>
        </form>

        <p className="login-mode-copy">
          {mode === "sign-in" ? "首次使用？" : "已有账号？"}
          <button type="button" onClick={() => changeMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
            {mode === "sign-in" ? "创建账号" : "登录"}
          </button>
        </p>
      </section>
    </main>
  );
}
