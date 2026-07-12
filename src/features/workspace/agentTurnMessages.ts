import type { AgentTrace, AiWorkIntent, MorphoWorkspace } from "@/domain/morpho/types";

type AppendAgentTurnMessagesInput = {
  userMessageId: string;
  assistantMessageId: string;
  userBody: string;
  assistantBody: string;
  createdAt: string;
  contextObjectIds: string[];
  conversationLaneKey: string;
  workIntent: AiWorkIntent;
  agentTrace?: AgentTrace;
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
          taskMode: "chatAnalysis",
          workIntent: input.workIntent,
          conversationLaneKey: input.conversationLaneKey
        },
        {
          id: input.assistantMessageId,
          role: "assistant",
          body: input.assistantBody,
          createdAt: input.createdAt,
          status: "streaming",
          contextObjectIds: input.contextObjectIds,
          taskMode: "chatAnalysis",
          workIntent: input.workIntent,
          conversationLaneKey: input.conversationLaneKey,
          ...(input.agentTrace ? { agentTrace: input.agentTrace } : {})
        }
      ]
    }
  };
}
