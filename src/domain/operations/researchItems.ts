export type ResearchItemInput =
  | string
  | {
      title?: unknown;
      detail?: unknown;
      summary?: unknown;
      body?: unknown;
      text?: unknown;
    };

export type ResearchItemParts = {
  title: string;
  detail?: string;
};

export function normalizeResearchItems(items: ResearchItemInput[]): string[] {
  const normalized = items
    .map(normalizeResearchItem)
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(normalized));
}

export function normalizeResearchItem(input: ResearchItemInput): string | undefined {
  const text = researchItemInputToText(input);
  let item = text.replace(/\s+/g, " ").trim();
  if (!item) {
    return undefined;
  }

  item = item
    .replace(/^[\-•·\d.)、\s]+/, "")
    .replace(
      /^(最稳固的设计判断|最关键的设计判断|设计判断|判断|设计机会|机会点|现实约束|约束|待验证问题|待验证|明显缺口|参考图提示|本地研究|现有资料)[一二三四五六七八九十\d]*[：:\-\s]+/,
      ""
    )
    .trim();

  const colonIndex = item.search(/[：:]/);
  if (colonIndex > 0 && colonIndex <= 48) {
    const prefix = item.slice(0, colonIndex);
    if (isMetaLead(prefix)) {
      item = item.slice(colonIndex + 1).trim();
    }
  }

  item = item
    .replace(/^(可以认为|可以归纳为|需要注意的是|这意味着|因此|所以)[：:，,\s]+/, "")
    .replace(/^(你的|当前|本次)(研究|资料|项目|方案)[^：:]{0,20}[：:]/, "")
    .trim();

  return item || undefined;
}

export function getResearchItemParts(input: string): ResearchItemParts {
  const item = normalizeResearchItem(input) ?? input.trim();
  const colonIndex = item.search(/[：:]/);
  if (colonIndex > 0 && colonIndex <= 32) {
    const title = item.slice(0, colonIndex).trim();
    const detail = item.slice(colonIndex + 1).trim();
    if (title && detail) {
      return { title, detail };
    }
  }

  return { title: item };
}

function researchItemInputToText(input: ResearchItemInput): string {
  if (typeof input === "string") {
    return input;
  }

  if (!input || typeof input !== "object") {
    return "";
  }

  const title = stringValue(input.title);
  const detail = stringValue(input.detail) || stringValue(input.summary) || stringValue(input.body) || stringValue(input.text);

  if (title && detail) {
    return `${title}：${detail}`;
  }

  return title || detail;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isMetaLead(prefix: string): boolean {
  const compact = prefix.replace(/\s+/g, "");
  return (
    /^(本地研究|现有资料|明显缺口|参考图|课程要求|设计判断|最稳固|最关键|核心判断|系统叙事|项目定位)$/.test(compact) ||
    /^(第[一二三四五六七八九十\d]+条|判断[一二三四五六七八九十\d]+|机会[一二三四五六七八九十\d]+)$/.test(compact) ||
    /^(本地研究|现有资料|当前资料|已有资料).*(提供|说明|显示|形成|支撑|指向|给出)/.test(compact) ||
    /(系统叙事框架|设计判断|核心判断|明显缺口|参考图提示)$/.test(compact)
  );
}
