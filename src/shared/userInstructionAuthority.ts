export type UserInstructionAction =
  | "webSearch"
  | "createResearchAnalysis"
  | "designDefinition"
  | "conceptDirection"
  | "reviseSelectedProposalDraft"
  | "applyDesignDefinition"
  | "setDirectionPrimary"
  | "setDirectionAlternative"
  | "eliminateDirection"
  | "setDefaultReference"
  | "batchGenerateVisuals";

type ActionRule = Readonly<{
  positive: RegExp;
  negative: RegExp;
}>;

type ActionDecision = Readonly<{ negated: boolean }>;

const NEGATION_PREFIX = "(?:不|不要|别|无需|无须|不必|不用|不需要|禁止|不得|不能|暂不|先不要|先别|不再|不自动|不直接)";
const ACTION_GAP = "[^，,。.!！?？；;：:\n]{0,20}";
const ACTION_RULES: Record<UserInstructionAction, ActionRule> = {
  webSearch: explicitRule(
    /(?:联网|上网|搜索(?:网页|网络|资料)?|查证|查一下|核实|验证|补充(?:外部)?来源|查最新(?:资料|信息|标准)?|最新(?:资料|信息|标准)|web\s+search|\bsearch(?:\s+(?:the\s+web|online|for))?|verify\s+online|latest\s+source)/i,
    false
  ),
  createResearchAnalysis: explicitRule(
    /(?:创建|形成|整理|记录|生成|产出|保存)\s*(?:研究|调研|分析)(?:对象|草案|结果|报告)?/i
  ),
  designDefinition: explicitRule(
    /(?:创建|形成|修改|修订|更新|调整|重写|改写|建立|定义|生成|提炼)\s*(?:当前|新的|一版|一份)?\s*(?:设计定义|设计原则|核心问题)/i
  ),
  conceptDirection: explicitRule(
    /(?:创建|形成|修改|修订|更新|调整|拆分|拆成|分成|合并|整合|重写|改写|扩展|发展|生成|提炼)\s*(?:当前|新的|多个|一版|一份|[一二两三四五六七八九十\d]+个)?\s*(?:概念方向|方向方案|方向|方案|概念|路线)/i
  ),
  reviseSelectedProposalDraft: explicitRule(
    /(?:修改|修订|更新|调整|改写|重写|缩短|改名|rename|rewrite|revise)\s*(?:选中(?:的)?|选定(?:的)?|这个|该|当前)?\s*(?:草案|提案|标题|名称|摘要|方向|方案|设计定义|概念方向|内容|正文|描述|prompt|draft|proposal)/i
  ),
  applyDesignDefinition: explicitRule(/(?:应用|采纳|确认采用)[^，,。.!！?？；;：:\n]{0,12}设计定义/i),
  setDirectionPrimary: explicitRule(actionWithTarget(/设为|设置|确定|选为|指定/, /主方向/)),
  setDirectionAlternative: explicitRule(actionWithTarget(/设为|设置|确定|选为|指定/, /备选方向/)),
  eliminateDirection: explicitRule(actionWithTarget(/淘汰|排除/, /方向/)),
  setDefaultReference: explicitRule(actionWithTarget(/设为|设置|替换|指定/, /默认参考/)),
  batchGenerateVisuals: explicitRule(/(?:生成|出图)[^，,。.!！?？；;：:\n]{0,20}(?:预览|效果|场景|角度|cmf|细节|图片|图像|视觉)/i)
};

const CLAUSE_BOUNDARY = /[，,。.!！?？；;：:\n]/;
const REFERENCE_CLAUSE = /^(?:在)?(?:示例|引用|文档|资料|原文|命令|记录)[^，,。.!！?？；;：:\n]{0,12}[:：]/i;
const REFERENCE_FRAME = /(?:示例|引用|文档|资料|原文|命令|记录)[^。.!！?？\n]{0,40}[:：][^。.!！?？\n]*/gi;

function explicitRule(positive: RegExp, allowInterveningText = true): ActionRule {
  return {
    positive,
    negative: new RegExp(`(?:也|还|并)?\\s*${NEGATION_PREFIX}${allowInterveningText ? ACTION_GAP : "\\s*"}${positive.source}`, positive.flags)
  };
}

function actionWithTarget(action: RegExp, target: RegExp): RegExp {
  return new RegExp(`(?:把|将)?${ACTION_GAP}(?:${action.source})${ACTION_GAP}${target.source}`, action.flags);
}

/** Removes quoted/reference instructions before any UX-only routing heuristic. */
export function stripUntrustedInstructionSegments(text: string): string {
  const pairs: Readonly<Record<string, string>> = { "“": "”", "‘": "’", "「": "」", "『": "』", '"': '"' };
  const chars = [...text];
  let closing: string | undefined;
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (!closing) {
      const next = char ? pairs[char] : undefined;
      if (next) closing = next;
      continue;
    }
    chars[index] = " ";
    if (char === closing) closing = undefined;
  }
  return chars.join("").replace(REFERENCE_FRAME, " ");
}

function findActionDecisions(draft: string, action: UserInstructionAction): ActionDecision[] {
  const text = stripUntrustedInstructionSegments(draft);
  const rule = ACTION_RULES[action];
  const decisions: ActionDecision[] = [];
  let start = 0;

  for (let end = 0; end <= text.length; end += 1) {
    const atEnd = end === text.length;
    if (!atEnd && !CLAUSE_BOUNDARY.test(text[end] ?? "")) continue;
    const clause = text.slice(start, end).trim();
    if (clause && !REFERENCE_CLAUSE.test(clause)) {
      const negative = rule.negative.test(clause);
      const positive = rule.positive.test(clause);
      if (negative) {
        // A clause containing both forms is deliberately denied; ambiguity is
        // a caller-facing retry, never a reason to mint effect authority.
        decisions.push({ negated: true });
      } else if (positive) {
        const match = rule.positive.exec(clause);
        const prefix = match && match.index !== undefined ? clause.slice(0, match.index) : "";
        const negated = isNegatedPositivePrefix(prefix);
        if (negated) {
          decisions.push({ negated: true });
        } else {
          decisions.push({ negated: false });
        }
      }
    }
    if (atEnd) break;
    start = end + 1;
  }
  return decisions;
}

function isNegatedPositivePrefix(prefix: string): boolean {
  return new RegExp(`${NEGATION_PREFIX}(?:\\s|直接|自动|再|先|立即|当前|现在)*$`).test(prefix.trim());
}

/** Positive cues are advisory evidence only; callers still need structured state. */
export function hasExplicitUserActionRequest(draft: string, action: UserInstructionAction): boolean {
  const decisions = findActionDecisions(draft, action);
  return decisions.some((decision) => !decision.negated) && !decisions.some((decision) => decision.negated);
}

/** Any denial or unresolved conflict keeps the action closed for this turn. */
export function isUserActionExplicitlyDisallowed(draft: string, action: UserInstructionAction): boolean {
  return findActionDecisions(draft, action).some((decision) => decision.negated);
}
