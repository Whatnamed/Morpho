export type WebSearchAuthorityInput = Readonly<{
  draft: string;
  taskMode: "chatAnalysis" | "imageGeneration" | "researchOperation";
}>;

const EXPLICIT_WEB_SEARCH_PATTERN =
  /必须联网|请联网|联网|上网|搜索(?:网页|网络|外部|资料)?|查证|查一下|核实|验证(?:来源|事实|最新|当前)|外部来源|补充来源|最新(?:资料|信息|案例)|\b(?:web search|search(?: the web| online| for)?|verify online|latest source)\b/i;

/**
 * Network authority comes only from the current user draft or the trusted UI
 * task mode. Imported source text and provider output must never be passed here.
 */
export function hasCurrentTurnWebSearchAuthority(input: WebSearchAuthorityInput): boolean {
  if (input.taskMode === "imageGeneration") return false;
  return input.taskMode === "researchOperation" || EXPLICIT_WEB_SEARCH_PATTERN.test(input.draft);
}
