**当前 Morpho 的模块化健康度属于“有清晰基础，但领域一致性边界尚未收口”。** 现有架构不需要推倒重来；真正的问题集中在：**一次领域变化由谁负责完整维护，以及“当前有效”的判断由谁拥有。**

本次基于干净工作区、HEAD `2e801ed1558822e6cf46a0e19f7ff84654e7ae69` 独立检查，没有沿用上一轮 Truth 审计结论，也没有修改文件。分析覆盖 `src` 下 271 个非测试 TS/TSX 文件、930 条内部导入边，并沿删除、状态切换、Proposal 应用、Memory 投影、Undo、Agent 执行与持久化链路核实职责。

整体上可以作出以下判断：

| 区域 | 判断 |
|---|---|
| Feature → Domain | 主方向正确，但 Feature 中仍混有应用用例、领域策略和运行时协议 |
| Domain | 多数规则已脱离 React，但若干中心模块承担过多职责，完整状态维护依赖调用者 |
| Runtime | reducer、Coordinator、Host、Runner 已形成有价值的边界；目录归属和部分类型依赖不够清晰 |
| Server | 外部执行与本地项目事实的 authority 区分合理；Agent contract 对 Feature 存在反向依赖 |
| Infrastructure | 持久化和资产适配总体合理；部分实际基础设施行为反而放在 Domain |
| WorkspaceClient | 既有拆分有效，主要异步边界已经建立；剩余工作应围绕领域语义，而不是继续削减行数 |

**最主要的结构问题，是领域更新没有统一的完成条件。**

当前存在多种组合：

- 领域函数更新对象，再调用 `reconcileWorkspaceDerivedState`。
- 部分函数追加 Continuity event，部分只解析 validity。
- `usePersistentWorkspace` 另外负责 Memory reconciliation。
- 部分查询临时重算 Memory，另一些直接读取已保存的当前修订。

例如，[usePersistentWorkspace.ts:154](/D:/Morpho/src/features/workspace/usePersistentWorkspace.ts:154) 在 setter 中维护 Memory；[projectContinuity.ts:495](/D:/Morpho/src/domain/morpho/projectContinuity.ts:495) 的查询会调用 Memory reconciliation；[agentToolExecutors.ts:200](/D:/Morpho/src/features/workspace/agentToolExecutors.ts:200) 的 Memory 工具则直接读取当前修订。

这些函数没有因此自动形成多个独立数据库，但它们形成了**不同的状态完成边界**：领域函数返回的结果、页面提交后的结果、查询临时计算的结果，不能仅从接口上保证具有相同的一致性。

这比“文件太大”更值得优先处理。

我在内存中直接调用当前函数，复现了以下问题：

| 场景 | 实际结果 | 对模块边界的含义 |
|---|---|---|
| 删除交付包 | 留下属于该交付包的 `DeliveryReference`，无法通过当前 Workspace 校验 | 通用删除不了解被删除对象拥有的子记录 |
| 删除方向、源文件 | 分别留下图片/VisualBranch 的方向引用、DocumentFragment 的文件引用，校验失败 | 引用生命周期与删除职责没有统一契约 |
| 方向 `eliminated → alternative` | Decision 分类已将旧决定标记为 superseded；Continuity 仍将两条记录标记为 current，Stage 同时出现淘汰与备选内容 | 同一变化存在不一致的 currentness 判断 |
| 某阶段的投影内容全部消失 | 旧 Stage 修订指针不变，旧内容仍存在且 `reviewRequired=false` | 投影生命周期缺少“从有内容到空”的处理 |
| 同一设计定义应用 r1、r2 | 两条 Decision 都被分类为 current；Continuity 正确区分旧、新修订 | Decision 缺少足够的版本身份，分类只看到对象身份 |
| VisualBranch `archive → restore → archive` | 第二次 archive 没有新增 Continuity 记录，Current Focus 仍显示“已恢复” | 去重键把不同操作误认作同一次操作重放 |
| 已有 assistant 消息正文更新后 Undo | ID 没增加，因此允许恢复整个旧 Workspace，正文从 completed 回到 pending | Undo 的恢复范围大于它实际检查的保护范围 |

关键证据分别位于：

- 删除：[workspace.ts:632](/D:/Morpho/src/domain/morpho/workspace.ts:632)；校验：[currentWorkspaceValidation.ts:64](/D:/Morpho/src/domain/morpho/currentWorkspaceValidation.ts:64)。
- currentness：[decisionRecords.ts:19](/D:/Morpho/src/domain/morpho/decisionRecords.ts:19)、[projectContinuity.ts:1165](/D:/Morpho/src/domain/morpho/projectContinuity.ts:1165)。
- Stage 投影：[projectMemory.ts:256](/D:/Morpho/src/domain/morpho/projectMemory.ts:256)、[projectMemory.ts:778](/D:/Morpho/src/domain/morpho/projectMemory.ts:778)。
- 事件去重：[projectContinuity.ts:1058](/D:/Morpho/src/domain/morpho/projectContinuity.ts:1058)。
- Undo：[workspaceUndo.ts:89](/D:/Morpho/src/features/workspace/workspaceUndo.ts:89)、[WorkspaceClient.tsx:712](/D:/Morpho/src/features/workspace/WorkspaceClient.tsx:712)。

这些是领域函数级复现，未声称完成对应浏览器流程。它们足以说明：**部分 Truth correctness 问题确实反映了更深层的职责问题，但不是所有问题都需要等待架构重构才能修复。**

**依赖图中，有一处真正的运行时循环，以及几类应该调整的反向依赖。**

1. **`projectMemory ↔ projectContinuity` 是运行时双向依赖。**

   Memory 依赖 Continuity 的有效性与准入判断；Continuity 又负责调用 Memory、生成 Memory View 和 Context。

   这反映出一个实际职责混合：事件记录、来源有效性、当前投影、Agent Context 组装放在了相互调用的两个模块里。不是简单改成 `import type` 就能解决。

2. **Server 从 workspace Feature 导入 Agent contract。**

   [agentTurnProviderRequest.ts:5](/D:/Morpho/src/server/ai/agentTurnProviderRequest.ts:5) 导入 `agentPromptRegistry` 和 `morphoAgent`。后者同时包含工具 schema、参数解析、执行策略、用户措辞识别、Context 与 Prompt 构造。

   应让客户端与 Server 共同依赖一个中立的 Agent contract。当前没有扫描到 Feature → Server 的运行时导入边，不能据此声称服务端实现或密钥已经进入客户端；这里首先是**依赖归属与未来变更风险**。

3. **公共类型由具体实现模块反向提供。**

   `shared/agentStrategyItem`、`shared/designMethodPack` 从 Server Provider 实现导入消息类型；Domain 从 `localAssetWorkflow` 导入 `BlobStore`、`ImageAssetDimensions`。

   它们目前是类型依赖，不等于运行时耦合，但接口 ownership 放反了。

4. **Domain 内存在实际基础设施职责。**

   [documentParsing.ts:115](/D:/Morpho/src/domain/morpho/documentParsing.ts:115) 加载 PDF.js 并配置 Worker；[caseStudyInstallation.ts:33](/D:/Morpho/src/domain/morpho/caseStudy/caseStudyInstallation.ts:33) 执行 fetch、BlobStore 与 Storage 操作；Case Study importer 还有 Node 文件系统读写。

   Parser 适配应进入 Infrastructure，安装编排进入应用层，离线导入工具进入 tooling。资源限制、解析结果模型等纯规则可以继续属于 Domain。

加入类型边后，还存在 `morpho/types ↔ operations/types`、Provider ↔ Stream parser，以及 Host/Tool/Preparation/Recovery 组成的类型循环簇。它们应通过**由使用方拥有 port、由中立模块拥有协议类型**逐步消解，不应与运行时循环混为一谈。

当前 ESLint 没有层级依赖限制；既有架构测试主要保护 A+ 单一路径和退休协议，不会阻止上述边界继续扩散。

**大文件应按变化原因判断，不能按长度判断。**

| 模块 | 判断 | 推荐处理 |
|---|---|---|
| `workspace.ts` | 明确的 God module | 同时拥有初始化、fixture、对象命令、方向/视觉/结论规则、Context、序列化和历代迁移，应按这些稳定职责提取 |
| `operations.ts` | 明确的跨领域枢纽 | Operation 生命周期与 Research、Definition、Direction 的 Proposal 应用应分开；同一个应用事务内部保持完整 |
| `projectContinuity.ts` | 多职责中心模块 | 分离历史事件、来源有效性、语义记录准入、当前投影读取和 Context 组装 |
| `projectMemory.ts` | 有清晰核心，但边界偏宽 | 保留七类文档与六类 Stage 投影的共同入口；把 Agent 裁剪策略和兼容解析移出 |
| `morphoAgent.ts` | Agent contract 与应用策略混合 | 按 contract、用户意图/授权策略、Context 构造拆分，不按每个工具拆成小文件 |
| `WorkspaceClient.tsx` | 大型 composition root，仍有少量领域泄漏 | 保留组合职责；迁出剩余结论草稿规则和完整命令编排 |
| Lifecycle、Coordinator | 复杂但相对内聚 | 保留状态机与协议生命周期整体，避免按状态机械拆文件 |
| DeliveryPreparation、Canvas、SSE parser、格式校验器 | 大多有独立且明确的变化原因 | 保持子领域内聚，只提取确有独立契约的部分 |

这里尤其不建议把 `operations.ts` 简单切成 `helpers1/2/3`，也不建议建立一个新的万能 `ProjectTruthService`，把现有复杂度集中搬过去。

**WorkspaceClient 的既有拆分，已经在主要异步职责上合理收口。**

Document Reader、Import、Visual Generation、Agent Runtime 等 Controller 不只是包装函数：它们确实拥有会话身份、失效判断、取消、资源释放和提交时的项目检查。例如 [useWorkspaceAgentRuntimeController.ts:230](/D:/Morpho/src/features/workspace/useWorkspaceAgentRuntimeController.ts:230) 将 Host 的读写与 UI 效果约束在当前会话内。

应保留：

- 页面作为 Controller 和组件的组合点。
- Canvas 的选择、定位与跨表面协调。
- React wiring 与 Import/Visual Generation execution core 的分离。
- Document Reader 对 Object URL、请求和会话的所有权。
- Surface Controller 的关闭顺序，以及 Selection/Navigation 的独立历史。
- Pending Confirmation 的会话 ownership 与实际执行逻辑的区分。

剩余值得迁出的，是 [WorkspaceClient.tsx:2677](/D:/Morpho/src/features/workspace/WorkspaceClient.tsx:2677) 这类决定结论类别、置信度和状态的领域规则，以及涉及多项领域维护的手动命令。**Undo Hook 已经拆出，并不意味着 Undo 语义已经正确收口**；它仍把整个 Workspace 的捕获与恢复交给页面。

不建议继续拆 JSX 片段、每个按钮 handler，或引入通用 Controller 框架统一所有会话。它们的取消、恢复和持久化要求并不相同。

**目标应是单一 authority，而不是把所有相似状态合并成一个状态。**

| 事实或状态 | 推荐唯一 owner | 其他模块的角色 |
|---|---|---|
| 当前设计定义、方向状态、默认参考 | 对应领域命令与对象/修订模型 | WorkingState、Memory、UI 读取派生结果 |
| Decision 的目标与变化 | 带结构化目标、版本、动作语义的 DecisionRecord | 文案仅用于展示，不反向解析为事实 |
| 来源是否存在、隐藏、修订是否变化 | 统一的来源解析规则 | Proposal、Memory、Delivery 分别决定业务后果 |
| 历史发生过什么 | 追加的事件与历史记录 | 当前视图单独计算有效性 |
| Memory 与 Stage 当前内容 | 确定性投影及修订管理 | Agent/UI/导出读取同一结果 |
| Delivery 已选内容 | 稳定 DeliveryReference snapshot | 上游变化只影响状态提示，显式刷新才更新快照 |
| 外部请求状态 | Server Journal | 客户端消费状态 |
| 整个本地 Agent Turn 结果 | Lifecycle/Coordinator | UI 展示，Server 不代管本地项目正确性 |

需要特别避免两种过度统一：

- **来源不可用、修订过期、决定被替代、历史仍可追溯，是不同维度。** 可以共用来源解析，不能共用一个万能 `isCurrent`。
- **Proposal 的语义 fingerprint 与 Delivery 的快照 fingerprint 不必相同。** 应去掉同一契约的重复实现，例如迁移和 Operations 中重复的 Source Semantic Snapshot 构造；不能强行让不同用途共用一种哈希。

引用维护也应明确区分：对象拥有的子记录、当前有效关联、允许源对象消失的历史引用、独立稳定快照。删除时逐类处理，不能统一级联删除，也不能全部放任悬空。

**推荐的目标结构如下。** 这是职责布局，不要求一次性搬迁或每个目录立即创建多个文件；持久化的 `MorphoWorkspace` 聚合及 schema 可以先保持不变。

```text
src/
  app/                         # 路由与服务装配

  features/workspace/          # 页面、组件、Controller、Canvas adapter
  features/projects/
  features/archive/
  features/delivery-output/

  application/
    workspace/                 # 完整用例、提交契约、手动操作历史
    agent/                     # 产品准备、工具执行、确认、Context 组装

  runtime/agent/               # Lifecycle、Coordinator、Runner、Recovery 协调

  contracts/agent/             # 工具定义/解析、协议 DTO、稳定 Prompt contract

  domain/morpho/
    workspace/                 # 聚合、初始化、对象生命周期
    research/                  # Research 与 KeyConclusion
    definition/                # 设计定义、修订、应用规则
    directions/                # 方向、lineage、VisualBranch、默认参考
    proposals/                 # 草稿生命周期、来源审查
    operations/                # Operation record 生命周期
    history/                   # Decision、Continuity、来源与有效性规则
    memory/                    # Memory/Stage 投影与修订
    delivery/                  # 稳定引用、章节、草稿及输出规则
    compatibility/             # 迁移、旧格式归一化、序列化边界

  infrastructure/
    persistence/
    assets/
    documents/                 # PDF/PPTX 等具体解析适配

  server/                      # 认证、请求校验、Journal、Provider
  shared/                      # 真正无业务归属的公共基础能力

tooling/                       # Case Study 离线导入等工具
```

依赖约束应保持简单：

- Feature 依赖应用用例与领域查询。
- 应用层组合 Domain、Runtime，并通过明确 port 使用存储、网络和 UI 能力。
- Runtime 不反向依赖 Feature；Host 类型不从具体 Tool Executor 导入。
- Server 与客户端共同依赖 Contract；Contract 不依赖 React、存储或 Server 实现。
- Domain 不依赖 Feature、Runtime、Server 或 Infrastructure。
- Infrastructure 实现 port；不决定项目 currentness。
- `MorphoWorkspace` 可以继续是统一存储聚合，但不因此让每个函数都拥有任意字段的写入权。

用例提交可以形成一个明确的同步顺序：**领域变化 → 必需的引用维护 → 记录事实变化 → 更新相关投影 → 提交结果**。这是显式函数组合，不需要引入事件总线、事件溯源或新的状态管理框架。Canvas 移动、流式正文等变化应继续跳过无关投影，保留目前已有的性能优化。

**低风险执行顺序建议如下。**

| 阶段 | 工作 | 验收与停止条件 |
|---|---|---|
| 0：独立 correctness 修复 | 修复删除后的引用完整性、空 Stage 失效、Undo 覆盖既有记录更新、重复事件被吞；为 currentness 分歧建立回归 | 每个错误有独立复现和修复；不混入文件搬迁 |
| 1：依赖归属调整 | 提取中立 Agent contract/port/types；移出 Domain 中的 parser、安装与离线工具职责；增加导入边界检查 | Prompt/schema/请求格式不变；Server 不再导入 Feature；消除对应反向依赖 |
| 2：History 与 Memory 收口 | 提取来源有效性与 Decision 分类；分离事件、当前视图、投影修订；消除 Memory/Continuity 循环 | 相同输入得到一致分类；空投影正确推进；历史保留；重复计算不新增等价修订 |
| 3：领域命令提取 | 从 workspace/operations 提取 Definition、Direction、Research、Delivery 命令，统一完成边界 | 手动、确认、Agent 入口调用同一规则；合法命令结果可通过当前校验与序列化往返 |
| 4：Undo 与应用层收口 | 从整份 Workspace 恢复转向手动操作拥有的变化集，设置冲突保护；页面调用完整用例 | Undo 不覆盖聊天、运行中操作及独立新增事实；Redo 对称；保留导航撤销优先级 |
| 5：整理目录与兼容入口 | 完成 Runtime 归位，按引用证据移除重复/遗留入口，更新架构文档 | 不改变产品行为、存储协议、恢复语义；不以文件长度作为继续拆分理由 |

阶段 0 的 Undo 修复应先保护现有模型中会被覆盖的数据；完整的操作级 Undo 是阶段 4 的重构，不能为了等待它而继续允许错误恢复。

Decision 的版本身份与事件操作身份可能需要补充结构化字段。建议作为**独立的 correctness 变更**处理兼容和回归，再接入阶段 2 的统一规则。旧记录无法确认的部分应保留为 historical/reviewRequired，不能根据当前状态伪造过去的决定。

适合随重构一起解决的是：规则重复、类型反向依赖、查询中隐含 reconciliation、调用者负责补齐投影、迁移与运行时重复 fingerprint，以及持久化 Hook 承担领域收尾。这些属于职责迁移；已经复现的数据错误应有独立修复和验证记录。

本轮执行了 TypeScript AST 依赖扫描、上述内存反例、两组定向 `npm.cmd test -- --reporter=dot ...`，以及 `npm.cmd run typecheck -- --incremental false`。**20 个测试文件、401 项测试通过，TypeScript 检查通过**；部分 Controller 测试有 React `act(...)` 警告。未运行浏览器、生产构建或远端服务验证。仓库文件未修改，工作区仍干净。