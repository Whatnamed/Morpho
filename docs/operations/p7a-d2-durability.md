# P7A-D2 — Provider Request pre-send durability（2026-10-03）

**D2 已修复，normal Chromium 76/76 clean pass，冻结 T2→T4 17 checkpoints pass。**
P7A 已通过网页最终复审，D1/D2 已关闭；P7 保持 `validating`，P7B `not_started`。
[Closeout 与 clean history SHA mapping](./p7a-closeout.md)。以下保留 D2 实测阶段的原始
build/run identity；clean D2 fix 为 `0f1c5923449f1f9df621dfb02f56a5d277d3b861`。

- Reviewed base：`6a76bec0d5f2040ee5569830dd46cbe92f6e0177`。
- Fix / 实际被测 implementation：`345bdac5bba57cfad356b4c87deeea6a2f47b8cb`。
- Clean production build：`O6ExjyEH8DuauiCJRfqNK`；source-tree SHA-256
  `5fc17185cd9bd3ea88b58bc2461737e0480a5efde1790df45401e4c0faaadfaf`；artifact SHA-256
  `338c9ea62976c2ec9f70727870e10125e8319bf4228870e9694bae7d42aaac06`。
- [机器可读 verdict / build-run identity / artifact hashes](./p7a-evidence/d2-durability.json)。
  后续报告 commit 不宣称是另一份已执行 build。

## 根因与最终合同

`startNewRequest()` 生成 identity / active request 后，Recovery observer 只排队保存；
Coordinator 未等待该 queue durable 就调用 `executeExternalRequest()`。Reload 可能读取
先前尚无 active request 的 snapshot，并为同一个 Server Turn / step 生成第二 identity。
正常 Chromium 的两个不同 requestId POST 已由网页复审确认为 **P7A-D2**。

Coordinator 新增 `persistRequestIntent` pre-send barrier，Runner 通过现有 RecoveryWriter
明确 enqueue 传入的 exact snapshot 并 await 保存，再允许 `/requests` POST：Server Turn
binding、requestId、stepSequence、原始 Provider request 及 active state 必须一起 durable。
不依赖 observer 成功，也不把旧 snapshot 的 flush 成功当作新 intent 保存。Hook 缺失、
返回失败或抛错时 **零 POST**；等待保存期间取消也不会发送。保存失败进入现有本地持久化
失败处理，之前已完成的局部结果按现有合同保留。

Reload 先 query Server Journal：已观察的 request 使用原身份查询／同结果 redelivery；
明确未观察的 initial request 只能走既有 exact retry。Unseen continuation 仅在 Journal 的
`awaitingNextRequest` identity/sequence 等于原 `lastRequest`，且 frozen next sequence 是
previous + 1 时走同一 exact retry，复用原 requestId / sequence / Provider body。
不以最新 Workspace 重建旧请求，不产生第二 identity，不增加 generic paid retry。
P3S ambiguous stop-loss 与 Server Journal authority 保持；client Recovery 不成为 Server authority。

Journal / Workspace / Recovery schema 均未修改，无 migration。D1 identity/content eligibility
合同及原 frozen contract、fixture、oracle、case 文件 hash 均未改变；Chromium case 的 reload
时机及 `toHaveLength(1)` 原样保留，未加等待、放宽断言或去重。

## 验证结果

| 检查 | 实际结果 |
|---|---|
| D2 targeted + P3A/P3B adjacent | 18 files / 330 tests pass |
| Full unit | 241 files / 2556 tests pass |
| Text reload，workers=1 / repeat-each=10 | 10/10 pass，retries=0 |
| Writer-tab，workers=1 / repeat-each=10 | 10/10 pass，retries=0 |
| 两条 case 默认并行 / 各 repeat-each=10 | 6 workers，20/20 pass，retries=0 |
| 完整 normal Chromium，仅运行一次 | 6 workers，76/76 clean pass，retries=0 |
| 原冻结 `npm.cmd run test:p7` | 1/1 pass，17 checkpoints pass，retries/rescue=0 |
| Typecheck / lint / production build / diff check | pass |

新增 deterministic regression 覆盖 blocked/failed first intent、durable 后 POST 前 crash/reload、
lost Text response query/redelivery、continuation intent/save failure/exact retry，以及等待期间
cancellation；现有 Image / Compaction / result delivery regressions通过。Writer-tab 在串行
及默认并行各十次、完整 gate 中均未再现失败；本轮未修改其产品代码或测试。

P7 第 16 次总尝试绑定本轮 clean build，连续 T2→T4 17 checkpoints 全部 pass，无新的
first divergence；此前历史尝试仍保留。Paid Provider calls / cost = **0**。

新 raw screenshots/state/wire/output zip 仅在 ignored `output/playwright/`，工程 logs 在 ignored
`output/`；Git 仅新增本报告、最小文本 metadata / hashes / artifact index。既有 32.3 MB
`evidence.zip` SHA-256 当时未变，D2 实测阶段没有 history rewrite；最终 closeout 已从
可合入的完整 commit graph 移除该 blob 与 unpack script，仅保留本机诊断材料。
T1/T3 全轨迹、真实 Journal/Provider/model/image、
human handoff 和 P7B 未执行。
