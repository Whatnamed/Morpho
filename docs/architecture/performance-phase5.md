# Morpho Performance Phase 5 — 真实交互延迟图谱与证据驱动优化

本文件是 Phase 5 的裁决记录：哪些操作真的让用户觉得慢、慢在哪一段、哪些已修、哪些没有证据所以没动。机器数据在 [`docs/operations/performance-phase5.generated.json`](../operations/performance-phase5.generated.json)（浏览器交互图谱）、[`docs/operations/performance-zip-crossover.generated.json`](../operations/performance-zip-crossover.generated.json)（ZIP transition 测量）与 [`docs/operations/performance-node.generated.json`](../operations/performance-node.generated.json)（Node 侧目标与校准）。

- Baseline SHA：`204857b`（origin/main，任务开始时）
- 本轮最终裁决以修正版 harness 生成的两个 JSON artifact 为准：其中 `buildIdentity.sourceSha`、`buildId`、`artifactSha256` 是实际 served build 的 provenance；`measuredCodeCommit` 仅作辅助字段。
- **历史 measured code SHA：`1b6b61b`**（旧 evidence 的字段；仅保留为历史参考，不能与修正版 harness 的新数据做严格百分比比较）
- 修正版 harness 必须在 clean tracked worktree 上执行 production build，并同时记录 source SHA、Next build ID、`.next` artifact SHA-256、artifact file count 和 runtime marker；`measuredCodeCommit` 单独存在不再被视为 build provenance。
- 采集机器：12th Gen Intel Core i5-12400 · 16 GB · Windows 10 (26200) · Node v22.23.2 · Chromium（Playwright 1.62，Desktop Chrome 1440×900）
- 生产构建（非 dev）。插桩全部由测试注入（`e2e/fixtures/perfProbe.ts` 可选 IO 归因 + 首反馈追踪），产品代码零遥测；render-isolation 计数器只在 `NODE_ENV === "test"` 分支存在，生产包中已消除。
- Node 侧校准负载 p50：2.55 ms（`JSON.stringify(caseStudy)`）；本轮 Node 目标产物未通过 trusted gate，因此不引用其不可信目标数字。
- 本轮 regenerated artifact 的 completeness 为 `expectedCount=61`、`observedCount=60`、`missingMandatory=[]`、`missingOptional=["assets/assets10/assetDrawerShowAll"]`、`unexpectedKeys=[]`；这个 optional 分支的缺失被显式记录，不是静默跳过。五个 filename 的导入验收均为唯一新对象、`parseStatus=parsed`、无 `parseError`，并带 `documentExtract` provenance。

## 测量方法与语义

- **首反馈**（First Feedback）= 修正版 harness 中，phase 内 initiating input（pointerdown/keydown/input/change/paste，`performance.now()`）到操作根节点首个有效 DOM mutation（含 child/text/attribute）的页内时间。不含 CDP 往返；读取时会排空 MutationObserver records，并拒绝 change-before-input、无 initiating input 或跨 phase 样本。旧 evidence 没有这些边界保证，不能继续作为严格最终数字。
- **阻塞**（Blocking）= Long Animation Frame 的 `blockingDuration`；**慢事件 p95** 只含 ≥16ms 事件（Event Timing 规范下限），是尾部而非全部输入。
- **React commit** 数与时间戳来自注入的 DevTools hook。
- **IO 归因**（可选启用）：localStorage 读写、IndexedDB 每操作时长、object URL 创建计数，均为浏览器 API 补丁，产品代码零改动。IndexedDB request 捕获发起时的 phase generation 和完整 start/end interval，跨 phase 完成不会归入下一阶段。LoAF/Event Timing 也按完整 interval 与 phase window 重叠归因；rAF sampler 使用 generation token。
- Agent 走 mock SSE（生产编码器产出的真实帧 + 完整 Coordinator/reducer/落库路径），隔离 client 段成本；**provider 网络/TTFT 不在本图谱内**。
- 夹具：objects500 / chatLong(560 消息) / caseStudy(184 消息) / switchA/B / importBase 无图片二进制（与 4A 可比）；assets10/30/80 带真实再生命周期 PNG（确定性 PRNG + OffscreenCanvas，写入真实 IndexedDB BlobStore）；PDF(30/150 页)/PPTX(40 页)/PNG/文本由 Node 现场生成，不入库。
- 采样规则沿用 4A 可信门；浏览器交互项为单轮完整操作窗口（含 settle），关键字段在多轮对照中复现才用于裁决优化。Node 侧未过可信门的样本标记为不可信且不被引用（本轮 chatLong/compound500 的 renderConversation 尾部 GC 噪声即属此类）。

## 一、Latency Atlas（历史方向性参考；最终证据以本轮 artifact 为准）

下面的表和后续 before/after 数字保留为历史方向性参考，但来自旧 phase-boundary 协议。它们不能与修正版 harness 的结果做严格百分比比较。本轮最终判断以 [`performance-phase5.generated.json`](../operations/performance-phase5.generated.json) 的 completeness、build provenance、精确导入验收和各 phase 原始样本为准；ZIP transition 则以 [`performance-zip-crossover.generated.json`](../operations/performance-zip-crossover.generated.json) 为准。

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

### 热点 1：人读归档导出冻结 890ms（历史同步基线）
- 症状：点击「导出归档」后页面冻结近 1 秒。
- 证据：before 轮 `archiveExportHumanZip` 最长阻塞 889.9ms，单帧；commit 在 +921ms 才恢复。这里的 **890ms 是原始同步人读归档基线**，不是当前人读归档的实测值；由于它与完整备份共享同一批主要二进制负载，后文将它作为 full-backup 同步压缩成本的 proxy，而不是把两种导出当作同一操作。
- 根因：`projectBundleClient.ts` 的 `bundleToZipFile` 用 fflate `zipSync` 在主线程压缩全部可读资产。内置案例 `public/case-study/current/assets` 共 **40 MiB / 26 个文件**，人读归档嵌入每一份。

### 热点 2：长聊天流式协调（历史方向性热点）
- 旧 phase-boundary 轮次曾观察到 chatLong `sendAndStream` 累计阻塞和工具续接间隔偏高；这些数字只用于解释为什么实施行级 memo 隔离，不能与本轮修正版 artifact 做严格百分比比较。Node 侧目标测量未通过 trusted gate，因此不引用任何 `renderConversation` 目标数字；本轮浏览器 entries 和 exact request metadata 以 generated JSON 为准。
- 根因：旧实现每个流式批次重新协调全部 560 条消息；现实现以单一 owner keyed 列表和行级 memo 保持消息节点身份。

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

**本轮 ZIP transition 实测**（`e2e/performance-zip-crossover.spec.ts`，真实浏览器内运行真实 fflate，3 次取中位，level 6，20% 文本 + 80% 噪声输入；每次测量前双 rAF 进入净帧，只归因与该次 `[startedAt, endedAt]` 窗口重叠的 Long Animation Frame，头条帧数字为 `blockingDuration`）：

精确的 `inputBytes`、sync/async wall、首调时间、窗口内 blockingDuration、压缩后大小和 `byteIdentical` 结果只在 [`performance-zip-crossover.generated.json`](../operations/performance-zip-crossover.generated.json) 中作权威记录；它们是一次真实浏览器运行的观测值，不复制成容易漂移的第二份数字表。

结论：生产实现按原始输入字节执行 **`<= 2 * 1024 * 1024` 使用 `zipSync`，严格 `> 2 * 1024 * 1024` 使用异步 `zip`**。这是从 0.2–16 MiB transition 区间选出的工程阈值，不是声称存在一个精确 universal crossover 点。同步路径的大包会产生可观测主线程阻塞，而异步路径的窗口内 `blockingDuration` 在本轮各档位均为 0ms；异步 wall 和首调仍不是零成本，超大包的整体缓冲装配仍属于 Bundle Pipeline v2 后续议题。两条路径逻辑内容一致，但字节级结果不保证一致，`byteIdentical` 必须以本轮 JSON artifact 为准。

**本轮完整安装下的浏览器实测**：备份与人读归档均安装了 28 个 asset blobs，且都超过 2 MiB、走异步路径；精确 `zipBytes`、wall 和 `blockingDuration` 由 `performance-phase5.generated.json` 的对应 entries 权威记录。890ms 只作为历史同步压缩 proxy，不把它当作当前人读归档实测值。真实内置案例的备份是大包；hybrid 阈值保护的是真正的小包（小项目、测试夹具、无图项目），其收益由 crossover 数据与单测双路径覆盖。规范已加入确定性的 expected-key 安装等待，消除测量竞态。

- 为什么安全：同库同 level；≤2MiB 路径即原始 `zipSync` 行为；>2MiB 路径产物为合法 zip，既有解压回环、恢复验收（含恢复成独立项目副本）与新增 >2MiB 导出/inspect 回环测试通过。
- 历史同步压缩 proxy：旧轮人读归档约 **890ms**；本轮完整安装的实际结果以上一段和 regenerated ZIP artifact 为准。

### 3.2 长聊天渲染隔离（热点 2；含合并前硬化）

**演进过程（两版）：**
1. **history/tail 切分（Phase 5 首版）**：`messages.slice(0, -1)` 进 memo 组件，尾条在组件外内联渲染。性能达标（chatLong 流式累计阻塞 368→73–93ms），但**审查发现并被测试实证**：尾条渲染在 memo 组件之外，追加下一条消息时该行跨父级迁移——**行被真实卸载重挂**，用户手动展开的 Agent 过程折叠、DOM 节点被替换（红测试：`rowAfter` ≠ `rowBefore`）。
2. **单一 owner + 行级 memo（现行为）**：全部消息由一个 keyed 列表组件 `AiMessageList` 持有，每行是 memo 化 `AiMessageRow`（比较器 = 消息引用 + 行读取的记录引用 + 回调引用）。消息从尾转历史时 key 与父级不变，**不卸载、不重挂**；隔离由两层 memo 保证——列表比较器（长度 + 逐元素 + 记录 + 回调）拦截整体无关重渲染，行比较器使流式批次只渲染正在流式的那一行。
- 语义保持：历史完整挂载（非窗口化）、滚动契约、锚点、复制行为不变；比较器对任何记录变化回退全量渲染。守卫测试三段式：A 比较器契约（跳过/失效方向）；B **渲染计数实证**（8 行挂载 → tick 恰好 +1、无关重渲染 +0、单条历史变化 +1、记录变化全部行重渲染）；C 状态保持（尾条手动展开 Agent 过程 → 追加消息 → DOM 同一节点且仍展开）。
- 本轮 regenerated artifact 对 chatLong 560 消息记录了 typing、sendAndStream、toolCallTurn、滚动保持和完整 React commit/LoAF/Event Timing 样本；tool-call phase 的 mock request script 为 `total=2`、`consumed=2`、`remaining=0`、`overrun=0`。精确的单轮 wall、blocking、反馈和请求间隔只在 generated JSON 中作权威记录；本轮报告是单次完整浏览器运行，多轮 before/after 数字仍仅作历史方向性参考。

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
- **持久化 / 备份格式**：原始输入 `<= 2 * 1024 * 1024` 保持同步行为；严格大于该字节阈值使用异步 zip（同库同 level、逻辑内容一致、不保证字节相等）；exact threshold/threshold+1 单测和 >2MiB 回环测试覆盖。
- **项目切换 / stale-session**：生命周期与验收套件通过。
- **图片 provenance / DeliveryReference / Compare**：未改动相关路径。

## 六、本轮验证记录

| 命令 | 结果 |
|---|---|
| `npm run lint` | 通过 |
| `npm run typecheck` | 通过（0 错误） |
| `npm test`（vitest） | **216 文件 / 1972 项全部通过**（含三段式守卫、>2MiB zip 回环和默认参考 review 测试） |
| `npm run build` | 通过；production marker 记录 served source/build/artifact identity |
| `playwright test --project=chromium` | **19/19 通过** |
| `npm run measure:perf5:browser` | **11/11 通过**（修正版 perf5 suite；报告含 `buildIdentity`、completeness、精确导入证据和 mock request script metadata；ZIP crossover 另有独立 artifact） |
| Node 侧目标测量 | 未将未过 trusted gate 的目标数字作为证据；不属于本轮浏览器结论 |

## 七、遗留性能债（仅列有证据项）

1. objects500 首开最长阻塞 125–161ms（parse 44ms + 首渲染 + 挂载；4A 起已知）。
2. 全选 39–86ms 阻塞（500 选中整树渲染）。
3. 发送首反馈 39–62ms：恢复加载 + O(messages) prepare 在 journal POST 前（chatLong 工具间隔仍 230–267ms）。
4. 记录抽屉首开 ~70ms（DOM 渲染体积）。
5. 粘贴/导入 shape 落地比 commit 慢 ~70ms（canvas 同步效应链）。
6. 每字符 2 个 React commit（打字 p95 4–7ms，暂无可感知证据）。
7. 流结束后建议 chips 出现不触发滚动效应（化妆性问题，先验证再动）。
8. 异步 zip 的 wall/Worker 调度成本会随包体增长；本轮 4–16 MiB 的精确 async wall、首调和 blockingDuration 只引用 crossover JSON，整体缓冲装配仍全内存；超大项目的导出体验属 Bundle Pipeline v2 议题。

## 八、后续任务裁决

### A. Project Bundle Pipeline v2 — **DEFER**
最尖锐症状（原始同步人读归档 890ms 冻结）已由体积分流消除：本轮完整安装下备份和人读归档均走异步路径，精确 bytes、wall 与 blockingDuration 以 Phase 5 JSON entries 为准；890ms 仅作为历史同步压缩 proxy。crossover JSON 记录了 transition 区间的 async wall / 首调 / blocking 观测，整体缓冲装配仍全内存，交付输出未分流但本轮无该路径长帧证据。触发重评：更大项目实测再现 >300ms 的窗口内主线程阻塞。

### B. Document Parsing Worker — **DEFERRED — no browser hotspot evidence in this run**
本轮修正版验收对五个预期文件逐一完成了新 object/asset 精确映射、terminal `parsed` 状态、`documentExtract` provenance、解析时间和提取统计断言；5/5 均通过，且对应 import phase 的 LoAF / `blockingDuration` 均为 0。当前证据不支持为 Document Parsing Worker 做结构性改造。后续只有在更大文档或新的真实交互证据显示解析成为主线程热点时才重评；本轮不把 Node 侧未过 trusted gate 的目标数字引用为结论。

### C. Agent request/context/cache latency — **DEFERRED TO NEXT PHASE**
旧轮全部档位发送首反馈 39–62ms，其中约 50ms 在 journal POST 之前；这些数字来自旧 phase-boundary 协议，只作为后续方向线索，不是本轮最终账本。Agent request/context/cache latency 保留为下一阶段范围；本轮不开始 pipeline optimization，也不将旧数字写成修正版 before/after 结论。

## 九、如何复现

先按 [runbook](../operations/runbook.md#build-provenance-for-browser-evidence) 在 clean tracked worktree 上构建并核对 source/build/runtime identity；不要直接用旧 `.next`。

```powershell
npm run build
npm run test:e2e:build       # build + chromium acceptance only
npm run measure:perf5:browser   # 修正版 harness；perf5 project，--workers=1 --retries=0
npm run measure:perf            # Node 侧目标 + 校准
npm run measure:perf -- --target=renderConversation:streamTick   # 单项目隔离
```
