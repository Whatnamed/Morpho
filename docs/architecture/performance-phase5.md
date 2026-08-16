# Morpho Performance Phase 5 — 真实交互延迟图谱与证据驱动优化

本文件是 Phase 5 的裁决记录：哪些操作真的让用户觉得慢、慢在哪一段、哪些已修、修前修后数字是多少、哪些没有证据所以没动。机器数据在 [`performance-phase5.generated.json`](../operations/performance-phase5.generated.json)，Node 侧同机校准数据在 [`performance-node.generated.json`](../operations/performance-node.generated.json)。

- Baseline SHA：`204857b`（origin/main，任务开始时）
- 采集机器：12th Gen Intel Core i5-12400 · 16 GB · Windows 10 (26200) · Node v22.23.2 · Chromium（Playwright 1.62，Desktop Chrome 1440×900）
- 生产构建（非 dev）。插桩全部由测试注入（`e2e/fixtures/perfProbe.ts` 可选 IO 归因 + 首反馈追踪），产品代码零遥测。
- Node 侧校准负载 p50：2.44 ms（`JSON.stringify(caseStudy)`），本轮所有 Node 数字与本报告浏览器数字均为该机实测。

## 测量方法与语义

- **首反馈**（First Feedback）= 页内输入事件时间（pointerdown/keydown/change/paste，`performance.now()`）到操作根节点第一个 DOM 变化。不含 CDP 往返。
- **阻塞**（Blocking）= Long Animation Frame 的 `blockingDuration`；**慢事件 p95** 只含 ≥16ms 事件（Event Timing 规范下限），是尾部而非全部输入。
- **React commit** 数与时间戳来自注入的 DevTools hook。
- **IO 归因**（可选启用）：localStorage 读写、IndexedDB 每操作时长、object URL 创建计数，均为浏览器 API 补丁，产品代码零改动。
- Agent 走 mock SSE（生产编码器产出的真实帧 + 完整 Coordinator/reducer/落库路径），隔离 client 段成本；**provider 网络/TTFT 不在本图谱内**。
- 夹具：objects500 / chatLong(560 消息) / caseStudy(184 消息) / switchA/B / importBase 无图片二进制（与 4A 可比）；assets10/30/80 带真实再生命周期 PNG（确定性 PRNG + OffscreenCanvas，写入真实 IndexedDB BlobStore）；PDF(30/150 页)/PPTX(40 页)/PNG/文本由 Node 现场生成，不入库。
- 采样规则沿用 4A 可信门；浏览器交互项为单轮完整操作窗口（含 settle），关键字段在两轮 after 对照中复现才用于裁决优化。

## 一、Latency Atlas（优化前，baseline `204857b`）

完整数据见 generated JSON。`—` 表示该操作无单一输入事件（如装载）或不适用。

| 交互 | 规模 | 首反馈 | 慢事件 p95 | 最长阻塞 | 主要成本归属 |
|---|---|---:|---:|---:|---|
| 打开大项目（load） | 500 对象 | —（首个 shape 572–610ms） | 0 | 132–161ms | parse(同机 44.4ms) + 首渲染 + tldraw 挂载 |
| 大项目返回列表 | 500 对象 | 11ms | 1.8ms | 0 | 卸载 + 首页渲染，无热点 |
| 列表打开项目 B | 60 对象 | — | 0.4ms | 3–9ms | 客户端路由 + 装载 |
| URL 直切 B→A | 60 对象 | — | 0 | 0–2ms | 整页装载 |
| 连续选择 ×20 | 500 对象 | — | 3.6–16ms | 0–8 | 快，无热点 |
| 高频拖动 60 步 | 500 对象 | — | 14.8–19.9ms | 0 | 与 4C 结论一致，帧预算边缘 |
| 框选 | 500 对象 | — | 13.7–18.7ms | 0 | 同上 |
| 全选 Ctrl+A | 500 对象 | — | 89–126ms | 47–86ms | **热点 3**：500 选中全树重渲染 |
| pan（中键拖动） | 500 对象 | — | 9.3–14.2ms | 0 | 无热点 |
| zoom（单次/连续） | 500 对象 | — | 0.1–0.6ms | 0 | 无热点 |
| 粘贴新增文本对象 | 500 对象 | 57–63ms | 0 | 0–19 | **热点 4**：commit 链 + shape 挂载滞后 |
| 删除对象（Delete） | 500 对象 | 38–42ms | 17–25ms | 0–4 | 同类提交链 |
| 工具栏隐藏对象 | 500 对象 | 30–34ms | 1–4ms | 0 | 同类提交链 |
| 输入打字 45 字 | 46/184/560 消息 | — | 4–10ms | 0（chatLong 24ms） | 每 2 commit/字符；量小可感知度低 |
| 发送并流式（46 msg） | 100 对象 | 53ms | 55ms | 5ms | **热点 5**：journal POST 前的恢复加载+prepare |
| 发送并流式（184 msg） | 42 对象 | 53ms | 55ms | 5ms | 同上 |
| 发送并流式（560 msg） | 40 对象 | 50ms | 51ms | **70ms** / 累计 **368ms** | **热点 2**：每批次全列表协调 |
| 工具回合→续接请求 | 46/184/560 msg | 32–55ms | 33–56ms | 0–6 | 560 msg 时请求间隔 **454ms** |
| 翻旧消息继续流式 | 全档 | — | — | — | 语义保持：未被拉回底部（全部档位通过） |
| 带真实图片打开 | 10/30/80 张 | 首个 shape 356–425ms | 0 | 24–60ms | IDB 读 + URL 创建 + 解码；图片在首 shape 后 54–160ms 全部落定 |
| 资产抽屉首开/重开 | 80 张 | 18ms / 10ms | 13–17ms / 0.4ms | 0 | 渲染体积，非 IO |
| 选中图片出详情栏 | 80 张 | 13–15ms | 0 | 0 | 无热点 |
| 导入 PNG/PDF/PPTX/混合 | ≤150 页 | 34–83ms | 0–1ms | **0** | 解析在 pdf.js worker / 预算化解压内，**主线程无长帧** |
| 搜索抽屉/查询 | 184 msg | 7ms | 0–6ms | 0 | 无热点 |
| 项目记录抽屉首开 | 184 msg | **68–71ms** | 68–77ms | 21–30ms | **热点 6**：渲染体积（域计算仅 2ms） |
| 交付准备面板打开 | 184 msg | 6–9ms | 5–7ms | 0 | 无热点 |
| 归档面板打开 | 内置案例 | — | 3–5ms | 0 | 无热点 |
| 导出可编辑备份（zip） | 内置案例 | — | 27–34ms | 0 | wall ~1.08s，无长帧（包小） |
| 导出人读归档（zip） | 内置案例 | — | 5ms | **890ms** | **热点 1**：zipSync 全量二进制主线程压缩 |
| 删除项目预览 | 内置案例 | 15–18ms | 0.3ms | 20–47ms | 可接受 |

## 二、确认的热点与归因

### 热点 1：人读归档导出冻结 890ms
- 症状：点击「导出归档」后页面冻结近 1 秒。
- 证据：before 轮 `archiveExportHumanZip` 最长阻塞 889.9ms，单帧；commit 在 +921ms 才恢复。可编辑备份（包小）同路径 0 长帧，锁定变量是**二进制体量**。
- 根因：`projectBundleClient.ts` 的 `bundleToZipFile` 用 fflate `zipSync` 在主线程压缩全部可读资产（人读归档嵌入每一份本地二进制）。
- 代码：`src/features/archive/projectBundleClient.ts`（两个导出共用该函数）。

### 热点 2：长聊天流式累计阻塞 368ms + 工具间隔 454ms
- 症状：560 消息项目里流式输出期间页面持续卡顿；工具执行后停顿明显。
- 证据：chatLong `sendAndStream` 最长阻塞 70.3ms、累计 368.4ms；`toolCallTurn` 请求间隔 454.3ms。Node 侧 `renderConversation`/`renderConversation:streamTick`（新增目标）p50 均 ≈31.2–31.9ms：**SSR 全量上限约 31ms/批次**；浏览器实测批次均值 ≈12–15ms（4C-2 的内容 memo 生效后剩余的协调成本）。
- 根因：每个 48ms 批次 `AiConversationPanel` 重新 map 全部 560 条消息包装元素（内容子树有 memo，包装层没有）；工具回合结束/续接前的 UI 提交同样付这笔成本。
- 代码：`src/features/workspace/components/AiConversationPanel.tsx`（消息列表映射）。

### 热点 3：全选 Ctrl+A 阻塞 47–86ms、事件 p95 89–126ms
- 归因：`selectAllCanvasObjects` 写 `ui.lastSelectionIds`（500 项）→ workspace 身份变化 → 整树重渲染（含 500 选中的详情/工具栏/选中态），随后 tldraw `select(500)`。commit 在输入后 +93ms。
- 未修：见「明确放弃」。

### 热点 4：粘贴/导入首反馈 51–83ms、shape 落地滞后
- 归因（提交时间戳）：输入 → +16ms flushSync 工作区 commit →（效应链）→ +63ms 首个 DOM 变化 → +89ms shape 可见。React commit 与 tldraw 挂载之间的效应链约 70ms。
- 未修：见「明确放弃」。

### 热点 5：发送首反馈 42–70ms（全部档位）
- 归因（fetch 时间戳）：Enter → journal POST `/turns` 间隔 ≈ +50ms，且用户消息 commit 在 POST 之后（`agentTurnRunner.ts:141` `persistInitialWorkspace` 在 `prepareAgentTurnProductAPlus` + `coordinator.initialize` 之后）。50ms 全部花在恢复存储加载 + 回合准备（O(messages) 上下文构建）。
- 未修：见「明确放弃」（语义风险）。

### 热点 6：项目记录抽屉首开 68–71ms
- 归因：Node 直测 `reconcileProjectMemory(resolveContinuityValidity(ws))` caseStudy 仅 2.08ms（compound500 5.90ms）、`classifyDecisionRecords` 0.01ms —— **域计算不是成本**；66ms 是抽屉大量 DOM 节点首渲染 + 整树重渲染（commit 在输入后 +67ms）。
- 未修：见「明确放弃」。

## 三、已实施的优化

### 3.1 归档导出 zip 移出主线程（热点 1）
- 之前：`zipSync` 在主线程压缩，人读归档单帧冻结 890ms。
- 实现：`bundleToZipFile` 改用 fflate 异步 `zip`（浏览器内分派到 Worker；同库、同 level 6、同产物；Node/测试环境自动回退主线程）。非 Bundle Pipeline v2 重构，仅换入口。
- 为什么安全：产物仍是合法 zip（既有解压回环与恢复验收测试通过，包括「导出可编辑备份后恢复成独立项目副本」）；失败路径仍走原 `blocked/failed` 分支。
- Before / After（同机同夹具，内置案例，两轮 after 一致）：

| 指标 | Before | After | Delta |
|---|---:|---:|---:|
| 人读归档 最长阻塞 | 889.9ms | 63.3 / 70.6ms | **−92%** |
| 人读归档 wall | 971.7ms | 755.5 / 752.9ms | −23% |
| 可编辑备份 wall | 1075.7ms | 806.8 / 781.7ms | −27% |
| 可编辑备份 最长阻塞 | 0.0ms | 83.6 / 85.0ms | +85ms（见下） |

- 诚实记录：备份导出（小包）阻塞 0→~85ms —— 异步路径的字节汇集/Worker 装配集中在单帧；换来的是 wall −27% 与人读归档 −92% 阻塞，显式导出动作下净收益明确，保留。

### 3.2 长聊天历史段渲染隔离（热点 2）
- 之前：每个流式批次重新协调全部 560 条消息的包装元素。
- 实现：消息列表拆为 memo 化 `AiMessageHistory`（`messages.slice(0, -1)`）+ 尾条内联渲染。比较器逐元素引用比较 + 行读取的记录身份（`objects`/`citationSnapshots`/`ai.comparisonAnalyses`）+ 回调身份；任何历史消息或记录变化都会整体重渲染，**不改变任何可见性/滚动/锚点语义**（不是窗口化，历史仍完整挂载）。
- 为什么安全：新增守卫测试钉住双向（跳过与回退：`AiConversationPanel.historyMemo.dom.test.ts` 5 项，含历史消息引用快照出现、流式尾更新、行锚点保持）；全套 1963 项单测 + 19 项验收 e2e 通过；「翻旧消息不被拉回」在全部档位复测通过。
- Before / After（chatLong，两轮 after 一致）：

| 指标 | Before | After | Delta |
|---|---:|---:|---:|
| 流式 最长阻塞 | 70.3ms | 22.0 / 13.3ms | −69%～−81% |
| 流式 累计阻塞 | 368.4ms | 72.5 / 92.7ms | **−75%～−80%** |
| 发送首反馈 | 49.7ms | 34.7 / 38ms | −24%～−30% |
| 工具→续接间隔 | 454.3ms | 227.4 / 230.1ms | **−50%** |
| 打字阻塞（chatLong） | 24.2ms | 10.5 / 0ms | 消除 |

caseStudy / objects500 档位同向（caseStudy 流式阻塞 5.4→0；objects500 20.5→13–15）。Node `renderConversation:streamTick`（SSR 上限 ≈31ms/批次）作为归因目标保留，SSR 按构造看不到 memo 命中，**不得**用它裁决本优化。

## 四、明确放弃的优化（有归因、不动手）

1. **全选渲染隔离（热点 3）**：成本在 500 选中的整树渲染 + tldraw select(500) + 工具栏/详情栏。全选是低频显式操作；把选中态从 workspace 身份链里拆出来属于结构性改动，收益/风险比不成立。留作 backlog。
2. **粘贴→shape 落地效应链（热点 4）**：React commit 到 tldraw shape 挂载间 ~70ms 是「workspace → effect → editor.run → tldraw 渲染」的架构顺序。压缩它需要改 canvas 同步模型（AGENTS.md 禁止建立第二套 canvas truth）。不动。
3. **发送乐观消息提前 commit（热点 5）**：用户消息目前落在 prepare + journal 创建之后；提前提交会改变失败路径（prepare 失败需回滚已上屏消息）。这正是「Agent request/context/cache latency」后续任务的核心，本任务不冒险。
4. **记录抽屉域计算 memo 化（热点 6）**：实测链路仅 2ms，不是那 66ms 的来源；单独 memo 无可证实收益，不留。
5. **历史消息虚拟化**：任务规定非默认答案；更小的渲染隔离（3.2）已把流式阻塞压回帧预算内，虚拟化的七个语义前提无需承担。
6. **交付输出 zipSync→异步**：与人读归档同模式（`deliveryOutputClient.ts:144`），但本轮未测量到该路径的长帧证据，无证据不动；若后续测量出现，3.1 的改法可直接复用。
7. **持久化**：仍未是瓶颈（装载期同步写 12.6ms、去抖写无长帧），不动（与 4A/4C 结论一致）。

## 五、行为安全确认

- **Agent 语义**：mock SSE 全链路（流式、工具调用→本地执行→续接、取消、失败、恢复）复测通过；`agent-turn.spec.ts` 全部通过；批次 commit 数 after 轮 31–32，与 before 一致（未改 batching contract）。
- **workspace 语义**：历史段隔离不改变消息数据、DOM 输出或滚动语义；比较器对任何记录变化回退全量渲染（守卫测试钉住）。
- **canvas**：未触碰 tldraw 状态模型与同步门。
- **持久化 / 备份格式**：zip 算法与 level 不变，恢复验收（含恢复成新副本）通过；`persistence.spec.ts` 全部通过。
- **项目切换 / stale-session**：生命周期测试与验收套件通过。
- **图片 provenance / DeliveryReference / Compare**：未改动相关代码路径。

## 六、验证记录（真实执行）

| 命令 | 结果 |
|---|---|
| `npm run lint` | 通过 |
| `npm run typecheck` | 通过（0 错误） |
| `npm test`（vitest） | **215 文件 / 1963 项全部通过**（含新增 5 项守卫） |
| `npm run build` | 通过 |
| `playwright test --project=chromium` | **19/19 通过**（canvas、workspace、AI、持久化、项目打开、存储容量、导入恢复链路） |
| `npm run measure:perf5:browser` | 10/10 通过；before 1 轮 + after 2 轮完整对照 |
| `npm run measure:perf` | 通过（含新增 streamTick 目标；个别样本按可信门标记不可信，未引用） |

## 七、遗留性能债（仅列有证据项）

1. objects500 首开最长阻塞 125–161ms（parse 44ms + 首渲染 + 挂载；4A 起已知，改善需装载分段）。
2. 全选 39–86ms 阻塞（500 选中整树渲染）。
3. 发送首反馈 34–62ms：恢复加载 + O(messages) prepare 在 journal POST 前（长聊天工具间隔仍有 ~230ms）。
4. 记录抽屉首开 ~70ms（DOM 渲染体积）。
5. 粘贴/导入 shape 落地比 commit 慢 ~70ms（canvas 同步效应链）。
6. 每字符 2 个 React commit（打字 p95 4–7ms，暂无用户可感知证据）。
7. 流结束后建议 chips 出现而不触发滚动效应，`pinnedToBottom` 读数 false（化妆性问题，先验证再动）。
8. 备份导出阻塞 ~85ms（3.1 的权衡，已记录）。

## 八、后续任务裁决

### A. Project Bundle Pipeline v2 — **DEFER**
证据：最尖锐症状（人读归档 890ms 冻结）已由 3.1 以最小改动消除（63–71ms）；两导出 wall −23%～−27%；恢复链路完好。剩余：整体缓冲模式（≤128MiB 上限）仍在内存内装配、备份导出 ~85ms 单帧、交付输出仍是 zipSync（无测量证据）。这些是真实但低频、显式动作下的可接受成本；架构级 streaming/Worker 管线当前收益不抵风险。触发重评条件：交付输出或更大项目实测再现 >300ms 冻结。

### B. Document Parsing Worker — **NO EVIDENCE**
证据：150 页 PDF、40 页 PPTX、混合批次导入全程 **0 长帧**（pdf.js 已走 worker、PPTX 解压有预算看门狗）；首反馈 34–83ms、对象落地 +31–90ms。当前文档解析没有可归因的主线程阻塞。除非未来出现解析期 LoAF 证据，否则不做 Worker 化。

### C. Agent request/context/cache latency — **PROCEED**
证据：全部档位发送首反馈 34–62ms，其中 ~50ms 在 journal POST 之前（恢复存储加载 + O(messages) 回合准备，560 消息时工具→续接间隔优化后仍 ~230ms）。这是每次发送都付的、用户直接感知的客户端成本，且已有明确分段归因（fetch 时间戳 + commit 时间戳）。建议下一任务：a) 乐观用户消息先于 prepare 提交（含失败回滚语义设计）；b) prepare 内 token 估算/上下文构建的增量化；c) prompt cache 命中率观测（本任务未触网络段）。

## 九、如何复现

```powershell
npm run build
npm run measure:perf5:browser   # 浏览器交互图谱（perf5 project，--workers=1 --retries=0）
npm run measure:perf            # Node 侧目标 + 校准
npm run measure:perf -- --target=renderConversation:streamTick   # 单项目隔离
```
