The collapsible trace of what the agent is doing, inline in the conversation.

\`\`\`jsx
<AgentProcess title="正在阅读参考图" streaming open={open} onToggle={toggle}>
  <AgentActivity kind="fileRead" label="读取 课程要求.pdf" detail="已提取文字" />
  <AgentActivity kind="webSearch" label="补充联网来源" state="running" />
  <AgentNote>三张参考都指向同一个问题：转角处缺少可扶的连续面。</AgentNote>
</AgentProcess>
\`\`\`

It opens itself while streaming and closes shortly after. Business steps only — no chain-of-thought, no token counts, no prompts, no model names. There is no separate task centre; this and \`AiQueue\` are the only status surfaces.
