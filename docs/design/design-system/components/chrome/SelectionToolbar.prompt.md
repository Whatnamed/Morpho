The toolbar that floats above a canvas selection — where object actions actually live.

\`\`\`jsx
<SelectionToolbar style={{ left: '50%', top: 260 }}>
  <ToolbarGroupInline>
    <CanvasIconButton icon={<Icon name="sparkles" size={15} />} label="继续发展图像" />
    <CanvasIconButton icon={<Icon name="pen-line" size={15} />} label="局部修改" />
    <CanvasIconButton icon={<Icon name="git-compare" size={15} />} label="比较" />
  </ToolbarGroupInline>
  <ToolbarDivider />
  <ToolbarGroupInline secondary>
    <CanvasIconButton icon={<Icon name="eye-off" size={15} />} label="隐藏" secondary />
    <CanvasIconButton icon={<Icon name="more-horizontal" size={15} />} label="更多" secondary />
  </ToolbarGroupInline>
</SelectionToolbar>
\`\`\`

Tooltips open **below** the toolbar, never to the side. Stage regions get the same shell with colour, border, opacity and lock controls — pass \`stage\`.
