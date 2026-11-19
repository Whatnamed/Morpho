# 审查基线与定点核实

2026-11-19 · D:/Morpho · HEAD d55062e7fcdc5dfe0f12b08e43523bee7223dac6

## 输入和状态

| 输入 | 确认结果 |
|---|---|
| main、本地 origin/main | d55062e7fcdc5dfe0f12b08e43523bee7223dac6 |
| docs/product/next-generation-direction.md | 起始即未跟踪。SHA-256 360104E55EC8298DBAC67993473AC493B49BECE147A3ED37428C946FA563C943 |
| temp/prompts/morpho-next-generation-readiness-review.md | SHA-256 20123DDFD72E0144A61A9A5F7A503018926992DF04D074250A6D56CF303FEF66 |
| Worktree | D:/Morpho，main。审查产物由现有 .gitignore 的 temp 规则排除 |
| 本机检查运行时 | Node v22.23.5、Vitest 4.1.9、PowerShell 7。仓库 CI 使用 Node 24 |

## 定点运行

### 项目目录部分失败

[spot-check.mjs.txt](spot-check.mjs.txt) 使用现有 Vite、本仓 createMemoryStorage、createBlankWorkspace、persistProjectWorkspaceAndSummary、initializeBrowserProjectCatalog 和 loadProjectWorkspace。先保存 A，再只对 B 的 CATALOG_STORAGE_KEY 写入抛错。解除故障后，走无浏览器窗口的同一目录初始化逻辑，按 ID 读取 B。断言并输出以下结果。

```json
{"check":"catalog restart after a partial project write","failureStage":"catalog","projectIds":["review-project-a"],"directLoad":"ok"}
```

该检查确认目录策略的故障后行为。Web Locks、路由和 React UI 的行为由源码及现有 E2E 对照，未在真实浏览器重复。现有 e2e/project-management.spec.ts:157 覆盖留在首页同 ID 重试的不同情形。

```powershell
$review = 'temp/reviews/next-generation-readiness/codex'
Get-Content -Raw -LiteralPath "$review/spot-check.mjs.txt" | node --input-type=module --experimental-strip-types --permission '--allow-fs-read=*' --allow-addons
```

### Agent Lab 固定响应

两次都使用 scripts/agent-lab/selected-source.json，fixture Workspace 初始 SHA-256 均为 54fb65c0329ceb36666b66ece78adc4d069a11b621eb91ef4de0df9433aa0010。使用现有 scripted handlers 和固定响应。测试入口只写本目录。

| Profile | 实际首发的工具 | 到达的 Method Pack | 请求、工具与结果 |
|---|---|---|---|
| baseline | read_selected_context、read_workspace_source | 无 | 2 次合成 Responses 请求，1 个工具调用及其结果，第二次带同一 function_call 和 function_call_output，success。[原始记录](lab/scripted-5z8T72/run.json) |
| one-source | read_workspace_source | researchSynthesis | 2 次合成 Responses 请求，1 个工具调用及其结果，第二次带同一 function_call 和 function_call_output，success。[原始记录](lab/scripted-XfLHrg/run.json) |

记录通过 steps[].events[].value.event.type == "lab-provider-request" 定位实际序列化 body 与 methodPackIds。两组工具结果来自真实本地执行器，assistant 文本、usage 和 Provider 响应来自 fixture。脚本之间的 workspace.after.json 是各自的产物。live mode、生产存储、真实模型和图片质量不在本次验证覆盖内。

```powershell
$review = 'temp/reviews/next-generation-readiness/codex'
$allowed = (Resolve-Path -LiteralPath $review).Path
$env:MORPHO_AGENT_LAB_RUN = @{
  mode = 'scripted'
  profile = 'scripts/agent-lab/variant.json'
  task = 'scripts/agent-lab/selected-source.json'
  outputRoot = "$review/lab"
} | ConvertTo-Json -Compress
$config = Join-Path $review ("lab-rerun-" + [guid]::NewGuid().ToString("N") + ".config.mjs")
Copy-Item -LiteralPath "$review/lab-readonly.config.mjs.txt" -Destination $config
try {
  node --experimental-strip-types --permission '--allow-fs-read=*' "--allow-fs-write=$allowed" --allow-worker --allow-addons node_modules/vitest/vitest.mjs run --config $config --configLoader native --no-cache --pool threads
} finally {
  Remove-Item -LiteralPath $config
}
```

### 现有离线测试

通过 **15 个现有测试文件、344 项**。另有 Lab scripted 两组各 1 项通过，如上。第一批 5 个文件、107 项。第二批 10 个文件、237 项。两批已核查测试范围，无真实 Provider 调用。第二批初次并行退出且未形成完整结果，最终使用单 worker 得到全部通过。runner config loader 在该环境无法装载 picomatch，改用 Node 原生 loader；此为本次取证命令差异。

| 批次 | 测试文件名 | 核实重点 |
|---|---|---|
| 107 | agentRuntimeArchitecture、legacyWorkspaceCompatibility、localProjectStore、turnTaskResolver、workspaceSnapshotHistory | B 路由移除、防止旧对象证据错用、历史/当前输入处理、已有目录故障合同、混合任务范围、待退役快照的测试依赖 |
| 97 | agentTurnRunner | 准入、工具续传、Recovery、确认、失败、取消、旧请求安全续跑 |
| 23 | providerContextFrames、useWorkspaceAgentRuntimeController | Frame 时序、会话宿主与 UI 对接 |
| 29 | agentTurnProviderRequest、agentToolExecutors | 可信组装、工具范围和本地消费者 |
| 18 | externalResultStore | 结果持久化、同一结果绑定和重新取得 |
| 56 | projectLifecycle、projectBundles、workspaceUndo | 项目写入与恢复、包合同、操作 Undo |
| 14 | documentParsing | 文档可读性、边界与错误语义 |

离线 Vitest 直接执行，关闭 cache 并使用 Node 权限限制写文件。按表选择对应的源文件，测试名以 .test.ts 结尾。

```powershell
node --experimental-strip-types --permission '--allow-fs-read=*' --allow-worker --allow-addons node_modules/vitest/vitest.mjs run --configLoader native --no-cache --pool threads --maxWorkers 1 src/features/workspace/agentTurnRunner.test.ts
```

## 调用与历史核对

- 使用 git grep 跨 src、e2e、scripts 对照 /api/ai/chat、workspaceSnapshotHistory、resolveAgentToolAuthority、createTestWorkspace、fallbackBaseUrls。通过 Next 文件路由、动态渲染调用、脚本入口和测试中负向匹配区分消费者。外部 HTTP 流量不从仓内搜索推定。
- 以 a191c97、0fb7326 的实际变更及 [PR #2](https://github.com/Whatnamed/Morpho/pull/2) 对照 B 清理。P3/P6/P7 依照 fb8b92b、c86f1dc、e51bba1、573a83b、8e10903 等提交的源码或脚本和历史说明。近期用 ff2fe30、04ef4b8、d55062e 查看实际改动。
- SHA-256 核对 .agents/skills 下 95 个跟踪文件和 .claude/skills 下同名文件，95 对相同。核对生产 src/design-system/tokens 下 6 个 CSS 文件和 docs 对应副本，6 对相同。
- 读取已提交的 CI、Next、OpenNext、Wrangler、Vitest、Playwright、构建/证据与 SQL 配置入口，使用调用链判断现役职责。自动化重点落在会影响架构决策的合同。仓库中的大型历史资料、视觉导出、冻结实验产物和 demo 资产抽查了使用方，未逐个执行。
