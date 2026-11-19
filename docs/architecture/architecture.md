# v3.2 Web 工作台架构

当前应用是 Next.js App Router、React、TypeScript 和 tldraw。设计项目和二进制资产由浏览器保存。Next 服务端处理认证、模型凭证和外部执行。以下路径相对于仓库根目录。

## 项目、资产与画布

| 操作 | 源码入口与所有权 |
| --- | --- |
| 打开首页或项目 | `src/features/projects/ProjectHomeClient.tsx` 与 `src/features/workspace/workspaceInitialization.ts` 调用 `src/infrastructure/persistence/projectCatalogInitialization.ts`。目录是索引。初始化只解析尚未列入目录的项目正文，用其 ID 和摘要修复目录。 |
| 安装案例与读取旧项目 | 空白浏览器按需加载案例模板。现有项目保持自己的身份。早期单项目存储和旧版 JSON 在读取时转换；已登记的项目按需打开。解析、schema 迁移和序列化统一在 `src/domain/morpho/workspaceCodec.ts`。 |
| 保存与删除 | `usePersistentWorkspace.ts` 协调工作台保存和显式 flush。`localProjectStore.ts` 分别写入 localStorage 中的正文和目录。项目写入与目录更新依靠 Web Locks 协调；支持该 API 时，同一项目的第二个编辑标签页只读。删除及文件归属核对见 `projectLifecycle.ts`。 |
| 资料导入与读取 | `workspaceImportExecution.ts` 将原始 Blob 写入 IndexedDB；`documentParsing.ts` 提取有界文本并记录截断。IndexedDB 写入等待事务完成。文件、提取文本、片段和来源分别持有身份。 |
| 编辑画布 | `WorkspaceClient.tsx` 和 `tldraw/MorphoCanvas.tsx` 位于 `src/features/workspace/`。编辑器投影形状、相机和选区，领域命令在 `src/domain/morpho/` 与 `src/domain/operations/` 更新对象、修订和关系。手工撤销由 `workspaceManualHistory.ts` 记录该操作拥有的变化。 |
| 导出与恢复 | `src/features/archive/projectBundleClient.ts` 组织人读归档和可编辑备份。恢复先校验 manifest 与文件，再写入独立项目；交付输出按已选 DeliveryReference 组织，见 `src/features/delivery-output/`。 |

## 一轮 Agent 如何执行

1. `useWorkspaceAgentRuntimeController.ts` 通过 `agentTurnRunner.ts` 启动 A+。准备器根据选区、资料与本轮授权构造 Task Contract、上下文和请求。当前消息历史属于项目。
2. `agentTurnCoordinatorHttpHost.ts` 调用 `/api/ai/agent/turns` 和该 turn 的 `requests`。服务端在 `src/server/ai/agentTurnProviderRequest.ts` 组装实际 Responses 输入；共享工具定义在 `src/shared/agentToolContract.ts` 和 `agentReadTools.ts`。
3. 本地工具由 `agentToolBatchAPlus.ts` 和 `agentToolExecutors.ts` 对最新 Workspace 执行。读操作返回实际资料及范围，写操作经过领域命令；需要确认的提案交给工作台。
4. 已授权的联网、生图和压缩经 turn 的 `actions` 路由执行。工作台独立生图仍使用 `/api/ai/image`。Supabase 管理账号资格、额度、turn 步序与外部动作授权。
5. `externalEffectJournal.ts` 记录 Provider 是否已提交或观察到结果；`externalResultStore.ts` 暂存可按原身份取回的结果。客户端从 `/api/ai/effects/[effectId]/result` 取得结果，在本地持久化后 ACK。取消等待和外部执行状态分别记录。

Agent Lab 通过相同的准备器、执行器与序列化代码运行本地 fixture。运行方式及记录字段见[运行手册](../operations/runbook.md)。

## 变更入口

新建或修改对象的代码使用现行领域类型和命令。历史 JSON 字段在 codec 和备份导入边界处理。项目状态、对象身份与可编辑备份合同由领域测试验证，跨标签页、导入恢复和本地落盘行为由 Chromium 验证。

后续桌面实现的边界见[下一阶段方向](../product/next-generation-direction.md)。
