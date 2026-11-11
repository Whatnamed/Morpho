export function assertCleanWorktree(projectRoot?: string): void;
export function gitSourceSha(projectRoot?: string): string;
export function isWorktreeClean(projectRoot?: string): boolean;
export function worktreeSourceDigest(projectRoot?: string): Promise<{ digest: string; fileCount: number }>;
