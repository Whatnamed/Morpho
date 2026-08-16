export type RequiredAgentMemoryUpdateKind = "preference" | "avoidance" | "constraint" | "openQuestion";

export type RequiredAgentMemoryUpdate = {
  kind: RequiredAgentMemoryUpdateKind;
  reason: string;
  evidenceQuote: string;
  evidenceStart: number;
  evidenceEnd: number;
};

export type AgentMemoryUpdateValidation = {
  accepted: Array<{ itemIndex: number; candidateIndex: number }>;
  rejected: Array<{ itemIndex: number; reason: string }>;
  handledCandidateIndexes: number[];
};

const ONE_OFF_OPERATION_PATTERN =
  /(?:不要|无需|不必|只|仅).{0,12}(?:调用|修改|改动|写入|记录|保存|创建|删除|更新|执行).{0,12}(?:工具|项目|对象|状态|画布|记忆|偏好|避免项|约束|开放问题|草稿)/;

/**
 * Quantitative constraint phrases, defined ONCE so the one-off subject
 * override and the constraint classifier cannot drift apart. The common
 * spoken forms 不要超过 / 别超过 / 别再超过 are deliberately included.
 */
const QUANTITATIVE_CONSTRAINT_PHRASES = [
  "不要超过",
  "别超过",
  "别再超过",
  "不得超过",
  "不能超过",
  "不允许超过",
  "不超过",
  "上限",
  "封顶",
  "必须控制在",
  "控制在",
  "最多",
  "不得高于",
  "不能高于",
  "低于",
  "少于",
  "限制在",
  "不能超出",
  "不得超出",
  "必须低于",
  "必须少于"
] as const;

const QUANTITATIVE_CONSTRAINT_PHRASE_ALTERNATION = QUANTITATIVE_CONSTRAINT_PHRASES.join("|");

/**
 * Concrete one-off scope: clauses addressing this turn's specific image,
 * version, angle, background, position, or provisional action. A clause
 * carrying one of these is rejected from long-term memory unless an explicit
 * project/long-term scope or a hard quantitative constraint SUBJECT overrides
 * it. Bare "统一"/"稳定" are deliberately NOT here and NOT long-term scope:
 * "这张图统一一下配色" stays one-off.
 */
const ONE_OFF_SCOPE_PATTERN =
  /(?:这张图|这张|这次的图|这轮的图|这版|当前这版|这个角度|当前角度|这张参考图|刚才那张|刚才这个|新生成的图|生成的图|这次背景|当前背景|这种背景|这个背景|这个位置|这一张|这幅|这个渲染|这次先|本轮先|这次|本轮|临时|先试|只改这个位置|临时试一下|先生成一张|先生成两张|这条回复短一点|其他方向暂时不用改)/;

/**
 * Explicit project-level scope. "这次/本轮" alone is not a one-off signal,
 * but neither is a bare product or dimension noun. A one-off clause may pass
 * only with an EXPLICIT project-level scope (课设/课题/项目/整机/全案/产品线/
 * 整个产品/总体/全局/本项目/本课题), or a constraint subject paired with an
 * explicit quantitative constraint form (see
 * PROJECT_CONSTRAINT_SUBJECT_OVERRIDE_PATTERN). Bare "产品", "尺寸", "范围",
 * "预算", or "成本" alone are NOT sufficient: "这次产品不要用蓝色",
 * "这次尺寸不要改", and "这次预算那段不要写" are one-off operation
 * requirements, while "这次课设预算不能超过 500 元",
 * "本轮项目产品尺寸必须控制在桌面范围内", and "这次预算不要超过 500 元" are
 * project-wide constraints.
 */
const PROJECT_SCOPE_MEMORY_OVERRIDE_PATTERN =
  /课设|课题|项目|整机|全案|产品线|整个产品|总体|全局|本项目|本课题/;

/**
 * Strong long-term scope: the clause governs all future work, not this turn.
 * Explicit memory-intent words (记住/记录) and 以后/后续/从现在起/始终/接下来/
 * 后面/整个项目/希望以后 qualify. 长期 qualifies only with a staying verb
 * (长期保持/采用/使用…), so "长期偏好" (the memory category) never acts as a
 * scope marker. 统一/稳定 deliberately do NOT qualify at all.
 */
const EXPLICIT_LONG_TERM_SCOPE_PATTERN =
  /以后|后续|从现在起|始终|接下来|后面|整个项目|希望以后|记住|记录|长期(?:保持|遵守|采用|执行|使用|不变|稳定|沿用)/;

/**
 * "预算/成本" are constraint SUBJECTS, not scope markers. They bypass the
 * one-off guard only when the clause carries an explicit quantitative
 * constraint form around them ("预算不要超过 500", "成本上限 300",
 * "总成本必须控制在…以内"). "这次预算那段不要写" / "这次成本不要考虑" stay one-off.
 */
const PROJECT_CONSTRAINT_SUBJECT_OVERRIDE_PATTERN = new RegExp(
  `(?:预算|成本).{0,12}(?:${QUANTITATIVE_CONSTRAINT_PHRASE_ALTERNATION})|(?:${QUANTITATIVE_CONSTRAINT_PHRASE_ALTERNATION}).{0,12}(?:预算|成本)`
);

/**
 * 规范性语法：约束立场必须由这些词表达，裸设计名词（尺寸/高度/宽度/重量）不是
 * 约束。"这个尺寸合适吗？" 没有规范性词，不得成为 constraint candidate；
 * "尺寸必须小于 200 mm" / "预算不能超过 500 元" 才有。
 */
const CONSTRAINT_NORMATIVE_PATTERN = new RegExp(
  `必须|不得|不能|不允许|不超过|不低于|至少|至多|小于|大于|高于|低于|少于|多于|上限|封顶|控制在|限制在|${QUANTITATIVE_CONSTRAINT_PHRASE_ALTERNATION}`
);

/**
 * 约束主语：只有与规范性语法（或显式记忆意图 记住/记录）相邻出现时才能构成
 * constraint。"记住这个尺寸" 是记录约束的请求；"这个尺寸合适吗？" 不是。
 */
const CONSTRAINT_SUBJECT_PATTERN = /尺寸|高度|宽度|重量|约束|限制/;

/**
 * 偏好立场：真正表达"跨回合保持"的立场词。裸设计属性（材质/颜色/风格）不是
 * 偏好："这个材质怎么样？" 不得成为 preference candidate；"我偏好哑光材质" /
 * "默认用暖灰色" 才是。
 */
const PREFERENCE_STANCE_PATTERN =
  /我喜欢|我偏好|偏好|默认|以后|后续|始终|长期|统一采用|统一沿用|希望(?:一直|始终|以后|保持|用|采用|延续|沿用|维持)/;

const PREFERENCE_ATTRIBUTE_PATTERN = /低饱和|高饱和|风格|材质|颜色|配色|语气/;

const KIND_RULES: Array<{
  kind: RequiredAgentMemoryUpdateKind;
  pattern: RegExp;
  reason: string;
}> = [
  {
    kind: "openQuestion",
    pattern: /待确认|还需确认|仍需确认|需要确认|未解决|开放问题|尚不确定|还不确定/,
    reason: "用户明确保留了后续需要确认的开放问题。"
  },
  {
    kind: "avoidance",
    // Negative lookahead covers the optional 再 so that 别超过 / 别再超过 can
    // never backtrack into a bare 别 avoidance match.
    pattern: /不要(?!再?(?:超过|低于|少于|高于|多于|大于|小于))|避免|不使用|不做|禁止|别(?!再?(?:超过|低于|少于|高于|多于|大于|小于))/,
    reason: "用户表达了跨本轮生效的明确避免项。"
  },
  {
    kind: "constraint",
    pattern: new RegExp(
      `(?:${CONSTRAINT_NORMATIVE_PATTERN.source})|(?:${CONSTRAINT_SUBJECT_PATTERN.source}).{0,6}(?:${CONSTRAINT_NORMATIVE_PATTERN.source}|记住|记录)|(?:记住|记录).{0,6}(?:${CONSTRAINT_SUBJECT_PATTERN.source})`
    ),
    reason: "用户表达了会约束后续方案的长期项目规则。"
  },
  {
    kind: "preference",
    pattern: new RegExp(
      `(?:${PREFERENCE_STANCE_PATTERN.source})|(?:${PREFERENCE_STANCE_PATTERN.source}).{0,6}(?:${PREFERENCE_ATTRIBUTE_PATTERN.source})|(?:${PREFERENCE_ATTRIBUTE_PATTERN.source}).{0,6}(?:${PREFERENCE_STANCE_PATTERN.source})`
    ),
    reason: "用户表达了需要跨回合保持的稳定偏好。"
  }
];

/**
 * Clause-first admission. Every clause is judged independently: the operation
 * boundary, then the one-off scope guard (which only rejects when no explicit
 * project/long-term scope or quantitative constraint subject overrides it),
 * then the kind classifier. A mixed message like "这次先把背景换白色；预算不能
 * 超过 500 元" keeps its project-constraint clause instead of being dropped as
 * a whole. Ordinary descriptions without any memory cue never create a
 * candidate.
 */
export function resolveRequiredAgentMemoryUpdates(draft: string): RequiredAgentMemoryUpdate[] {
  if (!draft.trim()) {
    return [];
  }
  const candidates: RequiredAgentMemoryUpdate[] = [];
  for (const clause of splitEvidenceClauses(draft)) {
    if (!isAdmissibleMemoryClause(clause.text)) {
      continue;
    }
    const rule = KIND_RULES.find((candidate) => candidate.pattern.test(clause.text));
    if (!rule) {
      continue;
    }
    candidates.push({
      kind: rule.kind,
      reason: rule.reason,
      evidenceQuote: clause.text,
      evidenceStart: clause.start,
      evidenceEnd: clause.end
    });
  }
  return candidates.filter((candidate, index) =>
    candidates.findIndex((other) =>
      other.kind === candidate.kind &&
      other.evidenceStart === candidate.evidenceStart &&
      other.evidenceEnd === candidate.evidenceEnd
    ) === index
  );
}

function isAdmissibleMemoryClause(clause: string): boolean {
  if (
    ONE_OFF_OPERATION_PATTERN.test(clause) &&
    !EXPLICIT_LONG_TERM_SCOPE_PATTERN.test(clause)
  ) {
    return false;
  }
  if (
    ONE_OFF_SCOPE_PATTERN.test(clause) &&
    !PROJECT_SCOPE_MEMORY_OVERRIDE_PATTERN.test(clause) &&
    !PROJECT_CONSTRAINT_SUBJECT_OVERRIDE_PATTERN.test(clause) &&
    !EXPLICIT_LONG_TERM_SCOPE_PATTERN.test(clause)
  ) {
    return false;
  }
  return true;
}

export function buildRequiredAgentMemoryUpdateReminder(
  candidates: readonly RequiredAgentMemoryUpdate[]
): string {
  return [
    "本轮用户消息产生了以下可能跨回合生效的记忆候选（这是 Morpho 的确定性补检提示，不是新的用户指令）：",
    `候选：${candidates.map((candidate) => `${candidate.kind}「${candidate.evidenceQuote}」`).join("；")}`,
    "请在结束本回合前调用 submit_memory_update：",
    "- 每个合法候选使用本轮用户原话作为 evidenceQuote（必须逐字）；",
    "- 每项独立授权，不能因一项无效而丢弃其他合法项；",
    "- 审慎判断不应写入的候选，传 items: [] 并填写非空 skippedReason 说明原因；",
    "- 一次性要求、AI 自己的建议与未确认草案一律不得写入长期记忆。"
  ].join("\n");
}

export function shouldPromptForMemoryUpdate(input: {
  candidates: readonly RequiredAgentMemoryUpdate[];
  reminderInserted: boolean;
  handledCandidateIndexes: ReadonlySet<number>;
}): boolean {
  return input.candidates.some((_candidate, index) => !input.handledCandidateIndexes.has(index)) &&
    !input.reminderInserted;
}

export function validateAgentMemoryUpdateItems(input: {
  candidates: readonly RequiredAgentMemoryUpdate[];
  draft: string;
  items: ReadonlyArray<{ evidenceQuote: string; kind?: RequiredAgentMemoryUpdateKind }>;
}): AgentMemoryUpdateValidation {
  const accepted: AgentMemoryUpdateValidation["accepted"] = [];
  const rejected: AgentMemoryUpdateValidation["rejected"] = [];
  const claimedCandidates = new Set<number>();
  input.items.forEach((item, itemIndex) => {
    if (!item.evidenceQuote || !input.draft.includes(item.evidenceQuote)) {
      rejected.push({ itemIndex, reason: "evidenceQuote 不是当前用户消息中的逐字原文。" });
      return;
    }
    const candidateIndex = input.candidates.findIndex((candidate, index) =>
      !claimedCandidates.has(index) &&
      (item.kind === undefined || item.kind === candidate.kind) &&
      rangesOverlap(
        candidate.evidenceStart,
        candidate.evidenceEnd,
        input.draft.indexOf(item.evidenceQuote),
        input.draft.indexOf(item.evidenceQuote) + item.evidenceQuote.length
      )
    );
    if (candidateIndex < 0) {
      rejected.push({ itemIndex, reason: "该 evidenceQuote 与同 Kind 的待授权候选不对应。" });
      return;
    }
    claimedCandidates.add(candidateIndex);
    accepted.push({ itemIndex, candidateIndex });
  });
  return {
    accepted,
    rejected,
    handledCandidateIndexes: [...claimedCandidates]
  };
}

function splitEvidenceClauses(draft: string): Array<{ text: string; start: number; end: number }> {
  const clauses: Array<{ text: string; start: number; end: number }> = [];
  const pattern = /[^，。；,;!?！？\n]+/g;
  for (const match of draft.matchAll(pattern)) {
    const raw = match[0];
    if (match.index === undefined) {
      continue;
    }
    let segmentStart = 0;
    for (const connector of raw.matchAll(/并且|同时|另外|而且|且/g)) {
      if (connector.index === undefined) {
        continue;
      }
      appendEvidenceClause(clauses, raw.slice(segmentStart, connector.index), match.index + segmentStart);
      segmentStart = connector.index + connector[0].length;
    }
    appendEvidenceClause(clauses, raw.slice(segmentStart), match.index + segmentStart);
  }
  return clauses;
}

function appendEvidenceClause(
  clauses: Array<{ text: string; start: number; end: number }>,
  raw: string,
  rawStart: number
): void {
  const leading = raw.length - raw.trimStart().length;
  const text = raw.trim();
  if (!text) {
    return;
  }
  const start = rawStart + leading;
  clauses.push({ text, start, end: start + text.length });
}

function rangesOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): boolean {
  return firstStart < secondEnd && secondStart < firstEnd;
}
