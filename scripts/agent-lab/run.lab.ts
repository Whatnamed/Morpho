import { expect, test } from "vitest";

import { runAgentLab, type AgentLabRunOptions } from "./run";

test("Agent Lab", async () => {
  const options = JSON.parse(process.env.MORPHO_AGENT_LAB_RUN ?? "null") as AgentLabRunOptions | null;
  if (!options) throw new Error("Start the runner with npm run agent:lab.");
  const { record, recordPath } = await runAgentLab(options);
  process.stdout.write(`Agent Lab ${record.mode} / ${record.profile.name}: ${recordPath}\n`);
  expect(record.error).toBeNull();
  if (options.mode === "preview") expect(record.preview).toBeDefined();
  else {
    expect(record.providerAttempts).toBeGreaterThan(0);
    expect(record.final?.outcome).toMatch(/^(success|partialSuccess|pendingConfirmation)$/);
  }
});
