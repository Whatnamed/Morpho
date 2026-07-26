import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "out/**",
    "dist/**",
    "coverage/**",
    "next-env.d.ts",
    "worker-configuration.d.ts",
    // Design-system reference export (docs/design/README.md) — not app code.
    "docs/design/design-system/**"
  ])
]);
