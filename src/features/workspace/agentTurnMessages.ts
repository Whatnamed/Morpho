import type {
  AgentTaskStrategyKind,
  AgentTrace,
  AiMessage,
  AiTaskMode,
  AiWorkIntent,
  MorphoWorkspace
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
          taskStrategy: input.taskStrategy
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
          ...(input.agentTrace ? { agentTrace: input.agentTrace } : {})
        }
      ]
    }
  };
}
