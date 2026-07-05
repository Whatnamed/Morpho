"use client";

import { ArrowRight, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createBrowserSupabaseClient } from "@/infrastructure/supabase/browser";

type LoginClientProps = {
  nextPath: string;
  configError?: string;
};

export function LoginClient({ nextPath, configError }: LoginClientProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(configError ?? null);
  const [isPending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        const result = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });

        if (result.error) {
          setError(mapLoginError(result.error.message));
          return;
        }

        router.push(nextPath);
        router.refresh();
      } catch {
        setError("服务暂时不可用，请稍后重试。");
      }
    });
  };

  return (
    <main className="login-page">
      <section className="login-card" aria-label="Morpho 封闭测试登录">
        <div className="login-mark">
          <span>M</span>
        </div>
        <p className="login-eyebrow">Morpho 封闭测试</p>
        <h1>使用受邀测试账号登录</h1>
        <p className="login-copy">账号仅用于进入产品与保护 AI 调用额度。项目、画布、图片和文件仍保存在当前浏览器本地。</p>

        <form className="login-form" onSubmit={submit}>
          <label>
            邮箱
            <input
              autoComplete="email"
              inputMode="email"
              name="email"
              placeholder="name@example.com"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
            />
          </label>
          <label>
            密码
            <input
              autoComplete="current-password"
              name="password"
              placeholder="输入测试账号密码"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
            />
          </label>

          {error ? (
            <div className="login-error" role="alert">
              <LockKeyhole size={15} />
              {error}
            </div>
          ) : null}

          <button className="brand-button login-submit" type="submit" disabled={isPending || Boolean(configError)}>
            登录
            <ArrowRight size={15} />
          </button>
        </form>
      </section>
    </main>
  );
}

function mapLoginError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid") || normalized.includes("credential") || normalized.includes("password")) {
    return "邮箱或密码不正确。";
  }

  if (normalized.includes("disabled") || normalized.includes("blocked") || normalized.includes("not confirmed")) {
    return "当前账号无法使用，请联系项目管理员。";
  }

  return "服务暂时不可用，请稍后重试。";
}
