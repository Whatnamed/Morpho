Conversation turns. The assistant speaks as plain text on the panel surface; only the user gets a bubble.

\`\`\`jsx
<Message role="user">比较这三张预览在连续支撑上的差异。</Message>
<Message>
  <MessageParagraph>三张预览在连续支撑上的差别主要在转角处理。</MessageParagraph>
  <CitationList items={[{ title: '柔光轨道 v2', origin: '本地资料 · 图片' }, { title: '夜间起身安全建议', origin: 'ncoa.org' }]} onOpen={locate} />
</Message>
<ThinkingRow />
\`\`\`

Never give the assistant a card or an avatar — the calm, unboxed text is the point. Every citation must stay clickable back to its source.
