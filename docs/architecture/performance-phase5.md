# Morpho Performance Phase 5 — 真实交互延迟图谱与证据驱动优化

本文件是 Phase 5 的裁决记录：哪些操作真的让用户觉得慢、慢在哪一段、哪些已修、修前修后数字是多少、哪些没有证据所以没动。机器数据在 [`docs/operations/performance-phase5.generated.json`](../operations/performance-phase5.generated.json)（浏览器交互图谱）、[`docs/operations/performance-zip-crossover.generated.json`](../operations/performance-zip-crossover.generated.json)（ZIP crossover）与 [`docs/operations/performance-node.generated.json`](../operations/performance-node.generated.json)（Node 侧目标与校准）。

- Baseline SHA：`204857b`（origin/main，任务开始时）
- **Measured code SHA：`1b6b61b`**（生成产物中 `measuredCodeCommit` 字段；两处 `gitCommit`/`measuredCodeCommit` 均指被测代码提交，不等于收录该产物的证据提交——后者是更晚的、包含本文件与生成产物的 evidence commit）
- 采集机器：12th Gen Intel Core i5-12400 · 16 GB · Windows 10 (26200) · Node v22.23.2 · Chromium（Playwright 1.62，Desktop Chrome 1440×900）
- 生产构建（非 dev）。插桩全部由测试注入（`e2e/fixtures/perfProbe.ts` 可选 IO 归因 + 首反馈追踪），产品代码零遥测；render-isolation 计数器只在 `NODE_ENV === "test"` 分支存在，生产包中已消除。
- Node 侧校准负载 p50：2.55 ms（`JSON.stringify(caseStudy)`）；本轮 Node 目标产物未通过 trusted gate，因此不引用其不可信目标数字。

## 测量方法与语义

- **首反馈**（First Feedback）= 页内输入事件时间（pointerdown/keydown/change/paste，`performance.now()`）到操作根节点第一个 DOM 变化。不含 CDP 往返。
- **阻塞**（Blocking）= Long Animation Frame 的 `blockingDuration`；**慢事件 p95** 只含 ≥16ms 事件（Event Timing 规范下限），是尾部而非全部输入。
- **React commit** 数与时间戳来自注入的 DevTools hook。
- **IO 归因**（可选启用）：localStorage 读写、IndexedDB 每操作时长、object URL 创建计数，均为浏览器 API 补丁，产品代码零改动。
- Agent 走 mock SSE（生产编码器产出的真实帧 + 完整 Coordinator/reducer/落库路径），隔离 client 段成本；**provider 网络/TTFT 不在本图谱内**。
- 夹具：objects500 / chatLong(560 消息) / caseStudy(184 消息) / switchA/B / importBase 无图片二进制（与 4A 可比）；assets10/30/80 带真实再生命周期 PNG（确定性 PRNG + OffscreenCanvas，写入真实 IndexedDB BlobStore）；PDF(30/150 页)/PPTX(40 页)/PNG/文本由 Node 现场生成，不入库。
- 采样规则沿用 4A 可信门；浏览器交互项为单轮完整操作窗口（含 settle），关键字段在多轮对照中复现才用于裁决优化。Node 侧未过可信门的样本标记为不可信且不被引用（本轮 chatLong/compound500 的 renderConversation 尾部 GC 噪声即属此类）。

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
| 发送并流式（46/184/560 msg） | — | 50–53ms | 51–55ms | 5ms（560msg：**70ms** / 累计 **368ms**） | **热点 5**：journal POST 前的恢复加载+prepare；**热点 2**：每批次全列表协调 |
| 工具回合→续接请求 | 46/184/560 msg | 32–55ms | 33–56ms | 0–6 | 560 msg 时请求间隔 **454ms** |
| 翻旧消息继续流式 | 全档 | — | — | — | 语义保持：未被拉回底部（全部档位通过） |
| 带真实图片打开 | 10/30/80 张 | 首个 shape 356–425ms | 0 | 24–60ms | IDB 读 + URL 创建 + 解码；图片在首 shape 后 54–160ms 全部落定 |
| 资产抽屉首开/重开 | 80 张 | 18ms / 10ms | 13–17ms / 0.4ms | 0 | 渲染体积，非 IO |
| 选中图片出详情栏 | 80 张 | 13–15ms | 0 | 0 | 无热点 |
| 导入 PNG/PDF/PPTX/混合 | ≤150 页 | 34–83ms | 0–1ms | **0** | 见「八-B」对解析路径的准确表述 |
| 搜索抽屉/查询 | 184 msg | 7ms | 0–6ms | 0 | 无热点 |
| 项目记录抽屉首开 | 184 msg | **68–71ms** | 68–77ms | 21–30ms | **热点 6**：浏览器证据指向 DOM 渲染体积（Node 域计算数字不引用） |
| 交付准备面板打开 | 184 msg | 6–9ms | 5–7ms | 0 | 无热点 |
| 归档面板打开 | 内置案例 | — | 3–5ms | 0 | 无热点 |
| 导出可编辑备份（zip） | 内置案例 | — | 46.9ms | **136.6ms** | wall ~1.59s |
| 导出人读归档（zip） | 内置案例 | — | 8.8ms | **103.4ms**（原始同步 proxy 890ms） | **热点 1**：zipSync 全量二进制主线程压缩 |
| 删除项目预览 | 内置案例 | 15–18ms | 0.3ms | 20–47ms | 可接受 |

## 二、确认的热点与归因

### 热点 1：人读归档导出冻结 890ms（原始基线）
- 症状：点击「导出归档」后页面冻结近 1 秒。
- 证据：before 轮 `archiveExportHumanZip` 最长阻塞 889.9ms，单帧；commit 在 +921ms 才恢复。这里的 **890ms 是原始同步人读归档基线**，不是当前人读归档的实测值；由于它与完整备份共享同一批主要二进制负载，后文将它作为 full-backup 同步压缩成本的 proxy，而不是把两种导出当作同一操作。
- 根因：`projectBundleClient.ts` 的 `bundleToZipFile` 用 fflate `zipSync` 在主线程压缩全部可读资产。内置案例 `public/case-study/current/assets` 共 **40 MiB / 26 个文件**，人读归档嵌入每一份。

### 热点 2：长聊天流式累计阻塞 368ms + 工具间隔 454ms
- 证据：chatLong `sendAndStream` 最长阻塞 70.3ms、累计 368.4ms；`toolCallTurn` 请求间隔 454.3ms。Node 侧本轮目标测量未通过 trusted gate，因此不引用任何 `renderConversation` 目标数字；浏览器证据足以确认流式列表协调是热点。
- 根因：每个 48ms 批次 `AiConversationPanel` 重新 map 全部 560 条消息（4C-2 只 memo 了内容子树，包装层每批次重建）。

### 热点 3：全选 Ctrl+A 阻塞 47–86ms、事件 p95 89–126ms
- 归因：`selectAllCanvasObjects` 写 `ui.lastSelectionIds`（500 项）→ workspace 身份变化 → 整树重渲染 + tldraw `select(500)`。未修（见「四」）。

### 热点 4：粘贴/导入首反馈 51–83ms、shape 落地滞后
- 归因（提交时间戳）：输入 → +16ms flushSync commit → 效应链 → +63ms 首个 DOM 变化 → +89ms shape 可见。未修（见「四」）。

### 热点 5：发送首反馈 42–70ms（全部档位）
- 归因（fetch 时间戳）：Enter → journal POST 间隔 ≈ +50ms；用户消息 commit 在 `prepareAgentTurnProductAPlus` + `coordinator.initialize` 之后（`agentTurnRunner.ts`）。未修（见「四」与「八-C」）。

### 热点 6：项目记录抽屉首开 68–71ms
- 归因：本轮 Node 目标测量未通过 trusted gate，因此不引用域计算数字；浏览器记录表明主要成本来自抽屉 DOM 首渲染与整树重渲染。未修（见「四」）。

## 三、已实施的优化

### 3.1 归档导出 zip 按体积分流（热点 1；含合并前硬化）

**演进过程（三轮）：**
1. **zipSync（原始）**：人读归档单帧冻结 890ms；备份导出 wall ~1.08s。
2. **一律 async zip（Phase 5 首版）**：人读归档阻塞降至 63–71ms；但当时测得「备份 0→~85ms 阻塞」，被视为小包回归。
3. **按输入体积分流（现行为，`SYNC_ZIP_MAX_INPUT_BYTES = 2 MiB`）**：≤2 MiB 走 `zipSync`（crossover 实测小档位 async wall 承担 Worker 调度成本），>2 MiB 走异步 `zip`，以把大包的主线程 `blockingDuration` 降到接近零。

**crossover 实测**（`e2e/performance-zip-crossover.spec.ts`，真实浏览器内运行真实 fflate，3 次取中位，level 6，20% 文本 + 80% 噪声输入；每次测量前双 rAF 进入净帧，只归因与该次 `[startedAt, endedAt]` 窗口重叠的 Long Animation Frame，头条帧数字为 `blockingDuration`）：

| 输入 | zipSync wall | zipSync 最长阻塞 | async wall（首调） | async 最长阻塞 | 字节一致 |
|---|---:|---:|---:|---:|---|
| 0.2 MiB | 8.6ms | 0ms | 29.0ms（29.0） | 0ms | 是 |
| 1 MiB | 39.8ms | 0ms | 57.9ms（71.8） | 0ms | 是 |
| 2 MiB | 68.9ms | 19.0ms | 64.9ms（76.1） | 0ms | 是 |
| 4 MiB | 149.3ms | 99.6ms | 172.1ms（180.1） | 0ms | 是 |
| 8 MiB | 285.5ms | 235.7ms | 282.0ms（287.3） | 0ms | 否 |
| 16 MiB | 546.0ms | 496.3ms | 434.0ms（537.1） | 4.7ms | 否 |

结论：**≤2 MiB 仍走原始同步路径；体积超过 2 MiB 即切到异步路径**。小档位 async wall 承担 Worker 调度成本；4 MiB 档同步阻塞已达 99.6ms，8 MiB 达 235.7ms，16 MiB 达 496.3ms，而 async 的窗口内阻塞分别为 0ms、0ms、4.7ms。异步 wall 不是零成本，超大包的整体缓冲装配仍属于 Bundle Pipeline v2 后续议题。两条路径同库同 level，产物逻辑内容一致；字节级并非保证一致，因此不宣称 byte-for-byte 相等。

**round-1「备份 0ms 阻塞」的修正**：合并前复测发现内置案例的资产安装（26 个文件 / 40 MiB 写入 IndexedDB）在 round-1 测量时**尚未完成**——备份导出抢跑在部分安装之上，测到的是缩小版包。现在等待 workspace JSON 声明的全部 expected `storageKey` 出现在 BlobStore（本轮实测 28 个 blob）后再导出：最终备份 zip **29,669,157 bytes**，人读归档 **29,570,547 bytes**；两者均超过 2 MiB，走异步路径。本轮浏览器实测备份最长阻塞 **136.6ms**、人读归档最长阻塞 **103.4ms**；890ms 只作为同一主要二进制负载的同步压缩 proxy，不把它当作当前人读归档实测值。**因此「小备份包 0→85ms 回归」的原始叙事不成立**——真实内置案例的备份是大包，异步路径相对同步 proxy 是显著改善；hybrid 阈值保护的是真正的小包（小项目、测试夹具、无图项目），其收益由 crossover 数据与单测双路径覆盖。规范已加入确定性的 expected-key 安装等待，消除该测量竞态。

- 为什么安全：同库同 level；≤2MiB 路径即原始 `zipSync` 行为；>2MiB 路径产物为合法 zip，既有解压回环、恢复验收（含恢复成独立项目副本）与新增 >2MiB 导出/inspect 回环测试通过。
- 最终数字（同机、完整安装、`1b6b61b`）：人读归档最长阻塞 **103.4ms**，备份最长阻塞 **136.6ms**；二者分别 `zipBytes` **29,570,547** 与 **29,669,157**，均由异步路径处理。原始同步人读归档 **890ms** 仅作为相同主要二进制负载下 full-backup 同步压缩成本的 proxy；本轮导出 wall 分别约 **1.53s** 与 **1.59s**。

### 3.2 长聊天渲染隔离（热点 2；含合并前硬化）

**演进过程（两版）：**
1. **history/tail 切分（Phase 5 首版）**：`messages.slice(0, -1)` 进 memo 组件，尾条在组件外内联渲染。性能达标（chatLong 流式累计阻塞 368→73–93ms），但**审查发现并被测试实证**：尾条渲染在 memo 组件之外，追加下一条消息时该行跨父级迁移——**行被真实卸载重挂**，用户手动展开的 Agent 过程折叠、DOM 节点被替换（红测试：`rowAfter` ≠ `rowBefore`）。
2. **单一 owner + 行级 memo（现行为）**：全部消息由一个 keyed 列表组件 `AiMessageList` 持有，每行是 memo 化 `AiMessageRow`（比较器 = 消息引用 + 行读取的记录引用 + 回调引用）。消息从尾转历史时 key 与父级不变，**不卸载、不重挂**；隔离由两层 memo 保证——列表比较器（长度 + 逐元素 + 记录 + 回调）拦截整体无关重渲染，行比较器使流式批次只渲染正在流式的那一行。
- 语义保持：历史完整挂载（非窗口化）、滚动契约、锚点、复制行为不变；比较器对任何记录变化回退全量渲染。守卫测试三段式：A 比较器契约（跳过/失效方向）；B **渲染计数实证**（8 行挂载 → tick 恰好 +1、无关重渲染 +0、单条历史变化 +1、记录变化全部行重渲染）；C 状态保持（尾条手动展开 Agent 过程 → 追加消息 → DOM 同一节点且仍展开）。
- 数字（chatLong，560 消息；同机多轮区间）：

| 指标 | Before | 首版 after | 最终（`1b6b61b`） |
|---|---:|---:|---:|
| 流式最长阻塞 | 70.3ms | 13–22ms | 本轮 chatLong 16.6ms（单轮） |
| 流式累计阻塞 | 368.4ms | 73–93ms | 本轮 chatLong 45.0ms（单轮） |
| 发送首反馈 | 49.7ms | 35–38ms | 本轮 chatLong 42.2ms（单轮） |
| 工具→续接间隔 | 454.3ms | 227–230ms | 本轮 chatLong 223.3ms（单轮） |
| 打字阻塞 | 24.2ms | 0–10.5ms | 本轮 chatLong 91.9ms（含输入窗口尾部噪声） |

（多轮波动如实记录；所有轮次均与 before 保持同一数量级改善，未回退。）

## 四、明确放弃的优化（有归因、不动手）

1. **全选渲染隔离（热点 3）**：低频显式操作；把选中态从 workspace 身份链拆出属结构性改动。留 backlog。
2. **粘贴→shape 落地效应链（热点 4）**：涉及 canvas 同步模型（AGENTS.md 禁止第二套 canvas truth）。不动。
3. **发送乐观消息提前 commit（热点 5）**：改变失败路径语义；归入「八-C」后续任务。
4. **记录抽屉域计算 memo 化（热点 6）**：当前可信浏览器证据指向 DOM 渲染体积，而不是已测得的域计算瓶颈；不做无证据的 memo 化。
5. **历史消息虚拟化**：更小的渲染隔离已达标；不承担窗口化语义风险。
6. **交付输出 zipSync→分流**：与人读归档同模式（`deliveryOutputClient.ts`），本轮无该路径长帧证据；若后续测得，3.1 的分流方式可直接复用。
7. **持久化**：仍非瓶颈（装载期同步写 12.6ms、去抖写无长帧）。

## 五、行为安全确认

- **Agent 语义**：mock SSE 全链路（流式、工具调用→本地执行→续接、取消、失败、恢复）复测通过；`agent-turn.spec.ts` 通过；批次 commit 数与 before 一致（31–32）。
- **workspace 语义**：单一 owner 列表不改变消息数据、DOM 结构（同一平铺 `.ai-message` 序列）或滚动语义；行迁移不再卸载——由守卫测试 C 实证。
- **canvas**：未触碰 tldraw 状态模型与同步门。
- **持久化 / 备份格式**：≤2MiB 即原同步行为；>2MiB 为合法 zip（同库同 level、逻辑内容一致、不保证字节相等）；恢复验收与 >2MiB 回环测试通过；`persistence.spec.ts` 全部通过。
- **项目切换 / stale-session**：生命周期与验收套件通过。
- **图片 provenance / DeliveryReference / Compare**：未改动相关路径。

## 六、验证记录（`1b6b61b` 代码提交；证据产物在更晚的 evidence commit 收录，全部真实执行）

| 命令 | 结果 |
|---|---|
| `npm run lint` | 通过 |
| `npm run typecheck` | 通过（0 错误） |
| `npm test`（vitest） | **215 文件 / 1966 项全部通过**（含三段式守卫 7 项、>2MiB zip 回环 1 项） |
| `npm run build` | 通过 |
| `playwright test --project=chromium` | **19/19 通过** |
| `npm run measure:perf5:browser` | **11/11 通过**（10 项交互图谱 + zip crossover），产物含 `measuredCodeCommit` |
| `npm run measure:perf` | 通过（chatLong/compound 的 renderConversation 尾部样本未过可信门，未引用） |

## 七、遗留性能债（仅列有证据项）

1. objects500 首开最长阻塞 125–161ms（parse 44ms + 首渲染 + 挂载；4A 起已知）。
2. 全选 39–86ms 阻塞（500 选中整树渲染）。
3. 发送首反馈 39–62ms：恢复加载 + O(messages) prepare 在 journal POST 前（chatLong 工具间隔仍 230–267ms）。
4. 记录抽屉首开 ~70ms（DOM 渲染体积）。
5. 粘贴/导入 shape 落地比 commit 慢 ~70ms（canvas 同步效应链）。
6. 每字符 2 个 React commit（打字 p95 4–7ms，暂无可感知证据）。
7. 流结束后建议 chips 出现不触发滚动效应（化妆性问题，先验证再动）。
8. 异步 zip 的 wall/Worker 调度成本随包体增长（crossover 4–16MiB async wall 172–434ms、首调 180–537ms），整体缓冲装配仍全内存；超大项目的导出体验属 Bundle Pipeline v2 议题。

## 八、后续任务裁决

### A. Project Bundle Pipeline v2 — **DEFER**
最尖锐症状（原始同步人读归档 890ms 冻结）已由体积分流消除：本轮完整安装下人读归档最长阻塞 103.4ms、备份最长阻塞 136.6ms，890ms 仅作为相同主要二进制负载的同步压缩 proxy。剩余证据：异步 wall/首调随体积增长（172–434ms / 180–537ms @4–16MiB）、整体缓冲装配仍全内存、交付输出未分流但无长帧证据。触发重评：更大项目实测再现 >300ms 的窗口内主线程阻塞。

### B. Document Parsing Worker — **NO EVIDENCE**
当前 150 页 PDF / 40 页 PPTX / 混合批次导入测试**没有观察到值得继续 Worker 化的主线程长帧证据**（导入窗口 LoAF 0、首反馈 34–83ms、对象落地 +31–90ms）。注意这不等于「所有解析工作都已离开主线程」——PDF 文本提取运行在 pdf.js worker 中，但 PPTX 的解压后 XML 解码/正则/文本拼装仍在主线程（有预算看门狗），只是当前测量未证明它们构成性能问题。

### C. Agent request/context/cache latency — **PROCEED**
全部档位发送首反馈 39–62ms，其中 ~50ms 在 journal POST 之前（恢复存储加载 + O(messages) 回合准备；chatLong 工具→续接间隔优化后仍 230–267ms）。分段归因完整（fetch/commit 时间戳）。建议下一任务：a) 乐观用户消息先于 prepare 提交（含失败回滚语义设计）；b) prepare 内 token 估算/上下文构建增量化；c) prompt cache 命中率观测（本任务未触网络段）。

## 九、如何复现

```powershell
npm run build
npm run measure:perf5:browser   # 交互图谱 + zip crossover（perf5 project，--workers=1 --retries=0）
npm run measure:perf            # Node 侧目标 + 校准
npm run measure:perf -- --target=renderConversation:streamTick   # 单项目隔离
```
