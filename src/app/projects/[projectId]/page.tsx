import { WorkspaceClient } from "@/features/workspace/WorkspaceClient";
import { isAuthRequired } from "@/infrastructure/supabase/env";
import { getCurrentAccountAccess } from "@/server/auth/accountAccess";
import { redirect } from "next/navigation";

type ProjectWorkspacePageProps = {
  params: Promise<{
    projectId: string;
  }>;
};

export default async function ProjectWorkspacePage({ params }: ProjectWorkspacePageProps) {
  const { projectId } = await params;

  // MORPHO_AUTH_REQUIRED=false is the documented local bypass. Projects are
  // local-first, so the workspace itself must not hard-require a Supabase
  // session in that mode; AI routes keep their own server-side guards.
  if (!isAuthRequired(process.env)) {
    return <WorkspaceClient projectId={projectId} />;
  }

  const account = await getCurrentAccountAccess();

  if (account.status === "unauthenticated") {
    redirect(`/login?next=/projects/${encodeURIComponent(projectId)}`);
  }

  if (account.status !== "ok" || account.account.accessStatus !== "active") {
    redirect("/");
  }

  return <WorkspaceClient projectId={projectId} />;
}
