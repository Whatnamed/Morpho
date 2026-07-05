import { WorkspaceClient } from "@/features/workspace/WorkspaceClient";
import { getCurrentAccountAccess } from "@/server/auth/accountAccess";
import { redirect } from "next/navigation";

type ProjectWorkspacePageProps = {
  params: Promise<{
    projectId: string;
  }>;
};

export default async function ProjectWorkspacePage({ params }: ProjectWorkspacePageProps) {
  const { projectId } = await params;
  const account = await getCurrentAccountAccess();

  if (account.status === "unauthenticated") {
    redirect(`/login?next=/projects/${encodeURIComponent(projectId)}`);
  }

  if (account.status !== "ok" || account.account.accessStatus !== "active") {
    redirect("/");
  }

  return <WorkspaceClient projectId={projectId} />;
}
