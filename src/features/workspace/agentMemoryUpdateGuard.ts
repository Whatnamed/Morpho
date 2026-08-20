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
 * Agent/tool 操作指令 gate。识别"本轮 Agent 该怎么执行"的行为指令：操作指示词
 * （不要/别/无需/只/仅/先/就/直接/再…）紧跟动作动词（比较/对比/联网/搜索/保存/
 * 存档/写入/创建/生成/总结/分析/修改/删除/更新/执行/记录…）。这类 clause 是当前
 * 任务的操作边界，不是跨回合项目声明——"不要保存记录""不要比较""不要联网"
 * "不要创建研究分析""必须先联网查一下""先生成两张"都不得成为记忆候选。
 * 动词集刻意排除 使用/采用/用/保持/沿用（偏好立场词）、记住（记忆意图词）与
 * 超过/低于/小于 等数量关系词，指示词集排除 必须/不能/不得（规范性约束标记），
 * 因此"不使用镜面金属""不要高反光""尺寸必须小于 200mm""记住这个尺寸"不受影响。
 */
const OPERATIONAL_DIRECTIVE_PATTERN =
  /不要|别|无需|无须|不必|不用|不需要|禁止|不做|不再|只|仅|先|就|直接|再/;

const OPERATIONAL_ACTION_VERB_PATTERN =
  /比较|对比|联网|搜索|检索|查询|查找|保存|存档|写入|创建|新建|生成|绘制|渲染|总结|分析|修改|调整|删除|更新|执行|导出|上传|下载|输出|发送|记录/;

const OPERATIONAL_INSTRUCTION_PATTERN = new RegExp(
  `(?:${OPERATIONAL_DIRECTIVE_PATTERN.source}).{0,8}(?:${OPERATIONAL_ACTION_VERB_PATTERN.source})`
);

/**
 * 显式 long-term/project scope 可以越过操作指令 gate（"以后这个项目都不要联网"、
 * "整个项目不要自动保存比较记录"是跨回合行为偏好）。刻意不含 记录——否则
 * "不要保存记录"里的宾语"记录"会被误当成记忆意图。范围词只在与操作相邻且
 * 位于操作之前时有效，因此"不要保存项目"里的"项目"是操作宾语，不是范围。
 */
const OPERATIONAL_SCOPE_PREFIX_PATTERN =
  /以后|后续|从现在起|始终|接下来|后面|整个项目|希望以后|长期(?:保持|遵守|采用|执行|使用|不变|稳定|沿用)|记住|课设|课题|项目|整机|全案|产品线|整个产品|总体|全局|本项目|本课题/;

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
 * 约束主语：只有与显式记忆意图 记住/记录 相邻出现时才能构成 constraint
 * （规范性语法本身已经由 CONSTRAINT_NORMATIVE_PATTERN 覆盖）。
 * "记住这个尺寸" 是记录约束的请求；"这个尺寸合适吗？" 不是。
 */
const CONSTRAINT_SUBJECT_PATTERN = /尺寸|高度|宽度|重量|约束|限制/;

/**
 * 偏好声明立场：真正表达"跨回合保持"的主观立场。单独的 scope 词（以后/后续/
 * 始终/长期）不是立场——"以后这个方向怎么发展？" 是疑问，"长期采用低饱和" 才是
 * 声明。裸设计属性（材质/颜色/风格）也不是偏好。
 */
const PREFERENCE_STRONG_STANCE_PATTERN =
  /我喜欢|我偏好|我更喜欢|默认(?:用|采用|保持)|希望(?:保持|一直|以后|始终|用|采用|延续|沿用|维持)|统一采用|统一沿用|(?:以后|后续|从现在起).{0,6}(?:都|用|保持|统一|采用|沿用)|(?:始终|长期).{0,6}(?:用|保持|采用|使用|沿用)/;

const PREFERENCE_ATTRIBUTE_PATTERN = /低饱和|高饱和|风格|材质|颜色|配色|语气/;

/**
 * 临时/试探性 scope：明确限定"这一轮先这样"的指令，不能成为稳定避免项或长期
 * 规则。与 ONE_OFF_SCOPE_PATTERN 语义一致（该列表覆盖"这次/本轮/临时/先试"，
 * 这里补充"先别/先不要/暂时/暂且"等 avoidance 场景的临时标记）。
 */
const TEMPORARY_SCOPE_PATTERN =
  /先别|先不要|暂时|暂且|临时|这轮先|本轮先|这次先|先试|先不|先看看/;

/**
 * 疑问句：询问已有状态或意见，不是声明。openQuestion 有自己的例外处理
 * （"是否支持单手操作还需确认" 是声明，不由本模式拦截）。
 */
const INTERROGATIVE_QUERY_PATTERN =
  /是不是|是否|哪些|什么|哪个|哪张|多少|怎么|如何|吗|呢|行不行|好不好|能不能|要不要|可不可以|怎么样|咋样|为什么/;

/**
 * openQuestion 的查询形式：询问"还有哪些未决问题"，不是声明未决问题。
 * "是否(?:还|仍)?(?:需|需要|待)确认" 精确匹配"是否还需确认？"这类查询，
 * 但不会误伤"是否支持单手操作还需确认"（声明）。
 */
const OPEN_QUESTION_QUERY_PATTERN =
  /哪些|什么|吗|呢|多少|怎么|如何|哪个|要不要|需不需要|是否(?:还|仍)?(?:需|需要|待)确认/;

const MEMORY_KIND_REASONS: Record<RequiredAgentMemoryUpdateKind, string> = {
  openQuestion: "用户明确陈述了后续需要确认的开放问题。",
  avoidance: "用户明确陈述了跨本轮生效的稳定避免项。",
  constraint: "用户明确陈述了会约束后续方案的长期项目规则。",
  preference: "用户明确陈述了需要跨回合保持的稳定偏好。"
};

/**
 * Declaration-based kind classification。判断的是"用户在明确陈述一条以后应该
 * 继续成立的信息"，而不是"这句话里出现了什么词"：
 * - openQuestion：unresolved subject + declarative unresolved tail（X 还需确认 /
 *   X 尚不确定 / X 仍未解决），查询已有未决问题的疑问句被拒绝；
 * - avoidance：稳定禁止（不要/避免/禁止/不使用），临时（先别/暂时/暂且）与
 *   疑问（哪些颜色不要用？）被拒绝；
 * - constraint：规范性规则陈述（必须/不得/不能/不超过/上限/控制在…），阈值
 *   疑问句（高度低于多少合适？）被拒绝；
 * - preference：明确偏好立场（我喜欢/默认用/希望保持/以后都用…），scope 词
 *   单独出现、疑问句、结构化状态命令（默认参考改成这张）被拒绝。
 */
function classifyMemoryDeclaration(clause: string):
  | RequiredAgentMemoryUpdateKind
  | undefined {
  if (isExplicitOpenQuestionDeclaration(clause)) return "openQuestion";
  if (isExplicitStableAvoidanceDeclaration(clause)) return "avoidance";
  if (isExplicitConstraintDeclaration(clause)) return "constraint";
  if (isExplicitPreferenceDeclaration(clause)) return "preference";
  return undefined;
}

function isExplicitOpenQuestionDeclaration(clause: string): boolean {
  if (OPEN_QUESTION_QUERY_PATTERN.test(clause)) return false;
  return /(?:还需|仍需|仍待|尚待|还待|需要|待)确认|尚不确定|仍未解决|仍未定|待验证|仍需验证|还需验证/.test(clause);
}

function isExplicitStableAvoidanceDeclaration(clause: string): boolean {
  if (INTERROGATIVE_QUERY_PATTERN.test(clause)) return false;
  if (TEMPORARY_SCOPE_PATTERN.test(clause)) return false;
  // Negative lookahead covers the optional 再 so that 别超过 / 别再超过 can
  // never backtrack into a bare 别 avoidance match.
  return /不要(?!再?(?:超过|低于|少于|高于|多于|大于|小于))|避免|不使用|不做|禁止|别(?!再?(?:超过|低于|少于|高于|多于|大于|小于))/.test(clause);
}

function isExplicitConstraintDeclaration(clause: string): boolean {
  if (INTERROGATIVE_QUERY_PATTERN.test(clause)) return false;
  if (TEMPORARY_SCOPE_PATTERN.test(clause)) return false;
  if (CONSTRAINT_NORMATIVE_PATTERN.test(clause)) return true;
  return CONSTRAINT_SUBJECT_PATTERN.test(clause) && /记住|记录/.test(clause);
}

function isExplicitPreferenceDeclaration(clause: string): boolean {
  if (INTERROGATIVE_QUERY_PATTERN.test(clause)) return false;
  if (TEMPORARY_SCOPE_PATTERN.test(clause)) return false;
  if (PREFERENCE_STRONG_STANCE_PATTERN.test(clause)) return true;
  return PREFERENCE_ATTRIBUTE_PATTERN.test(clause) &&
    /喜欢|偏好|默认|希望|统一|沿用|采用|保持/.test(clause);
}

/**
 * Clause-first admission. Every clause is judged independently: the operation
 * boundary, then the agent/tool operational-instruction gate (current-turn
 * commands like 不要保存记录/不要联网/先生成两张 are not project declarations
 * unless an explicit long-term/project scope precedes them), then the one-off
 * scope guard (which only rejects when no explicit project/long-term scope or
 * quantitative constraint subject overrides it), then the declaration
 * classifier. A mixed message like "这次先把背景换白色；预算不能超过 500 元"
 * keeps its project-constraint clause instead of being dropped as a whole.
 * Questions, temporary instructions, structured-state commands and ordinary
 * design discussion never create a candidate.
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
    const kind = classifyMemoryDeclaration(clause.text);
    if (!kind) {
      continue;
    }
    candidates.push({
      kind,
      reason: MEMORY_KIND_REASONS[kind],
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
  if (isCurrentTurnOperationalInstruction(clause)) {
    return false;
  }
  return true;
}

/**
 * 操作指令裁决：gate 命中且操作之前没有显式 long-term/project scope 时，
 * 判定为当前任务操作指令（拒绝记忆）。范围词必须位于操作之前才有效。
 */
function isCurrentTurnOperationalInstruction(clause: string): boolean {
  const match = OPERATIONAL_INSTRUCTION_PATTERN.exec(clause);
  if (!match || match.index === undefined) {
    return false;
  }
  const prefix = clause.slice(0, match.index);
  return !OPERATIONAL_SCOPE_PREFIX_PATTERN.test(prefix);
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
