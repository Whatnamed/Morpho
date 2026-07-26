"use client";

import { parseProjectIdFromPathname } from "@/features/workspace/crashRecoveryTarget";
import { WorkspaceCrashRecovery } from "@/features/workspace/WorkspaceCrashRecovery";

import "./globals.css";

/**
 * Replaces the root layout when rendering fails above it, so it owns
 * `<html>`/`<body>` and cannot inherit the layout's stylesheet import.
 *
 * The project id comes from the URL rather than route params: this boundary can
 * catch a failure that happened before the route segment resolved, and the
 * export path only needs a localStorage key.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body>
        <WorkspaceCrashRecovery projectId={readProjectIdFromLocation()} onRetry={reset} />
      </body>
    </html>
  );
}

function readProjectIdFromLocation(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return parseProjectIdFromPathname(window.location.pathname);
}
