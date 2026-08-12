import { createAgentTurnWebSearchActionPostHandler } from "./handler";

export const runtime = "nodejs";
export const POST = createAgentTurnWebSearchActionPostHandler();
