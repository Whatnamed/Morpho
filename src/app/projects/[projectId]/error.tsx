"use client";

import { useParams } from "next/navigation";

import { WorkspaceCrashRecovery } from "@/features/workspace/WorkspaceCrashRecovery";

export default function ProjectWorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ projectId: string }>();
  const projectId = typeof params?.projectId === "string" ? params.projectId : undefined;

  return <WorkspaceCrashRecovery projectId={projectId} onRetry={reset} />;
}
