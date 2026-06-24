import { WorkspaceClient } from "@/features/workspace/WorkspaceClient";

type ProjectWorkspacePageProps = {
  params: Promise<{
    projectId: string;
  }>;
};

export default async function ProjectWorkspacePage({ params }: ProjectWorkspacePageProps) {
  const { projectId } = await params;

  return <WorkspaceClient projectId={projectId} />;
}
