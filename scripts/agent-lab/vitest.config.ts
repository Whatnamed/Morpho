import { defineConfig } from "vitest/config";
import base from "../../vitest.config";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["scripts/agent-lab/run.lab.ts"],
    testTimeout: 900_000
  }
});
