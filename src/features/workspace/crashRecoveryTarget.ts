/**
 * Which project a crash surface can offer to export.
 *
 * `global-error.tsx` replaces the root layout, so route params are not
 * available to it — the pathname is the only thing left that identifies the
 * project. Reading it has to stay conservative: offering an export for the
 * wrong project id would produce a backup of something the user did not ask
 * for, which is worse than offering no export at all.
 */
export function parseProjectIdFromPathname(pathname: string): string | undefined {
  const match = /^\/projects\/([^/?#]+)/.exec(pathname);
  const encoded = match?.[1];
  if (!encoded) {
    return undefined;
  }

  let projectId = encoded;
  try {
    projectId = decodeURIComponent(encoded);
  } catch {
    // A malformed escape means the segment is not a project id we wrote.
    return undefined;
  }

  return projectId.length > 0 ? projectId : undefined;
}
