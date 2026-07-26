The segmented control in the composer's mode disclosure — the only segmented control in the product.

\`\`\`jsx
<ModeToggle value={turnMode} onChange={setTurnMode}
  options={[{ value: 'auto', label: '自动执行' }, { value: 'confirm', label: '先确认' }]} />
\`\`\`

The active segment is a white chip on the muted track. Do not use it for task modes — Morpho no longer has a task-mode switcher; intent is inferred from the selection and the message.
