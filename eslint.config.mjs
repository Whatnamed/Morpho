import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    "temp/**",
    "output/**",
    "e2e/.artifacts/**",
    "e2e/.seed/**",
    "out/**",
    "dist/**",
    "coverage/**",
    "next-env.d.ts",
    // Design-system reference export (docs/design/README.md) — not app code.
    "docs/design/design-system/**"
  ])
]);
