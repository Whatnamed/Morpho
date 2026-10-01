// Neutral Agent tool DTOs, schemas and effects. Client and Server share this registry.
import type { ConceptDirectionProposal, VisualIntentItem } from "@/domain/operations/types";
import type { ProjectMemoryKey, StageRecordKey } from "@/domain/morpho/types";
import type { ResponseFunctionTool, ResponseTool } from "@/server/ai/openaiCompatibleProvider";

export type MorphoAgentTurnMode = "auto" | "confirm";

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
    item?: { kind: "finding" | "opportunity" | "constraint" | "openQuestion"; index: number };
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
    action?: "assert" | "supersede" | "retract" | "resolve";
    targetEntryId?: string;
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

export type MorphoAgentToolName = MorphoAgentToolArguments["name"];

export type ToolEffect = {
  readOnly: boolean;
  externalEvidence: boolean;
  pendingDraftWrite: boolean;
  reversibleWorkspaceWrite: boolean;
  memoryWrite: boolean;
  externalCost: boolean;
  highImpactStateChange: boolean;
};

export const MORPHO_AGENT_TOOL_EFFECT_MATRIX = {
  read_selected_context: toolEffect({ readOnly: true }),
  read_project_memory: toolEffect({ readOnly: true }),
  read_stage_record: toolEffect({ readOnly: true }),
  search_project_conversation: toolEffect({ readOnly: true }),
  search_web_evidence: toolEffect({ readOnly: true, externalEvidence: true }),
  create_research_analysis: toolEffect({ reversibleWorkspaceWrite: true }),
  create_design_definition_proposal: toolEffect({
    pendingDraftWrite: true,
    reversibleWorkspaceWrite: true
  }),
  create_concept_direction_proposal: toolEffect({
    pendingDraftWrite: true,
    reversibleWorkspaceWrite: true
  }),
  revise_selected_proposal_draft: toolEffect({ pendingDraftWrite: true }),
  generate_visuals: toolEffect({ reversibleWorkspaceWrite: true, externalCost: true }),
  create_comparison_analysis: toolEffect({ reversibleWorkspaceWrite: true }),
  prepare_delivery_section_draft: toolEffect({ pendingDraftWrite: true }),
  submit_memory_update: toolEffect({ memoryWrite: true }),
  request_confirmation: toolEffect({ highImpactStateChange: true })
} satisfies Record<MorphoAgentToolName, ToolEffect>;

export type AgentToolExecutionPolicy =
  | "execute"
  | "requireConfirmation"
  | "requireExplicitUserCommand"
  | "confirmationOnly";

export function getAgentToolEffect(name: MorphoAgentToolName): ToolEffect {
  return MORPHO_AGENT_TOOL_EFFECT_MATRIX[name];
}

export function resolveAgentToolExecutionPolicy(input: {
  name: MorphoAgentToolName;
  mode: MorphoAgentTurnMode;
  explicitUserCommand: boolean;
}): AgentToolExecutionPolicy {
  const effect = getAgentToolEffect(input.name);
  if (input.name === "request_confirmation") {
    return "confirmationOnly";
  }
  if ((effect.memoryWrite || effect.highImpactStateChange) && !input.explicitUserCommand) {
    return "requireExplicitUserCommand";
  }
  if (effect.externalCost && !input.explicitUserCommand) {
    return "requireConfirmation";
  }
  if (effect.highImpactStateChange) {
    return "requireConfirmation";
  }
  if (input.mode === "confirm" && (effect.reversibleWorkspaceWrite || effect.externalCost)) {
    return "requireConfirmation";
  }
  return "execute";
}

export function buildMorphoAgentTools(
  webSearchEnabled: boolean
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
                lineageKind: {
                  type: "string",
                  enum: ["derivedFromDirection", "splitFromDirection", "mergedFromDirection", "supersedesDirection"]
                }
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
                item: { type: "object", additionalProperties: false, required: ["kind", "index"], properties: { kind: { type: "string", enum: ["finding", "opportunity", "constraint", "openQuestion"] }, index: { type: "integer", minimum: 0 } }, description: "Explicitly binds this evidence to one research item; omit when unbound. Never copy whole-card citations to unrelated items." },
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
                lineageKind: {
                  type: "string",
                  enum: ["derivedFromDirection", "splitFromDirection", "mergedFromDirection", "supersedesDirection"]
                }
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
      description: "普通比较默认直接在聊天中给出差异、权衡与建议，不创建 Compare 记录；只有用户明确要求保存/保留比较记录（如“保留比较记录”“保存这次比较”“创建比较记录”）时才调用本工具。比较建议不是项目决定，绝不自动改变主方向、备选方向、淘汰状态、默认参考或设计定义。",
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
      description: "只提交当前用户消息中明确表达的稳定偏好、约束、避免项或开放问题。evidenceQuote 必须逐字来自当前用户消息。只针对本轮具体图、对象或文本的一次性要求（如“这张图做成红色”“这次背景换白色”）不属于稳定记忆，不要写入；没有可写入内容时传 items: [] 和 skippedReason 说明原因。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["items"],
        properties: {
          items: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "scope", "evidenceQuote", "relatedObjectIds", "relatedRevisionIds"],
              properties: {
                action: { type: "string", enum: ["assert", "supersede", "retract", "resolve"], description: "Only explicit current-user evidence can replace/retract/resolve a fact. Read semanticFacts first; resolve applies only to openQuestion." },
                targetEntryId: { type: "string", description: "Existing semantic fact ID from read_project_memory; required for a lifecycle action." },
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

  return tools.map(withAgentToolEffectDescription);
}

function toolEffect(overrides: Partial<ToolEffect>): ToolEffect {
  return {
    readOnly: false,
    externalEvidence: false,
    pendingDraftWrite: false,
    reversibleWorkspaceWrite: false,
    memoryWrite: false,
    externalCost: false,
    highImpactStateChange: false,
    ...overrides
  };
}

function withAgentToolEffectDescription(tool: ResponseTool): ResponseTool {
  if (tool.type !== "function" || !isMorphoAgentToolName(tool.name)) {
    return tool;
  }
  const effect = getAgentToolEffect(tool.name);
  const boundaries = [
    effect.readOnly ? "read-only" : undefined,
    effect.externalEvidence ? "external-evidence" : undefined,
    effect.pendingDraftWrite ? "pending-draft" : undefined,
    effect.reversibleWorkspaceWrite ? "reversible-workspace-write" : undefined,
    effect.memoryWrite ? "user-evidence-memory-write" : undefined,
    effect.externalCost ? "external-cost" : undefined,
    effect.highImpactStateChange ? "confirmation-only" : undefined
  ].filter((value): value is string => Boolean(value));
  return {
    ...tool,
    description: `${tool.description}\nTool effect: ${boundaries.join(", ") || "conversation-control"}.`
  };
}

export function isMorphoAgentToolName(name: string): name is MorphoAgentToolName {
  return Object.prototype.hasOwnProperty.call(MORPHO_AGENT_TOOL_EFFECT_MATRIX, name);
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

export function visualIntentItemSchema(): Record<string, unknown> {
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
      editMode: { type: "string", enum: ["textToImage", "imageToImage", "directedEdit", "maskedLocalEdit"] },
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
