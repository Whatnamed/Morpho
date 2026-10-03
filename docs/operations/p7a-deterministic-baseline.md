# P7A deterministic baseline — validating（2026-10-03）

当前结果见 [P7A-D2 pre-send durability report](./p7a-d2-durability.md)：D2 已修复，两条
Chromium case 串行及默认并行各十次通过；完整 normal Chromium 76/76 clean pass，冻结
T2→T4 17 checkpoints pass。P7 仍 `validating`。以下保留 D1 阶段的历史证据。

## D1 修复与原冻结轨迹重跑（历史结果）

**D1 已修复；deterministic T2→T4 闭环通过；normal Chromium gate 未通过。**
P7 保持 `validating`，没有 merge main 或开始 P7B。

- 本轮 reviewed base：`9c415903c4b79a91c12b68018ad7a9cd8f289ce2`。
- D1 fix：`1bb15d28aea5ed40c8500cf1623a6b8e095323e6`；Eval locator correction：
  `f795ed8fec0cb7500200e18555ac6e438ed3a394`。
- 最终实测干净 build：`msVqpXKF-ZQeMxB1Q2ZO1`（source = `f795ed8…`）；source-tree
  `b40805d939571ffe2d1797af88ada0d6d8b5479af592f9b041fc32e01c538eac`；artifact
  `3567961857e95e7c2e456ec9bae782115fc49daff8c4c34684eb62079401c429`。
- [本轮机器可读 verdict、build/run identity、最小证据与 artifact hashes](./p7a-evidence/d1-rerun.json)。

Concurrency 单独冻结 raw `conversationCompaction.summaryRevisionId`；现有 request/apply
字段 `expectedPreviousRevisionId` 承载该 identity，不因内容不可用而省略。只有现行
`getUsableConversationSummaryRevision()` 判为 usable 的 revision 才进入 Provider 的
`previousSummary`，并作为 planning、boundary validation、domain apply 共用的 source 起点。
存在但 unusable 的历史 revision 保留原样，新 compaction 从完整 usable message range 开始；
current pointer 指向不存在 revision 时，fresh POST 前和 apply 都 fail closed。

Fresh Recovery v2 boundary 新增可选 `usablePreviousSummarySourceHash`：可用前置内容及其
source body/order/membership 的 digest，或明确 `null` 表示没有 usable content base。
旧记录缺失该字段仍可读取、不回填。原始 request/body/hash、raw identity、source range
在 reload 后保持不变；执行期间真实 pointer/source 变化仍拒绝应用；append-only tail 允许；
Summary 已保存但 ACK 未完成时复用 current 同一 revision。**Workspace schema 18、Recovery
version 2 均不变；无 Workspace 或数据库 migration。**

Regression 及工程验证：targeted compaction/Recovery/routes **12 files / 128 tests pass**；
full unit **241 files / 2544 tests pass**；typecheck、lint、production build、diff check pass。
产品代码只有 D1 fix；后续 commit 只修改 Eval locator / evidence documentation。

本轮第 14 次总尝试（D1 后首次）通过 draft discard/apply，但 T4.4 的
`.confirm-card.first()` 指向保留的旧 Compare card。失败 UI 数据证明目标按钮存在于后面的
真实确认卡，归因 **Eval driver**，没有证明第二个产品 blocker。仅把 locator 限定到含目标
动作的卡；全部 frozen contract/fixture/oracle/case 五个文件 hash 未改变，未删除历史 Summary。
第 15 次总尝试 **1/1 pass，17 checkpoints pass**：T2 source/lineage/partial/reload/default →
T4 stable references、pending/discard/apply、upstream review/hide、单引用 refresh、copy review、
export/reopen。该 slice 没有新的产品级 first divergence。每次 retries/rescue = 0；不把总尝试
计数解释为一次运行。Paid Provider calls/cost 均为 **0**。

Normal Chromium 两次完整运行均为 **75 pass / 1 fail**，失败不同：首次在关闭 writer tab
后 reload 的 Import button 仍 disabled；复查该项通过，但 P3B Text reload 观察到两个不同
requestId 的 `/requests` POST（预期一个）。与 D1 的关系及产品/driver 根因尚未确认；保留
两次失败，不修第二产品问题，不继续第三次完整运行取最好结果。`f795ed8…` commit 正文
提前写成首次 Chromium 76 pass 是记录错误；实际结果以本报告及 log hashes 为准。

本轮 raw screenshots/state/wire/output zip 均仅留在 ignored `output/playwright/`，未新增
raw archive 到 Git；原 `evidence.zip` SHA-256 未变。本轮**没有 history rewrite**。最终 P7A
closeout 准备 ff 到 main 前，必须统一重建 task commit graph，使该既有 binary blob 完全不在
将要合入的历史中，仅追加 `git rm` 不够。L1b/L2/L3/L4、production Journal、human acceptance
与 P7B 仍未执行。

## 原始冻结后基线（历史失败证据）

**T2 必跑切片通过；T2→T4 闭环未完成。** T4 首次生成 draft 前出现真实产品
`summary_revision_conflict`，按 P7A stop rule 保留失败并停止产品修改。P7 不是 accepted，
没有开始 P7B，没有 merge main。

## 身份与产物

- Fetch 后 actual base：`ba81e6d2e126c67e825b52c5700a38c332199738`，与用户指定 main 相同。
- Contract / independent oracle freeze：`cba8b7752f867bbe40a99d0b7bae24ac46613d83`。
- Integrated browser / serializer：`445ffa2e438c62f1b11071e8f515f31da5e12ddd`。
- 最终被执行的 implementation：`e62aca59d42aac634a2d8daffc6ab3e69360513b`。
- 干净 production build：`R4L4bxDM4UtKYSUpYOrtE`；source-tree SHA-256
  `45b95c991676c54e4169005d5812e6f42bf0b72bebb88052eda3ca99f74e1d02`；
  artifact SHA-256 `05fdf5a5a8d2caa046f7926fbcaf86ab013a4f03c30cee8ccb6f72c23422a88f`。
- [机器可读 baseline / 全部尝试 / artifact index](./p7a-evidence/baseline.json)、
  [原始 evidence archive](./p7a-evidence/evidence.zip)、[无损还原及 hash 校验](./p7a-evidence/unpack-evidence.mjs)。

Archive 使用 `p7-lossless-string-interning-1` 去重重复的像素与长文本，保留原始 JSON 的
SHA-256。解包实际还原并校验 **262 个 evidence 文件**。早期整个历史会话的 DOM dump
不长期保存；其 hash / 排除原因列在 index，对应状态、wire、截图仍保留。未保存新模型
chain-of-thought，没有给产品持久化添加日志。

```powershell
node docs/operations/p7a-evidence/unpack-evidence.mjs
npm.cmd run build
npm.cmd run test:p7
node scripts/diagnose-p7-compaction.mjs
```

初始 `e62aca59…` 的 `test:p7` 报告失败；当前结果见上述 D1 rerun，原失败不覆盖。
最后的 evidence/docs commit 另含 diagnostic loader 的 lint 命名修正，不改变被测产品。
已执行证据绑定上述 build/implementation，不宣称 docs head 是另一个已执行 build。

## 冻结与执行范围

T1–T4 均冻结为 `p7-trajectories-1` / `p7-rubric-1`；case overlay 是 `p7-buoy-copy-1`。
[contracts](../../e2e/eval/contracts.ts) 表达 checkpoint、事件拥有的 truth ledger、作用域、
允许分支/结果、不变项、质量维度、预算和 invalid/ungradable 条件。
[contract lock](../../e2e/eval/contract-lock.json) 冻结原案例、资产 manifest、fixture recipe
与 T1 场景材料；文本 hash 使用 UTF-8/LF，实际二进制使用原始 SHA-256。
Oracle 不导入 Memory / workingState / continuity projection。T1/T3 每个 deferred checkpoint
都有独立 expected fact pack；它们的完整执行与长历史/backup adapter **not_run**。

| 范围 | 最终实测 |
|---|---|
| T2.1 | 原案例隔离副本保留历史噪声；raw primary A/守望塔与实际 Memory tool 返回一致，未写对象或决定。mock prose 不证明模型理解。 |
| T2.2 / T2.4 / T2.6 | 原生选择 A/M/X；实际 Image inputs 仅 A+M，像素 hash 与原案例资产一致；排除 X/default E；2 项中保存 1 个新 image/asset，另一项永久 mock failure。identity parent、Direction、Branch、单一 version parent、实际 input manifest 与 partial fulfillment 均通过。 |
| T2 reload / T2.5 | 成功对象、失败事实、lineage 和 IndexedDB binary 读回一致；返回旧 A 并明确替换 default，冻结 generation/旧资产保留。 |
| T4.1 / T4.2 | 新建展板准备包与章节；明确加入**本 run 的真实 child**和旧 A；caption/note 与未验证性能/耐久缺口实际保存。没有中途 reseed。 |
| T4.3 首次 draft | **fail**：自动 compaction 在文字 Provider request 前报告 false base conflict；没有 pending draft；真实 fulfillment 为 notPerformed。 |
| T4 discard/apply、上游变化、refresh/copy review、export/reopen | **not_run**；执行代码已接线，因前置产品阻塞未到达，不用既有 P5 测试填补 integrated coverage。 |

本次跨包直接证明 P0/P1A 的保存/稳定身份切片、P1B 的当前路线读取、P2A 的动作权限与
局部视觉 scope、P2B 的实际输入/partial fulfillment、P4 的 lineage/reference、P6I 的实际
选择和章节绑定。P5 只到真实 stable reference 创建；P6H 人工 Undo/Redo 由相邻 suite 验证，
本 closed loop 未执行其历史事件。T2 新角度/真实图像保真也未评。

## First divergence：P7A-D1

- Checkpoint：`T4.3-discard-generation`；严重性 **P1 / high**，合法 Delivery 任务被阻断。
- 最终 browser Recovery fault：`summary_revision_conflict`，声称 Summary base 在外部 action
  期间变化；实际没有用户并发 mutation，文字 Provider script 的 3 个响应全部未消费。
- 当前 production case 的 raw pointer 是 `conversation-summary-migrated-sqca77`，revision 存在。
  `buildConversationCompactionPlan()` 没有返回 `previousSummaryRevision`；orchestrator 用它
  捕获 base，稍后却与 raw current pointer 比较，得到冲突。
- [最小复现](../../e2e/support/p7CompactionDiagnosis.ts) 直接使用当前 production case constructor
  和 planner，Workspace before/after 完全相同，仍产生同样的 base mismatch；没有 Provider。
- Owner：compaction 原始 base / continuation / 恢复合同，影响 accepted **P2B/P3B** 的连续执行
  义务。Git blame 显示相关 guard/capture 已在 `0267e219`（2026-07-29）存在：这是 baseline
  暴露的既有缺陷，**没有证据说由最近 remediation commit 引入**。
- 没有修 domain / UI / Runner / Provider / schema，没有删除 migrated summary 或换 seed。
  未观察到数据丢失、重复付费或生产 Journal 问题。

前 10 次属于开发/诊断尝试，涉及静态 CDN guard、旧回合采样、合法 observation receipt、
历史同名 controls、无衍生图时的直接 default 操作、延迟保存、reload notice、重开章节选择，
以及缺少 compaction mock。第 11/12 次在 fixed compaction 下保留产品冲突；第 13 次为上述
干净 build 的正式失败 baseline。中文 ID 的早期怀疑未被确认为本次根因；未改变输入绕过它。
全部记录见 index；不选 best-of-N、不把开发纠错当可靠率。每次自动 retry = 0，用户 rescue = 0。

## Checks 与停止边界

| Gate | 结果 |
|---|---|
| P7-specific | 1 条 **fail**，6 个 compound/checkpoint pass，first divergence 保留；39s |
| Normal Chromium | **76/76 pass**（15 files / 3.3m），P7 不在普通收集范围；包括 P1B/P2A/P2B/P4/P5/P6H/P6I、external effect/result 与 persistence 邻接回归 |
| Full unit | **241 files / 2534 pass**；独立 oracle 的 3 个负向/覆盖检查包含在内 |
| typecheck / lint / production build / git diff --check | **pass**；lint 包含 diagnostic loader 命名修正 |

P7 project 单独串行执行、零 retry；Quality workflow 没改，没有 paid test 进入 CI。
实际 paid Provider calls/cost 都为 **0**。只捕获客户端序列化输入；server final wire 未观察。
L1b 真 routes/Journal/RPC、L2 real model、L3 real image、L4 human handoff、production Journal
fault injection 均未运行。保持 **P7 validating**，push evidence branch 后停止，等待网页复审。
