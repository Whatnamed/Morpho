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

type ActionPattern = RegExp;

const ACTION_PATTERNS: Record<UserInstructionAction, ActionPattern> = {
  webSearch:
    /联网|上网|搜索(?:网页|网络|外部|资料)?|查证|查一下|核实|验证(?:来源|事实|最新|当前)?|外部来源|补充来源|最新(?:资料|信息|案例)|\b(?:web search|search(?: the web| online| for)?|verify online|latest source)\b/i,
  createResearchAnalysis: /(?:创建|形成|整理|记录|生成|产出|保存).{0,16}(?:研究|调研|分析)(?:对象|草案|结果|报告)?/i,
  designDefinition: /设计定义|设计原则|核心问题|(?:创建|形成|修改|修订|更新|调整).{0,16}(?:设计定义|设计原则|核心问题)/i,
  conceptDirection: /概念方向|方向方案|拆分方向|合并方向|(?:创建|形成|修改|修订|更新|调整|拆分|合并).{0,16}(?:方向|方案|概念)/i,
  reviseSelectedProposalDraft: /修改|修订|调整|改写|重写|缩短|改名|rename|rewrite|revise/i,
  applyDesignDefinition: /(?:应用|采纳|确认采用).{0,12}设计定义/i,
  setDirectionPrimary: /(?:设为|设置|确定|选为|指定).{0,16}主方向/i,
  setDirectionAlternative: /(?:设为|设置|确定|选为|指定).{0,16}备选方向/i,
  eliminateDirection: /(?:淘汰|排除).{0,16}方向/i,
  setDefaultReference: /(?:设为|设置|替换|指定).{0,16}默认参考/i,
  batchGenerateVisuals: /(?:生成|出图|预览图|效果图|场景图|角度图|cmf图|细节图)/i
};

const NEGATION_PATTERN =
  /(?:不要|别|无需|无须|不必|不用|不需要|禁止|不得|不能|暂不|暂时不要|先不要|先别|不打算|不准备|不想|不再|不自动|不直接|不是(?:要|想|在)?)/i;
const CLAUSE_BOUNDARY_PATTERN = /[，,。.!！?？；;:\n]/;

/**
 * Returns true when an action occurrence is preceded by a negation in the
 * same user-language clause. Provider output and imported source text must
 * never be passed to this helper.
 */
export function hasNegatedUserAction(draft: string, action: UserInstructionAction): boolean {
  return findActionOccurrences(draft, action).some(({ clause, index }) => {
    const before = clause.slice(0, index);
    return NEGATION_PATTERN.test(before.slice(-32));
  });
}

/**
 * Returns true when the draft contains an action occurrence that is not
 * covered by a local negation. This lets explicit contrast clauses such as
 * “不要修改草案，而是重写标题” preserve the requested replacement action.
 */
export function hasExplicitUserActionRequest(draft: string, action: UserInstructionAction): boolean {
  return findActionOccurrences(draft, action).some(({ clause, index }) => {
    const before = clause.slice(0, index);
    return !NEGATION_PATTERN.test(before.slice(-32));
  });
}

/**
 * A negative instruction wins unless the same draft contains a later,
 * non-negated occurrence of the same action (normally a contrast clause).
 */
export function isUserActionExplicitlyDisallowed(draft: string, action: UserInstructionAction): boolean {
  return hasNegatedUserAction(draft, action) && !hasExplicitUserActionRequest(draft, action);
}

function findActionOccurrences(draft: string, action: UserInstructionAction): Array<{ clause: string; index: number }> {
  const pattern = ACTION_PATTERNS[action];
  return draft
    .split(CLAUSE_BOUNDARY_PATTERN)
    .flatMap((clause) => {
      const occurrences: Array<{ clause: string; index: number }> = [];
      const matcher = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
      for (const match of clause.matchAll(matcher)) {
        if (match.index !== undefined) occurrences.push({ clause, index: match.index });
      }
      return occurrences;
    });
}
