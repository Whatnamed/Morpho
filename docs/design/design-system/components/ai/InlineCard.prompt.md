The cards that can appear inside the conversation: confirmations, failures, context notes, and a reviewable proposal.

\`\`\`jsx
<InlineCard tone="failure" title="修改未完成" meta="原图与修改要求已保留。"
  actions={<><Button>重试</Button><Button>修改后重试</Button><Button>取消并保留原图</Button></>}>
  这次修改没有完成。
</InlineCard>

<ProposalCard title="夜间起身路径与扶持需求的前期调研"
  help="保存后会在画布上创建一个研究与分析对象，来源保持可回看。"
  sections={[{ label: '主要发现', items: ['起身、转身、开门三处最容易失稳。'] }]}
  citations={['本地资料 · 课程要求.pdf', 'ncoa.org']}
  actions={<><Button variant="brand">保存</Button><Button>继续追问</Button></>} />
\`\`\`

Failures always say what was kept — never a full-screen error page and never a global error centre. A proposal appearing is not a write: only the user's confirmation creates a canvas object.
