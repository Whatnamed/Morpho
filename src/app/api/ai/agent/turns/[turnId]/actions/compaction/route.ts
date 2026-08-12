import { createAgentTurnCompactionActionPostHandler } from "./handler";

export const runtime = "nodejs";
export const POST = createAgentTurnCompactionActionPostHandler();
