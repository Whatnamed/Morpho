import { ProjectHomeClient } from "@/features/projects/ProjectHomeClient";
import { isAuthRequired } from "@/infrastructure/supabase/env";
import { getCurrentAccountAccess } from "@/server/auth/accountAccess";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const account = await getCurrentAccountAccess();

  // MORPHO_AUTH_REQUIRED=false is the documented local bypass: the local-first
  // home must stay reachable without a Supabase session in that mode.
  if (account.status === "unauthenticated" && isAuthRequired(process.env)) {
    redirect("/login?next=/");
  }

  return (
    <ProjectHomeClient
      account={account.status === "ok" ? account.account : null}
      accessError={account.status === "unavailable" ? account.reason : undefined}
      authRequired={isAuthRequired(process.env)}
    />
  );
}
