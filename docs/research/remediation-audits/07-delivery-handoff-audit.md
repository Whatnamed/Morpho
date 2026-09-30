**Morpho 已有合理的 Delivery Preparation 基础，但尚未形成可靠闭环的 design handoff / delivery readiness 模型。** Section、稳定引用、人工应用草稿、独立素材预检和三类输出都已实现；主要断点在于：**AI 是否取得真实依据、草稿是否仍适用、文案是否需要复核，以及这些状态能否被接收者看见。**

因此，当前体系适合作者持续整理交付材料，但还不足以让陌生接手者仅凭输出包，可靠判断“这些内容为什么被选中、是否仍然成立、哪些尚未确认”。

审计基于当前 HEAD `2e801ed`，覆盖产品规则、领域操作、A+ Agent 请求与工具链、Preparation/Output UI、Archive/Backup 和验证逻辑。**13 个测试文件、130 项测试全部通过，另完成 20 个受控离线场景检查。仓库代码和文档均未修改，Git 状态保持干净。** [复现说明与命令](C:/Users/hasee/AppData/Local/Temp/morpho-delivery-audit-20260921/README.md) · [离线证据](C:/Users/hasee/AppData/Local/Temp/morpho-delivery-audit-20260921/verified-evidence.json)

**已确认的 correctness 问题中，以下三项应优先处理。**

1. **[P1] A+ Delivery Draft 没有获得承诺的章节快照输入。**
    
    当前流程构建了 `deliverySectionContext`，但只把它交给本地工具执行与校验，没有放进 `providerRequest`；`read_selected_context` 也不返回它。
    
    离线向快照正文放入唯一标记后确认：本地 Context 有标记和 reference ID，Provider 请求与读取工具结果均没有。模型实际能看到聊天、项目状态和交付计划的部分摘要，却无法可靠取得该章节的完整冻结依据和图注目标 ID。
    
    这不是已经证实模型产生了幻觉，而是**生成链缺少必要 grounding**；现有测试预先提供合法工具参数，未验证模型是否有能力从真实输入得到这些参数。[请求准备 (line 465)](D:/Morpho/src/features/workspace/agentTurnProductPreparationAPlus.ts:465) · [读取工具结果 (line 4)](D:/Morpho/src/features/workspace/agentReadContextResult.ts:4)
    
2. **[P1] Draft 保存了依赖字段，却没有有效的失效检查。**
    
    `sourceFingerprints` 被保存，但应用时不比较；也不检查章节目的、已有 narrative、引用集合/顺序、caption/note 或 gaps 是否发生变化。
    
    已复现：创建 Draft → 手改 narrative → 修改并刷新来源 → 应用旧 Draft，操作仍成功，旧 narrative/caption 覆盖新内容。没有 caption 的 Draft，甚至可以在原引用移除后继续应用。
    
    另外，工具提交时从**当时最新 workspace**采集依赖，而非保存生成输入的依赖版本，存在把旧生成结果绑定到新状态的问题。[创建依赖 (line 881)](D:/Morpho/src/domain/morpho/deliveryPreparation.ts:881) · [应用校验 (line 911)](D:/Morpho/src/domain/morpho/deliveryPreparation.ts:911) · [工具提交 (line 708)](D:/Morpho/src/features/workspace/agentToolExecutors.ts:708)
    
3. **[P1] 正常删除操作可能使项目无法创建 Editable Backup。**
    
    已验证操作前、创建 Draft 后均可生成有效备份；随后：
    
    - 移除 Draft 引用过的 Reference；
    - 删除它原来的 Section；
    - 删除带引用的 Delivery Object；
    
    都可能留下悬空关系，使备份被 `invalid_workspace_snapshot` 拒绝。**已应用的历史 Draft 也受影响**，不只是 pending Draft。
    
    根因是删除操作与校验器对“当前依赖”和“历史记录”的语义不一致。不能通过放松全部备份校验解决，应明确哪些关系必须仍存在、哪些应作为历史快照保留。[移除引用 (line 483)](D:/Morpho/src/domain/morpho/deliveryPreparation.ts:483) · [删除对象 (line 632)](D:/Morpho/src/domain/morpho/workspace.ts:632) · [Draft 校验 (line 402)](D:/Morpho/src/domain/morpho/currentWorkspaceValidation.ts:402)
    

其余已确认问题如下，均属于确定性工程问题：

|优先级|问题与实际影响|证据|
|---|---|---|
|P2|**Output 丢失 freshness。** Preparation 已显示 `sourceUpdated` 或 `sourceHidden`，Output 仍可返回 `ready`、零诊断；manifest/source map 未携带相应状态。冻结旧内容正确，丢失复核提示不正确。|[Output 构造 (line 228)](D:/Morpho/src/domain/morpho/deliveryOutput.ts:228)|
|P2|**Pending Delivery target 未与当前输入意图充分绑定。** 用户改成普通讨论、甚至明确取消交付草稿，残留 target 仍强制 `prepareDeliverySection`。关闭面板也不会清除 target。复现确认的是错误路由，不代表模型一定执行写入。|[模式覆盖 (line 198)](D:/Morpho/src/features/workspace/agentTurnProductPreparationAPlus.ts:198) · [关闭面板 (line 265)](D:/Morpho/src/features/workspace/useDeliveryPreparationController.ts:265)|
|P2|**Archive 会错误关联淘汰理由。** 先设为主方向、再淘汰，归档概览使用第一个相关 DecisionRecord，把此前“选为主方向”的理由写成淘汰原因。已用真实领域操作复现。|[理由选择 (line 793)](D:/Morpho/src/domain/morpho/projectBundles.ts:793)|
|P2|**Source freshness 存在漏判。** Research 改标题仍为 `current`；直接隐藏 DocumentFragment、源文件仍正常时，也仍为 `current`。|[状态解析 (line 615)](D:/Morpho/src/domain/morpho/deliveryPreparation.ts:615) · [指纹 (line 1181)](D:/Morpho/src/domain/morpho/deliveryPreparation.ts:1181)|
|P2|**缺资产元数据时，预检计数可能显示零缺失。** manifest 有 warning、Reference 为 `missingBinary`，但汇总只数 assets entries，因此 UI 的“缺失或大小异常素材”可以为 0。|[资产汇总 (line 250)](D:/Morpho/src/features/delivery-output/deliveryOutputClient.ts:250)|
|P2|**重复 Gap 标签可能生成重复 ID。** 已有 `gap-Repeat`，应用两个同名建议，产生两个 `gap-Repeat-2`，并导致备份校验失败。|[Gap ID 分配 (line 945)](D:/Morpho/src/domain/morpho/deliveryPreparation.ts:945)|
|P2|**引用排序存在双重事实源。** 移动时只更新被移动 Reference 的 `order`；重复移动后，UI 按 `order` 排出的顺序与 Section.referenceIds、导出章节顺序不一致。|[移动操作 (line 534)](D:/Morpho/src/domain/morpho/deliveryPreparation.ts:534) · [UI 排序 (line 96)](D:/Morpho/src/features/workspace/deliveryPreparationUi.ts:96)|

**更重要的模型缺口，是“稳定”“最新”“确认”“可交付”尚未被充分分开。**

当前 `current` 只意味着来源指纹匹配，`applied` 只意味着用户应用过草稿，Output 的 `ready` 主要代表结构和资产诊断。这三者都不能证明内容已经核实或足以交付。

一个受控例子尤其明显：来源结论为 `needsVerification / partial`，刷新引用后，Delivery snapshot 与 AI Context 不携带这些字段，却显示 `sourceState: current`。Research 又把 findings、opportunities、constraints、openQuestions 合并成无分类正文。**信息没有被直接改成“已确认”，但用于区分确定程度的证据已经丢失。** [快照构造 (line 1114)](D:/Morpho/src/domain/morpho/deliveryPreparation.ts:1114)

上游进入 Delivery 的范围也体现了这种取舍：

|上游内容|当前实际带入|对 handoff 的限制|
|---|---|---|
|Design Definition|revision、标题、摘要、核心问题和原则摘录|不是完整定义与约束|
|Direction|revision、摘要、concept statement|选择依据、风险、开放问题未完整带入|
|Images|标题、摘要、asset 引用|不代表视觉核验；部分 review 状态未传递|
|Research|合并后的文字摘录|候选发现与待验证问题分类丢失|
|Key Conclusions|标题、摘要、正文|state、confidence、证据关联未进入快照|

轻量快照本身是合理设计，但应保留**决定如何解读内容的最小语义**，不能只保留可用于写文案的正文。

**稳定引用应继续保留，同时补上独立的复核层。**

建议按下面的边界解释变化：

|变化|应保持冻结|应提示的事项|
|---|---|---|
|来源正文、图像资产或 revision 更新|已选 snapshot、素材身份、现有文案|来源有变化，是否沿用旧版由用户决定|
|来源隐藏|已选内容|可追溯性变化；隐藏本身不等于内容失效|
|来源删除|可独立阅读的快照、仍可用的资产|来源不可定位；资产缺失另行报告|
|用户显式 refresh|caption/note/narrative 不自动改写|新快照可能不再支持旧文案，需要复核|
|默认参考或主方向变化|已选图片与引用|相关设计依据变化，不自动替换选图|
|Draft 依赖变化|Draft 保留可读、可放弃|标明过时，阻止无提示覆盖|

目前显式 refresh 后，旧 caption/narrative 被保留，这是对的；但刷新同时清掉 source freshness 提示，**系统没有留下“文案仍基于旧快照”的提示**。离线结果是新 snapshot、旧文案、`current`、Output `ready` 同时成立。

默认参考替换也存在类似断层：领域操作已把关联图片标成 `pendingReview`，Delivery 仍显示 `current`，不传递这个复核信息。这里应补充“依据需要复核”，而不是把未变化的图像强行判为新版本。

这不需要引入完成百分比或审批工作流。一个共享的确定性检查结果，分别表达**来源状态、素材可用性、草稿适用性、文案复核需求**，供 Preparation、AI Context 和 Output 使用，就能避免目前多套逻辑不一致。

**AI 与人工确认的边界需要加强，但不应把 AI 变成设计决策者。**

- 修复 Context 传递后，模型应明确知道哪些只是文字摘要、哪些图片实际看过、哪些结论待验证、哪些是历史选用内容。当前 Delivery 请求明确不附带图片，不能把标题和 alt 当作视觉验证。
- Draft 应绑定生成时的章节和引用内容版本；创建与应用都检查依赖。单纯上游变化、但冻结引用没变时，可以保留草稿并提示来源变化；刷新了引用则必须重新检查适用性。
- 应用前要能看到具体 caption。当前草稿卡主要展示 narrative，图注只显示“建议 N 条”，不足以支持用户核验即将写入的文字。[草稿卡 (line 338)](D:/Morpho/src/features/workspace/components/DeliveryPreparationPanel.tsx:338)
- “为什么选择这个方向”必须来自明确决定、比较记录或用户说明。没有依据时应写“未记录”，不能从最终选图反推出设计理由。

**Gap 的现有方向应保留。**

当前 Gap 是轻量的 `open / resolved` 内容缺口，没有负责人、排期、依赖图和进度百分比，尚未演变成项目管理系统。结构异常也主要通过派生 signals 表达，而非自动制造任务，这是合理的。

不足在于 `resolved` 没有说明“补了什么”或“为何本次不需要”。可以考虑轻量解决说明或关联对象，但不应强制建立任务流。是否需要区分“已补齐”和“本次接受缺失”，应通过真实交付项目验证。

**三类输出的产品边界基本正确，应该继续保持。**

|输出|合理职责|当前判断|
|---|---|---|
|Delivery Output|本次选定的结构、文案、素材、来源和未完成事项，供外部排版|范围控制正确；freshness、复核和依据说明不足|
|Human-readable Project Archive|让接手者理解过程、版本、决定、来源和当前状态|信息基础较丰富；理由关联错误，以及可读投影过度精简，需要修正|
|Editable Backup|在 Morpho 中恢复为独立可编辑项目|深校验、二进制检查、独立恢复与失败回滚值得保留；正常编辑与恢复契约必须一致|

Output 已具备外部继续加工所需的基础：章节顺序、已应用文案、caption/note、资产文件、manifest/source map、open gaps 和明确标注的 pending drafts。缺二进制不伪造空文件、size mismatch 保留真实文件并警告、链接不假装成本地文件，这些设计正确。

但仍有两类信息损失：

- **实际未携带的语义**：freshness、复核状态、结论确定程度、部分来源与决定依据。
- **JSON 中保留、普通读者难以看见的内容**：Output Markdown 常优先显示 summary 而非 body；Archive 的 stable-reference 阅读投影也省略正文和 note。接收者可能要打开 JSON 才能还原重要内容。[Output 文案 (line 610)](D:/Morpho/src/domain/morpho/deliveryOutput.ts:610) · [Archive 引用展示 (line 950)](D:/Morpho/src/domain/morpho/projectBundles.ts:950)

面向 PPT、Figma、Illustrator 等工具，Morpho 应提供**稳定素材、可编辑文字、内容顺序、明确对应关系、版本与风险说明**。当前产品规则没有要求最终版面、PPTX、Figma 图层或自动排版；本次审计也没有发现必须引入这些能力的理由。[产品边界 (line 404)](D:/Morpho/docs/product/05_Morpho_项目入口、资产、搜索、导入与归档.md:404)

**后续应分两类验证，不宜混在一次“大重设计”中。**

确定性工程可以直接解决：上述 correctness 缺陷、生成输入与 Draft 依赖绑定、引用排序、删除与恢复契约、跨层 freshness 一致性、正确的 DecisionRecord 关联、资产诊断计数，以及复核信息随包带出。

真实项目和用户测试才能判断：

- 导师、评审者、接手设计师分别需要多深的设计依据；
- 是否需要目标受众、用途和轻量交付检查项；
- 历史版本继续使用时，怎样提示才不形成警告噪声；
- Gap 的解决说明是否有帮助；
- 接收者不读 JSON，能否找出选用版本、真实选择理由、未核实结论和缺失材料；
- 在外部排版工具中，当前素材与文案组织能否减少重新找图、对照版本和补解释的工作。

本轮未调用真实模型，也未进行浏览器视觉验收或外部排版工具实操；因此不把输入缺陷等同于已观察到的模型幻觉，也不把单元测试通过等同于交接可用性通过。**最值得投入的方向是修复依据、依赖和复核信息的连续性，而现有连续画布、稳定引用、人工决策和专业排版工具分工应保留。**