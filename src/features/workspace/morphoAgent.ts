import type { ConceptDirectionProposal } from "@/domain/operations/types";
import type { VisualIntentItem } from "@/domain/operations/types";
import type {
  AgentTaskStrategyKind,
  ConversationSummaryRevision,
  ImageRole,
  MorphoObject,
  MorphoWorkspace,
  ProjectMemoryKey,
  StageRecordKey
} from "@/domain/morpho/types";
import type {
  ProviderCitation,
  ResponseFunctionTool,
  ResponseFunctionToolOutput,
  ResponseMessageInput,
  ResponseTool
} from "@/server/ai/openaiCompatibleProvider";
import type {
  AgentStreamFunctionCall,
  AgentStreamOutputItem,
  AgentStreamResult
} from "@/shared/agentStreamProtocol";

import type { ProviderTaskContext, TaskContextResult } from "./taskContext";
import { buildAgentPolicyBlocks } from "./agentPromptRegistry";
import { buildAgentDefaultMemoryContext, type AgentDefaultMemoryContext } from "@/domain/morpho/projectMemory";

export type AgentConversationContext = {
  laneKey: string;
  summaryRevision?: ConversationSummaryRevision;
  messages: Array<{ id?: string; role: "user" | "assistant"; body: string; createdAt?: string }>;
  rawMessageCount: number;
  coveredMessageCount: number;
  estimatedInputTokens: number;
  pressure: "normal" | "prepare" | "compact";
};

export type MorphoAgentTurnMode = "auto" | "confirm";

export type AgentFunctionCall = AgentStreamFunctionCall;

export type AgentOutputItem = AgentStreamOutputItem;

export type AgentRouteResult = AgentStreamResult;

export type CreateResearchAnalysisArgs = {
  title: string;
  summary: string;
  findings: string[];
  opportunities: string[];
  constraints: string[];
  openQuestions: string[];
  changeNote?: string;
  evidence: Array<{
    claim: string;
    sourceObjectIds: string[];
    citationUrls: string[];
    confidence: "supported" | "partial" | "needsVerification";
  }>;
};

export type DesignDefinitionDraftArgs = {
  title: string;
  summary: string;
  projectGoal: string;
  targetUsers: string[];
  primaryScenarios: string[];
  coreProblem: string;
  designPrinciples: string[];
  constraints: string[];
  avoidDirections: string[];
  opportunities: string[];
  openQuestions: string[];
  changeNote?: string;
};

export type CreateDesignDefinitionProposalArgs = DesignDefinitionDraftArgs & {
  alternatives?: DesignDefinitionDraftArgs[];
};

export function getDesignDefinitionDrafts(args: CreateDesignDefinitionProposalArgs): DesignDefinitionDraftArgs[] {
  const { alternatives: _alternatives, ...primaryDraft } = args;
  const drafts = [primaryDraft, ...(args.alternatives ?? [])].slice(0, 3);
  if (drafts.length <= 1) {
    return drafts;
  }

  return drafts.map((draft, index) => ({
    ...draft,
    title: `方案 ${String.fromCharCode(65 + index)}｜${stripDesignDefinitionOptionPrefix(draft.title)}`
  }));
}

function stripDesignDefinitionOptionPrefix(title: string): string {
  return title.replace(/^方案\s*[a-c]\s*(?:[｜|:：\-—]\s*)?/i, "").trim() || title.trim();
}

export type CreateConceptDirectionProposalArgs = {
  title: string;
  summary: string;
  directions: ConceptDirectionProposal["directions"];
};

export type ReviseSelectedProposalDraftArgs =
  | ({
      proposalId: string;
      proposalType: "designDefinition";
    } & DesignDefinitionDraftArgs)
  | {
      proposalId: string;
      proposalType: "conceptDirection";
      title: string;
      summary: string;
      directions: ConceptDirectionProposal["directions"];
    }
  | {
      proposalId: string;
      proposalType: "researchAnalysis";
      title: string;
      summary: string;
      findings: string[];
      opportunities: string[];
      constraints: string[];
      openQuestions: string[];
    };

export type GenerateVisualsArgs = {
  kind: "directionPreview" | "visualDevelopment";
  items: VisualIntentItem[];
};

export type ReadProjectMemoryArgs = {
  keys?: ProjectMemoryKey[];
  includeHistory?: boolean;
};

export type ReadStageRecordArgs = {
  stages?: StageRecordKey[];
  includeHistory?: boolean;
};

export type SearchProjectConversationArgs = {
  mode: "earliest" | "latest" | "keyword";
  keyword?: string;
  role?: "any" | "user" | "assistant";
  from?: string;
  to?: string;
  limit?: number;
  neighborCount?: number;
  includeDiagnostics?: boolean;
};

export type SubmitMemoryUpdateArgs = {
  items: Array<{
    kind: "preference" | "constraint" | "avoidance" | "openQuestion";
    scope: "project" | "designDefinition" | "direction" | "visual";
    evidenceQuote: string;
    relatedObjectIds: string[];
    relatedRevisionIds: string[];
  }>;
  skippedReason?: string;
};

export type PrepareDeliverySectionDraftArgs = {
  title?: string;
  narrative: string;
  captions: Array<{ referenceId: string; caption: string }>;
  suggestedGaps: Array<{ label: string }>;
};

export type CreateComparisonAnalysisArgs = {
  comparisonGoal: string;
  conclusionSummary: string;
  objectComparisons: Array<{
    objectId: string;
    title: string;
    evidenceBasis: "pixels" | "objectSummary" | "documentExtract" | "documentFragment";
    summary: string;
    strengths: string[];
    risks: string[];
    evidence: string[];
  }>;
  recommendedQuestions: string[];
  evidenceLimits: string[];
};

export type SearchWebEvidenceArgs = {
  queries: string[];
  reason: string;
};

export type RequestConfirmationArgs = {
  action:
    | "applyDesignDefinition"
    | "setDirectionPrimary"
    | "setDirectionAlternative"
    | "eliminateDirection"
    | "setDefaultReference"
    | "batchGenerateVisuals";
  targetObjectId?: string;
  reason: string;
  impact: string;
  visualPlan?: GenerateVisualsArgs;
};

export type MorphoAgentToolArguments =
  | { name: "read_selected_context"; args: Record<string, never> }
  | { name: "read_project_memory"; args: ReadProjectMemoryArgs }
  | { name: "read_stage_record"; args: ReadStageRecordArgs }
  | { name: "search_project_conversation"; args: SearchProjectConversationArgs }
  | { name: "search_web_evidence"; args: SearchWebEvidenceArgs }
  | { name: "create_research_analysis"; args: CreateResearchAnalysisArgs }
  | { name: "create_design_definition_proposal"; args: CreateDesignDefinitionProposalArgs }
  | { name: "create_concept_direction_proposal"; args: CreateConceptDirectionProposalArgs }
  | { name: "revise_selected_proposal_draft"; args: ReviseSelectedProposalDraftArgs }
  | { name: "generate_visuals"; args: GenerateVisualsArgs }
  | { name: "create_comparison_analysis"; args: CreateComparisonAnalysisArgs }
  | { name: "prepare_delivery_section_draft"; args: PrepareDeliverySectionDraftArgs }
  | { name: "submit_memory_update"; args: SubmitMemoryUpdateArgs }
  | { name: "request_confirmation"; args: RequestConfirmationArgs };

export type MorphoAgentToolCallParseResult =
  | {
      status: "valid";
      call: AgentFunctionCall;
      parsed: MorphoAgentToolArguments;
    }
  | {
      status: "invalid";
      call: AgentFunctionCall;
      error: string;
    };

export type ReadSelectedContextResult = {
  objectSummaries: Array<{
    id: string;
    type: MorphoObject["type"];
    title: string;
    summary: string;
    detail?: string;
  }>;
  directDocumentTitles: string[];
  proposalDrafts: TaskContextResult["proposalDrafts"];
  imageObjectIds: string[];
  objectIds: string[];
  defaultReference: string;
  scopeNote: string;
  designDefinitionTitle?: string;
  directionTitles: string[];
};

export function buildMorphoAgentSystemPrompt(input: {
  mode: MorphoAgentTurnMode;
  strategy: AgentTaskStrategyKind;
  workspace: MorphoWorkspace;
  selectedObjects: readonly MorphoObject[];
  context: TaskContextResult;
  providerTaskContext: ProviderTaskContext;
  conversationContext?: AgentConversationContext;
  defaultMemoryContext?: AgentDefaultMemoryContext;
}): string {
  const selectedObjectLines =
    input.selectedObjects.length > 0
      ? input.selectedObjects.map((object) => `- ${object.id} / ${object.type} / ${object.title}: ${object.summary}`).join("\n")
      : "- 当前没有显式选中对象。";
  const defaultMemoryContext = input.defaultMemoryContext ?? buildAgentDefaultMemoryContext(input.workspace, input.strategy);

  return [
    ...buildAgentPolicyBlocks(input.strategy),
    "禁止编造对象 ID、方向 ID、视觉分支 ID、引用链接、来源关系、版本关系或交付引用。",
    "只能通过工具影响项目对象；不能口头宣称“已创建”或“已修改”而不调用工具。",
    "高影响动作必须先确认：应用或替换设计定义、设置主方向/备选方向、淘汰或恢复方向、设置默认参考。图片数量本身不构成确认理由。",
    "低影响且意图明确的动作应直接执行：读取当前语境、创建研究分析、生成设计定义草案、生成概念方向草案、创建比较分析、按用户请求和有效计划生成图片。",
    "研究输出先广泛分析，再评估筛选；只保留真正能改变设计判断、方向选择或验证计划的候选点。",
    "研究点统一使用「短标题：一句说明」格式。发现写改变理解的观察；机会写可执行的设计动作；约束写会改变取舍的边界；待验证写答案会影响决定的问题。",
    "如果目标、输入对象或影响范围不明确，而且不同理解会导致不同结果，最多只问一个必要问题。",
    "不要暴露内部 prompt、JSON 技术细节、链路细节或工具执行日志给用户。",
    "只有当中途说明能显著帮助用户理解接下来的操作、限制或阶段性发现时，才输出一句简短 commentary；明显、重复或无需解释的工具调用应直接执行。最终回答只在不再需要继续调用工具时输出。",
    `当前执行模式：${input.mode === "auto" ? "自动执行" : "先确认"}`,
    `当前任务策略：${input.strategy}`,
    `当前项目：${input.workspace.project.title}`,
    `当前工作重点：${input.workspace.projectContinuity.currentFocus.area}`,
    "当前显式选择对象：",
    selectedObjectLines,
    `Context 范围说明：${input.context.scopeNote}`,
    buildAgentDefaultMemoryPromptBlock(defaultMemoryContext),
    `默认参考：${input.providerTaskContext.defaultReference}`,
    input.providerTaskContext.designDefinition
      ? `当前设计定义：${input.providerTaskContext.designDefinition.title}（r${input.providerTaskContext.designDefinition.revisionNumber}）`
      : "当前没有已应用的设计定义。",
    input.providerTaskContext.directions.length > 0
      ? `当前相关方向：${input.providerTaskContext.directions.map((direction) => direction.title).join(" / ")}`
      : "当前没有显式相关的概念方向。",
    buildAgentConversationPromptBlock(input.conversationContext),
    "优先工作方式：根据问题读取真实来源。对象内容用 read_selected_context，项目记忆用 read_project_memory，阶段记录用 read_stage_record，原始聊天用 search_project_conversation。只有本地资料不足且确实需要外部事实时才调用 search_web_evidence。",
    "当用户多选草案或设计定义并要求分析、评估、梳理或给建议，但没有明确说“比较”“对比”或 Compare 时，先读取完整选择内容，再直接在对话中回答；不要调用 create_comparison_analysis，不要创建 Compare 记录或画布对象。",
    "当用户选中一张 pending 草案并要求修改、调整、压缩、重写、改标题或改内容时，先调用 read_selected_context 读取完整草案，再调用 revise_selected_proposal_draft 原地更新这一张草案；不要新建草案，不要等待确认，不要把完整长草案塞回对话。",
    "只有用户明确说再生成一个、新方案、另起一版、多个替代方案时，才调用 create_design_definition_proposal 或 create_concept_direction_proposal 新建草案。",
    "当用户明确要求多个设计定义方案时，create_design_definition_proposal 的根草案必须是方案 A 的完整独立内容，alternatives 依次放方案 B、方案 C；根草案不得写成整组方案的总览。只生成一个方案时不要添加 A/B/C 编号。",
    "生成图片时，不允许只给最终 Provider Prompt、只给长文分析或让用户切模式；应调用 generate_visuals，items 只提交结构化视觉意图。Morpho 会确定性解析参考并编译最终 Prompt。",
    "当用户明确要求一批并列图像时，必须在该次 generate_visuals 的 items[] 中返回完整数量。方向预览要区分“每方向几张”与“总共几张”；1/2/4/6 只是快捷项，3/5/9/12 和四个以上方向同样有效。"
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildMorphoAgentUserInput(input: {
  draft: string;
  context: TaskContextResult;
  providerTaskContext: ProviderTaskContext;
}): ResponseMessageInput {
  void input.providerTaskContext;

  return {
    role: "user",
    content: [
      {
        type: "input_text",
        text: [
          `用户输入：${input.draft}`,
          `显式选择对象数：${input.context.objectIds.length}`,
          `显式选择图片数：${input.context.imageObjectIds.length}`,
          `显式选择文档数：${input.context.documentObjectIds.length}`,
          "如需更具体的对象摘要、方向、设计定义、默认参考或本地文档信息，请先调用 read_selected_context。"
        ].join("\n")
      }
    ]
  };
}

export function buildMorphoAgentTools(
  webSearchEnabled: boolean,
  options: { allowComparisonAnalysis?: boolean } = {}
): ResponseTool[] {
  const tools: ResponseTool[] = [
    readSelectedContextTool(),
    readProjectMemoryTool(),
    readStageRecordTool(),
    searchProjectConversationTool(),
    functionTool({
      name: "revise_selected_proposal_draft",
      description:
        "Revise the single selected pending proposal draft in place. Use this when the user asks to modify, adjust, rewrite, shorten, rename, or change the selected draft. Do not create a new proposal unless the user explicitly asks for another/new/multiple alternatives.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["proposalId", "proposalType", "title", "summary"],
        properties: {
          proposalId: { type: "string" },
          proposalType: { type: "string", enum: ["researchAnalysis", "designDefinition", "conceptDirection"] },
          title: { type: "string" },
          summary: { type: "string" },
          projectGoal: { type: "string" },
          targetUsers: stringArraySchema(),
          primaryScenarios: stringArraySchema(),
          coreProblem: { type: "string" },
          designPrinciples: stringArraySchema(),
          constraints: stringArraySchema(),
          avoidDirections: stringArraySchema(),
          opportunities: stringArraySchema(),
          openQuestions: stringArraySchema(),
          changeNote: { type: "string" },
          findings: stringArraySchema(),
          directions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "title",
                "summary",
                "conceptStatement",
                "keywords",
                "strategy",
                "differentiators",
                "visualSignals",
                "risks",
                "openQuestions"
              ],
              properties: {
                title: { type: "string" },
                summary: { type: "string" },
                conceptStatement: { type: "string" },
                keywords: stringArraySchema(),
                strategy: { type: "string" },
                differentiators: stringArraySchema(),
                visualSignals: stringArraySchema(),
                risks: stringArraySchema(),
                openQuestions: stringArraySchema(),
                basedOnDirectionId: { type: "string" },
                lineageKind: { type: "string", enum: ["variant", "split", "merge", "revision"] }
              }
            }
          }
        }
      }
    }),
    functionTool({
      name: "create_research_analysis",
      description:
        "基于当前资料和必要证据创建研究分析对象，并把结果落到画布附近。研究点要筛选真正有价值的候选内容，每条使用「短标题：一句说明」。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "findings", "opportunities", "constraints", "openQuestions", "evidence"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          findings: stringArraySchema(),
          opportunities: stringArraySchema(),
          constraints: stringArraySchema(),
          openQuestions: stringArraySchema(),
          changeNote: {
            type: "string",
            description: "Optional note about this research draft. It is not applied as a stable project decision."
          },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["claim", "sourceObjectIds", "citationUrls", "confidence"],
              properties: {
                claim: { type: "string" },
                sourceObjectIds: stringArraySchema(),
                citationUrls: stringArraySchema(),
                confidence: {
                  type: "string",
                  enum: ["supported", "partial", "needsVerification"]
                }
              }
            }
          }
        }
      }
    }),
    functionTool({
      name: "create_design_definition_proposal",
      description: "创建设计定义 proposal，供用户继续编辑、讨论或应用。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "summary",
          "projectGoal",
          "targetUsers",
          "primaryScenarios",
          "coreProblem",
          "designPrinciples",
          "constraints",
          "avoidDirections",
          "opportunities",
          "openQuestions"
        ],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          projectGoal: { type: "string" },
          targetUsers: stringArraySchema(),
          primaryScenarios: stringArraySchema(),
          coreProblem: { type: "string" },
          designPrinciples: stringArraySchema(),
          constraints: stringArraySchema(),
          avoidDirections: stringArraySchema(),
          opportunities: stringArraySchema(),
          openQuestions: stringArraySchema(),
          changeNote: { type: "string" },
          alternatives: {
            type: "array",
            description: "用户要求多个方案时放方案 B、方案 C；根对象必须是完整的方案 A，不得作为整组总览。最多 2 个 alternatives。",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "title",
                "summary",
                "projectGoal",
                "targetUsers",
                "primaryScenarios",
                "coreProblem",
                "designPrinciples",
                "constraints",
                "avoidDirections",
                "opportunities",
                "openQuestions"
              ],
              properties: {
                title: { type: "string" },
                summary: { type: "string" },
                projectGoal: { type: "string" },
                targetUsers: stringArraySchema(),
                primaryScenarios: stringArraySchema(),
                coreProblem: { type: "string" },
                designPrinciples: stringArraySchema(),
                constraints: stringArraySchema(),
                avoidDirections: stringArraySchema(),
                opportunities: stringArraySchema(),
                openQuestions: stringArraySchema(),
                changeNote: { type: "string" }
              }
            }
          }
        }
      }
    }),
    functionTool({
      name: "create_concept_direction_proposal",
      description: "创建概念方向 proposal，供用户继续讨论、应用或生成预览。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "directions"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          directions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "title",
                "summary",
                "conceptStatement",
                "keywords",
                "strategy",
                "differentiators",
                "visualSignals",
                "risks",
                "openQuestions"
              ],
              properties: {
                title: { type: "string" },
                summary: { type: "string" },
                conceptStatement: { type: "string" },
                keywords: stringArraySchema(),
                strategy: { type: "string" },
                differentiators: stringArraySchema(),
                visualSignals: stringArraySchema(),
                risks: stringArraySchema(),
                openQuestions: stringArraySchema(),
                basedOnDirectionId: { type: "string" },
                lineageKind: { type: "string", enum: ["variant", "split", "merge", "revision"] }
              }
            }
          }
        }
      }
    }),
    functionTool({
      name: "generate_visuals",
      description: "提交完整的结构化视觉意图，由 Morpho 解析参考图、编译 Provider Prompt、执行生成并把新图放到正确位置。不要提供最终 Provider Prompt。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "items"],
        properties: {
          kind: { type: "string", enum: ["directionPreview", "visualDevelopment"] },
          items: {
            type: "array",
            items: visualIntentItemSchema()
          }
        }
      }
    }),
    functionTool({
      name: "create_comparison_analysis",
      description: "基于当前显式选择对象创建 Compare analysis，不自动改变主方向、默认参考或淘汰状态。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["comparisonGoal", "conclusionSummary", "objectComparisons", "recommendedQuestions", "evidenceLimits"],
        properties: {
          comparisonGoal: { type: "string" },
          conclusionSummary: { type: "string" },
          objectComparisons: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["objectId", "title", "evidenceBasis", "summary", "strengths", "risks", "evidence"],
              properties: {
                objectId: { type: "string" },
                title: { type: "string" },
                evidenceBasis: {
                  type: "string",
                  enum: ["pixels", "objectSummary", "documentExtract", "documentFragment"]
                },
                summary: { type: "string" },
                strengths: stringArraySchema(),
                risks: stringArraySchema(),
                evidence: stringArraySchema()
              }
            }
          },
          recommendedQuestions: stringArraySchema(),
          evidenceLimits: stringArraySchema()
        }
      }
    }),
    functionTool({
      name: "prepare_delivery_section_draft",
      description: "根据当前已授权交付章节稳定引用快照生成待确认说明草稿。应用前不写入真实交付。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["narrative", "captions", "suggestedGaps"],
        properties: {
          title: { type: "string" },
          narrative: { type: "string" },
          captions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["referenceId", "caption"],
              properties: {
                referenceId: { type: "string" },
                caption: { type: "string" }
              }
            }
          },
          suggestedGaps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label"],
              properties: { label: { type: "string" } }
            }
          }
        }
      }
    }),
    functionTool({
      name: "submit_memory_update",
      description: "只提交当前用户消息中明确表达的稳定偏好、约束、避免项或开放问题。evidenceQuote 必须逐字来自当前用户消息。若系统提示本轮需要确认记忆更新但没有可写入内容，传 items: [] 和 skippedReason 说明原因。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["items"],
        properties: {
          items: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "scope", "evidenceQuote", "relatedObjectIds", "relatedRevisionIds"],
              properties: {
                kind: { type: "string", enum: ["preference", "constraint", "avoidance", "openQuestion"] },
                scope: { type: "string", enum: ["project", "designDefinition", "direction", "visual"] },
                evidenceQuote: { type: "string" },
                relatedObjectIds: stringArraySchema(),
                relatedRevisionIds: stringArraySchema()
              }
            }
          },
          skippedReason: { type: "string" }
        }
      }
    }),
    functionTool({
      name: "request_confirmation",
      description: "为高影响操作创建确认卡，仅在必须确认时使用。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["action", "reason", "impact"],
        properties: {
          action: {
            type: "string",
            enum: [
              "applyDesignDefinition",
              "setDirectionPrimary",
              "setDirectionAlternative",
              "eliminateDirection",
              "setDefaultReference",
              "batchGenerateVisuals"
            ]
          },
          targetObjectId: { type: "string" },
          reason: { type: "string" },
          impact: { type: "string" },
          visualPlan: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "items"],
            properties: {
              kind: { type: "string", enum: ["directionPreview", "visualDevelopment"] },
              items: {
                type: "array",
                items: visualIntentItemSchema()
              }
            }
          }
        }
      }
    })
  ];

  if (webSearchEnabled) {
    tools.splice(
      1,
      0,
      functionTool({
        name: "search_web_evidence",
        description: "当本地资料不足以支撑事实判断、现实约束、案例补充或来源验证时，围绕证据缺口补充高相关外部来源。证据充分后停止；全面研究可用不同查询继续补充，不得重复完全相同的搜索。",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["queries", "reason"],
          properties: {
            queries: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              items: { type: "string" }
            },
            reason: { type: "string" }
          }
        }
      })
    );
  }

  return options.allowComparisonAnalysis === false
    ? tools.filter((tool) => tool.type !== "function" || tool.name !== "create_comparison_analysis")
    : tools;
}

function buildAgentDefaultMemoryPromptBlock(memory: AgentDefaultMemoryContext): string {
  const documents = memory.documents.map((document) => {
    const status = document.empty ? "当前为空" : document.reviewRequired ? "当前内容需复核" : "当前有效";
    const revision = document.revisionId ? `，revision ${document.revisionId}` : "";
    const sections = document.sections
      .map((section) => `${section.title}：${section.items.join("；")}`)
      .join(" | ");
    const sources = document.sourceRefs.map((source) => source.title ?? source.id).join("、");
    return `- ${document.title}（${status}${revision}）${sections ? `：${sections}` : ""}${sources ? `；来源：${sources}` : ""}`;
  });
  const stages = memory.stageRecords.map((record) => {
    const status = record.empty ? "当前为空" : record.reviewRequired ? "当前内容需复核" : "当前有效";
    const sections = Object.entries(record.sections)
      .flatMap(([key, items]) => (items ?? []).map((item) => `${key}：${item}`))
      .join("；");
    const sources = record.sourceRefs.map((source) => source.title ?? source.id).join("、");
    return `- ${record.stage}（${status}${record.revisionId ? `，revision ${record.revisionId}` : ""}）${sections ? `：${sections}` : ""}${sources ? `；来源：${sources}` : ""}`;
  });
  const reference = memory.defaultReference
    ? memory.defaultReference.status === "available"
      ? `当前默认参考：${memory.defaultReference.title ?? memory.defaultReference.objectId}（${memory.defaultReference.objectId}）`
      : memory.defaultReference.status === "missing"
        ? "当前默认参考：未设置"
        : `当前默认参考：不可用${memory.defaultReference.objectId ? `（${memory.defaultReference.objectId}）` : ""}`
    : "";

  return [
    "默认项目记忆（仅注入各类记忆与当前阶段记录的紧凑当前内容；不是完整历史）：",
    documents.length > 0 ? documents.join("\n") : "- 当前任务没有需要默认注入的项目记忆文档。",
    stages.length > 0 ? `当前阶段记录：\n${stages.join("\n")}` : "当前任务没有需要默认注入的阶段记录。",
    reference,
    "若用户询问历史版本、来源细节、被替代决定或原始聊天，必须再调用相应真实读取工具；不能把这段紧凑内容当作完整历史。"
  ].filter(Boolean).join("\n");
}

export function buildAgentConversationPromptBlock(
  context: AgentConversationContext | undefined
): string {
  if (!context) {
    return "";
  }

  const lines = [
    "Continuous project conversation context:",
    "优先级：当前用户输入 > 真实项目状态与 Memory Kernel > 未压缩原始聊天 > conversation summary。",
    `laneLabel: ${context.laneKey}`,
    `rawMessageCountInRequest: ${context.rawMessageCount}`,
    `coveredMessageCount: ${context.coveredMessageCount}`,
    `estimatedInputTokens: ${context.estimatedInputTokens}`,
    `tokenPressure: ${context.pressure}`
  ];
  if (context.summaryRevision) {
    const summary = context.summaryRevision.summary;
    lines.push(
      "conversation summary 只覆盖已标记的连续旧消息范围；它不是项目事实源，与实时项目状态冲突时必须服从实时状态。",
      `summaryRevisionId: ${context.summaryRevision.id}`,
      `summarySourceRange: ${context.summaryRevision.sourceStartMessageId}..${context.summaryRevision.sourceEndMessageId}`,
      `threadGoal: ${summary.threadGoal}`,
      `establishedContext: ${summary.establishedContext.join(" / ") || "none"}`,
      `decisionsAndReasons: ${summary.decisionsAndReasons.join(" / ") || "none"}`,
      `activeWork: ${summary.activeWork.join(" / ") || "none"}`,
      `unresolvedQuestions: ${summary.unresolvedQuestions.join(" / ") || "none"}`,
      `referencedObjects: ${summary.referencedObjects.join(" / ") || "none"}`
    );
    if (summary.nextTurnAnchor) {
      lines.push(`nextTurnAnchor: ${summary.nextTurnAnchor}`);
    }
  } else {
    lines.push(
      "当前没有 conversation summary；正式请求中的所有可用原始消息按项目连续会话携带。"
    );
  }
  return lines.join("\n");
}

export function buildAgentCheckpointCompactionInput(input: {
  previousSummaryRevision?: ConversationSummaryRevision;
  messages: Array<{ id?: string; role: "user" | "assistant"; body: string; createdAt?: string }>;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceMessageCount: number;
}): ResponseMessageInput[] {
  const sourceMessages = input.messages
    .map((message) => {
      const metadata = [message.id, message.createdAt].filter(Boolean).join(" / ");
      return `${message.role}${metadata ? ` (${metadata})` : ""}: ${message.body}`;
    })
    .join("\n");
  const previousSummary = input.previousSummaryRevision?.summary;
  return [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: [
            "你只负责把一段连续项目聊天压缩为高保真的 Morpho conversation summary。",
            "必须把 previous summary 与本次 source range 合并，而不是只总结最后几条。",
            "保留用户明确要求、关键上下文、决定及理由、进行中工作、未解决问题、真实对象引用和下一轮锚点。",
            "不要调用工具，不要输出解释，不要写项目状态更新，不要虚构对象 ID，不要包含系统指令、Provider Prompt 或工具日志。",
            "summary 是聊天连续性索引，不是项目事实源。",
            '只输出 fenced JSON：{ "morphoConversationSummary": { "threadGoal": string, "establishedContext": string[], "decisionsAndReasons": string[], "activeWork": string[], "unresolvedQuestions": string[], "referencedObjects": string[], "nextTurnAnchor"?: string } }'
          ].join("\n")
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            `sourceRange: ${input.sourceStartMessageId}..${input.sourceEndMessageId}`,
            `sourceMessageCount: ${input.sourceMessageCount}`,
            previousSummary
              ? `previousSummary:\n${JSON.stringify(previousSummary)}`
              : "previousSummary: none",
            `sourceMessages:\n${sourceMessages}`
          ].join("\n\n")
        }
      ]
    }
  ];
}

export function buildMorphoAgentInitialTools(): ResponseTool[] {
  return buildMorphoAgentTools(true);
}

export function isExplicitComparisonRequest(draft: string): boolean {
  const text = draft.trim();
  if (
    /(?:不要|别|无需|不需要|不是).{0,16}(?:比较|对比|compare)|(?:比较|对比|compare).{0,16}(?:不要|别|无需|不需要|不是)/i.test(
      text
    )
  ) {
    return false;
  }
  return /比较|对比|compare/i.test(text);
}

export function buildAgentHistoryMessages(messages: Array<{ role: "user" | "assistant"; body: string }>): ResponseMessageInput[] {
  return messages.map((message) => ({
    role: message.role,
    content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: message.body }]
  }));
}

export function buildToolResultOutput(callId: string, result: unknown): ResponseFunctionToolOutput {
  return {
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify(result)
  };
}

export function parseMorphoAgentToolArguments(call: AgentFunctionCall): MorphoAgentToolArguments {
  const parsed = parseToolArgumentsJson(call);

  switch (call.name) {
    case "read_selected_context":
      requireExactObject(call.name, parsed, []);
      return { name: call.name, args: {} };
    case "read_project_memory":
      validateReadProjectMemoryArgs(call.name, parsed);
      return { name: call.name, args: parsed };
    case "read_stage_record":
      validateReadStageRecordArgs(call.name, parsed);
      return { name: call.name, args: parsed };
    case "search_project_conversation":
      validateSearchProjectConversationArgs(call.name, parsed);
      return { name: call.name, args: parsed };
    case "search_web_evidence":
      validateSearchWebEvidenceArgs(call.name, parsed);
      return { name: call.name, args: parsed };
    case "create_research_analysis":
      validateCreateResearchAnalysisArgs(call.name, parsed);
      return { name: call.name, args: parsed };
    case "create_design_definition_proposal":
      validateCreateDesignDefinitionProposalArgs(call.name, parsed);
      return { name: call.name, args: parsed };
    case "create_concept_direction_proposal":
      validateCreateConceptDirectionProposalArgs(call.name, parsed);
      return { name: call.name, args: parsed };
    case "revise_selected_proposal_draft":
      validateReviseSelectedProposalDraftArgs(call.name, parsed);
      return { name: call.name, args: parsed };
    case "generate_visuals":
      validateGenerateVisualsArgs(call.name, parsed);
      return { name: call.name, args: normalizeGenerateVisualsArgs(parsed) };
    case "create_comparison_analysis":
      validateCreateComparisonAnalysisArgs(call.name, parsed);
      return { name: call.name, args: parsed };
    case "prepare_delivery_section_draft":
      validatePrepareDeliverySectionDraftArgs(call.name, parsed);
      return { name: call.name, args: parsed };
    case "submit_memory_update":
      validateSubmitMemoryUpdateArgs(call.name, parsed);
      return { name: call.name, args: parsed };
    case "request_confirmation":
      validateRequestConfirmationArgs(call.name, parsed);
      return { name: call.name, args: parsed };
    default:
      throw new Error(`未支持的 Agent 工具：${call.name}`);
  }
}

function functionTool(input: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}): ResponseFunctionTool {
  return {
    type: "function",
    name: input.name,
    description: input.description,
    parameters: input.parameters,
    strict: false
  };
}

function readSelectedContextTool(): ResponseFunctionTool {
  return functionTool({
    name: "read_selected_context",
    description: "读取当前显式选择对象及其直接相关语境，用于判断当前资料是否足够执行。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  });
}

function stringArraySchema(): Record<string, unknown> {
  return {
    type: "array",
    items: {
      type: "string"
    }
  };
}

function parseToolArgumentsJson(call: AgentFunctionCall): unknown {
  try {
    return JSON.parse(call.argumentsText);
  } catch {
    throw new Error(`Agent 工具 ${call.name} 的参数不是有效 JSON。`);
  }
}

function validateSearchWebEvidenceArgs(toolName: string, value: unknown): asserts value is SearchWebEvidenceArgs {
  const record = requireExactObject(toolName, value, ["queries", "reason"]);
  requireStringArray(toolName, record, "queries", { minItems: 1, maxItems: 3 });
  requireString(toolName, record, "reason");
}

function validateCreateResearchAnalysisArgs(toolName: string, value: unknown): asserts value is CreateResearchAnalysisArgs {
  const record = requireExactObject(toolName, value, [
    "title",
    "summary",
    "findings",
    "opportunities",
    "constraints",
    "openQuestions",
    "evidence"
  ], ["changeNote"]);
  requireString(toolName, record, "title");
  requireString(toolName, record, "summary");
  requireStringArray(toolName, record, "findings");
  requireStringArray(toolName, record, "opportunities");
  requireStringArray(toolName, record, "constraints");
  requireStringArray(toolName, record, "openQuestions");
  requireOptionalString(toolName, record, "changeNote");
  requireArray(toolName, record, "evidence").forEach((entry, index) => {
    const evidence = requireExactObject(`${toolName}.evidence[${index}]`, entry, [
      "claim",
      "sourceObjectIds",
      "citationUrls",
      "confidence"
    ]);
    requireString(`${toolName}.evidence[${index}]`, evidence, "claim");
    requireStringArray(`${toolName}.evidence[${index}]`, evidence, "sourceObjectIds");
    requireStringArray(`${toolName}.evidence[${index}]`, evidence, "citationUrls");
    requireEnum(`${toolName}.evidence[${index}]`, evidence, "confidence", [
      "supported",
      "partial",
      "needsVerification"
    ]);
  });
}

function validateCreateDesignDefinitionProposalArgs(
  toolName: string,
  value: unknown
): asserts value is CreateDesignDefinitionProposalArgs {
  const record = requireExactObject(
    toolName,
    value,
    [
      "title",
      "summary",
      "projectGoal",
      "targetUsers",
      "primaryScenarios",
      "coreProblem",
      "designPrinciples",
      "constraints",
      "avoidDirections",
      "opportunities",
      "openQuestions"
    ],
    ["changeNote", "alternatives"]
  );
  validateDesignDefinitionDraftArgs(toolName, record);
  if ("alternatives" in record) {
    requireArray(toolName, record, "alternatives").forEach((entry, index) => {
      const alternative = requireExactObject(
        `${toolName}.alternatives[${index}]`,
        entry,
        [
          "title",
          "summary",
          "projectGoal",
          "targetUsers",
          "primaryScenarios",
          "coreProblem",
          "designPrinciples",
          "constraints",
          "avoidDirections",
          "opportunities",
          "openQuestions"
        ],
        ["changeNote"]
      );
      validateDesignDefinitionDraftArgs(`${toolName}.alternatives[${index}]`, alternative);
    });
  }
}

export function normalizeGenerateVisualsForSelectedDirections(
  args: GenerateVisualsArgs,
  selectedDirectionCount: number
): GenerateVisualsArgs {
  if (args.kind === "directionPreview" && selectedDirectionCount === 0) {
    return {
      ...args,
      kind: "visualDevelopment"
    };
  }
  return args;
}

export function parseMorphoAgentToolCallBatch(
  calls: readonly AgentFunctionCall[]
): MorphoAgentToolCallParseResult[] {
  return calls.map((call) => {
    try {
      return {
        status: "valid" as const,
        call,
        parsed: parseMorphoAgentToolArguments(call)
      };
    } catch (error) {
      return {
        status: "invalid" as const,
        call,
        error: toolArgumentErrorMessage(error)
      };
    }
  });
}

export function buildMorphoAgentToolArgumentRepairOutputs(
  results: readonly MorphoAgentToolCallParseResult[]
): ResponseFunctionToolOutput[] {
  if (!results.some((result) => result.status === "invalid")) {
    return [];
  }

  return results.map((result) =>
    buildToolResultOutput(
      result.call.callId,
      result.status === "invalid"
        ? {
            status: "invalid_arguments",
            error: result.error,
            retryable: true
          }
        : {
            status: "not_executed",
            reason: "同一响应中存在参数无效的工具调用；本批工具均未执行，请修正后重新调用。",
            retryable: true
          }
    )
  );
}

export function buildMorphoAgentToolArgumentRepairReminder(
  results: readonly MorphoAgentToolCallParseResult[]
): string {
  const failures = results
    .filter((result): result is Extract<MorphoAgentToolCallParseResult, { status: "invalid" }> => result.status === "invalid")
    .map((result) => `${result.call.name}: ${result.error}`);
  return [
    "一个或多个 Agent 工具调用未执行，因为参数未通过 Morpho 校验。",
    ...failures,
    "请严格按照已提供的函数 schema 修正参数，并重新调用本批仍需执行的全部工具。不要沿用未声明字段，也不要声称已经执行。"
  ].join("\n");
}

function toolArgumentErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Agent 工具参数未通过校验。";
  return message.slice(0, 800);
}

function validateReadProjectMemoryArgs(toolName: string, value: unknown): asserts value is ReadProjectMemoryArgs {
  const record = requireExactObject(toolName, value, [], ["keys", "includeHistory"]);
  requireOptionalEnumArray(toolName, record, "keys", [
    "projectOverview",
    "designBrief",
    "userPreferences",
    "decisionLog",
    "rejectedDirections",
    "openQuestions",
    "outputPlan"
  ]);
  requireOptionalBoolean(toolName, record, "includeHistory");
}

function validateReadStageRecordArgs(toolName: string, value: unknown): asserts value is ReadStageRecordArgs {
  const record = requireExactObject(toolName, value, [], ["stages", "includeHistory"]);
  requireOptionalEnumArray(toolName, record, "stages", [
    "startAndInput",
    "exploration",
    "research",
    "designDefinition",
    "directionAndVisual",
    "deliveryPreparation"
  ]);
  requireOptionalBoolean(toolName, record, "includeHistory");
}

function validateSearchProjectConversationArgs(
  toolName: string,
  value: unknown
): asserts value is SearchProjectConversationArgs {
  const record = requireExactObject(toolName, value, ["mode"], [
    "keyword",
    "role",
    "from",
    "to",
    "limit",
    "neighborCount",
    "includeDiagnostics"
  ]);
  const mode = requireEnum(toolName, record, "mode", ["earliest", "latest", "keyword"]);
  requireOptionalString(toolName, record, "keyword");
  requireOptionalEnum(toolName, record, "role", ["any", "user", "assistant"]);
  requireOptionalString(toolName, record, "from");
  requireOptionalString(toolName, record, "to");
  requireOptionalInteger(toolName, record, "limit", 1, 20);
  requireOptionalInteger(toolName, record, "neighborCount", 0, 3);
  requireOptionalBoolean(toolName, record, "includeDiagnostics");
  if (mode === "keyword" && typeof record.keyword !== "string") {
    throw new Error(`Agent 工具 ${toolName} 在 keyword 模式下必须提供 keyword。`);
  }
}

function truncateAgentContextText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1)}…` : normalized;
}

function validateDesignDefinitionDraftArgs(toolName: string, record: Record<string, unknown>) {
  requireString(toolName, record, "title");
  requireString(toolName, record, "summary");
  requireString(toolName, record, "projectGoal");
  requireStringArray(toolName, record, "targetUsers");
  requireStringArray(toolName, record, "primaryScenarios");
  requireString(toolName, record, "coreProblem");
  requireStringArray(toolName, record, "designPrinciples");
  requireStringArray(toolName, record, "constraints");
  requireStringArray(toolName, record, "avoidDirections");
  requireStringArray(toolName, record, "opportunities");
  requireStringArray(toolName, record, "openQuestions");
  requireOptionalString(toolName, record, "changeNote");
}

function validateCreateConceptDirectionProposalArgs(
  toolName: string,
  value: unknown
): asserts value is CreateConceptDirectionProposalArgs {
  const record = requireExactObject(toolName, value, ["title", "summary", "directions"]);
  requireString(toolName, record, "title");
  requireString(toolName, record, "summary");
  requireArray(toolName, record, "directions").forEach((entry, index) => {
    const direction = requireExactObject(
      `${toolName}.directions[${index}]`,
      entry,
      [
        "title",
        "summary",
        "conceptStatement",
        "keywords",
        "strategy",
        "differentiators",
        "visualSignals",
        "risks",
        "openQuestions"
      ],
      ["basedOnDirectionId", "lineageKind"]
    );
    requireString(`${toolName}.directions[${index}]`, direction, "title");
    requireString(`${toolName}.directions[${index}]`, direction, "summary");
    requireString(`${toolName}.directions[${index}]`, direction, "conceptStatement");
    requireStringArray(`${toolName}.directions[${index}]`, direction, "keywords");
    requireString(`${toolName}.directions[${index}]`, direction, "strategy");
    requireStringArray(`${toolName}.directions[${index}]`, direction, "differentiators");
    requireStringArray(`${toolName}.directions[${index}]`, direction, "visualSignals");
    requireStringArray(`${toolName}.directions[${index}]`, direction, "risks");
    requireStringArray(`${toolName}.directions[${index}]`, direction, "openQuestions");
    requireOptionalString(`${toolName}.directions[${index}]`, direction, "basedOnDirectionId");
    requireOptionalEnum(`${toolName}.directions[${index}]`, direction, "lineageKind", [
      "variant",
      "split",
      "merge",
      "revision"
    ]);
  });
}

function readProjectMemoryTool(): ResponseFunctionTool {
  return functionTool({
    name: "read_project_memory",
    description: "读取七类当前项目记忆的当前修订、来源摘要、待复核状态；可按 key 选择，并可请求有限历史修订。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        keys: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "projectOverview",
              "designBrief",
              "userPreferences",
              "decisionLog",
              "rejectedDirections",
              "openQuestions",
              "outputPlan"
            ]
          }
        },
        includeHistory: { type: "boolean" }
      }
    }
  });
}

function readStageRecordTool(): ResponseFunctionTool {
  return functionTool({
    name: "read_stage_record",
    description: "读取已发生阶段的当前有效记录、来源、待复核状态；可按阶段选择，并可请求有限历史修订。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        stages: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "startAndInput",
              "exploration",
              "research",
              "designDefinition",
              "directionAndVisual",
              "deliveryPreparation"
            ]
          }
        },
        includeHistory: { type: "boolean" }
      }
    }
  });
}

function searchProjectConversationTool(): ResponseFunctionTool {
  return functionTool({
    name: "search_project_conversation",
    description: "确定性查询项目原始聊天。用于最早/最近消息、关键词、角色和时间范围查询，返回 messageId、时间与有限相邻上下文。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["mode"],
      properties: {
        mode: { type: "string", enum: ["earliest", "latest", "keyword"] },
        keyword: { type: "string" },
        role: { type: "string", enum: ["any", "user", "assistant"] },
        from: { type: "string" },
        to: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
        neighborCount: { type: "integer", minimum: 0, maximum: 3 },
        includeDiagnostics: { type: "boolean" }
      }
    }
  });
}

function visualIntentItemSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "purpose",
      "requestedReferenceObjectIds",
      "changeGoals",
      "preserve",
      "allowToChange",
      "productForm",
      "materialsAndCmf",
      "environmentAndLighting",
      "avoid",
      "role"
    ],
    properties: {
      id: { type: "string" },
      targetDirectionId: { type: "string" },
      visualBranchId: { type: "string" },
      title: { type: "string" },
      purpose: { type: "string" },
      requestedReferenceObjectIds: stringArraySchema(),
      excludeDefaultReference: { type: "boolean" },
      changeGoals: stringArraySchema(),
      preserve: stringArraySchema(),
      allowToChange: stringArraySchema(),
      composition: { type: "string" },
      viewpoint: { type: "string" },
      productForm: stringArraySchema(),
      materialsAndCmf: stringArraySchema(),
      environmentAndLighting: stringArraySchema(),
      avoid: stringArraySchema(),
      userPromptRemainder: { type: "string" },
      role: {
        type: "string",
        enum: [
          "preview",
          "conceptImage",
          "primaryVisual",
          "sceneVisual",
          "cmfStudy",
          "detailStudy",
          "structureDiagram",
          "interactionDiagram",
          "deliveryAsset"
        ]
      }
    }
  };
}

function validateReviseSelectedProposalDraftArgs(
  toolName: string,
  value: unknown
): asserts value is ReviseSelectedProposalDraftArgs {
  const base = requireExactObject(toolName, value, ["proposalId", "proposalType", "title", "summary"], [
    "projectGoal",
    "targetUsers",
    "primaryScenarios",
    "coreProblem",
    "designPrinciples",
    "constraints",
    "avoidDirections",
    "opportunities",
    "openQuestions",
    "changeNote",
    "findings",
    "directions"
  ]);
  requireString(toolName, base, "proposalId");
  const proposalType = requireEnum(toolName, base, "proposalType", [
    "researchAnalysis",
    "designDefinition",
    "conceptDirection"
  ]);

  if (proposalType === "designDefinition") {
    const record = requireExactObject(
      toolName,
      value,
      [
        "proposalId",
        "proposalType",
        "title",
        "summary",
        "projectGoal",
        "targetUsers",
        "primaryScenarios",
        "coreProblem",
        "designPrinciples",
        "constraints",
        "avoidDirections",
        "opportunities",
        "openQuestions"
      ],
      ["changeNote"]
    );
    validateDesignDefinitionDraftArgs(toolName, record);
    return;
  }

  if (proposalType === "conceptDirection") {
    const record = requireExactObject(toolName, value, ["proposalId", "proposalType", "title", "summary", "directions"]);
    requireString(toolName, record, "title");
    requireString(toolName, record, "summary");
    requireArray(toolName, record, "directions").forEach((entry, index) => {
      validateConceptDirectionDraft(`${toolName}.directions[${index}]`, entry);
    });
    return;
  }

  const record = requireExactObject(
    toolName,
    value,
    ["proposalId", "proposalType", "title", "summary", "findings", "opportunities", "constraints", "openQuestions"]
  );
  requireString(toolName, record, "title");
  requireString(toolName, record, "summary");
  requireStringArray(toolName, record, "findings");
  requireStringArray(toolName, record, "opportunities");
  requireStringArray(toolName, record, "constraints");
  requireStringArray(toolName, record, "openQuestions");
}

function validateConceptDirectionDraft(toolName: string, value: unknown): void {
  const direction = requireExactObject(
    toolName,
    value,
    [
      "title",
      "summary",
      "conceptStatement",
      "keywords",
      "strategy",
      "differentiators",
      "visualSignals",
      "risks",
      "openQuestions"
    ],
    ["basedOnDirectionId", "lineageKind"]
  );
  requireString(toolName, direction, "title");
  requireString(toolName, direction, "summary");
  requireString(toolName, direction, "conceptStatement");
  requireStringArray(toolName, direction, "keywords");
  requireString(toolName, direction, "strategy");
  requireStringArray(toolName, direction, "differentiators");
  requireStringArray(toolName, direction, "visualSignals");
  requireStringArray(toolName, direction, "risks");
  requireStringArray(toolName, direction, "openQuestions");
  requireOptionalString(toolName, direction, "basedOnDirectionId");
  requireOptionalEnum(toolName, direction, "lineageKind", ["variant", "split", "merge", "revision"]);
}

function validateGenerateVisualsArgs(toolName: string, value: unknown): asserts value is GenerateVisualsArgs {
  const record = requireExactObject(toolName, value, ["kind", "items"]);
  requireEnum(toolName, record, "kind", ["directionPreview", "visualDevelopment"]);
  const items = requireArray(toolName, record, "items");
  if (items.length === 0) {
    throw new Error(`Agent 工具 ${toolName} 的参数 items 至少需要 1 项。`);
  }
  items.forEach((entry, index) => {
    const item = requireExactObject(
      `${toolName}.items[${index}]`,
      entry,
      [
        "id",
        "title",
        "purpose",
        "requestedReferenceObjectIds",
        "changeGoals",
        "preserve",
        "allowToChange",
        "productForm",
        "materialsAndCmf",
        "environmentAndLighting",
        "avoid",
        "role"
      ],
      [
        "targetDirectionId",
        "visualBranchId",
        "excludeDefaultReference",
        "composition",
        "viewpoint",
        "userPromptRemainder"
      ]
    );
    requireString(`${toolName}.items[${index}]`, item, "id");
    requireOptionalString(`${toolName}.items[${index}]`, item, "targetDirectionId");
    requireOptionalString(`${toolName}.items[${index}]`, item, "visualBranchId");
    requireString(`${toolName}.items[${index}]`, item, "title");
    requireString(`${toolName}.items[${index}]`, item, "purpose");
    requireStringArray(`${toolName}.items[${index}]`, item, "requestedReferenceObjectIds");
    requireOptionalBoolean(`${toolName}.items[${index}]`, item, "excludeDefaultReference");
    requireStringArray(`${toolName}.items[${index}]`, item, "changeGoals");
    requireStringArray(`${toolName}.items[${index}]`, item, "preserve");
    requireStringArray(`${toolName}.items[${index}]`, item, "allowToChange");
    requireOptionalString(`${toolName}.items[${index}]`, item, "composition");
    requireOptionalString(`${toolName}.items[${index}]`, item, "viewpoint");
    requireStringArray(`${toolName}.items[${index}]`, item, "productForm");
    requireStringArray(`${toolName}.items[${index}]`, item, "materialsAndCmf");
    requireStringArray(`${toolName}.items[${index}]`, item, "environmentAndLighting");
    requireStringArray(`${toolName}.items[${index}]`, item, "avoid");
    requireOptionalString(`${toolName}.items[${index}]`, item, "userPromptRemainder");
    requireEnum(`${toolName}.items[${index}]`, item, "role", [
      "preview",
      "conceptImage",
      "primaryVisual",
      "sceneVisual",
      "cmfStudy",
      "detailStudy",
      "structureDiagram",
      "interactionDiagram",
      "deliveryAsset"
    ]);
  });
}

function normalizeGenerateVisualsArgs(args: GenerateVisualsArgs): GenerateVisualsArgs {
  if (args.kind !== "directionPreview") {
    return args;
  }

  if (args.items.every((item) => !item.targetDirectionId)) {
    return {
      ...args,
      kind: "visualDevelopment"
    };
  }

  return {
    ...args,
    items: args.items.map((item) => ({
      ...item,
      role: "conceptImage"
    }))
  };
}

function validateCreateComparisonAnalysisArgs(toolName: string, value: unknown): asserts value is CreateComparisonAnalysisArgs {
  const record = requireExactObject(toolName, value, [
    "comparisonGoal",
    "conclusionSummary",
    "objectComparisons",
    "recommendedQuestions",
    "evidenceLimits"
  ]);
  requireString(toolName, record, "comparisonGoal");
  requireString(toolName, record, "conclusionSummary");
  requireStringArray(toolName, record, "recommendedQuestions");
  requireStringArray(toolName, record, "evidenceLimits");
  requireArray(toolName, record, "objectComparisons").forEach((entry, index) => {
    const comparison = requireExactObject(`${toolName}.objectComparisons[${index}]`, entry, [
      "objectId",
      "title",
      "evidenceBasis",
      "summary",
      "strengths",
      "risks",
      "evidence"
    ]);
    requireString(`${toolName}.objectComparisons[${index}]`, comparison, "objectId");
    requireString(`${toolName}.objectComparisons[${index}]`, comparison, "title");
    requireEnum(`${toolName}.objectComparisons[${index}]`, comparison, "evidenceBasis", [
      "pixels",
      "objectSummary",
      "documentExtract",
      "documentFragment"
    ]);
    requireString(`${toolName}.objectComparisons[${index}]`, comparison, "summary");
    requireStringArray(`${toolName}.objectComparisons[${index}]`, comparison, "strengths");
    requireStringArray(`${toolName}.objectComparisons[${index}]`, comparison, "risks");
    requireStringArray(`${toolName}.objectComparisons[${index}]`, comparison, "evidence");
  });
}

function validatePrepareDeliverySectionDraftArgs(
  toolName: string,
  value: unknown
): asserts value is PrepareDeliverySectionDraftArgs {
  const record = requireExactObject(toolName, value, ["narrative", "captions", "suggestedGaps"], ["title"]);
  requireOptionalString(toolName, record, "title");
  requireString(toolName, record, "narrative");
  requireArray(toolName, record, "captions").forEach((entry, index) => {
    const caption = requireExactObject(`${toolName}.captions[${index}]`, entry, ["referenceId", "caption"]);
    requireString(`${toolName}.captions[${index}]`, caption, "referenceId");
    requireString(`${toolName}.captions[${index}]`, caption, "caption");
  });
  requireArray(toolName, record, "suggestedGaps").forEach((entry, index) => {
    const gap = requireExactObject(`${toolName}.suggestedGaps[${index}]`, entry, ["label"]);
    requireString(`${toolName}.suggestedGaps[${index}]`, gap, "label");
  });
}

function validateSubmitMemoryUpdateArgs(toolName: string, value: unknown): asserts value is SubmitMemoryUpdateArgs {
  const record = requireExactObject(toolName, value, ["items"], ["skippedReason"]);
  const items = requireArray(toolName, record, "items");
  requireOptionalString(toolName, record, "skippedReason");
  if (items.length > 3) {
    throw new Error(`Agent 工具 ${toolName} 的参数 items 最多 3 项。`);
  }
  if (items.length === 0) {
    if (typeof record.skippedReason !== "string") {
      throw new Error(`Agent 工具 ${toolName} 在 items 为空时必须提供 skippedReason。`);
    }
    return;
  }
  if (record.skippedReason !== undefined) {
    throw new Error(`Agent 工具 ${toolName} 在提交记忆项时不能同时提供 skippedReason。`);
  }
  items.forEach((entry, index) => {
    const item = requireExactObject(`${toolName}.items[${index}]`, entry, [
      "kind",
      "scope",
      "evidenceQuote",
      "relatedObjectIds",
      "relatedRevisionIds"
    ]);
    requireEnum(`${toolName}.items[${index}]`, item, "kind", [
      "preference",
      "constraint",
      "avoidance",
      "openQuestion"
    ]);
    requireEnum(`${toolName}.items[${index}]`, item, "scope", [
      "project",
      "designDefinition",
      "direction",
      "visual"
    ]);
    requireString(`${toolName}.items[${index}]`, item, "evidenceQuote");
    requireStringArray(`${toolName}.items[${index}]`, item, "relatedObjectIds");
    requireStringArray(`${toolName}.items[${index}]`, item, "relatedRevisionIds");
  });
}

function validateRequestConfirmationArgs(toolName: string, value: unknown): asserts value is RequestConfirmationArgs {
  const record = requireExactObject(toolName, value, ["action", "reason", "impact"], ["targetObjectId", "visualPlan"]);
  requireEnum(toolName, record, "action", [
    "applyDesignDefinition",
    "setDirectionPrimary",
    "setDirectionAlternative",
    "eliminateDirection",
    "setDefaultReference",
    "batchGenerateVisuals"
  ]);
  requireOptionalString(toolName, record, "targetObjectId");
  requireString(toolName, record, "reason");
  requireString(toolName, record, "impact");
  if (record.visualPlan !== undefined) {
    validateGenerateVisualsArgs(`${toolName}.visualPlan`, record.visualPlan);
    record.visualPlan = normalizeGenerateVisualsArgs(record.visualPlan as GenerateVisualsArgs);
  }
}

function requireExactObject(
  toolName: string,
  value: unknown,
  requiredKeys: string[],
  optionalKeys: string[] = []
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Agent 工具 ${toolName} 的参数必须是对象。`);
  }

  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const unexpectedKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpectedKey) {
    throw new Error(`Agent 工具 ${toolName} 包含未声明参数：${unexpectedKey}。`);
  }

  const missingKey = requiredKeys.find((key) => !(key in value));
  if (missingKey) {
    throw new Error(`Agent 工具 ${toolName} 缺少必要参数：${missingKey}。`);
  }

  return value;
}

function requireString(toolName: string, record: Record<string, unknown>, key: string): string {
  if (typeof record[key] !== "string" || record[key].trim().length === 0) {
    throw new Error(`Agent 工具 ${toolName} 的参数 ${key} 必须是非空字符串。`);
  }
  return record[key];
}

function requireOptionalString(toolName: string, record: Record<string, unknown>, key: string): string | undefined {
  if (record[key] === undefined) {
    return undefined;
  }
  return requireString(toolName, record, key);
}

function requireStringArray(
  toolName: string,
  record: Record<string, unknown>,
  key: string,
  limits: { minItems?: number; maxItems?: number } = {}
): string[] {
  const value = requireArray(toolName, record, key);
  if (limits.minItems !== undefined && value.length < limits.minItems) {
    throw new Error(`Agent 工具 ${toolName} 的参数 ${key} 至少需要 ${limits.minItems} 项。`);
  }
  if (limits.maxItems !== undefined && value.length > limits.maxItems) {
    throw new Error(`Agent 工具 ${toolName} 的参数 ${key} 最多允许 ${limits.maxItems} 项。`);
  }
  if (!value.every((item) => typeof item === "string")) {
    throw new Error(`Agent 工具 ${toolName} 的参数 ${key} 必须全部是字符串。`);
  }
  return value;
}

function requireArray(toolName: string, record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`Agent 工具 ${toolName} 的参数 ${key} 必须是数组。`);
  }
  return value;
}

function requireEnum<T extends string>(
  toolName: string,
  record: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T {
  const value = record[key];
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`Agent 工具 ${toolName} 的参数 ${key} 不在允许范围内。`);
  }
  return value as T;
}

function requireOptionalEnum<T extends string>(
  toolName: string,
  record: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T | undefined {
  if (record[key] === undefined) {
    return undefined;
  }
  return requireEnum(toolName, record, key, values);
}

function requireOptionalEnumArray<T extends string>(
  toolName: string,
  record: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T[] | undefined {
  if (record[key] === undefined) {
    return undefined;
  }
  const items = requireArray(toolName, record, key);
  if (!items.every((item) => typeof item === "string" && values.includes(item as T))) {
    throw new Error(`Agent 工具 ${toolName} 的参数 ${key} 包含不允许的值。`);
  }
  return items as T[];
}

function requireOptionalBoolean(
  toolName: string,
  record: Record<string, unknown>,
  key: string
): boolean | undefined {
  if (record[key] === undefined) {
    return undefined;
  }
  if (typeof record[key] !== "boolean") {
    throw new Error(`Agent 工具 ${toolName} 的参数 ${key} 必须是布尔值。`);
  }
  return record[key];
}

function requireOptionalInteger(
  toolName: string,
  record: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (record[key] === undefined) {
    return undefined;
  }
  if (!Number.isInteger(record[key]) || (record[key] as number) < minimum || (record[key] as number) > maximum) {
    throw new Error(`Agent 工具 ${toolName} 的参数 ${key} 必须是 ${minimum} 到 ${maximum} 之间的整数。`);
  }
  return record[key] as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
