# P7B-1 — L1b real routes / Journal / RPC（2026-10-03–04）

**当前：P7B-1 L1b web ACCEPTED / closed；A–G accepted PASS；D1–D6 accepted / closed。**
P7 overall 继续 `validating`；P7B-2/P7B-3/P7C / L4 `not_started`。
以下全部 blocker / fix / diagnostic / raw verdict / limits 保持历史事实。

## Final web acceptance / docs-only closeout（2026-10-04）

最终 reviewed implementation/evidence head：**`2ded556fba53bacd4f951ae65717290b3cf31c8f`**。
用户网页最终复审接受 A–G 和 D1–D6，范围仅为 isolated real L1b routes / Journal / RPC。
Fetch 确认 task local/remote 都为 reviewed head，main/origin/main 均为
`f852578f0d1303ff074f66db1e3919c3218a5561`，ahead34/behind0，唯一 worktree clean。
本次只有 report / evidence / Program Map 的 docs-only closeout；通过 ff-only 保留原34个逻辑
commits，并按用户授权 push main，不 squash/rewrite。实现、SQL、migration、frozen contract/oracle
保持 reviewed tree；不因 docs-only closeout 重跑 full unit / Chromium / L1b。
此接受不扩展到 P7 overall、production、real Provider、hosted boundary、T1/T3 full execution、
production Journal fault injection 或 L2/L3/L4；paid calls=0，后续 package 未开始。

## D6 bounded Runner fix / complete G-only rerun（2026-10-04）

Fetch 确认 task reviewed head `dcde637670c898c1ede6474a6e5007acb8024986`、main
`f852578f0d1303ff074f66db1e3919c3218a5561`、工作树 clean。用户已接受 D1–D5、A–F、G6。
Fix / clean executed source：**`ca6ea44d17a2440357df1914b83e4ddbc8feea40`**。

产品修正仅在 `agentTurnRunner.ts`：利用既有 `metadata.compaction.mode === "manual"`，原 action
收敛后复用 fresh manual finalization（完成消息、canonical finalize、实际 Workspace save、Recovery
flush、原 result ACK）。Manual-only Recovery 不进入 generic Text Provider driver，不分配 Text
request identity。已经 applied/durable 的原 Summary 直接复用，保留原 delivery 以完成 ACK。
Lost ACK 时原 ACK outbox 和 applied Recovery 都保留，只重试同一 ACK；本地 durable 与现有 ACK
contract 满足后才清理。没有第二套 manual state machine，也没有 Lifecycle、SQL/schema/migration、
Recovery version 或 Provider retry 改动；automatic/preContinuation 的原 resume phase 保持。
D5 exact/changed-content proof、D1 Text replay 及 immutable Journal/result 合同未修改。

Focused/adjacent **10 files / 386 tests pass**，包括七项新 Runner regression：initial response loss
reload、already applied/durable checkpoint reload、Summary save failure、lost ACK retention/retry、
applied Recovery flush failure、automatic 与 preContinuation 正常 Provider continuation。
ACK route fixture 每次直接核对 durable Summary / applied Recovery / exact ACK body，manual tests
每次 Recovery save 都确认没有 active Text request。D5/D1 route、CompactionOrchestrator、Lifecycle、
Coordinator、RecoveryStore 与 result/action clients 相邻回归保持通过。
Typecheck / full lint / clean production build / diff check pass；未机械重跑 full unit/Chromium/P7A。

**Real G-only run `2026-10-04T12-20-22.582Z-11124`**：build `Kc0zEWVZFFh2qk1yPva7w`，
DB identity `5ebb52e4-7137-49ba-a7e5-26b4e15d4440`；source-tree hash
`dd13f67f842a4ab766844e125615e4d3e1b2859e8254735e7892255c23a6a298`，artifact hash
`4a62324d6432c02e11d2ab4d986bfb0811e8bc80f144955485dab8c62c6c74d2`，`isDirty=false`。
Fresh isolated real Auth/PostgreSQL/PostgREST、production Next routes/RPC、native Chromium client，
controlled local Provider，沿用原 G contract / source/base / save / crash / ACK faults。

- **Original manual Summary / recovery / ACK pass**：原 intent、exact body/source/base 均在 POST 前
  durable；initial response loss 后 reload 仅恢复原 action/result。Client Compaction POST **4**，
  每次 body 与原 IndexedDB payload 完全相同，Provider execution **1**，Text `/requests` POST **0**，
  Journal Text request rows **0**。
- Actual Summary save failure：ACK **0**、durable pointer 仍为旧 base。Storage 恢复后只创建 **1** 个
  new Summary（含原 base 共2 revisions），crash/reload 继续复用同一个 revision。
  每次 ACK attempt 捕获的 Workspace Summary 与 applied Recovery 均已 durable。
- ACK attempts **3**，全部同一 resultId/version/hash；crash barrier 前的 attempts 未发 native ACK。
  最终原 result `acknowledged_at` 为 `2026-10-04T12:21:37.681Z`，canonical local outcome
  **completed**、无 Text activeRequest，随后 Recovery clear **1**。Lost ACK response 的 same-ACK
  retry/retention 另由 deterministic Runner test 验证，不冒充本轮实时丢失了 ACK response。
- **Source changed pass**：原 external success 保留，本地 `compaction_source_changed`，不 overwrite，
  ACK **0**；**base changed pass**：`summary_revision_conflict`，不应用旧结果，ACK **0**。
  两个 case 各 original execution **1**，没有第二个 execution。
- **Intent persistence failure pass**：native Compaction POST / Provider execution **0**。
- **G6/D5 pass**：changed content 返回 **409** 且无旧 manifest；exact 与 canonical equivalent replay
  返回同一 manifest，原 Journal/action/effect/result 不变，零新增执行。

全部四个 G case pass，G1–G7 coverage complete；**firstDivergence=null**，本轮无 D7。
所有 case 的 Text request POST **0**；controlled local executions 总数 **3**（每个合法 action1）；
paid Provider/Search/Image calls / cost / production data/schema writes **0**。

原 D6 run **`2026-10-04T11-59-25.097Z-27012`**、原 D5 与全部 diagnostic raw verdict/artifacts 保留；
273 项 prior artifact hashes/sizes 全部不变，新增24项 index 见
[machine-readable D6 receipt](./p7b-1-l1b-evidence.json) 的 `d6Fix`。Frozen P7A files/lock、L1b
contract、20项 migration hashes 完全一致。新增 raw artifacts 只在 ignored `output/` / `temp/`，
隔离服务已停止；本轮没有 harness/fixture/oracle 改动。

G-only command 的 raw overall **inconclusive / exit1** 保留：A–F 是 accepted predecessor receipts，
本轮明确 `not_run`，而 G=`pass`。不能声称本轮重新执行了全套 A–G；accepted A–F + complete G
足以将 P7B-1 记录为 **L1b complete / awaiting web acceptance**。P7 overall 仍 validating。
T1/T3 full execution、remote hosted boundary、production Journal fault injection、L2 real model、
L3 real image、L4 human handoff 仍未验证/未执行。未 merge main，不开始后续 package，停止网页复审。

## D5 bounded fix / G-only rerun（2026-10-04）

Fetch 确认 reviewed task head `e9fad50e53d5d9aeb430cb0608518d1a64edfe55`、main
`f852578f0d1303ff074f66db1e3919c3218a5561`、工作树 clean。Fix：
**`97dd399fa502cb5c4a461cf1cfe8e3c74739664e`**。

Compaction POST 对 validated bounded client body 计算 domain-separated canonical SHA256，保存到
既有 result binding JSONB 的 `requestContentSha256`。递归 object key 排序，array/source order 与
精确 body 保留；optional previousSummary / expectedPreviousRevisionId 的 absent/null 归一化。
在返回或 publish escrow **之前**核对 proof 和 Turn/project/request/sequence/action identity，仍在
当前 config/cache/model 加载之前。Exact historical replay 只返回同一 immutable manifest，不 acquire
或执行 Provider；changed content 为 **409 external_action_hash_conflict**，无旧 manifest；
missing/invalid proof 为 **503 request_content_identity_unavailable**，不 delivery / publish。
原 actionHash/acquire conflict、immutable result、D1 Text contract 保持；无 SQL/schema/migration、
record version、Provider retry 或 generic paid retry 变更。

Deterministic focused/adjacent **11 files / 277 tests pass**：exact same result / no execution、changed
messages/body/order/membership/source endpoints/previous Summary/base identity、canonical nested keys、
absent/null equivalence、staged/published missing/invalid proof、当前 config changed/unavailable 均覆盖，
并保留 Text D1、Journal、Compaction apply、Recovery/Runner 与 Image/client delivery 相邻回归。
Typecheck / full lint / modified harness syntax/lint / diff check pass；本次两个 real G source 均 strict
clean production build pass。没有机械重跑 full unit、P7A 或 full Chromium。

有效 **G-only run `2026-10-04T11-59-25.097Z-27012`**，clean executed source
`9c8734acd80a054397048eaa995b91ce2f05bc9e` / build `vXdCYOk7oioeolOGNyLTn`；
source-tree hash `057bfe9596b96d79119bf284100d21888620f62934459acbf8536db599730ec7`，
artifact hash `a92ee451f13685c208f00f4dfde7f3052985c779bd8c506fc414cd8edc0c8975`。
DB identity `5d265d69-c15f-48f1-b47b-d958acee6107`。使用 real Auth / PostgreSQL /
PostgREST / production routes / RPC，controlled local Provider。
未重跑 A–F；原 D5 run **`2026-10-04T11-32-20.442Z-27396`** 完整保留。

- **D5/G6 pass**：same identity changed source 返回 409 且无 manifest；exact 与 canonical equivalent
  replay 返回原 manifest，原 action/Journal/effect/result 未变，Provider execution **1**。
- Lost initial response 后 reload 使用同一 exact durable Compaction body/action/source/base；native
  Compaction POST **3**，全部 body 与 IndexedDB payload 相同，外部 execution 始终 **1**。
- Actual local Summary save failure 时 ACK **0**、durable pointer 仍为旧 base。恢复 storage 后只创建
  **1** 个新 revision，后续 reload 复用同一 revision（总 revisions=2）。每个 ACK attempt 捕获的
  Workspace Summary 与 Recovery `summaryApplyState=applied` 已 durable。
- ACK attempts **3**、identity/body 全部相同；前两次由 crash barrier 阻塞。停止时原 result 的
  `acknowledged_at=null`，最终 attempt 尚无 Server receipt；不声明成功 ACK convergence。

**P7B-1-D6 — reloaded manual Compaction falls through to a new Text Provider request**：

Turn `36b56fe5-ff9c-4243-b2cc-e7ba90b32264`，原 request/action
`compact:manual:1fe74f43-a5b4-461c-87ae-402679065264` / sequence 1。
新 Summary `conversation-summary-v3-13e66984634216cdc6c9fd9649d7cfd87be9bdfd259b3a93fc4a139a5e5389eb`
已保存，但在 `summary-durable-before-ack-crash` checkpoint 已出现一个无用户授权的 Text
`/requests` POST：新 request `ee530869-1f76-45bb-ac1b-e07c88785018` / sequence 1。
Server 返回 **400 invalid_provider_request**（manual runtime input=[]），没有 Journal request row
或第二次 execution。最终 canonical local outcome 为 `partiallyCompleted` / terminal fault，Recovery
被 clear；不是成功完成的 manual-only recovery。

最小边界：`recoverMorphoAgentTurn()` 对 manual Recovery 进入通用 `driveSessionSerialized()`；
`recoverInterruptedCompaction()` complete applied Summary 后恢复 `requestingProvider`；通用 driver
的 created/requestingProvider 分支调用 `startInitialRequest()`。Initial manual path 有专用 finalize，
reload path 没有保持这项 manual-only ownership。原 action/effect/result success 与单次 Summary apply
仍保留；此处未观察到第二次 paid execution，也不将缺少 ACK receipt 另报成独立缺陷。

已 first-divergence stop，**未修 D6**。Source/base-changed 与本轮 intent-failure case 未执行；完整
G recovery/ACK convergence 未接受。原 G1 零 POST 证据继续保留，但不冒充本轮执行。

Calibration run `2026-10-04T11-54-13.770Z-26064` 为原始 `invalid_run`：测试注入器对 Recovery
exact replay 也重复丢失响应，导致等待 Summary save-failure 超时。真实两次同 body POST 均 200 /
same manifest、execution1。仅 harness commit `9c8734acd80a054397048eaa995b91ce2f05bc9e` 将 loss
限制为第一次响应；不改产品、expectation、timeout 或 storage/ACK fault。原 raw verdict 未覆盖，
新增 calibration receipt。该 diagnostic 与有效 G 各 stub1，本轮 controlled executions 共 **2**；
paid Provider/Search/Image calls / cost / production writes **0**。

248 项 prior artifact hashes/sizes 全部不变，新增 25 项 index 与 D6 最小文本证据见
[machine-readable D5 receipt](./p7b-1-l1b-evidence.json) 的 `d5Fix`。Frozen P7A files/lock、L1b
contract 与 20 项 migration hashes 完全一致。Raw screenshots/state dumps/logs 只在 ignored
`output/` / `temp/`；隔离服务已停止。Hosted/production boundary、real L2/L3/L4 等原 limits 保留。
P7B-1 仍 incomplete，P7 validating；未 merge main，停止等待 D5/D6 网页复审。

## F/G continuation / first divergence（2026-10-04）

Fetch 后 reviewed branch head `73173b8dab5e48bdbbceb8a36cb70672a5fe62e6`、main
`f852578f0d1303ff074f66db1e3919c3218a5561`、工作树 clean。用户确认 D1–D4 closed 与 A–E
accepted；本轮没有重审/重跑 A–E，只增加 Eval F/G harness，产品/SQL/schema/config 不变。

**F = pass**：run `2026-10-04T11-13-33.951Z-27352`，clean source
`20c6a46aab633c3b686441f50966f7247137486d` / build `aGwg_5kwdrU0Qx7hzjW_t`；DB identity
`8dddce1a-10c5-439e-ada6-01dfdf0bc7da`。Actual native client → production Text/result routes →
real Auth/PostgREST/PostgreSQL/RPC；original Text execution **1**、client request POST **1**。

- Immutable original manifest/binding、195-byte envelope、chunk count/hash 和 repeated GET 均一致。
  Published conflicting chunk/manifest/source binding fail closed，原 Journal/result 不变。
- Wrong result/hash/effect/user ACK 拒绝；version≠1 和额外 project/request 字段由当前 bounded parser
  拒绝。ACK 只承载 resultId/version/hash，没有独立 project/request authority。
- 实际客户端最终保存失败时 ACK **0**，原 verified IndexedDB envelope 留在 Recovery；reload 后
  durable final conversation / canonical persistence / Recovery 均在 ACK 前。Lost ACK response 导致
  **3 次同身份 client ACK**，没有新的 request/result/execution；显式 exact duplicate ACK 亦保持
 同一 acknowledged timestamp 与 Journal，无第二次语义 mutation。
- 独立 service-owned staging fixture 通过真实 privileged RPC：cancellation tombstone 不发 execution
  grant；524,351 bytes / 2 chunks，缺 chunk 时不可 publish/GET/ACK，完整后只发布同一结果。
- 仅 test-owned retention clock 提前 `expires_at`；真实 cleanup / routes 返回 **410**，清理 chunks/
  binding，原 manifest / execution tombstone 保留，不能 prepare replacement 或重新生成。

**G = fail / D5**：run `2026-10-04T11-32-20.442Z-27396`，clean source
`0c5ba9b25782670df32ab4f673f93036d2dc096c` / build `V3pUizLCEsW9sqezXfLcZ`；DB identity
`6d328b0f-e8b8-4783-a6ac-9a7d3ff78887`。G1 durability failure 的 actual client Compaction POST /
Provider POST 均 **0**。正常原请求的 action descriptor、exact IndexedDB body/hash、source range/hash、
expected previous revision 在 POST 前真实 durable；Provider execution **1**，Summary escrow 为
491 bytes / 1 chunk，validated payload/hash 与同身份 completed replay 均正确。

**P7B-1-D5 — completed Compaction escrow replay bypasses action/source content conflict validation**：

- Turn `d9011fb5-5d21-4d3f-b08e-519fde95a154` / project `p7b-G-original-summary`；request/action
  `compact:manual:d5494a85-bc5d-4bd1-b39c-04293dc2cfb3` / sequence `1`。
- 原 request body SHA `8eb15f5bc68689c3c3f395ccd1995c5096dc19907cc07c42fe73bde3c48186a2`。
  只改变 `G-history-2.body`，身份与 base/source endpoints 不变，changed body SHA 为
  `1c587c36152ef4b15c0903fb23a4c5fa1ff11a7253ecae6e6424c496dc70a851`。
- Expected **409 / conflict**，actual **200** 并返回 original result
  `result:033a0e5665f39ce822fc956d4c22a0ff360414dcad4d015589c75b469f91525f` /
  version `1` / SHA `02219c5e407202f97f58a635e99e6087097da7cc765f53513f9ddd2b09de7f37`。
- 原 action Journal **externally_completed** / effect **succeeded**，原 action hash、attempt、Provider
  digest、result binding/manifest 全部不变。没有 duplicate execution 或 payload overwrite：Provider
  execution/counter **1**，native action POST **1**，ACK **0**，旧 local Summary pointer 未改。
- 最小 boundary：`actions/compaction/handler.ts:78–79` 在 current content proof 前返回 existing escrow；
  `:129` 的 actionHash 计算和 `:140` 的 acquire/hash conflict guard 均未执行。
  这是完成后 replay 的 content validation 缺口，不把它写成 Provider 生成失败或已发生 stale apply。

在 G6 的首个 genuine divergence 停止，**未修产品**。G2 完整 crash/reload、G3 完整 redelivery、
G4 source/base currentness、G5 failed save/durable-before-ACK、G7 dedupe 剩余轨迹均 `not_run`。
没有收集或修复第二个 blocker。D5 等待网页 bounded review；P7B-1 overall 未 PASS。

Invalid/diagnostic runs 全部保留，原 raw verdict 未覆盖：

| Run | Exact reason | Recorded stub executions |
|---|---|---|
| `2026-10-04T09-37-07.087Z-33172` | 执行被中断，仅 environment/build logs；无 finalized verdict / F checkpoint | not recorded |
| `2026-10-04T11-20-12.981Z-3040` | harness 读取不存在的 descriptor.requestPayload；实际 metadata.pendingExternalActionPayload SHA 已与 POST 一致 | 1 |
| `2026-10-04T11-22-33.929Z-21304` | controlled Summary fence/顶层包装不符合当前 parser，产品正确拒绝，未发布 | 1 |
| `2026-10-04T11-26-28.420Z-26568` | preflight 严格 JS 比较把 optional undefined 与 wire omitted 判为不同，尚未启动 Provider | 0 |
| `2026-10-04T11-29-20.432Z-5668` | harness 对 native relative URL 未提供 baseUrl，replay 前 Invalid URL | 1 |

前三项 G diagnostic 的 raw `product_blocker` 是 harness assertion 分类，附 `calibration.json` 说明为何
不能计为 genuine product divergence；raw verdict/artifacts 不修改。所有修正仅限 harness/setup/fixture
校准，未改变 frozen expectation。最终 Summary fixture 已通过 standalone actual parser/domain preflight。
有效 F/G 各 **1** 次 controlled Provider，G diagnostic 记录 **3** 次；interrupted F aggregate 未记录，
不虚报完整 aggregate。Paid Provider/Search/Image calls / cost / production writes 均 **0**。

Modified harness syntax/lint、meaningful F/G strict clean production builds、diff check pass；
176 项 prior artifact hashes/sizes 不变，新增 72 项 index 保存在
[machine-readable receipt](./p7b-1-l1b-evidence.json) 的 `fgContinuation`。Frozen P7A files/lock 与 L1b
contract hash、20 项 migration hashes 不变。没有机械重跑 full unit/Chromium/P7A 或扩大 SQL 验证。
Raw artifacts 只在 ignored `output/playwright/p7b-l1b/` / `temp/`；所有隔离服务已停止。

Limits 保留：remote hosted migration/schema independently unverified；无 production Journal fault
injection、hosted Kong/Supabase/Vercel boundary；local Windows Auth single-listener shim；controlled
Provider only，无真实 billing/quality 或 L2/L3/L4 evidence。P7 validating；P7B-2/3、P7C/L4
not_started；未 merge main，停止等待 D5 网页复审。

## D4 bounded client fix（2026-10-04）

只改 Lifecycle / Coordinator / Runner：取消中的 exact original Provider output 可以被观察，phase
继续 `cancelling`，外部状态按原 Journal 收敛。Canonical cancellation fact 冻结取消前 Provider effect，
迟到交付本身不把 local cancelled 升为 partial；此前已提交 Tool/其他效果继续按既有 partial 规则处理。
迟到 Tools 只保留在原 envelope，不创建 batch、confirmation 或 continuation。
最终 cancelled/result conversation 先 durable 保存 Workspace，再发布 canonical persistence/finalization、
flush Recovery，最后 ACK 同一 result。保存失败保留 cancellation-owned recovery 与原 envelope；reload
只查询原 Journal / 重试本地保存，不分配新 request，也不重新执行 Provider。
没有 SQL、migration、Journal/result schema、record version 或 retry-policy 变更。

Fix / clean executed source：**`7c3e4c2d1a37b29b20aa38bb94b0b7c944308390`**。
产品文件仅 `agentTurnLifecycle.ts`、`agentTurnCoordinator.ts`、`agentTurnRunner.ts`；
focused/adjacent **14 files / 477 tests pass**，含 wrong request/sequence/Turn/project、late Tool/Tool-only
抑制、save failure → failed reload → successful reload、实际 payload-store roundtrip、先 durable 后 ACK、
既有 local Tool partial outcome 和 D1/D2/D3 回归。Typecheck / lint / syntax / diff check pass。

Real E-only run：**`2026-10-04T09-21-57.249Z-31764`**；strict clean production build
`LyX0TsD0-NTKR4lUlccg9`；source-tree hash
`569a9a08c6d5354e6163d091e0726e878ad0ad33bdeef0905d947780b4dc03b9`；artifact hash
`1bedd7697f4298ed68f720462b6bd86d1817d1c41b1bdb7263a6966a351b0005`。
E1/E2 和 wrong cancellation identity guards pass；E3 原 intent durable 后，原 Provider success /
Journal externallyCompleted / effect succeeded 与 canonical **cancelled** 同时保留。
ACK 时捕获的 durable Workspace 已有原 Text `P7B controlled result` / cancelled conversation，
Recovery 已 terminal / persistence succeeded，随后同一 result ACK **1** / Recovery clear。
没有 illegalTransition、replacement request/grant/execution、Tool batch、confirmation 或 continuation。
本次 real envelope 没有 Tool calls；late Tool-envelope 抑制由 deterministic Runner 和 payload-store tests 验证。

两个独立 real case 各 **1** 次 controlled local Provider execution、**1** 个 request POST（共 2），
paid Provider/Search/Image calls = **0**，production writes = **0**。
无新 first divergence；F/G `not_run`，A–D accepted receipts 仅保留；raw overall **inconclusive** / exit 1
表示 full L1b 未完成，不能报告 P7B-1 overall PASS。服务已停止。
158 项 prior artifact hashes / sizes 全部核对不变，新 18 项 artifact index 见
[machine-readable D4 receipt](./p7b-1-l1b-evidence.json) 的 `d4Fix`；raw artifacts 仍只在 ignored `output/`。
P7 继续 validating；D4 bounded fix complete / awaiting web review；未 merge main，停止本轮。

原 meaningful `2026-10-04T08-51-01.446Z-6776` 与 diagnostic `2026-10-04T08-47-50.176Z-23476`
raw artifacts / 分类 / hashes 保留；post-fix 只运行 `--slice=E`，F/G 仍 `not_run`。

## E continuation / first divergence（2026-10-04）

Fetch 后 local / remote reviewed branch head 均为 `aa7db12ebda07117e7772d04f583da4a7dc6a511`；
main 仍为 `f852578f0d1303ff074f66db1e3919c3218a5561`，工作树 clean。
用户确认 D1/D2/D3 accepted / closed，A–D accepted real receipts 保留，本轮未重审或重跑。

只增加 Eval E harness，使用 native Chromium / actual client Stop → production Next cancel route →
real Auth / privileged PostgREST / fresh PostgreSQL / actual repository RPC → controlled local Provider。
`running-cancelled` stub 显式采用断开后确认取消的策略，最初的 local abort observation 不代表 Provider cancelled。
后续 controlled receipt 由 **test-owned privileged real PostgREST RPC observer** 送达，验证 trusted late
observation；没有新增 browser authority，也不声称真实 Text relay 支持 GET/cancel lookup。

E3 使用 test-owned gateway scheduling barrier：真实 cancel RPC 已写入 intent 后，只延迟其原始响应 bytes，
不改 response/state；释放原 Provider 的 held response，让其成功并 publish escrow / settle Journal，
然后放行 cancel RPC response。该正常竞争轨迹没有手工伪造 Journal/effect/client Lifecycle。

| E trajectory | Verdict | Real facts |
|---|---|---|
| E1 running cancel / E2 late confirmed cancellation | pass | exact intent durable，local abort timestamp 与 Provider state 分离；controlled Provider receipt + privileged RPC 后才 effect cancelled；Journal externallyCancelled，canonical cancelled、ACK/result 0、Recovery cleared、execution 1 |
| wrong cancellation identities（E4 的 cancel guard 子集） | pass | wrong request/sequence/project、old/missing Turn 与当前 project、unexpected effect field 分别 409/404/400；current Journal/effect 不变 |
| E3 late success after durable cancel intent | fail / D4 | server/effect/escrow 成功且绑定原身份；client 从 cancelling 接收原结果时报 illegalTransition，未完成 local cancellation/result 收敛 |
| F / G；其余 result ACK isolation trajectories | not_run | 首个 genuine product divergence 后停止，不代填 coverage |

**P7B-1-D4 — late-success Text reconciliation from cancelling triggers illegalTransition**：

- Turn `2793c56b-5c04-48f5-b246-ee71457d9bb6` / project `p7b-cancel-running-late-success` / request
  `41dfcd42-43f3-4f88-9ad6-917533be9cce` / sequence `1`。
- Effect `effect:7be87839a4b89af14b3355a8113ba1bcea71845760d8fcb321af399c0b23f284` /
  attempt `860b8ce1-771f-4d40-bb3d-d63291041ffe`；frozen Provider digest
  `cd014f4a32635a35155e41125d3250c7ce2689252f39e7c8e8d4676381ee7339`。
- `cancel_requested_at` 在 result publication 前已 durable。Real Journal 为 **externally_completed**、
  effect 为 **succeeded**，没有把外部 success 伪造为 cancelled。Cancel route 返回 accepted=true /
  observed=false，因为原执行已经完成；原 Provider execution / Journal counter 均 **1**。
- Original escrow result `result:b8c2d345dfa3539b8b70c4625fbe66a4d496eb1c6a07e84674b6cdbcf8ca8008` /
  version `1` / SHA-256 `b43c2f15885032f3944565bae0f1513f73a1c84286459b9358b22bd5935d3497`，
  binding 为原 request / sequence / Turn / project。Published result/chunks 的实际 GET 均成功，
  `acknowledged_at = null`，client ACK **0**。
- Durable Recovery 中 `phase = cancelling`、`serverExecutionStatus = providerRunning`、
  `providerOutput.kind = none`，但保存的 `serverSnapshot.status = externallyCompleted`。
  Terminal fault `illegalTransition`：**`PROVIDER_OUTPUT_RECEIVED is not legal from cancelling.`**
  原 active request / Recovery 保留，没有 replacement Request。Meaningful checkpoint 的 durable assistant
  body 仍为空 / streaming；diagnostic run 等待 30s 后仍未收敛，保存了该内部错误文本 / streaming。

最小 boundary：`agentTurnCoordinator.ts:701–712` 在原 Journal 显示 completed 后，先取原 escrow 并调用
`observeStreamEvent(output)`，尚未观察新的 server status；`agentTurnLifecycle.ts:573–590` 只允许
`requestingProvider` 接收 `PROVIDER_OUTPUT_RECEIVED`，拒绝取消竞争中的原结果。
`agentTurnRunner.ts:1308–1333` 记录 terminal fault，但 stale providerRunning 阻止 local terminalization。
**未改产品、不选择新的取消/迟到交付政策，D4 只定位此非法 transition / 收敛缺口。**

Meaningful run：**`2026-10-04T08-51-01.446Z-6776`**；clean executed source
`ec0b05b3e406d9b85dacfd3d9ec96145e543f4d1`；build `V7kHdcv4D3g80ueKC0d_x`；
source-tree SHA-256 `509c87ced1f29237e2de78a7c89cd0e8e463fc2bedba8ba504902fa30d6d3662`；
artifact SHA-256 `238728c5a975fd07a227985c6f9f27fef733901b93a8f81a874b1613b54da8c4`。
Fresh DB identity `cf3befc2-223a-4c43-a578-6900acd4e420`；PostgreSQL 17.10 / PostgREST 16.4 /
Auth v2.197.0，20 项 actual repository migrations hashes 不变。

保留 diagnostic **`2026-10-04T08-47-50.176Z-23476`**：raw `invalid_run`，原因是 generic cleanup wait
超时；实际 artifacts 已记录同一 illegalTransition。校准 harness 为直接断言 bounded client fault 后，
新 run 为 genuine product_blocker，未改 frozen expectation。Diagnostic verdict 未写 aggregate stub count，
两份 per-case final checkpoint 的真实 stub receipts 各 1，完整保留并核对。

Meaningful run stub **2**（独立 requests 各 1），diagnostic **2**，本轮合计 **4**；
paid Provider/Search/Image calls / cost **0**，production DB/schema/data writes **0**。
Modified harness syntax / targeted ESLint、两次 strict clean production build、diff check **pass**。
`src/`、SQL/schema/config、frozen L1b / P7A files + lock 无改动。原 **125** 项 artifact hashes/sizes
核验通过，本轮两 runs 追加 **33** 项 index；全部 D1/D2/D3 blocker/invalid/fix、A–D accepted receipts 原值保留。
Raw 仅在 ignored `output/playwright/p7b-l1b/`；[machine evidence](./p7b-1-l1b-evidence.json) 的
`eContinuation` 保留 attribution / run facts。服务已停止，55432–55436 无 listener。
First divergence 后未扩大 unit/SQL/full Chromium/P7A gate。Remote hosted schema/migrations、production
fault injection、hosted Kong/Vercel、real Provider quality/billing、L2/L3/L4 仍未验证；Windows Auth shim 保持。
P7 `validating`，F/G `not_run`，未 merge main，停止等待网页 bounded review。

## D3 bounded fix / post-fix D（2026-10-04，现已网页接受；以下保留原执行 receipt）

Reviewed baseline `8505374d92fa8d147e0621db938e68469078b819`；fetch 后 remote / local branch 一致、工作树 clean，
main 仍为 `f852578f0d1303ff074f66db1e3919c3218a5561`。
Fix / clean executed source：**`3109be63edbd83a822ee692d4bffdbe71bf6faf6`**。

- 产品仅改 `agentTurnCoordinator.ts`、`agentTurnLifecycle.ts`、`agentTurnRunner.ts`。
  Exact Journal `failureCode` 经 Coordinator → `SERVER_EXECUTION_STATUS_OBSERVED` → canonical
  `serverFailureCode` / outcome reason → durable `agentTurnOutcomeSummary` / assistant detail。
- Allowlist 只接纳 failed 行政状态的 `external_execution_state_unknown`，不透传任意 server 字符串。
  Lifecycle parser 验证并保留 optional detail；旧 records 不补写、不重新解释。Recovery record version、
  Workspace schema、Journal protocol、SQL/migrations 均未变；只有 additive client Lifecycle fact。
- Overall outcome kinds 没有变化；unknown coarse outcome 仍为 `failed` / `failedDuringProvider`，
  canonical reason 和 message summary 为 **`external_execution_state_unknown`**，不再是 generic
  `externalExecutionFailed`。Durable assistant 明确说明无法确认外部执行且停止自动重试；已有文本保留并附加说明。
- Unknown 不驱动 retryable/recovering，不改变 server `externallyFailed` 或 effect `unknown`，不生成 result。
  Detail 成功保存和 Recovery flush 后，既有 terminal cleanup 可清理 Recovery；Workspace save 失败仍保留
  terminal unknown detail / failed local persistence，不 ACK。D2 的 visible Text save-failure 同结果恢复 barrier 保持。
- 新增 targeted regression：Journal-only reload、unknown vs confirmed/absent failure code、原 Request identity/
  no retry、JSON/Recovery restore、旧记录兼容、错误 detail fail closed、保存后 cleanup；D1 replay/content conflict、
  D2 final save failure/recovery、cancellation、Compaction、result/ACK 与 Provider ambiguity 相邻回归通过。
  **13 files / 474 tests**、typecheck、lint、modified harness syntax/lint、diff check **pass**。

Real bounded `--slice=D` run：**`2026-10-04T08-26-45.475Z-25748`**，两子场景均 **pass**，无新 divergence / invalid_run。
Fresh isolated DB identity `fa8d49ab-7d00-4ddd-b72d-2c42bdf82f27`；PostgreSQL 17.10 /
PostgREST 16.4 / Auth v2.197.0，实际 repository migrations hashes 保持，原 Windows Auth shim 不变。
Clean production build `YDzno_xLnnzbXZzLKI2Te`；source-tree SHA-256
`334527f8390cb0c1f552d5bb793cb7cc26f6f416a42da15a8684ccc53c73ad4f`；artifact SHA-256
`59d6813dd031d803f4431907a9aae8c10475ded6187e1be285a558880f61467b`。

| D subcase | Post-fix facts |
|---|---|
| admitted / detach / reload / late success | pass；original request/body durable before POST，query original Journal，exact replay 无新 grant，Provider execution 1，original result redelivery / durable conversation / ACK |
| upstream socket loss / unknown / reload | pass；Journal externallyFailed + unknown code、effect unknown；canonical reason + durable summary 保留 unknown，明确 no retry text；detail durable 后 Recovery cleanup；result 0 / ACK 0 / Provider execution 1 |

Unknown Turn `d7ee3677-1f29-403a-a7ec-5ea2bd66dc10` / request `4c489f5b-3722-4d19-8a50-871578bfa209` / sequence `1`；
effect `effect:e936c8f2b6b5fee5dceaff3465cc83b87a7e6973744e9547112df7b9b23c9930`。
Cleanup entry checkpoint 直接核对 durable Workspace 与 canonical terminal Recovery 的 unknown reason，
之后确认 Recovery 已清理，正确 unknown detail 仍在最终 conversation。
两个 case 各原始 client POST 1 + 显式 exact replay probe 1；原 attempt/digest 保持不变、Provider execution 各 1。
本轮 controlled stub executions 共 **2**；paid Provider/Search/Image calls / cost **0**；production writes **0**。

现有 bounded runner overall 仍为 **`inconclusive` / exit 1**（E/F/G 排除），不表示 D 失败或 P7B-1 overall PASS。
原 meaningful D3 run `2026-10-04T08-05-06.244Z-7940`、setup invalid `2026-10-04T08-01-46.994Z-23244`、
overstrict diagnostic `2026-10-04T08-02-10.954Z-32388` 及所有先前 receipts/raw verdicts 未覆盖或重分类。
全部 **110** 项历史 artifact hashes/sizes 核对；[Machine evidence](./p7b-1-l1b-evidence.json) 的 `d3Fix`
追加本轮 **15** 项 raw index。Raw 仅在 ignored `output/playwright/p7b-l1b/`，服务已停止。
Frozen L1b contract、P7A files + lock 不变；SQL/full unit/full Chromium/P7A 无具体扩大理由，未机械重跑。
P7 `validating`；D3 bounded fix complete / awaiting web review；E/F/G `not_run`，未 merge main，停止。

## 原始 D continuation / first divergence（2026-10-04，历史 receipt 保留）

Fetch 后 branch / remote reviewed head 均为 `b311464285acc80b1300c2dcd953906e7776e647`；main 仍为
`f852578f0d1303ff074f66db1e3919c3218a5561`，主工作树 clean。用户本轮网页复审确认 D1、D2 accepted / closed，
fix 分别为 `1f410e4553d89447cfb934590e0a00979dc75ee6`、`573a83b9b76a8d1e26b57970909ef1fd9cd0f0ef`。
A/B/C 的 accepted real receipts 保留，本轮未重审或重跑。

本轮只接线 Eval Scenario D，沿用 native Chromium / actual client → clean Next production routes →
real Auth / privileged server → PostgREST → fresh isolated PostgreSQL / repository migrations/RPC → local Provider stub。
Stub `held` 在接收 body 后等待；`unknown` 在接收 body 后直接断开 socket，没有返回 deterministic 500。
Client-only receive detach / reload 不修改 server Journal 或 effect。每个 case 另有一个显式 exact-body replay
probe，测试 replay 不再授予执行权；这些 probe 不属于 client automatic retry。

| D subcase | Verdict | Evidence |
|---|---|---|
| admitted execution / client detach / reload / late success | pass | intent/body before POST、reload query original Journal、running request query-only、same-body replay 无新 grant；原执行随后 success，原 escrow redelivery、conversation durable、ACK；Provider execution 1 |
| upstream accepted / response socket loss / reload | fail: P7B-1-D3 | Journal unknown code 与 effect unknown 正确，但客户端丢失 bounded uncertainty，持久化 generic externalExecutionFailed / failedDuringProvider；Recovery 随终态清理 |
| E / F / G | not_run | 首个产品 divergence 后停止；不把 D 中局部 ACK 检查写成 full F coverage |

**P7B-1-D3 — reload drops bounded unknown-execution truth into generic external failure**：

- Turn `c4708092-6158-49f8-8326-46681e3850d4` / project `p7b-ambiguity-unknown` / request
  `8f1bb344-d7da-4dde-bba5-f4cc3155a48f` / sequence `1`。
- Client exact-body SHA-256 `8bff5ec3a64a4768755abe1ac0224383717ae79d5cdc1c9f85819c38ff29adb4`；
  durable Provider body SHA-256 `0cc4f6a90fc6af064b7022e2fc1d79a1c3d6ddb095237a3e65ed71818795a57b`。
  Pre-send Recovery / IndexedDB body 正确；reload 没有创建 replacement Request。
- Real Journal GET 向 client 返回 `status = externallyFailed`、`failureCode = external_execution_state_unknown`，
  effect `effect:17008d0d151ce894091d1aa2f1978d52d279b01709922fdfed823cb0c1b36d31` 保持 `unknown`；
  real effect GET 也确认相同事实。Attempt `e3cefbad-8d30-4969-9b85-d0a3b2755bc1`。
- Reload 后 durable user/assistant 的 `agentTurnOutcome = failedDuringProvider`、
  `agentTurnOutcomeSummary = externalExecutionFailed`；assistant body 为“当前 Agent 回合未能完成。”，没有 unknown
  detail。终态 Recovery 随后清理。Client unknown fact 没有保留在 canonical fault 或 durable failure detail。
- 原 request Provider counter / stub execution 仍为 **1**；显式 exact replay 返回原 snapshot，未获得新 grant。
  此 effect 没有 published result，ACK **0**。没有观察到重复付费、effect registry 假造 Provider failed。

最小 boundary：Coordinator 保存完整 snapshot（`agentTurnCoordinator.ts:701`），但 reconciliation 只把
`snapshot.status` 传入 `observeServerStatus`（735–739），丢失 bounded `failureCode`；随后对 failed 行政状态
`TURN_FINALIZED`（791）。Lifecycle 生成 generic `externalExecutionFailed`（`agentTurnLifecycle.ts:743`），
Runner 只保存 outcome reasons（`agentTurnRunner.ts:1206`）并清理 Recovery（1273）。**本轮未改产品。**

归因边界必须区分：accepted A+ 文档允许以 `externallyFailed` + bounded unknown code 关闭行政 Turn，
这本身不等于真实 Provider failed。Frozen D 的要求是 uncertainty remains explicit。
确认的 D3 是 **client reload 丢失了已经明确返回的 unknown fact**，不能仅凭行政 status 字符串归因。

Meaningful run：**`2026-10-04T08-05-06.244Z-7940`**，clean executed source
`5fc603fe987f45af3b0a02e872415ad5fba9dc56`，build `cuaIy5fESPcJfyK4bzPDU`；
source-tree SHA-256 `55154f510b046122ca4e55fd2edbb8dfdd1dbef21544ebd175415ee73da0f9fc`；
artifact SHA-256 `e2f1333fab3fe0345a3c4dcd892c5b97363d09c1a111f681f53cd775447a8c21`。
Fresh DB identity `a9e45141-4802-4b94-9fa3-b8c76330407e`，PostgreSQL 17.10 / Auth v2.197.0 /
PostgREST 16.4，20 项 actual repository migration hashes 不变。

保留本轮 invalid runs：`2026-10-04T08-01-46.994Z-23244` 在 PostgREST 启动时 exit 3，未执行 scenario / stub；
`2026-10-04T08-02-10.954Z-32388` 的初始 assertion 过严地拒绝行政 `externallyFailed` 字符串。
后者 raw verdict 写 `product_blocker`，保留原文件并在 machine receipt 明确归类为 assertion/representation
`invalid_run`；校准后新 run 在实际 client unknown-code loss 处失败，未靠改 frozen expectation 通过。

Meaningful run controlled stub executions **2**（独立 requests 各 1）；diagnostic run **2**；本轮合计 **4**。
Paid Provider/Search/Image calls / cost **0**；production DB/schema/data writes **0**。
Modified harness syntax / targeted ESLint、两次 real run 的 strict clean production build、diff check **pass**。
`src/`、SQL/schema、既有配置与 frozen L1b/P7A files + lock 无改动；80 项历史 artifact hashes/sizes
核验通过，新三次 runs 追加 30 项 index。原 D1/D2 blocker、D2 selector invalid_run、accepted A/B/C receipts 保持原值。
First divergence 后不扩大 unit/SQL/full Chromium/P7A gate。

[Machine receipt](./p7b-1-l1b-evidence.json) 的 `remainingEvaluation` 保留独立 run 与归因；raw artifacts 仅位于
ignored `output/playwright/p7b-l1b/`，服务已停止，55432–55436 无 listener。
Remote hosted schema/migration state 未独立验证；无 production fault injection、hosted Kong/Vercel boundary，
local Windows Auth shim 保持；无 real Provider quality/billing、L2/L3/L4 evidence。P7 `validating`，停止等待网页复审。

## D2 bounded fix / post-fix C（2026-10-04，现已网页接受；以下保留原执行 receipt）

- Fetch / reviewed baseline：`afe2a1a3b15394a563c211c23ac874ce31c86c02`，main 仍为
  `f852578f0d1303ff074f66db1e3919c3218a5561`。Fix / clean executed source：
  **`573a83b9b76a8d1e26b57970909ef1fd9cd0f0ef`**。
- 产品仅改 `agentTurnLifecycle.ts`、`agentTurnCoordinator.ts`、`agentTurnRunner.ts`。
  Coordinator 观察 visible Text 的 server success 时保留 `externallyCompleted`，重新要求 final
  local persistence，先不 `TURN_FINALIZED`。Runner 用同一个 pure reducer preview 准备最终
  Workspace 草案，保存成功后才 dispatch actual `LOCAL_PERSISTENCE_SUCCEEDED` / `TURN_FINALIZED`，
  再 flush Recovery 和 ACK；不是 metadata outcome setter 或 UI-only patch。
- Final Workspace save 失败时撤回本 Turn 未提交的 message completion 草案，canonical
  Lifecycle 记录 retryable `final_text_persistence_failed` 并进入 `recovering`；
  Lifecycle persistence 与 `metadata.localPersistence` 均为 **`failed`**，没有 completed outcome。
  原 verified envelope / escrow 保留，ACK **0**。Server/Provider success 不被改为 failure/cancel/unknown。
- Query 不能替代 local save。解除 fault 后 reload 仍查询 original Journal、复用同一 request/
  envelope/result；durable final conversation 成功后，本地才为 `terminal` / `completed` /
  `succeeded`，相同 resultId/version/hash ACK **1**，Recovery 按原合同清理。
  没有新的 requestId、execution grant、Provider submission 或 result identity。
- Deterministic regression：normal final save；save failure；重复 local failure 后 reload 成功；
  独立 Recovery write failure；既有 Tool persistence failure / failed / cancelled / no-output /
  confirmation / Compaction adjacency。**12 files / 360 tests pass**；typecheck、lint、diff check pass。
  无 SQL/migration/Workspace/Recovery schema version、Provider retry、ACK/retention 或 D1 proof 改动。
  SQL/full unit/full Chromium/P7A 未机械重跑。

Real `--slice=C` post-fix run：**`2026-10-04T07-34-48.607Z-34460`**。
Fresh isolated DB identity `03228ea7-5ada-4968-9646-baeb095a90d1`；原 native Chromium → real
Next/Auth/PostgREST → PostgreSQL 17.10 → controlled local stub 环境与 migration hashes 不变。
Clean build `i22CQoC6ckKIhn4L9eCv6`；source-tree SHA-256
`48cd67de66ac16e0fd3ac96f1e1f05093b06347f23aaf5a48ea48a8174c1d24b`；artifact SHA-256
`b97d3a0f9ad058ffd50c1bc671c3b793c4e4b00006daff06e6c5f103fbe2b2d2`。

| C subcase | Post-fix verdict | 实际事实 |
|---|---|---|
| response loss / reload | pass | exact intent before POST、original Journal/result/chunks、envelope + final conversation before ACK、每 request 原始一次 submission |
| final save failure → fault removed → reload success | pass | failed checkpoint 为 non-terminal recovering / failed local persistence、durable assistant body 空、ACK 0；恢复时 same envelope SHA、final assistant done/success durable、canonical completed/succeeded，然后 exact ACK 1 / Recovery cleared |

Failure/recovery request：Turn `1b22ab6f-28ba-4ddd-9485-8d41ed9f936f`、request
`6cd6cc82-e702-4a58-89c3-0ad655dae33d` / sequence `1`；original envelope SHA-256
`5645e5b64cdcf083c1e3a887bdfab1e1c005af679dc920ef3a1e78f51895fa93` 在恢复后保持相同。
ACK result `result:1ace53a17c03f0ed7492a885c1412c8d0eacb3a8f2060bcfc45509caf6d1c356` / version `1` /
SHA-256 `1655a1cf8702be854abfbea8d8ab6622d8be266d501b573cd6957e4446dcec92`；
DB `acknowledged_at` 在成功保存后有值。该 request POST / Provider execution 总数仍各 **1**。
完整 C run 两个独立 requests 的 controlled stub executions 共 **2**；paid calls/cost **0**；
production DB/schema/data writes **0**，没有新 first divergence。

现有 `--slice=C` runner 因 D–G 排除，overall 保留 **`inconclusive` / exit 1**；`scenario-C.verdict`
为 **pass**，不属于 invalid_run/product blocker，也不表示 P7B-1 overall PASS。
原 blocker `2026-10-04T07-01-53.206Z-14756` 和 selector invalid_run
`2026-10-04T06-57-15.515Z-7604` 未覆盖；全部 66 项历史 artifact hashes/sizes 核对。
[Machine receipt](./p7b-1-l1b-evidence.json) 的 `d2Fix` 追加新 run 与 14 项 raw artifact index，
原 `continuation` / D1 receipts 保持原字段值。Raw evidence 仅在 ignored `output/`，服务已停止。
Frozen L1b expectations、P7A 五项 hashes + lock 不变。P7 `validating`，D–G `not_run`，
等待网页复审；不继续后续 scenarios。

## 原始 D2 continuation / blocker receipt（历史事实，以下保留）

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

复现原始 C first-divergence，在原 blocker source `80704fc1cf0d4fd9cd7e7b7cb7fc9e5a77443d10` / 已准备的 isolated tools 上执行：

```powershell
node scripts/verify-p7b-l1b.mjs temp/p7b-l1b-tools --slice=C
```

原 blocker source 应非零退出并保存 C product blocker；D–G `not_run`。该历史轮次没有接线或执行后续场景来寻找
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
