import { z } from "zod";

import { PROJECT_MEMORY_KEYS, STAGE_RECORD_KEYS } from "@/domain/morpho/projectMemory";

const nonBlank = z.string().regex(/\S/);
const history = z.boolean().optional();

export const agentReadTools = {
  selectedContext: defineReadTool(
    "read_selected_context",
    "读取当前显式选择对象及其直接相关语境，用于判断当前资料是否足够执行。",
    z.strictObject({})
  ),
  projectMemory: defineReadTool(
    "read_project_memory",
    "读取七类当前项目记忆的当前修订、来源摘要、待复核状态；可按 key 选择，并可请求有限历史修订。",
    z.strictObject({ keys: z.array(z.enum(PROJECT_MEMORY_KEYS)).optional(), includeHistory: history })
  ),
  stageRecord: defineReadTool(
    "read_stage_record",
    "读取已发生阶段的当前有效记录、来源、待复核状态；可按阶段选择，并可请求有限历史修订。",
    z.strictObject({ stages: z.array(z.enum(STAGE_RECORD_KEYS)).optional(), includeHistory: history })
  ),
  conversation: defineReadTool(
    "search_project_conversation",
    "确定性查询项目原始聊天。用于最早/最近消息、关键词、角色和时间范围查询，返回 messageId、时间与有限相邻上下文。",
    z.strictObject({
      mode: z.enum(["earliest", "latest", "keyword"]),
      keyword: nonBlank.optional(),
      role: z.enum(["any", "user", "assistant"]).optional(),
      from: nonBlank.optional(),
      to: nonBlank.optional(),
      limit: z.int().min(1).max(20).optional(),
      neighborCount: z.int().min(0).max(3).optional(),
      includeDiagnostics: z.boolean().optional()
    }).refine(({ mode, keyword }) => mode !== "keyword" || keyword !== undefined, {
      path: ["keyword"],
      message: "在 keyword 模式下必须提供 keyword。"
    })
  ),
  workspaceSource: defineReadTool(
    "read_workspace_source",
    "有界读取本轮 scope 内当前对象或指定 revision、文档 UTF-16 range、交付章节稳定引用，或实际图片像素。start/length 使用半开区间；最多 8000 字。新生成图片只有本轮明确要求观察结果时可读；读取不授予生成或采用权限。",
    z.strictObject({
      kind: z.enum(["object", "document", "image", "delivery"]),
      objectId: nonBlank,
      revisionId: nonBlank.optional(),
      sectionId: nonBlank.optional(),
      start: z.int().min(0).optional(),
      length: z.int().min(1).max(8000).optional()
    })
  )
};

const definitions = Object.values(agentReadTools);
export const agentReadToolNames = definitions.map((tool) => tool.name);
export type AgentReadToolCall = ReturnType<(typeof definitions)[number]["parse"]>;

export function parseAgentReadTool(name: string, args: unknown): AgentReadToolCall | undefined {
  return definitions.find((tool) => tool.name === name)?.parse(args);
}

function defineReadTool<Name extends string, Schema extends z.ZodType>(
  name: Name,
  description: string,
  schema: Schema
) {
  const { $schema: _dialect, ...parameters } = z.toJSONSchema(schema, { target: "draft-7", io: "input" });
  return {
    name,
    description,
    parameters,
    parse(args: unknown): { name: Name; args: z.output<Schema> } {
      const result = schema.safeParse(args);
      if (!result.success) {
        const issue = result.error.issues[0];
        const key = issue.path.join(".") || (issue.code === "unrecognized_keys" ? issue.keys.join("、") : "");
        throw new Error(`Agent 工具 ${name} 的参数${key ? ` ${key}` : ""} 无效：${issue.message}`);
      }
      return { name, args: result.data };
    }
  };
}
