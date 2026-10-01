import { createAgentTurnRequestPostHandler } from "./handler";

export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = createAgentTurnRequestPostHandler();
