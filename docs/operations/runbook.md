# Web 工作台运行手册

## 启动与环境

CI 使用 Node.js 24。运行 `npm ci` 安装锁文件中的版本。复制 [.env.example](../../.env.example) 为 `.env.local`，运行 `npm run dev`，打开 [localhost:3000](http://localhost:3000)。

| 需要的能力 | 配置 |
| --- | --- |
| 本地画布、项目、备份 | `MORPHO_AUTH_REQUIRED=false` 可体验本地界面。正式托管环境使用 `true`。浏览器项目保存在当前 origin，同一账号换浏览器需要通过可编辑备份转移。 |
| 登录与托管 AI | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 配置 Supabase Auth。AI 需要登录用户、相应数据库迁移和可用额度。Provider 结算使用仅服务端可读的 `SUPABASE_SECRET_KEY`。 |
| 文本与联网 | 使用示例中的 `MORPHO_AI_*`。缓存提示按上游支持情况开启。 |
| 图像生成 | 使用 `MORPHO_GRS_*`。下载来源由允许的 HTTPS 主机约束。保留已执行任务的原 Provider 命名空间与任务 ID。 |
| tldraw | `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` 在构建时提供；按实际域名配置。 |

## 检查

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Chromium 使用构建产物，在独立端口启动 Next、关闭页面登录并模拟付费请求。已有构建时可指定场景，例如 `npm run test:e2e -- e2e/project-management.spec.ts`。首次构建需要可用的 Geist 字体缓存或访问 Google Fonts。新增或删除 Next 路由后，已有工作树可用 `npx next typegen` 刷新生成的路由类型。

## Agent Lab

从仓库根目录运行。本地默认执行随仓库提供的固定响应，复用 A+ Runner、工具权限与执行器、服务端请求组装及 Responses SSE 解析。预览和固定响应读取 Next dev 环境中的模型、推理和缓存设置，使用合成凭证和本地响应。

```powershell
npm.cmd run agent:lab
npm.cmd run agent:lab -- scripted --profile scripts/agent-lab/variant.json
npm.cmd run agent:lab -- preview --profile scripts/agent-lab/variant.json
```

- **配置**。复制 [baseline.json](../../scripts/agent-lab/baseline.json) 或 [variant.json](../../scripts/agent-lab/variant.json) 并改 `name`。`systemPrompt` 替换稳定 System 正文，`methods` 按顺序选择现有 Method Pack ID，可覆盖 `title` 和 `lines`。`methods: []` 关闭方法包。省略 System 或 Methods 时使用现有默认和活动选择规则。`tools` 与 Task Contract 取交集，`[]` 关闭全部工具，省略时使用合同中可在 Lab 执行的工具。`model` 和 `reasoningEffort` 可覆盖文本 Provider 配置，后者支持 `low`、`medium`、`high` 和省略推理参数的 `null`。活动策略由 Task Contract 推导。
- **任务和资料**。用 `--task` 选择 [selected-source.json](../../scripts/agent-lab/selected-source.json) 格式的任务。填写 `draft`、现行 schema 的 `workspace` JSON 路径和 `selectedObjectIds`。文档提取和已准备好的 PNG、JPEG、WebP、GIF 可用 `assetFiles` 关联资源 ID 与本地文件。路径相对于任务文件。Lab 使用现有资料范围、文档截取和 Provider 图片预算。过大或缺失的像素会在范围覆盖中显示为摘要或省略。CLI 接收已准备好的单图，画布压缩和联系表仍由浏览器工作台处理。每次从源 fixture 建立隔离副本。
- **结果**。命令打印 `temp/agent-lab/<run>/run.json` 路径。比较两次记录的 `initialWorkspaceSha256`、`fixtureAssets` 与 `profileId`。预览看 `preview.body`，运行看各步 `steps[].events` 的 `lab-provider-request`，其中包含实际序列化的 System、Strategy、Method、Context、工具和模型参数。图片记录 MIME、字节数与 SHA-256。图片对象覆盖见 `providerInputs` 和续传的 `morpho_input_coverage`。用 Call ID 对照 Provider 工具参数、`toolResults` 和下一次请求的 `function_call_output`。终态、流事件、可用的 reasoning summary 和 usage、客户端计时及错误同样在该文件。固定响应中的 usage 是测试数据，`null` 表示费用或 usage 未取得。`workspace.after.json` 是落盘结果。使用合成或明确选定的测试资料，记录含实际正文。
- **增加或修改读取工具**。在 [agentReadTools.ts](../../src/shared/agentReadTools.ts) 改 Zod 定义，同一份定义生成 Provider schema、参数类型并验证入参。新增时将工具加入 [agentToolContract.ts](../../src/shared/agentToolContract.ts) 的适用请求构建、[agentToolExecutors.ts](../../src/features/workspace/agentToolExecutors.ts) 的执行注册，并在 [turnTaskContract.ts](../../src/shared/turnTaskContract.ts) 声明实际授权范围。执行器继续校验最新 Workspace、对象、revision 和授权。复制固定响应测试用例覆盖合法参数、非法参数、范围外对象和从 profile 移除工具的结果。

真实文本 Provider 需要已配置 Journal 和结果存储的测试 Supabase、可用测试账号及文本 Provider 配置，并消耗正式鉴权路径的额度。授权付费测试后，在一个 PowerShell 启动 loopback dev server。

```powershell
$env:MORPHO_AGENT_LAB_PROFILE = (Resolve-Path 'scripts/agent-lab/variant.json').Path
$env:MORPHO_ALLOW_PAID_SMOKE_TESTS = 'true'
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

另开 PowerShell，以 Playwright 打开本地登录页。用测试账号登录后关闭录制窗口，保存仅供本地使用的会话文件。

```powershell
npm.cmd exec playwright codegen -- --save-storage=temp/agent-lab-auth.json http://127.0.0.1:3000/login
npm.cmd run agent:lab -- live --profile scripts/agent-lab/variant.json --server http://127.0.0.1:3000 --storage-state temp/agent-lab-auth.json
```

服务端按 profile 指纹逐请求核对配置。配置变化需要开始新的运行。实时模式使用常规 A+ 请求准入、Provider 执行日志、结果结算和 ACK。Lab 可记录等待确认的状态，付费图像与联网工具保持关闭。测试账号会话和调试结果保存在 Git 忽略的 `temp/` 内。

## 常见故障

| 现象 | 处理 |
| --- | --- |
| 新项目提示正文已写入、列表更新失败 | 在当前页重试新建会沿用同一 ID。重新进入首页会找回已写入的项目。空间仍不足时，可从临时恢复的列表直接导出备份；存储恢复后再打开首页会保存目录。已列表的其他正文按需读取。 |
| 存储空间不足或跨标签页只读 | 从首页项目卡片导出可编辑备份，需要聊天历史时选择包含完整聊天。关闭持有项目写入锁的标签页后再编辑；删除项目前先确认备份和文件。 |
| 模型请求被拒 | 401 检查登录，403 检查测试资格，429 检查额度。503 检查对应服务配置、迁移、RPC 权限和结果存储。 |
| 请求中断或执行状态未知 | 用原项目、turn、request 或 action 身份恢复。已知图像任务可查询原任务；成功发布的结果可按原身份取回。本地项目写入完成后 ACK。过期返回 410。 |

## HTTP 接口变更

本分支移除了独立 `/api/ai/chat` 和通用 `/api/ai/effects/[effectId]` 查询、取消入口。仓库内的工作台与 Agent Lab 都从 A+ turn 入口发送文本。接入旧接口的外部脚本需迁移：查询 turn 用 `GET /api/ai/agent/turns/[turnId]`，取消请求用 `POST /api/ai/agent/turns/[turnId]/requests/cancel`，已完成结果按原 effect ID 在 `/result` 子路由取回。独立生图继续使用 `/api/ai/image`。

## Web 发布与数据库

Vercel 使用标准 Next 构建。Preview 和 Production 分开配置环境变量。发布前核对目标、提交、构建和运行时的环境配置。确认授权后再写入对应远端。发布后验证登录、首页、项目打开、未授权 API 响应及部署日志；真实 Provider 检查会消耗额度。

数据库迁移在 [supabase/migrations](../../supabase/migrations)。对已有环境先用 `supabase migration list --linked` 和 `supabase db push --dry-run --linked` 对照迁移记录，只应用目标环境缺少且经过批准的迁移。历史清理 SQL 按原版本保留。核对用户隔离、服务端结算权限，以及本版本使用的 effect 和 result RPC。

结果逻辑有效期为 24 小时。确认目标库已启用 `pg_cron` 并实际运行 `morpho-external-payload-cleanup`，或用受信任的调度器每 15 分钟执行 `public.cleanup_external_result_payloads()`。发布时核对最近一次清理结果、数据库容量、函数时限以及运行环境对请求体的限制。

本地 PostgreSQL 合同检查可用现有的 [effect 验证脚本](../../scripts/verify-external-effect-journal.mjs)和[result 验证脚本](../../scripts/verify-external-result-delivery.mjs)。它们接受本机 PGlite 模块路径作为第一个参数，在临时数据库中运行。旧版本的部署和验收凭据见[历史基线](../archive/README.md)。
