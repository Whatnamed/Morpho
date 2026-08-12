import { createAgentTurnPostHandler } from "./handler";

export const runtime = "nodejs";
export const POST = createAgentTurnPostHandler();
