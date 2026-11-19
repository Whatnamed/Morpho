import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";

export const SEED_PAYLOAD_PATH = resolve(process.cwd(), "e2e/.seed/seed.json");
export default async function globalSetup(): Promise<void> {
  const server = await createServer({
    appType: "custom",
    configFile: resolve(process.cwd(), "vitest.config.ts"),
    server: { middlewareMode: true }
  });

  try {
    const seedModule = await server.ssrLoadModule("/e2e/support/seedWorkspace.ts");
    const payload = (seedModule as { buildSeedPayload: () => unknown }).buildSeedPayload();
    await mkdir(dirname(SEED_PAYLOAD_PATH), { recursive: true });
    await writeFile(SEED_PAYLOAD_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    const deliveryModule = await server.ssrLoadModule("/e2e/support/deliveryHandoffSeed.ts");
    await writeFile(resolve(process.cwd(), "e2e/.seed/delivery-handoff.json"), `${JSON.stringify(deliveryModule.buildDeliveryHandoffSeed())}\n`, "utf8");

    const interactionModule = await server.ssrLoadModule("/e2e/support/interactionSeed.ts");
    await writeFile(resolve(process.cwd(), "e2e/.seed/interaction.json"), `${JSON.stringify(interactionModule.buildInteractionSeed())}\n`, "utf8");
  } finally {
    await server.close();
  }
}
