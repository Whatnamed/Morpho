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
  /(?:不要|别|无需|无须|不必|不用|不需要|禁止|不得|不能|暂不|暂时不要|先不要|先别|不打算|不准备|不想|不再|不自动|不直接|不是(?:要|想|在)?|(?:^|[\s，,。.!！?？；;:\n])不(?:要|能|会|再|直接|自动|需要|必|想|打算|准备|应该|补充|搜索|查|核实|验证)?\s*$)/i;
const CLAUSE_BOUNDARY_PATTERN = /[，,。.!！?？；;:\n]/;

type ActionOccurrence = {
  start: number;
  end: number;
  negated: boolean;
  kind: "request" | "topic";
};

const TOPIC_PREFIX_PATTERN =
  /(?:(?:只|仅|请|帮我|先|再|继续|也)?(?:分析|解释|说明|查看|理解|总结|比较|讨论|研究|围绕|针对|看|读取|梳理|了解|评估|判断|核对)(?:一下|下)?(?:现有|已有|当前|相关|这些|本地|外部|这张|这份|这个|该|选中(?:的)?|选定(?:的)?|多个|几个|各个|一个|某个)?|现有|已有|当前|相关|这些|本地|外部|选中(?:的)?|这个|该|关于|怎么|如何|为何|为什么)\s*$/;
const REQUEST_PREFIX_PATTERN =
  /(?:请|帮我|创建|形成|生成|产出|保存|修改|修订|更新|调整|拆分|合并|重写|改写|提出|设计|做|应用|采纳|确认采用|改为|改成)(?:一个|该|这个|新的|选中的|选定的|当前|多个|几个|各个|这几个|[一二两三四五六七八九十\d]+个?)?\s*$/;
const TOPIC_NOUN_PATTERN = /^(?:资料|材料|信息|来源|内容|记录|数据|文档|文件|证据|历史|痕迹|日志|结果|说明|原因|意见|建议|版本)/;
const TOPIC_REFERENCE_SUFFIX_PATTERN = /^(?:的|是否|如何|怎么|原因|理由|条件|影响|案例|标准|规范|报告|研究|分析|结论|约束|草案|版本|资料|材料|信息|来源|内容|记录|数据|文档|文件|证据|历史|痕迹|日志|结果|说明|意见|建议|需要|应该|可以|能够|已经|仍然|仍需|存在|包括|包含|属于|是|为|与|和|及|后|前|时|问题|优缺点|边界|要点|表现|关系|变化)/;
const VISUAL_REFERENCE_PATTERN = /^(?:预览图|效果图|场景图|角度图|cmf图|细节图|图片|图像)/i;
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

function isTopicReferenceContext(before: string, after: string): boolean {
  const nearBefore = before.slice(-32);
  const nearAfter = after.slice(0, 32);
  return TOPIC_PREFIX_PATTERN.test(nearBefore) && (
    nearAfter.length === 0 ||
    TOPIC_REFERENCE_SUFFIX_PATTERN.test(nearAfter) ||
    VISUAL_REFERENCE_PATTERN.test(nearAfter) ||
    /^(?:并|并且|以及|同时|然后|再|且|而且)/.test(nearAfter)
  );
}

/**
 * Returns true when an action occurrence is preceded by a negation in the
 * same user-language clause. Provider output and imported source text must
 * never be passed to this helper.
 */
export function hasNegatedUserAction(draft: string, action: UserInstructionAction): boolean {
  return findActionRequests(draft, action).some(({ negated }) => negated);
}

/**
 * Returns true when the draft contains an action occurrence that is not
 * covered by a local negation. This lets explicit contrast clauses such as
 * “不要修改草案，而是重写标题” preserve the requested replacement action.
 */
export function hasExplicitUserActionRequest(draft: string, action: UserInstructionAction): boolean {
  return findActionRequests(draft, action).some(({ negated }) => !negated);
}

/**
 * The last explicit request for the same action is authoritative. Topic
 * mentions (for example, “分析现有概念方向”) are intentionally ignored so
 * that they cannot turn an earlier prohibition into permission.
 */
export function isUserActionExplicitlyDisallowed(draft: string, action: UserInstructionAction): boolean {
  const occurrences = findActionRequests(draft, action);
  return occurrences.at(-1)?.negated ?? false;
}

function findActionRequests(draft: string, action: UserInstructionAction): ActionOccurrence[] {
  return findActionOccurrences(draft, action).filter(({ kind }) => kind === "request");
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
      occurrences.push({
        start,
        end,
        negated: isNegatedPrefix(before),
        kind: isTopicOccurrence(action, match[0], before, after) ? "topic" : "request"
      });
    }

    if (atEnd) break;
    clauseStart = clauseEnd + 1;
  }

  return occurrences.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return left.end - right.end;
  });
}

function isTopicOccurrence(action: UserInstructionAction, matchText: string, before: string, after: string): boolean {
  const nearBefore = before.slice(-32);
  const nearAfter = after.slice(0, 32);

  // A negated occurrence is always a request: “不要联网” and
  // “不要修改这个草案” must not be mistaken for noun phrases.
  if (isNegatedPrefix(nearBefore)) return false;

  switch (action) {
    case "webSearch": {
      if (REQUEST_PREFIX_PATTERN.test(nearBefore)) return false;
      if (nearBefore.length === 0 && nearAfter.length === 0) return false;
      if (
        /^(?:搜索|查证|查一下|核实|验证|补充来源|外部来源)$/i.test(matchText) &&
        !TOPIC_PREFIX_PATTERN.test(nearBefore)
      ) return false;
      if (TOPIC_NOUN_PATTERN.test(nearAfter) || TOPIC_REFERENCE_SUFFIX_PATTERN.test(nearAfter)) return true;
      if (TOPIC_PREFIX_PATTERN.test(nearBefore) && /^(?:联网|上网|外部来源)$/i.test(matchText)) return true;
      return (
        TOPIC_PREFIX_PATTERN.test(nearBefore) && nearAfter.length === 0
      );
    }
    case "conceptDirection": {
      if (REQUEST_PREFIX_PATTERN.test(nearBefore)) return false;
      return isTopicReferenceContext(before, after) ||
        (/^(?:概念方向|方向方案)$/i.test(matchText) && nearBefore.length === 0);
    }
    case "designDefinition": {
      if (REQUEST_PREFIX_PATTERN.test(nearBefore)) return false;
      return isTopicReferenceContext(before, after) ||
        (/^(?:设计定义|设计原则|核心问题)$/i.test(matchText) && nearBefore.length === 0);
    }
    case "createResearchAnalysis":
    case "applyDesignDefinition":
    case "setDirectionPrimary":
    case "setDirectionAlternative":
    case "eliminateDirection":
    case "setDefaultReference": {
      return isTopicReferenceContext(before, after);
    }
    case "reviseSelectedProposalDraft": {
      return /^(?:修改|修订|调整|改写|重写|缩短|改名)$/i.test(matchText) &&
        isTopicReferenceContext(before, after);
    }
    case "batchGenerateVisuals": {
      return isTopicReferenceContext(before, after);
    }
    default:
      return false;
  }
}
