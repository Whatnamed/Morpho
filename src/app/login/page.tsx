import { redirect } from "next/navigation";

import { LoginClient } from "@/features/auth/LoginClient";
import { getCurrentAccountAccess } from "@/server/auth/accountAccess";
import { sanitizeNextPath } from "@/server/auth/redirects";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;
  const nextPath = sanitizeNextPath(next);
  const account = await getCurrentAccountAccess();

  if (account.status === "ok") {
    redirect(nextPath);
  }

  return <LoginClient nextPath={nextPath} configError={account.status === "unavailable" ? account.reason : undefined} />;
}
