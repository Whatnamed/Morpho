export function withPreservedNextBuildDirectory(
  projectRoot: string,
  build: () => void | Promise<void>
): Promise<void>;
