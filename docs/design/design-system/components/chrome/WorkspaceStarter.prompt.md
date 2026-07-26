The blank-project starter card, floating over an empty canvas without blocking it.

\`\`\`jsx
<WorkspaceStarter title="从一句想法、一张图、一个文件开始"
  body="在这里输入、粘贴或拖入资料。"
  actions={<><Button variant="brand" icon={<Icon name="message-circle" size={15} />}>开始聊天</Button><Button icon={<Icon name="upload" size={15} />}>导入资料</Button></>}
  hint="也可以直接把图片粘贴到画布上。" />
\`\`\`

No form, no project category, no creation wizard. \`pointer-events\` stays off except on the buttons, so the canvas underneath is still usable.
