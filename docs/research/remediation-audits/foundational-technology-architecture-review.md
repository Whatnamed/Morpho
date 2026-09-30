# Morpho — Foundational Technology & Architecture Fitness Review

审查日期：2026-09-21。审查对象：远端 main，commit **2e801ed1558822e6cf46a0e19f7ff84654e7ae69**。

**总判断：技术底座总体健康，值得继续建设。核心技术路线没有需要推倒重来的证据，但本地持久化和外部执行的运行保障已经需要升级。**

如果今天重新起步、且预先知道目前的产品复杂度，我仍会选择 Web + React、明确的本地域模型、local-first、tldraw 作为交互投影，以及由 Morpho 控制的 Agent 执行与确认边界。我不会继续把整个长期项目保存在同步 localStorage 中，也不会把 React 渲染提交作为应用命令的长期完成边界，或把一次 HTTP 响应作为付费生成结果唯一的交付机会。

这些结论分别属于存储方法、应用边界和运行保障问题，不构成换前端框架、换 Canvas 引擎或重写 A+ 的理由。

## 1. 证据与范围

- 通过 GitHub API 查询当前 main，再用 gh repo clone 拉取独立浅克隆；开始与收尾的远端 SHA 相同。
- 阅读当前 AGENTS.md、产品文档索引及相关 00–05 规则、architecture/README、architecture、decisions、runbook，并沿对应代码追踪。历史材料只用于理解已明确记录的选择，不作为当前实现事实。
- 精读了项目初始化、保存、锁、资产、备份恢复、schema migration、React commit boundary、Canvas 双向映射、A+ Runner/Coordinator/Recovery、Provider/External Action handlers 与 SQL Journal 边界。
- 核对该 SHA 的 [GitHub Quality run](https://github.com/Whatnamed/Morpho/actions/runs/35507881853)：lint/typecheck/test/build、browser acceptance、Cloudflare backup build 三个 job 均成功。这是已核实的远端 CI 结果，不是本轮重新运行全套测试。
- 在独立 Chromium 151 临时上下文运行当前资产适配器的事务故障实验，以及当前真实案例 JSON 的 localStorage 容量实验。未访问用户浏览器数据、真实生产数据库或付费 Provider。
- 官方比较资料涵盖 React、Next.js、IndexedDB、idb/Dexie、OPFS/SQLite Wasm、tldraw、AI SDK、LangGraph、Temporal、Vercel Functions、PWA 和 Tauri。
- 未修改 D:\Morpho 或独立克隆的代码、配置、依赖和文档；未 commit、push、部署或修改数据库。本报告和实验产物位于仓库外。
- 未把旧性能数值当成当前性能事实：仓库 Node 报告的 measuredCodeCommit 是 1b6b61b，整轮 trusted=false；Phase 5 文件对应 d476191，而非本次 main。

**证据强度约定：**“已验证”表示当前代码、当前 CI 或本轮实验支持；“推断”表示由已验证实现和平台语义推导；“未验证”表示没有相应线上或规模实验。

## 2. 决策总表

| 技术选择 | 裁决 | 今天重新选择时的判断 |
|---|---|---|
| Next.js App Router + React | Retain | 继续作为交互应用宿主、认证入口和 BFF；不把本地项目状态迁到 RSC |
| Web 应用 | Retain | 当前能力与产品匹配；没有必须引入原生宿主的证据 |
| local-first 与本地 Project Truth | Retain | 与单人连续画布、私有资料、显式导出匹配 |
| 独立 TypeScript domain actions、稳定身份和版本化对象 | Retain | 这是迁移存储、宿主和 Provider 时最有价值的隔离层 |
| tldraw 作为可重建投影 | Retain | 不将 tldraw Store 或 sync room 升为 Project Truth |
| 全 Workspace 单值 localStorage | Evolve，最高长期优先级 | 今天不会再选作长期项目数据库 |
| 手写 IndexedDB Promise 适配器 | 明确需要修正当前实现 | request 成功不能当作 transaction 提交完成 |
| React state + controllers | 总体 Retain，提交边界 Evolve | 不需要立即引入全局状态库；应用提交不宜长期依赖 flushSync |
| A+ Coordinator / Runner / Journal / Recovery | Retain | 角色区分有真实依据，不是四套重复 workflow |
| 大图片穿过普通 Function 请求、一次性结果交付 | Evolve | 应让传输、执行期限、结果保留符合宿主能力 |
| Schema migration、JSON 备份、新副本恢复 | Retain | 保持便携边界；物理存储迁移不应顺手重写产品 schema |
| 原图预览、资产回收、整包内存导出 | 有限 Evolve | 优先预览资源与备份可恢复范围，不先换 Blob 存储技术 |
| OPFS、SQLite Wasm、PWA、Desktop、云同步、durable workflow | Reconsider if triggered | 由明确需求或已测瓶颈触发，不能由“现代化”触发 |

### 2.1 Next.js 与前后端边界的具体裁决

当前项目路由在服务端处理 account/access，WorkspaceClient 在浏览器加载本地项目，MorphoCanvas 通过 dynamic(..., { ssr: false }) 引入；AI route handlers 保存密钥并执行服务端授权、Provider 调用和 Journal。这个职责划分与产品相符。见 [项目入口](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/app/projects/%5BprojectId%5D/page.tsx)、[Canvas 加载边界](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/WorkspaceClient.tsx#L161)。

Next.js 在这里主要是应用宿主与 BFF，不必为了证明框架价值而让画布吃满 RSC、Server Actions 或服务端缓存能力。浏览器资产和低延迟交互留在 client 是明确需求；认证与付费外部执行留在 server 同样有依据。[Next.js client/server components](https://nextjs.org/docs/app/getting-started/server-and-client-components)。

即使今天从零开始，Vite SPA + 独立 API 也是合理候选，但对当前仓库没有证明它能解除更关键的存储、命令提交或外部结果恢复问题。迁移会重做认证路由、API 部署、构建和浏览器验收，收益不足。Next.js 16、React 19 和 tldraw 5 已在当前依赖中；不能把这一项目当作停留在最早原型版本的技术栈。版本维护继续按实际兼容、安全和支持周期处理，不属于本轮换框架决策。

Supabase 的当前价值集中在 Auth、服务端配额和 Journal 的数据库原子性，不是整个项目数据云端托管。保留这个范围比引入另一套数据库或 auth 服务更合算。当前含 SQL RPC 和 Supabase Auth API 的耦合是真实存在的，但稳定项目格式仍在本地，未来改变服务端供应商不会天然要求转换全部用户项目。


## 3. 最值得调整：本地存储与提交语义

### 3.1 单值 localStorage 的假设已经不适合作为未来一两年的默认

**已验证的链路：**

usePersistentWorkspace 持有完整 MorphoWorkspace；workspacePersistence 以 400 ms debounce、1200 ms max-wait 调用同步 writer；localProjectStore 把完整 workspace JSON 写入一个 key，然后单独更新 catalog，写后再读回验证。见 [持久化 hook](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/usePersistentWorkspace.ts#L23)、[同步 writer 与计时](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/workspacePersistence.ts#L69)、[项目与 catalog 写入](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/infrastructure/persistence/localProjectStore.ts#L219)。

当前内置真实案例只有 **42 个对象、28 个资产和 184 条消息**，不计图片二进制，JSON 已有 **872,633 个 UTF-16 code units、1,203,609 UTF-8 bytes，约 1.15 MiB**。其中 projectMemory 约占 18%、operations 17.3%、projectContinuity 14%、ai 12.2%，objects 本身只占 9.5%。因此，容量问题不能通过“少放几张画布卡片”来理解。

本轮在空白 Chromium origin 中重复写入这一 JSON，成功 6 份，第 7 份触发 QuotaExceededError。这不是“用户可安全使用六个项目”的产品承诺：实验没有 catalog、Recovery、继续增长的历史和其他 origin 数据，也不是完整项目复制流程。

仓库 storageFootprint 以字符串长度乘 2 估算容量；不要把这个估算值与所有浏览器的限制直接相除。本轮结果已经说明，需要区分 UTF-8 传输体积、字符串计量和浏览器实际配额。

**结构性成本来自：**

1. 所有项目共享 origin 的 Web Storage 空间，项目历史长期增长；
2. 每次保存重新序列化完整状态，主线程同步写入；防抖降低次数，不改变单次工作量；
3. workspace、catalog 与 IndexedDB assets 分属不同写入边界；
4. 为了维护跨存储一致性，需要读回验证、补偿、catalog 恢复、provisional Blob 清理等越来越多的特殊处理；
5. 模型 Context compaction 保留原始聊天，它不是磁盘历史压缩，不能解决这一容量增长。

已有 Web Locks、read-only lease、原始数据保护、persist() 请求、失败分类和内存备份出口都值得保留。这些保护使当前实现可以安全失败，但不会提高 localStorage 的规模上限。[现有锁](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/infrastructure/persistence/projectWriteLock.ts)、[存储持久性](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/infrastructure/persistence/storageDurability.ts)。

**建议：逐步以 IndexedDB 承担结构化项目持久化，localStorage 退回少量启动信息或 UI 偏好。**

先保留当前 MorphoWorkspace DTO 和可编辑备份契约；是否进一步把消息、revision 和 artifact 分成可按需读取的集合，应由项目规模与读取成本决定。直接引入关系数据库或把所有字段拆表，不是获得第一阶段收益的必要条件。

这条建议解决的是已经存在的配额天花板、同步 I/O 和跨记录提交成本，不是因为 IndexedDB 更新。

**现实迁移成本：中高，主要难点并非读写 API。**

- 当前 flushWorkspace 和 AgentTurnHost.persistWorkspace 都同步返回状态；Runner 用这个状态判定 local persistence 是否成功。改成异步存储必须同步改变“保存成功”的确认方式，不能只给 setItem 换一个 Promise。
- 需要让提交确认绑定正确的项目与状态版本，避免新修改尚未保存，却因旧写入完成显示 saved。
- pagehide/beforeunload 不能变成异步保存的唯一兜底；正确性写入应在正常运行期间完成确认。
- 旧 localStorage、v1–v16 数据、v17 当前数据、Recovery metadata/payload、备份恢复都需要兼容验证；迁移完成前不能删唯一旧副本。
- 不应维持无期限的双主写入；它会制造第二套冲突和恢复问题。
- IndexedDB 不会自动消除 JSON 序列化、结构化克隆或大量历史常驻内存的成本。

原生 IndexedDB、轻量 idb 和 Dexie 都可行。当前只需修复提交语义时，原生小改足够；当项目存储、事务和版本管理扩展时，idb 是低耦合选择，Dexie 的事务与 schema 管理也有真实价值。Dexie 不会自动处理 Morpho 的对象关系、业务 schema migration 或 backup compatibility。[idb transaction completion](https://github.com/jakearchibald/idb#idbtransaction-enhancements)、[Dexie transactions](https://dexie.org/docs/Dexie/Dexie.transaction())。

### 3.2 一个已复现的底层缺陷：Blob 写入提前确认成功

[indexedDbAssetStore.ts](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/infrastructure/assets/indexedDbAssetStore.ts#L56) 的 runTransaction 在 request.onsuccess 中 resolve，没有等待 transaction.oncomplete，也没有独立处理 transaction.onabort。

本轮使用该文件原样转译后的逻辑，在真实 Chromium IndexedDB 中观察到：

    await indexedDbBlobStore.put(...) 已成功返回
    transaction.abort() 仍被接受
    transaction.abort 事件发生
    随后 get(...) 返回 null

这是故障注入实验，不是生产丢图事故报告；它证明当前成功确认不足以证明事务提交。

影响不只图片：A+ Recovery payload 也复用 indexedDbBlobStore，随后把引用写进 localStorage。见 [Recovery payload adapter](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/agentTurnRecoveryStore.ts#L482) 和 [metadata 写入](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/agentTurnRecoveryStore.ts#L334)。因此“write-ahead 已完成”的基础证明也依赖这个适配器。

**裁决：优先修正，范围小，无需换数据库。** 等待事务完成、正确传播 abort/error，并保证连接释放。这一修复不需要改变已有资产 ID、Blob key、项目 schema 或备份格式。

即便等待 transaction complete，也不能把它宣传成免疫断电、设备损坏或用户清除站点数据。这里要求的是正确的事务确认语义。[MDN transaction complete](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event)。

## 4. React、controllers 与应用状态：保留模型，演进提交边界

**当前健康部分：** domain actions 仍以显式输入输出处理业务规则；多条执行路径已有 React-free execution core 与 session guard；controllers 主要承担生命周期与 UI 接线。usePersistentWorkspace 的 memory reconciliation 有输入变更门，流式正文和纯 Canvas 变化不再无条件重建 memory。

**值得演进的具体边界：** [commitWorkspaceStateNow](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/workspaceCommitBoundary.ts#L20) 把 transform 放进 React state updater，以 flushSync 强制执行，再同步取回业务返回值。[AgentTurnHost](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/agentTurnHost.ts#L53) 与 Runner 进一步依赖同步 commit/persist。

这说明应用命令的执行顺序和结果获取部分依赖 React 的渲染调度。真实成本包括：为了获得命令返回值强制 UI 同步提交；未来异步持久化更难接入；新增无 UI 的执行宿主需要继续模拟此契约。

**这是架构边界债务，不是“React state 不能管理复杂应用”。** 本轮没有用当前性能测量证明 flushSync 是首要卡顿来源，不能据此宣布性能故障。

合理方向是让项目会话拥有明确的 current snapshot、命令提交与持久化确认接口，React 订阅其显示状态。可以利用 [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)，也可以在原有 Host/commit port 内逐步演化。它可以是项目级对象，不必是全局 store；更不要求引入 Redux、Zustand 或 XState。

迁移风险中高：撤销、选择、Agent 连续工具、异步导入、确认回调、A/B/A 项目切换以及 saved/dirty 状态都经过这一边界。应结合存储演进解决，不另开“全面状态框架替换”。

更小的办法仍然有效：保持纯 transform、保留 session guard、限制 flushSync 使用面、继续在已知热点上做 selector/memo 优化。React Compiler 已稳定，但其自动 memoization 解决的是重复计算和渲染，不解决数据库容量、事务提交与领域原子性；仅在当前 profile 指向这些开销时进行受控比较。[React flushSync](https://react.dev/reference/react-dom/flushSync)、[React Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1)。

## 5. Canvas：早期选择依然正确

**Retain tldraw，Retain Morpho domain truth。**

Morpho 已购买到 Canvas 引擎最有价值的部分：几何、相机、命中测试、选择、拖动、交互历史和自定义 shape 能力。对象状态、关系、修订、交付引用与确认规则留在 Morpho，是正确隔离。

当前已经有 [Canvas 输入门](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/tldraw/canvasEditorSyncInputs.ts#L11)，聊天正文变化不导致完整 editor 重同步。不能沿用旧性能报告把这一问题当成未修复。

仍存在两个规模相关实现成本：

- editor 中有 geometry 变化时，syncShapesFromEditor 仍读取全部 Morpho shapes、生成全部 instances；
- 投影输入变化后，syncWorkspaceToEditor 仍遍历 renderableInstances 构建展示属性。

见 [Canvas 映射](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/tldraw/MorphoCanvas.tsx#L473)。这证明有 O(N) 同步工作，不证明用户当前已经遇到不可接受的延迟。

将来若实际项目在拖动或对象变化时越过预算，优先使用已收到的 shape diff、受影响 instance 集合与稳定投影缓存。应保留全量重建路径用于初始化与校验，不能靠增量遗漏换取速度。

让 tldraw Store 成为 Project Truth，或直接接入 tldraw sync，不会自动解决 Morpho 的语义冲突、确认、稳定交付快照与 AI 写入授权；还会把领域 schema 和备份绑定到 Canvas SDK。换到 Konva/Pixi/自研 Canvas 则必须重建目前已有的大量交互。当前没有相应收益依据。[tldraw Store](https://tldraw.dev/sdk-features/store)、[tldraw sync](https://tldraw.dev/docs/sync)。

## 6. Agent Runtime：不重写，但补齐外部执行与宿主的契约

### 6.1 这些层并非重复建设

| 层 | 当前职责 | 保留理由 |
|---|---|---|
| Lifecycle reducer / Coordinator | 回合状态、合法转换、恢复与服务端状态协调 | Overall Local Outcome 必须考虑本地工具、确认和保存 |
| Runner | 组织准备、模型调用、工具执行、结果回写 | 承载 Morpho 产品循环 |
| Journal / SQL RPC | 外部执行身份、授权、计数、幂等与超时收敛 | 浏览器不能自行宣布付费服务端工作成功 |
| Recovery | 保存原始请求与本地进度，刷新后安全恢复 | 服务端不保存 Project Truth，客户端需要自己的恢复依据 |
| SSE | 传递活动与结果 | 传输协议不承担 durable execution |

由 AI SDK/LangGraph 重写以上内容，仍需重新建立这些 Morpho 特有边界。AI SDK 已提供成熟 tool loop、stopWhen、prepareStep；LangGraph 提供 checkpoint、interrupt 和持久恢复，但框架状态不自动等价于本地 workspace 的已保存事实。[AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control)、[LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)。

建议继续保留 A+。如果未来接入多个真正不同协议的 Provider，优先评估只替换 Provider adapter，而非替换产品 Runner、confirmation 或 Journal。

### 6.2 已存在的宿主适配缺口：传输容量与时间预算

**请求体：** A+ body 上限为 36 MiB，image action 允许单个参考图 data URL 8 MiB、总计 24 MiB；visual generation 从原始 Blob 直接转 data URL。见 [body limit](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/server/ai/agentTurnRouteSupport.ts#L12)、[image validation](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/app/api/ai/agent/turns/%5BturnId%5D/actions/image/handler.ts#L255)、[客户端编码](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/workspaceVisualGenerationExecution.ts#L871)。

Vercel 官方普通 Function 请求体限制为 4.5 MB。一个 4 MiB 参考图转 Base64 后约 5.33 MiB，在当前应用校验允许范围内，却超过该宿主入口。这是代码契约与当前官方平台限制的冲突。**本轮没有向生产发送大请求，因此不声称已经复现线上 413。** [Vercel Functions limits](https://vercel.com/docs/functions/limitations)。

**执行时间与取消：** Provider budget 为 15 分钟；route 没有声明 maxDuration。SSE start 内启动异步执行，cancel 只关闭输出；取消端点通过模块内 Map 找 AbortController。见 [request handler](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/app/api/ai/agent/turns/%5BturnId%5D/requests/handler.ts#L214)、[进程内取消表](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/server/ai/agentTurnExternalCancellation.ts#L7)。

推断：多个实例或独立 route 部署时，取消请求不保证找到执行实例；HTTP/SSE 脱离后，不主动 abort 不等于平台保证任务继续运行。Journal 的过期收敛不会替应用恢复已被终止的计算。当前取消接口明确返回 observed，属于 best effort，而不是已经承诺的可靠跨实例取消。

Vercel 现在已有更长执行上限，部分运行时支持 30 分钟 Beta；因此“Serverless 只能跑十几秒”是过时判断。但更长上限仍不等于 durable execution，且需要正确配置。当前生产账户的实际 maxDuration、Fluid 设置和实例路由未检查。[Vercel duration](https://vercel.com/docs/functions/configuring-functions/duration)、[Next.js after](https://nextjs.org/docs/app/api-reference/functions/after)。

**建议：先使有效 payload、期限和取消承诺与宿主一致。** 可采用受控压缩、总请求字节预算、适合的传输路径与函数生命周期处理。若保真图片确实超出普通 Function 入口，则临时资产上传/下载通道是有依据的增量方案；不能只提高应用常量或 silently 丢参考图。切换整个 Next.js 应用或整个云平台不是必要前提。

### 6.3 已付费结果无法重新取得，比换 Agent framework 更值得重视

image action 先把状态 settle 为 externallyCompleted，再返回 Blob；重放已完成 Action 明确返回 external_action_result_unavailable，因为 Journal 没有二进制结果。见 [image completion/replay](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/app/api/ai/agent/turns/%5BturnId%5D/actions/image/handler.ts#L195)。

Provider 请求同样不是 durable output stream：重放返回状态，不重发完整输出；Coordinator 明确处理 awaitingNextRequest 但本地没有 providerOutput 的状态。见 [output unavailable](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/agentTurnCoordinator.ts#L668)。

当前机制很好地避免了盲目重复付费，却没有保证结果最终送达。这是已经存在的恢复能力边界，不是本轮发现的线上事故。

若要提升付费生成的可靠性，最小有意义的方向是：给同一个执行身份提供有期限、可重新取得的结果凭据；优先用 Provider 已支持且验证过的 task result retrieval，否则考虑受控的短期私有结果存储。保持本地接收和应用幂等，并明确生命周期和清理责任。**临时保存外部执行结果不要求把 Project Truth 云端化。**

代价中等：新增结果保留、鉴权、到期、成本与隐私责任；需要 forward-only Journal 契约演进，保护已经在运行的旧 Action。收益是把“已生成但响应丢失”从不可恢复状态变成可重新交付。

只有当产品明确需要关页后继续整轮、多设备接手、长等待、多后台任务并发时，才评估专用 worker、队列或 Temporal/Workflow 等 durable execution。此时需迁移的是执行责任与数据可达性，单独安装 framework 无法让服务器访问尚在浏览器中的资料。[Temporal workflows](https://docs.temporal.io/workflows)、[Temporal activities](https://docs.temporal.io/activities)。

## 7. 资产、备份、schema：保持便携性，调整规模假设

**schema migration 和备份方向正确。** 当前 schema 为 17，parse/migrate 接受 v1–v16；可编辑备份有独立 envelope，恢复生成新项目 ID，并为 Blob 创建 runtime storage key。它们让存储替换不必连带更换项目格式。不要仅为了引入 Dexie/SQLite 而删除旧迁移器，或把数据库内表结构直接暴露为唯一备份格式。

**资产 I/O 有可见的规模成本。** workspaceAssetUrlCache 会为所有 originalImage/aiGeneratedImage 读取 Blob 并创建 URL，各次完成发布整个 URL map；已缓存的资产不会重复读取，过期 URL 也有释放，不能称其“完全没有缓存”。但它不按视口或预览分辨率限制加载，MorphoShape 使用原始 assetUrl。[asset URL cache](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/workspaceAssetUrlCache.ts#L93)、[shape image](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/workspace/tldraw/MorphoShapeUtil.tsx#L521)。

优先考虑按需预览、缩略图与有限并发，原图继续作为原始资产保存。不要把 Blob URL 的存在等同于每张图已完全解码；真正的 GPU/解码占用需要浏览器测量。tldraw 现在有成熟的图像分辨率选择和低缩放简化模式，但 Morpho 的自定义 shape 不会因为升级 SDK 自动获得全部收益。[tldraw performance](https://tldraw.dev/sdk-features/performance)。

**备份具有整包内存与恢复上限。** 当前先把资产 arrayBuffer 聚合，再构建 ZIP；大于 2 MiB 已使用异步 fflate 压缩，应保留这项优化。它减少压缩阻塞，不消除完整输入/输出常驻内存。当前恢复边界为 128 MiB compressed、256 MiB included uncompressed、4096 entries/2048 included entries。[bundle construction](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/archive/projectBundleClient.ts#L382)、[ZIP threshold](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/archive/projectBundleClient.ts#L469)、[restore budget](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/features/archive/projectBundleClient.ts#L573)。

未来增加项目容量时，应同时确认“能创建的项目仍能完整备份并恢复”。仅迁移 Workspace 到大容量数据库，可能把第一个瓶颈移到备份上。更小的路径是明确端到端容量边界、按需求演进流式/分卷输出；不应只解除恢复限制。

当前项目级删除已有保守 Blob 回收，对象级和未知孤儿 Blob 的通用回收没有实现。这是生命周期能力不足，不是 IndexedDB 选型错误。不能用换 OPFS 代替引用所有权判断，也不能把无证据自动 GC 当成本次建议。

## 8. 替代方案的实际成本与触发条件

| 替代方案 | 真正解决的问题 | 迁移/回归与数据影响 | 耦合及维护 | 本轮建议 |
|---|---|---|---|---|
| IndexedDB + 原生/idb | Web Storage 容量、同步写入、事务确认 | 中高；保存 ACK、退出、恢复、旧数据迁移；可保留 DTO/backup | 低；仍依赖浏览器存储语义 | Evolve |
| Dexie | 多 store、索引、事务和物理 schema 管理 | 中；与现有读写适配渐进集成；业务迁移仍自管 | 低至中；新增数据库封装依赖 | 存储演进时比较，不为修一个 Promise 强行引入 |
| SQLite Wasm / OPFS | 真正出现大量索引查询、SQL join、全文检索或随机文件 I/O | 高；数据转换、worker/VFS、并发锁、导出兼容 | 中高；不同 VFS 的隔离与并发要求不同 | 当前不足以证明优于 IDB；触发后再议 |
| OPFS Blob 文件层 | 大文件流、随机读写、文件式处理 | 中；迁移 Blob key，双存储一致性仍需处理 | 中；仍是 origin 私有数据 | 当前图片存储不需换；大文件实测触发 |
| 项目级外部 store | 应用命令独立于 React 调度、细粒度订阅 | 中高；所有写入/undo/session/recovery 回归 | 可低耦合；不必第三方或全局 | 随持久化演进处理 |
| React Compiler | 已定位的冗余渲染和计算 | 低至中；构建与 memo 行为验证，无数据迁移 | React 构建耦合 | 小范围 profile 对照；不是基础架构替换 |
| AI SDK Provider adapter | 多 Provider 的协议、流、tool-call 差异 | 中；缓存前缀、request hash、事件/引用/usage/continuation 回归 | 中；依赖 SDK 的协议抽象 | 当前保留 adapter；多协议维护成本真实出现时评估 |
| LangGraph / 第三方 Agent Runtime | 需要其 graph/checkpoint/interrupt 模型 | 高；工具、确认、Memory、Recovery、Journal 重新映射，存在双重状态权威风险 | 高；框架运行模型耦合 | 不重写 A+ |
| Durable worker / Temporal / Workflow | 无浏览器仍持续执行、长任务和跨实例可靠协调 | 高；执行状态迁移、版本化 replay、部署运维、外部副作用幂等 | 中高；依选型 | 由后台执行产品承诺触发 |
| PWA | 无网络重新打开项目、安装与离线应用壳 | 中；缓存升级、认证、旧客户端与新 schema 共存 | 低至中；浏览器生命周期仍在 | 产品明确要求离线重开时做 |
| Tauri / Electron | 用户拥有的文件目录、系统集成、本地模型、原生后台运行 | 高；IPC、签名更新、打包、各 OS 测试、浏览器数据搬迁 | 新宿主与工具链耦合 | 当前不迁移 |
| 云同步 / CRDT | 多设备持续使用、多人并发编辑和冲突合并 | 很高；对象/关系/确认/交付语义合并、认证与资产同步 | 高；网络与服务长期责任 | 明确协作/同步需求后再评估 |
| 换 Canvas / 前端框架 | 目前没有对应的已证实基础问题 | 很高；重做交互与渲染，回归面覆盖全产品 | 换一组依赖，不消除 domain 复杂度 | Retain，停止主动重开 |

OPFS 不会自动解决站点数据被用户清除或 origin 存储被驱逐的问题；其优势是文件访问方式。SQLite Wasm 的不同 VFS 对 SharedArrayBuffer、COOP/COEP 和并发的要求也不同，不能把某个 VFS 的限制泛化为全部方案。[MDN OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)、[SQLite persistence](https://sqlite.org/wasm/doc/tip/persistence.md)。

当前 local-first 是“项目事实保存在浏览器”，尚不是完整 offline-first 产品：页面加载仍有认证路径，未发现 Service Worker/offline app shell。PWA 能解决离线入口，但不能使付费 AI 离线运行，也不能保证关页后 Agent 持续执行。[项目路由](https://github.com/Whatnamed/Morpho/blob/2e801ed1558822e6cf46a0e19f7ff84654e7ae69/src/app/projects/%5BprojectId%5D/page.tsx)、[PWA assets/data](https://web.dev/learn/pwa/assets-and-data)。

Desktop 也不会自动修复主线程同步保存或错误的事务 ACK；如果仍沿用 WebView 内原有存储，问题会随代码一起搬过去。必须先有原生文件所有权或系统能力需求，才足以承担新宿主成本。[Tauri process model](https://v2.tauri.app/concept/process-model/)。

## 9. 未来一两年的优先判断

**应先调整的三个基础问题：**

1. **保存成功的定义与本地项目数据库。** 先修已复现的事务确认缺陷，再把整体存储演进视为有明确收益的基础工作；保护现有项目和备份兼容。
2. **外部执行的端到端保障。** 让图片字节预算、平台时限、跨实例取消语义与结果可重新取得能力形成一致契约；先做窄范围演进，不先引入 workflow engine。
3. **应用命令与 UI 调度的边界。** 配合异步持久化，让提交事实不依赖强制 React render；保留目前 domain actions 和 session guards。

**应明确停止反复重开的方向：**

- 为复杂度而换 Next.js/React，或把本地工作区硬改成 server state；
- 把 tldraw Store 当成项目数据库；
- 用新的 Agent framework 重建 Morpho 的业务确认与权威边界；
- 因 WorkspaceClient 文件较长而继续以文件大小为目标机械拆分；
- 在无协作需求时引入 CRDT，在无后台执行承诺时引入 durable workflow；
- 因为 Web 已经复杂而迁移 Desktop；
- 以“压缩模型 Context”代替存储生命周期，或以“换 OPFS”代替备份和所有权治理。

**最终回答：Morpho 的早期核心选择大多仍然正确。已经被项目规模追上的，是同步整包持久化、与 UI 调度绑定的提交接口，以及外部执行过分依赖一次请求生命周期的实现方式。最值得投入的是这些可渐进替换的边界；现有产品语义、Canvas 隔离和 A+ 权威划分应作为迁移时的稳定资产保留。**
