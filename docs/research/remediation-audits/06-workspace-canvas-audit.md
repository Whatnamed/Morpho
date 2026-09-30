**整体判断：Morpho 的核心交互模型成立，但当前实现还没有形成足够可靠、可预测的日常操作规则。**

连续画布、连续 AI 会话、明确的项目事实、稳定交付引用，这些基础方向是合理的。主要问题集中在几种状态相互转换时：**查看对象会影响选择，隐藏可能变成放弃，摘录可能变成确认结论，旧的任务目标可能覆盖当前输入，Undo 也不总是撤销最近一次人工操作。**这些已经超出视觉细节，会直接影响用户对工作台的信任。

本次基于 `2e801ed`、当前产品规则和真实实现审计；运行了两组定向 Vitest，共 **28 个测试文件、341 项测试通过**，并进行了领域函数、React controller 和组件 DOM 的离线复现。没有修改仓库文件。未做真实浏览器手势验收或真实 AI Provider 调用，下面会区分复现结果与源码判断。

**整体模型与流程**

当前几个概念大体有独立职责，但衔接不完整：

|概念|当前定位|审计判断|
|---|---|---|
|Canvas position / viewport|放置内容、决定正在看哪里|普通对象移动不改变项目语义，正确|
|Selection|人工操作对象、本轮 AI 显式输入|正常路径清楚；阅读、定位和生成完成时存在同步问题|
|Detail / Reader|阅读内容与追溯依据|独立工作表面有必要，但打开、关闭和返回规则不一致|
|当前任务目标|决定本轮 AI 如何处理输入|某些目标隐式保留，用户无法从输入框判断实际作用域|
|Project Truth|当前定义、方向、默认参考、已确认决定|数据层区分较成熟；部分入口给出的确认语义不准确|
|Agent Context|当前输入、项目依据、连续会话、按需资料|不应等同于 selection；目前缺少适度的用户可见解释|

沿典型工作流走下来：

1. **导入资料：基本连贯。**文件、图片、URL、文本共用画布入口；但资料进入后，手工编辑和组织能力不足。
2. **Document Reader：来源链路合理。**解析文本、提取片段、原文定位有明确边界；阅读选择与画布选择的交接有问题。
3. **研究 → 结论：最明显的语义断点。**界面称为“代选”“摘录”，实际可能写入已确认关键结论。
4. **定义 → 方向：核心规则合理。**候选、应用、修订、主方向与淘汰有独立语义，不依赖位置。
5. **方向 → 图像：数据连续，注意力交接不足。**生成新对象、保留来源和旧图是正确的；结果到达时会主动改变选择和视野。
6. **Compare：定位合理。**是连续对话内的局部比较与决定，不需要独立阶段。
7. **Delivery：引用模型可靠，工作表面衔接较弱。**稳定快照、显式更新和章节组织成立；隐藏任务目标、撤销和画布入口尚未闭环。

因此，它已经不只是功能面板拼接；但完整流程中仍存在几处用户必须“知道系统内部怎么工作”才能避免出错的地方。

**已确认问题**

**1. Undo / Redo 缺少统一的人工操作时间顺序。〔Correctness + interaction architecture，高优先级〕**

离线复现得到：

- 删除普通文本 → Undo：成功；随后 Redo：被阻止。
- 手动创建关键结论前保存撤销快照 → 创建后 Undo：被阻止。
- 原因是保护逻辑把“当前存在、快照不存在的记录”都当作不能撤销的新内容，没有区分人工创建、撤销恢复和 AI 结果。[快照保护逻辑 (line 58)](D:/Morpho/src/features/workspace/workspaceUndo.ts:58)

同时，详情导航具有比对象操作更高的 Undo 优先级。因此“定位来源 → 手动隐藏对象 → Ctrl+Z”会先返回先前视野，而不是先撤销隐藏。这也是现有测试明确接受的行为。[撤销优先级 (line 103)](D:/Morpho/src/features/workspace/useWorkspaceObjectHistoryController.ts:103)

恢复隐藏对象、研究摘录调整、交付章节与引用编辑，又没有接入同一人工历史入口。[恢复操作 (line 1520)](D:/Morpho/src/features/workspace/WorkspaceClient.tsx:1520)、[交付操作 (line 320)](D:/Morpho/src/features/workspace/useDeliveryPreparationController.ts:320)

**应调整的是操作契约：**导航返回独立于 Undo；人工操作按时间顺序撤销；AI 结果保留，但不应成为此前所有人工操作都无法撤销的屏障。这里需要修正历史模型，单改提示文案不够。

**2. 某些浮层中的键盘操作会穿透到画布。〔Correctness，高优先级〕**

快捷键保护识别 `.research-detail-panel`、`.delivery-preparation-panel`、`.project-bundle-panel`，实际组件使用的却是 `.research-panel`、`.delivery-panel`、`.archive-panel`。[保护名单 (line 8)](D:/Morpho/src/features/workspace/workspaceShortcuts.ts:8)

使用真实研究组件 DOM 离线验证：焦点位于研究条目按钮时，`Delete` 被解析为 `deleteSelection`。交付、归档及文本提示表面的非输入控件也存在同类问题。结合全局处理器，它会操作背景中的画布选区。[全局删除处理 (line 1856)](D:/Morpho/src/features/workspace/WorkspaceClient.tsx:1856)

关闭规则也不完全对应表面层级：交付准备优先于交付输出关闭，但输出的显示层级更高；淘汰理由等文本提示没有进入统一关闭优先级。[关闭优先级 (line 31)](D:/Morpho/src/features/workspace/workspaceSurfacePriority.ts:31)

需要统一**哪个表面当前拥有键盘、Escape 关闭谁、关闭后焦点回哪里**，不需要因此合并这些表面。

**3. 交付章节目标会成为不可见的输入模式。〔Correctness，高优先级〕**

场景：

> 点击“生成本节说明草稿” → 尚未发送 → 关闭交付准备 → 改写输入并选择其他对象 → 发送。

离线验证，关闭后 `pendingDraftTarget` 仍保留。发送准备随后强制使用交付意图，并把当前 `selectedObjectIds` 替换为空，跳过普通图片和文档输入收集。[目标生命周期 (line 412)](D:/Morpho/src/features/workspace/useDeliveryPreparationController.ts:412)、[发送准备 (line 198)](D:/Morpho/src/features/workspace/agentTurnProductPreparationAPlus.ts:198)

这直接造成“输入框显示我选了这些对象，实际请求却按之前的章节处理”的认知冲突。

**应让章节目标成为输入框中可见、可移除的目标；改写任务或切换用途后，应明确解除或重新确认绑定。**无需暴露内部 Context 或增加阶段切换器。

**4. “AI 代选 / 更新画布摘录”实际承担了关键结论确认。〔Interaction architecture，兼有 correctness 风险〕**

“AI 代选”使用确定性顺序选取最多六项，然后直接执行提取；不是先给用户一个待审阅的推荐集合。[推荐与应用逻辑 (line 95)](D:/Morpho/src/features/workspace/researchExtraction.ts:95)

离线场景中，用户先保留第八条发现，再点击代选，结果是：

- 创建六个 `keyConclusion`；
- 对象被记录为 `createdBy: user`，具有 `confirmedAt`，发现类条目为 `active`；
- 此前手选的第八条被隐藏。

这是因为应用逻辑把未包含在新集合中的已有结论隐藏，而创建逻辑写入用户保留决定。[创建确认事实 (line 1305)](D:/Morpho/src/domain/morpho/workspace.ts:1305)、[代选入口 (line 1704)](D:/Morpho/src/features/workspace/WorkspaceClient.tsx:1704)

问题不在于人工点击必须再弹一次确认，而在于**“摘录展示”“推荐选择”“保留为项目依据”目前使用了同一操作，却没有向用户说明这种语义升级**。

应该明确分开推荐集合与用户保留；代选不应顺带撤销既有手选范围。

**5. Proposal 的“隐藏”实际是“放弃”。〔Correctness，高优先级〕**

草案工具栏同时提供“放弃草案”和通用“隐藏对象”。点击隐藏时，代码会调用拒绝草案流程，删除草案画布对象并把 Proposal 标记为 `rejected`。[入口 (line 1487)](D:/Morpho/src/features/workspace/WorkspaceClient.tsx:1487)、[拒绝结果 (line 2195)](D:/Morpho/src/domain/operations/operations.ts:2195)

离线验证：对象不会出现在“已隐藏内容”，无法通过正常隐藏恢复入口回来。混合多选隐藏也会触发这一行为。

这违反了工作台已有的统一心理模型。**要么真正支持草案隐藏，要么去掉该入口并明确使用“放弃”；不能让相同的“隐藏”按对象类型产生不同的决定。**

**6. Focus、selection 和阅读表面在一些路径中失去同步。〔Correctness + interaction architecture〕**

三处具体断点：

- 打开 Document Reader 只清空 React 中的 selected IDs，没有发送清空画布选区请求。离线 controller 复现确认 selection request 的 nonce 不变；编辑器选择态与输入 Context 的同步链因此断开。[打开 Reader (line 1781)](D:/Morpho/src/features/workspace/WorkspaceClient.tsx:1781)
- 批量研究提取、图像生成完成后，先设置多选，再 focus 某一个对象；Canvas 的 focus 实现直接执行单对象 `editor.select`，最终会收窄选区。[生成完成 (line 730)](D:/Morpho/src/features/workspace/workspaceVisualGenerationExecution.ts:730)、[Canvas focus (line 1006)](D:/Morpho/src/features/workspace/tldraw/MorphoCanvas.tsx:1006)
- 隐藏搜索结果仍显示“定位”，但隐藏对象没有可定位的 Canvas shape。这里应提供规则要求的“恢复并定位”，或明确说明当前不能定位。[搜索结果 (line 799)](D:/Morpho/src/features/workspace/components/OverlayDrawers.tsx:799)

更深层的问题是，异步结果完成时只检查项目会话有效性，没有判断用户是否已经转去阅读、选择或准备别的任务。自动定位结果本身可以保留，但应有明确的注意力交接规则。

**7. Stage Region 兼任地标和隐式大组，空间行为不够直观。〔Interaction architecture〕**

正确的一面是：拖动对象不会改变类型、方向或阶段语义。

但 Stage Region 按对象类型保留成员名单；对象被拖远后仍是成员，移动 Region 会继续移动它。离线复现中，已移到 `(10000, 10000)` 的对象仍随原区域移动。[成员规则 (line 223)](D:/Morpho/src/domain/morpho/stageRegions.ts:223)、[区域移动 (line 140)](D:/Morpho/src/features/workspace/tldraw/StageRegionShapeUtil.tsx:140)

用户看到的区域边框，并不能说明这次移动会影响哪些对象。这不是“位置决定语义”的违规，而是**语义归属反过来控制空间操作，影响范围却不可见**。

值得重新明确：Region 默认只是地标，还是可整体移动的集合。如果保留后者，必须让成员范围可理解，并区分“移动区域”和“连同成员移动”。

**8. 画布的基础手工整理能力尚不足以支撑长期使用。〔功能完整性 / interaction architecture〕**

当前可达实现中：

- 普通文本可以导入，但 Canvas shape 禁止直接编辑，也没有对应文本编辑入口；
- 合集存在 `expanded` 字段，但渲染与操作没有形成折叠、展开、移出成员的完整行为；
- 普通对象缺少持久化的锁定、组合和复制实例路径；现有锁定主要服务 Stage Region；
- 交付主要通过面板中的“加入当前选中对象”创建引用，规则描述的拖入交付区域创建稳定引用没有接通。

依据包括 [Canvas 对象行为 (line 104)](D:/Morpho/src/features/workspace/tldraw/MorphoShapeUtil.tsx:104)、[CanvasInstance 模型 (line 557)](D:/Morpho/src/domain/morpho/types.ts:557)、[合集创建 (line 121)](D:/Morpho/src/domain/morpho/imports.ts:121)。

这些不是要求做成 Figma。它们关系到用户能否在图像和资料增多以后，自主整理、修改笔记和降低画布密度。**底层画布引擎拥有某个快捷键，也不能替代 Morpho 的持久化行为合同。**

**9. 追溯数据较完整，但默认关系展示与按需阅读没有完全对齐。〔Interaction architecture〕**

当前 Canvas 持续绘制筛选后的主关系线，无选择时也存在；选中和 Design Trace 主要改变强调程度。[常驻关系绘制 (line 1155)](D:/Morpho/src/features/workspace/tldraw/MorphoCanvas.tsx:1155)

这与现行产品规则“关系默认隐藏、按需显示直接关系”存在明确差异。底部详情页签也没有驱动画布分别切换来源、版本、关联关系范围。

另外，定义和方向的版本页目前主要列出修订标题与当前/历史标签，没有在这个入口提供完整历史修订内容阅读。[修订展示 (line 1047)](D:/Morpho/src/features/workspace/components/BottomDetailBar.tsx:1047)

**应保留追溯能力，改善按需展开和历史内容阅读。**是否保留少量常驻主线，需要真实工作场景比较；本次没有浏览器视觉证据，不能直接断言当前线条密度已经不可接受。

**应该保留的设计**

以下设计不应为了“统一”被推倒：

- **导航、选择和项目语义分离。**点项目地图只移动视野，不切换聊天或机械改变工作重点。
- **一个连续 AI 会话。**Compare、研究、视觉发展与交付共享项目连续性，不需要拆成阶段聊天。
- **建议只填入可编辑文字。**当前建议点击路径确实只更新草稿，没有自动发送或写入项目事实。[建议入口 (line 1123)](D:/Morpho/src/features/workspace/WorkspaceClient.tsx:1123)
- **人工明确操作与 AI 提议允许不同确认成本。**用户直接“设为主方向”和 AI 提出改变方向，不必机械使用同样的两次点击；关键是目标、影响和可撤销性清楚。
- **生成新图、保留旧图与来源。**不把图像继续发展实现为覆盖原图或项目整体回滚。
- **稳定交付引用。**上游变化不静默替换已整理材料，更新引用需要明确操作；这是概念迭代与交付能够共存的重要基础。
- **Reader、Research、Delivery 保持各自专门的工作表面。**不同任务有不同阅读和编辑密度，组件多不构成合并理由。
- **异步恢复与项目隔离。**已有 session guard、过期回调保护、来源复核，以及“再次检查同一外部任务”的恢复表达。保存失败与只读项目也有明确反馈。应补齐交互交接，不应重做成任务管理中心。

重开项目的连续性则是**部分成立**：画布视野与选择有恢复路径，但主要浮层和 AI 展开状态仍以局部默认值初始化，聊天首次打开滚到底部；“回到上次工作位置”尚不包含完整的阅读位置。[状态初始化 (line 354)](D:/Morpho/src/features/workspace/WorkspaceClient.tsx:354)、[聊天初始化 (line 256)](D:/Morpho/src/features/workspace/components/AiConversationPanel.tsx:256)

**优化与验证的边界**

- **应先修 correctness：**键盘穿透、隐藏等于放弃、交付目标残留、删除重做失败，以及选择状态同步。
- **值得调整 interaction architecture：**人工历史与导航历史、研究内容升级为项目依据的入口、Stage Region 的移动范围、异步结果的注意力交接、基础整理与追溯阅读。
- **属于 UI polish：**内部 ID、`lineage`、原始状态值等文案，动作命名和禁用原因；这些不能代替前面的语义修正。
- **需要真实用户测试：**大项目下常驻主线是否帮助理解；底部详情是否打断阅读；多选超过三项只显示 `+N` 是否足够；Research 的集中选择表面是否比画布内保留更顺手；生成完成后自动定位在什么条件下更合适。

更合适的收敛目标是：**用户能够稳定判断自己在看什么、选了什么、这次提交绑定什么，以及哪个动作会改变项目事实。**无需重新设计 Morpho 的整体工作台方向，但这几条规则必须在所有入口、浮层和异步流程中一致执行。