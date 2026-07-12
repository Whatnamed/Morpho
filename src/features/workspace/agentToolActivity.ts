import type { AgentActivityKind } from "@/domain/morpho/types";
import type { MorphoAgentToolArguments } from "./morphoAgent";

export function getAgentToolActivityPresentation(
  toolName: MorphoAgentToolArguments["name"]
): { activityKind: AgentActivityKind; label: string } {
  switch (toolName) {
    case "read_selected_context":
      return { activityKind: "contextRead", label: "读取当前选择的对象" };
    case "search_web_evidence":
      return { activityKind: "webSearch", label: "搜索并检查相关资料" };
    case "create_research_analysis":
      return { activityKind: "analysis", label: "整理研究与分析" };
    case "create_design_definition_proposal":
      return { activityKind: "proposal", label: "形成设计定义草案" };
    case "create_concept_direction_proposal":
      return { activityKind: "proposal", label: "形成概念方向草案" };
    case "revise_selected_proposal_draft":
      return { activityKind: "workspaceWrite", label: "更新当前草案" };
    case "generate_visuals":
      return { activityKind: "imageGeneration", label: "生成视觉方向" };
    case "create_comparison_analysis":
      return { activityKind: "comparison", label: "比较所选对象" };
    case "request_confirmation":
      return { activityKind: "confirmation", label: "准备操作确认" };
  }
}
