The bottom detail surface — the tabbed popover that replaced the old detail bar.

\`\`\`jsx
<DetailPopover visible type="图片" title="柔光轨道 v2" tabs={['信息', '来源', '版本', '关联']} activeTab={tab} onTab={setTab}
  actions={<DetailInlineAction icon={<Icon name="book-open" size={14} />}>在阅读器中打开</DetailInlineAction>}>
  <DetailRow label="父版本" thumbnail="图" meta="视觉迭代 1" onClick={locate}>柔光轨道 v1</DetailRow>
  <DetailRow label="子版本" thumbnail="图" meta="待复核" onClick={locate}>柔光轨道 v3 · 转角一体</DetailRow>
</DetailPopover>
\`\`\`

Only show tabs that actually have content — a plain image starts with 信息 alone. One layer of direct relationships, never the whole graph. Max height is 34vh: it must never grow into an inspector.
