# 附录 C：文档体系、`AGENTS.md` 与仓库内 Skills 审查

> 所属报告：[Morpho 下一阶段工程适用性审查报告](./report.md)
> 审查基线：`main` @ `d55062e7fcdc5dfe0f12b08e43523bee7223dac6`（2026-11-19）

## 1. `docs/` 200 文件（76,325 原始行）结构与噪音占比

| 类别 | 文件数 | 近似行数 | 占比 | 现状判断 |
|---|---:|---:|---:|---|
| 提交入库的原始 JSON 证据与性能快照（`docs/operations/*.json`、`p7a-evidence/`） | 11 | **~48,800+** | **~64%** | 机器生成的一次性验收/基准转储，直接塞在 `docs/operations/` 中，极大污染全文检索与 Coding Agent 上下文 |
| 历史产品 v1/v2、旧设计归档、探索稿、12 份整改审计原稿 | 19 | ~9,500 | ~12.5% | 有历史备查价值，但不应与活跃入口平级混放 |
| 现行 canonical 工程与运维文档（`architecture.md` 1,270 L、`decisions.md` 1,434 L、`runbook.md` 1,614 L、`agent-runtime-a-plus-migration.md` 1,203 L、`remediation-program-map.md` 711 L 等） | 8 | ~6,500 | ~8.5% | **严重追加式膨胀、历史与现状混杂、多处内部状态过时或标题破损** |
| v3.2 产品规范组（`docs/product/00–05` + 索引 + `next-generation-direction.md`） | 8 | ~3,200 | ~4.2% | 现行 v3.2 产品定义清晰，但与下一代方向存在明确分歧，需在入口清晰分层 |
| 历史 M4–M9 里程碑文档 & 旧能力/性能报告（`docs/architecture/m4-*..m9-*` 等） | 18 | ~2,500 | ~3.3% | 全部已过时（仍含 MiMo、lane、checkpoint、`/api/ai/chat` 描述），留在 `docs/architecture/` 根目录下仅靠 `README.md` 免责提醒 |
| Claude Design 导出参考包（`docs/design/design-system/`） | **115** | ~4,800 | ~6.3% | 含 102 个不参与构建的组件模板；`tokens/*.css` 要求人工与 `src/design-system/tokens/` 双份同步 |
| 其他研究/P7 说明/索引 | 21 | ~1,000 | ~1.3% | `p7b-1/2/3.md`、`p7a-*.md` 等已收口实验记录 |

## 2. Canonical 文档具体漂移、矛盾与认知障碍证据

| 文件与行号 | 实证问题 | 对新工程师 / Coding Agent 的实际危害 |
|---|---|---|
| `README.md:11-38, 99-108, 157-166` | ① 首页充斥大段合规/审计式免责声明（“不宣称生产环境已部署该合同……”）；② 中英文在 101–108 行突然切换；③ 写死 `schemaVersion: 18`、`incarnationId`、`3dcbbe989dc...` 历史验收 SHA；④ “官方示例项目”块写着 `测试 / 从一句话、图片、文件或链接开始`（暴露案例标题未清理）。 | 新人第一屏看不到“项目架构怎么跑、核心目录在哪”，却先被塞满历史整改免责术语。 |
| `docs/architecture/architecture.md:518, 1101` | ① L518 标题仍为 `## Schema v17 AI Continuity, Memory, And Key Conclusions`（实际已是 Schema 18）；② L1101 仍标 `## P3B Result Delivery / Hosting Contract (2026-10-02; validating)`（已验收收口）；③ 后半段按 P5 / P1B-2 / P6H / P6I / P2B / P3A / P3B / P4 乱序追加，不是按系统模块组织。 | Agent 无法从目录结构快速建立系统心智模型，读一半不知道哪段是现行合同、哪段是过时补丁。 |
| `docs/operations/runbook.md:583, 938-1190, 1262-1331, 1412` | ① L583 仍写 `agent v3.6 / compaction v3 / image prompt v3`（实际已是 `v3.8` / `v4`）；② L1412 仍标 `P3B (validating)`；③ L938–1190 保留 250+ 行已永久完成且禁止重跑的 2026-07 A+ Phase A/B/C 与 B-proof 删除操作步骤；④ L1262/1296/1308/1331 出现 4 个破损顶层 `# ` H1 标题。 | 真正的日常运行与排障命令被淹没在 1,300+ 行一次性历史发布流程里。 |
| `docs/architecture/decisions.md:3-1430` | ① 开头把 2026-08-14 F06 塞在 2026-06-23 之前，时间序错乱；② 90+ 条 ADR 混杂大量已推翻决策（MiMo 聊天/视觉/联网、Schema v2–v17、Runtime B Leases、`nano-banana-fast` 默认模型等），无清晰的 Active vs Superseded 物理分层。 | Agent grep 关键词时极易读到已废弃 ADR 并误当成当前约束。 |
| `docs/operations/remediation-program-map.md:91` | 单一 Markdown 表格单元格被追加成 **4,000+ 字的单行日志墙**（记录 P7B-1 D1–D6 每次 rerun SHA、hash 数、网页复审记录）。且整套 14 包整改主线已基本完成或 deferred，但 `AGENTS.md` 仍将其列为日常必读入口之一。 | 既无法作为路线图阅读，又给新 Agent 制造“14 包整改正在进行中”的错误预期。 |
| `docs/architecture/README.md:48-80` | 18 份已废弃的 M3–M9 里程碑文档仍平铺在 `docs/architecture/` 根目录，仅靠 README 写警告“不要抄里面的旧路由”。 | 文件路径本身没有区分 `current/` 与 `archive/`，对不先读 README 直接检索文件的 Coding Agent 极不友好。 |

## 3. `AGENTS.md` 与 `docs/product/next-generation-direction.md` 的冲突矩阵

`AGENTS.md`（当前 8,096 B，并由 `CLAUDE.md` `@AGENTS.md` 共享）在下一代开发启动前存在多处**与新方向直接冲突**或**历史/环境硬编码**条款：

| `AGENTS.md` 现有条款 | 冲突点 / 问题 | 建议调整方向（待整改时执行） |
|---|---|---|
| §1 必读索引仅列 v3.2、`design-system`、`remediation-program-map.md`，**未提及 `next-generation-direction.md`** | 新接入的任何 Coding Agent 都会默认按 v3.2 永久规范行事，误以为正在推进旧 P0–P7 整改。 | 将“当前运行基线（v3.2）”与“下一代演进过渡边界”在入口明确分栏，并把已结束的 Remediation Program Map 移出日常必读。 |
| §2 `"Keep one continuous AI conversation surface"` | 直接冲突于 `next-generation-direction.md` §4.2（项目内多会话）。 | 改为区分“现行 v3.2 行为（在产品重构前保持）”与“非永久约束，后续按新规格替换”。 |
| §2 `"Do not expose project-memory files, stage-record internals, Context frames..."` | 七类记忆、阶段记录和 Context 策略本身在 §4.2 已列为待重新评估项。 | 保留本质安全/隐私红线（不暴露密钥、系统 Prompt 内部实现、原始 Provider payload），不要把待重评的 v3.2 内部数据结构写成永久铁律。 |
| §4 `"Follow docs/design/design-system/docs/DESIGN-SYSTEM.md"`, `"Preserve a warm, calm, light-mode..."` | 直接冲突于 `next-generation-direction.md` §4.1 & §4.3（整体重设计 UI/UX、灵活浮动/吸附/半屏/全屏聊天界面与新 Design System）。 | 标明现行视觉规范仅适用于维护现有 v3.2 页面，不约束下一代 UI/UX 探索。 |
| §6 强制规定 `"By default, use D:\Morpho"`, `"Additional worktrees belong under D:\Morpho-Worktrees\..."` 且默认每个完成任务必须 push 并合并 `main` | ① 把单台 Windows 机器的绝对盘符路径写进了仓库级 `AGENTS.md`；② “默认必须 commit/push”与只读评审、本地实验或 PR 协作容易冲突（本轮 Prompt 不得不专门声明覆盖旧规则）。 | 移除绝对盘符路径（改相对约定或迁至个人本地规则）；明确“仅在任务授权提交/推送时执行”。 |
| 全局风格 | 多处规则是对过去单一模型踩坑的防御性补丁（例如禁止把临时 Plan 放进 `docs/`、禁止创建空规划文档、禁止用 `.codex` 建 worktree 等）。 | 精简至 1 页内（≤120 行）高信噪比硬约束：架构分层、安全/付费红线、验证命令、Git 安全边界、权威文档指针表——让任意模型（Claude/Codex/Gemini 等）30 秒读懂且不依赖历史上下文。 |

## 4. `.agents/`、`.claude/` 与 `.codex/` 配置冗余与外项目污染

| 位置 | 实测状态 | 问题与建议 |
|---|---|---|
| `.agents/skills/` vs `.claude/skills/` | 两者各含 **95 个文件（10,651 原始行）**，SHA-256 逐文件比对：**95/95 完全一致，0 差异**（`.claude/` 仅多一个 12 行的 `launch.json`）。 | 仓库内保存了 190 个重复跟踪文件（21,302 行）的第三方通用 Skills（`composition-patterns`、`frontend-design`、`react-best-practices`、`web-design-guidelines`、`neat-freak`）。其中前四个属于通用外部规则包，多平台 Agent 通常已全局内置或可按需引用，在仓库内双份拷贝只增加噪声和同步负担。 |
| `.agents/skills/neat-freak/SKILL.md`（及 `.claude/` 镜像） | L62–66 仍残留外项目文本：`"Prisma 查询只写在 modules/**/data/"`、`"禁止裸跑 systemctl stop aihot-worker"`、`"2026-04-30 起公网开放，匿名可访 /、/all"`、`"下游项目的同事"`、`docs/integration-guide.md`、`docs/CHANGES.md`、`~/.claude/projects/<...>/memory/`。 | 未完成 Morpho 本地化适配的跨项目搬运技能；且其强推 `CLAUDE.md` 写全量路由/环境变量/数据表清单，与 Morpho 精简 `AGENTS.md` 的方向相悖。建议去重（只留单份或迁出仓库级全局 Skill）并清理外项目残留。 |
| `.codex/` | 目录存在但 0 个 Git 跟踪文件（含 3 个本地未跟踪项）。 | 属本地工具目录，保持 `.gitignore` 或确认无需入库即可。 |
