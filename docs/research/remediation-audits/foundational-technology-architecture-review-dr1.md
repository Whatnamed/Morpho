# Morpho Foundational Technology & Architecture Fitness Review

## 审计基线与总判断

本次判断以 **2026 年 9 月 20 日当前 `main`** 为准。GitHub 远端 `Whatnamed/Morpho` 的 `main` 当前指向 commit `2e801ed1558822e6cf46a0e19f7ff84654e7ae69`；该提交本身正是 Agent request latency 优化，并声明已通过 targeted unit tests、lint、typecheck、production build 与 perf browser checks。以下结论均针对这一份代码，而不是此前聊天、旧 Project Source 或早期架构状态。fileciteturn60file0

**总判断：Morpho 当前的技术底座整体是健康的，而且没有出现需要 re-platform 或大规模重写的证据。** 如果今天已经知道 Morpho 会发展成现在这种复杂度，我仍然会选择：**Web 作为宿主、Next.js/React 作为应用框架、local-first 作为项目数据权威、tldraw 作为 Canvas SDK 而不是 Project Truth、服务器只承担认证/Provider/外部执行 Journal、一套 Morpho 自己掌握产品语义的 Agent Runtime。** 当前 `package.json` 仍是一套相对克制的栈：Next 16.3、React 19.2、tldraw 5.1.1、Supabase、少量专项库，没有明显出现“框架叠框架”的依赖失控。fileciteturn85file0

真正接近设计边界的不是这些大方向，而是 **local-first 的物理持久化层**。逻辑上，“整个 MorphoWorkspace 是项目的本地权威文档”仍然成立；但“这个文档长期以一个完整 JSON 字符串同步写进 `localStorage`，而 Blob 与 Agent Recovery payload 再分散到一个非常薄的 IndexedDB BlobStore”已经开始暴露规模和正确性成本。当前内置案例自身的 workspace 已达到约 `872,672` 个 UTF-16 code units、repo 估算 `1,745,450` quota bytes，仓库还专门维护了 500 条聊天、600 个对象、200 条 memory revision 等增长测量场景——这说明团队实际上已经把 storage scaling 当成需要持续测量的基础设施问题，而不是纯理论风险。fileciteturn87file0 fileciteturn90file0

但这还**没有**形成“现在就把 workspace 搬到 SQLite/OPFS”的证据。现有真实性能图谱覆盖 500 对象、长对话、真实 IndexedDB 资产以及大文件导入，已经识别出的主要热点集中在大树渲染、Agent preparation、归档压缩等路径，而不是 workspace localStorage 写入已经成为首要交互瓶颈。也就是说，**storage substrate 已经值得提前建立演进余量，但还不值得用一次高回归迁移去预防尚未发生的问题。** fileciteturn53file0 fileciteturn54file0

我会把当前基础路线归类如下：

| 基础技术选择 | 裁决 | 核心理由 |
|---|---|---|
| Next.js App Router + React | **Retain** | 与当前 client-heavy workspace / server-side provider boundary 匹配，没有框架错配证据。fileciteturn78file0 |
| Web 作为宿主 | **Retain** | 当前需要的 Canvas、local-first storage、文件导入、SSE、Web Locks 均已由 Web 满足；没有 native-only requirement。fileciteturn82file0 |
| local-first Project Truth | **Retain** | 是产品数据所有权模型，不是暂时数据库替代品；Supabase 当前也刻意不保存项目内容。fileciteturn78file0 |
| whole-workspace `localStorage` 作为长期物理载体 | **Evolve / trigger-based migration** | 当前仍可工作，但同步整文档写入和规模上限已经是下一阶段最重要的基础技术风险。fileciteturn70file0 fileciteturn83file0 |
| IndexedDB Blob storage | **Retain technology, Evolve implementation** | 选型正确，但当前事务完成语义存在一个具体 correctness gap。fileciteturn69file0 |
| tldraw 作为 Canvas projection / interaction engine | **Retain strongly** | 当前 authority separation 是正确的；把 Morpho domain 搬进 TLStore 解决不了现存问题。fileciteturn77file0 |
| React state + controllers + domain actions | **Retain** | 已形成项目级 authority boundary；没有证据支持引入 Redux/Zustand 类全局状态重构。fileciteturn78file0 |
| A+ Runner / Coordinator / Recovery / Journal | **Retain, selectively evolve** | 层次看起来多，但分别对应不同 failure/authority boundary，并非纯重复建设。fileciteturn78file0 |
| SSE/fetch streaming + Journal recovery | **Retain strongly** | display transport 与 external execution authority 已被刻意分离，语义成熟。fileciteturn61file0 fileciteturn65file0 |
| PWA | **Reconsider if triggered** | 主要改善 install/offline shell，不解决 durable Agent execution。citeturn12search0turn13search0 |
| Desktop host / OPFS / SQLite | **Reconsider if triggered** | 现在迁移成本明显高于已证明收益。citeturn9search1 |
| main branch 当前无 protection enforcement | **Clearly unreasonable engineering gap** | 已有完整 CI，却没有在 branch level 强制它。fileciteturn60file0 fileciteturn58file0 |

因此，这轮审计最重要的结论不是“Morpho 早期架构已经过时”，反而是：

> **早期绝大多数战略性选择仍然正确。真正需要在未来一两年提前处理的是：把“local-first”与“localStorage 这个具体物理实现”解耦；修正 IndexedDB durability 语义；为本地存储规模增长建立可渐进迁移的边界。**

## 应明确保留、不要重新打开的基础路线

### Next.js / React 与当前 client-server 分工仍然合适

Morpho 的工作台天然是一个 client-heavy application：Canvas editor、selection、clipboard/file input、IndexedDB、localStorage、Web Locks、本地项目生命周期以及绝大多数即时交互都发生在浏览器。当前路由层并没有强行把这些东西 Server Component 化，而是让 `/projects/[projectId]` 的 server side 负责进入页面前的边界，再把实际 workbench 交给 `WorkspaceClient`；Provider secret、认证、Server Turn Journal 与 external execution 则留在 server route 上。canonical architecture 也明确把应用描述为一个 Next.js App Router application，而不是“前端 + 第二套后端框架”。fileciteturn78file0

这与 Next.js 自身的当前模型是吻合的：App Router 明确区分 Server / Client Components，而需要 state、event handling 与浏览器 API 的部分本来就属于 Client Component 边界。把 Morpho workspace 进一步 Server Component 化并不会自动减少复杂度，反而会让本来在本地拥有 authority 的 workspace state 跨过 serialization/network boundary。citeturn9search0turn9search7

所以我没有发现任何支持以下迁移的当前问题：换成 Vite SPA、Remix、TanStack Start 或其他 React host；更不存在换 Vue/Svelte 等前端框架的理由。这些迁移只能改变工程表面结构，却不能减少 Morpho 真正复杂的部分——domain semantics、Canvas projection、local persistence、Agent recovery 和 async execution authority。

同样，**不要为了 WorkspaceClient 曾经很大而继续机械拆分。** canonical architecture 已经把 Phase 1 到 Phase 6-G 的 decomposition 明确标记为 complete，并明确写出没有计划中的 6-H/6-I；当前剩余在页面上的职责是 composition、thin dispatch 和真正属于页面级的协调。继续把每一个 callback 变成新 controller，不是在改善 architecture，而是在增加跨模块跳转成本。fileciteturn78file0

### 不应引入全局状态框架来“解决复杂度”

当前真正的核心 workspace state 是一个 project-scoped `MorphoWorkspace`，由 `usePersistentWorkspace` 持有；写入前统一经过 memory reconciliation，持久化 capability 还受 project ID、migration state、single-writer lease 等限制。其他较复杂的 transient concerns 已经分别由 Selection、Surface、Import、Visual Generation、Agent Runtime、Confirmation 等 controllers 持有。fileciteturn76file0 fileciteturn78file0

这意味着 Morpho 当前的问题并不是“没有 centralized store”。相反，一个 Redux/Zustand/Jotai 风格的 global store 如果承载 workspace truth，首先要重新定义 persistence、undo、project switch、stale async callbacks、Agent commits 和 functional reconciliation 的 authority；如果只承载 UI transient state，又很可能只是把已经合理局部化的 React controllers 换一种语法。

已有 performance evidence 中，500-object select-all 等路径确实出现过整树 rerender 成本，但这应当继续作为 **subscription/render isolation 的局部性能问题** 处理，而不是由“换状态框架”倒推出架构迁移。性能审计已经证明 Morpho 有针对这些问题做 measurement，而不是通过抽象偏好推断优化。fileciteturn53file0

### local-first 应保留，而且要和 localStorage 分开看

Morpho 的 README 与 architecture 都明确把项目、Canvas、文件、图片、聊天正文、project memory 与整体 local Agent outcome 保留在浏览器；Supabase 只保存 identity、qualification/quota 和最小化的 Server Turn / Request / External Action Journals。跨设备目前通过 editable backup/restore，而不是伪装成已经有 cloud sync。fileciteturn82file0 fileciteturn78file0

这是产品级 authority decision，而不是“还没来得及上数据库”。因此，即使未来把 workspace JSON 从 localStorage 迁到 IndexedDB 或 OPFS，它也不意味着应把 Project Truth 搬到 Supabase/Postgres。**local-first 与 localStorage 是两个不同层次的决定：前者目前仍然强健；后者才是可能需要演进的物理实现。**

当前代码还已经请求 Storage API durability，并把 durability 状态反馈到 workspace persistence。WHATWG Storage Standard 到 2026 年仍把 persistent storage bucket 作为保护用户本地创建内容免受 user-agent 自动清理的正式机制。这个方向应该保留；同时它不能替代 exportable backup，因为 persistent storage 仍可以被用户主动清除。fileciteturn76file0 citeturn13search8

### tldraw 作为 projection，而不是 Project Truth，是非常正确的早期选择

最值得明确“停止折腾”的基础路线之一就是这个。Morpho 最初的技术决定已经把边界说得很清楚：tldraw 提供 pan/zoom/selection 与 extensible rendering；`morpho-object` 把 Morpho object 映射进 canvas；**canvas coordinates 属于 `canvas.instances`，domain semantics 留在 Morpho objects / relations。** fileciteturn77file0

当前实现也仍遵守这个方向。Canvas editor 的 resync 输入明确只观察 objects、`canvas.instances`、stage regions、assets、proposals、delivery references 等真正影响 Canvas 的引用；例如 conversation-only workspace changes 不必重新同步 editor。fileciteturn92file0

值得注意的是，**2026 年的 tldraw 已经比 Morpho 最初选择它时更有能力**：TLStore 可以持久化 custom records、做 migrations、IndexedDB persistence，甚至将 document records 自动纳入 multiplayer sync；官方 `persistenceKey` 也可以直接在 IndexedDB 存储 document 并跨 tab 同步。citeturn11search0turn11search1turn11search2

但新能力的出现并不构成迁移理由。把 Morpho domain objects、memory、Agent state、delivery semantics 等变成 TLStore records，会带来几个真实代价：产品 schema 与 Canvas SDK schema/versioning 更紧耦合；tldraw undo/sync 语义会开始触碰 Morpho domain authority；backup/migration/runtime tools 全部需要重新定义边界；Canvas library upgrade 的 regression surface 也会突然覆盖 Project Truth。tldraw 已经能做这件事，只能证明“可行”，不能证明“值得”。

只有未来 Morpho 真正进入 **多人实时共同编辑同一个项目**，并且希望利用 tldraw sync 的 concurrent canvas document semantics 时，才值得重新评估这条边界。tldraw 官方的 sync stack本身就是围绕 WebSocket、room state、server persistence 与共享 document 展开的；这属于一个新产品需求，而不是当前架构欠债。citeturn11search3turn11search7

## 当前最值得演进的基础技术问题：本地持久化层

这里是本轮最重要的发现。问题不是“local-first 不行”，而是 **logical document、physical storage、durability acknowledgement 之间的边界还不够成熟。**

### IndexedDB 当前存在一个具体 correctness gap

`indexedDbAssetStore.ts` 的 `runTransaction()` 当前在单个 `IDBRequest.onsuccess` 时就 resolve；`put`、`get`、`delete` 都复用这个 helper。代码没有等待 `IDBTransaction.oncomplete`，也没有把 `transaction.onabort` 作为最终 failure boundary。fileciteturn69file0

这不是架构风格争议。IndexedDB 规范明确指出：**某个 request 的 `success` 已经发出后，transaction 仍然可能失败；判断 transaction 是否成功完成，应监听 transaction 的 `complete` event，而不是具体 request 的 `success`。** citeturn9search2

因此，当前 `put()` 至少存在一个事实上的 durability acknowledgement gap：调用方可能已经得到“Blob 写成功”的 Promise fulfillment，但底层 write transaction 尚未被确认 commit。正常浏览器路径下这可能很少暴露，但 Morpho 恰恰在把这些写入当作产品 correctness boundary。

影响范围并不只是普通图片。A+ Recovery Store 也直接把大型 provider request、runtime state、pending confirmation / external-action body 等 payload 放进同一个 `indexedDbBlobStore`，然后让 localStorage metadata 持有带 SHA-256 和 byte length 的引用。fileciteturn80file0 fileciteturn81file0

Editable backup restore 同样会逐个 `await blobStore.put(...)`，待全部 Blob 写完之后再写 workspace 和 catalog；发生异常时则清理已经写入的 blob。这个 staged compensation design 本身很好，但它隐含依赖 `await put()` 真正意味着“transaction committed”。因此底层的 transaction acknowledgement 应该先变正确，远比换数据库重要。fileciteturn94file0

**裁决：Evolve now。** 这是具体实现错误，不是 IndexedDB 选错。迁移复杂度低、数据格式不变、无新增依赖、没有 vendor coupling，也不需要 schema migration；回归面主要局限于 BlobStore 与依赖其成功语义的测试。它是本轮所有 findings 中最高 confidence 的“应该改变现状”的技术问题。

### whole-workspace localStorage 仍可保留，但不应再被视作永久物理接口

当前每个项目的整个 workspace 使用一个 `morpho.project.<id>.workspace.v1` key；加载后统一 `parseWorkspace`，迁移后再 serialize 写回；`persistProjectWorkspaceAndSummary` 先写 workspace，再写 catalog，并能区分 workspace failure 与 catalog failure。fileciteturn70file0

这其实比通常所说的“用 localStorage 存 JSON”成熟得多。当前 storage layer 还会在 `setItem` 后马上 read-back verification；catalog 丢失时可以扫描 workspace keys 恢复；migration failure 不破坏原始 raw data。fileciteturn74file0 fileciteturn71file0

同时，domain schema 已经走到 `schemaVersion: 17`，而 workspace construction / parsing 仍集中在 domain workspace module。换句话说，**Morpho 的逻辑 schema migration system 已经是资产，不应与物理 storage migration 一起推倒。** fileciteturn84file0

当前 persistence controller 则是完全同步的：400ms debounce、1200ms max wait，`writer(workspace)` 同步返回 success/failure；`flush()` 也是同步完成。`usePersistentWorkspace` 还会在 `pagehide`、`beforeunload` 和 document hidden 时主动 `flush()`。fileciteturn83file0 fileciteturn76file0

这解释了为什么 **“直接把 `localStorage.setItem` 换成 IndexedDB”并不是一个小改动。** 异步 transactional persistence 会改变 dirty/saving/saved 的状态机、project switch 时的 flush/lease release、页面离开时的保证以及一些测试契约。尤其不能继续把 `beforeunload` 当成异步 database commit 的可靠最后防线。这正是为什么我不建议现在因为“IndexedDB 更现代”就迁移。

但从未来一两年的角度，当前物理接口已经应该被视为 **Evolve**。最安全的下一阶段不是先 normalization，而是让上层依赖一个 async-capable project document repository，而不是依赖 `Storage` / synchronous write semantics。什么时候真的切换 substrate，应由实际数据触发。

如果触发迁移，我认为第一选择应该是：

> **仍然把 serialized MorphoWorkspace 当成一个 logical document，只是把这个单一 document record 从 localStorage 搬到 IndexedDB。**

这是一项有意保持语义不变的迁移。它不要求把 `objects`、messages、memory revisions、relations 分成几十个 object stores；不改变 `schemaVersion: 17+` 的 domain migrations；不要求改变 editable backup；也不把 Project Truth 变成 TLStore。根据当前代码结构，这是可以通过 dual-read / new-write 的渐进方式设计出来的，而不是一次 “database rewrite”。这一点属于根据当前 storage/module boundaries 做出的架构推断。fileciteturn70file0 fileciteturn84file0 fileciteturn94file0

### Assets 与 Agent Recovery 共用一个无类型 Blob object store，短期可接受，长期应收束

当前 IndexedDB 只有 `morpho-assets-v1`、DB version 1 和单个 `asset-blobs` object store。Agent Recovery 的大型 JSON payload 也通过同一 BlobStore 写进去，只是在 key/ref 命名和 metadata hash 上区分。fileciteturn69file0 fileciteturn81file0

这不是立即的 bug；Recovery Store 的 data-before-pointer 策略实际上很合理：payload 先落地，metadata 最后指向它；读取又校验 SHA-256，所以不会把 hash mismatch 当作可恢复状态。fileciteturn81file0

真正的问题是**生命周期开始不同**。项目 assets 需要 object-level garbage collection；Recovery payload 是临时 turn state，正常结束后应该清；import / visual generation 还有 provisional blobs。canonical architecture 本身也承认 generic object-level Blob GC 仍未成为统一基础设施。fileciteturn78file0

因此下一次 storage-layer 演进时，我会倾向于建立明确的物理 namespace / object-store ownership 和 orphan reconciliation，而不是继续让所有 durable-ish binary/string payload 只靠 key convention 共存。这仍然是渐进演化，不需要把现有数据搬到 SQLite。

### backup / restore 的方向应保留

当前 editable backup 不是简单 dump localStorage。它有 compressed size limit、bounded unzip、manifest/bundle revalidation、生成新的 project ID、先写 assets、失败时 rollback、再写 workspace、再写 catalog，并在任一后续 failure 时做 best-effort compensation。fileciteturn94file0

这套 boundary 非常重要，因为它使未来更换物理 storage substrate 时仍然有一个高层、与 storage backend 相对解耦的 portable project representation。**不应为了换 IDB/OPFS 去重新发明 backup format。** 更合理的是让 backup 保持 domain-level compatibility，而 storage migration 在其下方发生。

## Agent Runtime、Provider 与前后端执行边界

### 当前 A+ Runtime 不是“重复造 Agent framework”的失败案例

从文件数量看，Runner、Coordinator、Lifecycle reducer、Recovery Store、Server Turn Journal、External Action Journal、SSE transport 确实显得复杂。但进一步看 authority，绝大多数层次都具有不同职责，而不是同一状态机被复制了四遍。

canonical architecture 的核心原则是：**客户端 Coordinator / lifecycle reducer 负责 Overall Local Agent Turn Outcome；Server Turn Journal 只权威拥有 Server External Execution Status。** 浏览器本地 tool execution、confirmation、workspace persistence 不能被 server journal 假装成已完成，因为 server 根本不拥有 Morpho project state。fileciteturn78file0

HTTP Host 也完整体现了这一点。客户端创建 server turn、发 provider request、消费 SSE；如果网络 transport 中断，最终状态可以重新查询 Journal；显式 cancellation 则先打 cancel endpoint，再 abort 本地 display consumption。fileciteturn61file0

服务器端更加关键：request 先做 auth、bounded input validation、provider contract、request hash 与 Journal acquire；如果相同执行已经存在，就 replay Journal snapshot，而不是重新调用 provider。真正开始 Provider stream 后，代码还明确规定 **transport disconnect 只是 display detach，不等同于 external execution cancellation**；只有显式 cancel route 才取消 provider execution。Provider 最终完成/失败/取消后，Server Journal 再以 bounded retry settlement。fileciteturn64file0 fileciteturn65file0

这是一套针对“browser-local truth + server external side effects”产生的分布式一致性问题建立的语义。WebSocket、Server Actions 或一个第三方 agent loop 都不会自动删除这些问题。

所以这里应当 **Retain** 的不是每一行当前代码，而是这几个 authority boundaries：

**Provider execution ≠ display stream；Server External Status ≠ Overall Local Turn Outcome；transport disconnect ≠ cancellation；tool call intent ≠ local effect committed；recovery replay ≠ regenerate request from current workspace。** 这些界线已经具有明确产品价值。fileciteturn78file0 fileciteturn65file0

### SSE/fetch 不需要因为 WebSocket 更“实时”而更换

当前使用的是 POST + `fetch` response body 消费 SSE-framed data，而不是浏览器 `EventSource`。这允许发送完整 provider request body，同时依靠 Journal 解决 stream 丢失后的 authoritative reconciliation。客户端甚至会忽略 malformed display frame，并把缺失 final state 交给 Journal recovery。fileciteturn61file0

这意味着 WebSocket 在当前系统里解决不了一个已存在的问题：Morpho 不需要 server 主动向一个长期 connected room 广播多人状态；也不依赖双向低延迟 socket command channel。它主要需要单次 request 的 streaming output + durable query/recovery。换 WebSocket 反而新增 connection lifecycle、reconnect protocol、server socket infrastructure 与新的 deployment coupling。

### 2026 年 Agent frameworks 已明显成熟，但仍不构成重写理由

这里确实有明显的外部技术变化。OpenAI Agents SDK 现在已有 tool execution、persistent session abstraction 和 human-in-the-loop pause/resume；其 HITL model 可以持久化 RunState 后恢复审批。citeturn10search9turn10search17

Vercel AI SDK 7 在 2026 年又加入 `WorkflowAgent`，可把 agent/tool loop 作为 durable workflow steps 持久化，跨 function timeout、process restart、deployment 与长时间 human approval 恢复。citeturn10search0turn10search5

Temporal 则提供更加通用的 durable execution model，本身就以 crash/network/infrastructure failure 后从原状态恢复为核心能力。citeturn15search0

但这些替代方案真正解决的是：**server-owned workflow 在请求结束以后仍要继续、重试、等待、排队和恢复。** 而 Morpho 当前最难的部分恰恰不是 server-side agent loop，而是本地 Workspace effect authority：browser-local tool write、pending confirmation、exact current project session、asset commit、project persistence、恢复时不能基于新 workspace 重新生成旧 external-action body 等。fileciteturn78file0

因此，如果今天把 A+ Runtime 重写成 OpenAI Agents SDK、AI SDK WorkflowAgent 或 Temporal，Morpho 仍然必须另外实现这些 local authority rules；短期结果更可能是“framework durable state + Morpho recovery state”两套体系同时存在，而不是删掉一套体系。

**当前裁决是 Retain。**

真正值得重新评估 workflow engine 的 trigger 应该是：Agent 必须在所有 browser tabs 都关闭后继续运行；任务天然持续数分钟到数小时；需要 server-scheduled/background work；大量 concurrent jobs 需要 queue/backpressure；必须从另一台设备恢复同一个正在执行的 agent turn；或者外部 tool step 要求强 server-side retries / operational SLA。届时可以让 durable workflow 接管 **server external-execution orchestration**，但依然没有理由顺手把 Morpho project truth 和 domain actions搬到 workflow engine。Vercel 自己对 WorkflowAgent 的定位也是在 tool calls 会超出请求生命周期、审批超过 function timeout、或者每一步需要独立 retry 时再使用。citeturn10search5

### Provider boundary 目前足够，不需要提前做“万能 provider abstraction”

当前 server config 已把 API key、base URL、model、reasoning effort、web search capability 与 prompt-cache capability 保持在 server side，并把活跃文本路径约束为 OpenAI-compatible/AiJWS。fileciteturn68file0

这已经解决了当前真正的问题：浏览器拿不到 credentials，workspace 不依赖 provider-private configuration，同时 agent runtime 和 provider transport 不是同一个模块。**除非第二个真实使用的、协议差异显著的 Provider 出现，否则没有理由先搭一层巨大 generic LLM provider framework。**

## 替代技术与迁移成本：只有满足 trigger 才值得改变

下面的判断以“究竟解决 Morpho 现在的什么问题”为第一标准，而不是技术新旧。

| 方案 | 真正解决的问题 | 收益 | Migration / regression / coupling | 裁决 |
|---|---|---|---|---|
| **修正现有 IndexedDB transaction completion** | 当前 `put/delete` 可能在 request success、transaction commit 前就报告成功。fileciteturn69file0 citeturn9search2 | 明确提升 asset、restore、Agent Recovery durability semantics | **低复杂度、低数据风险、无格式迁移、无新增 dependency** | **Evolve now** |
| **workspace JSON 从 localStorage 搬到 IndexedDB 单一 record** | 当同步整文档 save 已出现可测 UI stall、quota pressure 或 workspace size growth 时，移除同步 storage substrate | 保留现有 schema/backup/domain model，同时获得 async transactional store | **中等复杂度**；现有 persistence controller、flush/page lifecycle 需改为 async-aware；可 dual-read 渐进迁移。fileciteturn83file0 | **Reconsider when triggered** |
| **把 workspace 正规化成很多 IndexedDB stores** | 真正需要 partial query/update、索引、局部 transaction 时 | 大项目不用每次 serialize 全文档 | **高 regression**：domain migration、atomic project snapshot、backup/restore、undo/reconciliation 都被波及 | **现在不要做** |
| **SQLite/WASM + OPFS** | 超大本地 dataset、复杂 query/index、强 relational transaction、IDB model 已不足时 | 成熟 SQL/transaction model | **高复杂度**：WASM/worker、VFS、multi-tab locking、某些模式的 COOP/COEP、数据库 migration 新增。SQLite 官方自己提供多个 OPFS VFS 并明确列出不同 concurrency/portability trade-off。citeturn9search1 | **Reconsider if IDB is proven insufficient** |
| **tldraw Store 变成 Project Truth** | 如果 Morpho domain 本身最终退化成 collaborative drawing records，或必须由 tldraw sync authoritative merge | 可直接利用 TLStore persistence/migration/sync。citeturn11search1turn11search3 | **极高 regression + SDK coupling**；当前没有对应问题 | **Retain current boundary** |
| **第三方 Agent framework 重写 A+** | 真正需要 framework-owned server agent loops / sessions / approvals 时 | 减少通用 agent-loop plumbing | Morpho local effect/recovery rules仍要保留，存在双重状态机风险；framework/vendor coupling 上升。citeturn10search9turn10search5 | **现在不要重写** |
| **Workflow engine** | 浏览器关闭后仍需 durable/background execution、hours-long suspension、job queue / retry SLA | 真正获得 durable server execution。citeturn10search5turn15search0 | **高 runtime migration**，并不能替代 local Project Truth | **Trigger-based** |
| **PWA** | 安装入口、standalone launch、offline shell/cache | 改善 app-like launch 与断网入口体验；Manifest 正式提供 `start_url`、icons、display mode 等 app metadata。citeturn12search0 | 低至中等；但 Service Worker 可在无事件时随时被 UA terminate，不能成为 durable Agent host。citeturn13search0 | **只为 UX/offline trigger** |
| **Electron / Tauri / Desktop host** | 真正需要 OS 文件系统、folder watching、后台常驻 Agent、keychain、global shortcut、native integrations 或 enterprise installer 时 | 获得 browser sandbox 以外能力 | **非常高 regression surface**：distribution、update、安全、文件迁移、双 host testing | **Web complexity 不是迁移理由** |
| **cloud DB / CRDT project truth** | 跨设备自动同步、多人并发编辑成为正式产品能力时 | collaboration / multi-device continuity | authority、conflict、asset sync、privacy、offline semantics 全部改变；tldraw sync 也要求专门 collaborative server model。citeturn11search3 | **明确产品 trigger 后再评估** |

这里尤其值得强调 OPFS。它已经是非常现实的 Web 技术，不再是早期实验品；SQLite 官方 WASM 文档甚至在 2026 年新增了基于 Web Locks 的 `opfs-wl` VFS。可它仍要求 worker-context architecture，并存在 concurrency、VFS choice、browser capability 和某些实现所需 COOP/COEP 等成本。技术已经成熟到“可以用”，不等于 Morpho 已经遇到“必须用它才能解决”的问题。citeturn9search1

PWA 也是类似。Web App Manifest 可以让应用以 standalone 等模式从系统入口启动，但那是 packaging/launch capability；Service Worker 的生命周期规范明确允许 UA 在没有事件可处理时终止它，所以它不能把今天的 browser Agent 变成长驻后台 runtime。citeturn12search0turn13search0

也就是说，**Web 宿主目前没有被 Morpho 的复杂度“证明不够用了”。** 真正会证明 Web host 不够的应是浏览器能力缺口，而不是 React 文件很多、Agent Runtime复杂、或者用户希望像桌面应用一样看到一个图标。

## 未来一两年最值得提前调整的基础技术问题

### 最高优先级：修正 durability acknowledgement，而不是换技术栈

首先应把 IndexedDB transaction success boundary 看成基础 correctness issue，而不是普通 code cleanup。它影响 imported/generated assets、backup restore 和 A+ Recovery payload；规范层面也有明确依据。fileciteturn69file0 fileciteturn81file0 citeturn9search2

与之相比，改框架、换 TLStore、引入 workflow engine 都没有同等直接的“当前数据可能被过早视作 committed”收益。

### 第二优先级：让 Project Persistence 成为真正可替换的物理边界

当前 `usePersistentWorkspace` → synchronous persistence controller → `persistProjectWorkspaceAndSummary(window.localStorage, workspace)` 的耦合仍然非常清晰。fileciteturn76file0 fileciteturn83file0

未来最值得提前准备的不是“现在搬数据库”，而是避免越来越多上层逻辑继续假设：

`save == synchronous Storage.setItem == immediately durable == flush() can finish before navigation`

这样当真实 metrics 触发 substrate migration 时，Morpho 才可以保留整个 domain schema、backup、Canvas 和 Agent 逻辑，只换底层 repository。

这里的 trigger 最好继续采用 Morpho 已经在使用的 evidence-driven 方法，而不是主观阈值。仓库已经有 storage-footprint script、performance harness 和 scale fixtures；应持续观察 serialized workspace growth、real save duration / blocking、storage pressure、load/parse cost 与真实项目规模。fileciteturn85file0 fileciteturn87file0 fileciteturn90file0

**只有当其中某个指标已经造成实际产品问题，再把 workspace document 迁到 IDB。** 这是比“2026 年 localStorage 看起来老了”更可靠的迁移门槛。

### 第三优先级：给 Blob lifecycle 一个统一的基础设施视角

Morpho 现在已经有至少三种本地 binary/payload 生命周期：长期 project asset、临时/provisional import/generation asset、Agent Recovery payload。它们目前共享非常薄的 BlobStore primitive，却由不同 feature 各自负责 cleanup/recovery。fileciteturn69file0 fileciteturn81file0 fileciteturn78file0

继续增长一两年后，真正的风险会是 orphan accumulation 和 GC authority，而不是“IndexedDB API 太原始”。因此未来的 storage evolution 应优先让 store namespace、ownership、reference/reconciliation 变清楚，而不是引入 Dexie/SQLite 之后假定问题自动消失。

### 第四优先级：保持 Agent Runtime authority，减少实现摩擦而不是换 runtime

当前 `main` 最新提交正是在不改变 request identity、recovery、tool continuation boundary 的前提下，跳过无 metadata 的完整 recovery load、并行 preparation、复用 reconciled memory/context。也就是说，当前项目已经走在一个更合理的方向：**优化已有 semantics 的成本，而不是为了性能删除 semantics。** fileciteturn60file0

未来值得继续做的是这种“边界保持、实现收敛”：相同 protocol type、status vocabulary、recovery serialization、observability 如果出现真正重复，应收敛；但不要因为 Runner / Coordinator / Journal 三个名字看起来像 workflow engine 就假定它们是多余的。

第三方 Agent/Workflow 技术应该持续观察，因为 2026 年的发展速度很快；但只有当 Morpho 的 execution ownership 从“browser session 内的 local-first turn”转向“server durable job”时，才真正发生技术适配条件变化。OpenAI Agents SDK、AI SDK WorkflowAgent 和 Temporal 当前最强的新增能力都集中在 sessions/HITL/durable server execution，这与 Morpho 当前架构仍是不同问题域。citeturn10search9turn10search17turn10search5turn15search0

### 还有一个与 runtime 无关、但现在就不合理的基础工程缺口

当前仓库已经有相当完整的 CI：push/PR 执行 lint、typecheck、unit tests、production build；另一 job 建 production app 后跑 Chromium acceptance；Cloudflare backup bundle 也单独验证。fileciteturn58file0

然而当前 GitHub `main` metadata 显示 branch protection `enabled: false`，required status checks enforcement 也是 off。fileciteturn60file0

对于已经具有 schema 17、复杂 migration、local persistence、Agent recovery、provider execution 和大规模 browser acceptance 的项目，这属于一个少见的“基础设施已经存在，却没有被强制执行”的缺口。它不是产品 architecture failure，但比换 framework 更值得调整：**CI 只有在不能被直接绕过时，才真正成为 architecture safety boundary。**

## 最终裁决：继续开发一两年时，该动什么、该停止动什么

如果今天从零设计一个已经知道会长成当前 Morpho 的产品，我不会完全复刻最早版本的物理 persistence implementation：我会更早把 project document persistence 放在一个 async-capable transactional repository 后面，并从第一天严格区分 asset、recovery payload 与 project document 的 storage lifecycle。

但我**仍然会选择当前绝大多数战略基础**：

**Web + Next/React** 仍然匹配产品；Client-heavy Workspace 不是架构失误。fileciteturn78file0 citeturn9search0turn9search7

**local-first** 仍然是正确的 Project Truth policy；需要演进的是 storage substrate，不是把产品 authority 交给云数据库。fileciteturn82file0

**tldraw projection / Morpho domain truth separation** 是非常值得保留的早期选择。即使 tldraw 现在已经可以存 custom records、做 migrations、IndexedDB persistence 和 sync，也没有证据说明把 domain truth 搬进去会让 Morpho 更简单。fileciteturn77file0 citeturn11search0turn11search2

**React state + controllers + domain actions** 已经形成足够清楚的 authority structure；没有全局状态框架迁移的真实 problem statement。WorkspaceClient decomposition 应按 canonical architecture 的 6-G closure 停止继续机械推进。fileciteturn78file0

**A+ Runtime 应保留。** 它的复杂度很大程度来自 Morpho 本身确实存在的 distributed/local correctness semantics，而不是因为项目错过了某个 Agent framework。新 frameworks 值得观察，但现在重写会把成熟的 authority semantics 重新放进一个新框架，而不会让它们消失。fileciteturn61file0 fileciteturn65file0 citeturn10search5

**SSE/fetch + Journal 应明确保留。** 当前 request streaming、replay、explicit cancel 与 transport-detach semantics 都与产品需求吻合，没有 WebSocket migration 的实际收益。fileciteturn61file0 fileciteturn65file0

**Backup/restore 应保留为跨 substrate 的长期 compatibility boundary。** 当前 staged validation / restore / rollback 已经比物理 storage 更值得稳定下来。fileciteturn94file0

而未来一两年，我认为最值得提前处理的基础技术顺序非常明确：

**第一，修正 IndexedDB 的 transaction-completion correctness。** 这是已存在的问题，而不是预测。fileciteturn69file0 citeturn9search2

**第二，让 workspace persistence 与 synchronous `localStorage` assumption 逐步解耦，但暂不强制迁数据。** 当前 whole-document model仍可保留；真实 metrics 触发时优先迁成 IndexedDB 中的 whole serialized document，而不是直接 normalization/SQLite。fileciteturn83file0 fileciteturn87file0

**第三，建立统一的 local Blob lifecycle / ownership / orphan reconciliation 视角。** 这是 assets 与 Agent Recovery 继续增长后更可能出现的真实结构性成本。fileciteturn81file0 fileciteturn78file0

**第四，给已有 CI 加真正的 merge/push enforcement。** 这是非常低迁移成本却能明显降低基础架构回归风险的一项缺口。fileciteturn58file0 fileciteturn60file0

除此之外，当前应明确停止重新讨论：前端框架替换、全局状态框架、tldraw Store 变成 Project Truth、local-first 改 cloud-first、继续拆 WorkspaceClient、用第三方 Agent framework 重写 A+、为了“实时”换 WebSocket、为了“像桌面软件”迁 Electron/Tauri，以及在没有 IDB 已不足的证据前直接上 SQLite/OPFS。

**最终结论是：Morpho 当前不是站在一次技术换代的门口，而是站在一次“把已经正确的架构原则与早期物理实现进一步解耦”的门口。** 最初最重要的选择——local-first、domain/canvas separation、client/server authority separation、browser-local product truth、server-side provider isolation——经受住了项目复杂度增长；真正被规模追上的，是更低一层的 storage mechanics，而不是整个技术底座。