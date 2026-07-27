# Morpho 性能基线（阶段 4A，含 4B 复测）

本文件记录 Morpho 在大项目下的实测性能基线。它的用途只有一个：**阶段 4C 的每一次优化都必须能在这里指到一个具体数字。** 没有数字的问题不动。

- 机器数据：[`docs/operations/performance-node.generated.json`](../operations/performance-node.generated.json)
- 浏览器数据：[`docs/operations/performance-browser.generated.json`](../operations/performance-browser.generated.json)
- 采集提交：`1e397dd` · 采集机器：Intel Core i5-12400（12 核）/ Node v22.14.0 / Chromium（Playwright 1.62）
- 校准负载 p50：**2.62 ms**（`JSON.stringify(createCurrentCaseStudyWorkspace())`，确定性，875,346 字符）

## 使用规则（不是建议）

1. **未通过可信门的数字不得被引用。** 本文用 `~` 标记。可信门为「样本数 ≥ 30 且（相对误差 < 5% 或轮间中位数波动 < 5%）且 CPU 占用率 ≥ 0.9」。不通过不代表慢，代表**未知**。
2. **头条统计量是 p50，不是均值。** 笔记本上均值会被调度抢占拖偏。p95 单独列出，用于看尾部。
3. **换机器后比较 `relativeToCalibration` 比值，不要比较绝对毫秒。** 绝对值不跨机器可比。
4. **重构后必须重跑并逐项对比。** 4B 是保行为重构，数字不动才算真的没改行为。

### 4B 保行为复测（`db995cd`）

4B 完成 Agent 回合执行边界拆分后，在同一台机器、同一套脚本上重新采集。生成文件中的 `gitCommit` 均为 `db995cd6f51610af5f509fcc5cf718c7c4760227`。

- Node 校准负载从 2.62 ms 变为 2.94 ms（+12.2%），说明本轮机器整体更慢；因此只比较 `relativeToCalibration`。
- 可信的关键样本均未越过 5%：objects300 reconcile -0.4%、objects500 reconcile +2.6%、compound500Dangling reconcile +4.2%、objects100 会话渲染 +1.7%、compound500Dangling 会话渲染 +0.4%。
- 未通过可信门的 compound500 样本为 reconcile +0.4%、会话渲染 +4.7%，只作带 `~` 的观察值，不用于下结论。
- 浏览器 Agent 流式四档的 commit 数仍全部为 **19**，打字仍全部为 **90**，说明 4B 没有改变批次和渲染次数。
- 浏览器尾延迟仍有明显单轮噪声。当前落盘轮的 Agent 慢事件 p95 为 55.2 / 68.5 / 102.4 / 155.3 ms，相比 4A 的 49.7 / 62.4 / 81.0 / 142.1 ms 偏高；这既不能被宣称为优化，也不能仅凭两次单轮样本归因为 4B 回归。4C 必须用同一轮前后对照和 Node 目标计时共同裁决。

**复测结论：** 4B 的计算路径与批次行为没有发现结构性漂移；浏览器高档位尾延迟保留为 4C 的对照观察，不掩盖、不提前归因。

### 4C-1：Project Memory 语义触发（`037c545`）

`usePersistentWorkspace` 现在只在 Project Memory 的真实投影输入变化时运行 reconcile。画布位置、UI 状态，以及已有消息的正文、状态和 trace 更新直接保留现有记忆；消息增删、对象、revision、decision、continuity、working state 等语义变化仍完整投影。

Node 新增 `reconcile:guardedMessageBody` 目标，按同一轮校准比较：

| 场景 | 完整 reconcile p50 | 语义门 p50 | 节省 | 可信 |
|---|---:|---:|---:|---|
| objects300 | 3.752 ms | 0.000337 ms | 99.991% | 两者均可信 |
| compound500 | 8.344 ms | 0.003974 ms | **99.952%** | 两者均可信 |
| compound500Dangling | 7.270 ms | 0.004053 ms | **99.944%** | 两者均可信 |

生产浏览器同轮对照（4B 复测 → 4C-1）：

| 场景 | 拖动慢事件 p95 | Agent 慢事件 p95 | Agent 最长阻塞 | Agent commit |
|---|---:|---:|---:|---:|
| objects100 | 9.9 → 6.4 ms | 55.2 → 48.6 ms | 6.1 → 0.0 ms | 19 → 19 |
| objects300 | 17.8 → 11.0 ms | 68.5 → 66.0 ms | 19.1 → 16.8 ms | 19 → 19 |
| objects500 | 20.4 → 15.4 ms | 102.4 → 79.7 ms | 53.9 → 30.5 ms | 19 → 19 |
| compound500 | 32.5 → 26.1 ms | 155.3 → 136.2 ms | 107.4 → 87.9 ms | 19 → 19 |

**裁决：** 语义门确实消除了流式正文与画布持久化中的完整 reconcile 成本；objects300/500 的拖动 p95 已回到 16.7 ms 帧预算内。compound500 仍有 136.2 ms 的 Agent 尾延迟，且 Node 侧 560 条消息完整渲染仍约 35 ms，所以下一刀只处理不变历史消息的重复渲染。持久化仍不动。

### 4C-2 / 4C-3：历史消息内容 memo 与 Canvas Editor 输入门（`4d609f4` / `413f52d`）

第二刀只 memo 每条消息中昂贵的 trace 与 Markdown 子树；`updateAiMessage` 保持其他消息对象引用不变，因此流式更新只重渲染当前消息内容。第三刀给 `syncWorkspaceToEditor` 加显式输入门：AI 正文变化不再触发全量 shape 扫描；对象、canvas instance、分区、资产、交付引用、草案标记与视觉高亮变化仍会同步。

memo 后两次浏览器复测的 compound500 Agent p95 分别为 160.2 ms 和 112.2 ms；第一轮同时出现加载、拖动等无关阶段的整机变慢，因此不把单轮最好值直接归因给 memo。完成 Canvas 输入门后的最终落盘轮与 4B 复测对比如下：

| 场景 | 拖动慢事件 p95 | Agent 慢事件 p95 | Agent 最长阻塞 | Agent commit |
|---|---:|---:|---:|---:|
| objects100 | 9.9 → 5.9 ms | 55.2 → 48.4 ms | 6.1 → 49.6 ms | 19 → 19 |
| objects300 | 17.8 → 9.8 ms | 68.5 → 60.2 ms | 19.1 → 11.0 ms | 19 → 19 |
| objects500 | 20.4 → 12.5 ms | 102.4 → 72.6 ms | 53.9 → 23.7 ms | 19 → 19 |
| compound500 | 32.5 → **14.2 ms** | 155.3 → **121.0 ms** | 107.4 → **72.6 ms** | 19 → 19 |

objects100 的单个 LoAF 在最终轮反向波动，且 memo 两轮离散明显，所以浏览器数字只按聚合趋势解读。可确认的是：commit 数没有减少，objects300/500/compound500 的单次提交尾部与阻塞同时下降；相对原始 4A，compound500 拖动 p95 从 33.3 降到 14.2 ms，Agent p95 从 142.1 降到 121.0 ms。

**4C 收尾裁决：** 当前四档拖动 p95 全部进入 16.7 ms 帧预算，因此不再冒险做增量 instance 重建。560 条消息的首次完整渲染仍是 O(messages)（最终可信样本 32.14 ms），Agent 尾延迟也仍偏高；在没有组件级浏览器归因前，不继续引入会改变历史消息可见性和滚动语义的窗口化。保存仍不是瓶颈，未修改持久化。

---

## 一、结论速览

| 结论 | 依据 | 状态 |
|---|---|---|
| `reconcileProjectMemory` 的成本**只由对象数与 continuity 条目数驱动**，与消息数、Context Frame 数、记忆修订数无关 | 见 §2.1 | 确认 |
| `AiConversationPanel` 渲染成本**纯粹由消息数驱动**，与对象数完全无关 | 见 §2.2 | 确认 |
| Agent 流式期间的输入阻塞随项目规模显著恶化，是当前最尖锐的问题 | 见 §3.1 | 确认 |
| 拖动时的单次事件处理在 ≥300 对象时已超过 16ms 帧预算 | 见 §3.2 | 确认 |
| 打字延迟随项目规模上升——打字本不应触碰对象 | 见 §3.3 | 确认，机制未定位 |
| `O(entries × refs × messages)` 这条路径**今天没有任何项目在付** | 见 §2.4 | 潜在，非现存 |
| 合成夹具的悬空引用让计时**偏乐观**，不是计划假设的偏悲观 | 见 §2.5 | **假设被推翻** |
| 去抖写入未产生任何长帧 | 见 §3.4 | 未确认（无问题） |

---

## 二、机器侧（Node）

### 2.1 `reconcileProjectMemory` — 只随对象数与 continuity 条目数变化

投影命中（`reconcile:steady`）是流式期间每 48ms 触发一次的那一档，也是 4C 应引用的数字。

| 场景 | 对象 | 消息 | Frame | 记忆修订 | continuity | p50 | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| objects100 | 100 | 46 | 13 | 20 | 32 | **1.92 ms** | 2.57 |
| objects300 | 300 | 46 | 13 | 20 | 32 | **3.66 ms** | 4.32 |
| objects500 | 500 | 46 | 13 | 20 | 32 | **5.49 ms** | 6.69 |
| chatLong | 40 | **560** | 13 | 20 | 32 | 1.40 ms | 1.61 |
| framesHeavy | 40 | 46 | **121** | 20 | 32 | 1.44 ms | 1.84 |
| memoryHeavy | 40 | 46 | 13 | **200** | 32 | 1.40 ms | 1.60 |
| caseStudy（真实） | 42 | 184 | 0 | 8 | 64 | 2.36 ms | 2.98 |
| compound500 | 500 | 560 | 121 | 60 | 200 | **8.59 ms** | 10.39 |

**曲线形状：对象轴上线性。** 拟合 `1.03 ms + 8.9 µs × 对象数`（100→500 区间）。

**其余三个轴完全平坦**：把消息从 46 提到 560、Frame 从 13 提到 121、记忆修订从 20 提到 200，成本都停在 1.40–1.44 ms。这三个轴不是 reconcile 的成本来源，4C 不要在它们上面花力气。

**continuity 条目的独立代价**：compound500（200 条）8.59 ms 对 objects500（32 条）5.49 ms，差 3.10 ms / 168 条 ≈ **18.5 µs/条**，比单个对象贵一倍。

**占流式预算**：48ms 批处理窗口下，objects500 占 11.4%，compound500 占 **17.9%**。

首次投影（`reconcile:cold`）始终比稳态便宜（compound500 6.48 ms 对 8.59 ms），因为 `projectMemory.ts:209` 的引用短路只在稳态生效，而稳态仍要完整算一遍投影才能发现「没变化」——**代价一分不省，只省了写入**。这一点本身就是 4C 的一个候选切入口。

### 2.2 `AiConversationPanel` 渲染 — 纯粹由消息数驱动

| 消息数 | 对象数 | 场景 | p50 |
|---:|---:|---|---:|
| 46 | 100 | objects100 | 3.02 ms |
| 46 | 300 | objects300 | 3.07 ms |
| 46 | 500 | objects500 | 3.00 ms |
| 46 | 40 | framesHeavy | 2.82 ms |
| 184 | 42 | caseStudy | ~9.82 ms |
| 560 | 40 | chatLong | 33.17 ms |
| 560 | 500 | compound500 | 32.73 ms |

**对象数从 100 到 500，成本纹丝不动（3.02 / 3.07 / 3.00）。消息数从 46 到 560，成本涨 11 倍。** 线性，约 **58 µs/条消息**。

这直接回答了「`AiConversationPanel` 该加 memo 还是该做窗口化」：成本与消息数成正比且无上限，`React.memo` 只能挡住无关重渲染，挡不住消息多本身的成本。**560 条消息时单次渲染 32.7 ms，占 48ms 流式预算的 68%。**

> p95 高达 72 ms 而 p50 稳定在 32.7 ms：这是 SSR 渲染的分配密集特征，尾部是 GC。四个 560 消息场景的 p50 落在 32.73–33.17 之间（差 1.3%），中位数高度可复现，因此按「中位数稳定」判定可信。

### 2.3 序列化、写入与解析 — 由总体积驱动

| 场景 | 序列化字符 | serialize p50 | persistWrite p50 | parse p50 |
|---|---:|---:|---:|---:|
| caseStudy | 875,346 | 2.83 ms | 2.70 ms | 12.01 ms |
| objects500 | 1,308,952 | 4.43 ms | 4.63 ms | 15.77 ms |
| memoryHeavy | 1,725,676 | ~5.63 ms | 5.54 ms | 19.23 ms |
| compound500 | 2,539,468 | 8.89 ms | 8.88 ms | **31.56 ms** |

`persistWrite`（含 `localProjectStore.ts:346` 的回读校验与目录重写）几乎等于 `serialize` 本身——回读校验与目录重写没有成为主要成本。

`parse` 是最贵的单项：compound500 下 **31.6 ms**，且它落在项目首次加载的关键路径上。

### 2.4 message 类 sourceRef — 潜在，不是现存

**已发布的案例项目中 message 类 sourceRef 数量为 0。** 实测构成：object 194 / decision 27 / operation 32 / revision 29 / citation 15 / deliveryReference 1。

`resolveSourceRefAvailability`（[projectContinuity.ts:1520](../../src/domain/morpho/projectContinuity.ts)）里 message 分支是**唯一**做数组扫描的分支（`workspace.ai.messages.some(...)`）；object / revision / branch / deliveryReference 是 Record 查找，decision / operation / citation 直接返回 `"active"` 连查都不查。

刻意注入后测得代价：compound500 加 400 个 message 引用（对 560 条消息）→ 10.25 ms 对 8.59 ms，**+1.66 ms，约 4.1 µs/引用**。

`createMessageRef`（[projectContinuity.ts:956](../../src/domain/morpho/projectContinuity.ts)）确实会为语义补丁条目产生这类引用，所以这条路径**可达**。但 **4C 不得仅凭这个合成档位论证优化的必要性**——今天没有任何项目在付这个成本。

### 2.5 悬空引用的代价 —— 计划假设被推翻

计划假设：合成夹具的悬空引用使 `.some()` 无法早退，因此计时**偏悲观**。

实测相反：

| 场景 | reconcile:steady p50 |
|---|---:|
| compound500（引用重连） | 8.59 ms |
| compound500Dangling（引用悬空） | **7.49 ms** |

**悬空比重连快 12.8%。** 原因是 message 引用为 0（§2.4），所以 `.some()` 根本没被触发；起作用的是 object 引用——命中时还要读 `object.visibility` 判断 hidden，未命中则直接返回 `"missing"`。

**结论：合成夹具让计时偏乐观约 13%，不是偏悲观。** 本文所有合成档位的数字应视为真实成本的下界。

---

## 三、浏览器侧

采集方式：插桩全部由测试注入（`e2e/fixtures/perfProbe.ts`），产品代码零改动。生产构建，非 dev。

> **字段含义**：`slowEvent*` 只包含 **≥16 ms** 的事件——Event Timing 的 `durationThreshold` 有 16ms 硬下限，这些缓冲区里永远只有尾部。输入总量与速率来自原生监听器（`pointerMoveCount` / `pointerRateHz`），不要用 `slowEventCount` 推算输入速率。

### 3.1 Agent 流式 —— 当前最尖锐的问题

| 档位 | 慢事件 p95 | 最长阻塞 | 累计阻塞 | commit 数 |
|---|---:|---:|---:|---:|
| objects100 | 49.7 ms | 0.5 ms | 0.5 ms | 19 |
| objects300 | 62.4 ms | 13.2 ms | 13.2 ms | 19 |
| objects500 | 81.0 ms | 31.7 ms | 45.9 ms | 19 |
| compound500 | **142.1 ms** | **93.7 ms** | 139.0 ms | 19 |

commit 次数固定 19（与规模无关），但**单次 commit 的代价随规模线性上升**。compound500 下一次事件处理阻塞 142 ms——远超任何可接受的输入延迟。

这与 §2.1 和 §2.2 吻合：每次 48ms 刷新都要付 reconcile（8.59 ms）+ 会话面板重渲染（32.7 ms），合计已占预算的 86%，再叠加画布同步就溢出了。

### 3.2 拖动 —— ≥300 对象时已超帧预算

| 档位 | 慢事件 p95 | 最长阻塞 | 真实指针速率 | pointermove 数 |
|---|---:|---:|---:|---:|
| objects100 | 9.4 ms | 0.0 ms | 25 Hz | 61 |
| objects300 | 15.6 ms | 0.0 ms | 25 Hz | 61 |
| objects500 | **19.1 ms** | 0.0 ms | 24 Hz | 61 |
| compound500 | **33.3 ms** | 48.6 ms | 19 Hz | 61 |

指针事件总数固定 61（脚本发出的），但**达成速率从 25 Hz 掉到 19 Hz**——应用跟不上合成的指针流，拖动本身被拖慢了。

objects500 的 19.1 ms 与 compound500 的 33.3 ms 都**超过 16.7 ms 的 60fps 帧预算**，这一档已经掉帧。

对象数从 100 到 500，慢事件 p95 涨 2 倍（9.4 → 19.1），与「shape 移动触发全量 instance 重建」的假设一致。

### 3.3 打字 —— 随项目规模恶化（机制未定位）

| 档位 | 慢事件 p95 |
|---|---:|
| objects100 | 5.6 ms |
| objects300 | 7.6 ms |
| objects500 | 9.6 ms |
| compound500 | **17.0 ms** |

**打字理应与对象数无关，实测却随之上升 3 倍。** 这是本次基线里唯一一个「确认存在但机制未定位」的项，4C 若要处理需先定位。

> `keyPressCount` 记录为 0：Playwright 对中文使用 `insertText` 而非逐键输入，不触发 `keydown`。这恰好接近真实中文 IME 的输入方式，但意味着本项不覆盖逐键英文输入。

### 3.4 加载与保存

| 档位 | 首个 shape | 加载累计阻塞 | 加载最长阻塞 | localStorage 同步写 |
|---|---:|---:|---:|---:|
| objects100 | 607 ms | 237 ms | 121 ms | 2.0 ms |
| objects300 | 589 ms | 274 ms | 127 ms | 4.2 ms |
| objects500 | 610 ms | 318 ms | 158 ms | 7.5 ms |
| compound500 | **859 ms** | **559 ms** | 239 ms | **11.9 ms** |

**保存阶段最长阻塞为 0.0 ms**（全部四档）。去抖写入没有产生任何长帧；隔离的同步 I/O 探针显示 2.5 MB 工作区一次 `setItem` 只要 11.9 ms。**持久化目前不是瓶颈**，4C 不要动它。

---

## 四、逐条假设裁决

| # | 计划中的假设 | 裁决 | 数字 |
|---|---|---|---|
| 1 | `reconcileProjectMemory` 挂在每次 `setWorkspace` 上，流式期间约 20 次/秒 | **确认** | compound500 下 8.59 ms/次，占 48ms 预算 17.9% |
| 2 | reconcile 内部有 12–18 次全量对象扫描，成本随对象增长 | **确认** | 对象轴线性，8.9 µs/对象 |
| 3 | `O(entries × refs × messages)` 是最尖锐的边 | **潜在，非现存** | 现网 message 引用为 0；刻意注入 400 个才 +1.66 ms |
| 4 | `projectRejectedDirections` 的 `[...decisionRecords].reverse().find()` 是热点 | **4A 未能单独测量** | 需要函数级 profiling，不在本阶段范围 |
| 5 | 画布 shape 移动触发全量 instance 重建，成本随对象增长 | **确认** | 拖动慢事件 p95 9.4 → 19.1 ms（100 → 500 对象） |
| 6 | `AiConversationPanel` 无 memo、无窗口化，消息多时重渲染昂贵 | **确认** | 58 µs/条，560 条时 32.7 ms（占预算 68%） |
| 7 | `AgentProcessDisclosure` 长 trace 渲染卡顿 | **确认但量级较小** | 60 个 trace 回合时 6.87 ms |
| 8 | 整个工作区每次 `JSON.stringify` + 回读校验是负担 | **未确认为瓶颈** | 2.5 MB 下 8.9 ms，浏览器实测保存阶段零长帧 |
| 9 | 大项目首次加载慢 | **确认** | compound500 首个 shape 859 ms，累计阻塞 559 ms；其中 `parse` 占 31.6 ms |
| 10 | 合成夹具的悬空引用使计时偏悲观 | **推翻** | 悬空反而快 12.8%，合成数字是下界 |
| 11 | 打字延迟与项目规模无关 | **推翻** | 慢事件 p95 5.6 → 17.0 ms |

---

## 五、4A 测不了的东西

写下来，避免 4C 误以为这些已经有结论：

- **组件级归因（浏览器）**：生产构建已 minify，React commit 钩子拿不到组件名。Node 侧的 SSR 渲染曲线是替代手段，但它不含真实的 React 调度与协调。
- **tldraw 内部同步成本的单独归因**：浏览器只给出聚合的阻塞时长。要拆出 `syncWorkspaceToEditor` 与 `syncShapesFromEditor` 各自的份额需要函数级 profiling。
- **图片解码开销**：性能夹具**不含任何图片二进制**（`assetId` 与 `assets` 已清空），否则数百次 IndexedDB 未命中会污染数据。因此本文所有数字都**不代表满载图片的项目**。
- **缩小到全部可见的最坏情况**：夹具按网格排布，视口内只有一部分 shape。`syncShapesFromEditor` 与 `syncWorkspaceToEditor` 是 O(全部实例) 不受可见数量影响，但 tldraw 的实际绘制成本会随可见数量上升，本文未覆盖。
- **`projectRejectedDirections` 等 reconcile 内部子路径**：只测到 reconcile 整体，没有拆分内部。

---

## 六、一个必须记住的失真风险

`commitWorkspaceNow` 把 `setWorkspace` 包在 `flushSync` 里（[workspaceCommitBoundary.ts:16](../../src/features/workspace/workspaceCommitBoundary.ts)），所以 reconcile + 渲染 + commit 会落在**单个连续同步块**里。

这有两个后果：

1. 好处是成本无处可藏——它必然出现在一次长帧里。
2. **坏处是：如果 4C 去掉 `flushSync`，同样的总 CPU 会被切成可让出的小块，最长阻塞时长会缩短——即使什么都没变快。**

所以对比时必须**同时**看两个量：

- **总 CPU**（窗口内累计阻塞 + commit 数）回答「功变便宜了吗」；
- **最长连续阻塞**回答「变顺滑了吗」。

**二者永不混用。** 只看最长阻塞就宣布优化成功，是这份基线最容易被误用的方式。

---

## 七、如何复现

先确保机器空闲（本基线的 CPU 占用率检测会在进程被抢占时把整轮标记为不可信）。

```bash
npm.cmd run measure:perf
```

浏览器侧需要先构建生产版本：

```bash
npm.cmd run build
```

```bash
npm.cmd run measure:perf:browser
```

单独复现某一项，便于隔离 GC 干扰：

```bash
npm.cmd run measure:perf -- --target=renderConversation
```

首次运行浏览器基线前需要安装 Chromium：

```bash
npx playwright install chromium
```
