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
