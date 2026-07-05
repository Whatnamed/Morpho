import { ProjectHomeClient } from "@/features/projects/ProjectHomeClient";
import { getCurrentAccountAccess } from "@/server/auth/accountAccess";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const account = await getCurrentAccountAccess();

  if (account.status === "unauthenticated") {
    redirect("/login?next=/");
  }

  return (
    <ProjectHomeClient
      account={account.status === "ok" ? account.account : null}
      accessError={account.status === "unavailable" ? account.reason : undefined}
    />
  );
}
