# Morpho 下一阶段工程适用性审查

2026-11-19 · Codex 独立审查 · Morpho v3.2 / A+ / Workspace schema 18

## 决策摘要

Morpho 已具备可用的项目真值、画布适配、文档读取和付费结果恢复基础。下一阶段最大的工程阻力是 **会话、领域写入和运行时的所有权仍然集中在一个浏览器 Workspace**。现在继续在 A+ 外嵌一套 Agent，或者给现有 AI 面板直接加多个 Tab，都会把同一段历史、确认和续传交给两个系统管理。

建议批准三组近期工作。

1. **收口现行入口和历史负担。** 确认独立文本路由的外部使用后退役其旧合同。删除测试专用的整块快照 Undo 与转发模块。把阶段验收移出日常文档和默认测试入口。Skills 使用一份源，按真实宿主需要投影。
2. **解决浏览器项目正文与目录的写入缺口。** 本轮用当前实现确认了正文存在、重入后卡片仍消失的路径。先做范围窄、能保护现有项目的修复。下一阶段若继续以浏览器为主要存储，再把项目记录和目录统一为同一持久化事务。
3. **先调整可复用的能力边界。** 用现有 Agent Lab 验证资料读取请求、实际输入和续传。把资料读取、权威项目命令、Provider 效果和显示回调的所有权画清，选一个真实功能消除绕行。Session 形态、并发、Memory 规则和宿主确定后，再在同一条工作流里切换 Loop 与 Context，整体退役旧编排。

应延后投入完整 Eval 平台、跨项目记忆、全面 UI/CSS 清理、Provider/Canvas SDK 大迁移和专业方法包扩写。基于当前方向，下一阶段值得重做的部分主要是编排和状态边界。用户项目的稳定身份、明确授权、同一付费执行的安全恢复和可编辑备份仍应作为替代方案的验收条件。

## 基线、假设与覆盖

- HEAD、本地 origin/main 引用均为 **d55062e7fcdc5dfe0f12b08e43523bee7223dac6**，分支 main。审查前有一份未跟踪的下一阶段方向说明。方向与任务书的 SHA-256 见[核实记录](verification.md)。
- 按一个设计师操作本地项目、同源标签页可能并存、远程闭测账号使用共享 Provider 与额度的现状评估。下一阶段方向提供适用性标准。多会话是明确产品意向。并行 Agent、Memory 共享范围、面板模式、分发宿主和新工具体系仍待决定。
- 跟踪了 Web 页面和 API 入口、浏览器 Agent / Lab 入口、请求组装与工具授权、付费及其 SQL 合同、Workspace / Canvas、多类资料和交付、导入/备份/项目管理、本地存储、构建/CI/测试、文档与仓库 Skills。Git 历史覆盖相关迁移及修正，并定点核对 A+ 的历史 PR。
- 下文的实现结论来自当前符号、调用方或已执行的定点检查。建议与后果预测是工程判断。生产部署状态、数据库迁移与 cron、账号/路由实际流量、付费 Provider 行为、浏览器视觉与真机交互仍待相应验收。测试结果与本轮可复核的证据见[核实记录](verification.md)。

## 架构演进与当前调用关系

| 演进 | 原问题与当前结果 |
|---|---|
| 浏览器项目和独立资产 | f06fb02 引入目录和项目路由，早期决策把 JSON 放入 localStorage，二进制放入 IndexedDB。4d5c8e3 把默认案例改为当前项目，必须保全改过的旧样例。ff2fe30 加入首页写入串行、保存部分成功和修复路径，两份存储的协调成本仍在。 |
| 连续对话与项目记录 | 534cb39 汇合 AI、Memory、阶段与视觉逻辑。cf7c25b 把 lane checkpoint、旧 image variant 隔离为 schema 17 兼容输入。a0674e7、0146411 和 71f9167 增加身份、证据有效性和投影收口。今天的多会话需求改变了对话容器，但这些提交保护的来源和历史身份仍有使用方。 |
| Runtime B → A+ | 浏览器本身执行本地工具，B 曾用 Lease、Closure、Snapshot、Continuation 等证明浏览器历史。A+ 把本地真值留给 Workspace，服务端掌握服务端可证的执行。a191c97、0fb7326 移除 selector、旧路由和证明模块，20260729190000 提供数据库清理迁移。[历史 PR #2](https://github.com/Whatnamed/Morpho/pull/2) 记录了拟定 cutover、验收和迁移顺序。HEAD 改动与本地 SQL 已核对，远端执行状态未复验。 |
| A+ 后续扩展 | b169dc1 用混合意图合同替代单 mode 决定范围。32db875、3935e4e 增加真实读取和履约。fb8b92b、1ac76cf、c86f1dc 进一步分离执行身份、结果暂存和浏览器保存。0f1c592 保存实际发出的请求意图，573a83b 延后 Text ACK 到本地持久化。它们解决的是现实故障，简化时需要保留效果。 |
| 近期开发入口 | 8e10903 收口 P7 实验阶段，整体仍 deferred。04ef4b8 将五个本地读取工具的参数定义合并。d55062e 增加可执行的 Agent Lab，并直接借用真实组装器和 Runner。两项是独立改进，已有现成切入点。 |

| 从产品入口开始 | 当前链路和最接近写入的所有者 |
|---|---|
| 打开项目 | App Router → WorkspaceClient → usePersistentWorkspace → project lease、初始化和装载 → React Workspace → 防抖与显式 flush → workspace JSON → catalog 摘要。文件是 IndexedDB Blob。 |
| 从面板发送 | WorkspaceClient → useWorkspaceAgentRuntimeController → agentTurnRunner → prepareAgentTurnProductAPlus → TurnTaskContract、上下文、消息快照 → Coordinator 管 HTTP 协调，Runner 驱动工具和续传。Tool Executor 重读 Workspace 并使变更通过 Host 落入产品状态。 |
| Provider 执行 | /api/ai/agent/turns → /requests 或 image/search/compaction action → Supabase 账号、额度、Journal 和 claim → Provider → Effect/Observation → Result Store / SSE → 浏览器保存、ACK 和恢复。独立 image 路由也接入结果链。 |
| 用户编辑画布或对象 | MorphoCanvas 监听 tldraw 的选择、相机和形状 → WorkspaceClient 更新布局或路由操作 → 领域命令改形状关联的真实对象 → 重新投影到编辑器。Manual History 只撤销本次手工操作拥有的状态。 |
| 读资料与交付 | Import → Blob、对象、提取文本及来源 → Reader、片段、Agent bounded read、Compare → 领域对象和引用 → 人读 Archive、可编辑 Backup 或交付 Output。三种出口的使用方式不同。 |

## 一、近期删除、合并和修正

### 1. 退役独立文本路由前先确认外部消费者

当前 HEAD 的全仓字面和实现引用核对中，正式工作台、Lab、E2E 正式发送均使用 A+。独立 /api/ai/chat 的 POST 仍进行身份和额度检查、独立 Prompt/NDJSON、独立 effect 和结果交付，还包含特定失败后降为纯文本请求的兼容行为。它因此每次改 Provider、限额、SSE/NDJSON、错误或 result envelope 时都制造第二个维护面。当前能确定的仓内入口是 Next 路由自身，另有路由测试和监控/runbook 检查。旧 v3.2 收口时保留此兼容路由，P3A/B 又为它接入当时新增的付费保护。旧备份由 schema 和 bundle 迁移处理，仓内没有从备份流向该 HTTP 路由的调用链。

先查正式环境允许的路由调用统计与已知下游。确认无人消费后，一个任务删除 route、专属请求与提示分支、NDJSON 专属测试及运维合同，并按引用保留共享 Provider adapter、SSE、校验、quota、effect 和结果存储。若确有脚本调用，先迁移调用方或发布明确退役窗口。独立 /api/ai/image 由工作台当前视觉执行分支调用，单独确认付费及恢复覆盖后才可并轨。

源码与文档 · src/app/api/ai/chat/route.ts:35,117,181,281 · src/server/ai/request.ts:277 · src/features/workspace/agentRuntimeArchitecture.test.ts:21 · src/features/workspace/workspaceVisualGenerationExecution.ts:544 · docs/architecture/architecture.md:842。相关提交 · 0fb7326、fb8b92b、c86f1dc、PR #2。

### 2. 删除整块快照 Undo，收窄现行测试的结构约束

现在的 Ctrl+Z 经 useWorkspaceObjectHistoryController → workspaceUndo → workspaceManualHistory。活跃机制捕获操作拥有的记录及前后值，冲突保留，并补偿 Continuity 和 Current Focus。workspaceSnapshotHistory 自 e51bba1 起仅剩同名测试引用。它没有持久化格式、恢复用户或 Wire 兼容消费者。可以删除这两个文件并让 controller 直接导入 workspaceManualHistory。保留手工 Hide 之后 Agent 写 Research、再 Undo/Redo 的 E2E，以及目标被替换后的冲突覆盖。

agentRuntimeArchitecture.test.ts 一部分检查已移除端点和退役证明字段仍有价值。直接把 hook 路径、源码字面和独立 chat 存在性设为义务，会让移动目录或退役路由触发无行为回归的测试失败。改为检查一个可运行的用户入口、公开路由面和旧输入在迁移后留哪些数据。等本轮相关代码真正变更时同步处理，避免单独维护新的架构测试框架。

源码与文档 · src/features/workspace/workspaceSnapshotHistory.ts:22,89 · src/features/workspace/workspaceUndo.ts:3 · src/features/workspace/useWorkspaceObjectHistoryController.ts:8 · src/features/workspace/workspaceManualHistory.ts:36,110 · e2e/manual-history.spec.ts:64,167,197 · src/features/workspace/agentRuntimeArchitecture.test.ts:8–64。相关提交 · e51bba1、6831e98。

### 3. 修正项目目录与正文的部分写入，保留写入保护

已离线复现。项目 A 正常存在于目录，B 的正文写入成功，故障只发生在 B 的目录写入。随后解除故障并调用真正的初始化函数，目录仍只有 A，按 B 的 ID 能读出正文。生产新建流程对应的重试 ID 放在 pendingCreateId React ref。留在同一页面重试有效，离开页面后该 ID 随组件消失。目录恢复只在目录项目数为零时扫描正文，因此普通重入不能找回 B。现有 E2E 覆盖同页重试。

近期修复应贯通正文与目录的成功协议。可补全对有效、已完成正文的孤立项修复，再使用现有目录锁保护合并。需要定义如何辨别历史样例、导入中未完成副本和残留记录，且用已有项目 A 的重入场景覆盖失败边。若把新建改成失败回滚，也须给出回滚本身失败时的可恢复入口。长期若浏览器继续持有权威项目，将项目、目录索引和提交元数据放入一个事务，给横跨多个对象的写入设清晰提交点。保留可编辑备份，并把旧存储迁移做成可重复、有确认和失败可读的输入边界。当前路径的项目 lease、目录级别串行、旧摘要不覆盖新正文、IndexedDB tx complete 后才报成功，以及不确定归属时不回收 Blob 都应保有等价保证。Web Locks 不可用或失败会返回 unsupported 并允许写入，报表和文档须把保护适用条件说清。

源码与文档 · src/features/projects/ProjectHomeClient.tsx:394–431 · src/infrastructure/persistence/localProjectStore.ts:141,225,246,464,474 · src/infrastructure/persistence/projectWriteLock.ts:58,65 · src/infrastructure/persistence/projectLifecycle.ts:79,132 · src/infrastructure/assets/indexedDbAssetStore.ts:63 · e2e/project-management.spec.ts:34,101,157。相关提交 · f06fb02、8e95334、363a68c、ff2fe30。[离线检查](spot-check.mjs.txt)

### 4. 把旧数据翻译和内置案例安装移到显式边界

workspace.ts 同时负责新建、对象/修订/引用变换、JSON 编解码、1–17 迁移、现行 normalize 和历史样例 fixture。loadProjectWorkspace 在正常开启项目时会 parse，writer 可写回迁移结果，readOnly 仍会归一化。Editable Backup 在另一入口既验证当前结构，也尝试针对 schema 17/18 或旧 lineage 的翻译后再校验。早期兼容确实有现在的调用方。删除旧 checkpoint 代码会影响存量项目的摘要转换，删除 case fingerprint 会失去区分未编辑样例和用户项目的依据。

现在适合分离三件事。新对象写入只使用现行领域约束。持久化在读取边界一次性辨认版本与报错，迁移集中于可重放的旧输入转换。内置案例安装由可独立调用的 bootstrap 承接，项目列表与 workspace 打开只消费结果。把仅测试/造测量数据的函数与 fixture 移出生产领域入口前，需检查 createInitialWorkspace 的项目和环境分支以及 build 产物，当前确认 fixture 被入口导入，未做打包体积判断。P1B-1 的随机 forward incarnation 意在从迁移点向前保护身份，不能替历史上同 ID 的来源凭空补关联。保持失败原始 JSON、旧备份与改过的案例都可读。后续根据真实在用 schema 才决定最低兼容版本，保留从旧版导出或迁移的受支持路径。

源码与文档 · src/domain/morpho/workspace.ts:36,189,206,1772–1840,1877 · src/domain/morpho/legacyWorkspaceCompatibility.ts:64,93 · src/domain/morpho/editableBackupCompatibility.ts:8 · src/domain/morpho/projectBundles.ts:218,278 · src/infrastructure/persistence/localProjectStore.ts:177,524 · src/features/workspace/workspaceInitialization.ts:44。相关提交 · cf7c25b、d8e8d9c、fa363e6、0146411、4d5c8e3、6b1cce0。


## 二、值得做较大调整的工程边界

### 5. 让 Agent 的循环、执行事实和显示各有一个所有者

当前一轮包含至少四类有合法差异的状态。Runner/Coordinator/Lifecycle 表示本地轮次与工具进展。Supabase Turn Journal 表示认证后的步序、额度和服务端确认。Effect/Attempt/Observation 描述该次外部执行是否发生。Result Store 与 ACK 表示原始结果是否可取、是否已在本地安全应用。它们目前还在 recovery store、provider output、React 流式消息和 SSE 里重复投影。新增“工具后暂停”或“确认后恢复”需要理解 Runner 的多个驱动分支、Coordinator 对生命周期的转换、recovery serialization、Tool Batch 和 UI host 的归属。9 月止损与 10 月恢复提交的动机是丢响应、取消、外部执行不明与本地保存失败，这些状态不能合并成一个 success/failed 字段。

近期应沿一个读取或领域命令先收敛业务调用面。把确定性项目读/写从 React host 的 UI ref、选中效果和同步 setState 剥开，UI 订阅产物、草稿和可显示进展。维护明确的异步提交返回值与持久化承诺。Lab 的 fake 走同一 commit helper，但它的内存 setter 不经过 usePersistentWorkspace 的投影 reconcile，真实浏览器也有项目 lease 与会话 guard。Lab 单测通过无法证明浏览器端业务状态等价。让浏览器与 Lab 对同一领域命令、同一输入、同一先决 revision 产生相同结果，适合做第一条黄金轨迹。在真正共享时确认投影、失败、提交和权限调用的顺序。

Loop 替换的候选形态是一个负责人处理模型 step → 执行本地 Tool → 收集观察 → 下一步。他只持有 session/turn 中的因果顺序。远端共享付费服务继续掌握认证、模型密钥、配额、已验证外部 Tool claim、稳定 effect ID、原请求和原结果，允许原结果查询，经过本地确认后 ACK。领域项目状态只通过明确命令变更，显示状态是派生视图。若迁移到本地 Node 宿主，选用已有可靠的本地事务存储承接进程重启，关键数据仍留在使用场景中可恢复。保留 Web 版本时必须证明浏览器 Blob、选择、确认和重新连接的通道成本。两套 Loop 并行管理 continuation 的方案没有合理的长期所有权。

用脚本响应比较“小循环继续用现有 A+ steps”和“嵌入现成 Loop 接同一执行 Port”。优先考虑上一轮已分析的 Pi Core 作为候选。只有在同一条轨迹中证实可以退役足量旧驱动与状态；用户中断、未知执行、结果补领、确认和落盘失败行为等价；对 Responses 的工具结果和多模态输入没有损失，才选择接入。借鉴 OpenCode 的 Session 层或 OpenDesign 的本地宿主组织同样有用。其整个服务、工具集、Session DB 与旧 A+ 共存会扩大职责重叠。仓库历史调研足够支撑定点候选比较。

源码与文档 · src/features/workspace/agentTurnRunner.ts:92,196,571,717,899,1183,1535 · agentTurnCoordinator.ts:119 · agentTurnLifecycle.ts:533 · agentTurnRecoveryStore.ts:227,357,380 · agentTurnHost.ts:55 · agentTurnHostFake.ts:57 · workspaceCommitBoundary.ts:20 · usePersistentWorkspace.ts:156 · src/server/ai/agentTurnJournal.ts:241,291 · externalEffectJournal.ts:44 · externalResultStore.ts:62,106。相关提交 · a191c97、fb8b92b、0f1c592、573a83b、3109be6、7c3e4c2、614b264。

### 6. 把任务理解和权限执行拆开，压缩一次工具变更的影响链

目前由 Auto/手工 mode、选中对象、按钮意图、自然语言子句和领域上下文共同生成 TurnTaskContract。turnTaskResolver 借用旧式 resolveAgentToolAuthority 的规则推导总任务和子句，再把多 Activity 合成。prepareAgentTurnProductAPlus 再把合同投影到策略、方法包、活动 Context、范围、read receipts 和请求。服务端 parser 重验 Strategy/Method/Capability 是否与合同一致，构建模型可见 schema 与 profile。Tool Batch 解析、做范围和最新 revision 检查，派发 read/write/confirmation，最后履约判断用 read/effect receipt 把“模型说读过”和“输入确实送达”分开。改变“读一份资料”“给两个方向做 Compare 再对 A 出图”涉及这条链的所有层。b169dc1 的多意图、32db875 的有界阅读、3935e4e 的证据式履约是真需求。旧式 authority 分支在 TurnTaskResolver 仍有两个生产调用点，不能按名字删除。服务端合同校验提供结构和额度边界，浏览器发来的项目语义依然由本地 Workspace 决定。

下一步以责任分离取代旧 mode 到处投影。任务理解只建议意图、目标和可见工具。确定性授权使用用户当前操作、资源范围、对象/revision、允许动作和付费预算。真正执行前由持有资源与权威状态的一方重验。Tool 注册可沿 04ef4b8 已有做法统一共享定义、运行时解析和模型 JSON Schema，再从同一份工具元数据导出实际所需的 effect 描述。继续让领域 Command 验证 stale target，Provider acquisition 从可信输出来绑定外部 claim。浏览器、HTTP 边界、PostgreSQL 与外部下载分别承担各自的值域、权限和状态保护。重复执行同一语义判定的规则应收归所有者。对研究/视觉/Compare 逐项维护中文词法兜底的工作，到新版确认资源选择、明确授权和交互步骤后再减少。新接口也不应预先推广到完整插件系统。

建议先以一条“选中资料读取”验证工具注册和范围改变只需改动预期所有者，再以“改 A 的视觉图，同时比较 A/B 且保持原图”验证复杂任务的诚实履约。完整、部分、缺失的正文证据和实际送达的像素应继续能查。当前早于 Task Contract 的可恢复步骤仍有旧请求 payload、可安全收尾的 replay，以及受限继续分支。新录入已全部使用合同，删除时针对已存 Recovery 的寿命与处置确认，不把历史在途工作当新付费开始。

源码与文档 · src/features/workspace/turnTaskResolver.ts:24–82 · agentToolAuthority.ts:67,149 · agentTurnProductPreparationAPlus.ts:207,239,314,378,543,595 · agentToolBatchAPlus.ts:57,363,587 · agentTaskFulfillment.ts:7 · src/shared/agentReadTools.ts · src/shared/turnTaskContract.ts · src/server/ai/agentTurnProviderRequest.ts:106,117,193,266 · supabase/migrations/20260812090000_harden_agent_tool_claim_settlement_boundary.sql:16,101。相关提交 · da726f9、b169dc1、32db875、3935e4e、02655e8、04ef4b8。

### 7. 继续使用 Agent Lab，收窄实验入口的职责

Agent Lab 已足够承担首轮可复测输入与工具续传。preview 借准备器与实际服务端序列化，scripted 借 Next handler 及固定传输，live 才经 loopback dev server、测试账号和正式额度。Server 在 dev、显式 opt-in、固定路径指纹和合成项目 ID 上约束 profile。模型工具是合同与 profile 的交集，外部付费及外部取证工具在 Lab 被剔除。它可以对照可信 system/method 内容、工具、正文/像素覆盖和续传修订。已跑 baseline/one-source 同一 fixture，工具调用与续传事实相同，实际首发工具列表分别为两个和一个，variant 方法包到达双方请求。文本结论来自固定响应。

建议保留现有 replay/preview 和可观察序列化边界，后续由 Agent 方案决定 config 的最终源与 `systemPrompt`/Skill 格式。Lab 可安全记录显式选择的测试数据和调试运行，正式产品不急于把调试 headers、Profile、Provider 原始包或完整记录开放给用户。run.json 含实质项目正文，分发前应维持明确保存位置。只把输入送达、执行范围、预算和结构正确性做成自动对照。专业结果由设计负责人看真实案例，不将脚本固定答案或 LLM 评分当作定型依据。现有 fake 与浏览器在 Blob/确认/恢复和投影上的差异放在关键浏览器轨迹维持。

源码与文档 · scripts/agent-lab/run.ts:38,124,184,218 · scripts/agent-lab/scripted.ts:35,44,68 · src/server/ai/agentLabProfile.ts:17,37,48,83 · src/app/api/ai/agent/turns/[turnId]/requests/handler.ts:88,120,187,230 · docs/operations/runbook.md:1193。相关提交 · 04ef4b8、d55062e。[核实记录](verification.md)

### 8. 重整 Workspace 写入接口与来源模型，保留身份与交付合同

对象状态目前由 WorkspaceClient 及多个 Controller 经 setWorkspace、commitWorkspaceNow 和 usePersistentWorkspace 修改。同步提交依赖 flushSync 与 React updater 回传结果。领域层亦多处显式 reconcile，React 口在投影输入变化时再 reconcile，读取工具和 Context 为确保看见当前状态也会临时重算。workspace.ts 同时做布局、隐藏/删除、修订链接、默认参考、Delivery 引用和迁移。ProjectMemory 与 ProjectContinuity 存在互相调用的方向。领域业务每增一个命令，提交前后容易漏掉 Continuity、Decision、Projection 或 undo 归属。按文件拆分 hooks 曾缓解阅读集中度，但状态所有权没有随着拆分一起迁出 React。

此次结构目标应以一次逻辑命令为单位。输入带目标、权限、旧 revision/对象预期，输出包括新的权威数据、变化及需要回读的稳定身份，投影只在确定的提交边界更新一次。界面只持有焦点、面板和交互过程中的临时状态。保留对象 incarnation、资产、Canvas instance、修订、关系和 DeliveryReference 的独立身份。Case Study 和 Backup 按源数据入口验证并迁移，实际恢复只生成独立项目副本。Preview、Archive、交付等可共享一套当前可用性解析与安全 ZIP/二进制基础，维持各自包内容。人读 Archive 本就允许面向阅读组织，Backup 要能恢复工作，Delivery Output 固化选定的引用和物料。将三者用一个导出 DTO 管理会丢语义。交付功能不优先扩展，下一代如果暂时不呈现相应 UI，现有备份和引用仍须有迁移或只读解释路径。

源码与文档 · src/features/workspace/WorkspaceClient.tsx:225,243,395,445,1008 · usePersistentWorkspace.ts:156 · src/domain/morpho/projectContinuity.ts:360,464,486,550 · projectMemory.ts:212,243,339 · derivedState.ts:48 · workspace.ts:638,1165,1677 · objectIdentity.ts · deliveryPreparation.ts:418,625 · deliveryInspection.ts:69,88 · src/features/archive/projectBundleClient.ts:130,157,256,308–363 · src/features/delivery-output/deliveryOutputClient.ts:80,115。相关提交 · a0674e7、0146411、71f9167、e51bba1、6291e8f。

### 9. 先统一付费结果的处理合同，再评估后端与存储合并

A+ 的自然语言生图由 Tool claim、子 action、原始参数哈希、事件恢复和每项独立画布提交构成。独立生图通过 /api/ai/image 和单独的本地 pending/indexedDB 路径，到相同的 GrsAI adapter、Effect、Result 交付和 image commit。Text 和 Compaction 有各自的 route 与恢复入口。现在复制的 Promise 等待、settle 重试与错误映射需要读多个 handler 才能确定同一失败含义。Agent Turn claim/admission 与 Effect 观察存在分立事务，Result Store publish 在 SQL 内还要使相关完成信息可恢复。`saveExternalResult` 按小块调用 SQL，TTL、配额、幂等与清理共同决定真正的交付窗口。SQL 迁移是活跃合同。历史上移至 private 或 revoke 的函数可能在现行 wrapper 内继续服务，不能用 ts 搜索结果删掉已部署函数。

可先用当前公网形态缩短共享代码。将 Provider submit/observe、同一结果暂存与浏览器 derive/ACK 各自约束收口，明确“获取已存在结果”和“获准真正提交”两条路径。只有在下一代决定工作台和 Agent 的生图操作是否交汇之后，才把操作入口和 Recovery 一并合并。若继续托管共享 Provider，服务端需维护用户隔离、额度和 claim，并实证断网场景下不发第二次付费 POST。保留丢包、取消后迟到结果、未知状态、结果已执行但未交付、块完整性、同一输入重放和浏览器保存后 ACK 的测试。外部结果落在 SQL chunks 是当前做法。后续在真实载荷或宿主简化收益清楚时，可用同一身份绑定的有期限 blob 存储加状态事务，将字节搬运从业务 RPC 中移开，仍须可校验发布、隔离、过期与删除。当前迁移的 cron 依赖 pg_cron，runbook 有替代调度要求。部署验收应查询实际权限、清理和保留期。

本地 UI 与项目存储的可用性也应和托管账号配额分开。MORPHO_AUTH_REQUIRED=false 绕过页面认证，AI handler 仍要求 Supabase。项目目录与资产按浏览器 origin 存储，首页换账号的展示不会建立另一套本地项目命名空间。未来如以单用户本地宿主为产品，需单独确认密钥、执行身份和本地用户保护。若正式提供共享机器账号隔离或带云同步，两套权限边界必须显式设计。单纯给现行网页设置一个 auth 开关无法达到这些目标。

源码与文档 · src/app/api/ai/image/route.ts:24,41,49,65 · src/app/api/ai/agent/turns/[turnId]/actions/image/handler.ts:63,102,142,273 · src/features/workspace/workspaceVisualGenerationExecution.ts:203,418,520–566,660–746 · independentImageDelivery.ts · externalResultClient.ts:61–103 · src/server/ai/externalResultStore.ts:62–130 · src/server/auth/aiAccess.ts:77,102,128 · src/server/image/secureImageDownload.ts:67,85,158 · src/features/projects/ProjectHomeClient.tsx:200,620 · supabase/migrations/20260810025000_harden_agent_turn_admission.sql:11,177,263 · supabase/migrations/20261001154434_add_external_result_delivery.sql:3–49,221,280,350 · docs/operations/runbook.md:1508。相关提交 · eec8744、1057212、ae81d01、fb8b92b、1ac76cf、c86f1dc、1f410e4。


## 三、等产品和 Agent 决定后一起调整

### 10. 项目内多会话应先定义数据归属，并明确第一版并发

当前一份 MorphoWorkspace.ai 保存全项目 messages、compaction、summary revisions、provider context frames 和比较分析。Runner 的 activeSessions、恢复记录和页面 detach 均以 localProjectId 为键。Confirmation Controller 一次维护一个槽。Compaction 的摘要覆盖边界在当前整个对话的有效消息上计算。Search Project Conversation、Memory 来源、当前消息导航和导出共用该数据。Project Continuity 的来源指向一条消息时，拆分后须确保仍可定位；同一个项目只共享资源、已确认事实和授权范围的话，也不能把另一个会话的草稿、未完成步骤、摘要或临时提示直接发给模型。

推荐的首轮设计是项目内多条独立历史，项目仍只有一个写入所有者。是否允许多个在途执行由产品决定。在结果语义确定之前，可先评估每项目单个实际运行，保证切换会话仍能显示或找回所属运行，避免推出多个同时生效的确认。并行有明确需求时，先定义资源冲突、可见范围与确认路由，用预期 revision 及有明确所有权的结果提交应对。多个工作台标签页继续经项目级 lease 或同等事务保护。项目 ID 不必成为每轮所有缓存、路由和内存 Map 的唯一身份。

建议的数据划分：

| 项目共享 | 会话 / 轮次独有 | 产品决定后选策略 |
|---|---|---|
| 项目、资料/资产、画布、对象和 revisions、已确认决定及其可追溯材料 | 原始消息、草稿、已发送输入、compaction pointer、在途 turn、恢复及 confirmation 的归属 | 跨会话搜索的可见性、摘要保留与失效、未确认结论是否可显式带入、默认 Memory 内容、会话删除时来源如何保留 |
| 资源和写入的权威 identity | UI 提交快照和实际 Provider 请求证据可按所属 session/turn 定位 | 项目级并发限制、本地/远端运行的恢复条件、长任务继续时间 |
| 老项目的真实事实与资产 | 一次性把旧历史和有效摘要导入旧会话，保持 message IDs 与原始引用 | 遗留 frames 是原样证据还是需转译，旧在途动作映射不到新 Session 时的收口策略 |

把默认 Prompt 中的项目记忆、阶段历史和截图上下文当作消费契约重新设计。七类记忆和六类阶段记录的持久投影，当前确实服务于 Records UI、Agent 读工具、默认 Context、Archive/Backup。保留来源、适用范围、当前/历史和显式确认这些语义。新版若只需当前工作摘要，可从权威事实按请求确定性投影，减少持久化当前指针与重复的全文。用户需要看到历史投影时，保留有价值的历史记录。Context window、自动压缩阈值和缓存 frame 的实现要随 Provider 和实际任务测量选择。区分索引用历史、可重建的模型视图和精确恢复请求所需证据。精确恢复仍必须沿原始请求，新的策略不可改写其 payload。暂缓从旧 256k 策略逐个调参数或给新旧两套 frame 做长期兼容。

源码与文档 · src/domain/morpho/types.ts:1143–1191 · conversationCompaction.ts:175,240,302,533 · conversationSearch.ts:41 · projectMemory.ts:24,34,323,1309 · projectArchive.ts:745,991 · src/features/workspace/providerContextFrames.ts:55,124,266 · agentTurnRunner.ts:92,196 · agentTurnRecoveryStore.ts:361,493,833 · useWorkspaceConfirmationController.ts:48,82 · useWorkspaceAgentRuntimeController.ts:149,343,406 · externalResultClient.ts:61。相关提交 · 534cb39、cf7c25b、71f9167、8ae57a6、97dd399。

### 11. 浮动工作台在几何与焦点上的改造，应先于替换 Canvas SDK

tldraw 承担自定义 ShapeUtil、绘制、测量、选择、相机、拖拽与编辑。持久化真值在 Morpho。MorphoCanvas 双向投影形状、相机和阶段，主动忽略投影产生的编辑器历史；P6H 与 P6I 将 Undo、导航和焦点留给 Morpho 合同。独立关系、对象 ID、阶段和布局不会靠视觉位置被推断。AI 面板目前由 WorkspaceClient 嵌在同一壳层，状态、渲染和工具栏的避让还用全局 CSS 与 DOM 几何查询。AI 面板存在多段覆盖，选择工具栏依赖现有 surface 的 DOM 位置。浮动、吸附、全屏、最小化的加入会同时改变层叠、遮挡、快捷键、选区和焦点归属；只在旧固定布局上增 CSS patch 会把这些约束继续分散。

新版可用 Canvas 编辑器做一个工作台子视图。让工作台壳层持有 surface 位置、尺寸、显隐、交互优先级和焦点归属，向画布工具栏提供真实遮挡几何。面板消费 Session 与工作台选择，编辑的项目对象依然通过领域命令。用两个真实交互验证 host 边界。其一是移动面板、缩放画布、选中对象后切换会话，选区和快捷键仍符合所有权。其二是在文档定位或确认打开时折叠/恢复面板，焦点与撤销保持可预测。等 UI/UX 制定后再替换 CSS 和组件。Design System 的六份生产 tokens 与 docs 副本本轮 SHA-256 相同，组件导出是参考。新版应选择一个可构建的 token 真值并限制引用快照的维护次数。没有必要为旧 CSS 做一轮全面拆分后立即重写。

继续用 tldraw 实现首个对照具有最低验证成本。当前 repo 将 NEXT_PUBLIC_TLDRAW_LICENSE_KEY 交给 Tldraw，安装包指向 tldraw 自有许可证。分发方案确定后，按目标许可和具体能力评估是否保留 SDK。换 SDK 的真实成本在选择、测量、相机、剪贴板、拖拽、ShapeUtil 与界面避让，以及对历史视图的兼容。使用小规模代表轨迹比较，不以编辑器抽象层的文件数衡量。

源码与文档 · src/features/workspace/tldraw/MorphoCanvas.tsx:150,532,600,1131,1173,1487,1667 · WorkspaceClient.tsx:2012,2397 · useWorkspaceSurfaceController.ts:88,151,384 · src/app/globals.css:1004,4481,5888,7672,8585 · docs/design/README.md。相关提交 · 744176c、1070123、e51bba1、7508cd5。分发许可的适用范围未核实。

### 12. 把资料读取与交付基础留给新版，等待资料组织方式

导入先持久化原始文件，再生成 FileObject 和本地 Extract。PDF 用 pdf.js 层，PPTX 等用 fflate 的有界解包。抽取的可读性受页数、字符预算、源是否包含文本影响，结果带截断标记。Reader 通过本地资产读取，文档片段、Compare 与 Agent 的 scope/receipt 另行限定哪些内容可入模型。P0 真实修补了“截断被当成完整”和“IndexedDB request success 被当成事务成功”。这一链对项目资料体验及专业判断仍有价值。新版从文件定位到证据的操作方式、何时 OCR/图像观察和是否独立知识检索属于产品决定。现在可共用资产身份、明确的范围读取与结果状态。文档解析、图像准备和工具授权继续各自拥有真实的限制。工具可以回报被读的是原文范围、摘要、图片还是没有内容，搜索或者仅存在文件名不能算完成读取。

源码与文档 · src/features/workspace/workspaceImportExecution.ts:145,227,254–301 · documentReaderRecovery.ts:1 · agentSourceReads.ts · agentToolExecutors.ts:235,285 · src/domain/morpho/documentParsing.ts:92,117,136,201,320,436 · src/infrastructure/assets/indexedDbAssetStore.ts:63。相关提交 · 540d734、e60d64f、363a68c、32db875、04ef4b8。

## 四、精简日常开发与验收入口

### 13. 给现行事实、选型决定与过程证据各留一个可导航入口

现在 runbook 既是安装入口，又包含 B→A+ 多阶段 rollout、历史专项验证脚本、当前 Lab 和 P7 的旧阶段描述。runbook 末尾仍写 P7 未开始，Program Map 聚合处已定为 deferred / incomplete。architecture 开头指向现行实现，正文同时保留 P3B validating 与当时的 acceptance。decisions.md 累加了已经替换的设计。新接手者要先知道哪一条是历史才能找出现在怎样运行。项目根 AGENTS.md 已有简洁的角色分工，还把连续单会话、固定项目流程和当前视觉定为不可妥协。方向说明已授权重审这些规则，仓库根仍缺少一个简单的现行与下一代定位。仓库 CLAUDE.md 只引用 AGENTS.md，已有单源入口可保留。

建议把当前运行方式、图和关键状态所有权各放回单一现役文档。用一个索引链接指向已废弃的事实、接受证据、冻结输入、数据库历史迁移及其生效范围。记录当前程序状态时短链接引用已批准收口，不复制每轮验证细节。AGENTS.md 保留语言、任务授权、项目真值/付费安全和可验证的仓库约定，当前产品细则留给 v3.2 产品索引，下一代方向链接单列。移除“每个任务默认推送”作为不足以单独授权的句式，写清授权优先级，防止 read-only 与历史默认冲突。文档在拥有真实消费者、持久决定或不同使用目标时才需要单独存在。

仓库内 .agents/skills 与 .claude/skills 的 95 个同路径文件逐项同哈希。仓库独有的 neat-freak 一边强调去重，一边要求每个新路由、参数或表在根 Markdown、架构和运维多处记录，并使用不存在于当前布局的 integration-guide / operator-runbook 路径示意。把它缩到当前 canonical map 和真实变更面，不用针对宿主推断并维护另一个未经授权的外部记忆系统。通用 React/composition/design 指南优先按实际宿主的安装和发现方式使用上游，仓库留 Morpho 专属且需要固定版本的内容。两个现用宿主都需本地文件时，从一份源做最小投影，并以新会话实测可发现性再删除重复副本。保留 CLAUDE.md → AGENTS.md 的引用模式。通用 skills 的去重和下一代 Agent 产品 Skill 是两个独立问题。

源码与文档 · AGENTS.md §1–2, §6 · CLAUDE.md:1 · docs/operations/runbook.md:938,1193,1412,1613 · remediation-program-map.md:299,310 · docs/architecture/architecture.md:1101 · decisions.md:28,916,1428 · .agents/skills/neat-freak/SKILL.md 及 references/sync-matrix.md。相关提交 · a0abc30、8e10903、d55062e。

### 14. 保留行为回归，把一次性实验、备用部署与日常门禁分开

CI 默认 Node 24，运行 lint/typecheck/unit/build，另一 job 用 Chromium 和构建后的应用，Cloudflare 备用构建也常驻 CI。Chromium 配置刻意排除 P7 和性能项目，mock Provider 与关闭登录是其真实上下文。P7A 轨迹、P7B 的真路由/临时数据库 fault slice、P7B-2/3 的冻结配置和付费预算是不同类型的证据。P7 聚合未完成，继续维护整个 frozen matrix 作为日常迭代要求收益小。以受支持的行为决定测试位置。保留单写者、局部撤销、稳定身份/引用、备份、真实工具输入、付费 POST/ACK 最小回归。将待复用的 SQL 验证和安全离线故障轨迹归为明确入口。把已收口的 trial coordinator、一次性 guard、冻结资料和逐行结算脚本归入历史证据目录或只保留历史 Git 入口。避免删到当前快速回归、emergency operational scripts 或证据引用。源码快照式结构断言仅保留能观察真实边界的部分。CI 检查与已接受的部署、设计结果和人类验收应仍能区分。

Cloudflare/OpenNext、Wrangler、preserve .next 脚本和专用 job 是有真实运行入口的备用部署，不是“装了但没有引用”。如果项目仍明确要求可热切换，保留构建和运行说明，核对已配置的授权和结果存储边界。若采用本地分发或只维持一个托管入口，退役备用 job、依赖和 runbook 可直接减少矩阵。Next 与 Vercel 可以持续承担当前薄路由和静态壳，无须为 Loop 先迁 UI framework。pdfjs-dist、fflate、Supabase SDK、tldraw 都有上述实际使用方。Provider 回退的旧环境命名与图像下载允许来源要分开看。生成只提交一次后，fallbackBaseUrls 仍被部分恢复路径用作下载主机输入，不能按参数名字一删了之。生产构建与证据构建可用同一实现并按实际需要选 gate，保留证据指纹的正确性。Node 约定应从 README 和 CI 统一，本轮 Node 22 结果只说明这些定点检查可运行。tsconfig.json 匹配整个树的 TypeScript，eslint . 也未显式排除 temp。代码型调查产物有可能影响另一项开发的检查。日常工具按实际源码和活跃脚本定范围，临时复现脚本走自己的入口。

源码与文档 · package.json scripts / dependencies · .github/workflows/quality.yml · playwright.config.ts · vitest.config.ts · tsconfig.json · eslint.config.mjs · scripts/build-production.mjs:15,24 · build-provenance.mjs:16,47 · build-cloudflare.mjs:9 · docs/operations/cloudflare-workers.md · e2e/external-result-delivery.spec.ts:7,102,158 · e2e/indexeddb-transaction.spec.ts:100 · scripts/verify-external-result-delivery.mjs · scripts/p7b-l2-* · docs/operations/p7-aggregate-disposition.md · src/server/image/secureImageDownload.ts:139。相关提交 · bd99ca0、ef8ddd2、a4b388d、8e10903。


## 五、改造优先级与任务组合

| 顺序 | 建议授权的任务 | 依赖、完成判据与边界 |
|---|---|---|
| 先做 | **项目目录故障修复** | 独立于新版。正文已写、目录更新失败、重启且尚有其他项目时仍能找到对应项目，或能明确恢复。验证当前修复、锁顺序和旧样例保护。范围内先处理这一个断点。 |
| 先做，可并行 | **退役已证实的遗留与编制现行入口** | 快照 Undo 和转发模块可直接进入小包。独立 Chat 以外部调用证据为前提。文档与 Skills 收口可并行，删除旧路径时同步更新调用与门禁。历史证据按其现有链接保全。 |
| 第二批 | **可复用的资料读取和项目命令** | 建立一个浏览器与 Lab 都能执行的真实读写轨迹，分别证明工具输入、领域 revision、持久化和撤销归属。优先用已有 Host、Zod 和测试能力。不要先改全仓目录名或所有 adapter。 |
| 与新版设计同步 | **会话所有权、循环和上下文** | 先决定 Session 的数据归属、项目内共享、运行并发和宿主。随后保留旧历史和引用，迁移可编辑快照/备份，按实际需要替换单条生产 Loop。新交互中保留正确暂停和落盘。没有共享规则前不实施 Memory 大改。 |
| 新 UI 定型后 | **工作台壳层、场景导航与生成入口** | Surface 和 Canvas ownership 跟随 UI/UX，提交/选择/工具范围接上同一项目 API。生图入口能否合并由产品交互和两条现行恢复链决定。旧视觉系统只做必要维护。 |
| 明确分发后 | **本地存储后端与托管拓扑** | 浏览器主宿主可评估事务化项目库。本地 Node 宿主评估其现成事务与迁移。保留备份/恢复、结果身份与安全边界。届时决定 Cloudflare 备用、Supabase 额度/Journal 拆分、SDK 许可和依赖。 |

**应延续的保证。** Canvas 布局与语义分离。Hide、Delete、Eliminate 有各自的作用。每次成功生成有独立身份和可追溯 lineage。旧默认参考变更不改写已冻结结果。高影响写入由用户授权、对象及 revision 校验和事务保证。保留原始会话与资料，派生视图有明确来源和范围。已执行、已交付、已持久化三种事实可分别取得。同一付费请求运行不明时不盲目重发，原结果可在实际存续期内沿原身份取回，浏览器提交成功后才 ACK。

最有价值的替换证明是一条从 **选中资料 → 实际读取 → 工具返回模型 → 产物待确认 → 关闭重开 → 用户确认写入** 的路径。用它衡量能删掉的运行时职责与剩下的数据保护。专业方法与视觉表现继续由负责人按真实设计任务决定。
