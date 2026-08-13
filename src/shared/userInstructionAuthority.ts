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

// These patterns locate candidate action tokens. A non-negated candidate is
// admitted to the authority ledger only when positive request evidence exists
// around it; a bare topic mention is therefore non-authoritative by default.
const ACTION_PATTERNS: Record<UserInstructionAction, ActionPattern> = {
  webSearch:
    /联网|上网|搜索(?:网页|网络|外部|资料)?|查证|查一下|核实|验证(?:来源|事实|最新|当前)?|外部来源|补充来源|最新(?:资料|信息|案例)|\b(?:web search|search(?: the web| online| for)?|verify online|latest source)\b/i,
  createResearchAnalysis: /(?:创建|形成|整理|记录|生成|产出|保存).{0,16}(?:研究|调研|分析)(?:对象|草案|结果|报告)?/i,
  designDefinition:
    /(?:创建|形成|修改|修订|更新|调整).{0,16}(?:设计定义|设计原则|核心问题)|设计定义|设计原则|核心问题/i,
  conceptDirection:
    /(?:创建|形成|修改|修订|更新|调整|拆分|合并).{0,16}(?:概念方向|方向方案|方向|方案|概念)|概念方向|方向方案|拆分方向|合并方向/i,
  reviseSelectedProposalDraft: /修改|修订|调整|改写|重写|缩短|改名|rename|rewrite|revise/i,
  applyDesignDefinition: /(?:应用|采纳|确认采用).{0,12}设计定义/i,
  setDirectionPrimary: /(?:设为|设置|确定|选为|指定).{0,16}主方向/i,
  setDirectionAlternative: /(?:设为|设置|确定|选为|指定).{0,16}备选方向/i,
  eliminateDirection: /(?:淘汰|排除).{0,16}方向/i,
  setDefaultReference: /(?:设为|设置|替换|指定).{0,16}默认参考/i,
  batchGenerateVisuals: /(?:生成|出图|预览图|效果图|场景图|角度图|cmf图|细节图)/i
};

const NEGATION_PATTERN =
  /(?:不要|别|无需|无须|不必|不用|不需要|禁止|不得|不能|暂不|暂时不要|先不要|先别|不打算|不准备|不想|不再|不自动|不直接|不是(?:要|想|在)?|(?:^|[\s，,。.!！?？；;：:\n、])不(?:要|能|会|再|直接|自动|需要|必|想|打算|准备|应该|补充|搜索|查|核实|验证)?\s*$)/i;
const CLAUSE_BOUNDARY_PATTERN = /[，,。.!！?？；;：:\n]/;

type ActionOccurrence = {
  start: number;
  end: number;
  negated: boolean;
};

const COMMAND_PREFIX_PATTERN =
  /(?:请你?|帮我|需要|要|必须|务必|可以|希望|补充|查询|搜索|查|核实|验证|获取)\s*$/;
const DIRECT_WEB_NEGATION_PATTERN =
  /(?:^|[\s，,。.!！?？；;：:\n、])(?:请(?:你)?|帮我|希望|我(?:想|要|希望|需要)?)?\s*(?:但|也|还|并)?(?:不|不要|别|无需|无须|不必|不用|不需要|禁止|不得|不能|暂不|暂时不要|先不要|先别|不打算|不准备|不想|不再|不自动|不直接)(?:直接|自动|再|要)?\s*$/;
const DIRECT_NEGATION_PREFIX_PATTERN =
  /(?:^|[\s，,。.!！?？；;：:\n、])(?:请(?:你)?|帮我|希望|我(?:想|要|希望|需要)?)?\s*(?:但|也|还|并)?(?:不要|别|无需|无须|不必|不用|不需要|禁止|不得|不能|暂不|暂时不要|先不要|先别|不打算|不准备|不想|不再|不自动|不直接|不(?:要|能|会|再|直接|自动|需要|必|想|打算|准备))(?:(?:再|直接|自动|先|暂时|立即|把|将|对|给|让|替|这个|该|选中(?:的)?|选定(?:的)?|当前|新的|一个|某个))*?(?:设为|设置|确定|选为|指定)?\s*$/;
const TOPIC_OBJECT_PREFIX_PATTERN =
  /(?:现有|已有|当前|相关|这些|本地|外部|这张|这份|这个|该|选中(?:的)?|选定(?:的)?|多个|几个|各个|一个|某个)\s*$/;
const POSITIVE_REOPEN_PATTERN = /(?:而是|改为|改成|转而|后来|继续|还是|但请|但要)\s*$/;
const REFERENCE_CONTEXT_PATTERN =
  /(?:^|[\s，,。.!！?？；;：:\n、])(?:(?:只|仅|先|再|我想|我希望|我需要|请你?|帮我|希望|想要)?(?:分析|总结|说明|解释|查看|参考|理解|梳理|回顾|提炼|评估|研究|了解|阅读)(?:一下|下)?(?:现有|已有|当前|相关|这些|本地|外部|这张|这份|这个|该|选中(?:的)?|选定(?:的)?|多个|几个|各个|一个|某个)?|基于|根据|围绕|针对|关于)\s*$/;
const REFERENCE_FRAME_PATTERN = /(?:文档|资料|原文|引用|这句话|标题|命令|示例|例子|记录|说明)[^，,。.!！?？；;：:\n、]{0,20}(?:里|中|中的|里的|提到|包含|写着)\s*(?:(?:请(?:你)?|帮我|不要|别|不|应当|必须|可以|建议)\s*)?$/;
const REFERENCE_NOUN_AFTER_PATTERN = /^(?:的|里的|中的)?(?:流程|过程|步骤|方法|原因|记录|历史|说明|内容|定义|概念|关系|案例|标准|规范|版本|做法)/;
const SEARCH_OPERATION_AFTER_PATTERN = /^(?:查|查一下|查询|搜|搜索|搜一下|检索|核实|验证|确认|补充|获取|了解)/i;
const SEARCH_TARGET_AFTER_PATTERN = /^(?:官方|这些|相关|最新|当前|外部|材料|资料|来源|信息|标准|规范|案例|事实|数据|网页|网络)/i;
const SEARCH_REQUEST_WITH_TARGET_PATTERN = /^(?:搜索|查证|查一下|核实|验证)(?:官方|这些|相关|最新|当前|外部|材料|资料|来源|信息|标准|规范|案例|事实|数据|网页|网络)/i;
const POST_DESIGN_MUTATION_PATTERN = /^(?:修改|修订|更新|调整|重写|改写|收束)(?:(?:设计定义|设计原则|核心问题)|(?:当前|新的)?(?:定义|原则|核心问题))?$/;
const POST_CONCEPT_MUTATION_PATTERN = /^(?:修改|修订|更新|调整|拆分|拆成|分成|合并|整合|重写|改写|收束|扩展)(?:[一二两三四五六七八九十\d]+个?(?:方向|方案)?|(?:新的|当前|多个)?(?:概念方向|方向方案|方向|方案|概念))?$/;
const RESEARCH_MUTATION_AFTER_PATTERN = /^(?:创建|形成|整理|记录|生成|产出|保存)(?:研究|调研|分析)/;
const DESIGN_OBJECT_MUTATION_AFTER_PATTERN = /^(?:创建|形成|修改|修订|更新|调整|整理|收束|重写|改写|提炼|生成|保存|建立|定义)(?:设计定义|设计原则|核心问题)/;
const CONCEPT_OBJECT_MUTATION_AFTER_PATTERN = /^(?:创建|形成|修改|修订|更新|调整|拆分|拆成|分成|合并|整合|生成|产出|发展|重写|改写|收束|扩展)(?:概念方向|方向方案|方向|方案|概念)/;
const REVISION_REQUEST_PATTERN = /^(?:修改|修订|调整|改写|重写|缩短|改名|rename|rewrite|revise)$/i;
const REVISION_TARGET_PATTERN = /^(?:一下)?(?:选中(?:的)?|选定(?:的)?|这个|该|当前)?(?:草案|提案|标题|名称|摘要|方向|方案|设计定义|概念方向|内容|正文|描述|prompt|draft|proposal)/i;
const VISUAL_REQUEST_PATTERN = /^(?:生成|出图)/i;
const VISUAL_TARGET_PATTERN = /(?:预览|效果|场景|角度|cmf|细节|图片|图像|视觉)/i;
const CONTRAST_PATTERN = /(?:而是|改为|改成|转而|但是|但)/g;

function isNegatedPrefix(prefix: string): boolean {
  const suffix = prefix.slice(-48);
  const lastContrast = lastMatchIndex(suffix, CONTRAST_PATTERN);
  if (lastContrast >= 0 && !NEGATION_PATTERN.test(suffix.slice(lastContrast))) {
    return false;
  }
  return NEGATION_PATTERN.test(suffix);
}

function lastMatchIndex(value: string, pattern: RegExp): number {
  let lastIndex = -1;
  for (const match of value.matchAll(pattern)) {
    if (match.index !== undefined) lastIndex = match.index;
  }
  return lastIndex;
}

function hasUnclosedQuote(text: string): boolean {
  const opens = [...text].reduce((last, char, index) =>
    "‘“「『\"".includes(char) ? index : last, -1);
  const closes = [...text].reduce((last, char, index) =>
    "’”」』\"".includes(char) ? index : last, -1);
  return opens > closes;
}

function isReferenceContext(before: string): boolean {
  const suffix = before.slice(-96);
  return REFERENCE_CONTEXT_PATTERN.test(suffix) || REFERENCE_FRAME_PATTERN.test(suffix) || hasUnclosedQuote(suffix);
}

function hasPostObjectMutation(action: UserInstructionAction, suffix: string): boolean {
  const trimmed = suffix.trim();
  if (action === "designDefinition") {
    return POST_DESIGN_MUTATION_PATTERN.test(trimmed) &&
      !RESEARCH_MUTATION_AFTER_PATTERN.test(trimmed) &&
      !CONCEPT_OBJECT_MUTATION_AFTER_PATTERN.test(trimmed);
  }
  if (action === "conceptDirection") {
    return POST_CONCEPT_MUTATION_PATTERN.test(trimmed) &&
      !RESEARCH_MUTATION_AFTER_PATTERN.test(trimmed) &&
      !DESIGN_OBJECT_MUTATION_AFTER_PATTERN.test(trimmed);
  }
  return false;
}

function hasPositiveRequestEvidence(
  action: UserInstructionAction,
  matchText: string,
  before: string,
  after: string
): boolean {
  const prefix = before.slice(-64);
  const suffix = after.slice(0, 64);

  // Quoted commands and source/reference framing never mint authority.
  if (isReferenceContext(prefix)) return false;

  switch (action) {
    case "webSearch":
      return (
        POSITIVE_REOPEN_PATTERN.test(prefix) ||
        COMMAND_PREFIX_PATTERN.test(prefix) ||
        SEARCH_OPERATION_AFTER_PATTERN.test(suffix) ||
        (SEARCH_REQUEST_WITH_TARGET_PATTERN.test(matchText) ||
          (/^(?:搜索|查证|查一下|核实|验证|外部来源|补充来源|最新)/i.test(matchText) &&
            SEARCH_TARGET_AFTER_PATTERN.test(suffix)))
      );
    case "createResearchAnalysis":
      return /^(?:创建|形成|整理|记录|生成|产出|保存)/.test(matchText) &&
        !TOPIC_OBJECT_PREFIX_PATTERN.test(prefix) &&
        !REFERENCE_NOUN_AFTER_PATTERN.test(suffix);
    case "designDefinition":
      return (
        /^(?:创建|形成|修改|修订|更新|调整)/.test(matchText) &&
        !TOPIC_OBJECT_PREFIX_PATTERN.test(prefix) &&
        !REFERENCE_NOUN_AFTER_PATTERN.test(suffix)
      ) || hasPostObjectMutation(action, suffix);
    case "conceptDirection":
      return (
        /^(?:创建|形成|修改|修订|更新|调整|拆分|合并)/.test(matchText) &&
        !TOPIC_OBJECT_PREFIX_PATTERN.test(prefix) &&
        !REFERENCE_NOUN_AFTER_PATTERN.test(suffix)
      ) || hasPostObjectMutation(action, suffix);
    case "reviseSelectedProposalDraft":
      return REVISION_REQUEST_PATTERN.test(matchText) && REVISION_TARGET_PATTERN.test(suffix);
    case "applyDesignDefinition":
      return /^(?:应用|采纳|确认采用)/.test(matchText);
    case "setDirectionPrimary":
    case "setDirectionAlternative":
      return /^(?:设为|设置|确定|选为|指定)/.test(matchText);
    case "eliminateDirection":
      return /^(?:淘汰|排除)/.test(matchText);
    case "setDefaultReference":
      return /^(?:设为|设置|替换|指定)/.test(matchText);
    case "batchGenerateVisuals":
      return /^出图/i.test(matchText) || (VISUAL_REQUEST_PATTERN.test(matchText) &&
        (VISUAL_TARGET_PATTERN.test(matchText) || VISUAL_TARGET_PATTERN.test(suffix)));
    default:
      return false;
  }
}

function hasNegatedRequestEvidence(
  action: UserInstructionAction,
  matchText: string,
  before: string,
  after: string
): boolean {
  const prefix = before.slice(-64);
  const suffix = after.slice(0, 64);
  const hasDirectNegationPrefix =
    DIRECT_NEGATION_PREFIX_PATTERN.test(prefix) ||
    /(?:^|[\s，,。.!！?？；;:\n])不\s*$/.test(prefix);
  if (!hasDirectNegationPrefix || isReferenceContext(prefix)) return false;

  switch (action) {
    case "webSearch":
      return (
        /^(?:联网|上网)/i.test(matchText) &&
        (/^不\s*$/.test(prefix.slice(-4)) || DIRECT_WEB_NEGATION_PATTERN.test(prefix.slice(-12)))
      ) || /^(?:搜索|查证|查一下|核实|验证|外部来源|补充来源|最新)/i.test(matchText);
    case "createResearchAnalysis":
      return /^(?:创建|形成|整理|记录|生成|产出|保存)/.test(matchText);
    case "designDefinition":
      return /^(?:创建|形成|修改|修订|更新|调整)/.test(matchText);
    case "conceptDirection":
      return /^(?:创建|形成|修改|修订|更新|调整|拆分|合并)/.test(matchText);
    case "reviseSelectedProposalDraft":
      return REVISION_REQUEST_PATTERN.test(matchText) && REVISION_TARGET_PATTERN.test(suffix);
    case "applyDesignDefinition":
      return /^(?:应用|采纳|确认采用)/.test(matchText);
    case "setDirectionPrimary":
    case "setDirectionAlternative":
      return /^(?:设为|设置|确定|选为|指定)/.test(matchText);
    case "eliminateDirection":
      return /^(?:淘汰|排除)/.test(matchText);
    case "setDefaultReference":
      return /^(?:设为|设置|替换|指定)/.test(matchText);
    case "batchGenerateVisuals":
      return VISUAL_REQUEST_PATTERN.test(matchText) || VISUAL_TARGET_PATTERN.test(matchText);
    default:
      return false;
  }
}

/**
 * Returns true when an action occurrence is preceded by a negation in the
 * same user-language clause. Provider output and imported source text must
 * never be passed to this helper.
 */
export function hasNegatedUserAction(draft: string, action: UserInstructionAction): boolean {
  return findActionOccurrences(draft, action).some(({ negated }) => negated);
}

/**
 * Returns true only for a non-negated occurrence with positive request
 * evidence. Bare action/topic mentions are deliberately excluded.
 */
export function hasExplicitUserActionRequest(draft: string, action: UserInstructionAction): boolean {
  return findActionOccurrences(draft, action).some(({ negated }) => !negated);
}

/**
 * The last explicit request for the same action is authoritative. The ledger
 * contains only negated requests or positively evidenced requests, so a bare
 * topic mention cannot reopen an earlier prohibition.
 */
export function isUserActionExplicitlyDisallowed(draft: string, action: UserInstructionAction): boolean {
  return findActionOccurrences(draft, action).at(-1)?.negated ?? false;
}

function findActionOccurrences(draft: string, action: UserInstructionAction): ActionOccurrence[] {
  const pattern = ACTION_PATTERNS[action];
  const occurrences: ActionOccurrence[] = [];
  const matcher = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, "")}g`);
  let clauseStart = 0;

  for (let clauseEnd = 0; clauseEnd <= draft.length; clauseEnd += 1) {
    const atEnd = clauseEnd === draft.length;
    if (!atEnd && !CLAUSE_BOUNDARY_PATTERN.test(draft[clauseEnd] ?? "")) continue;

    const clause = draft.slice(clauseStart, clauseEnd);
    for (const match of clause.matchAll(matcher)) {
      if (match.index === undefined) continue;

      const start = clauseStart + match.index;
      const end = start + match[0].length;
      const before = clause.slice(0, match.index);
      const after = clause.slice(match.index + match[0].length);
      const fullBefore = draft.slice(0, start);
      if (isReferenceContext(fullBefore)) continue;

      const negated = isNegatedPrefix(before);
      if (
        (negated && !hasNegatedRequestEvidence(action, match[0], before, after)) ||
        (!negated && !hasPositiveRequestEvidence(action, match[0], before, after))
      ) continue;
      occurrences.push({ start, end, negated });
    }

    if (atEnd) break;
    clauseStart = clauseEnd + 1;
  }

  return occurrences.sort((left, right) =>
    left.start === right.start ? left.end - right.end : left.start - right.start
  );
}
