export type RequiredAgentMemoryUpdateKind = "preference" | "avoidance" | "constraint" | "openQuestion";

export type RequiredAgentMemoryUpdate = {
  kind: RequiredAgentMemoryUpdateKind;
  reason: string;
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

export function resolveRequiredAgentMemoryUpdate(draft: string): RequiredAgentMemoryUpdate | undefined {
  const normalized = draft.replace(/\s+/g, " ").trim();
  const hasOneOffMarker = ONE_OFF_MARKERS.some((marker) => normalized.includes(marker));
  const hasLongTermScopeMarker = LONG_TERM_SCOPE_MARKERS.some((marker) => normalized.includes(marker));
  if (!normalized || (hasOneOffMarker && !hasLongTermScopeMarker)) {
    return undefined;
  }

  if (/(?:记住|记录|保留).{0,24}(?:待确认|开放问题|未解决|还需确认)/.test(normalized)) {
    return { kind: "openQuestion", reason: "用户明确要求把待确认问题保留为项目记忆。" };
  }

  if (/(?:以后|后续|后面|整个项目|接下来|始终|统一|长期|稳定).{0,30}(?:不要|别|避免|不使用|不做)/.test(normalized)) {
    return { kind: "avoidance", reason: "用户表达了跨本轮的明确避免项。" };
  }

  if (/(?:以后|后续|后面|整个项目|接下来|始终|统一|长期|稳定|记住|偏好|喜欢).{0,36}(?:保持|偏好|喜欢|默认|要求|原则|约束|限制|必须|需要)/.test(normalized)) {
    return { kind: "preference", reason: "用户表达了需要跨回合保持的稳定偏好。" };
  }

  if (/(?:以后|后续|后面|整个项目|接下来|始终|统一|长期|稳定|记住|默认).{0,36}(?:比例|尺寸|结构|颜色|材质|风格|规则|要求|约束|必须|需要)/.test(normalized)) {
    return { kind: "constraint", reason: "用户表达了会约束后续方案的长期项目规则。" };
  }

  return undefined;
}

export function buildRequiredAgentMemoryUpdateReminder(candidate: RequiredAgentMemoryUpdate): string {
  return [
    "本轮用户消息包含可能跨回合生效的项目偏好、避免项、约束或开放问题。",
    `判断依据：${candidate.reason}`,
    "请先调用 submit_memory_update。evidenceQuote 必须逐字来自本轮用户消息，不能根据推测写入。",
    "如果审慎判断没有可合法写入的记忆项，也必须调用 submit_memory_update，传 items: [] 与 skippedReason 说明跳过原因；不要重复询问用户。"
  ].join("\n");
}

export function shouldPromptForMemoryUpdate(input: {
  candidate: RequiredAgentMemoryUpdate | undefined;
  reminderInserted: boolean;
  handled: boolean;
}): boolean {
  return Boolean(input.candidate && !input.reminderInserted && !input.handled);
}

export function shouldApplyAgentMemoryUpdate(input: {
  candidate: RequiredAgentMemoryUpdate | undefined;
  draft: string;
  items: ReadonlyArray<{ evidenceQuote: string }>;
}): boolean {
  if (!input.candidate || input.items.length === 0) {
    return false;
  }

  return input.items.every(
    (item) => item.evidenceQuote.length > 0 && input.draft.includes(item.evidenceQuote)
  );
}
