**整体判断：Morpho 的领域基础值得保留，但 Project Truth 还没有形成一致的维护闭环。** 单个模块通常能正确完成操作；真正的问题集中在长期项目必然经历的“切换、修订、撤回、删除、恢复”之后，不同模块对“当前成立什么”给出不同答案。

这些不是单纯的抽象偏好：本轮已复现错误的 Agent 当前状态、失效阶段内容残留、删除导致备份被拒绝、撤销/重做不对称等问题。当前实现还不足以保证长期项目事实持续一致。

审计基线是本地 `main`：`2e801ed1558822e6cf46a0e19f7ff84654e7ae69`，工作区前后均干净。判断基于当前产品规则、架构入口与真实代码，没有沿用历史审计结论。

**目前的职责划分**

| 机制合理职责当前主要判断                                         |                   |                            |
| ---------------------------------------------------- | ----------------- | -------------------------- |
| Objects、revisions、lineage                            | 内容、身份、演进与当前状态     | 基础正确，但 current 的读取和历史绑定不统一 |
| Operation / Proposal                                 | 执行经过、待应用内容及应用条件   | 分离有价值，部分应用边界不完整            |
| DecisionRecord                                       | 用户决定及其依据          | 缺少足够的结构化决定内容，当前性判断依赖文案     |
| Project Continuity                                   | 事件历史、用户明确表达、工作重点  | 同时承担历史与有效语义事实，失效规则不足       |
| Project Memory / Stage Records                       | 当前事实的阅读投影         | 实际仍有事件堆积、内容残留和范围泄漏         |
| derived state / Design Trace                         | 可重建索引、按需追溯        | 索引方向正确，Trace 混淆关系与因果       |
| VisualBranch / default reference / DeliveryReference | 路线组织、生成默认值、稳定交付内容 | 核心区分应保留                    |
| Undo / history                                       | 撤销明确的人工操作、保留项目历史  | 整个 Workspace 快照的恢复边界过宽     |

**真正重要的问题**

1. **“当前设计定义”已经存在两个不一致的读取口径。**

   `workingState` 从 `DesignDefinitionObject.isCurrentEffective` 找项目当前定义；Provider 的 Project State Frame 却遍历全部 revision，取第一个 `isCurrent`。

   `revision.isCurrent` 表示某个定义对象内部的当前 revision，并不表示该定义是全项目当前方案。实测依次应用独立方案 A、B 后：
   - Workspace 当前定义是 B；
   - Design Brief 记忆也是 B；
   - 最新 Project State Frame 却写“当前设计定义：A”。
   同一次 Agent 输入因此包含相互冲突的当前事实。这是明确的 authority 消费错误，应优先修正。证据：[Frame 的选择逻辑 (line 280)]\(D:/Morpho/src/features/workspace/providerContextFrames.ts:280)、[领域当前状态派生 (line 79)]\(D:/Morpho/src/domain/morpho/derivedState.ts:79)。

   应统一当前定义的解析入口，并明确区分“对象内部当前 revision”和“项目当前有效对象”，所有消费者都遵循这一口径。
2. **Stage Records 仍在把部分历史事件当作当前事实；DecisionRecord 的失效也不可靠。**

   实测方向“淘汰 → 恢复为备选”后，DecisionRecord 能把淘汰决定判为 `superseded`，但对应 Continuity Entry 仍是 `current`，当前 Stage Record 同时保留“已淘汰”和“备选”。

   原因是 Continuity 的失效计算没有消费 DecisionRecord 的当前性，也没有普遍比较方向状态；Stage Records 又直接把未标为 `superseded` 的事件文本汇入栏目。证据：[失效计算 (line 1165)]\(D:/Morpho/src/domain/morpho/projectContinuity.ts:1165)、[阶段投影 (line 778)]\(D:/Morpho/src/domain/morpho/projectMemory.ts:778)。

   另一个独立复现是：撤回某阶段最后一条有效语义记录后，新投影为空，代码直接跳过更新，旧阶段 revision 继续作为当前记录存在。[空投影处理 (line 269)]\(D:/Morpho/src/domain/morpho/projectMemory.ts:269)

   DecisionRecord 本身还有两个根本限制：
   - 同一设计定义应用 r1、r2 后，两条应用决定都被判为 `current`，因为记录没有绑定所应用的 revision；
   - 方向状态从 `summary` 文案猜测。标题为 `Primary candidate`、实际设为 `eliminated` 时，分类器会误读标题中的 `Primary`。
   证据：[定义决定分类 (line 58)]\(D:/Morpho/src/domain/morpho/decisionRecords.ts:58)、[文案状态解析 (line 145)]\(D:/Morpho/src/domain/morpho/decisionRecords.ts:145)。

   **当前决定应来自结构化 effect、目标 revision 和明确替代关系；Stage Records 应从这些有效事实投影。** 历史事件保留，但不能承担当前状态判定。
3. **删除没有维护完整的引用合同，会让正常操作后的项目无法生成可恢复备份。**

   `deleteObject` 删除对象、相连 relations 和 canvas instances，但没有统一处理其他实体中的引用。

   已复现：
   - 删除有图片和 VisualBranch 的方向，图片 `directionId`、分支 `directionId` 悬空；
   - 删除有引用和草案的交付包，DeliveryReference、DeliverySectionDraft 的 owner 悬空；
   - 当前 workspace 校验失败，`createEditableProjectBackupManifest` 返回 `blocked`；
   - 方向案例重新 serialize/parse 后，完整性问题仍存在。
   证据：[删除实现 (line 632)]\(D:/Morpho/src/domain/morpho/workspace.ts:632)、[引用校验 (line 153)]\(D:/Morpho/src/domain/morpho/currentWorkspaceValidation.ts:153)、[备份校验入口 (line 318)]\(D:/Morpho/src/domain/morpho/projectArchive.ts:318)。

   这里需要按关系职责定义删除行为：历史来源允许保留缺失身份或快照；交付引用的上游删除应保留快照；owner 删除则必须处理其附属记录；当前成员关系不能悬空。不能用统一“删掉所有关联”解决，也不能全部留给消费者自行容错。
4. **隐藏和语义 scope 的限制，没有贯穿到最终 AI 输入。**

   隐藏当前设计定义后，`workingState` 正确标记 `hidden`，但默认 Memory Context 仍携带完整 Design Brief，且 `reviewRequired=false`。Stage Record 也仍携带定义约束。压缩来源列表时隐藏 object ref 被过滤，正文和 revision ref 却留下。

   证据：[Design Brief 投影 (line 584)]\(D:/Morpho/src/domain/morpho/projectMemory.ts:584)、[定义读取 (line 1062)]\(D:/Morpho/src/domain/morpho/projectMemory.ts:1062)、[来源压缩 (line 476)]\(D:/Morpho/src/domain/morpho/projectMemory.ts:476)。

   同类问题出现在方向范围偏好：Memory 保留了 `scope=direction`，但 ImagePromptCompiler 把全部 `userPreferences.sections` 放入“项目级用户偏好”。实测只针对方向 A 的约束，被编入方向 B 的生成 Prompt。[编译入口 (line 25)]\(D:/Morpho/src/domain/operations/imagePromptCompiler.ts:25)

   **范围和可用性不能只存在于来源元数据里。** 投影条目本身需要保留对应的 scope、来源和有效性，最终消费者必须按任务过滤。现在把条目压成字符串、把来源合并到整份文档，已经损失了执行这些规则需要的信息。
5. **Undo 使用整个 Workspace 快照，既过度阻断，也破坏历史边界。**

   已复现最基本的流程：

   `删除对象 → Undo 恢复成功 → Redo 被阻止`

   Redo 复用“当前多了任何对象就禁止恢复”的检查，把刚由 Undo 恢复的对象误当成需要保护的新内容。[Undo/Redo 检查 (line 58)]\(D:/Morpho/src/features/workspace/workspaceUndo.ts:58)

   恢复时直接 `setWorkspace(entry.workspace)`，因此恢复范围包括决定、记忆、操作和 AI 状态，而不仅是那次人工操作。[快照恢复 (line 720)]\(D:/Morpho/src/features/workspace/WorkspaceClient.tsx:720)

   此外，方向修订浅拷贝 revision map 后直接修改旧 revision 的 `isCurrent`。实测函数返回前，输入 workspace 和之前持有的 revision 引用已被改变，历史快照也无法保持隔离。[修订写入 (line 1751)]\(D:/Morpho/src/domain/operations/operations.ts:1751)

   对长期项目，Undo 值得重新设计为**有明确作用范围的人工操作及其逆操作**。AI 执行记录和项目历史应有独立的保留规则，不能依靠不断扩充 ID 黑名单来保护整个快照。
6. **Design Trace 能展示关联，但目前不能可靠解释历史因果。**

   Trace 将所有指向对象的 relation 当作上游，其中包括 `belongsToDirection`；同时又从图片添加反向的 `directionOwnership`。因此“图片属于方向”形成往返路径，追溯一张旧预览图时会走入同方向的其他图片。

   实测追溯旧 preview，会包含之后的 v2 图片。证据：[无差别遍历关系 (line 109)]\(D:/Morpho/src/domain/morpho/designTrace.ts:109)、[反向 ownership (line 129)]\(D:/Morpho/src/domain/morpho/designTrace.ts:129)。

   时间维度也不完整：进入方向或定义对象后读取其**当前 revision**，即使上游已经记录了特定的 `basedOnDefinitionRevisionId`，后续遍历仍降回对象身份。[revision 追溯 (line 155)]\(D:/Morpho/src/domain/morpho/designTrace.ts:155)

   应区分来源、派生、成员归属、当前参考与交付使用关系。历史解释需要保留明确的 revision 身份；“目前有关联”和“当时基于什么产生”应是不同查询。
7. **DeliveryReference 的稳定快照设计正确，但其草案失效边界没有完成。**

   DeliverySectionDraft 保存了 reference IDs 和 `sourceFingerprints`，应用时却不比较这些指纹。

   实测先生成说明草案，再修改源正文并明确刷新交付引用，最后应用旧草案，仍成功写入基于旧内容的 narrative。证据：[保存指纹 (line 888)]\(D:/Morpho/src/domain/morpho/deliveryPreparation.ts:888)、[应用草案 (line 911)]\(D:/Morpho/src/domain/morpho/deliveryPreparation.ts:911)。

   这说明 Proposal 的“基于什么、何时需要复核”没有形成跨领域统一合同。应保留各类草案的业务差异，但统一要求应用前检查其实际依赖，特别是交付引用版本和目标章节内容。
8. **长期语义记忆有新增和撤回，却缺少明确的替代、解决机制。**

   受控写入能验证用户原话、来源授权和重复项，这是有价值的。但新的约束与旧约束不等价时，通常只是再追加一条。

   域层实测“预算上限 500 元”，之后明确改为“800 元，不再沿用 500 元上限”，两条仍同时进入当前约束。现有合同没有表达“新声明替代哪条旧声明”。[语义写入 (line 393)]\(D:/Morpho/src/domain/morpho/projectContinuity.ts:393)

   这是长期项目能力缺口，不只是文字去重问题。系统不应自行猜测所有冲突，但需要支持有来源的 `supersedes`、撤回和问题解决；不明确时标记冲突待确认。否则维护“当前事实”的责任最终会回到用户手工清理记录。

**应保留的设计**

- **对象、资产、CanvasInstance 分离。** 画布位置没有成为业务事实源，这是正确基础。
- **设计定义修订、方向 create/revise/split/merge、图像生成新对象分别建模。** 它们表达不同设计行为，不宜硬套同一种版本系统。
- **Operation 与 Proposal 分离。** 执行成功、产出草案、用户应用是不同事实；Operation 的存在不等于结果已被采纳。
- **VisualBranch 保持轻量，default reference 保持可选。** 不应升级成另一套阶段、工作流或项目分支系统。
- **DeliveryReference 使用稳定快照、显式刷新。** 这是当前最清楚、最符合真实设计交付需求的边界之一。
- **原始聊天、会话摘要、项目事实分别保存。** 没有必要让聊天摘要或 Server Journal 接管领域事实 authority。
- **来源授权、确定性投影、可重建 workingState。** 方向正确，应收敛消费规则，而非替换为更多 AI 总结。

**值得重新设计的核心**

我建议保留现有产品模型，集中调整三处职责：

| 调整目标                |                                                                |
| ------------------- | -------------------------------------------------------------- |
| 统一领域读取与变更边界         | 每种事实有唯一 authority；一次变更同时维护必要引用、决定和失效信息                         |
| 分清事件历史与有效语义声明       | Events 回答“发生过什么”；声明和对象状态回答“现在成立什么”；Memory / Stage Records 只做投影 |
| 分离人工 Undo、历史追溯与执行恢复 | 三者使用不同恢复规则，避免整个 Workspace 回滚                                   |

七类 Memory 和六类 Stage Records 可以继续作为产品阅读分类，但不需要各自拥有一套独立的当前性判定。`relations` 与类型字段中重复表达的归属关系，也应明确哪一处权威、哪一处只是投影。

**优先顺序应是：修正当前定义读取、删除完整性和投影失效；随后收敛 scope、草案依赖和 Undo；最后完善 revision 级历史追溯。** 当前证据不支持整体重写，也不需要引入通用事件溯源平台；需要的是减少对同一事实的多种解释。

验证方面，执行了 Git 基线检查、两组定向 `npm.cmd test -- …`，共 **57 个测试文件、546 个测试全部通过**；另用真实导出函数进行了 **14 个内存场景复现**。现有测试通过与上述问题并不矛盾，它们主要遗漏了跨模块状态转换。

本轮未修改任何代码或文档，未提交。未运行浏览器和真实 Provider；已确认的是状态、投影、Prompt 输入及备份合同的问题，没有把它们表述成已观察到的线上模型输出事故。