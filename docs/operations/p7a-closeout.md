# P7A deterministic baseline closeout（2026-10-03）

**P7A complete / web accepted；D1、D2 closed。P7 overall 保持 `validating`，P7B `not_started`。**
用户已最终复审下列 pre-clean state。本次仅清理 task history 与文档，未修改产品、Eval、
fixture 或 oracle；main 采用 ff-only integration。实际 integration SHA 在合入后的 docs receipt 记录。

## Reviewed → clean history

- Original base / integration 前 main：`ba81e6d2e126c67e825b52c5700a38c332199738`。
- Pre-clean reviewed head：`6a1c56c03bb385a2c2c95191ebf6c9d4bc8321eb`。
- Clean rewritten head（docs closeout 前）：`207426debf60186ac2393664f9a484baee93e973`。
- [机器可读 closeout / 完整 mapping / frozen hashes](./p7a-evidence/closeout.json)。

| Pre-clean SHA | Clean SHA | Logical commit |
|---|---|---|
| `cba8b7752f867bbe40a99d0b7bae24ac46613d83` | `cba8b7752f867bbe40a99d0b7bae24ac46613d83` | test(eval): freeze versioned P7 trajectories and independent oracles |
| `445ffa2e438c62f1b11071e8f515f31da5e12ddd` | `445ffa2e438c62f1b11071e8f515f31da5e12ddd` | test(eval): add continuous deterministic T2 to T4 browser baseline |
| `e62aca59d42aac634a2d8daffc6ab3e69360513b` | `e62aca59d42aac634a2d8daffc6ab3e69360513b` | test(eval): capture the integrated compaction divergence without repairing product state |
| `9c415903c4b79a91c12b68018ad7a9cd8f289ce2` | `30f1efa4791ace9fafe5de2b8aa6bd1e01c103e4` | docs(eval): record the failing P7A deterministic baseline and evidence |
| `1bb15d28aea5ed40c8500cf1623a6b8e095323e6` | `8ae57a64ac97f9e16b497a53bac7f6de5c126fa6` | fix(compaction): separate current summary identity from usable content |
| `f795ed8fec0cb7500200e18555ac6e438ed3a394` | `0a3a00c44649b7bcb747d41304a677736c42e375` | test(eval): target the live default-reference confirmation card |
| `6a76bec0d5f2040ee5569830dd46cbe92f6e0177` | `cf482d46e1edc57ae01da8199549a99912d654bd` | docs(eval): record D1 fix, passing frozen trajectory and unresolved browser gates |
| `345bdac5bba57cfad356b4c87deeea6a2f47b8cb` | `0f1c5923449f1f9df621dfb02f56a5d277d3b861` | fix(runtime): persist exact provider request intent before POST |
| `6a1c56c03bb385a2c2c95191ebf6c9d4bc8321eb` | `207426debf60186ac2393664f9a484baee93e973` | docs(eval): record D2 durability fix and clean P7A gates |

## History hygiene 与等价验证

逐个重建原九个 commit，保留 author、committer、日期、message 和逻辑拆分，仅从 tree 删除
`docs/operations/p7a-evidence/evidence.zip` 及其专用 `unpack-evidence.mjs`。
全部非 artifact patch 逐项相同；`git range-diff` 中八个 patch 为 `=`，唯一 `!` 仅为原
archive / unpack additions 移除。Range-diff SHA-256：`0dc5e8865203cfe8463cf95bd2839cbb7c7675ca436aed179632871e43359c3d`。

Reviewed head 与 clean head 的最终 `src/`、`e2e/`、`scripts/`、配置及全部其他 non-docs
文件完全相同；frozen lock 五项 SHA-256 及 independent oracle/Eval 内容保持一致。
Closeout 只修改 docs，`git diff --check` 通过。没有因 SHA rewrite 重新运行完整 gates，
也没有把 clean SHA 宣称为一次新执行 build；原 build/run/source/artifact identity 均保留。

整个 clean head 可达 graph（含 base 历史）均不含上述 paths 或 archive blob
`acc36f21f6f27721a1275e6dd98efff37d82cfcc`；最终 tree 中也无两文件。
诊断期 archive 的 SHA-256 为
`ccbf8d667f324f048285ba08234b6c98de6fbf87f7c0671af42ad023977a3de0`（32,290,596 bytes）。
本机诊断材料保留在 `D:\Morpho-Diagnostics\P7A-2026-10-03`，Git 只保留最小文本证据、
baseline/D1/D2 reports、artifact index/hashes、run identity 和可复现 fixture/Eval。

## 已接受的 executed evidence

[D2 report](./p7a-d2-durability.md) / [机器证据](./p7a-evidence/d2-durability.json)
绑定原实测 implementation `345bdac5bba57cfad356b4c87deeea6a2f47b8cb`，
production build `O6ExjyEH8DuauiCJRfqNK`，未覆盖此前失败记录。

| Gate | Accepted result |
|---|---|
| Frozen T2→T4 | 17/17 checkpoints pass，无新的 first divergence；retries/rescue = 0 |
| Normal Chromium | 76/76 clean pass，retries = 0 |
| Text reload / writer-tab stability | 串行各 10/10；默认并行各 10/10，全部 clean |
| D2 targeted / P3A/P3B adjacent | 18 files / 330 tests pass |
| Full unit | 241 files / 2556 tests pass |
| Typecheck / lint / production build / diff check | pass |
| Paid Provider calls / cost | 0 |

D1 current identity / usable content eligibility 与 D2 pre-send durability / exact recovery 合同
保持已复审实现；本次无 schema/migration 变化。

## 尚未执行的 P7 范围

T1/T3 full execution、L1b real Journal/routes/RPC、L2 real model、L3 real image、L4 human
handoff、production Journal fault injection 均 `not_run`。T2 real visual fidelity 未评，
只观察 client serialized inputs，未观察 actual Server final Provider wire。P7A 完成不代表
完整 P7 acceptance；P7B 未开始。
