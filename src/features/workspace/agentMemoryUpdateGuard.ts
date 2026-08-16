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

const ONE_OFF_MARKERS = [
  "这次先",
  "本轮先",
  "这一张图",
  "这张图先",
  "当前这版",
  "只改这个位置",
  "临时试一下",
  "先试一下",
  "先生成一张",
  "先生成两张",
  "这条回复短一点",
  "其他方向暂时不用改"
];

const LONG_TERM_SCOPE_MARKERS = [
  "以后",
  "后续",
  "后面",
  "整个项目",
  "接下来",
  "始终",
  "统一",
  "长期",
  "稳定",
  "记住",
  "记录",
  "偏好"
];

const ONE_OFF_OPERATION_PATTERN =
  /(?:不要|无需|不必|只|仅).{0,12}(?:调用|修改|改动|写入|记录|保存|创建|删除|更新|执行).{0,12}(?:工具|项目|对象|状态|画布|记忆|偏好|避免项|约束|开放问题|草稿)/;
const EXPLICIT_LONG_TERM_OPERATION_SCOPE_PATTERN =
  /以后|后续|后面|整个项目|接下来|始终|统一|长期(?:保持|遵守|采用|执行|使用)/;

/**
 * Clauses that only address this turn's concrete image, object, version,
 * background, or scope (without an explicit long-term scope marker) are
 * one-off instructions and must never become long-term project memory. This
 * closes phrasings like "这张图不要高反光", "这版背景换白色", or "这次不要用蓝色"
 * that the message-level ONE_OFF_MARKERS do not cover.
 */
const ONE_OFF_TURN_REFERENCE_PATTERN =
  /(?:这张图|这张|这次的图|这轮的图|这轮|这版|当前这版|这个角度|这张参考图|刚才那张|刚才这个|新生成的图|生成的图|这次背景|这种背景|这个背景|这一张|这幅|这个渲染|这次|本轮)/;

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
    pattern: /不要|避免|不使用|不做|禁止|别(?:再)?/,
    reason: "用户表达了跨本轮生效的明确避免项。"
  },
  {
    kind: "constraint",
    pattern: /必须|不得|不能|不超过|不低于|至少|至多|小于|大于|限制|约束|尺寸|高度|宽度|重量/,
    reason: "用户表达了会约束后续方案的长期项目规则。"
  },
  {
    kind: "preference",
    pattern: /保持|偏好|喜欢|默认|统一|低饱和|高饱和|风格|材质|颜色|语气/,
    reason: "用户表达了需要跨回合保持的稳定偏好。"
  }
];

export function resolveRequiredAgentMemoryUpdates(draft: string): RequiredAgentMemoryUpdate[] {
  if (!draft.trim()) {
    return [];
  }
  const hasOneOffMarker = ONE_OFF_MARKERS.some((marker) => draft.includes(marker));
  const hasLongTermScopeMarker = LONG_TERM_SCOPE_MARKERS.some((marker) => draft.includes(marker));
  if (hasOneOffMarker && !hasLongTermScopeMarker) {
    return [];
  }
  if (!hasLongTermScopeMarker && !/(?:必须|不得|不要|避免|待确认|还需确认|记住|记录)/.test(draft)) {
    return [];
  }

  const candidates: RequiredAgentMemoryUpdate[] = [];
  for (const clause of splitEvidenceClauses(draft)) {
    if (
      ONE_OFF_OPERATION_PATTERN.test(clause.text) &&
      !EXPLICIT_LONG_TERM_OPERATION_SCOPE_PATTERN.test(clause.text)
    ) {
      continue;
    }
    if (
      ONE_OFF_TURN_REFERENCE_PATTERN.test(clause.text) &&
      !EXPLICIT_LONG_TERM_OPERATION_SCOPE_PATTERN.test(clause.text) &&
      !LONG_TERM_SCOPE_MARKERS.some((marker) => clause.text.includes(marker))
    ) {
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

export function buildRequiredAgentMemoryUpdateReminder(
  candidates: readonly RequiredAgentMemoryUpdate[]
): string {
  return [
    "本轮用户消息包含多个可能跨回合生效的记忆候选。",
    `候选：${candidates.map((candidate) => `${candidate.kind}「${candidate.evidenceQuote}」`).join("；")}`,
    "请调用 submit_memory_update，并逐项使用本轮原文 evidenceQuote。每项独立授权；不能因一项无效而丢弃其他合法项。",
    "审慎判断不应写入的候选可通过 items: [] 与 skippedReason 跳过；不要把一次性要求写入长期记忆。"
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
