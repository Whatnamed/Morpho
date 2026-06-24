export function shouldUseGrsImageTask(draft: string, selectedObjectTypes: readonly string[]): boolean {
  const text = draft.toLowerCase();
  const hasVisualNoun = /图|图像|图片|视觉|场景|cmf|细节|角度|预览|效果图|渲染|造型|材质/.test(text);
  const hasGenerativeVerb = /生成|出图|继续发展|发展|延展|衍生|变体|修改|局部修改/.test(text);
  const hasExplicitVisualAction = /继续发展|局部修改|使用场景|多参考|变体|角度|场景|cmf|细节|新视觉|出图|图像任务|预览图|效果图/.test(
    text
  );
  const hasGenerativeIntent = hasExplicitVisualAction || (hasGenerativeVerb && hasVisualNoun);

  if (!hasGenerativeIntent) {
    return false;
  }

  if (selectedObjectTypes.length === 0) {
    return true;
  }

  return selectedObjectTypes.some((type) =>
    ["image", "conceptDirection", "designDefinition", "text", "research", "insight", "link", "file"].includes(type)
  );
}
