# Morpho AI Operation Runtime

本文件记录 Milestone 3 引入的 AI Operation Runtime 边界。它是当前工程实现依据，不替代产品文档中的 AI、状态、资产和项目记忆规则。

## 1. Runtime 边界

Operation 是受控、有限步骤的本地优先工作流，不是无限自主 Agent Loop。

Provider-backed Operation 当前覆盖：

```text
research
imageGeneration
designDefinition
conceptDirection
```

Research Operation 最多执行：

```text
输入快照
→ 本地资料收集
→ 可选的一次 MiMo 原生联网补充（由模型在已启用工具时自行判断）
→ 有限模型综合
→ ResearchAnalysisProposal
→ 用户确认保存
```

模型不能自由无限调用工具、扩展搜索范围或直接修改 Morpho 领域状态。

## 2. 数据分层

`MorphoWorkspace` 只保存轻量、可恢复的结构化信息：

```text
Operation 状态与摘要
输入对象快照
步骤与事件摘要
Artifact Proposal
citation snapshot
IndexedDB artifact 引用
```

不得把以下内容塞进 localStorage：

```text
原始网页正文
大型文件提取全文
页面预览二进制
原始 provider/tool 结果体
API Key、响应 Header 或 provider 私密错误体
```

未来导出可恢复项目时，应同时收集 workspace JSON 与 IndexedDB artifact。

## 3. Operation 状态

Operation 状态至少包括：

```text
queued
preparing
running
waiting_for_user
succeeded
failed
cancelled
interrupted
```

刷新或关闭浏览器后，未完成任务不得假装仍在后台运行。下次恢复时将其标记为 `interrupted`，保留输入、已完成步骤、已取得引用和可重试入口。

当前每个项目最多一个 active Operation。`queued`、`preparing`、`running`、`waiting_for_user` 都会阻止新的研究、图像生成、设计定义草案或概念方向草案任务。再次发起新 Operation 时，需要用户明确取消、等待、应用/放弃当前草案，或以可追溯方式替换当前草案。

## 4. 输入快照与来源复核

Operation 开始时保存输入快照：

```text
用户输入
任务模式
选择对象 ID
对象类型、标题、摘要、可见文本
资产引用与可读取状态
明确授权能力
```

Operation / Proposal 创建时保存每个来源的轻量语义快照：对象 ID、对象类型、可见性和 semantic fingerprint。标题、摘要、画布移动、缩放、实例大小和图片角色不属于 semantic fingerprint。正文、研究 findings/constraints/evidence、关键结论 body/state/supersededById、当前设计定义 revision、方向 current revision/status 等变化会触发结构化复核。

Proposal review details 必须说明哪个来源发生了什么，常见原因包括 `sourceContentChanged`、`sourceInactive`、`sourceUnavailable`、`baseRevisionSuperseded` 和 `targetUnavailable`。`sourceChanged` 草案可读可编辑，但应用前需要用户明确“已复核来源，仍然应用”；`baseSuperseded` 和 `targetUnavailable` 禁止直接应用。

## 5. 工具边界

客户端工具负责读取本地 IndexedDB 资产、压缩可发送图片、保存生成结果和更新本地 workspace。

服务端 Provider 工具负责调用 MiMo / GrsAI，并只读取服务端环境变量。浏览器请求不得携带 API Key、Base URL 或 provider 私密配置。

MiMo web search 不是独立调研产品。当 `MORPHO_MIMO_WEB_SEARCH_ENABLED=true` 且 taskMode 为 `chatAnalysis` 或 `researchOperation` 时，服务端可向 MiMo 提供原生 `web_search` 工具，由模型判断是否需要联网。`imageGeneration` 永不提供 web search。Morpho 仍只保存 provider 返回的 citation snapshot，不保存网页正文或原始工具结果。

## 6. Proposal 与正式对象

模型或 Operation 不能直接写入 `workspace.objects`。

Operation 先产出 Artifact Proposal，例如：

```text
ResearchAnalysisProposal
DesignDefinitionProposal
ConceptDirectionProposal
```

当前实现中，研究、设计定义和概念方向都先生成 Proposal。用户点击应用后，应用层才调用领域函数创建或修订正式对象、修订记录、关系、lineage 和决策记录。

保存 Research Proposal 不会自动生成或改写长期项目记忆、设计定义、方向状态、关键结论或交付引用。应用 DesignDefinition Proposal 时，`createDesignDefinition` 创建独立定义对象并把原当前定义降为非当前，`reviseDesignDefinition` 才复用同一个定义对象并追加 revision。应用 ConceptDirection Proposal 必须按 `applicationMode` 执行 create / revise / split / merge。

## 7. Context 与压缩

Context 组装遵循最小相关原则：

```text
固定系统规则
当前有效项目状态摘要
相关阶段记录摘要
当前任务输入快照
最近有限聊天
当前 Operation 摘要
```

旧聊天不能无限带入模型。达到预算时，可生成当前任务摘要并保留近期原始消息；摘要不得自动改变设计定义、主方向、默认参考、淘汰状态、稳定项目记忆或交付引用。

## 8. 图像生成 Operation

Image Generation 必须保存：

```text
operationId
clientRequestId
providerTaskId（如 provider 返回）
prompt
referenceObjectIds
directionId
visualBranchId（如适用）
model/profile
aspect ratio / size
status
createdAt / updatedAt
```

网络不确定或响应中断时不得自动重新提交生成。优先查询既有 provider task；无法确认时标记 `interrupted`，等待用户明确重试。

所有生成结果仍创建新的 ImageObject 与新的 IndexedDB asset，不覆盖来源图、默认参考或交付引用。从带 `directionId + visualBranchId` 的来源图继续生成时，新图继承方向与分支；多张来源图来自不同方向时，系统不得自动猜目标方向。
