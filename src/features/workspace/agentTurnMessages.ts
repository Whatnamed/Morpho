import type {
  AgentTaskStrategyKind,
  AgentTurnOutcome,
  AgentTrace,
  AiMessage,
  AiTaskMode,
  AiWorkIntent,
  MorphoWorkspace,
  ProviderInputSnapshot
} from "@/domain/morpho/types";

type AppendAgentTurnMessagesInput = {
  userMessageId: string;
  assistantMessageId: string;
  userBody: string;
  assistantBody: string;
  createdAt: string;
  contextObjectIds: string[];
  conversationLaneKey: string;
  workIntent: AiWorkIntent;
  taskMode?: AiTaskMode;
  promptContractVersion?: string;
  taskStrategy?: AgentTaskStrategyKind;
  agentTrace?: AgentTrace;
  contextVisibility?: AiMessage["contextVisibility"];
  providerInputSnapshot?: ProviderInputSnapshot;
  agentTurnId: string;
};

/**
 * Tracks what is still unresolved in a turn instead of whether anything ever
 * failed. A schema repair or a retried read that later succeeds must not leave
 * the whole turn marked partial for every future context.
 */
export type AgentTurnWorkLedger = {
  markUnresolved(key: string, reason: string): void;
  resolveForTool(toolName: string): void;
  unresolvedCount(): number;
  unresolvedReasons(): string[];
};

export function createAgentTurnWorkLedger(): AgentTurnWorkLedger {
  const unresolved = new Map<string, string>();
  return {
    markUnresolved(key, reason) {
      unresolved.set(key, reason);
    },
    resolveForTool(toolName) {
      unresolved.delete(`tool:${toolName}`);
      unresolved.delete(`repair:${toolName}`);
    },
    unresolvedCount() {
      return unresolved.size;
    },
    unresolvedReasons() {
      return [...unresolved.values()];
    }
  };
}

export function resolveAgentTurnOutcome(input: {
  pendingConfirmation: boolean;
  unresolvedCount: number;
  hasToolResult: boolean;
}): Extract<
  AgentTurnOutcome,
  "pendingConfirmation" | "partialSuccess" | "failedBeforeExecution" | "success"
> {
  if (input.pendingConfirmation) {
    return "pendingConfirmation";
  }
  if (input.unresolvedCount === 0) {
    return "success";
  }
  return input.hasToolResult ? "partialSuccess" : "failedBeforeExecution";
}

export function appendAgentTurnMessages(
  workspace: MorphoWorkspace,
  input: AppendAgentTurnMessagesInput
): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: [
        ...workspace.ai.messages,
        {
          id: input.userMessageId,
          role: "user",
          body: input.userBody,
          createdAt: input.createdAt,
          contextObjectIds: input.contextObjectIds,
          taskMode: input.taskMode ?? "chatAnalysis",
          workIntent: input.workIntent,
          contextVisibility: input.contextVisibility ?? "model",
          conversationLaneKey: input.conversationLaneKey,
          promptContractVersion: input.promptContractVersion,
          taskStrategy: input.taskStrategy,
          agentTurnId: input.agentTurnId,
          pairedMessageId: input.assistantMessageId,
          ...(input.providerInputSnapshot ? { providerInputSnapshot: input.providerInputSnapshot } : {})
        },
        {
          id: input.assistantMessageId,
          role: "assistant",
          body: input.assistantBody,
          createdAt: input.createdAt,
          status: "streaming",
          contextObjectIds: input.contextObjectIds,
          taskMode: input.taskMode ?? "chatAnalysis",
          workIntent: input.workIntent,
          contextVisibility: input.contextVisibility ?? "model",
          conversationLaneKey: input.conversationLaneKey,
          promptContractVersion: input.promptContractVersion,
          taskStrategy: input.taskStrategy,
          agentTurnId: input.agentTurnId,
          pairedMessageId: input.userMessageId,
          ...(input.agentTrace ? { agentTrace: input.agentTrace } : {})
        }
      ]
    }
  };
}

export function finalizeAgentTurnOutcome(
  workspace: MorphoWorkspace,
  input: {
    agentTurnId: string;
    userMessageId: string;
    assistantMessageId: string;
    outcome: AgentTurnOutcome;
    summary?: string;
  }
): MorphoWorkspace {
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: workspace.ai.messages.map((message) =>
        message.id === input.userMessageId || message.id === input.assistantMessageId
          ? {
              ...message,
              agentTurnId: input.agentTurnId,
              pairedMessageId: message.id === input.userMessageId
                ? input.assistantMessageId
                : input.userMessageId,
              agentTurnOutcome: input.outcome,
              ...(input.summary ? { agentTurnOutcomeSummary: input.summary } : {})
            }
          : message
      )
    }
  };
}

export function finalizeAgentTurn(
  workspace: MorphoWorkspace,
  input: {
    agentTurnId: string;
    userMessageId: string;
    assistantMessageId: string;
    outcome: AgentTurnOutcome;
    assistantBody: string;
    assistantStatus: Exclude<AiMessage["status"], undefined | "streaming">;
    traceStatus: Exclude<AgentTrace["status"], "streaming">;
    summary?: string;
    completedAt: string;
    responseId?: string;
    providerRequestState?: AgentTrace["providerRequestState"];
  }
): MorphoWorkspace {
  const user = workspace.ai.messages.find((message) => message.id === input.userMessageId);
  const assistant = workspace.ai.messages.find((message) => message.id === input.assistantMessageId);
  if (
    user?.agentTurnOutcome === input.outcome &&
    assistant?.agentTurnOutcome === input.outcome &&
    assistant.status !== "streaming"
  ) {
    return workspace;
  }
  const summary = input.summary?.trim().slice(0, 1_200);
  return {
    ...workspace,
    ai: {
      ...workspace.ai,
      messages: workspace.ai.messages.map((message) => {
        if (message.id !== input.userMessageId && message.id !== input.assistantMessageId) {
          return message;
        }
        if (message.id === input.userMessageId) {
          return {
            ...message,
            agentTurnId: input.agentTurnId,
            pairedMessageId: input.assistantMessageId,
            agentTurnOutcome: input.outcome,
            ...(summary ? { agentTurnOutcomeSummary: summary } : {})
          };
        }
        const agentTrace = message.agentTrace
          ? {
              ...message.agentTrace,
              status: input.traceStatus,
              completedAt: input.completedAt,
              ...(input.responseId ? { responseId: input.responseId } : {}),
              ...(input.providerRequestState ? { providerRequestState: input.providerRequestState } : {})
            }
          : undefined;
        return {
          ...message,
          body: input.assistantBody,
          status: input.assistantStatus,
          agentTurnId: input.agentTurnId,
          pairedMessageId: input.userMessageId,
          agentTurnOutcome: input.outcome,
          ...(summary ? { agentTurnOutcomeSummary: summary } : {}),
          ...(agentTrace ? { agentTrace } : {})
        };
      })
    }
  };
}
