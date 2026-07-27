# Morpho 资产 GC 评估

状态：**只完成设计评估，不实现清理代码。** 本文记录当前能力、阻塞条件和未来实现边界；它不是后台任务方案，也不授权自动删除任何 Blob。

## 结论

Morpho 目前只有一条可执行的 Blob 回收路径：用户删除整个项目时，先预览并确认，再删除没有被其他本地项目引用的独占 `storageKey`。对象级删除、工作区内孤儿元数据清理，以及 IndexedDB 中无元数据 Blob 的清扫都未实现。

孤儿 Blob 清扫当前被一个硬条件阻塞：`BlobStore` 只有 `put`、`get`、`delete`，`indexedDbBlobStore` 也没有 `keys()`、`getAllKeys()` 或 `openCursor()` 枚举能力。因此现在只能比较“工作区引用 vs `workspace.assets` 元数据”，不能比较“IndexedDB Blob vs 所有工作区元数据”。没有 Blob 全集，就不能证明某个二进制是孤儿。

## 现有能力

### 资产引用审计

`collectWorkspaceAssetInventory(...)` 已经：

- 枚举 `workspace.assets` 元数据；
- 复用 `collectWorkspaceAssetReferences(...)` 和 `collectObjectAssetReferences(...)` 收集项目封面、image/file/link、文档提取物及 delivery snapshot 的已知 Asset 引用；
- 对“元数据存在但没有已审计引用”产生 `asset_metadata_orphaned`；
- 对“引用存在但元数据缺失”产生 `missing_asset_metadata`；
- 有 `projectArchive.test.ts` 覆盖清单和诊断。

未来清理实现应把这套 walker 作为唯一引用真相来源，不再维护第二份字段清单。但它还不能直接成为删除依据：

1. `collectWorkspaceAssetReferences(...)` 与 `collectObjectAssetReferences(...)` 目前不是导出 API；
2. `AiMessage.providerInputSnapshot.attachmentRefs[].assetId` 未被 walker 覆盖。该字段保存不可变 Provider 输入附件引用，即使画布对象已变化，也必须先被纳入引用集合；
3. 当前 inventory 只读一个 workspace，无法证明同一 `storageKey` 未被其他本地项目使用。

### 项目删除时的独占回收

`planLocalProjectDeletion(...)` 已实现保守的项目级所有权判断：

- 扫描所有 `morpho.project.*.workspace.v1`，不只扫描 catalog 中的项目；
- 只把其他可读 workspace 都未引用的 key 标为 `exclusiveStorageKeys`；
- 任一相邻 workspace 无法解析时，全部 key 都按不可证明独占处理；
- 删除确认界面预览独占、共享和不可读项目数量；
- `deleteLocalProjectRecords(...)` 先移除项目记录，随后才 best-effort 删除独占 Blob。失败只留下可后续回收的二进制，不留下引用仍在但文件已被删的项目。

这是一条显式、带预览、fail-closed 的项目删除回收路径，不等于通用资产 GC。

## 未来实现的前置条件

以下条件全部满足前，不应提供“清理孤儿资产”按钮：

1. 为 `BlobStore` 增加只读 key 枚举原语，并在 IndexedDB 实现中覆盖成功、事务失败、数据库被占用和空库场景。
2. 导出并补全统一 Asset walker，至少纳入 Provider Input Snapshot attachment；用测试锁定每个 AssetId 持有字段。
3. 提供跨全部本地 workspace 的只读扫描。任何 workspace 不可读时停止删除，只显示“无法证明安全”。
4. 使用元数据中的 `storageKey` 建立映射；不得从 `assetId` 猜测 `blob:${assetId}`，恢复项目和内置案例可使用不同运行时 key。
5. 在确认阶段重新扫描并重新计算计划，避免预览后另一个标签页或项目新增引用造成 TOCTOU 删除。

## 显式清理流程

未来任务应分成两个独立动作，不与 Agent 回合或画布重构混在同一提交：

### 1. 只读预览

扫描全部可读 workspace、全部 Asset 元数据和全部 IndexedDB key，至少分类显示：

- `referencedHealthy`：引用、元数据和 Blob 都存在；
- `referencedMissingMetadata`：引用存在，元数据缺失；
- `referencedMissingBlob`：引用和元数据存在，Blob 缺失；
- `metadataOrphaned`：元数据没有任何审计引用；
- `binaryOrphaned`：Blob key 不属于任何 workspace 的 Asset 元数据；
- `shared`：同一 `storageKey` 被多个 workspace 使用；
- `unknown`：存在不可读 workspace、无法证明归属或 key 形状未知。

预览应显示候选 key、来源项目、元数据大小（可得时）和删除原因。`unknown`、`shared`、任何仍被引用的条目永远不能进入可删除集合。

### 2. 用户确认后的执行

- 清理只能由用户显式发起，不能在启动、保存、对象删除或后台空闲时自动运行；
- 确认时重新生成计划，不复用旧快照；
- 先持久化元数据移除，再 best-effort 删除已证明独占的 Blob，使失败模式最多留下可再次清理的 Blob；
- 每个 key 独立报告成功/失败，部分失败不伪装成全部成功；
- 不允许 Agent 工具直接确认或触发删除；
- 执行后再次只读扫描，并把仍存在的失败项保留在结果中。

## 验收要求

未来实现至少需要覆盖：

- Provider Input Snapshot 是唯一引用时不删除；
- 两项目共享同一 `storageKey` 时不删除；
- 任一 workspace 不可读时删除集合为空；
- 预览后新增引用时，确认阶段重算并保留 Blob；
- 元数据写入失败时不删 Blob；Blob 删除部分失败时项目仍可打开；
- 无元数据 Blob 只有在枚举原语返回、且全局扫描证明无引用后才可删除；
- 清理从不由保存、对象删除、页面加载或 Agent 回合隐式触发。

## 非目标

- 不做自动后台 GC；
- 不把“隐藏”“删除对象”“淘汰方向”合并成同一资产语义；
- 不因上游对象删除而修改稳定 delivery snapshot；
- 不在本评估中导出 walker、扩展 BlobStore、添加按钮或删除任何本地数据。
