The 426px conversation surface anchored to the lower right — every AI interaction happens here.

\`\`\`jsx
<AiPanel open={open} onToggle={() => setOpen(false)} footer={<AiComposer … />}>
  <Message role="assistant">…</Message>
</AiPanel>
<AiQueue label="生成中" busy open={queueOpen} onToggle={toggleQueue}><strong>图像生成</strong><Button>停止</Button></AiQueue>
<AiToggle open={open} onClick={() => setOpen(!open)} />
\`\`\`

There is **no title bar and no task-mode switcher** — just a handle and a collapse control; intent comes from the selection and the message. The scroll area is masked at the bottom so text dissolves into the panel instead of hitting a hard edge. Clicking empty canvas must not close it.
