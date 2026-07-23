import type { AgentActivityKind } from "@/domain/morpho/types";
import { getAgentToolEffect, type MorphoAgentToolArguments } from "./morphoAgent";

export type AgentToolActivityDescriptor = {
  activityKind: AgentActivityKind;
  label: string;
  detail?: string;
};

type AgentToolActivityContext = {
  workspace?: {
    artifactProposals: Record<string, { title: string } | undefined>;
  };
  selectedObjects?: Array<{ id: string; title: string }>;
};

export function buildAgentToolActivityDescriptor(
  tool: MorphoAgentToolArguments,
  context: AgentToolActivityContext = {}
): AgentToolActivityDescriptor {
  return alignActivityWithToolEffect(tool, buildToolSpecificActivityDescriptor(tool, context));
}

function buildToolSpecificActivityDescriptor(
  tool: MorphoAgentToolArguments,
  context: AgentToolActivityContext
): AgentToolActivityDescriptor {
  switch (tool.name) {
    case "read_selected_context": {
      const count = context.selectedObjects?.length ?? 0;
      return {
        activityKind: "contextRead",
        label: count > 0 ? `读取当前选择的 ${count} 个对象` : "读取当前选择的对象"
      };
    }
    case "read_project_memory":
      return {
        activityKind: "contextRead",
        label: tool.args.keys?.length ? `读取 ${tool.args.keys.length} 项项目记忆` : "读取项目记忆"
      };
    case "read_stage_record":
      return {
        activityKind: "contextRead",
        label: tool.args.stages?.length ? `读取 ${tool.args.stages.length} 项阶段记录` : "读取阶段记录"
      };
    case "search_project_conversation": {
      const keyword = cleanActivityText(tool.args.keyword);
      return {
        activityKind: "contextRead",
        label: keyword ? `查找历史对话「${keyword}」` : "查找项目历史对话"
      };
    }
    case "search_web_evidence": {
      const reason = cleanActivityText(tool.args.reason);
      const query = cleanActivityText(tool.args.queries[0]);
      return {
        activityKind: "webSearch",
        label: reason ?? (query ? `搜索 ${query}` : "搜索并检查相关资料"),
        detail: reason && query ? query : undefined
      };
    }
    case "create_research_analysis": {
      const title = cleanActivityText(tool.args.title);
      const findingCount = tool.args.findings.length;
      return {
        activityKind: "analysis",
        label: title ? `整理「${title}」研究与分析` : "整理研究与分析",
        detail: findingCount > 0 ? `${findingCount} 项发现` : undefined
      };
    }
    case "create_design_definition_proposal": {
      const title = cleanActivityText(tool.args.title);
      return { activityKind: "proposal", label: title ? `形成「${title}」设计定义草案` : "形成设计定义草案" };
    }
    case "create_concept_direction_proposal": {
      const title = cleanActivityText(tool.args.title);
      const directionCount = tool.args.directions.length;
      return {
        activityKind: "proposal",
        label: title ? `形成「${title}」概念方向草案` : "形成概念方向草案",
        detail: directionCount > 0 ? `${directionCount} 个方向` : undefined
      };
    }
    case "revise_selected_proposal_draft": {
      const title = cleanActivityText(
        context.workspace?.artifactProposals[tool.args.proposalId]?.title ?? tool.args.title
      );
      return { activityKind: "workspaceWrite", label: title ? `更新「${title}」方案草稿` : "更新当前方案草稿" };
    }
    case "generate_visuals": {
      const count = tool.args.items.length;
      return {
        activityKind: "imageGeneration",
        label: count > 0 ? `生成 ${count} 张视觉方向` : "生成视觉方向"
      };
    }
    case "create_comparison_analysis": {
      const count = context.selectedObjects?.length ?? tool.args.objectComparisons.length;
      return {
        activityKind: "comparison",
        label: count > 0 ? `比较当前选择的 ${count} 个对象` : "比较所选对象"
      };
    }
    case "prepare_delivery_section_draft":
      return { activityKind: "workspaceWrite", label: "形成交付章节说明草稿" };
    case "submit_memory_update":
      return {
        activityKind: "workspaceWrite",
        label: tool.args.items.length > 1 ? `记录 ${tool.args.items.length} 项明确项目信息` : "记录明确项目信息"
      };
    case "request_confirmation": {
      const reason = cleanActivityText(tool.args.reason);
      return { activityKind: "confirmation", label: reason ?? "准备操作确认" };
    }
  }
}

function alignActivityWithToolEffect(
  tool: MorphoAgentToolArguments,
  descriptor: AgentToolActivityDescriptor
): AgentToolActivityDescriptor {
  const effect = getAgentToolEffect(tool.name);
  const activityKind = effect.externalEvidence
    ? "webSearch"
    : effect.externalCost
      ? "imageGeneration"
      : effect.memoryWrite
        ? "workspaceWrite"
        : effect.highImpactStateChange
          ? "confirmation"
          : effect.readOnly
            ? "contextRead"
            : descriptor.activityKind;
  return { ...descriptor, activityKind };
}

export function sanitizeAgentActivityDetail(value: string | undefined): string | undefined {
  if (value && /(?:stack trace|traceback|<!doctype|<html)/i.test(value)) {
    return undefined;
  }
  const cleaned = cleanActivityText(value, 160);
  if (!cleaned || /^(?:\{|\[)/.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function cleanActivityText(value: string | undefined, maxLength = 72): string | undefined {
  const cleaned = value
    ?.replace(/<[^>]*>/g, " ")
    .replace(/[A-Za-z]:\\[^\s]+/g, "相关资料")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^(?:\{|\[)/.test(cleaned)) {
    return undefined;
  }
  return cleaned.slice(0, maxLength);
}
