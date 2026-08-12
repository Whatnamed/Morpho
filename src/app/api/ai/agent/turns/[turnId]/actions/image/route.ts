import { createAgentTurnImageActionPostHandler } from "./handler";

export const runtime = "nodejs";
export const POST = createAgentTurnImageActionPostHandler();
