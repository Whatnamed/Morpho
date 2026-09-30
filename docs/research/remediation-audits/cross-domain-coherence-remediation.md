**Morpho 应继续沿用现有架构，修复跨域契约；不需要整体重写，也不需要把此前建议的完整目录树全部落地。** 当前主要缺口是：同一事实被不同模块重新解释，来源信息在传递中丢失，以及异步结果没有始终绑定生成时的真实输入和应用条件。

本轮基于本地 `main`：`2e801ed1558822e6cf46a0e19f7ff84654e7ae69`。已阅读七份专项审计，重新检查相关 canonical 文档、正式调用链，并运行定向测试和独立内存复现。没有修改代码或文档，工作区保持干净。

**一、当前整体架构判断**

当前架构已有可保留的主体：

- 一个连续 Workspace、一个正式 A+ Agent Runtime。
- Objects、Assets、CanvasInstance、revisions、Operation、Proposal、Decision、DeliveryReference 分开建模。
- 客户端管理本地项目事实及本地 Turn outcome；Server Journal 管理外部执行状态、请求身份、计数与限制。
- Controller 已承担项目会话、取消、异步提交与资源生命周期；页面仍作为 composition root。
- Memory、Stage、WorkingState 原本就被定义为结构化事实的投影，而非独立事实源。

这一方向与当前[架构说明](D:/Morpho/docs/architecture/architecture.md:15)和[产品连续性合同](D:/Morpho/docs/product/04_Morpho_状态、版本、项目记录与记忆.md:374)一致。

**问题在实现闭环，不在缺少新的架构层级。** 当前系统通常能完成单项操作，但尚不能充分保证：

> 用户操作或 AI 执行完成后，当前对象、决定解释、Memory、实际 Provider 输入、交付内容和可恢复备份仍相互一致。

A+ 的执行可靠性也不能替代这项保证。外部请求完成、本地结果保存、用户采纳、依据充分，是四种不同事实。

**二、共同根因与去重后的问题清单**

可以归纳为五类共同根因：

1. **authority 消费不统一。** 对象状态、revision、Decision、Continuity 各自解释 currentness。
2. **中间表示损失语义。** 逐项来源、scope、confidence、review 状态变成字符串或文档级来源集合。
3. **计划身份代替实际输入证据。** Context、参考列表、工具授权存在，不代表相应正文或像素进入了请求。
4. **时间边界没有固定。** 草案依赖可能在结果提交时重新采集，历史追溯可能转向当前 revision。
5. **操作完成边界不完整。** 删除、投影、Undo、确认与外部重试的维护范围，与实际影响范围不一致。

下面每组应作为一个修复主题管理；跨域消费者是其验收范围，不再分别登记为重复缺陷。

| 编号 | 去重后的问题 | 当前核实结果 | 分类与优先级 |
|---|---|---|---|
| C1 | 当前事实、决定与事件解释分歧 | 应用第二份设计定义后，WorkingState 指向新定义，Provider frame 仍引用第一份；方向淘汰后恢复，Decision 已 superseded，Stage 仍保留当前“已淘汰”；撤回最后一条记录后旧 Stage 不清退 | **P1：先 correctness，再 authority 收敛** |
| C2 | 实际输入与声明依据不一致 | 110 条短历史使两个已保存 Context frames 全部退出实际请求；Delivery 章节快照在本地存在，但 Provider 请求和读取工具均没有；文档二次截断、Fragment 读取、缺参考像素也存在对应缺口 | **P1：deterministic correctness** |
| C3 | scope、证据资格和不确定性跨层丢失 | A 方向偏好进入 B 的图像 Prompt；隐藏定义仍进入默认 Brief；非法来源过滤后 claim 仍为 `supported`；研究条目提升结论时复制整卡引用，未继承逐项 evidence | **P1：止损后随投影／证据 authority 重构** |
| C4 | Proposal／Draft 没有完整的生成基线与应用条件 | Delivery Draft 可覆盖用户后来修改的 narrative，并在引用刷新后继续应用；依赖从工具提交时的最新 Workspace 采集；file/link/fragment 的 Proposal fingerprint 不完整 | **P1：correctness＋领域依赖契约** |
| C5 | 删除与引用生命周期合同不一致 | 删除方向、原文件、交付包，或移除 Draft 引用，均可使原本合法的项目无法创建 Editable Backup | **P1：deterministic correctness** |
| C6 | 参考关系、身份继承与历史因果混用 | “不用默认参考”仍可将默认图以 selectedSource 纳入；参考数组顺序影响分支继承；多参考影响 version 关系；旧图 Trace 可走到同方向后来的图 | **P1：范围修复；P2：因果／lineage 收敛** |
| C7 | 人工 Undo 与整份 Workspace 恢复混用 | 删除后 Undo 成功、Redo 被阻止；已有消息正文更新不触发保护；恢复直接替换整个 Workspace；方向修订还存在对旧 revision 的原地修改 | **P1：保护数据；随后重构人工历史** |
| C8 | 请求结束代替本地任务验收 | 用户询问最早对话，模拟模型未读取直接回答“没有记录”，Runner 仍记 `success`；Memory 补检目前只是提醒 | **P1：完成边界 correctness** |
| C9 | 外部执行身份没有贯穿底层重试 | GrsAI 生成 POST 存在网络异常后重发路径，本地 `clientRequestId` 未进入上游请求 | **P1：明确不确定执行策略；重复计费未实测** |
| C10 | UI 动作与实际授权语义不一致 | Proposal 隐藏调用 rejection；交付目标残留覆盖当前输入；浮层选择器不匹配导致快捷键穿透；Research“代选／摘录”实际创建确认结论 | **P1：correctness＋interaction contract** |
| C11 | 职责和依赖 ownership 放错位置 | Memory／Continuity 运行时互相依赖；Server 从 Workspace Feature 导入 Agent contract；持久化 Hook 补做领域投影 | **P2：随相关重构解决，不单独发动目录迁移** |

几个直接证据尤其影响实施顺序：

- **C1**：[frame 选择第一个 `revision.isCurrent`](D:/Morpho/src/features/workspace/providerContextFrames.ts:280)，与[项目当前定义解析](D:/Morpho/src/domain/morpho/derivedState.ts:80)不同；[Stage 空投影直接跳过](D:/Morpho/src/domain/morpho/projectMemory.ts:269)。
- **C2**：[实际请求的 last-24／last-96 裁剪](D:/Morpho/src/features/workspace/agentTurnProductPreparationAPlus.ts:389)、[仅本地构建 Delivery Context](D:/Morpho/src/features/workspace/agentTurnProductPreparationAPlus.ts:465)、[读取工具返回结构](D:/Morpho/src/features/workspace/agentReadContextResult.ts:4)。缺图测试目前明确接受 `images=[]` 与保留 reference IDs 同时出现：[现有测试](D:/Morpho/src/features/workspace/workspaceVisualGenerationExecution.test.ts:562)。
- **C3**：[投影生成新 item ID](D:/Morpho/src/domain/morpho/projectContinuity.ts:495)，但[scope 过滤用它查原始 entry ID，找不到就放行](D:/Morpho/src/domain/morpho/projectContinuity.ts:1387)；Compiler 又[展开整个偏好文档](D:/Morpho/src/domain/operations/imagePromptCompiler.ts:75)。
- **C4/C5**：[Draft 创建与应用](D:/Morpho/src/domain/morpho/deliveryPreparation.ts:881)、[通用删除](D:/Morpho/src/domain/morpho/workspace.ts:632)、[Draft 深校验](D:/Morpho/src/domain/morpho/currentWorkspaceValidation.ts:402)的合同不一致。
- **C7/C8**：[Undo 仅检查新增 ID](D:/Morpho/src/features/workspace/workspaceUndo.ts:89)；Server 在[无工具响应后结算 `externallyCompleted`](D:/Morpho/src/app/api/ai/agent/turns/[turnId]/requests/handler.ts:271)，不能假定客户端随后还能沿原协议补轮。

另有一组应独立修复、无需上升为共同架构的小问题：

- 重复 Gap 标签产生重复 ID；引用排序的 `referenceIds` 与 `order` 分歧。
- Archive 取第一个相关 Decision，可能把“选为主方向”的理由写成淘汰理由。
- PPTX 按文件编号而非实际 presentation 顺序提取；文本截断元数据不完整。
- 多查询搜索按查询顺序填满来源限额。
- Delivery 来源标题／隐藏状态漏判，以及缺资产元数据时汇总计数漏报。

其中 Gap ID 属于完整性问题，应提前；其余可按领域在后续阶段顺带关闭。它们不需要通用服务或统一状态机。

**三、推荐的 authority 模型**

**单一 authority 应按事实种类建立，而不是建立唯一万能服务。**

| 信息 | 权威来源／owner | 其他模块的职责 |
|---|---|---|
| 当前项目事实 | 各领域对象及其明确的当前指针、状态；由相应领域命令维护 | WorkingState、UI、Context、Memory 读取同一领域查询 |
| 对象内部当前 revision | 对象 `currentRevisionId` 与 revision 集合 | 不据此推断该对象是全项目当前方案 |
| Historical event | 带发生身份的历史记录 | 回答发生过什么，不直接充当当前约束 |
| Decision | 用户动作及结构化 effect、目标、revision、理由和必要基线 | 展示文案由结构化内容生成；不得反向解析标题判断决定 |
| Proposal／Draft | 未应用内容＋生成时依赖＋目标应用条件 | 用户应用时重新检查；生成成功不等于采纳 |
| Memory／Stage | 从当前领域事实与合法语义声明生成的投影 | 不新增事实资格；保留逐项来源、scope 与 review 信息 |
| Source validity／freshness | 共用来源解析结果，再由领域策略解释 | 不自动撤销决定，也不自动刷新交付快照 |
| Provider input／provenance | 最终材料化请求及其输入清单、表示方式、覆盖范围和请求身份 | 计划列表只表达意图，不能代替发送证据 |
| User confirmation | 当前用户动作或原话，绑定具体目标、effect、依赖基线及项目会话 | 确认“采用”不等于证实内容真实 |
| Delivery snapshot | 已选稳定 DeliveryReference 的冻结内容和素材身份 | 上游变化只形成差异／复核信息；显式 refresh 才更新 |
| Review-required | 各领域根据具体变化生成的理由及对应基线 | UI、Context、Output 共同消费；确认解决时只关闭对应理由 |
| 外部执行／本地结果 | Server Journal／本地 Lifecycle、Coordinator 分别负责 | 不互相推定，也不接管领域事实 |

Decision 应增加的是结构化语义，例如“将方向 X 设为 alternative”“应用定义 X 的 revision Y”。当前 [DecisionRecord](D:/Morpho/src/domain/morpho/types.ts:765)没有这些信息，[分类器](D:/Morpho/src/domain/morpho/decisionRecords.ts:19)因而依赖 summary。旧记录无法可靠还原的部分应保持 historical／unknown／需复核；不能从现在的状态反造过去的决定。

长期语义声明则需要在现有受控写入上支持明确的替代、撤回、解决关系。比如“预算改为 800，替代 500”不能只是追加第二条约束。模糊冲突仍应留待用户判断，不交给字符串去重擅自解决。

**以下状态必须继续分开。**

| 状态 | 准确含义 | 不应推出的结论 |
|---|---|---|
| source unavailable | 当前无法打开或定位来源 | 历史摘录一定错误 |
| source changed | 当前来源与所绑定版本不同 | 旧 snapshot 自动无效 |
| source hidden | 默认读取范围排除该对象 | 用户撤回决定或删除资产 |
| decision superseded | 该决定的 effect 已被后续决定替代 | 原决定没有发生 |
| proposal stale | 生成基线／应用目标发生相关变化 | 所有内容必须删除 |
| visual result not observed | 尚无基于结果像素的观察 | 生成失败或质量不合格 |
| delivery copy needs review | caption／narrative 的依据改变 | 必须自动改写文案 |
| asset missing | 元数据或实际二进制不可用 | 语义来源不存在 |
| output ready | 包结构和已定义检查满足输出条件 | 设计质量、事实或交付充分性已经确认 |

来源解析可以共用 existence、visibility、revision、fingerprint 等信息；Blob 可用性由实际资产读取／预检提供。**领域后果不能共用一个 `isValid`。**

**四、关键跨域合同应如何收敛**

**输入与 provenance：记录“实际提供了什么”，不要声称证明模型“实际理解了什么”。**

建议复用 `ProviderInputSnapshot`、Operation、图像 generation metadata 和 A+ request identity，补齐以下链条：

```text
用户范围与授权
→ planned inputs
→ 实际读取和材料化
→ 最终请求输入清单
→ 请求执行结果
→ 产物
→ 可选观察
→ 用户决定
```

输入清单至少能关联：

- object／revision／asset／DeliveryReference 身份；
- 文本摘录范围、总长度、截断和遗漏原因；
- 图片实际发送形式：单图、总览图及映射；
- 请求身份、输入 hash、生成契约版本；
- 必需输入失败与可选输入降级。

它应由请求材料化过程产生，不能事后拿最新 Workspace 补写。请求已发出后的重试必须复用原 body；压缩后的**下一次新请求**则必须重新组装，不能继续复制旧 `providerBaseRequest`。

这也不需要恢复 Runtime B 的签名证明链。A+ 仍不负责向服务端证明本地资料“为真”；这里解决的是产品自身的输入一致性。

**投影：资格随条目传递，最后才渲染为文字。**

目前 `ProjectMemorySection.items` 是字符串数组，sourceRefs 聚合在 revision 上。这不足以准确过滤某一条方向偏好或说明某一结论需复核。应保留逐项来源关联和 scope；可以演进现有结构或增加对应元数据，不必替换七类 Memory 与六类 Stage。

Context、Visual Prompt、Delivery snapshot 应消费同一份有资格信息的领域读取结果。各自可以裁剪正文，但不能裁掉“候选／已采用、待验证、适用范围、依据版本”等改变解释的信息。

**引用生命周期：按职责处理，禁止通用级联。**

| 引用职责 | 删除／替代时的处理 |
|---|---|
| 当前 ownership／membership | 由所属领域命令解绑、调整或处理子记录；不得留下非法当前引用 |
| 历史来源／revision／Decision | 保留已知身份和历史内容，允许明确的目标缺失；不要求所有历史目标继续存活 |
| Pending Proposal／Draft 的应用依赖 | 标记不可应用或需复核，仍可阅读、放弃 |
| Stable DeliveryReference | 源对象变化、删除不改写冻结内容；来源状态与素材可用性分别报告 |
| 用户隐藏 | 保留语义状态，退出默认读取；不能转成 rejection |
| 被替代语义声明 | 退出当前投影，保留替代链和历史 |

深校验应与这些合同一致。不能靠放松所有引用校验让备份通过，也不能删除所有历史记录来消除悬空引用。

**Snapshot、history、Undo、recovery 应分别处理。**

- revision／Decision／event：保留历史与原因。
- Delivery snapshot：固定本次选用内容。
- Provider request snapshot：固定一次外部请求和重试身份。
- Editable Backup：恢复独立项目副本。
- Undo：逆转一次明确人工操作拥有的变化。
- Runtime recovery：恢复未明确结束的执行，避免重复副作用。

因此，Undo 应逐步转向带 before／after 条件的人工变化集；不再恢复整份 Workspace，也不删除后来完成的 AI 结果或聊天。历史决定可以保留，并用逆向／恢复动作说明后来的变化。

**五、应保留的设计与必要的模块拆分**

应保留：

- A+ Lifecycle、Coordinator、Host、Journal、exact request recovery 和部分成功保存。
- 现有项目会话 guard、functional commit、Controller 与 execution core 分工。
- 对象／资产／画布实例分离，位置不产生领域语义。
- Definition／Direction revision，轻量 VisualBranch，可选 default reference。
- Visual Intent＋确定性 Compiler，新图永不覆盖旧图。
- Operation／Proposal 分离，以及已有明确确认边界。
- 来源驱动 Memory、完整原始聊天、版本化压缩摘要。
- 稳定 DeliveryReference、显式刷新、三类输出边界。

推荐依赖方向是：

```text
UI / Controller
  → 完整应用用例
      → 各领域命令与查询
      → 必需的引用维护、历史记录和投影更新
      → 现有提交／持久化边界

Agent 准备与工具执行
  → 同一批领域查询／用例
  → A+ Runtime / Host ports

Client 与 Server
  → 中立 Agent contract

Infrastructure
  → 实现资产、文档读取、存储等 ports
```

这不是要求立即创建全部目录。真正值得实施的拆分只有：

1. **消除 Memory ↔ Continuity 运行时循环。** 来源解析、语义准入、Decision 解释成为下层纯规则；事件写入、投影、Context 组装单向组合。
2. **提取中立 Agent contract。** 工具 schema、协议 DTO、稳定 Prompt contract 不再由 Workspace Feature 给 Server 提供。
3. **提取完整领域用例。** 同一个操作的引用维护、事件、投影不能依赖“刚好经过某个 React setter”才能完整。
4. **在修改文档读取时分离 parser adapter。** PDF.js、fetch、Blob／Storage 属于适配器，解析结果与资源限制仍可保留在领域层。

`workspace.ts`、`operations.ts` 按上述真实职责逐步提取即可。没有必要继续按行数拆 `WorkspaceClient`，也不需要把 Runtime 文件全部搬目录才算完成。

**六、最终分阶段实施计划**

阶段 0 不另开一轮审计：把本轮反例作为实施阶段的回归场景。每个修复先固定失败轨迹，再做最小修改；按逻辑单元审查，不把全部问题合成一个提交。

| 阶段 | 目标与范围 | 依赖／并行关系 | 验收与停止点 |
|---|---|---|---|
| **1A：状态完整性止损** | 当前定义读取；空 Stage 清退；删除引用合同；revision 不可变；事件重复发生与重放身份；Gap ID；Undo 防止覆盖独立内容 | 可与 1B、1C 并行；同一中心模块指定一个实现 owner | 合法操作后校验、序列化往返、Editable Backup 通过；历史保留；修复不依赖目录搬迁。暂不完成整个 Undo 重构 |
| **1B：输入与应用止损** | Delivery 快照真正入请求；文档／Fragment 覆盖披露；必需参考像素失败阻止执行；显式参考排除；无来源 supported；已有 Draft 指纹检查；压缩后新请求重建；遗漏必读不得报完整成功 | 不等待领域大重构；与 1A 分开提交 | 检查最终发送 payload；无静默遗漏或虚假图生图 provenance；旧 Draft 不无提示覆盖；原请求重试 body 不变 |
| **1C：动作语义止损** | 快捷键表面归属；Proposal 隐藏／放弃分离；清除或显式展示 Delivery target；Reader／Canvas selection 同步；focus 不隐式收窄多选 | 可独立进行 | 真实组件 DOM／浏览器路径证明动作只影响目标表面；显示的任务范围与发送范围一致。停止于已确认回归 |
| **2：领域 authority 与投影收敛** | 结构化 Decision effect/revision；语义声明替代／解决；共用来源解析；逐项 scope／资格；统一领域用例完成边界；消除 Memory／Continuity 循环 | 在相关止损修复后串行建立共享契约；是 3A/B/C 的共同基础 | 同一状态经 UI、工具、导入后读取一致；重复投影不产生等价 revision；隐藏不泄漏；历史事件不充当当前事实 |
| **3A：Evidence／Context／Harness** | 最终输入清单；有界对象／revision／片段读取；长文定位补读；结果图读取；研究 item 与 evidence 稳定关联；完成检查接入 Runner；中立 Agent contract | 依赖 2；可与 3B、3C 的领域工作并行 | 授权范围、实际发送范围、coverage 与 provenance 一致；必读有成功证据；未知／缺证不报成不存在或已证实；恢复不重复作用 |
| **3B：Visual lineage 与观察** | 独立 identity parent、辅助 references、direction／branch；任务内逐图角色；Trace 区分因果和归属；按需读取结果像素 | 依赖 2；观察接线依赖 3A 的图像读取合同 | 重排辅助参考不改变归属；多参考仍保留明确直接父版本；历史 Trace 不走向后来对象；未观察结果不宣称验证通过 |
| **3C：Delivery 依赖与交接** | Draft 绑定生成时章节／引用基线；目标文案冲突检查；refresh 后 copy review；统一 Preparation／Context／Output 的状态读取；输出语义与排序修复 | 依赖 2；输入接线与 3A 对接，可独立推进领域逻辑 | 上游变更不改快照；refresh 不改文案但产生对应复核；旧草案不覆盖新编辑；接收者在可读输出中看到版本、缺口和必要状态 |
| **4A：人工历史收敛** | 用操作拥有的变化集替换整份 Workspace Undo；导航返回独立；覆盖人工创建、删除、隐藏、状态与交付编辑 | 依赖 2 的领域用例；可与 3A/B/C 并行 | Undo／Redo 对称；保留独立 AI 结果、消息和外部执行；相关字段被后来操作改变时明确冲突；不触发 Provider 重跑 |
| **4B：交互合同补齐** | Research 推荐与保留分开；可审阅具体 captions；Region 移动范围明确；异步完成的注意力交接；按需关系／历史修订阅读；基础文本和画布整理合同 | 依赖对应领域契约；独立于模型 Eval | 每个动作的目标和语义可预测；现有 canonical 要求逐项验收。新产品偏好另行验证，不扩展为编辑器重设计 |
| **5：整链验收与真实 Eval** | 固定项目轨迹、故障恢复、旧项目兼容、真实模型和交接用户测试 | 相关实现集成后 | correctness 全部关闭；质量问题以实测记录。达到门槛即停止，不把“增加机制”当作下一默认阶段 |

阶段 1B 中的完成检查需要特别限定：

**先保留现有 Server terminal 协议。** 对确定性必读可在首轮准备或合法工具阶段取得真实结果；最终仍缺少必读或 Memory 处理时，本地明确记录未完成，保留已生成成果，不能报完整成功。不要伪造 tool call，也不要在 `externallyCompleted` 后偷偷新开付费 Turn。

只有产品确实需要自动补轮、且收益经过验证时，才单独设计有次数与成本上限的协议扩展。它不应阻塞当前完成状态修复。

**Schema／compatibility 是计划的一部分。**

当前 schema 为 **17**。本计划不能整体宣称“不需要 migration”：

- 阶段 1 的纯读取、路由、排序修复通常不需要 schema 变化；生命周期修复仍需处理已经保存的 v17 异常状态。
- 阶段 2 的结构化 Decision、语义替代关系、逐项投影元数据，需要明确的版本化兼容。
- 阶段 3 的 evidence 身份、输入清单、visual parent／观察记录、Draft 基线和文案 review，如持久化则需随所属领域迁移。
- 4A 若历史继续限于当前会话，可不增加持久化 schema；4B 新增布局字段时另行兼容。
- 不因本轮重构重跑 A+ 历史数据库 cleanup；领域 schema 演进不等于 Server Journal 迁移。

每次持久化演进必须满足：

1. 旧项目及旧 Backup 可读，迁移幂等，当前案例 fixture 和恢复路径同步更新。
2. 不伪造历史来源版本、实际像素输入、模型观察或用户确认。
3. 旧 Draft 缺少可靠基线时保留可读，明确限制应用；旧 provenance 标为 unknown。
4. 历史 Memory revision 保留，新的当前投影按新规则生成。
5. schema 写入切换前保留原始数据；提供兼容读取／回退安排。**代码回退不能等同于拿旧程序直接重写新 schema。**
6. 已有异常引用只做可确定的修复；无法确定的内容保留证据并诊断，不静默清除。

各阶段先跑直接相关 gate；涉及共享契约、schema 或最终集成时再运行项目既有 typecheck、lint、unit、build、browser checks。无需每个小提交重复全量验证。

**七、必须通过 Eval／用户测试判断的部分**

确定性工程能证明输入存在、身份正确、状态不丢失；不能证明材料支持结论，或设计质量足够好。

| 评估方向 | 应验证什么 |
|---|---|
| Research | 长文后部证据能否被发现；引用是否逐项支持 claim；冲突来源、日期与条件是否被正确解释 |
| 长程连续性 | 压缩与多次改决定后，模型是否仍区分当前约束、旧决定和候选建议 |
| Visual | 多轮身份保持、CMF 与几何分离、场景尺度、跨视角一致性；总览图与单图读取的质量差异 |
| 结果观察 | 按需回读是否改善具体判断；能否诚实表达未观察／不确定；收益是否抵得上成本与延迟 |
| 用户决定 | 用户是否理解“保留为项目判断”而非“证实事实”；推荐集合是否减少工作而不替代决定 |
| Delivery／handoff | 接收者不读 JSON，能否找到选用版本、选择理由、未验证内容和缺失素材 |
| Workspace | Region 移动、异步定位、阅读返回和多选反馈是否符合用户预期 |

复用现有 [Eval corpus](D:/Morpho/docs/architecture/ai-capability-eval-corpus.md:1)，增加固定输入与完整执行轨迹。先用固定资料隔离模型行为，再测实时网络；不要用引用数、工具调用数、反思次数代替质量指标。

**八、此前不应执行或需要修正的建议**

- **不执行完整目录树搬迁。** 只提取能消除职责冲突或反向依赖的模块；不以文件长度作为停止条件。
- **不保留导航 Undo 优先级。** 模块化审计的这条建议与当前[产品规则](D:/Morpho/docs/product/02_Morpho_工作台、画布与对象规则.md:436)冲突，导航返回应独立。
- **不把“过去拆分保持了原行为”理解为原行为正确。** Proposal 隐藏转 rejection 已被旧技术记录描述，但仍违反隐藏的产品语义。
- **不把常驻关系线作为无需修改的既定合同。** 当前规则要求按需关系；若想保留常驻主线，应作为产品规则变更验证，不能以现有实现覆盖 canonical。
- **不将所有状态归并为 `isCurrent/isValid/isReady`，也不统一所有 fingerprint。** 应用依赖、交付快照、资产内容、请求重放的比较对象不同。
- **不让来源变化自动撤销决定、替换交付图或改写 Brief。** 传播依据复核，保留用户 authority。
- **不引入 Event Sourcing、万能 ProjectTruthService、全局状态框架或 workflow engine。** 当前问题用明确领域函数、用例提交和投影即可解决。
- **不默认增加 Planner、Critic、Multi-Agent 或持久任务管理层。** 先接通现有读取、完成检查与按需观察。
- **不默认每次生成后自动评审／重生成。** 普通出图保留用户驱动流程；检查、比较和一致性任务再启用观察。
- **不立即建设通用 RAG、向量库、爬虫或完整文档平台。** 先补有界定位与补读，后续按实际召回瓶颈决定。
- **不把 prompt-cache hint、runtimeConfiguration frame 的持久化整齐度列为本轮 correctness 门槛。** 当前没有证据证明它们应排在输入丢失与领域完整性之前。
- **不扩展到最终 PPTX／Figma 排版或复杂审批流。** stable snapshots、可编辑文案、素材与明确缺口仍是正确交付边界。

本轮执行了 Git／源码只读检查、定向 `npm.cmd test -- --reporter=dot …`，以及通过 `node` 内存加载当前函数的反例复现。**18 个测试文件、242 项测试通过**；部分 Controller 测试有 `act(...)` 警告。未运行浏览器验收、生产 build、线上 Provider 或付费模型；因此上述确认的是实现行为与契约缺陷，未将其表述为已测量的线上事故率或模型质量结果。