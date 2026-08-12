import { createAgentTurnRequestPostHandler } from "./handler";

export const runtime = "nodejs";
export const POST = createAgentTurnRequestPostHandler();
