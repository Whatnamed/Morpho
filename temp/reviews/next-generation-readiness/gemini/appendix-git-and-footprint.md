# 附录 A：Git 演进基线、代码体量与数据/数据库足迹

> 所属报告：[Morpho 下一阶段工程适用性审查报告](./report.md)
> 审查基线：`main` @ `d55062e7fcdc5dfe0f12b08e43523bee7223dac6`（2026-11-19，工作树仅含未跟踪的 `docs/product/next-generation-direction.md`）

## 1. 仓库总体规模（2026-11-19 实测，原始文件行数）

| 目录 / 范围 | 文件数 | 精确行数 | Git 跟踪状态 | 说明 |
|---|---:|---:|---|---|
| `src/`（全部） | 572 | 198,736 | 已跟踪 | 含 prod TS/TSX、CSS、JSON 夹具与 244 个单测文件 |
| `docs/` | 200 | 76,325 | 已跟踪 | 含 ~48,800+ 行提交入库的 JSON 证据、115 个设计系统导出文件 |
| `e2e/` | 58 | 12,181 | 已跟踪 | 含 Playwright 验收、1,915 行 `performance-phase5.spec.ts` 及 `e2e/eval/` |
| `.agents/` | 95 | 10,651 | 已跟踪 | 5 个 vendored Skills |
| `.claude/` | 96 | 10,663 | 已跟踪 | 与 `.agents/` 95 个文件字节级 100% 重复，外加 `launch.json` |
| `scripts/` | 58 | 5,903 | 已跟踪 | 其中 33 个（57%）为已结项 P7B 一次性验收脚本 |
| `supabase/` | 21 | 4,880 | 已跟踪 | 20 个 SQL migration（其中 7 个属于已删除的 Runtime B） |
| `public/` | 27 | 483 | 已跟踪 | 内置示例项目 26 个二进制资产 + Cloudflare `public/_headers` |
| `.github/` | 1 | 71 | 已跟踪 | `quality.yml`（含强制执行的 `cloudflare` 备用构建 job） |
| `output/` | 59,261 | ~3,548,977 | **未跟踪**（`.gitignore`） | 本地遗留的 P7 / perf / preview 运行产物 |

## 2. `src/` 按架构子系统精确代码分布

基于 `split(/\r?\n/).length` 对 `src/` 全量文件统计（共 572 文件）：

| 子系统 | 文件数 | 精确行数 | 占比说明 |
|---|---:|---:|---|
| 单元测试与 DOM 测试（`src/**/*.test.*`） | 244 | 66,975 | 单测体量达到 prod TS/TSX/CSS 的 ~72% |
| 内嵌 JSON 夹具（`src/domain/morpho/caseStudy/*.json`） | 4 | 28,020 | 共 1.55 MB；其中 2 个被 `workspace.ts` 静态 import 进前端包 |
| 客户端 Agent Runtime、Context 与编排 | 43 | 17,374 | `agentTurnRunner` / `Lifecycle` / `Coordinator` / `RecoveryStore` 等 |
| 工作台 Shell、16 个 Controller、视觉/确认/历史 | 68 | 16,591 | `WorkspaceClient.tsx` 2,779 行、视觉执行 1,024 行、确认执行 873 行 |
| 领域核心、交付、归档、文档解析、案例安装 | 41 | 15,661 | `workspace.ts` 3,519 行（其中 1,738 行为 v1–v18 迁移逻辑） |
| CSS 与 Design Tokens | 8 | 10,408 | `src/app/globals.css` 单文件 10,165 行 |
| 工作台 UI 组件（`features/workspace/components/`） | 20 | 8,451 | `AiConversationPanel` 1,540 行、`BottomDetailBar` 1,261 行、`OverlayDrawers` 1,114 行 |
| 服务端 AI/图像适配器、Journal 与 Escrow | 32 | 6,285 | 含两套服务端账本（Turn/Action Journal + External Effect/Result） |
| 领域记忆、连续性与会话压缩 | 6 | 4,690 | `projectContinuity.ts` 1,665 行 + `projectMemory.ts` 1,335 行双轨投影 |
| 领域 Operations、Proposal 与图像编译器 | 10 | 4,437 | `operations.ts` 2,749 行 + 3 个 0 生产调用的旧 parser |
| Canvas 与 `tldraw` 投影 | 12 | 3,800 | `MorphoCanvas.tsx` 1,801 行 + `MorphoShapeUtil.tsx` 668 行 |
| 其他功能面（首页、登录、归档/交付客户端） | 8 | 3,520 | `ProjectHomeClient.tsx` 1,351 行 + `useProjectHomePreviews.ts` 520 行 |
| 共享 Agent / 协议 / 方法包合同（`src/shared/`） | 23 | 3,519 | 含大量手写类型守卫、9 处正则之一、Method Pack、协议哈希 |
| 领域 Schema 18 全量手写校验 | 2 | 2,243 | `currentWorkspaceValidation.ts` + `currentWorkspaceContractValidation.ts` |
| 服务端活跃 AI API Routes | 17 | 1,926 | `/api/ai/agent/turns/**`、`/api/ai/effects/**`、`/api/ai/image` |
| 本地持久化、IndexedDB 与 Web Locks | 9 | 1,874 | 相对紧凑、边界清晰的基础设施层 |
| **完全死亡的 `/api/ai/chat` + `server/ai/request.ts`** | **2** | **1,784** | **0 生产调用方，仅由测试与架构存在性测试维持** |
| 认证、每日额度、Middleware 与请求体限流 | 12 | 940 | 紧凑且有真实安全/成本价值 |
| 测试假实现（`src/test/`） | 4 | 232 | Journal / Effect / Result Fake |
| App Router 壳层与杂项 | 7 | 173 | 极简页面入口与错误边界 |

## 3. Git 演进五阶段时间线（706 次提交，2026-06-23 至 2026-11-19）

月度提交分布：`2026-06`: 36，`2026-07`: 246，`2026-08`: 256，`2026-09`: 28，`2026-10`: 127，`2026-11`: 13。

| 阶段 | 时间范围 | 关键提交与事件 | 遗留到今天的工程痕迹 |
|---|---|---|---|
| **Epoch 1：快速 MVP 与 M1–M9 底座** | 2026-06-23 – 07-10 | `20cf8bb` 初始化 → `3470c40` Operation Runtime → `556fd08` M4 / schema v6 → `ad730bf` M5 continuity → `615a2e5` checkpoints → `1ea74b9` compare → `c8d3000` M6 delivery → `12fe51b` M7 archive → `5720bda` M8 output → `1bd1f8d` Supabase Auth/Quota → `4de9f21` MiMo 切 AiJWS | `domain/operations/operations.ts`（2,749 L）、死亡的 `/api/ai/chat` + `request.ts`（1,784 L）、v1–v14 迁移代码、3 个已废弃 proposal text parser、旧 Nightrail 夹具迁移代码 |
| **Epoch 2：UI 打磨、Cloudflare 备用、Runtime B 建而复拆 → A+ 迁移** | 2026-07-11 – 07-29 | `d7f9736` Cloudflare Workers 备用构建；`1070123` Design System Tokens；`f9c43bd` Perf Phase 4；**7 月 23–28 日 7 个 SQL migration 建设 Runtime B（`ai_agent_turn_leases`）**；**7 月 28–29 日 35+ 次提交整体推翻 Runtime B 切至 A+ Runtime**（`4035d0e` → `0c4f78a` → `a191c97` → `0fb7326`） | 7 个已作废 Runtime B SQL 迁移（1,544 L）；A+ 客户端 4 件套（Lifecycle/Coordinator/Runner/RecoveryStore）；A+ 服务端 4 张私有表；Cloudflare CI job 与构建脚本；`agentRuntimeArchitecture.test.ts` 与 `agentRuntimeMigration.test.ts` 锁定测试 |
| **Epoch 3：Schema 16/17、WorkspaceClient 拆 Controller、AI Capability Layer 与 Perf Phase 5** | 2026-08-04 – 08-22 | Schema 16（KeyConclusion categories）与 17（剥离 checkpoint/lane/imageVariant）；从 `WorkspaceClient` 拆出 12+ Controller；`feat/ai-capability-layer`（Method Pack、Trusted Strategy、Memory Guard）；**8 月 17–20 日 30+ 次提交死磕 Perf Phase 5 浏览器基准**；8 月 20 日连续 5 次提交修补 Compare 持久化正则；合并并打标 `v0.5-integrated-runtime`（`55c056c`） | `WorkspaceClient.tsx` 拆完仍有 2,779 行；1,806 行 `performance-phase5.spec.ts` + 9,000+ 行生成 JSON 基准；`globals.css` 追加至 10,165 行；Method Pack + Strategy + Prompt 三层重叠；`build-provenance` 全套脚本 |
| **Epoch 4：14 包大整改（P0–P7）** | 2026-09-20 – 10-10 | 7 份专项审计 + `remediation-program-map.md` → 11 天 120+ 次提交密集交付 P0、P3S、P1A、P1B-1（Schema 18 / `incarnationId` / `EvidenceBasis`）、P1B-2（scoped memory/stage）、P2A（`TurnTaskContract`）、P2B（bounded reads & fulfillment）、P3A（`external_effect*`）、P3B（`external_result*` 24h 分片托管 + ACK）、P4、P5、P6H（`workspaceManualHistory`）、P6I、P7A/P7B-1/2/3；10 月 10 日 `8e10903` 宣布 P7 Overall `deferred` | 在原有 A+ Turn Journal 之上**又叠加第二套**服务端 `external_effect*` + `external_result_chunk` 分片托管表；9 处正则驱动的 `TurnTaskContract` 门禁；`workspaceSnapshotHistory.ts` 变死代码；33 个 P7B 脚本 + 37,000+ 行 P7 JSON 证据 + 59,261 本地未跟踪产物；`remediation-program-map.md` 单表格单元格膨胀至 4,000+ 字 |
| **Epoch 5：首页可靠性加固 + 转向下一代 Design Agent** | 2026-11-11 – 11-19 | `75fcf3a`–`d772f0c` 首页按需预览、Web Locks 串行化、双通道容量预警与一键备份导出；`614b264` 开源 Agent 调研；`04ef4b8` 用 Zod 统一 5 个本地只读工具；`d55062e` 合入 Agent Lab；新增 `docs/product/next-generation-direction.md` | 首页改动边界清晰、质量高；`agentReadTools.ts`（83 L Zod）验证了统一工具定义的低维护成本；`Agent Lab` 提供了独立实验入口但仍受制于 A+ 协议与固定 Prompt Contract 版本 |

## 4. 历史高频修改热点（Git Churn Top 15）

| 提交次数 | 文件路径 | 工程信号 |
|---:|---|---|
| 155 | `src/features/workspace/WorkspaceClient.tsx` | 全仓库绝对耦合中心（67 imports、16 hooks、75 `useCallback`） |
| 133 | `docs/architecture/architecture.md` | 追加式膨胀至 1,270 行，已出现标题与现状脱节 |
| 115 | `docs/operations/runbook.md` | 追加式膨胀至 1,614 行，混杂已禁止重跑的 2026-07 迁移手册 |
| 108 | `docs/architecture/decisions.md` | 1,434 行，90+ 条过期与有效 ADR 混排 |
| 89 | `src/app/globals.css` | 10 轮追加式“polish pass”，179 个选择器被重复定义 2–6 次 |
| 68 | `docs/operations/remediation-program-map.md` | 711 行，活账本变成巨型流水账 |
| 56 | `src/features/workspace/components/AiConversationPanel.tsx` | 1,541 行、47 个必需 Props，强绑单会话与旧确认/Proposal 形态 |
| 52 | `e2e/performance-phase5.spec.ts` | 1,915 行，高维护成本的浏览器延迟测量套件 |
| 51 | `src/domain/morpho/workspace.ts` | 3,519 行，一半是 v1–v18 历史迁移，还静态 import 1.54 MB JSON |
| 51 | `src/domain/morpho/types.ts` | 168 处 prod fan-in，所有子系统共享的超级类型文件 |
| 46 | `src/features/workspace/morphoAgent.ts` | 1,222 行，仍残留 4 个无生产调用的死导出 |
| 42 | `src/features/workspace/tldraw/MorphoCanvas.tsx` | 1,801 行、26 个 `useRef`、存在 `canvasComponents` 重挂载隐患 |
| 32 | `src/features/workspace/agentTurnRunner.ts` | 1,812 行，A+ 编排/恢复/压缩/履行中枢 |
| 31 | `src/server/ai/request.ts` | **1,466 行完全死亡代码**，历史上改了 31 次但现已 0 生产调用 |
| 29 | `README.md` | 塞满防御性免责声明、中英混杂与历史基线 SHA |

## 5. 本地与远端遗留分支 / 标签审计

除 `main` 外，仓库保留了 **9 条历史分支**（本地与 `origin` 完全成对存在）：

| 分支名 | 相对 `main`（behind / ahead） | 最后提交 | 判断 |
|---|---:|---|---|
| `archive/agent-runtime-b` | 475 / 0 | `f27a410` (2026-07-28) | 已有同名归档标签 `agent-runtime-b-final-2026-07-28-f27a410`，分支冗余 |
| `refactor/agent-runtime-a-plus` | 422 / 0 | `147777f` (2026-08-04) | 已完全合入 `main`，过时 |
| `codex/security-scan-remediation` | 315 / 0 | `770d674` (2026-08-10) | 已完全合入 `main`，过时 |
| `codex/security-review-followups` | 313 / 0 | `323273c` (2026-08-12) | 已完全合入 `main`，过时 |
| `feat/ai-capability-layer` | 243 / 0 | `1132fd3` (2026-08-20) | 已完全合入 `main`，过时 |
| `perf/phase5-real-interaction-latency` | 218 / 0 | `b25d751` (2026-08-18) | 已完全合入 `main`，过时 |
| `perf/phase5-final-hardening` | 198 / 0 | `f33f4b4` (2026-08-20) | 已完全合入 `main`，过时 |
| `integration/phase5-ai-capability` | 171 / 0 | `70bd14c` (2026-08-20) | 已完全合入 `main`，过时 |
| `codex/fix-build-provenance` | 13 / **2** | `8200aa6` (2026-11-11) | **唯一含 2 个未合入提交的分支**（需负责人确认是否丢弃或 cherry-pick） |

## 6. 实测真实项目 JSON 体积分布（`currentCaseWorkspace.generated.json`）

该文件为仓库内置的真实 Morpho 可编辑项目备份导出（总计 **1,502,956 字节 / 26,468 行**，注意其 `schemaVersion` 仍停留在 **17**，且 `project.title` 为 `"测试"`）：

| 顶层字段 | 字节数 | 占比 | 性质归类 |
|---|---:|---:|---|
| `projectMemory`（含 `revisions` 131.5 KB + `stageRevisions` 103.6 KB） | 236,856 B | 15.8% | **纯派生投影与修订历史** |
| `operations`（31 条） | 191,855 B | 12.8% | 运行态操作日志 |
| `projectContinuity`（4 组字段） | 160,361 B | 10.7% | **第二套连续性/记忆账本** |
| `artifactProposals`（28 条） | 154,467 B | 10.3% | 历史提案快照 |
| `ai`（其中 `ai.messages` 144.8 KB） | 151,374 B | 10.1% | 对话与比较记录 |
| **`objects`（42 个真实设计对象）** | **100,168 B** | **6.7%** | **核心设计数据** |
| `decisionRecords`（89 条） | 53,568 B | 3.6% | 决策记录 |
| `citationSnapshots`（33 条） | 47,015 B | 3.1% | 引用快照 |
| `designDefinitionRevisions` + `directionRevisions` + `relations` + `canvas` + `assets` | 104,030 B | 6.9% | **核心版本/关系/画布/资产元数据** |
| 其余字段（`workingState` / `deliveryReferences` / `project` / `ui` 等） | 3,565 B | 0.2% | 轻量状态 |
| JSON 格式化缩进空白 | ~300 KB | ~20% | 仅源文件 pretty-print；`localStorage` 紧凑序列化时上述比例进一步向账本倾斜 |

**关键量化事实**：紧凑 JSON 中，实际设计对象与画布/版本/关系/资产元数据仅 ~204 KB，而派生记忆、连续性、操作日志、提案、决策、引用快照等账本高达 **~844 KB（> 4.1 倍于核心设计数据）**；仅 `projectMemory` + `projectContinuity` 两套并行派生账本就占了 **~397 KB**。

## 7. Supabase SQL 迁移生命周期盘点（20 个文件，4,524 行）

| 组别 | 迁移文件范围 | 行数 | 当前运行态状态 |
|---|---|---:|---|
| **Auth 与每日额度** | `20260705083705` – `20260707053357`（6 个） | 679 | **活跃且精炼**：`public.app_user_access`、`public.ai_daily_usage`、2 个核心 RPC |
| **Runtime B Leases（已彻底废弃并 DROP）** | `20260723200036` – `20260728203000`（7 个） + `20260729190000`（DROP） | 1,554 | **纯历史死债**：建于 7/23–7/28，7/29 全部 DROP；仍占全部 SQL 34% |
| **A+ Turn & External Action Journals** | `20260729012105`、`20260729093000`、`20260810025000`、`20260812090000`（4 个） | 1,742 | **活跃但厚重**：4 张 `private.agent_turn_*` 表 + 9 个 RPC + 1 个触发器 |
| **P3A/P3B External Effect & Chunked Escrow** | `20261001090000`、`20261001154434`（2 个） | 549 | **活跃且与 A+ 账本叠床架屋**：5 张 `public.external_*` 表（含 Postgres 存 base64 图片/JSON 分片）+ 3 个 RPC；在 SQL 内部反向伪造 JWT claim 调用 A+ 结算 RPC，且每次 RPC 调用都执行 4 条 DML 清理语句 |
