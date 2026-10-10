# P7 Aggregate Disposition / Phase Closeout

日期：2026-10-10（Asia/Shanghai）。处置基线：fetch 后本地 `main` 与 `origin/main` 均为
`418fff8f55a76f9dd9390161b439f99c812b2f0d`，主工作树干净。

**P7 Overall = `deferred`；能力基线 `incomplete baseline / not release-accepted`。**
本文件正式收口现有实验阶段，停止主动推进验证；不表示 P7 整体验收通过，也不撤销已接受的子阶段。
本次仅整理文档与本机原始图片，不运行新实验，不把文档 HEAD 当作新的 executed build。
历史报告中的 `validating` / `not_started` 是当时状态；当前 aggregate disposition 以本文件及
[Program Map](./remediation-program-map.md#93-当前执行账本) 为准，原 verdict、run/build identity、失败与 machine evidence 不改写。

## 最终状态与证据范围

| 阶段 / 层级 | 最终状态 | 已有证据与限制 |
|---|---|---|
| P7A / L0–L1 | `accepted` | Frozen T2→T4 17/17 checkpoints、normal Chromium 76/76 clean pass；D1/D2 closed。真实浏览器、domain、本地 persistence 配合固定 Provider 响应；不能证明真实模型理解。T1/T3 full execution 未运行。 |
| P7B-1 / L1b | `accepted / closed` | A–G accepted，D1–D6 closed；隔离 real routes / Auth / PostgreSQL / PostgREST / Journal / RPC，controlled local Provider。A–F 前序 receipts + G-only 最终实测组成范围证据；G-only raw overall inconclusive 保留，不冒称一次完整 A–G 重跑。不是 hosted/production acceptance。 |
| P7B-2 / L2 | `partial evidence / blocked_external_provider` | 8×2 中只有 4 个有效 capability trials：L2-1 pass/pass，L2-2 fail/pass（variable）；L2-3 两次 infrastructure-interrupted，L2-4–8 not_run。D1/D2 closed，D3 external Provider protocol / compatibility blocker 未关闭。不是完整 L2 或 real-text capability acceptance。 |
| P7B-3 / L3 | `accepted_with_limits / closed` | Fresh8 execution/evidence 与 reference authority、lineage、delivery、durable persistence、reopen、ACK 合同 8/8 accepted；D1–D3 closed。单一 T2 产品、四类各两次：CMF、maintenance、default exclusion pass/pass；another-angle pass/fail（variable），reliable capability 未接受。7/8 quality pass 仅为 Root-Agent preliminary Eval。 |
| P7C / L4 | `not_run / deferred` | 没有独立 human acceptance，没有真实多 session 设计师使用与接手验收；Agent 初步评分不能代替。 |
| P7 Overall | `deferred` | `incomplete baseline / not release-accepted`，不是 `accepted` 或 `accepted_with_limits`。 |

## 关键失败与能力缺口

- P7A 的 Summary identity / usable content 冲突及 pre-send request intent durability，P7B-1 的 replay/content proof、恢复与 ACK 等已接受修复，保留原失败及限定关闭结论；本次不重新审计。
- L2 的 source-summary conflation 是已观察的 quality variability。D3 的同一 upstream POST 出现两个不同 `response.created` IDs，第二个 ID completed，客户端 unknown / partialSuccess 且没有 published final Text result。首 identity 绑定后 fail closed 是已接受行为；确切 RPC 抛错未捕获，`provider_identity_conflict` 路径仍是 code/evidence inference。不能把 reseller 内部执行次数推定为一或二，不能放宽 Responses identity contract。
- L3 原 CDN authorization mismatch、原 intent blob capture 缺失、canonical pixelHash 与裸 data-URL hash 混比的 D1–D3 均已限定关闭；历史未交付 diagnostic 和 failed raw verdict 仍保留，CMF1 通过 append-only reconciliation 纳入 fresh8。Another-angle trial2 requested change=1，需要明显视觉救援；trial1 也有 mirror-like 歧义，不证明约 90°几何旋转。
- 尚未验证：完整 T1/T3 与四条 real-model 项目闭环、L2 余下能力、independent human/L4、真实线上 Search 质量、hosted/production boundary、production Journal fault injection、`gpt-image-2.5`、工程尺度/结构/材料性能。现有维护场景的表观触达与支架图像不构成真实尺寸、强度或工程认证。

## 预算与未知项

| 范围 | 历史累计账本 / 授权上限 | 未知与停止原因 |
|---|---|---|
| P7A / P7B-1 | Paid Provider calls / cost = 0；L1b controlled local executions 单列 | 不是真实 Provider 或生产环境证据。 |
| L2 | 20 paid requests，19 settled，1 unknown；已知 912,270 input / 37,740 output / 265,358 cached input；¥0.25864434 tariff estimate。累计授权上限 4M input / 200k output / ¥16 / 64 Text requests。 | Request #20 usage/cost 未知，不能填零；已知 totals 不包含它。停止因 D3，不是扩展后预算耗尽。真实扣费、退款及 reseller 内部执行次数未知。 |
| L3 | 9 submissions = 1 historical diagnostic + 8 fresh；¥0.27 conservative tariff estimate；累计 submission ceiling 9、费用 ceiling ¥0.50。 | Submission ceiling 已达到；historical diagnostic 不计 capability。真实扣费/退款与内部执行次数未知。 |
| 本次 aggregate closeout | 新 paid calls = 0；无 L2/L3/L4 执行 | 旧余额或预算授权不构成自动恢复验证授权。 |

L2/L3 是独立账本，不合并成已确认的实际总扣费。上述价格只记录原运行时估算，不声明当前报价。

## 本机人工预览

原参考 A 与 8 张正式结果仍可用，已按原字节整理至 ignored
`output/playwright/p7-aggregate-preview/`：`index.html`、分组 `README.md`、`hashes.json` 与九张图片。
参考图 decoded SHA-256：`c1fa9574e8a7870179327f4cf4bd175fb37c3036dfa513e3933dda4b62e4ecdc`；
八张结果逐项对照 machine evidence 的 `d3Continuation.grading.attempts[].pixel.sha256`。
该包只方便人工查看，不新增评分或 human acceptance，不提交 Git；仅 clone 仓库不能取得本机原始图片。

## 恢复验证的触发条件

只有新的明确任务授权才恢复对应 deferred 范围，并重新绑定当时实际代码、执行范围、独立 oracle/rubric、预算和停止条件。
若恢复 L2，先取得符合现有 Responses identity contract 的外部 protocol/compatibility 证据，显式结转 request #20 未知项；不自动重试原未知 effect。
若恢复产品级 acceptance，须有独立设计师依据项目与准备包进行真实使用/接手评审；不得把 preliminary Agent grades 升格为 L4。
新真实项目反证或受影响实现/Provider 变化可触发对应切片验证，旧 evidence 保留原身份，不因新文档继承为新版本实测。
这些条件不是下一版产品方案、新整改任务或当前执行授权。

## Canonical 与证据入口

- [P7A final closeout](./p7a-closeout.md) / [closeout machine receipt](./p7a-evidence/closeout.json) / [D2 final executed receipt](./p7a-evidence/d2-durability.json)；[baseline 与历史失败](./p7a-deterministic-baseline.md)。
- [P7B-1 final acceptance / closeout](./p7b-1-l1b.md) / [machine evidence：finalWebAcceptance](./p7b-1-l1b-evidence.json)。
- [P7B-2 partial / blocked closeout](./p7b-2-l2.md) / [machine evidence：closeout](./p7b-2-l2-evidence.json)。
- [P7B-3 accepted_with_limits closeout](./p7b-3-l3.md) / [machine evidence：closeout / d3Continuation](./p7b-3-l3-evidence.json)。
- [Eval architecture（历史研究设计输入）](../research/real-world-project-eval-acceptance-architecture.md)、[Operations index](./README.md)、[runbook](./runbook.md)。本次仅文档/引用/hash/diff 验证，不重跑历史工程 gates、paid trials 或完整 L4。
