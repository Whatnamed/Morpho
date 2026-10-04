# P7B-1 — L1b real routes / Journal / RPC（2026-10-03–04）

**当前：P7B-1-D1 web ACCEPTED / closed；新增 PRODUCT BLOCKER P7B-1-D2（C fail）。**
P7 继续 `validating`；D–G `not_run`；P7B-1 overall 未 PASS；
P7B-2/P7B-3/P7C `not_started`；本轮未改产品、未 merge main，等待网页给 bounded fix scope。

## C continuation / first divergence（2026-10-04）

Fetch 确认 reviewed branch head `96053909f1dbc341f699c4e177fb5cdbd67bc3e0`，main 仍为
`f852578f0d1303ff074f66db1e3919c3218a5561`，工作树 clean。用户本轮明确确认 D1 已网页接受，
accepted fix `1f410e4553d89447cfb934590e0a00979dc75ee6`；没有重审或修改 D1，A/B 使用原 accepted receipt。

本轮只新增 Eval browser harness：native Chromium + 当前 domain `createBlankWorkspace` seed，
real Auth cookie → production Next A+ routes → real privileged server boundary / PostgREST →
fresh isolated TCP PostgreSQL → controlled local Text stub。没有 Agent/Journal/RPC mocks。
POST/ACK 入口读取真实 localStorage 与 IndexedDB；response loss 仅发生在客户端已读完真实
HTTP response 后，reload 前的客户端 receive barrier 阻塞取回，不伪造 server result。
Workspace fault 只对 test-owned project 的最终 conversation `Storage.setItem` 抛
`QuotaExceededError`，不影响 Recovery/IndexedDB、服务端或 production。

| Scenario | 当前 verdict | 实际 evidence |
|---|---|---|
| A/B | prior accepted evidence | 本轮 not_run；保留原 D1 failure、accepted fix 与 A/B pass |
| C response loss / reload | subcase pass | original request identity/body 在 POST 前 durable；reload GET original Journal/result/chunk；envelope + conversation durable before real ACK；每个 request 一次 Provider submission |
| C final local save failure | **fail / P7B-1-D2** | ACK 0、Recovery/envelope 保留、UI 显示保存失败；但 durable conversation 未写入，Recovery 仍持久化 completed Overall Local Outcome + succeeded persistence |
| D/E/F/G | not_run | 第一 genuine product divergence 后停止；没有用 unit/P7A 或 C 的部分 escrow evidence 代填 |

**P7B-1-D2 / P2 — recovered Text 的 final conversation 保存失败后保留错误的 completed local facts。**

- Turn `b1c45c0a-f86f-4141-9dff-659c78205f49`，project `p7b-browser-save-failure`，
  request `85437f38-b4c8-4698-933d-7f1cd9542b65` / sequence `1`。
- Provider 与 server Journal 正确为 `succeeded` / `externally_completed`，原 escrow published。
  reload 从真实 RPC/PostgREST 取回原 result/chunk，并保留完整 envelope。
- Final Workspace write 被人为拒绝；实际 localStorage 中 assistant body 仍为空、status 仍
  `streaming`；UI 显示 Workspace“保存失败”，**没有声称 UI 展示 full success**。
- 同时持久化的 Recovery 为 `phase = terminal`、`outcome.kind = completed`、
  `lifecycle.persistence = succeeded`、`metadata.localPersistence = succeeded`。
  这是客户端 Overall Local Outcome / persistence facts 的错误，不是 server completion 错误。
- **未观察到错误 ACK 或重复付费**：client ACK POST = 0，DB `acknowledged_at = null`，
  original request POST = 1，该 effect 的 Provider stub execution = 1。

最小代码边界（本轮未改）：
[`agentTurnCoordinator.ts`](../../src/features/workspace/agentTurnCoordinator.ts) 的
`observeServerStatus()` 在 `externallyCompleted` 时，沿用 initial Workspace 的 succeeded
persistence，先 dispatch `TURN_FINALIZED`；
[`agentTurnRunner.ts`](../../src/features/workspace/agentTurnRunner.ts) 的
`reconcileRequestResult()` 先 flush Recovery，再检查 final Workspace persistence。
后者失败时仅返回 `pending`，未纠正已保存的 terminal completed / succeeded facts。
Canonical Lifecycle owns Overall Local Outcome and must include current local persistence facts；
保留 Provider/server succeeded 是正确行为，不能代替最终本地保存成功。

## C run identity、invalid harness run 与 gates

- Meaningful first-divergence run：`2026-10-04T07-01-53.206Z-14756`；clean executed source
  `80704fc1cf0d4fd9cd7e7b7cb7fc9e5a77443d10`；build `guEFOaew_P_7M6AkocOkl`。
  Source-tree SHA-256 `b188289f3cd04d26523603184990af5e1a9830e852a5352f77ed98682a862eaa`；
  artifact SHA-256 `ccc008adbdbe0f47c97afac78cb1289aa390b9f886635f49cd1ec8b1c002e186`。
- Isolated DB identity：`b06485ff-8260-4357-ad59-50fcadbc1fe8`；PostgreSQL 17.10 /
  PostgREST 16.4 / Auth v2.197.0，环境与 20 项 repository migrations hashes 保持原值。
  各服务只用 loopback，ports 55432–55436；浏览器非 loopback 网络请求被阻断。
- 保留三个独立 run：`2026-10-04T06-54-17.795Z-3696` 仅 C response-loss/reload 初始子场景
  pass，不声称完整 C pass；`2026-10-04T06-57-15.515Z-7604` 为 **invalid_run**，harness 错误
  等待 Agent `.failure-card`，实际 failure UI 是 Workspace banner；校准 selector 并检查
  durable Outcome 后，第三个 run 才记录 genuine product blocker。没有删除或改写前两次 raw verdict。
- Meaningful run stub submissions = **2**（两个独立 Text requests 各 1）；三个新 runs 共 **5**。
  每个 request 都没有 reload 造成的第二 submission；automatic retries = 0。
  Paid calls / cost = **0**；production DB/schema/data/migration 写入 = **0**。
- Changed Eval scripts 的 Node syntax、targeted ESLint、clean strict production build、
  `git diff --check` **pass**。最初 harness revision 的 full lint pass；后续小改动做 targeted lint。
  因已发现产品 blocker，本轮不再跑 unit/SQL/typecheck/full Chromium/P7A 来增加绿色 gate。
  全部 `src/`、`e2e/`、migrations 与 reviewed head 无 diff；P7A 五项 frozen hashes + lock
  和 L1b frozen contract hash 不变。
- 原始 D1 / post-fix receipt 字段保持原值，原 33 项 artifact hashes 核对；新 33 项 raw artifact
  index 追加于 [machine receipt](./p7b-1-l1b-evidence.json) 的 `continuation`。
  原始 request/state/screenshots、DB 与 logs 只保存在 ignored
  `D:\Morpho\output\playwright\p7b-l1b\`。所有服务已停止，55432–55436 无 listener。
- Remote schema/migrations 未核实、无 production fault injection、无 hosted Kong/Vercel path、
  Windows Auth compatibility shim、无真实 Provider quality/billing、无 L2/L3/L4 等 limits 保持。

复现当前 C first-divergence，在 clean task source / 已准备的 isolated tools 上执行：

```powershell
node scripts/verify-p7b-l1b.mjs temp/p7b-l1b-tools --slice=C
```

当前应非零退出并保存 C product blocker；D–G `not_run`。本轮没有接线或执行后续场景来寻找
第二问题，也没有修 P7B-1-D2。

## D1 bounded fix / post-fix rerun（2026-10-04）

- Fix commit：`1f410e4553d89447cfb934590e0a00979dc75ee6`。
  产品改动仅为 `requests/handler.ts`、`agentTurnProviderRequest.ts`、`externalResultStore.ts`。
  将原 client `providerRequest` 的 canonical SHA-256 durable 绑定到既有 result JSONB
  `requestContentSha256`，在 Text POST 返回或重新 publish escrow 前校验 identity + 内容。
  Object keys 排序；数组顺序、原文本、continuation、task/capability 与 optional presence 保留。
  Digest namespace 为 `morpho-a-plus-client-request-content-v1`，不依赖当前 Provider wire/config。
- Exact replay 直接返回原 manifest，不加载 config，不调用 acquire 或 Provider；config
  unavailable / changed 的 deterministic regressions 通过，model/cache 不参与内容 digest。
  Changed/malformed content → `409 request_id_conflict`，无旧 manifest、无 execution grant，
  原 Journal/effect/result 不变。Legacy/missing proof → `503 request_content_identity_unavailable`，
  不推定 exact、不回填或重新执行；原 same-effect GET 仍可取回旧结果。
- 无 migration/Workspace/Journal schema、effect/result identity/version/hash、24h retention、ACK、
  Provider retry 或 P3S stop-loss 变化。P7A D1/D2、Recovery exact body/durability source 未改。
- 原 frozen contract SHA-256：
  `c039b8dc1b70561fbddd476b9a6f96a98cbb6f9bb0f716b21fd1b6354e024e1f`，保持不变。
  P7A 五项 frozen hashes 与 contract lock 不变。
- Clean executed source：`cf01f4880b9767c0704e6c606e5fedfd9f186bbb`（仅追加 harness expiry
  projection 修正，产品文件与 fix commit 完全相同）。新 run：
  `2026-10-03T16-06-38.215Z-33192`；build `9zqRzkwOLYFime3aEEdHw`；
  source-tree SHA-256 `e4d57dec930c6e30c9d65abda998e9d2f6ce61efce9652598c7dc75ffa8f60e9`；
  artifact SHA-256 `5ac6d694777ac480bcc5640022a1faba53b0a4f8dab44ba9276a790f5be714d6`。
- Real A **pass**；B first execution / exact completed replay / changed-body conflict **pass**：
  changed body 返回 `409 request_id_conflict` 且无 result；前后 Journal/effect/result facts
  完全相同；Provider stub executions **1**；没有下一 product divergence。只执行 A/B。
  Harness overall 保留 `inconclusive`，`boundedSlice.verdict = pass`，不代填 C–G。
- Gates：focused **3 files / 67 tests**；P3A/P3B/result/Recovery adjacency **21 files / 439 tests**；
  P3A SQL **22 checks**、P3B SQL **53 checks**（本地实际 migrations/RPC）；typecheck、lint、
  clean strict production build、diff check **pass**。Full unit / full Chromium / P7A trajectory
  本轮未机械重跑；无 client UI 或 frozen trajectory 改动，相邻回归覆盖本次产品边界。
- Paid Provider calls / cost **0**；production DB/schema/data 写入 **0**。
  原 D1 failure 的 21 项 raw artifact hashes 全部核对，原 machine receipt 字段逐项保持原值；
  [machine evidence](./p7b-1-l1b-evidence.json) 的 `postFix` 追加新事实与 12 项 artifact index。
  所有新增 raw artifacts 仅留 ignored `output/`，服务已停止，55432–55436 无 listener。
- 首轮 post-fix diagnostic `2026-10-03T16-04-53.595Z-32880` 也保留：新增 assertion 将 RPC
  manifest 与未附 expiry 的 DB manifest 直接比较而停止，未到 changed-body check。
  这是 harness representation error，raw verdict 虽写 `product_blocker`，经 SQL 第 343 行确认
  应归类 `invalid_run`，不是新产品 divergence。`cf01f48…` 比较 DB manifest + 原 expiry column，
  未改 SQL、冻结 contract 或 expected facts；修正后才形成上述 A/B pass。

## 原始执行记录（2026-10-03，历史事实保留）

**PRODUCT BLOCKER：P7B-1-D1。A pass；B fail；C–G not_run。**
原轮 P7 overall 继续 `validating`，P7A complete / web accepted；未修产品、未 merge main。
P7B-2 real text、P7B-3 real image、P7C/L4 human handoff 未开始。

## Identity 与实际环境

- Fetch 后 actual main/base：`f852578f0d1303ff074f66db1e3919c3218a5561`。
- Task branch：`codex/p7b-l1b-real-boundary`；唯一主工作树 `D:\Morpho`。
- 实测 clean source：`65a67f742e63f408d66df077548ce39bb7726628`；production build
  `CMj0-zucTMYPesfo_Fnw5`；source-tree SHA-256
  `961eb33e3170809af33eef9043d5a4bebcf0c9755d7f1f493edf9fbfb487ebf8`；artifact SHA-256
  `dda6751f417c75bb7649e45d95f650ebc2320a5def2c3afdaae74f6de2256a07`。
- [Frozen scenario contract](../../e2e/eval/p7b-l1b-contract.json)；
  [机器 verdict、最小 Journal facts、migrations / tool hashes、全部 run index](./p7b-1-l1b-evidence.json)。
- Real HTTP → unchanged Next production A+ route → real SSR Auth cookie / privileged client →
  official PostgREST 16.4 → isolated native TCP PostgreSQL 17.10。外部文字 Provider 只有本机
  controlled stub；未用 route/auth/Journal/RPC mocks，也未把 PGlite 重新命名为 L1b。
- Fresh test-owned cluster 中，20 个仓库 migrations 各执行一次；Auth 使用 pinned
  [Supabase Auth v2.197.0](https://github.com/supabase/auth/tree/v2.197.0)，source
  `4eee58f296d9698a1c2c0ae14d7a0b379c7622d3`，75 项 official Auth up-SQL 各执行一次。
  Journal/effect/result schema 与 RPC 均来自仓库原 SQL，没有修改 migrations。
- Auth 是本机 source build：只移除 Windows 不支持的 Unix `SO_REUSEPORT` listener 设置；
  embedded-FS migration discovery 在 Windows 未完整发现 SQL，改由 harness 显式加载 official
  SQL、展开固定 `auth` namespace 后执行 `serve`。Auth/JWT 逻辑未改。这不证明官方 Windows
  支持，也不等于 hosted Supabase / Kong / Vercel 认证链已验证。
- DB / Auth / PostgREST / gateway / Next ports：55432 / 55434 / 55433 / 55435 / 55436，全部
  loopback；Next socket guard 在 admission 前拒绝非 loopback。Auth/PostgREST/Next 使用 whitelist env，
  无真实 Provider / service-role credentials；测试 JWT 只在内存及必要的本机 build 中使用，
  不进入 Git 或日志。独立 DB 及真实 Auth credentials 仅为本轮合成账号。

## Remote / local preflight

Supabase CLI `2.118.0`，`whoami` 成功，未保存真实账号标识。初始 checkout 没有 linked ref；
public config 指向 production `lprakizddwqqeytpuavb`。Project inventory 仅发现该 production
project，branch inventory 为空。本机未发现 PostgreSQL/PostgREST/Auth 服务、Docker/Podman，
CLI local status 也报告 container runtime 不可用。没有部署/调用 Vercel production application。

MCP `list_migrations` 与 SELECT-only catalog query 都因 `postgres` authentication failure 失败。
CLI `migration list --project-ref` / `db query --linked --project-ref` 虽意图只读，却内部先请求
login-role initialization，因 `supabase_admin` authentication failure 失败。没有成功的远端
SQL connection / login-role creation 证据；未绕过错误、修复密码/schema、push/repair/reapply
production migrations。CLI 留下的本轮 ignored link metadata 已还原到初始无 linked ref 状态。

因此 **remote migration count、P3A/P3B 是否 deployed、真实 remote tables/RPC/grants 均 unverified**。
Runbook 历史的“18”不能作为当前远端事实。20 仅指当前仓库及本轮隔离 DB，不声称 production
也是 20。Production 用户数据/schema/migration 未执行写入；失败的 CLI 内部初始化请求单独披露。

## 原始场景结果与 first divergence

| Scenario | Verdict | 实际证据 |
|---|---|---|
| A authenticated Turn / isolation | pass | 无 session 401；真实 session create/query 200；创建重放同 Turn ID；private Journal 行已 durable；错误 owner/project GET 404；authenticated 直接 privileged effect RPC 403 |
| B exact Text identity / result replay | fail | 错误 owner/project POST 404；原 requestId/sequence/hash、Provider execution、published escrow 与 exact replay 均通过；**完成后 changed body 返回 200 原 manifest，而非 409** |
| C durable client persistence / reload | not_run | 首个产品 blocker 后停止；没有用 P7A 或 unit 代填真实边界 coverage |
| D ambiguous execution | not_run | 同上 |
| E cancel intent / late observation | not_run | 同上 |
| F full escrow / ACK / conflict / partial / unavailable / expired | not_run | B 仅观察 published escrow + exact replay；未执行完整 F，未声称 ACK/recovery 成功 |
| G Compaction | not_run | 同上；未重跑 P7A trajectory |

First divergence **P7B-1-D1 / P2 / product — Text route completed-result replay ordering**：

1. Turn `aeeeb3b7-dbf0-4678-b470-0a464242d506` / project `p7b-isolated-project`；
   request `l1b-text-request` / sequence `1`。原 Text POST 完成并 escrow，exact replay 200，
   Provider stub POST 总数始终 **1**。
2. 仅替换 Provider user text，保持上述 identities。原/changed body hashes 不同，冻结期望为
   409 conflict，实测为 **200**，返回相同 `resultId/version/sha256` 的原 manifest。
3. Before/after Journal、effect、result facts 完全相同；原 request hash 保留，未新增 execution
   或覆写 result。问题是把 changed-body request 当作有效完成重放，而非重复付费。

归因：[`requests/handler.ts`](../../src/app/api/ai/agent/turns/[turnId]/requests/handler.ts) 的
118–126 行在 Provider request parse、server hash 计算和 `acquireAgentTurnRequest()` 冲突校验
之前，按 effect identity 调用 escrow 并直接 `return existing`。这解释了已 published 后为何
绕过 body validation；原有 concurrent changed-body unit 场景发生在没有完成 escrow 时。
该 early-return 来自 P3B `c86f1dc0`，本轮及 P7A history rewrite 没有修改该产品 source。
没有执行客户端 apply，故不宣称已观察 Workspace 错写；没有证明 Compaction/Image 同类场景。
**保留原失败，未修产品，不继续 acceptance 或寻找第二问题。**

## Setup attempts 与 gates

所有 setup failures 和原始 results 保留，不挑最好结果：原 Auth Windows compile 缺 Unix symbols；
两个 readiness attempts 缺 Windows `libpq` 搜索路径（修正 child PATH，无全局修改）；首次 full
run 的 build 扫描临时 Go vendor TS，记 invalid_run；第二次 build 已通过，但 Auth migration
discovery 不完整导致 signup 失败，记 invalid_run。修正这些独立 setup 原因后，第三次 full
run 首次真正进入 A/B，立即保留产品失败。场景没有自动 retry。

- P3A/P3B / routes / privileged auth / Coordinator / Runner / Recovery adjacent：**19 files / 390 pass**。
- Typecheck、full lint、clean production build、`git diff --check`：**pass**。
- Non-loopback guard negative check：connection admission 前拒绝。
- `src/`、既有配置与 P7A contract/fixture/oracle 无 diff；五项 frozen hashes 不变。
- Full unit、normal Chromium、P7A T2→T4：本轮 not_run，无产品/UI/依赖合同变更，不机械重跑。
- Paid Provider calls / cost：**0**；controlled stub POST：**1**。

Raw evidence / DB data / build/server logs 仅在 ignored
`D:\Morpho\output\playwright\p7b-l1b\`，正式失败 run 为
`2026-10-03T14-54-29.089Z-22228`；temporary binaries/source/cache 在 ignored
`D:\Morpho\temp\p7b-l1b-tools\`。Git 仅保留 harness、frozen scenario expectations、最小文本
facts/metadata/hashes。本轮服务已停止，55432–55436 无遗留 listener。

## 最小复现准备

需要 Node/npm、Go 1.26.7 和 Windows x64；不安装系统服务，不创建 Supabase cloud project。
只在独立的 ignored `temp/p7b-l1b-tools` 目录准备以下 pinned 工具：

1. 从 repo root 执行 `npm.cmd install --prefix temp/p7b-l1b-tools --save-exact embedded-postgres@17.10.0-beta.17`。
2. 官方 [PostgREST v16.4 Windows zip](https://github.com/PostgREST/postgrest/releases/tag/v16.4)
   解压到该目录的 `postgrest/`；archive SHA-256 必须为
   `29a5b56e5a09b7168bb552ef14aa7ade40bf0a81dd0687cffa86610187b89d78`。
3. Clone pinned Auth source 到 `node_modules/.l1b-native-tools/auth`，verify 上述 source SHA。
   `cmd/serve_cmd.go` 删除 `syscall` / `golang.org/x/sys/unix` imports；将 `lc := net.ListenConfig{...}`
   中仅用于 SO_REUSEPORT 的 `Control` block 换成空 `net.ListenConfig{}`。保留认证代码。
   将 per-process `GOCACHE` / `GOMODCACHE` 设在临时 `node_modules/.l1b-native-tools` 内，
   `CGO_ENABLED=0`，执行 `go build -buildvcs=false -ldflags "-X github.com/supabase/auth/internal/utilities.Version=v2.197.0" -o <tools>/auth.exe .`。
   原始/补丁文件和实际 binary hashes 在 machine evidence；不保证另一台机器 binary byte-identical。
4. 在干净的执行 source commit / task tree 上运行：

```powershell
node scripts/verify-p7b-l1b.mjs temp/p7b-l1b-tools --slice=AB
```

Harness 自行创建新隔离 cluster、执行真实 SQL、clean build / start、取得真实 Auth session、
运行冻结 A/B 并 teardown。`--slice=AB` 在 A/B 均通过时 exit 0，同时 overall verdict 仍为
`inconclusive`；失败保留原 first divergence 并非零退出。只有 A/B 第一切片已接线；
C–G 明确排除，不宣称全层通过。不带该 flag 时，inconclusive 仍非零退出。
当前 bounded D1 fix 完成后停止并等待网页复审，不继续 acceptance 或 cloud rollout。
