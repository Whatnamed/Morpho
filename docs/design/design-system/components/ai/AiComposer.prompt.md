The composer at the foot of the AI panel: context strip, mode disclosure, optional image settings, input and send.

\`\`\`jsx
<AiComposer value={draft} onChange={setDraft} onSend={send} busy={busy} onStop={stop}
  contextCount={2} contextTitles={['柔光轨道 v2', '转角连接件']}
  modeSummary="自动执行" turnMode={turnMode} onTurnModeChange={setTurnMode}
  imageSettings={<ImageSettings fields={[{ label: '比例', value: '3:2', options: ['1:1','3:2','2:3'] }]} notes={['费用以服务商控制台为准']} />} />
\`\`\`

The send button turns into a stop square while a task runs. Image settings appear only for an image task and stay in human terms — never a model ID, provider name, price or token count.
