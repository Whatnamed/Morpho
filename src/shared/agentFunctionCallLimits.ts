export const MAX_AGENT_FUNCTION_CALLS = 64;

export class AgentFunctionCallLimitError extends Error {
  constructor(readonly count: number) {
    super(`超过 ${MAX_AGENT_FUNCTION_CALLS} 个工具调用，未执行。`);
    this.name = "AgentFunctionCallLimitError";
  }
}

export function assertAgentFunctionCallCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_AGENT_FUNCTION_CALLS) {
    throw new AgentFunctionCallLimitError(count);
  }
}

export function hasExceededAgentFunctionCallLimit(count: number): boolean {
  return count > MAX_AGENT_FUNCTION_CALLS;
}
